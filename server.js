// ======================================================
// AllPvpGamesHub — SERVER.JS (финальная версия)
// ======================================================

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// ==== НАСТРОЙКИ ПРОЕКТА ====

const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN || ''; // Render подставит
const ADMIN_USERNAME = 'Capibaraboyonrealnokrutoy';
const ADMIN_TELEGRAM_ID = 6572232237;
const ALLOWED_ORIGIN = '*';

const DB_FILE = 'database.db';

// ==== ИНИЦИАЛИЗАЦИЯ ====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(bodyParser.json());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ==== БАЗА ДАННЫХ ====

const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      username TEXT,
      stars_balance INTEGER DEFAULT 0,
      total_stars_spent INTEGER DEFAULT 0,
      total_stars_won INTEGER DEFAULT 0,
      total_stars_withdrawn INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      status TEXT,
      is_special INTEGER DEFAULT 0,
      timer_default INTEGER DEFAULT 15,
      timer_override INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER,
      user_id INTEGER,
      amount INTEGER,
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      modes TEXT,
      prizes_json TEXT,
      status TEXT,
      starts_at DATETIME,
      ends_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tournament_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER,
      user_id INTEGER,
      stars_placed INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS withdraw_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      stars_amount INTEGER,
      ton_amount REAL,
      ton_address TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_telegram_id TEXT,
      from_username TEXT,
      gift_name TEXT,
      stars_value INTEGER,
      note TEXT,
      processed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('stars_per_ton', '1000')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('game_fee_percent', '5')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('withdraw_fee_percent', '5')`);
});

// ==== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====

function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}

function getOrCreateUser(telegram_id, username) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegram_id], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);

      db.run(
        `INSERT INTO users (telegram_id, username) VALUES (?, ?)`,
        [telegram_id, username],
        function (err2) {
          if (err2) return reject(err2);
          db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (err3, row2) => {
            if (err3) return reject(err3);
            resolve(row2);
          });
        }
      );
    });
  });
}

// ==== API: ПРОФИЛЬ ====

app.post('/api/me', async (req, res) => {
  try {
    const { telegram_id, username } = req.body;
    const user = await getOrCreateUser(telegram_id, username);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// ==== API: НАСТРОЙКИ ====

app.get('/api/settings', async (req, res) => {
  const stars_per_ton = await getSetting('stars_per_ton');
  const game_fee_percent = await getSetting('game_fee_percent');
  const withdraw_fee_percent = await getSetting('withdraw_fee_percent');

  res.json({
    ok: true,
    stars_per_ton: Number(stars_per_ton),
    game_fee_percent: Number(game_fee_percent),
    withdraw_fee_percent: Number(withdraw_fee_percent)
  });
});

// ==== API: ВЫВОД TON ====

app.post('/api/withdraw', async (req, res) => {
  try {
    const { telegram_id, username, stars_amount, ton_address } = req.body;
    const user = await getOrCreateUser(telegram_id, username);

    const stars_per_ton = Number(await getSetting('stars_per_ton'));
    const withdraw_fee_percent = Number(await getSetting('withdraw_fee_percent'));

    const ton_raw = stars_amount / stars_per_ton;
    const ton_amount = ton_raw - (ton_raw * withdraw_fee_percent) / 100;

    if (user.stars_balance < stars_amount)
      return res.status(400).json({ ok: false, error: 'NOT_ENOUGH_STARS' });

    db.run(
      `UPDATE users SET stars_balance = stars_balance - ?, total_stars_withdrawn = total_stars_withdrawn + ? WHERE id = ?`,
      [stars_amount, stars_amount, user.id]
    );

    db.run(
      `INSERT INTO withdraw_requests (user_id, stars_amount, ton_amount, ton_address, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [user.id, stars_amount, ton_amount, ton_address]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// ==== API: ТУРНИР ====

app.get('/api/tournament/active', (req, res) => {
  db.get(
    `SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`,
    [],
    (err, row) => {
      if (!row) return res.json({ ok: true, tournament: null });

      db.all(
        `
        SELECT u.username, ts.stars_placed
        FROM tournament_stats ts
        JOIN users u ON u.id = ts.user_id
        WHERE ts.tournament_id = ?
        ORDER BY ts.stars_placed DESC
        LIMIT 100
      `,
        [row.id],
        (err2, stats) => {
          res.json({
            ok: true,
            tournament: {
              ...row,
              modes: JSON.parse(row.modes),
              prizes: JSON.parse(row.prizes_json),
              leaderboard: stats
            }
          });
        }
      );
    }
  );
});

// ==== API: ИГРЫ ====

function findOrCreateGame(mode) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM games WHERE mode = ? AND status = 'waiting' ORDER BY id ASC LIMIT 1`,
      [mode],
      (err, row) => {
        if (row) return resolve(row);

        db.run(
          `INSERT INTO games (mode, status, is_special, timer_default) VALUES (?, 'waiting', 0, 15)`,
          [mode],
          function () {
            db.get(`SELECT * FROM games WHERE id = ?`, [this.lastID], (err2, row2) => {
              resolve(row2);
            });
          }
        );
      }
    );
  });
}

app.post('/api/game/join', async (req, res) => {
  try {
    const { telegram_id, username, mode, amount } = req.body;
    const user = await getOrCreateUser(telegram_id, username);

    if (user.stars_balance < amount)
      return res.status(400).json({ ok: false, error: 'NOT_ENOUGH_STARS' });

    const game = await findOrCreateGame(mode);

    db.run(
      `UPDATE users SET stars_balance = stars_balance - ?, total_stars_spent = total_stars_spent + ? WHERE id = ?`,
      [amount, amount, user.id]
    );

    db.run(
      `INSERT INTO bets (game_id, user_id, amount, result) VALUES (?, ?, ?, 'pending')`,
      [game.id, user.id, amount]
    );

    res.json({ ok: true, game_id: game.id });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// ==== ОСОБЕННЫЕ ИГРЫ ====

app.post('/admin/game/special', (req, res) => {
  const { game_id, timer_override } = req.body;

  db.run(
    `UPDATE games SET is_special = 1, timer_override = ? WHERE id = ?`,
    [timer_override, game_id]
  );

  res.json({ ok: true });
});

// ==== АДМИН: ТУРНИРЫ ====

app.post('/admin/tournament/create', (req, res) => {
  const { name, modes, prizes, starts_at, ends_at } = req.body;

  db.run(
    `
    INSERT INTO tournaments (name, modes, prizes_json, status, starts_at, ends_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `,
    [name, JSON.stringify(modes), JSON.stringify(prizes), starts_at, ends_at]
  );

  res.json({ ok: true });
});

// ==== WEBSOCKET ЯДРО ====

wss.on('connection', ws => {
  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === 'ping')
        ws.send(JSON.stringify({ type: 'pong' }));

      // Здесь ты будешь развивать игровые события
    } catch {}
  });
});

// ==== СТАРТ СЕРВЕРА ====

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AllPvpGamesHub server running on port ${PORT}`);
});
