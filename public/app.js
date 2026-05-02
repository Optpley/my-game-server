const API = window.location.origin + "/api";
let tg = window.Telegram?.WebApp;
tg?.expand?.();

let currentUser = null;
let currentSettings = null;
let mixTimerInterval = null;

/* ====== IN-APP ALERT ====== */

function alertInApp(text) {
  const box = document.createElement("div");
  box.className = "alert-box";
  box.innerText = text;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2200);
}

/* ====== TIME HELPERS (MSK, MIX) ====== */

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

function formatDiffToMidnight() {
  const now = getMoscowNow();
  const next = getNextMoscowMidnight();
  const diffMs = next - now;
  if (diffMs <= 0) return "00:00";

  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getTodayMixMode() {
  const msk = getMoscowNow();
  const startOfYear = new Date(msk.getFullYear(), 0, 0);
  const diff = msk - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const modes = ["meteor_fall", "color_wars"];
  const idx = dayOfYear % modes.length;
  return modes[idx];
}

/* ====== LOAD USER & SETTINGS ====== */

async function loadUser() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";
  const start_param = tg?.initDataUnsafe?.start_param || null;

  try {
    const res = await fetch(API + "/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, username, start_param })
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
      : "Красочные войны!";

  const mixTimerText = formatDiffToMidnight();

  root.innerHTML = `
    ${tournamentHTML}

    <article class="game-card" onclick="joinGame('ice_arena')">
      <div class="game-info">
        <div class="game-title">Ice Arena</div>
        <div class="game-desc">Классическое "тот, на ком остановится шайба — заберёт весь банк!"</div>
      </div>
      <div class="game-image game-ice">картинка</div>
    </article>

    <article class="game-card" onclick="joinGame('knockout')">
      <div class="game-info">
        <div class="game-title">Выбывание</div>
        <div class="game-desc">Стенка убирается, кто останется последним...?</div>
      </div>
      <div class="game-image game-knockout">картинка</div>
    </article>

    <article class="game-card" onclick="joinGame('wheel')">
      <div class="game-info">
        <div class="game-title">Колесо</div>
        <div class="game-desc">Выиграет ли шанс?</div>
      </div>
      <div class="game-image game-wheel">картинка</div>
    </article>

    <article class="game-card" onclick="joinGame('race_balls')">
      <div class="game-info">
        <div class="game-title">Гонка шаров</div>
        <div class="game-desc">Приедешь первым?</div>
      </div>
      <div class="game-image game-race">картинка</div>
    </article>

    <article class="game-card" onclick="joinGame('color_arena')">
      <div class="game-info">
        <div class="game-title">Красочная арена</div>
        <div class="game-desc">Закрась больше других</div>
      </div>
      <div class="game-image game-color">картинка</div>
    </article>

    <article class="game-card" onclick="joinGame('mix_mode')">
      <div class="game-info">
        <div class="game-title">Микс режим</div>
        <div class="game-desc">${mixModeText}</div>
        <div class="mix-timer" id="mix-timer">Смена режима через ${mixTimerText}</div>
      </div>
      <div class="game-image game-mix">картинка</div>
    </article>
  `;

  const mixTimerEl = document.getElementById("mix-timer");
  if (mixTimerEl) {
    mixTimerInterval = setInterval(() => {
      mixTimerEl.innerText = "Смена режима через " + formatDiffToMidnight();
    }, 60000);
  }
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

    currentUser = data.user;
    const balEl = document.getElementById("header-balance");
    if (balEl && currentUser) {
      balEl.innerText = currentUser.stars_balance + " ⭐";
    }

    renderLobby(mode, data.game_id);
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

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }

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

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }

  const botUsername = tg?.initDataUnsafe?.bot?.username || "allpvpgames_bot";
  const refLink = `https://t.me/${botUsername}?start=ref_${currentUser.telegram_id}`;

  const refCount = currentUser.ref_count || 0;
  const refStars = currentUser.ref_earned_stars || 0;
  const refPercent = currentUser.ref_earned_percent || 0;
  const refPending =
    (currentUser.ref_pending_stars || 0) +
    (currentUser.ref_pending_percent || 0);

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

function toggleProfileSettings() {
  const p = document.getElementById("settings-panel-profile");
  if (!p) return;
  p.style.display = p.style.display === "block" ? "none" : "block";
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

  if (mixTimerInterval) {
    clearInterval(mixTimerInterval);
    mixTimerInterval = null;
  }

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
