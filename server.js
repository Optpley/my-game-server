const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// === DB ===
const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT,
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
      amount INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      player_telegram_id INTEGER
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

// helper: get user by telegram_id
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

// helper: create user
function createUser(telegram_id, username, referrerTelegramId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO users (telegram_id, username) VALUES (?, ?)",
      [telegram_id, username],
      function (err) {
        if (err) return reject(err);
        const newId = this.lastID;

        // handle referrer
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

// helper: update user balance
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

// === API ===

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
        return res.json({ ok: true, user: row });
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

// /api/tournament/active — пока заглушка без турниров
app.get("/api/tournament/active", (req, res) => {
  res.json({ ok: true, tournament: null });
});

// /api/game/join — создание игры, списание ставки, 5% рефереру
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

    db.run(
      "INSERT INTO games (mode, amount, player_telegram_id) VALUES (?, ?, ?)",
      [mode, bet, telegram_id],
      function (err) {
        if (err) return res.json({ ok: false, error: "DB_ERROR" });

        const gameId = this.lastID;

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
                    [bonus, bonus, refRow.id]
                  );
                }
              }
            }
          );
        }

        db.get(
          "SELECT * FROM users WHERE telegram_id = ?",
          [telegram_id],
          (err2, row2) => {
            if (!err2 && row2) {
              user = row2;
            }
            return res.json({
              ok: true,
              game_id: gameId,
              user
            });
          }
        );
      }
    );
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
                res.json({ ok: true, user: updated, collected: total });
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

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
