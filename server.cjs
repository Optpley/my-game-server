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

// ===== In-memory storage =====
const users = new Map(); // id -> {id, username, name, avatar, stars}
const lobbies = new Map(); // id -> {id, mode, bet, players, status}
const games = new Map(); // id -> {id, mode, bet, players, winnerId, replay, createdAt}
const tournaments = new Map(); // id -> {id, name, modes, gameNumber, durationMinutes, createdAt}
const specialGames = new Map(); // id -> {id, gameNumber, durationMinutes, createdAt}

let nextLobbyId = 1;
let nextGameId = 1;
let nextTournamentId = 1;
let nextSpecialId = 1;

// ===== Helpers =====
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

function deterministicStep(username, seed) {
  const h = hashString(username + ":" + seed);
  const num = parseInt(h.slice(0, 8), 16);
  return (num % 7) + 1; // 1..7
}

// ===== WebSocket =====
const wsClients = new Map(); // userId -> ws

wss.on("connection", (ws) => {
  let userId = null;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "auth") {
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
      }

      if (!userId) return;

      if (data.type === "join_lobby") {
        handleJoinLobby(userId, data.mode, data.bet);
      }
    } catch (e) {
      console.error("WS message error:", e);
    }
  });

  ws.on("close", () => {
    if (userId) wsClients.delete(userId);
  });
});

function sendToUser(userId, obj) {
  const ws = wsClients.get(userId);
  if (!ws) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (e) {}
}

function broadcastToLobby(lobby, obj) {
  const msg = JSON.stringify(obj);
  lobby.players.forEach((p) => {
    const ws = wsClients.get(p.id);
    if (!ws) return;
    try {
      ws.send(msg);
    } catch (e) {}
  });
}

// ===== Lobby & games =====
function handleJoinLobby(userId, mode, bet) {
  const u = users.get(String(userId));
  if (!u) {
    sendToUser(userId, { type: "error", message: "Пользователь не найден" });
    return;
  }

  const realBet = bet && bet > 0 ? bet : 1;
  if (u.stars < realBet) {
    sendToUser(userId, {
      type: "error",
      message: "Недостаточно звёзд для ставки",
    });
    return;
  }

  let lobby = Array.from(lobbies.values()).find(
    (l) =>
      l.mode === mode &&
      l.bet === realBet &&
      l.status === "waiting" &&
      l.players.length < 2
  );

  if (!lobby) {
    lobby = {
      id: nextLobbyId++,
      mode,
      bet: realBet,
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

  // отправляем состояние лобби всем в нём
  broadcastToLobby(lobby, {
    type: "lobby_state",
    lobby: {
      id: lobby.id,
      mode: lobby.mode,
      bet: lobby.bet,
      players: lobby.players,
      status: lobby.status,
    },
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
  players.forEach((p) => {
    const u = users.get(String(p.id));
    if (u) {
      u.stars -= bet;
      if (u.stars < 0) u.stars = 0;
    }
  });

  const replay = simulateGame(mode, players);
  const winnerId = replay.winnerId;
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

  // уведомляем игроков
  broadcastToLobby(lobby, {
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

  lobbies.delete(lobby.id);
}

// ===== Game mechanics =====
function simulateGame(mode, players) {
  const frames = [];
  const state = players.map((p) => ({
    id: p.id,
    username: p.username || String(p.id),
    pos: 0,
    alive: true,
  }));

  const maxTicks = 80;
  const target = 100;
  let winnerId = null;

  for (let tick = 0; tick < maxTicks; tick++) {
    const alivePlayers = state.filter((s) => s.alive);
    if (alivePlayers.length <= 1) {
      winnerId = alivePlayers[0].id;
      break;
    }

    alivePlayers.forEach((s) => {
      const step = deterministicStep(
        s.username,
        mode + ":" + tick.toString()
      );
      if (mode === "ice_arena") {
        s.pos += step;
      } else if (mode === "elimination") {
        s.pos += step * 0.7;
      } else if (mode === "ball_race") {
        s.pos += step * 1.3;
      } else if (mode === "color_arena") {
        s.pos += step;
      } else if (mode === "mix") {
        const phase = tick % 4;
        if (phase === 0) s.pos += step;
        if (phase === 1) s.pos += step * 0.7;
        if (phase === 2) s.pos += step * 1.3;
        if (phase === 3) s.pos += step;
      } else {
        s.pos += step;
      }
    });

    // для режима "выбывание" — каждый N тиков вылетает последний
    if (mode === "elimination" && tick > 0 && tick % 10 === 0) {
      const aliveNow = state.filter((s) => s.alive);
      if (aliveNow.length > 1) {
        aliveNow.sort((a, b) => a.pos - b.pos);
        aliveNow[0].alive = false;
      }
    }

    frames.push(
      state.map((s) => ({
        id: s.id,
        pos: s.pos,
        alive: s.alive,
      }))
    );

    const reached = state.filter((s) => s.alive && s.pos >= target);
    if (reached.length > 0) {
      reached.sort((a, b) => b.pos - a.pos);
      winnerId = reached[0].id;
      break;
    }
  }

  if (!winnerId) {
    const aliveNow = state.filter((s) => s.alive);
    aliveNow.sort((a, b) => b.pos - a.pos);
    winnerId = aliveNow[0].id;
  }

  return { winnerId, frames };
}

// ===== History helpers =====
function luckScore(game) {
  const winner = game.players.find((p) => p.id === game.winnerId);
  if (!winner) return 0;
  const u = users.get(String(winner.id));
  if (!u) return 0;
  return 1000000 - u.stars;
}

// ===== HTTP API =====

// профиль
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

// история игр
app.get("/api/history", (req, res) => {
  const mode = req.query.mode || null;
  const filter = req.query.filter || "latest"; // latest | biggest | lucky | mine
  const userId = req.query.userId || null;

  let list = Array.from(games.values());

  if (mode) list = list.filter((g) => g.mode === mode);
  if (filter === "mine" && userId) {
    list = list.filter((g) =>
      g.players.some((p) => String(p.id) === String(userId))
    );
  }

  if (filter === "biggest") {
    list.sort(
      (a, b) => b.bet * b.players.length - a.bet * a.players.length
    );
  } else if (filter === "lucky") {
    list.sort((a, b) => luckScore(b) - luckScore(a));
  } else {
    list.sort((a, b) => b.createdAt - a.createdAt);
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

// реплей
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

// админ: звёзды по username
app.post("/api/admin/give-stars", (req, res) => {
  const { adminSecret, username, amount } = req.body;
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

// турниры
app.post("/api/tournaments", (req, res) => {
  const { adminSecret, name, modes, gameNumber, durationMinutes } = req.body;
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== "dev_secret") {
    return res.json({ ok: false, error: "bad_secret" });
  }
  const t = {
    id: nextTournamentId++,
    name: name || "Турнир",
    modes: Array.isArray(modes) ? modes : [],
    gameNumber: Number(gameNumber) || 0,
    durationMinutes: Number(durationMinutes) || 0,
    createdAt: Date.now(),
  };
  tournaments.set(t.id, t);
  res.json({ ok: true, tournament: t });
});

app.get("/api/tournaments", (req, res) => {
  res.json({
    ok: true,
    tournaments: Array.from(tournaments.values()),
  });
});

// особая игра
app.post("/api/special-game", (req, res) => {
  const { adminSecret, gameNumber, durationMinutes } = req.body;
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== "dev_secret") {
    return res.json({ ok: false, error: "bad_secret" });
  }
  const s = {
    id: nextSpecialId++,
    gameNumber: Number(gameNumber) || 0,
    durationMinutes: Number(durationMinutes) || 0,
    createdAt: Date.now(),
  };
  specialGames.set(s.id, s);
  res.json({ ok: true, special: s });
});

app.get("/api/special-game", (req, res) => {
  res.json({
    ok: true,
    specials: Array.from(specialGames.values()),
  });
});

// ===== Start =====
server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});


