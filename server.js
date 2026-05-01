import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Временные игроки — потом заменишь на реальные данные
let players = [
  { id: 1, username: "frog_king", color: "#ff4d4d", weight: 200 },
  { id: 2, username: "frog_winter", color: "#4d9fff", weight: 150 },
  { id: 3, username: "frog_sweater", color: "#4dff4d", weight: 100 },
  { id: 4, username: "frog_armor", color: "#ffb84d", weight: 50 }
];

// Отдаём список игроков
app.get("/game/status", (req, res) => {
  res.json({ players });
});

// Принимаем победителя
app.post("/game/result", (req, res) => {
  const { winner } = req.body;
  console.log("Победитель:", winner);

  // Здесь можно обновлять баланс, статистику, историю игр
  res.json({ ok: true });
});

// Порт для локального запуска
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));

