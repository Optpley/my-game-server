const API = window.location.origin + "/api";
let tg = window.Telegram?.WebApp;
tg?.expand?.();

let currentUser = null;
let currentSettings = null;

/* ====== IN-APP ALERT ====== */

function alertInApp(text) {
  const box = document.createElement("div");
  box.className = "alert-box";
  box.innerText = text;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2200);
}

/* ====== SETTINGS ====== */

function toggleSettings() {
  const panel = document.getElementById("settings-panel");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
}

/* ====== LOAD USER ====== */

async function loadUser() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  const res = await fetch(API + "/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id, username })
  });

  const data = await res.json();
  if (data.ok) currentUser = data.user;

  document.getElementById("header-balance").innerText =
    currentUser.stars_balance + " ⭐";
}

async function loadSettings() {
  const res = await fetch(API + "/settings");
  const data = await res.json();
  if (data.ok) currentSettings = data;
}

/* ====== RENDER: GAMES ====== */

async function renderGames() {
  const root = document.getElementById("screen-content");

  // Load tournament
  const res = await fetch(API + "/tournament/active");
  const t = await res.json();

  let tournamentHTML = "";

  if (t.ok && t.tournament) {
    tournamentHTML = `
      <section class="block">
        <div class="block-title">АКТИВНЫЙ ТУРНИР</div>
        <div class="tournament-banner">
          <div class="tournament-text">
            <div class="tournament-title">${t.tournament.name}</div>
            <div class="tournament-modes">${t.tournament.modes.join(", ")}</div>
            <button class="btn-secondary btn" onclick="renderTournament()">Открыть турнир</button>
          </div>
          <div class="tournament-image">картинка</div>
        </div>
      </section>
    `;
  }

  root.innerHTML = `
    ${tournamentHTML}

    <article class="game-card">
      <div class="game-info">
        <div class="game-title">Ice Arena</div>
        <div class="game-desc">Классическое "тот, на ком остановится шайба — заберёт весь банк!"</div>
        <button class="btn" onclick="joinGame('ice_arena')">Играть</button>
      </div>
      <div class="game-image game-ice">картинка</div>
    </article>

    <article class="game-card">
      <div class="game-info">
        <div class="game-title">Выбывание</div>
        <div class="game-desc">Стенка убирается, кто останется последним...?</div>
        <button class="btn" onclick="joinGame('knockout')">Играть</button>
      </div>
      <div class="game-image game-knockout">картинка</div>
    </article>

    <article class="game-card">
      <div class="game-info">
        <div class="game-title">Колесо</div>
        <div class="game-desc">Выиграет ли шанс?</div>
        <button class="btn" onclick="joinGame('wheel')">Играть</button>
      </div>
      <div class="game-image game-wheel">картинка</div>
    </article>

    <article class="game-card">
      <div class="game-info">
        <div class="game-title">Гонка шаров</div>
        <div class="game-desc">Приедешь первым?</div>
        <button class="btn" onclick="joinGame('race_balls')">Играть</button>
      </div>
      <div class="game-image game-race">картинка</div>
    </article>

    <article class="game-card">
      <div class="game-info">
        <div class="game-title">Красочная арена</div>
        <div class="game-desc">Закрась больше других</div>
        <button class="btn" onclick="joinGame('color_arena')">Играть</button>
      </div>
      <div class="game-image game-color">картинка</div>
    </article>

    <article class="game-card">
      <div class="game-info">
        <div class="game-title">Микс режим</div>
        <div class="game-desc">Уклоняйся от метеоритов!</div>
        <button class="btn" onclick="joinGame('mix_mode')">Играть</button>
      </div>
      <div class="game-image game-mix">картинка</div>
    </article>
  `;
}

/* ====== JOIN GAME → LOBBY ====== */

async function joinGame(mode) {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  const res = await fetch(API + "/game/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id, username, mode, amount: 1 })
  });

  const data = await res.json();

  if (!data.ok) {
    alertInApp("Ошибка: " + data.error);
    return;
  }

  renderLobby(mode, data.game_id);
}

/* ====== LOBBY ====== */

function renderLobby(mode, id) {
  const root = document.getElementById("screen-content");

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Лобби</div>
      <div class="text-muted">Режим: ${mode}</div>
      <div class="text-muted">ID: ${id}</div>
      <div style="margin-top:10px;">Ожидание игроков...</div>
    </section>

    <section class="block">
      <button class="btn-secondary btn" onclick="setTab('games')">Назад</button>
    </section>
  `;
}

/* ====== BALANCE ====== */

function renderBalance() {
  const root = document.getElementById("screen-content");

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Ваш баланс</div>
      <div class="balance-value">${currentUser.stars_balance} ⭐</div>
    </section>

    <section class="block">
      <button class="btn" onclick="alertInApp('Пополнение позже')">Пополнить</button>
      <button class="btn-secondary btn" onclick="alertInApp('Вывод позже')">Вывести</button>
    </section>
  `;
}

/* ====== PROFILE ====== */

function renderProfile() {
  const root = document.getElementById("screen-content");

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Профиль</div>
      <div class="profile-row"><span>Username</span><span>@${currentUser.username}</span></div>
      <div class="profile-row"><span>ID</span><span>${currentUser.telegram_id}</span></div>
    </section>
  `;
}

/* ====== ADMIN PANEL ====== */

function openAdminPanel() {
  const root = document.getElementById("screen-content");

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Админ‑панель</div>
      <button class="btn" onclick="alertInApp('Создание турнира позже')">Создать турнир</button>
      <button class="btn" onclick="alertInApp('Управление играми позже')">Управление играми</button>
    </section>
  `;
}

/* ====== TOURNAMENT ====== */

async function renderTournament() {
  const root = document.getElementById("screen-content");

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
      ${t.prizes.map((p,i)=>`<div class="profile-row"><span>${i+1} место</span><span>${p}</span></div>`).join("")}
    </section>

    <section class="block">
      <button class="btn-secondary btn" onclick="setTab('games')">Назад</button>
    </section>
  `;
}

/* ====== TABS ====== */

function setTab(tab) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("nav-btn-active"));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add("nav-btn-active");

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
