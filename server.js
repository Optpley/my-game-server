const express = require("express");
const app = express();
const mongoose = require("mongoose");

app.use(express.json());

// Подключение роутов игроков
const playerRoutes = require("./routes/player");
app.use("/player", playerRoutes);

// 🔥 Подключение роутов Ice Arena
const gameRoutes = require("./routes/game");
app.use("/game", gameRoutes);

// Запуск сервера
app.listen(3000, () => console.log("Server started"));

