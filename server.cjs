// server.cjs
const express = require("express");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const bodyParser = require("body-parser");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ====== In-memory storage (можно потом заменить на БД) ======
const users = new Map(); // key: tg_id, value: { id, username, name, avatar, stars }
const lobbies = new Map(); // key: lobbyId, value: { id, mode, bet, customBet, players, status }
const games = new Map(); // key: gameId, value: { id, mode, bet, players, winnerId, replay, createdAt }
let nextLobbyId = 1;
let nextGameId = 1;

// ====== Helpers ======
function getUserKeyFromInitData(initDataUnsafe) {
  if (!initDataUnsafe || !initDataUnsafe.user) return null;
  return String(initDataUnsafe.user.id);
}

function ensureUser(initDataUnsafe) {
  const key = getUserKeyFromInitData(initDataUnsafe);
  if (!key) return null;

  let u = users.get(key);
  if (!u) {
    u = {
      id: key,
      username: initDataUnsafe.user.username || null,
      name:
        (initDataUnsafe.user.first_name || "") +
        " " +
        (initDataUnsafe.user.last_name || ""),
      avatar: initDataUnsafe.user.photo_url || null,
      stars: 0, // без стартовых 100
    };
    users.set(key, u);
  } else {
    // обновим имя/аву/юзернейм, если изменились
    u.username = initDataUnsafe.user.username || u.username;
    u.name =
      (initDataUnsafe.user.first_name || "") +
      " " +
      (initDataUnsafe.user.last_name || "");
    u.avatar = initDataUnsafe.user.photo_url || u.avatar;
  }
  return u;
}

function hashString(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function deterministicStep(username, tick) {
  const h = hashString(username + ":" + tick);
  const num = parseInt(h.slice(0, 8), 16);
  return (num % 7) + 1; // шаг 1..7
}

// ====== WebSocket для онлайна ======
const wsClients = new Map(); // key: userId, value: ws

wss.on("connection", (ws) => {
  let userId = null;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "auth") {
        // data.initDataUnsafe
        const u = ensureUser(data.initDataUnsafe);
        if (!u) return;
        userId = u.id;
        wsClients.set(userId, ws);
        ws.send(
          JSON.stringify({
            type: "auth_ok",
            user: {
              id: u.id,
              username: u.username,
              name: u.name,
              avatar: u.avatar,
              stars: u.stars,
            },
          })
        );
        sendLobbyState(ws);
        sendUserGames(ws, u.id);
      }
      if (data.type === "join_lobby") {
        handleJoinLobby(userId, data.mode, data.bet, data.customBet);
      }
      if (data.type === "get_state") {
        sendLobbyState(ws);
        if (userId) sendUserGames(ws, userId);
      }
    } catch (e) {
      console.error("WS message error:", e);
    }
  });

  ws.on("close", () => {
    if (userId) {
      wsClients.delete(userId);
    }
  });
});

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wsClients.values()) {
    try {
      ws.send(msg);
    } catch (e) {}
  }
}

function sendToUser(userId, obj) {
  const ws = wsClients.get(userId);
  if (!ws) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (e) {}
}

function sendLobbyState(ws) {
  const list = Array.from(lobbies.values()).map((l) => ({
    id: l.id,
    mode: l.mode,
    bet: l.bet,
    customBet: l.customBet,
    players: l.players.map((p) => ({
      id: p.id,
      username: p.username,
      name: p.name,
      avatar: p.avatar,
    })),
    status: l.status,
  }));
  ws.send(
    JSON.stringify({
      type: "lobbies",
      lobbies: list,
    })
  );
}

function sendUserGames(ws, userId) {
  const list = Array.from(games.values())
    .filter((g) => g.players.some((p) => p.id === userId))
    .sort((a, b) => b.id - a.id)
    .slice(0, 50)
    .map((g) => ({
      id: g.id,
      mode: g.mode,
      bet: g.bet,
      players: g.players.map((p) => ({
        id: p.id,
        username: p.username,
        name: p.name,
        avatar: p.avatar,
      })),
      winnerId: g.winnerId,
      createdAt: g.createdAt,
    }));

  ws.send(
    JSON.stringify({
      type: "user_games",
      games: list,
    })
  );
}

// ====== Лобби и запуск игр ======
function handleJoinLobby(userId, mode, bet, customBet) {
  const u = users.get(String(userId));
  if (!u) return;
  const realBet = customBet && customBet > 0 ? customBet : bet || 1;

  if (u.stars < realBet) {
    sendToUser(userId, {
      type: "error",
      message: "Недостаточно звёзд для ставки",
    });
    return;
  }

  // ищем существующее лобби с тем же режимом и ставкой, где ещё есть место
  let lobby = Array.from(lobbies.values()).find(
    (l) =>
      l.mode === mode &&
      l.bet === realBet &&
      l.status === "waiting" &&
      l.players.length < 4
  );

  if (!lobby) {
    lobby = {
      id: nextLobbyId++,
      mode,
      bet: realBet,
      customBet: customBet || null,
      players: [],
      status: "waiting",
    };
    lobbies.set(lobby.id, lobby);
  }

  if (lobby.players.some((p) => p.id === u.id)) {
    sendToUser(userId, {
      type: "error",
      message: "Вы уже в этом лобби",
    });
    return;
  }

  lobby.players.push({
    id: u.id,
    username: u.username,
    name: u.name,
    avatar: u.avatar,
  });

  broadcast({
    type: "lobbies",
    lobbies: Array.from(lobbies.values()),
  });

  if (lobby.players.length >= 2) {
    startGameFromLobby(lobby);
  }
}

function startGameFromLobby(lobby) {
  lobby.status = "playing";

  const gameId = nextGameId++;
  const mode = lobby.mode;
  const bet = lobby.bet;
  const players = lobby.players.map((p) => ({ ...p }));

  // списываем ставку
  for (const p of players) {
    const u = users.get(String(p.id));
    if (u) {
      u.stars -= bet;
      if (u.stars < 0) u.stars = 0;
    }
  }

  // запускаем механику
  const replay = simulateGame(mode, players);
  const winnerId = replay.winnerId;

  // начисляем выигрыш
  const pot = bet * players.length;
  const winnerUser = users.get(String(winnerId));
  if (winnerUser) {
    winnerUser.stars += pot;
  }

  const game = {
    id: gameId,
    mode,
    bet,
    players,
    winnerId,
    replay: replay.frames,
    createdAt: Date.now(),
  };
  games.set(gameId, game);

  // удаляем лобби
  lobbies.delete(lobby.id);

  // уведомляем игроков
  for (const p of players) {
    sendToUser(p.id, {
      type: "game_result",
      game: {
        id: game.id,
        mode: game.mode,
        bet: game.bet,
        players: game.players,
        winnerId: game.winnerId,
        createdAt: game.createdAt,
      },
    });
  }

  broadcast({
    type: "lobbies",
    lobbies: Array.from(lobbies.values()),
  });
}

// ====== Механика игр (без Math.random, детерминированно) ======
function simulateGame(mode, players) {
  // общая идея: у каждого игрока есть позиция/очки,
  // на каждом тике шаг считается детерминированно от username+tick
  const frames = [];
  const state = players.map((p) => ({
    id: p.id,
    username: p.username || String(p.id),
    pos: 0,
  }));

  const maxTicks = 60;
  const target = 100;

  let winnerId = null;

  for (let tick = 0; tick < maxTicks; tick++) {
    for (const s of state) {
      const step = deterministicStep(s.username, mode + ":" + tick);
      if (mode === "ice_arena") {
        s.pos += step;
      } else if (mode === "elimination") {
        s.pos += step * 0.8;
      } else if (mode === "ball_race") {
        s.pos += step * 1.2;
      } else if (mode === "color_arena") {
        s.pos += step;
      } else if (mode === "mix") {
        const m = tick % 4;
        if (m === 0) s.pos += step;
        if (m === 1) s.pos += step * 0.8;
        if (m === 2) s.pos += step * 1.2;
        if (m === 3) s.pos += step;
      } else {
        s.pos += step;
      }
    }

    frames.push(
      state.map((s) => ({
        id: s.id,
        pos: s.pos,
      }))
    );

    const reached = state.filter((s) => s.pos >= target);
    if (reached.length > 0) {
      reached.sort((a, b) => b.pos - a.pos);
      winnerId = reached[0].id;
      break;
    }
  }

  if (!winnerId) {
    state.sort((a, b) => b.pos - a.pos);
    winnerId = state[0].id;
  }

  return { winnerId, frames };
}

// ====== HTTP API ======

// Получить баланс и профиль
app.post("/api/me", (req, res) => {
  const initDataUnsafe = req.body.initDataUnsafe;
  const u = ensureUser(initDataUnsafe);
  if (!u) return res.json({ ok: false });

  res.json({
    ok: true,
    user: {
      id: u.id,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      stars: u.stars,
    },
  });
});

// История игр (с сортировкой)
app.get("/api/history", (req, res) => {
  const sort = req.query.sort || "latest"; // latest | biggest | lucky

  let list = Array.from(games.values());

  if (sort === "biggest") {
    list.sort((a, b) => b.bet * b.players.length - a.bet * a.players.length);
  } else if (sort === "lucky") {
    // "везучие" — где победитель имел меньше всех звёзд до игры
    list.sort((a, b) => {
      const scoreA = luckScore(a);
      const scoreB = luckScore(b);
      return scoreB - scoreA;
    });
  } else {
    list.sort((a, b) => b.id - a.id);
  }

  list = list.slice(0, 100);

  res.json({
    ok: true,
    games: list.map((g) => ({
      id: g.id,
      mode: g.mode,
      bet: g.bet,
      players: g.players,
      winnerId: g.winnerId,
      createdAt: g.createdAt,
    })),
  });
});

function luckScore(game) {
  // чем меньше звёзд было у победителя, тем "везучее"
  const winner = game.players.find((p) => p.id === game.winnerId);
  if (!winner) return 0;
  const u = users.get(String(winner.id));
  if (!u) return 0;
  return 1000000 - u.stars;
}

// Реплей по id
app.get("/api/games/replay/:id", (req, res) => {
  const id = Number(req.params.id);
  const g = games.get(id);
  if (!g) return res.json({ ok: false });

  res.json({
    ok: true,
    game: {
      id: g.id,
      mode: g.mode,
      bet: g.bet,
      players: g.players,
      winnerId: g.winnerId,
      replay: g.replay,
      createdAt: g.createdAt,
    },
  });
});

// Админ: выдача звёзд по username
app.post("/api/admin/give-stars", (req, res) => {
  const { adminSecret, username, amount } = req.body;
  // простой секрет, потом заменишь
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== "dev_secret") {
    return res.json({ ok: false, error: "bad_secret" });
  }
  if (!username || !amount) {
    return res.json({ ok: false, error: "bad_params" });
  }

  const u = Array.from(users.values()).find(
    (u) => u.username && u.username.toLowerCase() === username.toLowerCase()
  );
  if (!u) {
    return res.json({ ok: false, error: "user_not_found" });
  }

  u.stars += Number(amount);
  if (u.stars < 0) u.stars = 0;

  res.json({
    ok: true,
    user: {
      id: u.id,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      stars: u.stars,
    },
  });
});

// ====== Start ======
server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});

