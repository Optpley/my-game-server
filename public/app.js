// app.js

const API_BASE = "";

// Telegram WebApp init
let tg = null;
let initDataUnsafe = null;
let currentUser = null;
let ws = null;

let currentTab = "games";
let currentHistorySort = "latest";
let currentModeHistorySort = "latest";
let currentModeForHistory = null;

let modes = [
  {
    id: "ice_arena",
    title: "Ice Arena",
    desc: "Классическая арена: сектора игроков, шайба и один победитель.",
  },
  {
    id: "elimination",
    title: "Выбывание",
    desc: "Каждый раунд выбывает один игрок, пока не останется победитель.",
  },
  {
    id: "ball_race",
    title: "Гонка шаров",
    desc: "Шары игроков катятся по трассе, кто первый — тот и победил.",
  },
  {
    id: "color_arena",
    title: "Красочная арена",
    desc: "Игроки захватывают цветные зоны, побеждает самый доминирующий.",
  },
  {
    id: "mix",
    title: "Микс режим",
    desc: "Смешение механик всех режимов в одном матче.",
  },
];

let selectedBets = {}; // modeId -> bet
let customBets = {}; // modeId -> customBet

let myGames = [];
let globalHistory = [];

// ====== UI helpers ======
function $(id) {
  return document.getElementById(id);
}

function alertInApp(msg) {
  const el = $("alert");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 2000);
}

function setAvatar(el, url) {
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
  } else {
    el.style.backgroundImage =
      "linear-gradient(135deg, #4f46e5, #06b6d4)";
  }
}

// ====== Tabs ======
function switchTab(tab) {
  currentTab = tab;
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document
    .querySelectorAll(".nav-btn")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document
    .querySelectorAll(".section")
    .forEach((s) =>
      s.classList.toggle("active", s.id === "section-" + tab)
    );
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ====== Render modes ======
function renderModes() {
  const container = $("modesContainer");
  container.innerHTML = "";

  modes.forEach((mode) => {
    const bet = selectedBets[mode.id] || 1;
    const custom = customBets[mode.id] || "";

    const card = document.createElement("div");
    card.className = "mode-card";

    const historyIcon = document.createElement("div");
    historyIcon.className = "history-icon";
    historyIcon.textContent = "⟳";
    historyIcon.addEventListener("click", () =>
      openModeHistory(mode.id)
    );
    card.appendChild(historyIcon);

    const header = document.createElement("div");
    header.className = "mode-header";
    const title = document.createElement("div");
    title.className = "mode-title";
    title.textContent = mode.title;
    const modeIdLabel = document.createElement("div");
    modeIdLabel.style.fontSize = "11px";
    modeIdLabel.style.color = "#9ca3af";
    modeIdLabel.textContent = "#" + mode.id;
    header.appendChild(title);
    header.appendChild(modeIdLabel);

    const desc = document.createElement("div");
    desc.className = "mode-desc";
    desc.textContent = mode.desc;

    const actions = document.createElement("div");
    actions.className = "mode-actions";

    const betsDiv = document.createElement("div");
    betsDiv.className = "bets";

    const presetBets = [1, 5, 10, 50, 100];
    presetBets.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "bet-btn" + (bet === b ? " active" : "");
      btn.textContent = b + "★";
      btn.addEventListener("click", () => {
        selectedBets[mode.id] = b;
        customBets[mode.id] = "";
        renderModes();
      });
      betsDiv.appendChild(btn);
    });

    const input = document.createElement("input");
    input.className = "bet-input";
    input.type = "number";
    input.placeholder = "Своя";
    input.value = custom;
    input.addEventListener("input", () => {
      const v = Number(input.value);
      customBets[mode.id] = v > 0 ? v : "";
      if (v > 0) {
        selectedBets[mode.id] = v;
      }
    });
    betsDiv.appendChild(input);

    const playBtn = document.createElement("button");
    playBtn.className = "btn-primary";
    playBtn.textContent = "Играть за " + bet + "★";
    playBtn.addEventListener("click", () => {
      joinLobby(mode.id);
    });

    actions.appendChild(betsDiv);
    actions.appendChild(playBtn);

    card.appendChild(header);
    card.appendChild(desc);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

// ====== WebSocket ======
function connectWS() {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = proto + "//" + loc.host;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "auth",
        initDataUnsafe,
      })
    );
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "auth_ok") {
      currentUser = data.user;
      updateUserUI();
      requestState();
    }
    if (data.type === "lobbies") {
      // можно отрисовать список лобби, если нужно
    }
    if (data.type === "user_games") {
      myGames = data.games;
      renderMyGames();
    }
    if (data.type === "game_result") {
      myGames.unshift(data.game);
      renderMyGames();
      fetchMe();
      alertInApp("Игра #" + data.game.id + " завершена!");
    }
    if (data.type === "error") {
      alertInApp(data.message || "Ошибка");
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 2000);
  };
}

function requestState() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "get_state" }));
}

function joinLobby(modeId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alertInApp("Нет соединения");
    return;
  }
  const bet = selectedBets[modeId] || 1;
  const custom = customBets[modeId] || null;
  ws.send(
    JSON.stringify({
      type: "join_lobby",
      mode: modeId,
      bet,
      customBet: custom,
    })
  );
}

// ====== API calls ======
async function fetchMe() {
  const res = await fetch(API_BASE + "/api/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initDataUnsafe }),
  });
  const data = await res.json();
  if (!data.ok) return;
  currentUser = data.user;
  updateUserUI();
}

async function fetchGlobalHistory(sort) {
  const res = await fetch(API_BASE + "/api/history?sort=" + sort);
  const data = await res.json();
  if (!data.ok) return;
  globalHistory = data.games;
  renderGlobalHistory();
}

async function fetchModeHistory(modeId, sort) {
  const res = await fetch(API_BASE + "/api/history?sort=" + sort);
  const data = await res.json();
  if (!data.ok) return;
  const list = data.games.filter((g) => g.mode === modeId);
  renderModeHistory(list);
}

// ====== UI: user ======
function updateUserUI() {
  if (!currentUser) return;
  $("userStars").textContent = currentUser.stars;
  $("profileStars").textContent = currentUser.stars;
  $("profileName").textContent = currentUser.name || "Игрок";
  $("profileUsername").textContent = currentUser.username
    ? "@" + currentUser.username
    : "без username";

  setAvatar($("userAvatar"), currentUser.avatar);
  setAvatar($("profileAvatar"), currentUser.avatar);
}

// ====== UI: history ======
function renderGlobalHistory() {
  const container = $("globalHistory");
  container.innerHTML = "";
  globalHistory.forEach((g) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const modeName =
      modes.find((m) => m.id === g.mode)?.title || g.mode;
    const pot = g.bet * g.players.length;
    const winner = g.players.find((p) => p.id === g.winnerId);

    item.innerHTML = `
      <div><b>#${g.id}</b> • ${modeName}</div>
      <div class="game-meta">
        Банк: ${pot}★ • Ставка: ${g.bet}★ • Игроков: ${
      g.players.length
    }
      </div>
      <div class="game-meta">
        Победитель: ${
          winner ? (winner.username ? "@" + winner.username : winner.name) : "?"
        }
      </div>
      <button class="btn-sm" data-replay-id="${g.id}">Повтор</button>
    `;
    const btn = item.querySelector("button");
    btn.addEventListener("click", () => playReplayFromHistory(g.id));
    container.appendChild(item);
  });
}

function renderModeHistory(list) {
  const container = $("modeHistoryList");
  container.innerHTML = "";
  list.forEach((g) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const modeName =
      modes.find((m) => m.id === g.mode)?.title || g.mode;
    const pot = g.bet * g.players.length;
    const winner = g.players.find((p) => p.id === g.winnerId);

    item.innerHTML = `
      <div><b>#${g.id}</b> • ${modeName}</div>
      <div class="game-meta">
        Банк: ${pot}★ • Ставка: ${g.bet}★ • Игроков: ${
      g.players.length
    }
      </div>
      <div class="game-meta">
        Победитель: ${
          winner ? (winner.username ? "@" + winner.username : winner.name) : "?"
        }
      </div>
      <button class="btn-sm" data-replay-id="${g.id}">Повтор</button>
    `;
    const btn = item.querySelector("button");
    btn.addEventListener("click", () => playReplayFromHistory(g.id));
    container.appendChild(item);
  });
}

// ====== UI: my games ======
function renderMyGames() {
  const container = $("myGames");
  container.innerHTML = "";
  myGames.forEach((g) => {
    const item = document.createElement("div");
    item.className = "game-item";
    const modeName =
      modes.find((m) => m.id === g.mode)?.title || g.mode;
    const pot = g.bet * g.players.length;
    const winner = g.players.find((p) => p.id === g.winnerId);

    const main = document.createElement("div");
    main.className = "game-main";
    main.innerHTML = `
      <div><b>#${g.id}</b> • ${modeName}</div>
      <div class="game-meta">
        Банк: ${pot}★ • Ставка: ${g.bet}★ • Игроков: ${
      g.players.length
    }
      </div>
      <div class="game-meta">
        Победитель: ${
          winner ? (winner.username ? "@" + winner.username : winner.name) : "?"
        }
      </div>
    `;

    const btn = document.createElement("button");
    btn.className = "btn-sm";
    btn.textContent = "Повтор";
    btn.addEventListener("click", () => playReplayFromHistory(g.id));

    item.appendChild(main);
    item.appendChild(btn);
    container.appendChild(item);
  });
}

// ====== History popup ======
function openModeHistory(modeId) {
  currentModeForHistory = modeId;
  currentModeHistorySort = "latest";
  document
    .querySelectorAll("#historyPopup .sort-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.sort === "latest")
    );
  $("historyPopup").classList.add("active");
  fetchModeHistory(modeId, "latest");
}

$("historyClose").addEventListener("click", () => {
  $("historyPopup").classList.remove("active");
});

document
  .querySelectorAll("#historyPopup .sort-btn")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      currentModeHistorySort = btn.dataset.sort;
      document
        .querySelectorAll("#historyPopup .sort-btn")
        .forEach((b) =>
          b.classList.toggle("active", b === btn)
        );
      if (currentModeForHistory) {
        fetchModeHistory(currentModeForHistory, currentModeHistorySort);
      }
    });
  });

document
  .querySelectorAll("#section-history .sort-btn")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      currentHistorySort = btn.dataset.sort;
      document
        .querySelectorAll("#section-history .sort-btn")
        .forEach((b) =>
          b.classList.toggle("active", b === btn)
        );
      fetchGlobalHistory(currentHistorySort);
    });
  });

// ====== Replay ======
let replayData = null;
let replayTimer = null;

async function playReplayFromHistory(id) {
  const res = await fetch(API_BASE + "/api/games/replay/" + id);
  const data = await res.json();
  if (!data.ok) {
    alertInApp("Повтор недоступен");
    return;
  }
  startReplay(data.game);
}

function startReplay(game) {
  replayData = game;
  $("replayTitle").textContent =
    "Повтор #" + game.id + " • " + (modes.find((m) => m.id === game.mode)?.title || game.mode);
  $("replayOverlay").classList.add("active");

  const canvas = $("replayCanvas");
  // очистим старых игроков
  Array.from(canvas.querySelectorAll(".replay-player")).forEach((el) =>
    el.remove()
  );

  const players = game.players;
  const frames = game.replay || [];
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  const playerEls = {};
  players.forEach((p, idx) => {
    const el = document.createElement("div");
    el.className = "replay-player";
    el.textContent = idx + 1;
    canvas.appendChild(el);
    playerEls[p.id] = el;
  });

  let frameIndex = 0;
  if (replayTimer) clearInterval(replayTimer);

  replayTimer = setInterval(() => {
    if (frameIndex >= frames.length) {
      clearInterval(replayTimer);
      replayTimer = null;
      return;
    }
    const frame = frames[frameIndex];
    frame.forEach((f) => {
      const el = playerEls[f.id];
      if (!el) return;
      const x = Math.min(1, f.pos / 100);
      const yIndex = players.findIndex((p) => p.id === f.id);
      const y = (yIndex + 1) / (players.length + 1);
      el.style.left = 10 + x * (width - 30) + "px";
      el.style.top = 40 + y * (height - 60) + "px";
    });
    frameIndex++;
  }, 200);
}

$("replayClose").addEventListener("click", () => {
  $("replayOverlay").classList.remove("active");
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
});

// ====== Admin ======
$("adminGiveBtn").addEventListener("click", async () => {
  const secret = $("adminSecret").value.trim();
  const username = $("adminUsername").value.trim();
  const amount = Number($("adminAmount").value);
  if (!username || !amount) {
    alertInApp("Заполни username и сумму");
    return;
  }

  const res = await fetch(API_BASE + "/api/admin/give-stars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adminSecret: secret,
      username,
      amount,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    alertInApp("Ошибка админки: " + (data.error || ""));
    return;
  }
  alertInApp("Выдано, новый баланс: " + data.user.stars + "★");
  if (currentUser && currentUser.id === data.user.id) {
    currentUser.stars = data.user.stars;
    updateUserUI();
  }
});

// ====== Init Telegram / App ======
function initApp() {
  if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;
    tg.ready();
    initDataUnsafe = tg.initDataUnsafe || {};
  } else {
    // для теста в браузере
    initDataUnsafe = {
      user: {
        id: 1,
        username: "testuser",
        first_name: "Test",
        last_name: "User",
        photo_url: null,
      },
    };
  }

  renderModes();
  fetchMe();
  fetchGlobalHistory("latest");
  connectWS();
}

document.addEventListener("DOMContentLoaded", initApp);


