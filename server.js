import express from "express";
import cors from "cors";
import axios from "axios";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ====== ENV CONFIG ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID);
const ADMIN_KEY = process.env.ADMIN_KEY || "G2ale*nik2L";
const PROJECT_NAME = "AllPvpGamesHub";

// ====== SQLITE (без нативной сборки) ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new sqlite3.Database(path.join(__dirname, "database.sqlite"));

// Создание таблиц
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE,
            username TEXT,
            stars INTEGER DEFAULT 0,
            ton_wallet TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            amount INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // курс по умолчанию
    db.get("SELECT value FROM settings WHERE key='rate'", (err, row) => {
        if (!row) {
            db.run("INSERT INTO settings (key, value) VALUES ('rate', '140')");
        }
    });
});

// ====== ДЕМО ИГРОКИ ======
let demoPlayers = [
    { id: 1, username: "frog_king", color: "#fff44d", weight: 200 },
    { id: 2, username: "frog_winter", color: "#44d9ff", weight: 150 },
    { id: 3, username: "frog_sweater", color: "#44ffad", weight: 100 },
    { id: 4, username: "frog_armor", color: "#ffb84d", weight: 50 }
];

let games = {
    ice_arena: { id: "ice_arena", name: "Ice Arena", minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null },
    balls:     { id: "balls",     name: "Balls",     minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null },
    race:      { id: "race",      name: "Ball Race", minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null },
    knockout:  { id: "knockout",  name: "Knockout",  minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null }
};

// ====== HELPERS ======
function applyCommission(amount) {
    return Math.floor(amount * 0.95);
}

function calcBank(game) {
    const sum = game.players.reduce((s, p) => s + p.weight, 0);
    return { raw: sum, afterCommission: applyCommission(sum) };
}

function getRate(cb) {
    db.get("SELECT value FROM settings WHERE key='rate'", (err, row) => {
        cb(parseInt(row.value));
    });
}

function setRate(r) {
    db.run(
        "INSERT INTO settings (key, value) VALUES ('rate', ?) ON CONFLICT(key) DO UPDATE SET value=?",
        [String(r), String(r)]
    );
}

function getOrCreateUser(tgUser, cb) {
    db.get("SELECT * FROM users WHERE tg_id=?", [tgUser.id], (err, row) => {
        if (!row) {
            db.run(
                "INSERT INTO users (tg_id, username, stars) VALUES (?, ?, 0)",
                [tgUser.id, tgUser.username || null],
                () => {
                    db.get("SELECT * FROM users WHERE tg_id=?", [tgUser.id], (err2, newUser) => {
                        cb(newUser);
                    });
                }
            );
        } else {
            db.run("UPDATE users SET username=? WHERE tg_id=?", [tgUser.username || null, tgUser.id]);
            cb(row);
        }
    });
}

function isAdmin(req) {
    return req.headers["x-admin-key"] === ADMIN_KEY;
}

// ====== API: init user ======
app.post("/user/init", (req, res) => {
    getOrCreateUser(req.body.user, (dbUser) => {
        res.json({
            ok: true,
            user: {
                id: dbUser.id,
                tg_id: dbUser.tg_id,
                username: dbUser.username,
                stars: dbUser.stars
            }
        });
    });
});

// ====== API: игры ======
app.get("/games", (req, res) => {
    res.json({
        games: Object.values(games).map(g => {
            const bank = calcBank(g);
            return {
                id: g.id,
                name: g.name,
                status: g.status,
                playersCount: g.players.length,
                bankRaw: bank.raw,
                bankAfterCommission: bank.afterCommission
            };
        })
    });
});

app.get("/game/:id/status", (req, res) => {
    const g = games[req.params.id];
    if (!g) return res.status(404).json({ error: "Game not found" });
    const bank = calcBank(g);
    res.json({
        id: g.id,
        name: g.name,
        status: g.status,
        players: g.players,
        bankRaw: bank.raw,
        bankAfterCommission: bank.afterCommission,
        winnerId: g.winnerId
    });
});

// ====== API: старт игры ======
app.post("/game/:id/start", (req, res) => {
    const g = games[req.params.id];
    if (!g) return res.status(404).json({ error: "Game not found" });

    g.status = "running";

    setTimeout(() => {
        const winner = g.players[Math.floor(Math.random() * g.players.length)];
        g.winnerId = winner.id;
        g.status = "finished";
    }, 3000);

    res.json({ ok: true });
});

// ====== API: вывод TON ======
app.post("/withdraw", (req, res) => {
    const { user, wallet } = req.body;

    getOrCreateUser(user, (dbUser) => {
        getRate((rate) => {
            if (dbUser.stars < rate) {
                return res.status(400).json({
                    error: "Not enough stars",
                    need: rate,
                    have: dbUser.stars
                });
            }

            db.run("UPDATE users SET stars = stars - ? WHERE id=?", [rate, dbUser.id]);
            db.run("INSERT INTO transactions (user_id, type, amount) VALUES (?, 'withdraw', ?)", [
                dbUser.id,
                rate
            ]);

            if (BOT_TOKEN && ADMIN_CHAT_ID) {
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: ADMIN_CHAT_ID,
                    text:
                        `Заявка на вывод (${PROJECT_NAME}):\n\n` +
                        `@${dbUser.username}\n` +
                        `TG ID: ${dbUser.tg_id}\n` +
                        `TON: ${wallet}\n` +
                        `Списано звёзд: ${rate}\n` +
                        `Сумма: 1 TON`
                });
            }

            res.json({ ok: true });
        });
    });
});

// ====== АДМИН ======
app.get("/admin/settings", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    getRate((rate) => res.json({ rate }));
});

app.post("/admin/settings/rate", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    const r = parseInt(req.body.rate);
    if (!r || r <= 0) return res.status(400).json({ error: "Bad rate" });
    setRate(r);
    res.json({ ok: true, rate: r });
});

app.get("/admin/users", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });

    db.all("SELECT id, tg_id, username, stars, ton_wallet FROM users ORDER BY id DESC LIMIT 100", (err, rows) => {
        res.json({ users: rows });
    });
});

app.post("/admin/grant-stars", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });

    const { username, amount } = req.body;
    const a = parseInt(amount);

    db.get("SELECT * FROM users WHERE username=? COLLATE NOCASE", [username], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });

        db.run("UPDATE users SET stars = stars + ? WHERE id=?", [a, user.id]);
        db.run("INSERT INTO transactions (user_id, type, amount) VALUES (?, 'grant', ?)", [
            user.id,
            a
        ]);

        res.json({ ok: true });
    });
});

// ====== СТАТИКА ======
app.use(express.static(path.join(__dirname, "client")));

app.listen(PORT, () => {
    console.log(`[${PROJECT_NAME}] Server running on port ${PORT}`);
});
