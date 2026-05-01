const express = require("express");
const router = express.Router();
const MixGame = require("../models/MixGame");

// Получить текущую игру дня
router.get("/current", async (req, res) => {
  let mix = await MixGame.findOne().sort({ createdAt: -1 });

  // Если нет записи или истекло — можно вернуть null или дефолт
  if (!mix || (mix.expiresAt && mix.expiresAt < new Date())) {
    return res.json({ currentGame: null });
  }

  res.json({
    currentGame: mix.currentGame,
    expiresAt: mix.expiresAt
  });
});

module.exports = router;

