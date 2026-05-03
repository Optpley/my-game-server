// server.cjs
const express = require("express");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

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
const tournaments = new Map();
const specialGames = new Map();

let nextLobbyId = 1;
let nextGameId = 1;
let nextTournamentId = 1;
let nextSpecialId = 1;

// ТЕСТОВЫЙ РЕЖИМ — всем новым игрокам 100 звёзд
const TEST_MODE = true;

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
      stars: TEST_MODE ? 100 : 5,
    };
    users.set(key, u);
  } else {
    u.username = initDataUnsafe.user.username || u.username;
    u.name =
      (initDataUnsafe.user.first_name || "") +
      (initDataUnsafe.user.last_name || "");
    u.avatar = initDataUnsafe.user.photo_url || u.avatar;
  }
  return u;
}

function hashString(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function rand01(seed) {
  const h = hashString(seed);
  const num = parseInt(h.slice(0, 8), 16);
  return num / 0xffffffff;
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

// ===== Game physics =====

function simulateGame(mode, players) {
  const frames = [];

  // общие параметры арены
  const width = 100;
  const height = 100;
  const radius = 4;
  const dt = 0.1;
  const maxTicks = 300;

  const state = players.map((p, idx) => {
    const angle = (2 * Math.PI * idx) / players.length;
    return {
      id: p.id,
      username: p.username || String(p.id),
      x: 50 + Math.cos(angle) * 20,
      y: 50 + Math.sin(angle) * 20,
      vx: 0,
      vy: 0,
      alive: true,
      score: 0,
      colorCells: 0,
    };
  });

  function pushFrame() {
    frames.push(
      state.map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        alive: s.alive,
      }))
    );
  }

  function applyBorders(s) {
    if (!s.alive) return;
    if (mode === "elimination") {
      // вылет за круг
      const dx = s.x - 50;
      const dy = s.y - 50;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 45) {
        s.alive = false;
      }
    } else {
      // прямоугольная арена
      if (s.x < radius) {
        s.x = radius;
        s.vx = -s.vx * 0.6;
      }
      if (s.x > width - radius) {
        s.x = width - radius;
        s.vx = -s.vx * 0.6;
      }
      if (s.y < radius) {
        s.y = radius;
        s.vy = -s.vy * 0.6;
      }
      if (s.y > height - radius) {
        s.y = height - radius;
        s.vy = -s.vy * 0.6;
      }
    }
  }

  function applyCollisions() {
    for (let i = 0; i < state.length; i++) {
      for (let j = i + 1; j < state.length; j++) {
        const a = state[i];
        const b = state[j];
        if (!a.alive || !b.alive) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = radius * 2;

        if (dist > 0 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          a.x -= nx * (overlap / 2);
          a.y -= ny * (overlap / 2);
          b.x += nx * (overlap / 2);
          b.y += ny * (overlap / 2);

          const av = a.vx * nx + a.vy * ny;
          const bv = b.vx * nx + b.vy * ny;
          const p = (2 * (av - bv)) / 2;

          a.vx -= p * nx * 0.8;
          a.vy -= p * ny * 0.8;
          b.vx += p * nx * 0.8;
          b.vy += p * ny * 0.8;
        }
      }
    }
  }

  function applyModeForces(tick) {
    state.forEach((s, idx) => {
      if (!s.alive) return;

      const seedBase = mode + ":" + s.username + ":" + tick;

      if (mode === "ice_arena") {
        const angle =
          rand01(seedBase + ":angle") * 2 * Math.PI;
        const force = 8;
        s.vx += Math.cos(angle) * force * dt;
        s.vy += Math.sin(angle) * force * dt;
        s.vx *= 0.98;
        s.vy *= 0.98;
      } else if (mode === "elimination") {
        const dx = s.x - 50;
        const dy = s.y - 50;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = 10;
        s.vx += nx * push * dt;
        s.vy += ny * push * dt;
        s.vx *= 0.99;
        s.vy *= 0.99;
      } else if (mode === "ball_race") {
        const targetX = 90;
        const targetY = 50 + (idx - (state.length - 1) / 2) * 10;
        const dx = targetX - s.x;
        const dy = targetY - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        const accel = 15;
        s.vx += nx * accel * dt;
        s.vy += ny * accel * dt;
        s.vx *= 0.97;
        s.vy *= 0.97;
      } else if (mode === "color_arena") {
        const angle =
          rand01(seedBase + ":angle") * 2 * Math.PI;
        const force = 10;
        s.vx += Math.cos(angle) * force * dt;
        s.vy += Math.sin(angle) * force * dt;
        s.vx *= 0.96;
        s.vy *= 0.96;
      } else if (mode === "mix") {
        const phase = tick % 4;
        if (phase === 0) {
          const angle =
            rand01(seedBase + ":angle") * 2 * Math.PI;
          const force = 8;
          s.vx += Math.cos(angle) * force * dt;
          s.vy += Math.sin(angle) * force * dt;
        } else if (phase === 1) {
          const dx = s.x - 50;
          const dy = s.y - 50;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;
          const push = 10;
          s.vx += nx * push * dt;
          s.vy += ny * push * dt;
        } else if (phase === 2) {
          const targetX = 90;
          const targetY = 50 + (idx - (state.length - 1) / 2) * 10;
          const dx = targetX - s.x;
          const dy = targetY - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;
          const accel = 15;
          s.vx += nx * accel * dt;
          s.vy += ny * accel * dt;
        } else if (phase === 3) {
          const angle =
            rand01(seedBase + ":angle") * 2 * Math.PI;
          const force = 10;
          s.vx += Math.cos(angle) * force * dt;
          s.vy += Math.sin(angle) * force * dt;
        }
        s.vx *= 0.97;
        s.vy *= 0.97;
      }
    });
  }

  // простая сетка для color_arena
  const gridSize = 10;
  const grid = {};
  function colorCell(s) {
    if (mode !== "color_arena" && mode !== "mix") return;
    const gx = Math.floor(s.x / gridSize);
    const gy = Math.floor(s.y / gridSize);
    const key = gx + ":" + gy;
    if (!grid[key]) {
      grid[key] = s.id;
      s.colorCells++;
    }
  }

  let winnerId = null;

  for (let tick = 0; tick < maxTicks; tick++) {
    const aliveCount = state.filter((s) => s.alive).length;
    if (aliveCount <= 1) {
      const alive = state.find((s) => s.alive);
      winnerId = alive ? alive.id : state[0].id;
      break;
    }

    applyModeForces(tick);

    state.forEach((s) => {
      if (!s.alive) return;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      applyBorders(s);
      colorCell(s);
    });

    applyCollisions();
    pushFrame();
  }

  if (!winnerId) {
    if (mode === "color_arena") {
      state.sort((a, b) => b.colorCells - a.colorCells);
      winnerId = state[0].id;
    } else if (mode === "ball_race") {
      state.sort((a, b) => b.x - a.x);
      winnerId = state[0].id;
    } else {
      state.sort((a, b) => b.x - a.x);
      winnerId = state[0].id;
    }
  }

  return { winnerId, frames };
}

// ===== History =====
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
  const filter = req.query.filter || "latest";
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

// рассылка всем
app.post("/api/admin/broadcast", async (req, res) => {
  const { adminSecret, text } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== "dev_secret") {
    return res.json({ ok: false, error: "bad_secret" });
  }

  if (!text || text.length < 1) {
    return res.json({ ok: false, error: "empty_text" });
  }

  let sent = 0;

  for (const u of users.values()) {
    const chatId = u.id;
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
        }),
      });
      sent++;
    } catch (e) {
      console.log("Ошибка отправки пользователю", chatId);
    }
  }

  res.json({ ok: true, sent });
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





