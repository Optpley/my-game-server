const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(express.json());
app.use(cors());

// Подключение MongoDB
mongoose
  .connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));

// Статическая папка для картинок призов
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Роуты игроков
const playerRoutes = require("./routes/player");
app.use("/player", playerRoutes);

// Роуты Ice Arena
const gameRoutes = require("./routes/game");
app.use("/game", gameRoutes);

// Роуты админ‑панели
const adminRoutes = require("./routes/admin");
app.use("/admin", adminRoutes);

// Роуты микс‑режима
const mixRoutes = require("./routes/mix");
app.use("/mix", mixRoutes);

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
