// server.cjs
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const fetchFn = (...args) => fetch(...args);

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_SECRET = "dev_secret";
const PORT = process.env.PORT || 3000;

const COMMISSION = 0.05;
const PREGAME_SECONDS = 6;
const PREVIEW_FRAMES = 30;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(path.join(__dirname, "db.sqlite"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    tg_id INTEGER UNIQUE,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    avatar TEXT,
    stars INTEGER DEFAULT 100
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT,
    bet INTEGER,
    winner_id INTEGER,
    created_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS game_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    user_id INTEGER,
    username TEXT,
    avatar TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS game_replays (
    game_id INTEGER PRIMARY KEY,
    replay_json TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modes_json TEXT,
    bet INTEGER,
    prizes_json TEXT,
    status TEXT,
    created_at INTEGER
  )`);
});

function getUserByTgId(tgId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE tg_id = ?", [tgId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function createUserFromInit(init) {
  return new Promise((resolve, reject) => {
    const u = init.user;
    db.run(
      `INSERT INTO users (tg_id, username, first_name, last_name, avatar, stars)
       VALUES (?, ?, ?, ?, ?, 100)`,
      [u.id, u.username || null, u.first_name || null, u.last_name || null, u.photo_url || null],
      function (err) {
        if (err) return reject(err);
        db.get("SELECT * FROM users WHERE id = ?", [this.lastID], (e, row) => {
          if (e) return reject(e);
          resolve(row);
        });
      }
    );
  });
}

function updateUserFromInit(userId, init) {
  return new Promise((resolve, reject) => {
    const u = init.user;
    db.run(
      `UPDATE users SET username = ?, first_name = ?, last_name = ?, avatar = ? WHERE id = ?`,
      [u.username || null, u.first_name || null, u.last_name || null, u.photo_url || null, userId],
      (err) => {
        if (err) return reject(err);
        db.get("SELECT * FROM users WHERE id = ?", [userId], (e, row) => {
          if (e) return reject(e);
          resolve(row);
        });
      }
    );
  });
}

function changeStars(userId, delta) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET stars = stars + ? WHERE id = ?`, [delta, userId], function (err) {
      if (err) return reject(err);
      db.get("SELECT * FROM users WHERE id = ?", [userId], (e, row) => {
        if (e) return reject(e);
        resolve(row);
      });
    });
  });
}

function createGame(mode, bet, players, winnerId, replay) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(`INSERT INTO games (mode, bet, winner_id, created_at) VALUES (?, ?, ?, ?)`, [mode, bet, winnerId, now], function (err) {
      if (err) return reject(err);
      const gameId = this.lastID;
      const stmt = db.prepare(`INSERT INTO game_players (game_id, user_id, username, avatar) VALUES (?, ?, ?, ?)`);
      players.forEach((p) => stmt.run(gameId, p.id, p.username || null, p.avatar || null));
      stmt.finalize();
      db.run(`INSERT INTO game_replays (game_id, replay_json) VALUES (?, ?)`, [gameId, JSON.stringify(replay || [])], (e2) => {
        if (e2) return reject(e2);
        resolve({ id: gameId, mode, bet, winnerId, createdAt: now });
      });
    });
  });
}

// --- Simulations ---
// Coordinates 0..100

function simulateIceArena(players, bet, maxSteps = 200) {
  const frames = [];
  const totalBet = players.reduce((s, p) => s + (p.bet || 0), 0) || 1;

  let startAngle = 0;
  const sectors = {};
  players.forEach((p) => {
    const portion = (p.bet || 0) / totalBet;
    const angle = portion * Math.PI * 2;
    sectors[p.id] = { start: startAngle, end: startAngle + angle, portion };
    startAngle += angle;
  });

  let puck = { x: 50, y: 50, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 };

  for (let t = 0; t < maxSteps; t++) {
    puck.x += puck.vx * 2;
    puck.y += puck.vy * 2;
    if (puck.x < 5 || puck.x > 95) puck.vx *= -1;
    if (puck.y < 5 || puck.y > 95) puck.vy *= -1;

    const frame = [];
    players.forEach((p) => {
      const mid = (sectors[p.id].start + sectors[p.id].end) / 2;
      const px = 50 + Math.cos(mid) * 35;
      const py = 50 + Math.sin(mid) * 35;
      frame.push({ id: p.id, x: px, y: py, r: 7, alive: true, color: p.color, avatar: p.avatar });
    });

    frame.push({ id: "puck", x: puck.x, y: puck.y, r: 4, alive: true, color: "#fff", avatar: null });

    if (t === 0) {
      frame.push({ id: "sectors_meta", extra: { sectors } });
    }

    frames.push(frame);
  }

  const dx = puck.x - 50, dy = puck.y - 50;
  let angle = Math.atan2(dy, dx); if (angle < 0) angle += Math.PI * 2;
  let winnerId = players[0].id;
  for (const p of players) {
    const s = sectors[p.id];
    if (angle >= s.start && angle <= s.end) { winnerId = p.id; break; }
  }
  return { winnerId, frames };
}

function simulateVyBivanie(players, maxSteps = 350) {
  const frames = [];
  const ids = players.map((p) => p.id);
  const totalBet = players.reduce((s, p) => s + (p.bet || 0), 0) || 1;
  const balls = {};
  players.forEach((p, i) => {
    const sizeFactor = 0.6 + ((p.bet || 0) / totalBet) * 1.4;
    const speedFactor = 1.4 - Math.min(1.0, ((p.bet || 0) / totalBet) * 1.0);
    balls[p.id] = { x: 20 + (i * 60) / players.length, y: 50, vx: (Math.random() - 0.5) * speedFactor, vy: (Math.random() - 0.5) * speedFactor, r: 6 * sizeFactor, alive: true, avatar: p.avatar, color: p.color };
  });

  const steps = maxSteps;
  const wallRemoveAt = Math.floor(steps * 0.75);
  const wallWhich = Math.random() < 0.5 ? "top" : "bottom";

  for (let t = 0; t < steps; t++) {
    const frame = [];
    ids.forEach((id) => {
      const b = balls[id];
      const p = players.find((x) => x.id === id);
      if (!b.alive) {
        frame.push({ id, x: b.x, y: b.y, r: b.r, alive: false, avatar: b.avatar, color: b.color });
        return;
      }
      b.x += b.vx; b.y += b.vy;
      if (b.x < 5) { b.x = 5; b.vx *= -1; }
      if (b.x > 95) { b.x = 95; b.vx *= -1; }
      if (t < wallRemoveAt) {
        if (b.y < 5) { b.y = 5; b.vy *= -1; }
        if (b.y > 95) { b.y = 95; b.vy *= -1; }
      } else {
        if (wallWhich === "top" && b.y < 0) b.alive = false;
        if (wallWhich === "bottom" && b.y > 100) b.alive = false;
        if (wallWhich === "top" && b.y > 95) { b.y = 95; b.vy *= -1; }
        if (wallWhich === "bottom" && b.y < 5) { b.y = 5; b.vy *= -1; }
      }
      ids.forEach((otherId) => {
        if (otherId === id) return;
        const o = balls[otherId];
        if (!o.alive) return;
        const dx = o.x - b.x, dy = o.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = b.r + o.r;
        if (dist < minDist && dist > 0.1) {
          const angle = Math.atan2(dy, dx);
          const force = 0.8;
          b.vx -= Math.cos(angle) * force; b.vy -= Math.sin(angle) * force;
          o.vx += Math.cos(angle) * force; o.vy += Math.sin(angle) * force;
        }
      });
      frame.push({ id, x: b.x, y: b.y, r: b.r, alive: b.alive, avatar: b.avatar, color: b.color });
    });
    frame.push({ id: "walls", extra: { wallRemoved: t >= wallRemoveAt, which: wallWhich } });
    frames.push(frame);
    const aliveIds = ids.filter((id) => balls[id].alive);
    if (aliveIds.length <= 1) break;
  }
  const aliveIds = ids.filter((id) => balls[id].alive);
  const winnerId = aliveIds.length ? aliveIds[0] : ids[0];
  return { winnerId, frames };
}

function simulateColorArena(players, maxSteps = 250) {
  const frames = [];
  const ids = players.map((p) => p.id);
  const gridSize = 20;
  const grid = Array.from({ length: gridSize }, () => Array.from({ length: gridSize }, () => null));
  const balls = {};
  players.forEach((p, i) => { balls[p.id] = { x: 20 + (i * 60) / players.length, y: 50, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, r: 5 }; });
  const steps = maxSteps;
  for (let t = 0; t < steps; t++) {
    const frame = [];
    ids.forEach((id) => {
      const b = balls[id]; const p = players.find((x) => x.id === id);
      b.x += b.vx; b.y += b.vy;
      if (b.x < 5 || b.x > 95) b.vx *= -1;
      if (b.y < 5 || b.y > 95) b.vy *= -1;
      const gx = Math.floor((b.x / 100) * gridSize); const gy = Math.floor((b.y / 100) * gridSize);
      if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) grid[gy][gx] = id;
      frame.push({ id, x: b.x, y: b.y, r: b.r, alive: true, color: p.color, avatar: p.avatar });
    });
    frame.push({ id: "grid", extra: { grid, gridSize } });
    frames.push(frame);
  }
  const score = {}; ids.forEach((id) => (score[id] = 0));
  for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) { const owner = grid[y][x]; if (owner) score[owner]++; }
  let winnerId = ids[0], best = -1; ids.forEach((id) => { if (score[id] > best) { best = score[id]; winnerId = id; } });
  return { winnerId, frames };
}

function simulateBallRace(players, maxSteps = 250) {
  const frames = []; const ids = players.map((p) => p.id);
  const balls = {}; players.forEach((p, i) => { balls[p.id] = { x: 20 + (i * 60) / players.length, y: 5, vy: 0.6 + Math.random() * 0.4, r: 5 }; });
  const steps = maxSteps;
  for (let t = 0; t < steps; t++) {
    const frame = [];
    ids.forEach((id) => {
      const b = balls[id]; const p = players.find((x) => x.id === id);
      b.y += b.vy; if (b.y > 95) b.y = 95;
      frame.push({ id, x: b.x, y: b.y, r: b.r, alive: true, color: p.color, avatar: p.avatar });
    });
    frames.push(frame);
  }
  let winnerId = ids[0], bestY = -1; ids.forEach((id) => { if (balls[id].y > bestY) { bestY = balls[id].y; winnerId = id; } });
  return { winnerId, frames };
}

function simulateMeteorFall(players, maxSteps = 250) {
  const frames = []; const ids = players.map((p) => p.id);
  const balls = {}; players.forEach((p, i) => { balls[p.id] = { x: 20 + (i * 60) / players.length, y: 90, alive: true, r: 5 }; });
  const meteors = []; const steps = maxSteps;
  for (let t = 0; t < steps; t++) {
    if (Math.random() < 0.2) meteors.push({ x: 10 + Math.random() * 80, y: 0, vy: 1 + Math.random() * 1.5, r: 4 });
    meteors.forEach((m) => (m.y += m.vy));
    ids.forEach((id) => {
      const b = balls[id]; if (!b.alive) return;
      const dir = Math.random() < 0.5 ? -1 : 1; b.x += dir * 1.5; if (b.x < 5) b.x = 5; if (b.x > 95) b.x = 95;
      meteors.forEach((m) => { const dx = m.x - b.x, dy = m.y - b.y, dist = Math.sqrt(dx * dx + dy * dy); if (dist < m.r + b.r) b.alive = false; });
    });
    const frame = []; ids.forEach((id) => { const b = balls[id]; const p = players.find((x) => x.id === id); frame.push({ id, x: b.x, y: b.y, r: b.r, alive: b.alive, color: p.color, avatar: p.avatar }); });
    meteors.forEach((m, idx) => frame.push({ id: "meteor_" + idx, x: m.x, y: m.y, r: m.r, alive: true, color: "#ff4444" }));
    frames.push(frame);
    const aliveIds = ids.filter((id) => balls[id].alive); if (aliveIds.length <= 1) break;
  }
  const aliveIds = ids.filter((id) => balls[id].alive); const winnerId = aliveIds.length ? aliveIds[0] : ids[0];
  return { winnerId, frames };
}

// MIX now strictly uses only the five modes you specified
function simulateMix(players, bet) {
  const allowed = ["ice_arena", "vybivanie", "color_arena", "ball_race", "meteor_fall"];
  const first = allowed[Math.floor(Math.random() * allowed.length)];
  let second = allowed[Math.floor(Math.random() * allowed.length)];
  if (second === first) {
    const idx = (allowed.indexOf(first) + 1) % allowed.length;
    second = allowed[idx];
  }
  const halfSteps = 120;
  const a = simulateGameByName(first, players, bet, halfSteps);
  const b = simulateGameByName(second, players, bet, halfSteps);
  const frames = [...a.frames, ...b.frames];
  const winnerId = Math.random() < 0.5 ? a.winnerId : b.winnerId;
  return { winnerId, frames };
}

function simulateGameByName(name, players, bet, maxSteps) {
  if (name === "ice_arena") return simulateIceArena(players, bet, maxSteps);
  if (name === "vybivanie") return simulateVyBivanie(players, maxSteps);
  if (name === "color_arena") return simulateColorArena(players, maxSteps);
  if (name === "ball_race") return simulateBallRace(players, maxSteps);
  if (name === "meteor_fall") return simulateMeteorFall(players, maxSteps);
  return simulateBallRace(players, maxSteps);
}

function simulateGame(mode, players, bet) {
  if (mode === "ice_arena") return simulateIceArena(players, bet);
  if (mode === "vybivanie" || mode === "elimination") return simulateVyBivanie(players);
  if (mode === "color_arena") return simulateColorArena(players);
  if (mode === "ball_race") return simulateBallRace(players);
  if (mode === "meteor_fall") return simulateMeteorFall(players);
  if (mode === "mix") return simulateMix(players, bet);
  return simulateBallRace(players);
}

// Lobbies and rest of server unchanged...
const modes = ["ice_arena", "vybivanie", "color_arena", "ball_race", "meteor_fall", "mix"];
const lobbies = {};
modes.forEach((m) => { lobbies[m] = { mode: m, bet: null, players: [], status: "waiting", pregame: null }; });

const wsClients = new Set();

function buildLobbyPayload(lobby) {
  const payload = { type: "lobby_state", lobby: { mode: lobby.mode, bet: lobby.bet || 0, status: lobby.status, players: lobby.players.map((p) => ({ id: p.id, username: p.username, name: p.first_name || p.username, avatar: p.avatar, bet: p.bet })), preview: null, pregame: lobby.pregame || null } };
  if (lobby.status === "waiting" && lobby.players.length >= 1 && !["ball_race", "meteor_fall"].includes(lobby.mode)) {
    try {
      const simPlayers = lobby.players.map((p) => ({ id: p.id, db_id: p.db_id, username: p.username, avatar: p.avatar, bet: p.bet, color: p.color }));
      const sim = simulateGame(lobby.mode, simPlayers, lobby.bet);
      if (lobby.players.length === 1) payload.lobby.preview = [sim.frames[0] || []];
      else payload.lobby.preview = sim.frames.slice(0, PREVIEW_FRAMES);
    } catch (e) {
      payload.lobby.preview = null;
    }
  }
  return payload;
}

function broadcastLobbyState(mode) {
  const lobby = lobbies[mode];
  const payload = JSON.stringify(buildLobbyPayload(lobby));
  wsClients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(payload); });
  broadcastGlobalStats();
}

function broadcastGlobalStats() {
  const online = wsClients.size;
  let totalBank = 0;
  const modeCounts = {};
  modes.forEach((m) => {
    const l = lobbies[m];
    modeCounts[m] = l.players.length;
    if (l.bet && l.players.length > 0) totalBank += l.bet * l.players.length;
  });
  const payload = JSON.stringify({ type: "global_stats", online, totalBank, modeCounts });
  wsClients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(payload); });
}

async function startGameForLobby(mode) {
  const lobby = lobbies[mode];
  if (lobby.status !== "waiting") return;
  if (lobby.players.length < 2) return;

  lobby.status = "pregame";
  lobby.pregame = { seconds: PREGAME_SECONDS, startedAt: Date.now() };
  broadcastLobbyState(mode);

  const countdown = async () => {
    for (let s = PREGAME_SECONDS; s > 0; s--) {
      lobby.pregame.seconds = s;
      broadcastLobbyState(mode);
      await new Promise((r) => setTimeout(r, 1000));
    }
    lobby.pregame = null;
    lobby.status = "running";
    broadcastLobbyState(mode);

    for (const u of lobby.players) await changeStars(u.db_id, -lobby.bet);

    const playersForSim = lobby.players.map((p) => ({ id: p.id, db_id: p.db_id, username: p.username, first_name: p.first_name, avatar: p.avatar, bet: p.bet, color: p.color }));
    const sim = simulateGame(mode, playersForSim, lobby.bet);
    const winner = lobby.players.find((p) => p.id === sim.winnerId);
    const pot = lobby.bet * lobby.players.length;
    const payout = Math.floor(pot * (1 - COMMISSION));
    if (winner) await changeStars(winner.db_id, payout);

    const gameRow = await createGame(mode, lobby.bet, lobby.players.map((p) => ({ id: p.db_id, username: p.username, avatar: p.avatar })), winner ? winner.db_id : null, sim.frames);

    const payload = JSON.stringify({ type: "game_result", game: { id: gameRow.id, mode, bet: lobby.bet, winnerId: winner ? winner.db_id : null, players: lobby.players.map((p) => ({ id: p.db_id, username: p.username, avatar: p.avatar })), replay: sim.frames, payout, commission: Math.floor(pot * COMMISSION) } });

    wsClients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(payload); });

    lobby.players = [];
    lobby.status = "waiting";
    broadcastLobbyState(mode);
  };

  countdown();
}

// API endpoints and websocket handling remain the same as previous working version
app.post("/api/me", async (req, res) => {
  try {
    const init = req.body.initDataUnsafe;
    if (!init || !init.user) return res.json({ ok: false });
    let user = await getUserByTgId(init.user.id);
    if (!user) user = await createUserFromInit(init);
    else user = await updateUserFromInit(user.id, init);
    if (user.stars < 100) user = await changeStars(user.id, 100 - user.stars);
    res.json({ ok: true, user: { id: user.id, tg_id: user.tg_id, username: user.username, name: user.first_name || user.username, avatar: user.avatar, stars: user.stars } });
  } catch (e) { console.error(e); res.json({ ok: false, error: "server_error" }); }
});

app.get("/api/history", (req, res) => {
  const mode = req.query.mode; const filter = req.query.filter || "latest"; const userId = req.query.userId;
  let sql = `SELECT g.*, (SELECT json_group_array(json_object('id', gp.user_id, 'username', gp.username, 'avatar', gp.avatar)) FROM game_players gp WHERE gp.game_id = g.id) AS players_json FROM games g`;
  const params = [];
  if (filter === "mine" && userId) { sql += " JOIN game_players gp2 ON gp2.game_id = g.id WHERE gp2.user_id = ?"; params.push(userId); }
  else if (mode) { sql += " WHERE g.mode = ?"; params.push(mode); }
  sql += " ORDER BY g.id DESC LIMIT 50";
  db.all(sql, params, (err, rows) => {
    if (err) return res.json({ ok: false });
    const games = rows.map((r) => ({ id: r.id, mode: r.mode, bet: r.bet, winnerId: r.winner_id, createdAt: r.created_at, players: JSON.parse(r.players_json || "[]") }));
    res.json({ ok: true, games });
  });
});

app.get("/api/games/replay/:id", (req, res) => {
  const id = Number(req.params.id);
  db.get(`SELECT g.*, gr.replay_json, (SELECT json_group_array(json_object('id', gp.user_id, 'username', gp.username, 'avatar', gp.avatar)) FROM game_players gp WHERE gp.game_id = g.id) AS players_json FROM games g LEFT JOIN game_replays gr ON gr.game_id = g.id WHERE g.id = ?`, [id], (err, row) => {
    if (err || !row) return res.json({ ok: false });
    res.json({ ok: true, game: { id: row.id, mode: row.mode, bet: row.bet, winnerId: row.winner_id, createdAt: row.created_at, players: JSON.parse(row.players_json || "[]"), replay: row.replay_json ? JSON.parse(row.replay_json) : [] } });
  });
});

app.post("/api/admin/give-stars", (req, res) => {
  const { adminSecret, username, amount } = req.body;
  if (adminSecret !== ADMIN_SECRET) return res.json({ ok: false, error: "forbidden" });
  if (!username || !amount) return res.json({ ok: false, error: "bad_params" });
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, row) => {
    if (err || !row) return res.json({ ok: false, error: "user_not_found" });
    const updated = await changeStars(row.id, Number(amount));
    res.json({ ok: true, user: { id: updated.id, username: updated.username, stars: updated.stars } });
  });
});

app.post("/api/admin/broadcast", (req, res) => {
  const { adminSecret, text } = req.body;
  if (adminSecret !== ADMIN_SECRET) return res.json({ ok: false, error: "forbidden" });
  if (!text || !text.trim()) return res.json({ ok: false, error: "no_text" });
  db.all("SELECT tg_id FROM users", async (err, rows) => {
    if (err) return res.json({ ok: false, error: "db_error" });
    let sent = 0;
    for (const r of rows) {
      try {
        if (!BOT_TOKEN) {
          console.log("Broadcast (log) to", r.tg_id, ":", text);
          sent++;
        } else {
          await fetchFn(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: r.tg_id, text }),
          });
          sent++;
        }
      } catch (e) {
        console.error("broadcast error", e);
      }
    }
    res.json({ ok: true, sent });
  });
});

app.post("/api/admin/tournament", (req, res) => {
  const { adminSecret, modes: modesArr, bet, prizes } = req.body;
  if (adminSecret !== ADMIN_SECRET) return res.json({ ok: false, error: "forbidden" });
  const list = Array.isArray(modesArr) && modesArr.length ? modesArr : ["ice_arena"];
  const prizesArr = Array.isArray(prizes) ? prizes : (prizes ? [prizes] : []);
  const now = Date.now();
  db.run(`INSERT INTO tournaments (modes_json, bet, prizes_json, status, created_at) VALUES (?, ?, ?, ?, ?)`, [JSON.stringify(list), bet || 50, JSON.stringify(prizesArr), "waiting", now], function (err) {
    if (err) return res.json({ ok: false });
    res.json({ ok: true, tournament: { id: this.lastID, modes: list, bet: bet || 50, prizes: prizesArr, status: "waiting", createdAt: now } });
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  ws.user = null;
  wsClients.add(ws);

  ws.on("message", async (msg) => {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }

    if (data.type === "auth") {
      const init = data.initDataUnsafe;
      if (!init || !init.user) return;
      let user = await getUserByTgId(init.user.id);
      if (!user) user = await createUserFromInit(init);
      else user = await updateUserFromInit(user.id, init);
      ws.user = { tg_id: user.tg_id, db_id: user.id, username: user.username, first_name: user.first_name, avatar: user.avatar };
      modes.forEach((m) => broadcastLobbyState(m));
      return;
    }

    if (!ws.user) return;

    if (data.type === "join_lobby") {
      const mode = data.mode;
      let bet = Number(data.bet);
      if (!modes.includes(mode)) { ws.send(JSON.stringify({ type: "error", message: "Неверный режим" })); return; }
      if (mode === "meteor_fall") bet = 10;
      if (bet <= 0) { ws.send(JSON.stringify({ type: "error", message: "Неверная ставка" })); return; }
      const lobby = lobbies[mode];
      lobby.bet = bet;
      if (!lobby.players.find((p) => p.id === ws.user.tg_id)) {
        const colors = ["#4ade80", "#60a5fa", "#f97316", "#f472b6", "#a855f7"];
        const color = colors[Math.floor(Math.random() * colors.length)];
        lobby.players.push({ id: ws.user.tg_id, db_id: ws.user.db_id, username: ws.user.username, first_name: ws.user.first_name, avatar: ws.user.avatar, bet, color });
      }
      broadcastLobbyState(mode);
      if (lobby.players.length >= 2 && !["ball_race", "meteor_fall"].includes(mode)) startGameForLobby(mode);
      else if (["ball_race", "meteor_fall"].includes(mode) && lobby.players.length >= 2) startGameForLobby(mode);
    }
  });

  ws.on("close", () => { wsClients.delete(ws); });
});

server.listen(PORT, () => { console.log("Server started on", PORT); });








