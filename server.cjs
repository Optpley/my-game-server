// server.cjs — PART 1/2
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN";
const ADMIN_SECRET = "dev_secret";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(path.join(__dirname, "db.sqlite"));

// ===== DB INIT =====
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

// ===== HELPERS =====
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
          stmt.run(gameId, p.id, p.username || null, p.avatar || null);
        });
        stmt.finalize();

        db.run(
          `INSERT INTO game_replays (game_id, replay_json)
           VALUES (?, ?)`,
          [gameId, JSON.stringify(replay || [])],
          (e2) => {
            if (e2) return reject(e2);
            resolve({ id: gameId, mode, bet, winnerId, createdAt: now });
          }
        );
      }
    );
  });
}
// ===== SIMPLE GAME PHYSICS (REPLAY) =====

function simulateGame(mode, players, bet) {
  const frames = [];
  const ids = players.map((p) => p.id);
  const positions = {};

  ids.forEach((id, idx) => {
    positions[id] = {
      x: 10 + idx * 20,
      y: 10 + idx * 10,
      alive: true,
    };
  });

  const steps = 60;
  for (let t = 0; t < steps; t++) {
    const frame = [];
    ids.forEach((id) => {
      const p = positions[id];
      if (!p.alive) {
        frame.push({ id, x: p.x, y: p.y, alive: false });
        return;
      }

      let dx = (Math.random() - 0.5) * 8;
      let dy = (Math.random() - 0.5) * 8;

      if (mode === "ice_arena") {
        dx *= 0.7;
        dy *= 0.7;
      } else if (mode === "elimination") {
        dy += 1;
      } else if (mode === "color_arena") {
        dx *= 1.2;
        dy *= 1.2;
      } else if (mode === "ball_race") {
        dy += 2;
      }

      p.x = Math.max(0, Math.min(100, p.x + dx));
      p.y = Math.max(0, Math.min(100, p.y + dy));

      if (mode === "elimination" && p.y > 95 && Math.random() < 0.1) {
        p.alive = false;
      }

      frame.push({ id, x: p.x, y: p.y, alive: p.alive });
    });
    frames.push(frame);
  }

  let aliveIds = ids.filter((id) => positions[id].alive);
  if (aliveIds.length === 0) aliveIds = ids;
  const winnerId = aliveIds[Math.floor(Math.random() * aliveIds.length)];

  return { winnerId, frames };
}

// ===== LOBBIES =====

const modes = ["ice_arena", "elimination", "ball_race", "color_arena"];
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
        name: p.first_name || p.username || "Игрок",
        avatar: p.avatar,
      })),
    },
  });

  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.user) {
      client.send(payload);
    }
  });
}

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

  const sim = simulateGame(mode, players, lobby.bet);
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

  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.user) {
      const inGame = players.some((p) => p.id === client.user.tg_id);
      if (inGame) client.send(payload);
    }
  });

  lobby.players = [];
  lobby.status = "waiting";
  broadcastLobbyState(mode);
}

// ===== API =====

// /api/me
app.post("/api/me", async (req, res) => {
  try {
    const init = req.body.initDataUnsafe;
    if (!init || !init.user || !init.user.id) {
      return res.json({ ok: false, error: "no_user" });
    }
    let user = await getUserByTgId(init.user.id);
    if (!user) {
      user = await createUserFromInit(init);
    } else {
      user = await updateUserFromInit(user.id, init);
      if (user.stars < 100) {
        user = await changeStars(user.id, 100 - user.stars);
      }
    }
    res.json({
      ok: true,
      user: {
        id: user.id,
        tg_id: user.tg_id,
        username: user.username,
        name: user.first_name || user.username || "Игрок",
        avatar: user.avatar,
        stars: user.stars,
      },
    });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: "server_error" });
  }
});

// История
app.get("/api/history", async (req, res) => {
  try {
    const mode = req.query.mode || null;
    const filter = req.query.filter || "latest";
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const games = await getGameHistory({ mode, filter, userId });
    res.json({ ok: true, games });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: "server_error" });
  }
});

// Реплей
app.get("/api/games/replay/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const game = await getGameReplay(id);
    if (!game) return res.json({ ok: false, error: "not_found" });
    res.json({ ok: true, game });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: "server_error" });
  }
});

// Админ — звёзды
app.post("/api/admin/give-stars", (req, res) => {
  const { adminSecret, username, amount } = req.body;
  if (adminSecret !== ADMIN_SECRET) {
    return res.json({ ok: false, error: "forbidden" });
  }
  if (!username || !amount) {
    return res.json({ ok: false, error: "bad_params" });
  }

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, row) => {
      if (err) return res.json({ ok: false, error: "db_error" });
      if (!row) return res.json({ ok: false, error: "user_not_found" });

      try {
        const updated = await changeStars(row.id, Number(amount));
        res.json({
          ok: true,
          user: {
            id: updated.id,
            username: updated.username,
            stars: updated.stars,
          },
        });
      } catch (e) {
        res.json({ ok: false, error: "server_error" });
      }
    }
  );
});

// Админ — рассылка
app.post("/api/admin/broadcast", (req, res) => {
  const { adminSecret, text } = req.body;
  if (adminSecret !== ADMIN_SECRET) {
    return res.json({ ok: false, error: "forbidden" });
  }
  if (!text) return res.json({ ok: false, error: "no_text" });

  db.all("SELECT tg_id FROM users", async (err, rows) => {
    if (err) return res.json({ ok: false, error: "db_error" });

    let sent = 0;
    for (const r of rows) {
      try {
        if (!BOT_TOKEN || BOT_TOKEN === "YOUR_BOT_TOKEN") {
          console.log("Broadcast to", r.tg_id, ":", text);
          sent++;
        } else {
          await fetch(
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

// ===== TOURNAMENTS =====

let currentTournament = null;

app.get("/api/tournament", (req, res) => {
  res.json({ ok: true, tournament: currentTournament });
});

app.post("/api/admin/tournament", (req, res) => {
  const { adminSecret, mode, bet, prize } = req.body;
  if (adminSecret !== ADMIN_SECRET) {
    return res.json({ ok: false, error: "forbidden" });
  }
  currentTournament = {
    id: Date.now(),
    mode: mode || "ice_arena",
    bet: bet || 50,
    prize: prize || 1000,
    status: "waiting",
  };
  res.json({ ok: true, tournament: currentTournament });
});

// ===== WS =====

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
      if (!init || !init.user || !init.user.id) return;

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
      const bet = Number(data.bet || 0);
      if (!modes.includes(mode) || bet <= 0) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Неверный режим или ставка",
          })
        );
        return;
      }

      const lobby = lobbies[mode];
      lobby.bet = bet;

      if (!lobby.players.find((p) => p.tg_id === ws.user.tg_id)) {
        lobby.players.push({
          id: ws.user.tg_id,
          db_id: ws.user.db_id,
          username: ws.user.username,
          first_name: ws.user.first_name,
          avatar: ws.user.avatar,
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

server.listen(PORT, () => {
  console.log("Server started on", PORT);
});







