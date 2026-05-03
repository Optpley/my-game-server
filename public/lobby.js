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
let currentBet = 50;

function $(id) {
  return document.getElementById(id);
}

function setAvatar(el, url) {
  el.style.backgroundImage = url
    ? `url("${url}")`
    : "linear-gradient(135deg,#4f46e5,#06b6d4)";
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
      // Игра произошла — анимация на арене, без отдельного окна
      playArenaGame(data.game);
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
  const arenaTitle = $("arenaTitle");

  if (!currentLobby) {
    bankEl.textContent = "Банк - 0 ⭐";
    playersEl.textContent = "Игроки - 0/2 для старта";
    statusEl.textContent = "Ожидание игроков...";
    listEl.innerHTML = "";
    arenaTitle.textContent = "Арена";
    clearArena();
    return;
  }

  const pot = currentLobby.bet * currentLobby.players.length;
  bankEl.textContent = "Банк - " + pot + " ⭐";
  playersEl.textContent =
    "Игроки - " + currentLobby.players.length + "/2 для старта";

  statusEl.textContent =
    currentLobby.status === "waiting" ? "Ожидание игроков..." : "Игра идёт...";

  arenaTitle.textContent =
    currentMode === "ice_arena"
      ? "Арена"
      : currentMode === "elimination"
      ? "Выбивание"
      : currentMode === "color_arena"
      ? "Красочная арена"
      : "Гонка шаров";

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

  // В выбивании и цветной арене — шары стоят на арене
  if (
    currentLobby.status === "waiting" &&
    (currentMode === "elimination" || currentMode === "color_arena")
  ) {
    drawStaticBalls(currentLobby.players);
  } else if (currentLobby.status === "waiting" && currentMode === "ice_arena") {
    drawTerritories(currentLobby.players);
  }
}

// ===== АРЕНА =====

let arenaTimer = null;

function clearArena() {
  const arena = $("arena");
  Array.from(arena.querySelectorAll(".replay-player, .arena-territory")).forEach(
    (el) => el.remove()
  );
  if (arenaTimer) {
    clearInterval(arenaTimer);
    arenaTimer = null;
  }
}

function drawStaticBalls(players) {
  clearArena();
  const arena = $("arena");
  const width = arena.clientWidth;
  const height = arena.clientHeight;

  players.forEach((p, idx) => {
    const el = document.createElement("div");
    el.className = "replay-player";
    el.textContent = idx + 1;
    const angle = (idx / players.length) * Math.PI * 2;
    const r = Math.min(width, height) / 3;
    const cx = width / 2 + Math.cos(angle) * r;
    const cy = height / 2 + Math.sin(angle) * r;
    el.style.left = cx + "px";
    el.style.top = cy + "px";
    arena.appendChild(el);
  });
}

function drawTerritories(players) {
  clearArena();
  const arena = $("arena");
  const width = arena.clientWidth;
  const height = arena.clientHeight;

  players.forEach((p, idx) => {
    const terr = document.createElement("div");
    terr.className = "arena-territory";
    terr.style.position = "absolute";
    terr.style.top = "40px";
    terr.style.bottom = "10px";
    terr.style.border = "1px solid rgba(148,163,184,0.6)";
    terr.style.background =
      idx % 2 === 0
        ? "rgba(59,130,246,0.15)"
        : "rgba(244,63,94,0.15)";
    const w = width / players.length;
    terr.style.left = idx * w + "px";
    terr.style.width = w + "px";
    arena.appendChild(terr);

    const el = document.createElement("div");
    el.className = "replay-player";
    el.textContent = idx + 1;
    el.style.left = idx * w + w / 2 + "px";
    el.style.top = height / 2 + "px";
    arena.appendChild(el);
  });
}

function playArenaGame(game) {
  clearArena();
  const arena = $("arena");
  const width = arena.clientWidth;
  const height = arena.clientHeight;

  const players = game.players;
  const frames = game.replay || [];

  const playerEls = {};
  players.forEach((p, idx) => {
    const el = document.createElement("div");
    el.className = "replay-player";
    el.textContent = idx + 1;
    arena.appendChild(el);
    playerEls[p.id] = el;
  });

  let frameIndex = 0;
  if (arenaTimer) clearInterval(arenaTimer);

  arenaTimer = setInterval(() => {
    if (frameIndex >= frames.length) {
      clearInterval(arenaTimer);
      arenaTimer = null;
      return;
    }

    const frame = frames[frameIndex];
    frame.forEach((f) => {
      const el = playerEls[f.id];
      if (!el) return;

      const x = f.x / 100;
      const y = f.y / 100;

      el.style.left = 10 + x * (width - 30) + "px";
      el.style.top = 40 + y * (height - 60) + "px";
      el.style.opacity = f.alive ? "1" : "0.3";
    });

    frameIndex++;
  }, 80);
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

    main.appendChild(ava);
    main.appendChild(text);
    item.appendChild(main);

    list.appendChild(item);
  });
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
    $("bet-overlay").classList.remove("hidden");
  });
  $("bet-close").addEventListener("click", () => {
    $("bet-overlay").classList.add("hidden");
  });
  $("bet-apply").addEventListener("click", () => {
    const v = $("bet-input").value.trim();
    const n = Number(v);
    if (!n || n <= 0) {
      alertInApp("Некорректная ставка");
      return;
    }
    $("bet-overlay").classList.add("hidden");
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
});






