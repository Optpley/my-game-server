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
      stars_balance INTEGER DEFAULT 100,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

function createUser(telegram_id, username, referrerTelegramId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO users (telegram_id, username) VALUES (?, ?)",
      [telegram_id, username],
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
//
// activeGames[gameId] = {
//   id,
//   mode,
//   bank,
//   status: 'waiting' | 'playing' | 'finished',
//   players: [{telegram_id, username, bet}],
//   timer: NodeJS.Timeout | null
// }

const activeGames = new Map();

// найти или создать игру для режима (одно лобби на режим)
function findOrCreateGameForMode(mode, bet) {
  for (const g of activeGames.values()) {
    if (g.mode === mode && g.status === "waiting") {
      g.bank += bet;
      return g;
    }
  }

  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO games (mode, bank, status) VALUES (?, ?, 'waiting')",
      [mode, bet],
      function (err) {
        if (err) return reject(err);
        const game = {
          id: this.lastID,
          mode,
          bank: bet,
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

// старт игры, когда >=2 игроков
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

  // через 5 секунд — результат
  game.timer = setTimeout(() => finishGame(gameId), 5000);
}

// завершение игры, выбор победителя, начисление банка
async function finishGame(gameId) {
  const game = activeGames.get(gameId);
  if (!game) return;
  if (game.status !== "playing") return;

  game.status = "finished";

  if (!game.players || game.players.length === 0) {
    db.run("UPDATE games SET status = 'finished' WHERE id = ?", [gameId]);
    return;
  }

  const winnerIndex = Math.floor(Math.random() * game.players.length);
  const winner = game.players[winnerIndex];

  await updateUserBalance(winner.telegram_id, game.bank);

  db.run("UPDATE games SET status = 'finished' WHERE id = ?", [gameId]);

  broadcastToGame(gameId, {
    type: "game_result",
    game_id: gameId,
    mode: game.mode,
    bank: game.bank,
    winner_telegram_id: winner.telegram_id,
    winner_username: winner.username
  });

  // можно оставить игру в памяти, чтобы игроки увидели результат,
  // а потом очистить через пару секунд
  setTimeout(() => {
    activeGames.delete(gameId);
  }, 10000);
}

// ===== API =====

// /api/me — создать/получить пользователя, обработать реферал
app.post("/api/me", async (req, res) => {
  try {
    const { telegram_id, username, start_param } = req.body;

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
      user = await createUser(telegram_id, username || "", referrerTelegramId);
    } else {
      db.run(
        "UPDATE users SET username = ? WHERE telegram_id = ?",
        [username || "", telegram_id]
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

// /api/settings — заглушка
app.get("/api/settings", (req, res) => {
  db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
    if (err) return res.json({ ok: false, error: "DB_ERROR" });
    res.json({ ok: true, settings: row });
  });
});

// /api/tournament/active — берём первый активный
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

// /api/game/join — вход в игру, ставка, лобби
app.post("/api/game/join", async (req, res) => {
  try {
    const { telegram_id, username, mode, amount } = req.body;

    if (!telegram_id || !mode) {
      return res.json({ ok: false, error: "BAD_PARAMS" });
    }

    const bet = parseInt(amount, 10) || 1;

    let user = await getUserByTelegramId(telegram_id);
    if (!user) {
      user = await createUser(telegram_id, username || "", null);
    }

    if (user.stars_balance < bet) {
      return res.json({ ok: false, error: "NOT_ENOUGH_STARS" });
    }

    await updateUserBalance(telegram_id, -bet);

    // 5% рефереру
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

    // найти/создать игру для режима
    let game = await findOrCreateGameForMode(mode, bet);

    // добавить игрока в in-memory игру
    if (!game.players) game.players = [];
    const already = game.players.find(
      (p) => p.telegram_id === telegram_id
    );
    if (!already) {
      game.players.push({ telegram_id, username: username || "player", bet });
    }

    // обновить банк в БД
    db.run("UPDATE games SET bank = ? WHERE id = ?", [game.bank, game.id]);

    // обновить пользователя
    user = await getUserByTelegramId(telegram_id);
    const is_admin = telegram_id === ADMIN_TELEGRAM_ID;

    // если игроков >=2 — стартуем
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

// /api/ref/collect — собрать реферальные награды
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

app.post("/api/admin/send-stars", (req, res) => {
  const { admin_telegram_id, target_telegram_id, amount } = req.body;

  if (!isAdmin(admin_telegram_id)) {
    return res.json({ ok: false, error: "NOT_ADMIN" });
  }

  const amt = parseInt(amount, 10) || 0;
  if (!target_telegram_id || amt <= 0) {
    return res.json({ ok: false, error: "BAD_PARAMS" });
  }

  db.run(
    "UPDATE users SET stars_balance = stars_balance + ? WHERE telegram_id = ?",
    [amt, target_telegram_id],
    function (err) {
      if (err) return res.json({ ok: false, error: "DB_ERROR" });
      res.json({ ok: true });
    }
  );
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
  const { admin_telegram_id, mode, description } = req.body;

  if (!isAdmin(admin_telegram_id)) {
    return res.json({ ok: false, error: "NOT_ADMIN" });
  }

  db.run(
    "INSERT INTO special_games (mode, description) VALUES (?, ?)",
    [mode || "special", description || ""],
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
        username: client.username
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
      const { game_id, telegram_id, username } = data;
      if (!game_id || !telegram_id) return;

      ws.game_id = game_id;
      ws.telegram_id = telegram_id;
      ws.username = username || "player";

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
