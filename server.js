import express from "express";
import cors from "cors";
import axios from "axios";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// ====== ТВОИ ДАННЫЕ ======
const BOT_TOKEN = "ТОТ_САМЫЙ_ТОКЕН_БОТА";
const ADMIN_CHAT_ID = 123456789; 
const ADMIN_KEY = "SUPER_SECRET_ADMIN_KEY"; // поменяй

// ====== SQLite ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "database.sqlite"));

// Таблицы
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER UNIQUE,
    username TEXT,
    stars INTEGER DEFAULT 0,
    ton_wallet TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    amount INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

if (!db.prepare("SELECT value FROM settings WHERE key='rate'").get()) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('rate', '1000')").run();
}

// ====== ДЕМО ИГРОКИ ======
let demoPlayers = [
    { id: 1, username: "frog_king", color: "#fff44d", weight: 200 },
    { id: 2, username: "frog_winter", color: "#44d9ff", weight: 150 },
    { id: 3, username: "frog_sweater", color: "#44ffad", weight: 100 },
    { id: 4, username: "frog_armor", color: "#ffb84d", weight: 50 }
];

// ====== ИГРЫ ======
let games = {
    ice_arena: { id: "ice_arena", name: "Ice Arena", minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null },
    balls:     { id: "balls",     name: "Balls",     minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null },
    race:      { id: "race",      name: "Ball Race", minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null },
    knockout:  { id: "knockout",  name: "Knockout",  minPlayers: 2, maxPlayers: 4, status: "waiting", players: [...demoPlayers], winnerId: null }
};

// ====== ВСПОМОГАТЕЛЬНЫЕ ======
function applyCommission(amount) {
    return Math.floor(amount * 0.95);
}

function calcBank(game) {
    const sum = game.players.reduce((s, p) => s + p.weight, 0);
    return { raw: sum, afterCommission: applyCommission(sum) };
}

function getRate() {
    return parseInt(db.prepare("SELECT value FROM settings WHERE key='rate'").get().value);
}

function setRate(r) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('rate', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(r));
}

function getOrCreateUser(tgUser) {
    if (!tgUser || !tgUser.id) return null;

    let user = db.prepare("SELECT * FROM users WHERE tg_id=?").get(tgUser.id);

    if (!user) {
        db.prepare("INSERT INTO users (tg_id, username, stars) VALUES (?, ?, 0)").run(tgUser.id, tgUser.username || null);
        user = db.prepare("SELECT * FROM users WHERE tg_id=?").get(tgUser.id);
    } else {
        db.prepare("UPDATE users SET username=? WHERE tg_id=?").run(tgUser.username || null, tgUser.id);
    }

    return user;
}

// ====== API: init user ======
app.post("/user/init", (req, res) => {
    const dbUser = getOrCreateUser(req.body.user);
    res.json({ ok: true, user: dbUser });
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
    res.json({ ...g, bankRaw: bank.raw, bankAfterCommission: bank.afterCommission });
});

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
app.post("/withdraw", async (req, res) => {
    const { user, wallet } = req.body;
    const dbUser = getOrCreateUser(user);

    const rate = getRate();

    if (dbUser.stars < rate) {
        return res.status(400).json({ error: "Not enough stars", need: rate, have: dbUser.stars });
    }

    db.prepare("UPDATE users SET stars = stars - ? WHERE id=?").run(rate, dbUser.id);
    db.prepare("INSERT INTO transactions (user_id, type, amount) VALUES (?, 'withdraw', ?)").run(dbUser.id, rate);

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text:
            `Заявка на вывод:\n\n` +
            `@${dbUser.username}\n` +
            `TG ID: ${dbUser.tg_id}\n` +
            `TON: ${wallet}\n` +
            `Списано звёзд: ${rate}\n` +
            `Сумма: 1 TON`
    });

    res.json({ ok: true });
});

// ====== АДМИН ======
function isAdmin(req) {
    return (req.headers["x-admin-key"] === ADMIN_KEY);
}

app.get("/admin/settings", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    res.json({ rate: getRate() });
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
    const users = db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 100").all();
    res.json({ users });
});

app.post("/admin/grant-stars", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });

    const { username, amount } = req.body;
    const a = parseInt(amount);

    const user = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    db.prepare("UPDATE users SET stars = stars + ? WHERE id=?").run(a, user.id);
    db.prepare("INSERT INTO transactions (user_id, type, amount) VALUES (?, 'grant', ?)").run(user.id, a);

    res.json({ ok: true });
});

// ====== СТАТИКА ======
app.use(express.static(path.join(__dirname, "client")));

app.listen(PORT, () => console.log("Server running on", PORT));

