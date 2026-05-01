import React, { useEffect, useRef } from "react";

// players: [{ id, color, weight, username, avatarUrl }]
// onFinish: (winnerPlayer) => {}

const W = 220;   // логическая ширина поля
const H = 220;   // логическая высота поля
const PIXEL_SIZE = 2; // размер квадратика на экране

function IcePixelArena({ players, onFinish }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  const gridRef = useRef(null);
  const puckRef = useRef(null);
  const finishedRef = useRef(false);

  // Генерация зон
  function generateZones() {
    const grid = Array.from({ length: H }, () => Array(W).fill(null));
    const totalWeight = players.reduce((s, p) => s + p.weight, 0);

    function pickCenter(i) {
      const angle = (2 * Math.PI * i) / players.length;
      const r = Math.min(W, H) * 0.25;
      return {
        x: W / 2 + Math.cos(angle) * r,
        y: H / 2 + Math.sin(angle) * r
      };
    }

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const needPixels = Math.max(
        50,
        Math.floor((p.weight / totalWeight) * W * H * 0.7)
      );

      const center = pickCenter(i);
      const queue = [{ x: Math.floor(center.x), y: Math.floor(center.y) }];
      let filled = 0;

      while (queue.length && filled < needPixels) {
        const { x, y } = queue.shift();
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (grid[y][x] !== null) continue;

        grid[y][x] = p.id;
        filled++;

        const dirs = [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 }
        ].sort(() => Math.random() - 0.5);

        for (const d of dirs) {
          queue.push({ x: x + d.x, y: y + d.y });
        }
      }
    }

    gridRef.current = grid;
  }

  // Инициализация шайбы
  function initPuck() {
    const puckX = Math.random() * W;
    const puckY = Math.random() * H;
    const angle = Math.random() * Math.PI * 2;
    const vx = Math.cos(angle);
    const vy = Math.sin(angle);
    const speed = 1.6;

    puckRef.current = { x: puckX, y: puckY, vx, vy, speed };
  }

  function getWinner() {
    const grid = gridRef.current;
    const puck = puckRef.current;
    if (!grid || !puck) return null;

    const x = Math.floor(puck.x);
    const y = Math.floor(puck.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;

    const ownerId = grid[y][x];
    if (!ownerId) return null;

    return players.find(p => p.id === ownerId) || null;
  }

  function renderFrame(ctx) {
    const grid = gridRef.current;
    const puck = puckRef.current;
    if (!grid || !puck) return;

    const width = W * PIXEL_SIZE;
    const height = H * PIXEL_SIZE;

    ctx.clearRect(0, 0, width, height);

    // фон арены
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, width, height);

    // пиксельные зоны
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ownerId = grid[y][x];
        if (!ownerId) continue;
        const player = players.find(p => p.id === ownerId);
        if (!player) continue;

        ctx.fillStyle = player.color;
        ctx.fillRect(
          x * PIXEL_SIZE,
          y * PIXEL_SIZE,
          PIXEL_SIZE,
          PIXEL_SIZE
        );
      }
    }

    // лёгкий затемняющий слой
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, width, height);

    // шайба
    const puckScreenX = puck.x * PIXEL_SIZE;
    const puckScreenY = puck.y * PIXEL_SIZE;

    ctx.beginPath();
    ctx.arc(puckScreenX, puckScreenY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#00e0ff";
    ctx.stroke();

    // glow
    const gradient = ctx.createRadialGradient(
      puckScreenX,
      puckScreenY,
      0,
      puckScreenX,
      puckScreenY,
      20
    );
    gradient.addColorStop(0, "rgba(0,224,255,0.5)");
    gradient.addColorStop(1, "rgba(0,224,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(puckScreenX, puckScreenY, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  function updatePuck() {
    const puck = puckRef.current;
    if (!puck) return false;

    puck.x += puck.vx * puck.speed;
    puck.y += puck.vy * puck.speed;

    // отскок от границ
    if (puck.x < 1) {
      puck.x = 1;
      puck.vx *= -1;
    }
    if (puck.x > W - 2) {
      puck.x = W - 2;
      puck.vx *= -1;
    }
    if (puck.y < 1) {
      puck.y = 1;
      puck.vy *= -1;
    }
    if (puck.y > H - 2) {
      puck.y = H - 2;
      puck.vy *= -1;
    }

    // лёгкое замедление
    puck.speed *= 0.995;

    // минимальная скорость
    if (puck.speed < 0.08) {
      puck.speed = 0;
      return false;
    }

    return true;
  }

  useEffect(() => {
    if (!players || players.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // подгон под экран мини-аппа
    const dpr = window.devicePixelRatio || 1;
    const width = W * PIXEL_SIZE;
    const height = H * PIXEL_SIZE;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.scale(dpr, dpr);

    generateZones();
    initPuck();

    finishedRef.current = false;

    const loop = () => {
      const alive = updatePuck();
      renderFrame(ctx);

      if (!alive && !finishedRef.current) {
        finishedRef.current = true;
        const winner = getWinner();
        if (winner && onFinish) {
          onFinish(winner);
        }
        return;
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [players, onFinish]);

  return (
    <div
      style={{
        width: W * PIXEL_SIZE,
        height: H * PIXEL_SIZE,
        margin: "0 auto",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 0 20px rgba(0,0,0,0.6)",
        background: "#050816"
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

export default IcePixelArena;
