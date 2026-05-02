// public/app.js
const API = window.location.origin + "/api";
let tg = window.Telegram?.WebApp;
tg?.expand?.();

let currentUser = null;
let currentSettings = null;
let mixTimerInterval = null;

let ws = null;
let currentLobbyGameId = null;
let currentLobbyMode = null;

let selectedGameMode = null;
let selectedBet = 50;

/* ====== IN-APP ALERT ====== */

function alertInApp(text) {
  const box = document.createElement("div");
  box.className = "alert-box";
  box.innerText = text;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2200);
}

/* ====== TIME HELPERS ====== */

function getMoscowNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 3 * 3600000);
}

function getNextMoscowMidnight() {
  const msk = getMoscowNow();
  const next = new Date(msk);
  next.setHours(24, 0, 0, 0);
  return next;
}

function formatDiffToMidnightFull() {
  const now = getMoscowNow();
  const next = getNextMoscowMidnight();
  const diffMs = next - now;
  if (diffMs <= 0) return "00:00:00";

  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getTodayMixMode() {
  const msk = getMoscowNow();
  const startOfYear = new Date(msk.getFullYear(), 0, 0);
  const diff = msk - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const modes = ["meteor_fall", "color_arena"];
  const idx = dayOfYear % modes.length;
  return modes[idx];
}

/* ====== LOAD USER & SETTINGS ====== */

async function loadUser() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";
  const start_param = tg?.initDataUnsafe?.start_param || null;
  const avatar_url = tg?.initDataUnsafe?.user?.photo_url || null;

  try {
    const res = await fetch(API + "/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, username, start_param, avatar_url })
    });

    const data = await res.json();
    if (data.ok) currentUser = data.user;
  } catch (e) {
    console.log("me error", e);
  }

  const balEl = document.getElementById("header-balance");
  if (balEl && currentUser) {
    balEl.innerText = currentUser.stars_balance + " ⭐";
  }
}

async function loadSettings() {
  try {
    const res = await fetch(API + "/settings");
    const data = await res.json();
    if (data.ok) currentSettings = data.settings;
  } catch (e) {
    console.log("settings error", e);
  }
}

/* ====== GAMES SCREEN ====== */

async function renderGames() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }

  closeLobbyWS();

  let tournamentHTML = "";

  try {
    const res = await fetch(API + "/tournament/active");
    const t = await res.json();

    if (t.ok && t.tournament) {
      tournamentHTML = `
        <section class="block">
          <div class="block-title">АКТИВНЫЙ ТУРНИР</div>
          <div class="tournament-banner">
            <div class="tournament-text">
              <div class="tournament-title">${t.tournament.name}</div>
              <div class="tournament-modes">${(t.tournament.modes || []).join(", ")}</div>
              <button class="btn btn-secondary" onclick="renderTournament()">Открыть турнир</button>
            </div>
            <div class="tournament-image">картинка</div>
          </div>
        </section>
      `;
    }
  } catch (e) {
    console.log("tournament error", e);
  }

  const mixModeToday = getTodayMixMode();
  const mixModeText =
    mixModeToday === "meteor_fall"
      ? "Уклоняйся от метеоритов!"
      : "Красочная арена!";

  const mixTimerText = formatDiffToMidnightFull();

  root.innerHTML = `
    ${tournamentHTML}

    <section class="block">
      <div class="block-title">Режимы</div>
    </section>

    <article class="game-card" onclick="openBetSheet('ice_arena')">
      <div class="game-info">
        <div class="game-title">Ice Arena</div>
        <div class="game-desc">Классическая арена: сектора игроков, шайба и один победитель.</div>
      </div>
      <div class="game-image game-ice">картинка</div>
    </article>

    <article class="game-card" onclick="openBetSheet('knockout')">
      <div class="game-info">
        <div class="game-title">Выбывание</div>
        <div class="game-desc">Стенки исчезают, остаётся один.</div>
      </div>
      <div class="game-image game-knockout">картинка</div>
    </article>

    <article class="game-card" onclick="openBetSheet('wheel')">
      <div class="game-info">
        <div class="game-title">Кольцо</div>
        <div class="game-desc">Рулетка шанса.</div>
      </div>
      <div class="game-image game-wheel">картинка</div>
    </article>

    <article class="game-card" onclick="openBetSheet('race_balls')">
      <div class="game-info">
        <div class="game-title">Гонка шаров</div>
        <div class="game-desc">Чей шар приедет первым?</div>
      </div>
      <div class="game-image game-race">картинка</div>
    </article>

    <article class="game-card" onclick="openBetSheet('color_arena')">
      <div class="game-info">
        <div class="game-title">Красочная арена</div>
        <div class="game-desc">Закрась больше всех.</div>
      </div>
      <div class="game-image game-color">картинка</div>
    </article>

    <article class="game-card" onclick="openBetSheet('mix_mode')">
      <div class="game-info">
        <div class="game-title">Микс режим</div>
        <div class="game-desc">${mixModeText}</div>
        <div class="mix-timer" id="mix-timer">Смена режима через ${mixTimerText}</div>
      </div>
      <div class="game-image game-mix">картинка</div>
    </article>

    <section class="block">
      <div class="block-title">История игр</div>
      <div id="history-list" class="text-muted">Загрузка...</div>
    </section>
  `;

  const mixTimerEl = document.getElementById("mix-timer");
  if (mixTimerEl) {
    mixTimerInterval = setInterval(() => {
      mixTimerEl.innerText =
        "Смена режима через " + formatDiffToMidnightFull();
    }, 1000);
  }

  loadHistory();
}

/* ====== HISTORY ====== */

async function loadHistory() {
  const el = document.getElementById("history-list");
  if (!el) return;

  try {
    const res = await fetch(API + "/games/history?limit=20");
    const data = await res.json();
    if (!data.ok) {
      el.innerText = "Ошибка загрузки истории";
      return;
    }

    if (!data.games || data.games.length === 0) {
      el.innerText = "Пока нет завершённых игр";
      return;
    }

    el.innerHTML = data.games
      .map(
        (g) => `
        <div class="history-row">
          <div>
            <div class="history-title">#${g.id} • ${g.mode}</div>
            <div class="history-sub">Банк: ${g.bank} ⭐ • Победитель: @${g.winner_username || "?"}</div>
          </div>
          ${
            ["ice_arena", "race_balls", "knockout", "color_arena", "meteor_fall"].includes(
              g.mode
            )
              ? `<button class="btn btn-secondary btn-xs" onclick="openReplay(${g.id})">Повтор</button>`
              : ""
          }
        </div>
      `
      )
      .join("");
  } catch (e) {
    el.innerText = "Ошибка истории";
  }
}

async function openReplay(gameId) {
  try {
    const res = await fetch(API + "/games/replay/" + gameId);
    const data = await res.json();
    if (!data.ok || !data.game) {
      alertInApp("Повтор недоступен");
      return;
    }

    const game = data.game;

    const root = document.getElementById("screen-content");
    if (!root) return;

    closeLobbyWS();
    if (mixTimerInterval) {
      clearInterval(mixTimerInterval);
      mixTimerInterval = null;
    }

    root.innerHTML = `
      <section class="block">
        <div class="block-title">Повтор игры #${game.id}</div>
        <div class="text-muted">Режим: ${game.mode} • Банк: ${game.bank} ⭐</div>
      </section>

      <section class="block">
        <canvas id="replay-canvas" width="260" height="260" style="width:100%;max-width:260px;display:block;margin:0 auto;border-radius:16px;background:#111;"></canvas>
      </section>

      <section class="block">
        <button class="btn" onclick="playReplay('${game.mode}', ${JSON.stringify(
          game.replay
        ).replace(/"/g, "&quot;")})">Проиграть ещё раз</button>
        <button class="btn btn-secondary" onclick="setTab('games')">Назад</button>
      </section>
    `;

    playReplay(game.mode, game.replay);
  } catch (e) {
    alertInApp("Ошибка повтора");
  }
}

/* ====== BET SHEET (ставки) ====== */

let betSheetStartY = null;
let betSheetCurrentY = 0;

function openBetSheet(mode) {
  selectedGameMode = mode;
  selectedBet = 50;

  const overlay = document.getElementById("bet-overlay");
  const sheet = document.getElementById("bet-sheet");
  if (!overlay || !sheet) return;

  overlay.classList.remove("hidden");
  sheet.style.transform = "translateY(0)";

  document
    .querySelectorAll(".bet-option")
    .forEach((b) => b.classList.remove("bet-option-active"));
  const def = document.querySelector('.bet-option[data-value="50"]');
  if (def) def.classList.add("bet-option-active");

  const customInput = document.getElementById("bet-custom");
  if (customInput) customInput.value = "";

  overlay.addEventListener(
    "click",
    (e) => {
      if (e.target === overlay) {
        closeBetSheet();
      }
    },
    { once: true }
  );

  sheet.addEventListener("touchstart", onBetSheetTouchStart, { passive: true });
  sheet.addEventListener("touchmove", onBetSheetTouchMove, { passive: true });
  sheet.addEventListener("touchend", onBetSheetTouchEnd, { passive: true });
}

function closeBetSheet() {
  const overlay = document.getElementById("bet-overlay");
  const sheet = document.getElementById("bet-sheet");
  if (!overlay || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => {
    overlay.classList.add("hidden");
    sheet.style.transform = "translateY(0)";
  }, 180);
}

function onBetSheetTouchStart(e) {
  betSheetStartY = e.touches[0].clientY;
  betSheetCurrentY = 0;
}

function onBetSheetTouchMove(e) {
  if (betSheetStartY === null) return;
  const y = e.touches[0].clientY;
  const diff = y - betSheetStartY;
  if (diff > 0) {
    betSheetCurrentY = diff;
    const sheet = document.getElementById("bet-sheet");
    if (sheet) {
      sheet.style.transform = `translateY(${diff}px)`;
    }
  }
}

function onBetSheetTouchEnd() {
  const threshold = 80;
  if (betSheetCurrentY > threshold) {
    closeBetSheet();
  } else {
    const sheet = document.getElementById("bet-sheet");
    if (sheet) {
      sheet.style.transform = "translateY(0)";
    }
  }
  betSheetStartY = null;
  betSheetCurrentY = 0;
}

function selectBet(value) {
  selectedBet = Number(value);
  document
    .querySelectorAll(".bet-option")
    .forEach((b) => b.classList.remove("bet-option-active"));
  const btn = document.querySelector(`.bet-option[data-value="${value}"]`);
  if (btn) btn.classList.add("bet-option-active");
}

function onBetCustomChange() {
  const input = document.getElementById("bet-custom");
  if (!input) return;
  const val = Number(input.value || 0);
  if (val > 0) {
    selectedBet = val;
    document
      .querySelectorAll(".bet-option")
      .forEach((b) => b.classList.remove("bet-option-active"));
  }
}

async function confirmBetAndJoin() {
  if (!selectedGameMode) {
    closeBetSheet();
    return;
  }
  const bet = selectedBet || 1;
  closeBetSheet();

  let modeToJoin = selectedGameMode;
  if (modeToJoin === "mix_mode") {
    modeToJoin = getTodayMixMode();
  }

  await joinGame(modeToJoin, bet);
}

/* ====== JOIN GAME → LOBBY ====== */

async function joinGame(mode, bet) {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  try {
    const res = await fetch(API + "/game/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, username, mode, amount: bet || 1 })
    });

    const data = await res.json();

    if (!data.ok) {
      alertInApp("Ошибка: " + (data.error || "UNKNOWN"));
      return;
    }

    currentUser = data.user;
    const balEl = document.getElementById("header-balance");
    if (balEl && currentUser) {
      balEl.innerText = currentUser.stars_balance + " ⭐";
    }

    renderLobby(data.mode, data.game_id);
    openLobbyWS(data.game_id, data.mode);
  } catch (e) {
    alertInApp("Ошибка соединения");
  }
}

function renderLobby(mode, id) {
  const root = document.getElementById("screen-content");
  if (!root) return;

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }

  currentLobbyMode = mode;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Лобби</div>
      <div class="text-muted">Режим: ${mode}</div>
      <div class="text-muted">ID игры: ${id}</div>
      <div style="margin-top:10px;">Онлайн игроки:</div>
      <div id="lobby-players" class="text-muted" style="margin-top:4px;">подключение...</div>
    </section>

    <section class="block">
      <div class="block-title">Статус игры</div>
      <div id="lobby-status" class="text-muted">Ожидание игроков...</div>
      ${
        mode === "ice_arena"
          ? `<canvas id="ice-canvas" width="260" height="260" style="width:100%;max-width:260px;display:block;margin:12px auto;border-radius:50%;background:#111;"></canvas>`
          : ""
      }
      ${
        mode === "race_balls"
          ? `<canvas id="race-canvas" width="260" height="260" style="width:100%;max-width:260px;display:block;margin:12px auto;border-radius:16px;background:#111;"></canvas>`
          : ""
      }
      ${
        mode === "knockout"
          ? `<canvas id="knockout-canvas" width="260" height="260" style="width:100%;max-width:260px;display:block;margin:12px auto;border-radius:16px;background:#111;"></canvas>`
          : ""
      }
      ${
        mode === "color_arena"
          ? `<canvas id="color-canvas" width="260" height="260" style="width:100%;max-width:260px;display:block;margin:12px auto;border-radius:16px;background:#111;"></canvas>`
          : ""
      }
      ${
        mode === "meteor_fall"
          ? `<canvas id="meteor-canvas" width="260" height="260" style="width:100%;max-width:260px;display:block;margin:12px auto;border-radius:16px;background:#111;"></canvas>`
          : ""
      }
    </section>

    <section class="block">
      <button class="btn btn-secondary" onclick="leaveLobbyAndBack()">Назад</button>
    </section>
  `;
}

function leaveLobbyAndBack() {
  closeLobbyWS();
  setTab("games");
}

/* ====== WebSocket ====== */

function openLobbyWS(gameId, mode) {
  closeLobbyWS();
  currentLobbyGameId = gameId;
  currentLobbyMode = mode;

  const wsUrl =
    (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
    const username = tg?.initDataUnsafe?.user?.username || "guest";
    const avatar_url = tg?.initDataUnsafe?.user?.photo_url || null;

    ws.send(
      JSON.stringify({
        type: "join_lobby",
        game_id: gameId,
        telegram_id,
        username,
        avatar_url
      })
    );
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "lobby_state" && data.game_id === currentLobbyGameId) {
      const el = document.getElementById("lobby-players");
      if (!el) return;

      if (!data.players || data.players.length === 0) {
        el.innerText = "Пока никого нет...";
        return;
      }

      el.innerHTML = data.players
        .map(
          (p) => `
          <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
            <img src="${p.avatar_url || ""}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:#222;">
            <div>@${p.username || "player"}</div>
          </div>
        `
        )
        .join("");
    }

    if (data.type === "game_start" && data.game_id === currentLobbyGameId) {
      const st = document.getElementById("lobby-status");
      if (st) {
        st.innerText = "Игра началась! Идёт раунд...";
      }
    }

    if (data.type === "game_result" && data.game_id === currentLobbyGameId) {
      const st = document.getElementById("lobby-status");
      if (!st) return;

      const meId = tg?.initDataUnsafe?.user?.id || 0;
      const isMeWinner = data.winner_telegram_id === meId;

      st.innerHTML = `
        Победитель: @${data.winner_username || "player"}<br>
        Банк: ${data.bank} ⭐<br>
        ${isMeWinner ? "Ты забрал банк! 🔥" : "В этот раз не повезло."}
      `;

      if (data.mode && data.replay && data.players) {
        playReplay(data.mode, data.replay, data.players);
      }

      loadUser();
      loadHistory();
    }
  };

  ws.onclose = () => {
    ws = null;
  };

  ws.onerror = () => {
    alertInApp("Ошибка WebSocket");
  };
}

function closeLobbyWS() {
  currentLobbyGameId = null;
  currentLobbyMode = null;
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
}

/* ====== REPLAY RENDER ====== */

function playReplay(mode, replay, players, canvasId) {
  if (!replay || !replay.length) return;

  switch (mode) {
    case "ice_arena":
      playIceArenaReplay(replay, players, canvasId || "ice-canvas");
      break;
    case "race_balls":
      playRaceBallsReplay(replay, players, canvasId || "race-canvas");
      break;
    case "knockout":
      playKnockoutReplay(replay, players, canvasId || "knockout-canvas");
      break;
    case "color_arena":
      playColorArenaReplay(replay, players, canvasId || "color-canvas");
      break;
    case "meteor_fall":
      playMeteorReplay(replay, players, canvasId || "meteor-canvas");
      break;
    default:
      break;
  }
}

function playIceArenaReplay(replay, players, canvasId) {
  const id = canvasId || "replay-canvas";
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 20;

  const playersCount = players ? players.length : 0;

  let stepIndex = 0;

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 4;
    ctx.stroke();

    if (playersCount > 0) {
      const angleStep = (Math.PI * 2) / playersCount;
      for (let i = 0; i < playersCount; i++) {
        const angle = -Math.PI / 2 + i * angleStep;
        const x = cx + Math.cos(angle) * (radius + 10);
        const y = cy + Math.sin(angle) * (radius + 10);

        ctx.fillStyle = "#888";
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("@" + (players[i]?.username || "p" + i), x, y);
      }
    }

    const step = replay[stepIndex];
    if (!step) return;

    const idx = step.playerIndex ?? 0;
    const angleStep = playersCount > 0 ? (Math.PI * 2) / playersCount : 0;
    const angle = -Math.PI / 2 + idx * angleStep;

    const puckR = 10;
    const px = cx + Math.cos(angle) * (radius - 20);
    const py = cy + Math.sin(angle) * (radius - 20);

    ctx.beginPath();
    ctx.arc(px, py, puckR, 0, Math.PI * 2);
    ctx.fillStyle = step.isWinner ? "#ffcc00" : "#00bfff";
    ctx.fill();

    if (step.isWinner) {
      ctx.fillStyle = "#ffcc00";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WIN", px, py - 20);
    }
  }

  drawFrame();

  const interval = setInterval(() => {
    stepIndex++;
    if (stepIndex >= replay.length) {
      clearInterval(interval);
      return;
    }
    drawFrame();
  }, 120);
}

function playRaceBallsReplay(replay, players, canvasId) {
  const canvas = document.getElementById(canvasId || "replay-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;
  const trackHeight = 20;
  const margin = 10;
  const playersCount = players ? players.length : 0;

  let frameIndex = 0;

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    if (!replay[frameIndex]) return;
    const step = replay[frameIndex];

    for (let i = 0; i < playersCount; i++) {
      const y = margin + i * (trackHeight + 8);
      ctx.fillStyle = "#222";
      ctx.fillRect(margin, y, w - margin * 2, trackHeight);

      const pos = step.positions?.[i] ?? 0;
      const x = margin + pos * (w - margin * 2);

      ctx.beginPath();
      ctx.arc(x, y + trackHeight / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#00bfff";
      ctx.fill();

      ctx.fillStyle = "#aaa";
      ctx.font = "10px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("@" + (players[i]?.username || "p" + i), margin, y - 6);
    }

    if (step.winnerIndex != null) {
      const i = step.winnerIndex;
      const y = margin + i * (trackHeight + 8);
      const pos = step.positions?.[i] ?? 1;
      const x = margin + pos * (w - margin * 2);

      ctx.fillStyle = "#ffcc00";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("WIN", x, y - 4);
    }
  }

  drawFrame();

  const interval = setInterval(() => {
    frameIndex++;
    if (frameIndex >= replay.length) {
      clearInterval(interval);
      return;
    }
    drawFrame();
  }, 120);
}

function playKnockoutReplay(replay, players, canvasId) {
  const canvas = document.getElementById(canvasId || "replay-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 20;

  const playersCount = players ? players.length : 0;
  let stepIndex = 0;

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    const step = replay[stepIndex];
    if (!step) return;

    const alive = step.alive || new Array(playersCount).fill(true);

    ctx.beginPath();
    ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 3;
    ctx.stroke();

    const angleStep = (Math.PI * 2) / playersCount;
    for (let i = 0; i < playersCount; i++) {
      const angle = -Math.PI / 2 + i * angleStep;
      const r = radius - 10;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = alive[i] ? "#00bfff" : "#333";
      ctx.fill();

      ctx.fillStyle = "#aaa";
      ctx.font = "10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("@" + (players[i]?.username || "p" + i), x, y + 10);
    }

    if (step.winnerIndex != null) {
      const i = step.winnerIndex;
      const angle = -Math.PI / 2 + i * angleStep;
      const r = radius - 10;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      ctx.fillStyle = "#ffcc00";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("WIN", x, y - 14);
    }
  }

  drawFrame();

  const interval = setInterval(() => {
    stepIndex++;
    if (stepIndex >= replay.length) {
      clearInterval(interval);
      return;
    }
    drawFrame();
  }, 140);
}

function playColorArenaReplay(replay, players, canvasId) {
  const canvas = document.getElementById(canvasId || "replay-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;
  const gridSize = 8;
  const cellSize = Math.min(w, h) / gridSize;

  let stepIndex = 0;
  const grid = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(-1)
  );

  function colorForPlayer(i) {
    const colors = ["#ff4b4b", "#4b9bff", "#4bff7a", "#ffb84b", "#c44bff"];
    return colors[i % colors.length];
  }

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    const step = replay[stepIndex];
    if (!step) return;

    if (step.x != null && step.y != null && step.playerIndex != null) {
      if (
        step.y >= 0 &&
        step.y < gridSize &&
        step.x >= 0 &&
        step.x < gridSize
      ) {
        grid[step.y][step.x] = step.playerIndex;
      }
    }

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const owner = grid[y][x];
        if (owner >= 0) {
          ctx.fillStyle = colorForPlayer(owner);
        } else {
          ctx.fillStyle = "#222";
        }
        ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
      }
    }

    if (step.winnerIndex != null) {
      ctx.fillStyle = "#fff";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        "WIN: @" + (players[step.winnerIndex]?.username || "player"),
        w / 2,
        h - 6
      );
    }
  }

  drawFrame();

  const interval = setInterval(() => {
    stepIndex++;
    if (stepIndex >= replay.length) {
      clearInterval(interval);
      return;
    }
    drawFrame();
  }, 120);
}

function playMeteorReplay(replay, players, canvasId) {
  const canvas = document.getElementById(canvasId || "replay-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;
  const groundY = h - 40;
  const playersCount = players ? players.length : 0;

  let frameIndex = 0;

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#222";
    ctx.fillRect(0, groundY, w, 40);

    const step = replay[frameIndex];
    if (!step) return;

    const alive = step.alive || new Array(playersCount).fill(true);

    for (let i = 0; i < playersCount; i++) {
      const x = ((i + 1) / (playersCount + 1)) * w;
      const y = groundY - 10;

      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = alive[i] ? "#00bfff" : "#333";
      ctx.fill();

      ctx.fillStyle = "#aaa";
      ctx.font = "10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("@" + (players[i]?.username || "p" + i), x, y - 12);
    }

    const mx = step.meteorX * w;
    const my = step.meteorY * groundY;

    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ff4b4b";
    ctx.fill();

    if (step.hitIndex != null) {
      const i = step.hitIndex;
      const x = ((i + 1) / (playersCount + 1)) * w;
      const y = groundY - 10;

      ctx.strokeStyle = "#ff4b4b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (step.winnerIndex != null) {
      const i = step.winnerIndex;
      const x = ((i + 1) / (playersCount + 1)) * w;
      const y = groundY - 10;

      ctx.fillStyle = "#ffcc00";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("WIN", x, y - 18);
    }
  }

  drawFrame();

  const interval = setInterval(() => {
    frameIndex++;
    if (frameIndex >= replay.length) {
      clearInterval(interval);
      return;
    }
    drawFrame();
  }, 120);
}

/* ====== BALANCE ====== */

function renderBalance() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }
  closeLobbyWS();

  const stars = currentUser?.stars_balance ?? 0;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Ваш баланс</div>
      <div class="balance-value">${stars} ⭐</div>
    </section>

    <section class="block">
      <button class="btn" onclick="alertInApp('Пополнение позже')">Пополнить</button>
      <button class="btn btn-secondary" onclick="alertInApp('Вывод позже')">Вывести</button>
    </section>
  `;
}

/* ====== PROFILE + REF ====== */

function renderProfile() {
  const root = document.getElementById("screen-content");
  if (!root || !currentUser) return;

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }
  closeLobbyWS();

  const botUsername = tg?.initDataUnsafe?.bot?.username || "allpvpgames_bot";
  const refLink = `https://t.me/${botUsername}?start=ref_${currentUser.telegram_id}`;

  const refCount = currentUser.ref_count || 0;
  const refStars = currentUser.ref_earned_stars || 0;
  const refPercent = currentUser.ref_earned_percent || 0;
  const refPending =
    (currentUser.ref_pending_stars || 0) +
    (currentUser.ref_pending_percent || 0);

  const adminBadge = currentUser.is_admin ? " ⭐" : "";

  root.innerHTML = `
    <section class="block">
      <div class="block-title">
        Профиль${adminBadge}
        <span class="settings-icon-profile" onclick="openSettingsSheet()">⚙️</span>
        ${
          currentUser.is_admin
            ? `<span class="settings-icon-profile" style="margin-left:8px;" onclick="openAdminPanel()">😎</span>`
            : ""
        }
      </div>
      <div class="profile-row"><span>Username</span><span>@${currentUser.username}</span></div>
      <div class="profile-row"><span>Telegram ID</span><span>${currentUser.telegram_id}</span></div>
    </section>

    <section class="block">
      <div class="block-title">Реферальная программа</div>

      <div class="ref-block">
        <div class="ref-link">${refLink}</div>
        <button class="copy-btn" onclick="copyRef('${refLink}')">Скопировать ссылку</button>
      </div>

      <div class="profile-row"><span>Приглашено</span><span>${refCount}</span></div>
      <div class="profile-row"><span>Всего заработано звёзд</span><span>${refStars} ⭐</span></div>
      <div class="profile-row"><span>Всего заработано %</span><span>${refPercent} ⭐</span></div>
      <div class="profile-row"><span>Доступно к сбору</span><span>${refPending} ⭐</span></div>

      <button class="btn" style="margin-top:10px;" onclick="collectRef()">Собрать</button>

      <div class="text-muted" style="margin-top:8px;">
        +10 ⭐ за каждого реферала<br>
        +5% от всех игр реферала
      </div>
    </section>
  `;
}

function copyRef(text) {
  navigator.clipboard.writeText(text);
  alertInApp("Ссылка скопирована");
}

async function collectRef() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  if (!telegram_id) {
    alertInApp("Нет Telegram ID");
    return;
  }

  try {
    const res = await fetch(API + "/ref/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id })
    });

    const data = await res.json();
    if (!data.ok) {
      alertInApp("Ошибка: " + (data.error || "UNKNOWN"));
      return;
    }

    currentUser = data.user;
    const balEl = document.getElementById("header-balance");
    if (balEl && currentUser) {
      balEl.innerText = currentUser.stars_balance + " ⭐";
    }

    alertInApp("Собрано: " + data.collected + " ⭐");
    renderProfile();
  } catch (e) {
    alertInApp("Ошибка соединения");
  }
}

/* ====== SETTINGS SHEET ====== */

let sheetStartY = null;
let sheetCurrentY = 0;

function openSettingsSheet() {
  const overlay = document.getElementById("settings-overlay");
  const sheet = document.getElementById("settings-sheet");
  if (!overlay || !sheet) return;

  overlay.classList.remove("hidden");
  sheet.style.transform = "translateY(0)";

  overlay.addEventListener(
    "click",
    (e) => {
      if (e.target === overlay) {
        closeSettingsSheet();
      }
    },
    { once: true }
  );

  sheet.addEventListener("touchstart", onSheetTouchStart, { passive: true });
  sheet.addEventListener("touchmove", onSheetTouchMove, { passive: true });
  sheet.addEventListener("touchend", onSheetTouchEnd, { passive: true });
}

function closeSettingsSheet() {
  const overlay = document.getElementById("settings-overlay");
  const sheet = document.getElementById("settings-sheet");
  if (!overlay || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => {
    overlay.classList.add("hidden");
    sheet.style.transform = "translateY(0)";
  }, 180);
}

function onSheetTouchStart(e) {
  sheetStartY = e.touches[0].clientY;
  sheetCurrentY = 0;
}

function onSheetTouchMove(e) {
  if (sheetStartY === null) return;
  const y = e.touches[0].clientY;
  const diff = y - sheetStartY;
  if (diff > 0) {
    sheetCurrentY = diff;
    const sheet = document.getElementById("settings-sheet");
    if (sheet) {
      sheet.style.transform = `translateY(${diff}px)`;
    }
  }
}

function onSheetTouchEnd() {
  const threshold = 80;
  if (sheetCurrentY > threshold) {
    closeSettingsSheet();
  } else {
    const sheet = document.getElementById("settings-sheet");
    if (sheet) {
      sheet.style.transform = "translateY(0)";
    }
  }
  sheetStartY = null;
  sheetCurrentY = 0;
}

/* ====== ADMIN PANEL (username) ====== */

function openAdminPanel() {
  if (!currentUser?.is_admin) {
    alertInApp("Ты не админ");
    return;
  }

  const root = document.getElementById("screen-content");
  if (!root) return;

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }
  closeLobbyWS();

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Админ‑панель</div>
      <div class="text-muted">Telegram ID: ${currentUser.telegram_id}</div>
    </section>

    <section class="block">
      <div class="block-title">Отправить звёзды пользователю</div>
      <div class="profile-row">
        <span>Username</span>
        <input id="admin-target-username" type="text" style="width:140px;border-radius:8px;border:none;padding:4px 6px;" placeholder="username без @">
      </div>
      <div class="profile-row">
        <span>Сколько звёзд</span>
        <input id="admin-stars-amount" type="number" style="width:120px;border-radius:8px;border:none;padding:4px 6px;">
      </div>
      <button class="btn" onclick="adminSendStars()">Отправить</button>
    </section>

    <section class="block">
      <div class="block-title">Создать турнир</div>
      <div class="profile-row">
        <span>Название</span>
        <input id="admin-t-name" type="text" style="width:140px;border-radius:8px;border:none;padding:4px 6px;">
      </div>
      <div class="profile-row">
        <span>Режимы (через запятую)</span>
        <input id="admin-t-modes" type="text" style="width:140px;border-radius:8px;border:none;padding:4px 6px;" placeholder="ice_arena,knockout">
      </div>
      <div class="profile-row">
        <span>Призы (через запятую)</span>
        <input id="admin-t-prizes" type="text" style="width:140px;border-radius:8px;border:none;padding:4px 6px;" placeholder="100⭐,50⭐,25⭐">
      </div>
      <button class="btn" onclick="adminCreateTournament()">Создать турнир</button>
    </section>

    <section class="block">
      <div class="block-title">Создать особенную игру</div>
      <div class="profile-row">
        <span>Режим</span>
        <input id="admin-s-mode" type="text" style="width:140px;border-radius:8px;border:none;padding:4px 6px;" placeholder="special_mode">
      </div>
      <div class="profile-row">
        <span>Описание</span>
        <input id="admin-s-desc" type="text" style="width:140px;border-radius:8px;border:none;padding:4px 6px;">
      </div>
      <div class="profile-row">
        <span>ID игры (опц.)</span>
        <input id="admin-s-target" type="number" style="width:140px;border-radius:8px;border:none;padding:4px 6px;">
      </div>
      <div class="profile-row">
        <span>Длительность (сек)</span>
        <input id="admin-s-duration" type="number" style="width:140px;border-radius:8px;border:none;padding:4px 6px;">
      </div>
      <button class="btn" onclick="adminCreateSpecial()">Создать особую игру</button>
    </section>

    <section class="block">
      <button class="btn btn-secondary" onclick="setTab('profile')">Назад в профиль</button>
    </section>
  `;
}

async function adminSendStars() {
  const admin_telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const target_username =
    document.getElementById("admin-target-username").value.trim();
  const amount = Number(
    document.getElementById("admin-stars-amount").value || 0
  );

  if (!target_username || !amount) {
    alertInApp("Заполни username и сумму");
    return;
  }

  const res = await fetch(API + "/admin/send-stars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_telegram_id, target_username, amount })
  });

  const data = await res.json();
  if (!data.ok) {
    alertInApp("Ошибка: " + (data.error || "UNKNOWN"));
    return;
  }

  alertInApp("Звёзды отправлены");
}

async function adminCreateTournament() {
  const admin_telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const name = document.getElementById("admin-t-name").value || "Турнир";
  const modesStr = document.getElementById("admin-t-modes").value || "";
  const prizesStr = document.getElementById("admin-t-prizes").value || "";

  const modes = modesStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const prizes = prizesStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const res = await fetch(API + "/admin/create-tournament", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_telegram_id, name, modes, prizes })
  });

  const data = await res.json();
  if (!data.ok) {
    alertInApp("Ошибка: " + (data.error || "UNKNOWN"));
    return;
  }

  alertInApp("Турнир создан (ID " + data.id + ")");
}

async function adminCreateSpecial() {
  const admin_telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const mode = document.getElementById("admin-s-mode").value || "special";
  const description = document.getElementById("admin-s-desc").value || "";
  const target_game_id = Number(
    document.getElementById("admin-s-target").value || 0
  );
  const duration_seconds = Number(
    document.getElementById("admin-s-duration").value || 0
  );

  const res = await fetch(API + "/admin/create-special", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      admin_telegram_id,
      mode,
      description,
      target_game_id: target_game_id || null,
      duration_seconds: duration_seconds || null
    })
  });

  const data = await res.json();
  if (!data.ok) {
    alertInApp("Ошибка: " + (data.error || "UNKNOWN"));
    return;
  }

  alertInApp("Особая игра создана (ID " + data.id + ")");
}

/* ====== TOURNAMENT SCREEN ====== */

async function renderTournament() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }
  closeLobbyWS();

  try {
    const res = await fetch(API + "/tournament/active");
    const data = await res.json();

    if (!data.ok || !data.tournament) {
      alertInApp("Турнира нет");
      return;
    }

    const t = data.tournament;

    root.innerHTML = `
      <section class="block">
        <div class="block-title">${t.name}</div>
        <div class="text-muted">ID: ${t.id}</div>
      </section>

      <section class="block">
        <div class="block-title">Призы</div>
        ${(t.prizes || [])
          .map(
            (p, i) =>
              `<div class="profile-row"><span>${i + 1} место</span><span>${p}</span></div>`
          )
          .join("")}
      </section>

      <section class="block">
        <button class="btn btn-secondary" onclick="setTab('games')">Назад</button>
      </section>
    `;
  } catch (e) {
    alertInApp("Ошибка турнира");
  }
}

/* ====== TABS ====== */

function setTab(tab) {
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("nav-btn-active"));
  const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  if (btn) btn.classList.add("nav-btn-active");

  if (tab === "games") renderGames();
  if (tab === "balance") renderBalance();
  if (tab === "profile") renderProfile();
}

/* ====== INIT ====== */

(async function init() {
  await loadUser();
  await loadSettings();
  setTab("games");
})();
