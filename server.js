import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// ВСТАВЬ СВОИ ДАННЫЕ
const BOT_TOKEN = "ТОТ_САМЫЙ_ТОКЕН_БОТА";
const ADMIN_CHAT_ID = 123456789; // твой Telegram ID или чат админки

// ====== ЛОГИКА КОМИССИИ 5% ======
function applyCommission(amount) {
    return Math.floor(amount * 0.95);
}

// ====== ВРЕМЕННО: ИГРОКИ (демо) ======
let players = [
    { id: 1, username: "frog_king", color: "#fff44d", weight: 200 },
    { id: 2, username: "frog_winter", color: "#44d9ff", weight: 150 },
    { id: 3, username: "frog_sweater", color: "#44ffad", weight: 100 },
    { id: 4, username: "frog_armor", color: "#ffb84d", weight: 50 }
];

// ====== ИГРЫ (Ice Arena, Balls, Race, Knockout) ======
let games = {
    ice_arena: {
        id: "ice_arena",
        name: "Ice Arena",
        minPlayers: 2,
        maxPlayers: 4,
        status: "waiting", // waiting | running | finished
        players: [...players],
        winnerId: null
    },
    balls: {
        id: "balls",
        name: "Balls",
        minPlayers: 2,
        maxPlayers: 4,
        status: "waiting",
        players: [...players],
        winnerId: null
    },
    race: {
        id: "race",
        name: "Ball Race",
        minPlayers: 2,
        maxPlayers: 4,
        status: "waiting",
        players: [...players],
        winnerId: null
    },
    knockout: {
        id: "knockout",
        name: "Knockout",
        minPlayers: 2,
        maxPlayers: 4,
        status: "waiting",
        players: [...players],
        winnerId: null
    }
};

// ====== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======
function calcBank(game) {
    const sum = game.players.reduce((s, p) => s + p.weight, 0);
    return {
        raw: sum,
        afterCommission: applyCommission(sum)
    };
}

// ====== API: список игр ======
app.get("/games", (req, res) => {
    const list = Object.values(games).map(g => {
        const bank = calcBank(g);
        return {
            id: g.id,
            name: g.name,
            status: g.status,
            playersCount: g.players.length,
            bankRaw: bank.raw,
            bankAfterCommission: bank.afterCommission
        };
    });

    res.json({ games: list });
});

// ====== API: статус конкретной игры ======
app.get("/game/:id/status", (req, res) => {
    const id = req.params.id;
    const game = games[id];

    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }

    const bank = calcBank(game);

    res.json({
        id: game.id,
        name: game.name,
        status: game.status,
        players: game.players,
        bankRaw: bank.raw,
        bankAfterCommission: bank.afterCommission,
        winnerId: game.winnerId
    });
});

// ====== API: старт игры (демо-логика, выбираем победителя случайно) ======
app.post("/game/:id/start", (req, res) => {
    const id = req.params.id;
    const game = games[id];

    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }

    if (game.players.length < game.minPlayers) {
        return res.status(400).json({ error: "Not enough players" });
    }

    game.status = "running";

    // Через 3 секунды "заканчиваем" игру и выбираем победителя
    setTimeout(() => {
        const winner =
            game.players[Math.floor(Math.random() * game.players.length)];
        game.winnerId = winner.id;
        game.status = "finished";
        console.log(`Game ${game.id} winner:`, winner.username);
    }, 3000);

    res.json({ ok: true, status: "started" });
});

// ====== API: запрос на вывод TON ======
app.post("/withdraw", async (req, res) => {
    try {
        const { user, wallet } = req.body;

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
                chat_id: ADMIN_CHAT_ID,
                text:
                    `Заявка на вывод:\n\n` +
                    `Пользователь: ${user?.username || "unknown"}\n` +
                    `ID: ${user?.id || "unknown"}\n` +
                    `TON: ${wallet}`
            }
        );

        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to send withdraw request" });
    }
});

// ====== СТАТИКА ДЛЯ КЛИЕНТА ======
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "client")));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
