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

/* ====== LOAD USER & SETTINGS ====== */

async function loadUser() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  try {
    const res = await fetch(API + "/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, username })
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
    if (data.ok) currentSettings = data;
  } catch (e) {
    console.log("settings error", e);
  }
}

/* ====== GAMES SCREEN ====== */

async function renderGames() {
  const root = document.getElementById("screen-content");
  if (!root) return;

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

  try {
    const res = await fetch(API + "/game/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, username, mode, amount: 1 })
    });

    const data = await res.json();

    if (!data.ok) {
      alertInApp("Ошибка: " + (data.error || "UNKNOWN"));
      return;
    }

    renderLobby(mode, data.game_id);
  } catch (e) {
    alertInApp("Ошибка соединения");
  }
}

function renderLobby(mode, id) {
  const root = document.getElementById("screen-content");
  if (!root) return;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Лобби</div>
      <div class="text-muted">Режим: ${mode}</div>
      <div class="text-muted">ID: ${id}</div>
      <div style="margin-top:10px;">Ожидание игроков...</div>
    </section>

    <section class="block">
      <button class="btn btn-secondary" onclick="setTab('games')">Назад</button>
    </section>
  `;
}

/* ====== BALANCE SCREEN ====== */

function renderBalance() {
  const root = document.getElementById("screen-content");
  if (!root) return;

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

/* ====== PROFILE + REFERRALS ====== */

function renderProfile() {
  const root = document.getElementById("screen-content");
  if (!root || !currentUser) return;

  const botUsername = tg?.initDataUnsafe?.bot?.username || "allpvpgames_bot";
  const refLink = `https://t.me/${botUsername}?start=ref_${currentUser.telegram_id}`;

  const refCount = currentUser.ref_count || 0;
  const refStars = currentUser.ref_earned_stars || 0;
  const refPercent = currentUser.ref_earned_percent || 0;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">
        Профиль
        <span class="settings-icon-profile" onclick="toggleProfileSettings()">⚙️</span>
      </div>
      <div class="profile-row"><span>Username</span><span>@${currentUser.username}</span></div>
    </section>

    <section class="settings-panel-profile" id="settings-panel-profile">
      <button class="settings-btn" onclick="alertInApp('Смена языка позже')">Сменить язык</button>
      <button class="settings-btn" onclick="alertInApp('Стример‑режим позже')">Стример‑режим</button>
      <button class="settings-btn" onclick="openAdminPanel()">Админ‑панель</button>
    </section>

    <section class="block">
      <div class="block-title">Реферальная система</div>

      <div class="ref-block">
        <div class="ref-link">${refLink}</div>
        <button class="copy-btn" onclick="copyRef('${refLink}')">Скопировать ссылку</button>
      </div>

      <div class="profile-row"><span>Приглашено</span><span>${refCount}</span></div>
      <div class="profile-row"><span>Заработано звёзд</span><span>${refStars} ⭐</span></div>
      <div class="profile-row"><span>Заработано %</span><span>${refPercent} ⭐</span></div>

      <div class="text-muted" style="margin-top:8px;">
        +10 ⭐ за каждого реферала<br>
        +5% от всех игр реферала
      </div>
    </section>
  `;
}

function toggleProfileSettings() {
  const p = document.getElementById("settings-panel-profile");
  if (!p) return;
  p.style.display = p.style.display === "block" ? "none" : "block";
}

function copyRef(text) {
  navigator.clipboard.writeText(text);
  alertInApp("Ссылка скопирована");
}

/* ====== ADMIN PANEL ====== */

function openAdminPanel() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Админ‑панель</div>
      <button class="btn" onclick="alertInApp('Создание турнира позже')">Создать турнир</button>
      <button class="btn" onclick="alertInApp('Управление играми позже')">Управление играми</button>
    </section>
  `;
}

/* ====== TOURNAMENT SCREEN ====== */

async function renderTournament() {
  const root = document.getElementById("screen-content");
  if (!root) return;

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
    .forEach(b => b.classList.remove("nav-btn-active"));
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
