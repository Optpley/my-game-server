import React, { useState } from "react";
import IcePixelArena from "../components/IcePixelArena";

export default function GameScreen() {
  // Тестовые игроки — позже заменишь на данные с сервера
  const [players] = useState([
    { id: 1, username: "frog_king", color: "#ff4d4d", weight: 200 },
    { id: 2, username: "frog_winter", color: "#4d9fff", weight: 150 },
    { id: 3, username: "frog_sweater", color: "#4dff4d", weight: 100 },
    { id: 4, username: "frog_armor", color: "#ffb84d", weight: 50 }
  ]);

  const [winner, setWinner] = useState(null);

  function handleWinner(player) {
    setWinner(player);

    // Здесь можно отправить победителя на сервер:
    // fetch("/game/result", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({ winner: player.id })
    // });
  }

  return (
    <div
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0f1c",
        minHeight: "100vh",
        width: "100%",
        boxSizing: "border-box"
      }}
    >
      {/* Пиксельная арена */}
      <IcePixelArena players={players} onFinish={handleWinner} />

      {/* Блок победителя */}
      {winner && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 18px",
            borderRadius: 12,
            background: "#111827",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            boxShadow: "0 0 12px rgba(0,0,0,0.4)",
            textAlign: "center"
          }}
        >
          Победитель: @{winner.username}
        </div>
      )}
    </div>
  );
}
