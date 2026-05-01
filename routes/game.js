const express = require("express");
const router = express.Router();
const Game = require("../models/Game");
const Player = require("../models/Player");

// Весовая рулетка
function pickWinner(players) {
  const total = players.reduce((sum, p) => sum + p.bet, 0);
  let random = Math.random() * total;

  for (const p of players) {
    if (random < p.bet) return p;
    random -= p.bet;
  }
}

// Создать новую арену
async function createNewArena() {
  return await Game.create({
    players: [],
    status: "waiting",
    timerEndsAt: null
  });
}

// Игрок входит в игру
router.post("/join", async (req, res) => {
  const { username, avatarUrl, bet } = req.body;

  if (!username || !bet) {
    return res.json({ error: "username и bet обязательны" });
  }

  if (bet < 20) {
    return res.json({ error: "Минимальная ставка — 20 звёзд" });
  }

  const player = await Player.findOne({ username });
  if (!player) return res.json({ error: "Игрок не найден" });

  if (player.balance < bet) {
    return res.json({ error: "Недостаточно звёзд" });
  }

  // Списываем ставку сразу
  player.balance -= bet;
  await player.save();

  // Ищем арену
  let game = await Game.findOne({ status: "waiting" });

  if (!game) {
    game = await createNewArena();
  }

  // Добавляем игрока
  game.players.push({ username, avatarUrl, bet });

  // Если игроков >= 2 → запускаем таймер
  if (game.players.length === 2) {
    game.timerEndsAt = Date.now() + 15000;
  }

  await game.save();

  res.json({ success: true });
});

// Статус игры
router.get("/status", async (req, res) => {
  let game = await Game.findOne({ status: "waiting" });

  if (!game) {
    game = await createNewArena();
  }

  const total = game.players.reduce((sum, p) => sum + p.bet, 0);

  const players = game.players.map(p => ({
    username: p.username,
    avatarUrl: p.avatarUrl,
    bet: p.bet,
    chance: total > 0 ? (p.bet / total) * 100 : 0
  }));

  res.json({
    status: game.status,
    timerEndsAt: game.timerEndsAt,
    players
  });
});

// Проверка и запуск игры
setInterval(async () => {
  const game = await Game.findOne({ status: "waiting" });

  if (!game) return;

  if (game.timerEndsAt && Date.now() >= game.timerEndsAt) {
    // Игра начинается
    game.status = "started";

    const winner = pickWinner(game.players);
    const total = game.players.reduce((sum, p) => sum + p.bet, 0);

    // Начисляем победителю
    const player = await Player.findOne({ username: winner.username });
    player.balance += total;
    await player.save();

    game.winner = {
      username: winner.username,
      avatarUrl: winner.avatarUrl,
      winAmount: total
    };

    game.status = "finished";
    await game.save();

    // Создаём новую арену
    await createNewArena();
  }
}, 1000);

// Результат игры
router.get("/result", async (req, res) => {
  const game = await Game.findOne().sort({ createdAt: -1 });

  if (!game || !game.winner) {
    return res.json({ error: "Игра ещё не завершена" });
  }

  res.json({
    winner: game.winner.username,
    avatarUrl: game.winner.avatarUrl,
    winAmount: game.winner.winAmount
  });
});

module.exports = router;
