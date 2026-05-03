// ======================= IMPORTS =======================
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// Node 18+ имеет встроенный fetch
const fetchFn = (...args) => fetch(...args);

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN";
const ADMIN_SECRET = "dev_secret";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(path.join(__dirname, "db.sqlite"));


// ======================= DB INIT =======================
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      tg_id INTEGER UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      avatar TEXT,
      stars INTEGER DEFAULT 100
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      bet INTEGER,
      winner_id INTEGER,
      created_at INTEGER
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS game_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER,
      user_id INTEGER,
      username TEXT,
      avatar TEXT
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS game_replays (
      game_id INTEGER PRIMARY KEY,
      replay_json TEXT
    )`
  );
});


// ======================= HELPERS =======================
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
      [
        u.id,
        u.username || null,
        u.first_name || null,
        u.last_name || null,
        u.photo_url || null,
      ],
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
      `UPDATE users
       SET username = ?, first_name = ?, last_name = ?, avatar = ?
       WHERE id = ?`,
      [u.username, u.first_name, u.last_name, u.photo_url, userId],
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
    db.run(
      `UPDATE users SET stars = stars + ? WHERE id = ?`,
      [delta, userId],
      function (err) {
        if (err) return reject(err);
        db.get("SELECT * FROM users WHERE id = ?", [userId], (e, row) => {
          if (e) return reject(e);
          resolve(row);
        });
      }
    );
  });
}

function createGame(mode, bet, players, winnerId, replay) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(
      `INSERT INTO games (mode, bet, winner_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [mode, bet, winnerId, now],
      function (err) {
        if (err) return reject(err);
        const gameId = this.lastID;

        const stmt = db.prepare(
          `INSERT INTO game_players (game_id, user_id, username, avatar)
           VALUES (?, ?, ?, ?)`
        );
        players.forEach((p) => {
          stmt.run(gameId, p.id, p.username, p.avatar);
        });
        stmt.finalize();

        db.run(
          `INSERT INTO game_replays (game_id, replay_json)
           VALUES (?, ?)`,
          [gameId, JSON.stringify(replay)],
          (e2) => {
            if (e2) return reject(e2);
            resolve({ id: gameId, mode, bet, winnerId, createdAt: now });
          }
        );
      }
    );
  });
}


// ======================= GAME SIMULATION =======================
//
// Все игры возвращают кадры формата:
// frame: [{ id, x, y, r, alive, color, avatar, extra }]
//

function simulateIceArena(players, bet) {
  const frames = [];
  const ids = players.map((p) => p.id);

  // Территория пропорциональна ставке: делим круг на секторы
  const totalBet = players.reduce((s, p) => s + p.bet, 0) || 1;
  let startAngle = 0;
  const sectors = {};

  players.forEach((p) => {
    const portion = p.bet / totalBet;
    const angle = portion * Math.PI * 2;
    sectors[p.id] = { start: startAngle, end: startAngle + angle };
    startAngle += angle;
  });

  // Шайба
  let puck = {
    x: 50,
    y: 50,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
  };

  const steps = 200;
  for (let t = 0; t < steps; t++) {
    // Двигаем шайбу
    puck.x += puck.vx * 2;
    puck.y += puck.vy * 2;

    if (puck.x < 5 || puck.x > 95) puck.vx *= -1;
    if (puck.y < 5 || puck.y > 95) puck.vy *= -1;

    // Позиции игроков — просто для визуала (по кругу)
    const frame = [];
    players.forEach((p, idx) => {
      const angleMid =
        (sectors[p.id].start + sectors[p.id].end) / 2;
      const px = 50 + Math.cos(angleMid) * 35;
      const py = 50 + Math.sin(angleMid) * 35;

      frame.push({
        id: p.id,
        x: px,
        y: py,
        r: 8,
        alive: true,
        color: p.color,
        avatar: p.avatar,
        extra: { sector: sectors[p.id] },
      });
    });

    frame.push({
      id: "puck",
      x: puck.x,
      y: puck.y,
      r: 4,
      alive: true,
      color: "#ffffff",
      avatar: null,
      extra: { type: "puck" },
    });

    frames.push(frame);
  }

  // Определяем победителя по углу шайбы
  const dx = puck.x - 50;
  const dy = puck.y - 50;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;

  let winnerId = players[0].id;
  for (const p of players) {
    const s = sectors[p.id];
    if (angle >= s.start && angle <= s.end) {
      winnerId = p.id;
      break;
    }
  }

  return { winnerId, frames };
}

function simulateElimination(players) {
  const frames = [];
  const ids = players.map((p) => p.id);

  const balls = {};
  const totalBet = players.reduce((s, p) => s + p.bet, 0) || 1;

  players.forEach((p, i) => {
    const sizeFactor = 0.5 + p.bet / totalBet * 1.5; // больше ставка — больше мяч
    const speedFactor = 1.5 - Math.min(1.2, p.bet / totalBet * 1.2); // больше ставка — медленнее
    balls[p.id] = {
      x: 20 + i * (60 / players.length),
      y: 50,
      vx: (Math.random() - 0.5) * speedFactor,
      vy: (Math.random() - 0.5) * speedFactor,
      r: 6 * sizeFactor,
      alive: true,
    };
  });

  const steps = 300;
  for (let t = 0; t < steps; t++) {
    const frame = [];

    ids.forEach((id) => {
      const b = balls[id];
      if (!b.alive) {
        frame.push({
          id,
          x: b.x,
          y: b.y,
          r: b.r,
          alive: false,
          color: b.color,
          avatar: b.avatar,
        });
        return;
      }

      b.x += b.vx;
      b.y += b.vy;

      // Убрана часть стен: сверху и снизу можно вылететь
      if (b.x < 5 || b.x > 95) b.vx *= -1;
      if (b.y < 0 || b.y > 100) {
        b.alive = false;
      }

      frame.push({
        id,
        x: b.x,
        y: b.y,
        r: b.r,
        alive: b.alive,
        color: players.find((p) => p.id === id).color,
        avatar: players.find((p) => p.id === id).avatar,
      });
    });

    frames.push(frame);

    const aliveIds = ids.filter((id) => balls[id].alive);
    if (aliveIds.length <= 1) break;
  }

  const aliveIds = ids.filter((id) => balls[id].alive);
  const winnerId = aliveIds.length ? aliveIds[0] : ids[0];

  return { winnerId, frames };
}

function simulateColorArena(players) {
  const frames = [];
  const ids = players.map((p) => p.id);

  const balls = {};
  const gridSize = 20;
  const grid = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => null)
  );

  players.forEach((p, i) => {
    balls[p.id] = {
      x: 20 + i * (60 / players.length),
      y: 50,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      r: 5,
    };
  });

  const steps = 250;
  for (let t = 0; t < steps; t++) {
    const frame = [];

    ids.forEach((id) => {
      const b = balls[id];

      b.x += b.vx;
      b.y += b.vy;

      if (b.x < 5 || b.x > 95) b.vx *= -1;
      if (b.y < 5 || b.y > 95) b.vy *= -1;

      // Красим клетку
      const gx = Math.floor((b.x / 100) * gridSize);
      const gy = Math.floor((b.y / 100) * gridSize);
      if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
        grid[gy][gx] = id;
      }

      frame.push({
        id,
        x: b.x,
        y: b.y,
        r: b.r,
        alive: true,
        color: players.find((p) => p.id === id).color,
        avatar: players.find((p) => p.id === id).avatar,
      });
    });

    // Для фронта можно передавать карту
    frame.push({
      id: "grid",
      x: 0,
      y: 0,
      r: 0,
      alive: true,
      color: "#000000",
      avatar: null,
      extra: { grid, gridSize },
    });

    frames.push(frame);
  }

  // Подсчёт площади
  const score = {};
  ids.forEach((id) => (score[id] = 0));
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const owner = grid[y][x];
      if (owner) score[owner]++;
    }
  }

  let winnerId = ids[0];
  let best = -1;
  ids.forEach((id) => {
    if (score[id] > best) {
      best = score[id];
      winnerId = id;
    }
  });

  return { winnerId, frames };
}

function simulateBallRace(players) {
  const frames = [];
  const ids = players.map((p) => p.id);

  const balls = {};
  players.forEach((p, i) => {
    balls[p.id] = {
      x: 20 + i * (60 / players.length),
      y: 5,
      vy: 0.5 + Math.random() * 0.5,
      r: 5,
    };
  });

  const steps = 250;
  for (let t = 0; t < steps; t++) {
    const frame = [];

    ids.forEach((id) => {
      const b = balls[id];

      b.y += b.vy;
      if (b.y > 95) b.y = 95;

      frame.push({
        id,
        x: b.x,
        y: b.y,
        r: b.r,
        alive: true,
        color: players.find((p) => p.id === id).color,
        avatar: players.find((p) => p.id === id).avatar,
      });
    });

    frames.push(frame);
  }

  let winnerId = ids[0];
  let bestY = -1;
  ids.forEach((id) => {
    if (balls[id].y > bestY) {
      bestY = balls[id].y;
      winnerId = id;
    }
  });

  return { winnerId, frames };
}

function simulateMeteorFall(players) {
  const frames = [];
  const ids = players.map((p) => p.id);

  const balls = {};
  players.forEach((p, i) => {
    balls[p.id] = {
      x: 20 + i * (60 / players.length),
      y: 90,
      alive: true,
      r: 5,
    };
  });

  const meteors = [];

  const steps = 250;
  for (let t = 0; t < steps; t++) {
    if (Math.random() < 0.2) {
      meteors.push({
        x: 10 + Math.random() * 80,
        y: 0,
        vy: 1 + Math.random() * 1.5,
        r: 4,
      });
    }

    meteors.forEach((m) => {
      m.y += m.vy;
    });

    ids.forEach((id) => {
      const b = balls[id];
      if (!b.alive) return;

      // простое уклонение: случайный шаг влево/вправо
      const dir = Math.random() < 0.5 ? -1 : 1;
      b.x += dir * 1.5;
      if (b.x < 5) b.x = 5;
      if (b.x > 95) b.x = 95;

      // проверка столкновений
      meteors.forEach((m) => {
        const dx = m.x - b.x;
        const dy = m.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < m.r + b.r) {
          b.alive = false;
        }
      });
    });

    const frame = [];

    ids.forEach((id) => {
      const b = balls[id];
      frame.push({
        id,
        x: b.x,
        y: b.y,
        r: b.r,
        alive: b.alive,
        color: players.find((p) => p.id === id).color,
        avatar: players.find((p) => p.id === id).avatar,
      });
    });

    meteors.forEach((m, idx) => {
      frame.push({
        id: "meteor_" + idx,
        x: m.x,
        y: m.y,
        r: m.r,
        alive: true,
        color: "#ff4444",
        avatar: null,
        extra: { type: "meteor" },
      });
    });

    frames.push(frame);

    const aliveIds = ids.filter((id) => balls[id].alive);
    if (aliveIds.length <= 1) break;
  }

  const aliveIds = ids.filter((id) => balls[id].alive);
  const winnerId = aliveIds.length ? aliveIds[0] : ids[0];

  return { winnerId, frames };
}

function simulateGame(mode, players, bet) {
  // players: [{ id: tg_id, db_id, username, first_name, avatar, bet, color }]
  if (mode === "ice_arena") return simulateIceArena(players, bet);
  if (mode === "elimination") return simulateElimination(players);
  if (mode === "color_arena") return simulateColorArena(players);
  if (mode === "ball_race") return simulateBallRace(players);
  if (mode === "meteor_fall") return simulateMeteorFall(players);

  // fallback
  return simulateBallRace(players);
}


// ======================= LOBBIES =======================
const modes = ["ice_arena", "elimination", "ball_race", "color_arena", "meteor_fall"];
const lobbies = {};

modes.forEach((m) => {
  lobbies[m] = {
    mode: m,
    bet: null,
    players: [],
    status: "waiting",
  };
});

const wsClients = new Set();

function broadcastLobbyState(mode) {
  const lobby = lobbies[mode];
  const payload = JSON.stringify({
    type: "lobby_state",
    lobby: {
      mode: lobby.mode,
      bet: lobby.bet || 0,
      status: lobby.status,
      players: lobby.players.map((p) => ({
        id: p.id,
        username: p.username,
        name: p.first_name || p.username,
        avatar: p.avatar,
        bet: p.bet,
      })),
    },
  });

  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

function broadcastGlobalStats() {
  const online = wsClients.size;

  let totalBank = 0;
  for (const m of modes) {
    const lobby = lobbies[m];
    if (lobby.bet && lobby.players.length > 0) {
      totalBank += lobby.bet * lobby.players.length;
    }
  }

  const payload = JSON.stringify({
    type: "global_stats",
    online,
    totalBank,
  });

  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

setInterval(broadcastGlobalStats, 1000);

async function startGameForLobby(mode) {
  const lobby = lobbies[mode];
  if (lobby.status !== "waiting") return;
  if (lobby.players.length < 2) return;

  lobby.status = "running";
  broadcastLobbyState(mode);

  const players = lobby.players;

  for (const u of players) {
    await changeStars(u.db_id, -lobby.bet);
  }

  const sim = simulateGame(
    mode,
    players.map((p) => ({
      id: p.id,
      db_id: p.db_id,
      username: p.username,
      first_name: p.first_name,
      avatar: p.avatar,
      bet: p.bet,
      color: p.color,
    })),
    lobby.bet
  );

  const winner = players.find((p) => p.id === sim.winnerId);

  if (winner) {
    const pot = lobby.bet * players.length;
    await changeStars(winner.db_id, pot);
  }

  const gameRow = await createGame(
    mode,
    lobby.bet,
    players.map((p) => ({
      id: p.db_id,
      username: p.username,
      avatar: p.avatar,
    })),
    winner ? winner.db_id : null,
    sim.frames
  );

  const payload = JSON.stringify({
    type: "game_result",
    game: {
      id: gameRow.id,
      mode,
      bet: lobby.bet,
      winnerId: winner ? winner.db_id : null,
      players: players.map((p) => ({
        id: p.db_id,
        username: p.username,
        avatar: p.avatar,
      })),
      replay: sim.frames,
    },
  });

  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });

  lobby.players = [];
  lobby.status = "waiting";
  broadcastLobbyState(mode);
}


// ======================= API =======================

// /api/me
app.post("/api/me", async (req, res) => {
  try {
    const init = req.body.initDataUnsafe;
    if (!init || !init.user) return res.json({ ok: false });

    let user = await getUserByTgId(init.user.id);
    if (!user) user = await createUserFromInit(init);
    else user = await updateUserFromInit(user.id, init);

    if (user.stars < 100) user = await changeStars(user.id, 100 - user.stars);

    res.json({
      ok: true,
      user: {
        id: user.id,
        tg_id: user.tg_id,
        username: user.username,
        name: user.first_name || user.username,
        avatar: user.avatar,
        stars: user.stars,
      },
    });
  } catch {
    res.json({ ok: false });
  }
});

// История
app.get("/api/history", (req, res) => {
  const mode = req.query.mode;
  const filter = req.query.filter || "latest";
  const userId = req.query.userId;

  let sql = `
    SELECT g.*, 
      (SELECT json_group_array(json_object(
        'id', gp.user_id,
        'username', gp.username,
        'avatar', gp.avatar
      )) FROM game_players gp WHERE gp.game_id = g.id) AS players_json
    FROM games g
  `;

  const params = [];

  if (filter === "mine" && userId) {
    sql += " JOIN game_players gp2 ON gp2.game_id = g.id WHERE gp2.user_id = ?";
    params.push(userId);
  } else if (mode) {
    sql += " WHERE g.mode = ?";
    params.push(mode);
  }

  sql += " ORDER BY g.id DESC LIMIT 50";

  db.all(sql, params, (err, rows) => {
    if (err) return res.json({ ok: false });

    const games = rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      bet: r.bet,
      winnerId: r.winner_id,
      createdAt: r.created_at,
      players: JSON.parse(r.players_json || "[]"),
    }));

    res.json({ ok: true, games });
  });
});

// Реплей
app.get("/api/games/replay/:id", (req, res) => {
  const id = Number(req.params.id);

  db.get(
    `
    SELECT g.*, gr.replay_json,
      (SELECT json_group_array(json_object(
        'id', gp.user_id,
        'username', gp.username,
        'avatar', gp.avatar
      )) FROM game_players gp WHERE gp.game_id = g.id) AS players_json
    FROM games g
    LEFT JOIN game_replays gr ON gr.game_id = g.id
    WHERE g.id = ?
  `,
    [id],
    (err, row) => {
      if (err || !row) return res.json({ ok: false });

      res.json({
        ok: true,
        game: {
          id: row.id,
          mode: row.mode,
          bet: row.bet,
          winnerId: row.winner_id,
          createdAt: row.created_at,
          players: JSON.parse(row.players_json || "[]"),
          replay: row.replay_json ? JSON.parse(row.replay_json) : [],
        },
      });
    }
  );
});

// Админ — звёзды
app.post("/api/admin/give-stars", (req, res) => {
  const { adminSecret, username, amount } = req.body;

  if (adminSecret !== ADMIN_SECRET)
    return res.json({ ok: false, error: "forbidden" });

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, row) => {
      if (err || !row) return res.json({ ok: false, error: "user_not_found" });

      const updated = await changeStars(row.id, Number(amount));

      res.json({
        ok: true,
        user: {
          id: updated.id,
          username: updated.username,
          stars: updated.stars,
        },
      });
    }
  );
});

// Админ — рассылка
app.post("/api/admin/broadcast", (req, res) => {
  const { adminSecret, text } = req.body;

  if (adminSecret !== ADMIN_SECRET)
    return res.json({ ok: false, error: "forbidden" });

  if (!text || !text.trim())
    return res.json({ ok: false, error: "no_text" });

  db.all("SELECT tg_id FROM users", async (err, rows) => {
    if (err) return res.json({ ok: false });

    let sent = 0;

    for (const r of rows) {
      try {
        if (!BOT_TOKEN || BOT_TOKEN === "YOUR_BOT_TOKEN") {
          console.log("Broadcast to", r.tg_id, ":", text);
          sent++;
        } else {
          await fetchFn(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: r.tg_id,
                text,
              }),
            }
          );
          sent++;
        }
      } catch {}
    }

    res.json({ ok: true, sent });
  });
});


// ======================= TOURNAMENTS =======================
let currentTournament = null;

app.get("/api/tournament", (req, res) => {
  res.json({ ok: true, tournament: currentTournament });
});

app.post("/api/admin/tournament", (req, res) => {
  const { adminSecret, mode, bet, prize } = req.body;

  if (adminSecret !== ADMIN_SECRET)
    return res.json({ ok: false, error: "forbidden" });

  currentTournament = {
    id: Date.now(),
    mode: mode || "ice_arena",
    bet: bet || 50,
    prize: prize || 1000,
    status: "waiting",
  };

  res.json({ ok: true, tournament: currentTournament });
});


// ======================= WEBSOCKET =======================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  ws.user = null;
  wsClients.add(ws);

  ws.on("message", async (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (data.type === "auth") {
      const init = data.initDataUnsafe;
      if (!init || !init.user) return;

      let user = await getUserByTgId(init.user.id);
      if (!user) user = await createUserFromInit(init);
      else user = await updateUserFromInit(user.id, init);

      ws.user = {
        tg_id: user.tg_id,
        db_id: user.id,
        username: user.username,
        first_name: user.first_name,
        avatar: user.avatar,
      };

      modes.forEach((m) => broadcastLobbyState(m));
      return;
    }

    if (!ws.user) return;

    if (data.type === "join_lobby") {
      const mode = data.mode;
      const bet = Number(data.bet);

      if (!modes.includes(mode) || bet <= 0) {
        ws.send(JSON.stringify({ type: "error", message: "Неверная ставка" }));
        return;
      }

      const lobby = lobbies[mode];
      lobby.bet = bet;

      if (!lobby.players.find((p) => p.id === ws.user.tg_id)) {
        // цвет просто для визуала, фронт может игнорить
        const colors = ["#4ade80", "#60a5fa", "#f97316", "#f472b6", "#a855f7"];
        const color =
          colors[Math.floor(Math.random() * colors.length)];

        lobby.players.push({
          id: ws.user.tg_id,
          db_id: ws.user.db_id,
          username: ws.user.username,
          first_name: ws.user.first_name,
          avatar: ws.user.avatar,
          bet,
          color,
        });
      }

      broadcastLobbyState(mode);

      if (lobby.players.length >= 2) {
        startGameForLobby(mode);
      }
    }
  });

  ws.on("close", () => {
    wsClients.delete(ws);
  });
});


// ======================= START =======================
server.listen(PORT, () => {
  console.log("Server started on", PORT);
});









