// server.cjs
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ ТВОЙ АДМИН ID
const ADMIN_TELEGRAM_ID = 6572232237;

// === DB ===
const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT,
      avatar_url TEXT,
      stars_balance INTEGER DEFAULT 0,
      referrer_id INTEGER,
      ref_count INTEGER DEFAULT 0,
      ref_earned_stars INTEGER DEFAULT 0,
      ref_earned_percent INTEGER DEFAULT 0,
      ref_pending_stars INTEGER DEFAULT 0,
      ref_pending_percent INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      bank INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      winner_telegram_id INTEGER,
      winner_username TEXT,
      replay_json TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      modes TEXT,
      prizes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS special_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      description TEXT,
      target_game_id INTEGER,
      duration_seconds INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dummy INTEGER DEFAULT 0
    )
  `);

  db.run(`INSERT OR IGNORE INTO settings (id, dummy) VALUES (1, 0)`);

  db.run("ALTER TABLE games ADD COLUMN winner_telegram_id INTEGER", () => {});
  db.run("ALTER TABLE games ADD COLUMN winner_username TEXT", () => {});
  db.run("ALTER TABLE games ADD COLUMN replay_json TEXT", () => {});
  db.run(
    "ALTER TABLE special_games ADD COLUMN target_game_id INTEGER",
    () => {}
  );
  db.run(
    "ALTER TABLE special_games ADD COLUMN duration_seconds INTEGER",
    () => {}
  );
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== helpers =====

function getUserByTelegramId(telegram_id) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM users WHERE telegram_id = ?",
      [telegram_id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM users WHERE username = ?",
      [username],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

function createUser(telegram_id, username, avatar_url, referrerTelegramId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO users (telegram_id, username, avatar_url) VALUES (?, ?, ?)",
      [telegram_id, username, avatar_url],
      function (err) {
        if (err) return reject(err);
        const newId = this.lastID;

        if (referrerTelegramId && referrerTelegramId !== telegram_id) {
          db.get(
            "SELECT * FROM users WHERE telegram_id = ?",
            [referrerTelegramId],
            (e2, refRow) => {
              if (!e2 && refRow) {
                db.run(
                  `
                  UPDATE users
                  SET ref_count = ref_count + 1,
                      ref_earned_stars = ref_earned_stars + 10,
                      ref_pending_stars = ref_pending_stars + 10
                  WHERE telegram_id = ?
                `,
                  [referrerTelegramId]
                );
                db.run(
                  "UPDATE users SET referrer_id = ? WHERE id = ?",
                  [refRow.id, newId]
                );
              }
            }
          );
        }

        db.get(
          "SELECT * FROM users WHERE id = ?",
          [newId],
          (err2, row2) => {
            if (err2) return reject(err2);
            resolve(row2);
          }
        );
      }
    );
  });
}

function updateUserBalance(telegram_id, delta) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET stars_balance = stars_balance + ? WHERE telegram_id = ?",
      [delta, telegram_id],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function isAdmin(telegram_id) {
  return telegram_id === ADMIN_TELEGRAM_ID;
}

// ===== in-memory игры / лобби =====

const activeGames = new Map(); // gameId -> { id, mode, bank, status, players, timer }

function findOrCreateGameForMode(mode) {
  for (const g of activeGames.values()) {
    if (g.mode === mode && g.status === "waiting") {
      return g;
    }
  }

  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO games (mode, bank, status) VALUES (?, ?, 'waiting')",
      [mode, 0],
      function (err) {
        if (err) return reject(err);
        const game = {
          id: this.lastID,
          mode,
          bank: 0,
          status: "waiting",
          players: [],
          timer: null
        };
        activeGames.set(game.id, game);
        resolve(game);
      }
    );
  });
}

async function startGameIfReady(gameId) {
  const game = activeGames.get(gameId);
  if (!game) return;
  if (game.status !== "waiting") return;
  if (!game.players || game.players.length < 2) return;

  game.status = "playing";

  db.run("UPDATE games SET status = 'playing' WHERE id = ?", [gameId]);

  broadcastToGame(gameId, {
    type: "game_start",
    game_id: gameId,
    mode: game.mode,
    bank: game.bank,
    players: game.players
  });

  setTimeout(() => finishGame(gameId), 3000);
}

// ===== REPLAY BUILDERS =====

function buildIceArenaReplay(game, winnerIndex) {
  const steps = [];
  const playersCount = game.players.length;
  if (playersCount === 0) return steps;

  const totalSteps = 30;
  let currentIndex = Math.floor(Math.random() * playersCount);

  for (let i = 0; i < totalSteps - 1; i++) {
    const delta = Math.floor(Math.random() * 3) - 1;
    currentIndex = (currentIndex + delta + playersCount) % playersCount;
    steps.push({ playerIndex: currentIndex });
  }

  steps.push({ playerIndex: winnerIndex, isWinner: true });
  return steps;
}

function buildRaceBallsReplay(game, winnerIndex) {
  const steps = [];
  const playersCount = game.players.length;
  if (playersCount === 0) return steps;

  const totalFrames = 40;
  const finishX = 1.0;

  const speeds = game.players.map(() => 0.015 + Math.random() * 0.02);
  const positions = game.players.map(() => 0);

  for (let f = 0; f < totalFrames; f++) {
    for (let i = 0; i < playersCount; i++) {
      positions[i] += speeds[i];
      if (positions[i] > finishX) positions[i] = finishX;
    }
    steps.push({
      frame: f,
      positions: [...positions],
      winnerIndex: null
    });
  }

  steps.push({
    frame: totalFrames,
    positions: positions.map((_, i) => (i === winnerIndex ? finishX : positions[i])),
    winnerIndex
  });

  return steps;
}

function buildKnockoutReplay(game, winnerIndex) {
  const steps = [];
  const playersCount = game.players.length;
  if (playersCount === 0) return steps;

  const alive = new Array(playersCount).fill(true);
  let remaining = playersCount;

  while (remaining > 1) {
    let idx;
    do {
      idx = Math.floor(Math.random() * playersCount);
    } while (!alive[idx] || idx === winnerIndex);

    alive[idx] = false;
    remaining--;

    steps.push({
      eliminatedIndex: idx,
      alive: [...alive]
    });
  }

  steps.push({
    winnerIndex,
    alive: alive.map((_, i) => i === winnerIndex)
  });

  return steps;
}

function buildColorArenaReplay(game, winnerIndex) {
  const steps = [];
  const playersCount = game.players.length;
  if (playersCount === 0) return steps;

  const gridSize = 8;
  const grid = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(-1)
  );

  const totalSteps = 40;

  for (let s = 0; s < totalSteps; s++) {
    const playerIndex = Math.floor(Math.random() * playersCount);
    const x = Math.floor(Math.random() * gridSize);
    const y = Math.floor(Math.random() * gridSize);
    grid[y][x] = playerIndex;

    steps.push({
      step: s,
      x,
      y,
      playerIndex
    });
  }

  steps.push({
    winnerIndex,
    finalGrid: grid
  });

  return steps;
}

function buildMeteorReplay(game, winnerIndex) {
  const steps = [];
  const playersCount = game.players.length;
  if (playersCount === 0) return steps;

  const totalFrames = 40;
  const alive = new Array(playersCount).fill(true);

  for (let f = 0; f < totalFrames; f++) {
    const meteorX = Math.random();
    const meteorY = f / totalFrames;

    let hitIndex = null;
    if (Math.random() < 0.2) {
      const candidates = [];
      for (let i = 0; i < playersCount; i++) {
        if (alive[i] && i !== winnerIndex) candidates.push(i);
      }
      if (candidates.length > 0) {
        hitIndex =
          candidates[Math.floor(Math.random() * candidates.length)];
        alive[hitIndex] = false;
      }
    }

    steps.push({
      frame: f,
      meteorX,
      meteorY,
      hitIndex,
      alive: [...alive]
    });
  }

  steps.push({
    winnerIndex,
    alive: alive.map((_, i) => i === winnerIndex)
  });

  return steps;
}

function buildReplayForMode(game, winnerIndex) {
  switch (game.mode) {
    case "ice_arena":
      return buildIceArenaReplay(game, winnerIndex);
    case "race_balls":
      return buildRaceBallsReplay(game, winnerIndex);
    case "knockout":
      return buildKnockoutReplay(game, winnerIndex);
    case "color_arena":
      return buildColorArenaReplay(game, winnerIndex);
    case "meteor_fall":
      return buildMeteorReplay(game, winnerIndex);
    default:
      return null;
  }
}

async function finishGame(gameId) {
  const game = activeGames.get(gameId);
  if (!game) return;
  if (game.status !== "playing") return;

  game.status = "finished";

  if (!game.players || game.players.length === 0) {
    db.run("UPDATE games SET status = 'finished' WHERE id = ?", [gameId]);
    return;
  }

  // шанс победы ∝ ставке
  let totalBet = 0;
  for (const p of game.players) totalBet += p.bet || 0;
  if (totalBet <= 0) totalBet = game.players.length;

  let r = Math.random() * totalBet;
  let winnerIndex = 0;
  for (let i = 0; i < game.players.length; i++) {
    const b = game.players[i].bet || 1;
    if (r < b) {
      winnerIndex = i;
      break;
    }
    r -= b;
  }

  const winner = game.players[winnerIndex];

  await updateUserBalance(winner.telegram_id, game.bank);

  const replay = buildReplayForMode(game, winnerIndex);
  const replayJson = replay ? JSON.stringify(replay) : null;

  db.run(
    "UPDATE games SET status = 'finished', winner_telegram_id = ?, winner_username = ?, replay_json = ?, bank = ? WHERE id = ?",
    [winner.telegram_id, winner.username, replayJson, game.bank, gameId]
  );

  broadcastToGame(gameId, {
    type: "game_result",
    game_id: gameId,
    mode: game.mode,
    bank: game.bank,
    winner_telegram_id: winner.telegram_id,
    winner_username: winner.username,
    replay: replay || null,
    players: game.players
  });

  setTimeout(() => {
    activeGames.delete(gameId);
  }, 10000);
}

// ===== API =====

app.post("/api/me", async (req, res) => {
  try {
    const { telegram_id, username, start_param, avatar_url } = req.body;

    if (!telegram_id) {
      return res.json({ ok: false, error: "NO_TELEGRAM_ID" });
    }

    let user = await getUserByTelegramId(telegram_id);

    let referrerTelegramId = null;
    if (start_param && typeof start_param === "string") {
      if (start_param.startsWith("ref_")) {
        const idStr = start_param.slice(4);
        const parsed = parseInt(idStr, 10);
        if (!isNaN(parsed)) referrerTelegramId = parsed;
      }
    }

    if (!user) {
      user = await createUser(
        telegram_id,
        username || "",
        avatar_url || null,
        referrerTelegramId
      );
    } else {
      db.run(
        "UPDATE users SET username = ?, avatar_url = ? WHERE telegram_id = ?",
        [username || "", avatar_url || null, telegram_id]
      );
    }

    db.get(
      "SELECT * FROM users WHERE telegram_id = ?",
      [telegram_id],
      (err, row) => {
        if (err) return res.json({ ok: false, error: "DB_ERROR" });
        const is_admin = telegram_id === ADMIN_TELEGRAM_ID;
        return res.json({ ok: true, user: { ...row, is_admin } });
      }
    );
  } catch (e) {
    console.log(e);
    res.json({ ok: false, error: "SERVER_ERROR" });
  }
});

app.get("/api/settings", (req, res) => {
  db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
    if (err) return res.json({ ok: false, error: "DB_ERROR" });
    res.json({ ok: true, settings: row });
  });
});

app.get("/api/tournament/active", (req, res) => {
  db.get(
    "SELECT * FROM tournaments WHERE is_active = 1 ORDER BY id DESC LIMIT 1",
    (err, row) => {
      if (err) return res.json({ ok: false, error: "DB_ERROR" });
      if (!row) return res.json({ ok: true, tournament: null });

      const modes = row.modes ? row.modes.split(",") : [];
      const prizes = row.prizes ? row.prizes.split(",") : [];

      res.json({
        ok: true,
        tournament: {
          id: row.id,
          name: row.name,
          modes,
          prizes
        }
      });
    }
  );
});

// история с сортировкой
app.get("/api/games/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
  const sort = req.query.sort || "latest"; // latest | biggest | luckiest

  let orderBy = "id DESC";

  if (sort === "biggest") {
    orderBy = "bank DESC, id DESC";
  } else if (sort === "luckiest") {
    orderBy = "CAST(bank AS REAL) / id DESC";
  }

  db.all(
    `
      SELECT id, mode, bank, status, created_at, winner_telegram_id, winner_username
      FROM games
      WHERE status = 'finished'
      ORDER BY ${orderBy}
      LIMIT ?
    `,
    [limit],
    (err, rows) => {
      if (err) return res.json({ ok: false, error: "DB_ERROR" });
      res.json({ ok: true, games: rows || [] });
    }
  );
});

app.get("/api/games/replay/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.json({ ok: false, error: "BAD_ID" });

  db.get(
    "SELECT id, mode, bank, replay_json FROM games WHERE id = ?",
    [id],
    (err, row) => {
      if (err || !row) return res.json({ ok: false, error: "NOT_FOUND" });
      let replay = null;
      try {
        replay = row.replay_json ? JSON.parse(row.replay_json) : null;
      } catch {
        replay = null;
      }
      res.json({
        ok: true,
        game: {
          id: row.id,
          mode: row.mode,
          bank: row.bank,
          replay
        }
      });
    }
  );
});

app.post("/api/game/join", async (req, res) => {
  try {
    const { telegram_id, username, mode, amount } = req.body;

    if (!telegram_id || !mode) {
      return res.json({ ok: false, error: "BAD_PARAMS" });
    }

    const bet = parseInt(amount, 10) || 1;

    let user = await getUserByTelegramId(telegram_id);
    if (!user) {
      user = await createUser(telegram_id, username || "", null, null);
    }

    if (user.stars_balance < bet) {
      return res.json({ ok: false, error: "NOT_ENOUGH_STARS" });
    }

    await updateUserBalance(telegram_id, -bet);

    if (user.referrer_id) {
      db.get(
        "SELECT * FROM users WHERE id = ?",
        [user.referrer_id],
        (e2, refRow) => {
          if (!e2 && refRow) {
            const bonus = Math.floor(bet * 0.05);
            if (bonus > 0) {
              db.run(
                `
                UPDATE users
                SET ref_earned_percent = ref_earned_percent + ?,
                    ref_pending_percent = ref_pending_percent + ?
                WHERE id = ?
              `,
                [bonus, refRow.id]
              );
            }
          }
        }
      );
    }

    let game = await findOrCreateGameForMode(mode);

    if (!game.players) game.players = [];
    const already = game.players.find(
      (p) => p.telegram_id === telegram_id
    );
    if (!already) {
      game.players.push({
        telegram_id,
        username: username || "player",
        bet
      });
      game.bank += bet;
    }

    db.run("UPDATE games SET bank = ? WHERE id = ?", [game.bank, game.id]);

    user = await getUserByTelegramId(telegram_id);
    const is_admin = telegram_id === ADMIN_TELEGRAM_ID;

    startGameIfReady(game.id);

    return res.json({
      ok: true,
      game_id: game.id,
      mode: game.mode,
      user: { ...user, is_admin }
    });
  } catch (e) {
    console.log(e);
    res.json({ ok: false, error: "SERVER_ERROR" });
  }
});

app.post("/api/ref/collect", async (req, res) => {
  try {
    const { telegram_id } = req.body;
    if (!telegram_id) {
      return res.json({ ok: false, error: "NO_TELEGRAM_ID" });
    }

    db.get(
      "SELECT * FROM users WHERE telegram_id = ?",
      [telegram_id],
      (err, user) => {
        if (err || !user) {
          return res.json({ ok: false, error: "USER_NOT_FOUND" });
        }

        const total =
          (user.ref_pending_stars || 0) + (user.ref_pending_percent || 0);

        db.run(
          `
          UPDATE users
          SET stars_balance = stars_balance + ?,
              ref_pending_stars = 0,
              ref_pending_percent = 0
          WHERE telegram_id = ?
        `,
          [total, telegram_id],
          function (err2) {
            if (err2) {
              return res.json({ ok: false, error: "DB_ERROR" });
            }

            db.get(
              "SELECT * FROM users WHERE telegram_id = ?",
              [telegram_id],
              (err3, updated) => {
                if (err3 || !updated) {
                  return res.json({ ok: false, error: "USER_NOT_FOUND" });
                }
                const is_admin = telegram_id === ADMIN_TELEGRAM_ID;
                res.json({
                  ok: true,
                  user: { ...updated, is_admin },
                  collected: total
                });
              }
            );
          }
        );
      }
    );
  } catch (e) {
    console.log(e);
    res.json({ ok: false, error: "SERVER_ERROR" });
  }
});

// === ADMIN API ===

app.post("/api/admin/send-stars", async (req, res) => {
  const { admin_telegram_id, target_username, amount } = req.body;

  if (!isAdmin(admin_telegram_id)) {
    return res.json({ ok: false, error: "NOT_ADMIN" });
  }

  const amt = parseInt(amount, 10) || 0;
  if (!target_username || amt <= 0) {
    return res.json({ ok: false, error: "BAD_PARAMS" });
  }

  try {
    const user = await getUserByUsername(target_username);
    if (!user) {
      return res.json({ ok: false, error: "USER_NOT_FOUND" });
    }

    db.run(
      "UPDATE users SET stars_balance = stars_balance + ? WHERE telegram_id = ?",
      [amt, user.telegram_id],
      function (err) {
        if (err) return res.json({ ok: false, error: "DB_ERROR" });
        res.json({ ok: true });
      }
    );
  } catch (e) {
    res.json({ ok: false, error: "SERVER_ERROR" });
  }
});

app.post("/api/admin/create-tournament", (req, res) => {
  const { admin_telegram_id, name, modes, prizes } = req.body;

  if (!isAdmin(admin_telegram_id)) {
    return res.json({ ok: false, error: "NOT_ADMIN" });
  }

  const modesStr = (modes || []).join(",");
  const prizesStr = (prizes || []).join(",");

  db.run(
    "INSERT INTO tournaments (name, modes, prizes, is_active) VALUES (?, ?, ?, 1)",
    [name || "Турнир", modesStr, prizesStr],
    function (err) {
      if (err) return res.json({ ok: false, error: "DB_ERROR" });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.post("/api/admin/create-special", (req, res) => {
  const { admin_telegram_id, mode, description, target_game_id, duration_seconds } =
    req.body;

  if (!isAdmin(admin_telegram_id)) {
    return res.json({ ok: false, error: "NOT_ADMIN" });
  }

  db.run(
    "INSERT INTO special_games (mode, description, target_game_id, duration_seconds) VALUES (?, ?, ?, ?)",
    [mode || "special", description || "", target_game_id || null, duration_seconds || null],
    function (err) {
      if (err) return res.json({ ok: false, error: "DB_ERROR" });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== HTTP + WebSocket =====
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// gameId -> Set of clients
const lobbies = new Map();

function broadcastToGame(gameId, payload) {
  const set = lobbies.get(gameId);
  if (!set) return;

  const msg = JSON.stringify(payload);
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastLobbyState(gameId) {
  const set = lobbies.get(gameId);
  if (!set) return;

  const players = [];
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN) {
      players.push({
        telegram_id: client.telegram_id,
        username: client.username,
        avatar_url: client.avatar_url
      });
    }
  }

  broadcastToGame(gameId, {
    type: "lobby_state",
    game_id: gameId,
    players
  });
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "join_lobby") {
      const { game_id, telegram_id, username, avatar_url } = data;
      if (!game_id || !telegram_id) return;

      ws.game_id = game_id;
      ws.telegram_id = telegram_id;
      ws.username = username || "player";
      ws.avatar_url = avatar_url || null;

      if (!lobbies.has(game_id)) {
        lobbies.set(game_id, new Set());
      }
      const set = lobbies.get(game_id);
      set.add(ws);

      broadcastLobbyState(game_id);
    }
  });

  ws.on("close", () => {
    const gameId = ws.game_id;
    if (!gameId) return;
    const set = lobbies.get(gameId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      lobbies.delete(gameId);
    } else {
      broadcastLobbyState(gameId);
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
