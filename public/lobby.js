// lobby.js

let tg = window.Telegram.WebApp;
if (tg && tg.expand) tg.expand();

let initDataUnsafe = tg && tg.initDataUnsafe ? tg.initDataUnsafe : {
  user: {
    id: 1,
    username: "testuser",
    first_name: "Test",
    last_name: "User",
    photo_url: null,
  },
};

let currentUser = null;
let ws = null;
let currentLobby = null;
let currentMode = null;
let currentBet = 20;

function $(id) {
  return document.getElementById(id);
}

function setAvatar(el, url) {
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
  } else {
    el.style.backgroundImage = "linear-gradient(135deg,#4f46e5,#06b6d4)";
  }
}

function alertInApp(msg) {
  const el = $("alert");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 2000);
}

async function fetchMe() {
  const res = await fetch("/api/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initDataUnsafe }),
  });
  const data = await res.json();
  if (!data.ok) return;
  currentUser = data.user;
}

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

    if (data.type === "lobby_state") {
      currentLobby = data.lobby;
      updateLobbyUI();
    }

    if (data.type === "game_result") {
      alertInApp("Игра #" + data.game.id + " завершена!");
      currentLobby = null;
      updateLobbyUI();
      startReplay(data.game);
    }

    if (data.type === "error") {
      alertInApp(data.message || "Ошибка");
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 2000);
  };
}

function joinLobby(bet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alertInApp("Нет соединения");
    return;
  }
  currentBet = bet;
  ws.send(
    JSON.stringify({
      type: "join_lobby",
      mode: currentMode,
      bet: bet,
    })
  );
}

function updateLobbyUI() {
  const bankEl = $("lobby-bank");
  const playersEl = $("lobby-players");
  const statusEl = $("lobby-status");
  const listEl = $("lobby-players-list");

  if (!currentLobby) {
    bankEl.textContent = "Банк - 0 ⭐";
    playersEl.textContent = "Игроки - 0/2 для старта";
    statusEl.textContent = "Ожидание игроков...";
    listEl.innerHTML = "";
    return;
  }

  const pot = currentLobby.bet * currentLobby.players.length;
  bankEl.textContent = "Банк - " + pot + " ⭐";
  playersEl.textContent =
    "Игроки - " + currentLobby.players.length + "/2 для старта";

  statusEl.textContent =
    currentLobby.status === "waiting" ? "Ожидание игроков..." : "Игра идёт...";

  listEl.innerHTML = "";
  currentLobby.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "lobby-player-row";

    const ava = document.createElement("div");
    ava.className = "lobby-player-avatar";
    setAvatar(ava, p.avatar);

    const name = document.createElement("div");
    name.className = "lobby-player-name";
    name.textContent = p.username ? "@" + p.username : p.name || "Игрок";

    row.appendChild(ava);
    row.appendChild(name);
    listEl.appendChild(row);
  });
}

// ===== История =====

let currentFilter = "latest";

async function loadHistory() {
  if (!currentUser) return;
  const res = await fetch(
    `/api/history?mode=${encodeURIComponent(
      currentMode
    )}&filter=${encodeURIComponent(
      currentFilter
    )}&userId=${encodeURIComponent(currentUser.id)}`
  );
  const data = await res.json();
  if (!data.ok) return;
  renderHistory(data.games);
}

function renderHistory(games) {
  const list = $("historyList");
  list.innerHTML = "";

  games.forEach((g) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-item-main";

    const winner = g.players.find((p) => p.id === g.winnerId);

    const ava = document.createElement("div");
    ava.className = "history-avatar";
    setAvatar(ava, winner ? winner.avatar : null);

    const text = document.createElement("div");
    const pot = g.bet * g.players.length;
    const date = new Date(g.createdAt);
    const timeStr =
      date.getHours().toString().padStart(2, "0") +
      ":" +
      date.getMinutes().toString().padStart(2, "0");

    text.innerHTML = `
      <div>#${g.id} • ${g.mode}</div>
      <div class="history-meta">
        Победитель: ${
          winner
            ? winner.username
              ? "@" + winner.username
              : winner.name
            : "?"
        }
      </div>
      <div class="history-meta">
        Выигрыш: ${pot}⭐ • Время: ${timeStr}
      </div>
    `;

    const btn = document.createElement("button");
    btn.className = "history-replay-btn";
    btn.textContent = "Повтор";
    btn.addEventListener("click", () => playReplayFromHistory(g.id));

    main.appendChild(ava);
    main.appendChild(text);
    item.appendChild(main);
    item.appendChild(btn);

    list.appendChild(item);
  });
}

// ===== Реплей =====

let replayTimer = null;

async function playReplayFromHistory(id) {
  const res = await fetch("/api/games/replay/" + id);
  const data = await res.json();
  if (!data.ok) {
    alertInApp("Повтор недоступен");
    return;
  }
  startReplay(data.game);
}

function startReplay(game) {
  $("replayOverlay").style.display = "flex";
  $("replayTitle").textContent = "Повтор #" + game.id + " • " + game.mode;

  const canvas = $("replayCanvas");
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
      el.style.opacity = f.alive ? "1" : "0.3";
    });

    frameIndex++;
  }, 200);
}

// ===== Init =====

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  currentMode = params.get("mode") || "ice_arena";

  await fetchMe();
  connectWS();

  document.querySelectorAll(".lobby-bet-btn").forEach((btn) => {
    const bet = btn.dataset.bet ? Number(btn.dataset.bet) : null;
    if (bet) {
      btn.addEventListener("click", () => joinLobby(bet));
    }
  });

  $("bet-custom").addEventListener("click", () => {
    const v = prompt("Введите свою ставку (звёзды):", "10");
    const n = Number(v);
    if (!n || n <= 0) return;
    joinLobby(n);
  });

  $("historyBtn").addEventListener("click", () => {
    $("historyOverlay").style.display = "flex";
    currentFilter = "latest";
    document
      .querySelectorAll(".history-filter-btn")
      .forEach((b) =>
        b.classList.toggle(
          "history-filter-active",
          b.dataset.filter === "latest"
        )
      );
    loadHistory();
  });

  $("historyClose").addEventListener("click", () => {
    $("historyOverlay").style.display = "none";
  });

  document.querySelectorAll(".history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      document
        .querySelectorAll(".history-filter-btn")
        .forEach((b) =>
          b.classList.toggle("history-filter-active", b === btn)
        );
      loadHistory();
    });
  });

  $("replayClose").addEventListener("click", () => {
    $("replayOverlay").style.display = "none";
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = null;
  });
});

