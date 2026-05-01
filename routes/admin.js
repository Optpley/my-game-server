const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const Tournament = require("../models/Tournament");
const MixGame = require("../models/MixGame");

const ADMINS = ["Capibaraboyonrealnokrutoy"];

// Проверка админа
function checkAdmin(req, res, next) {
  const { username } = req.body;

  if (!username || !ADMINS.includes(username)) {
    return res.json({ error: "Нет доступа" });
  }

  next();
}

// Настройка загрузки файлов (картинки призов)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "..", "uploads"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = "prize_" + Date.now() + ext;
    cb(null, name);
  }
});

const upload = multer({ storage });

// Получить данные для админ‑панели
router.post("/panel", checkAdmin, async (req, res) => {
  const tournaments = await Tournament.find().sort({ createdAt: -1 });
  const mix = await MixGame.findOne().sort({ createdAt: -1 });

  res.json({
    tournaments,
    mix
  });
});

// Создать турнир
router.post("/createTournament", checkAdmin, async (req, res) => {
  const { title, games, startAt, endAt } = req.body;

  if (!title || !games || !games.length) {
    return res.json({ error: "Название и игры обязательны" });
  }

  const tournament = await Tournament.create({
    title,
    games,
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
    isActive: false,
    prizes: []
  });

  res.json({ success: true, tournament });
});

// Добавить приз к турниру
router.post("/addPrize", checkAdmin, async (req, res) => {
  const { tournamentId, title, imageUrl } = req.body;

  if (!tournamentId || !title || !imageUrl) {
    return res.json({ error: "tournamentId, title и imageUrl обязательны" });
  }

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) return res.json({ error: "Турнир не найден" });

  tournament.prizes.push({ title, imageUrl });
  await tournament.save();

  res.json({ success: true, tournament });
});

// Загрузка картинки приза
router.post("/uploadPrizeImage", checkAdmin, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.json({ error: "Файл не получен" });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, imageUrl });
});

// Включить / выключить турнир
router.post("/setTournamentActive", checkAdmin, async (req, res) => {
  const { tournamentId, isActive } = req.body;

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) return res.json({ error: "Турнир не найден" });

  tournament.isActive = !!isActive;
  await tournament.save();

  res.json({ success: true, tournament });
});

// Установить игру дня для микс‑режима
router.post("/setMixGame", checkAdmin, async (req, res) => {
  const { gameKey } = req.body; // "dodge_rocks" или "color_wars"

  if (!gameKey) return res.json({ error: "gameKey обязателен" });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const mix = await MixGame.create({
    currentGame: gameKey,
    expiresAt
  });

  res.json({ success: true, mix });
});

module.exports = router;

