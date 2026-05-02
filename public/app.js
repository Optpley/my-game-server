const API = window.location.origin + "/api";
let tg = window.Telegram?.WebApp;
tg?.expand?.();

let currentUser = null;
let currentSettings = null;

// ====== ВСПОМОГАТЕЛЬНЫЕ ======

function setActiveTab(tab) {
  document
    .querySelectorAll(".nav-btn")
    .forEach(el => el.classList.remove("nav-btn-active"));
  document
    .querySelector(`.nav-btn[data-tab="${tab}"]`)
    ?.classList.add("nav-btn-active");
}

function setHeaderBalance() {
  const el = document.getElementById("header-balance");
  if (!el || !currentUser) return;
  el.innerText = `Баланс: ${currentUser.stars_balance} ⭐`;
}

// ====== ЗАГРУЗКА ДАННЫХ ======

async function loadProfileAndSettings() {
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
    console.log("profile error", e);
  }

  try {
    const res2 = await fetch(API + "/settings");
    const data2 = await res2.json();
    if (data2.ok) currentSettings = data2;
  } catch (e) {
    console.log("settings error", e);
  }

  setHeaderBalance();
}

// ====== ЭКРАН: ИГРЫ (как на макете) ======

function renderGamesScreen() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  root.innerHTML = `
    <section class="block">
      <div class="block-header">
        <div class="block-title">АКТИВНЫЙ ТУРНИР</div>
        <span class="badge">Stars</span>
      </div>
      <div class="tournament-banner">
        <div class="tournament-text">
          <div class="tournament-title">Ice Arena и Гонка Шаров</div>
          <div class="tournament-modes">Ставь звёзды в выбранных режимах и поднимайся в таблице лидеров.</div>
          <div class="tournament-timer">Смена режима через <span id="tournament-timer">12:07</span></div>
          <button class="btn-small btn-secondary" onclick="openTournamentScreen()">Открыть турнир</button>
        </div>
        <div class="tournament-image">
          картинка<br/>турнира
        </div>
      </div>
    </section>

    <section class="block">
      <div class="block-header">
        <div class="block-title">Режимы</div>
        <span class="badge">PvP</span>
      </div>
      <div class="block-subtitle">Выбери игру — справа будет картинка, позже подберём реальные арты.</div>
    </section>

    <section class="games-list">
      <article class="game-card">
        <div class="game-info">
          <div class="game-title">Ice Arena</div>
          <div class="game-desc">Классическое "тот, на ком остановится шайба — заберёт весь банк!"</div>
          <div class="game-meta">Режим: арена, 2–8 игроков</div>
          <button class="btn-small btn" onclick="joinGame('ice_arena')">Играть</button>
        </div>
        <div class="game-image game-ice">
          картинка<br/>игры
        </div>
      </article>

      <article class="game-card">
        <div class="game-info">
          <div class="game-title">Выбывание</div>
          <div class="game-desc">Стенка убирается, кто останется последним...?</div>
          <div class="game-meta">Режим: выживание</div>
          <button class="btn-small btn" onclick="joinGame('knockout')">Играть</button>
        </div>
        <div class="game-image game-knockout">
          картинка<br/>игры
        </div>
      </article>

      <article class="game-card">
        <div class="game-info">
          <div class="game-title">Колесо</div>
          <div class="game-desc">Выиграет ли шанс? Классический рандом с сектором удачи.</div>
          <div class="game-meta">Режим: колесо</div>
          <button class="btn-small btn" onclick="joinGame('wheel')">Играть</button>
        </div>
        <div class="game-image game-wheel">
          картинка<br/>игры
        </div>
      </article>

      <article class="game-card">
        <div class="game-info">
          <div class="game-title">Гонка шаров</div>
          <div class="game-desc">Приедешь первым? Ставка на траекторию и скорость.</div>
          <div class="game-meta">Режим: гонка</div>
          <button class="btn-small btn" onclick="joinGame('race_balls')">Играть</button>
        </div>
        <div class="game-image game-race">
          картинка<br/>игры
        </div>
      </article>

      <article class="game-card">
        <div class="game-info">
          <div class="game-title">Красочная арена</div>
          <div class="game-desc">Закрась больше других — территория решает всё.</div>
          <div class="game-meta">Режим: цветовая битва</div>
          <button class="btn-small btn" onclick="joinGame('color_arena')">Играть</button>
        </div>
        <div class="game-image game-color">
          картинка<br/>игры
        </div>
      </article>

      <article class="game-card">
        <div class="game-info">
          <div class="game-title">Микс режим</div>
          <div class="game-desc">Уклоняйся от метеоритов! Смена режима каждые N секунд.</div>
          <div class="game-meta">Режим: микс</div>
          <button class="btn-small btn" onclick="joinGame('mix_mode')">Играть</button>
        </div>
        <div class="game-image game-mix">
          картинка<br/>игры
        </div>
      </article>
    </section>
  `;
}

// ====== ЭКРАН: БАЛАНС ======

function renderBalanceScreen() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  const stars = currentUser?.stars_balance ?? 0;
  const spent = currentUser?.total_stars_spent ?? 0;
  const won = currentUser?.total_stars_won ?? 0;
  const withdrawn = currentUser?.total_stars_withdrawn ?? 0;

  const rate = currentSettings?.stars_per_ton ?? 1000;
  const fee = currentSettings?.withdraw_fee_percent ?? 5;

  root.innerHTML = `
    <section class="block">
      <div class="block-header">
        <div class="block-title">Ваш баланс</div>
        <span class="badge">Звёзды</span>
      </div>
      <div class="balance-value">${stars} ⭐</div>
      <div class="balance-sub">~ ${(stars / rate).toFixed(4)} TON (1 TON = ${rate} ⭐)</div>
    </section>

    <section class="block">
      <div class="block-title">Действия</div>
      <button class="btn" onclick="alert('Пополнение через Stars / CryptoBot — позже')">Пополнить</button>
      <button class="btn btn-secondary" onclick="openWithdraw()">Вывести TON</button>
      <div class="text-muted" style="margin-top:8px;">
        Комиссия на вывод: ${fee}% от суммы в TON.
      </div>
    </section>

    <section class="block">
      <div class="block-title">Статистика</div>
      <div class="stat-row"><span>Потрачено звёзд</span><span>${spent}</span></div>
      <div class="stat-row"><span>Выиграно звёзд</span><span>${won}</span></div>
      <div class="stat-row"><span>Выведено звёзд</span><span>${withdrawn}</span></div>
    </section>
  `;
}

function openWithdraw() {
  alert("Тут будет экран вывода TON (можем дописать позже).");
}

// ====== ЭКРАН: ПРОФИЛЬ ======

function renderProfileScreen() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  const username = currentUser?.username || "guest";
  const tid = currentUser?.telegram_id || "-";

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Профиль</div>
      <div class="profile-row"><span>Username</span><span>@${username}</span></div>
      <div class="profile-row"><span>Telegram ID</span><span>${tid}</span></div>
    </section>

    <section class="block">
      <div class="block-title">Настройки</div>
      <button class="btn btn-secondary" onclick="alert('Смена языка позже')">Сменить язык</button>
      <button class="btn btn-secondary" onclick="alert('Стример‑режим позже')">Стример‑режим</button>
    </section>

    <section class="block">
      <div class="block-title">О проекте</div>
      <div class="text-muted">
        AllPvpGamesHub — хаб PvP‑игр, турниров и ставок на звёзды.
      </div>
    </section>
  `;
}

// ====== ЭКРАН: ТУРНИР ======

async function openTournamentScreen() {
  const root = document.getElementById("screen-content");
  if (!root) return;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Турнир</div>
      <div class="text-muted">Загрузка активного турнира...</div>
    </section>
  `;

  try {
    const res = await fetch(API + "/tournament/active");
    const data = await res.json();

    if (!data.ok || !data.tournament) {
      root.innerHTML = `
        <section class="block">
          <div class="block-title">Турнир</div>
          <div class="text-muted">Сейчас нет активного турнира.</div>
        </section>
      `;
      return;
    }

    const t = data.tournament;
    const prizes = t.prizes || [];
    const lb = t.leaderboard || [];

    let prizesHtml = "";
    if (Array.isArray(prizes)) {
      prizesHtml = prizes
        .map(
          (p, i) =>
            `<div class="stat-row"><span>${i + 1} место</span><span>${p}</span></div>`
        )
        .join("");
    }

    let lbHtml = "";
    if (Array.isArray(lb)) {
      lbHtml = lb
        .map(
          (row, i) =>
            `<div class="lb-row"><span>${i + 1}. ${row.username || "Игрок"}</span><span>${row.stars_placed} ⭐</span></div>`
        )
        .join("");
    }

    root.innerHTML = `
      <section class="block">
        <div class="block-header">
          <div class="block-title">${t.name}</div>
          <span class="badge">Активен</span>
        </div>
        <div class="block-subtitle">ID: ${t.id}</div>
      </section>

      <section class="block">
        <div class="block-title">Призы</div>
        ${prizesHtml || '<div class="text-muted">Призы не указаны</div>'}
      </section>

      <section class="block">
        <div class="block-title">Таблица лидеров</div>
        ${lbHtml || '<div class="text-muted">Пока нет участников</div>'}
      </section>
    `;
  } catch (e) {
    root.innerHTML = `
      <section class="block">
        <div class="block-title">Турнир</div>
        <div class="text-muted">Ошибка загрузки турнира.</div>
      </section>
    `;
  }
}

// ====== ВХОД В ИГРУ / ЛОББИ ======

async function joinGame(mode) {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";
  const amount = 1;

  try {
    const res = await fetch(API + "/game/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, username, mode, amount })
    });

    const data = await res.json();
    if (!data.ok) {
      alert("Ошибка: " + (data.error || "UNKNOWN"));
      return;
    }

    renderLobbyScreen(mode, data.game_id);
  } catch (e) {
    alert("Ошибка соединения с сервером");
  }
}

function renderLobbyScreen(mode, gameId) {
  const root = document.getElementById("screen-content");
  if (!root) return;

  root.innerHTML = `
    <section class="block">
      <div class="block-title">Лобби</div>
      <div class="block-subtitle">Режим: ${mode}</div>
      <div class="text-muted" style="margin-top:8px;">
        ID лобби: ${gameId}. Здесь позже будет список игроков, таймер и WebSocket‑обновления.
      </div>
    </section>

    <section class="block">
      <div class="block-title">Игроки</div>
      <div class="stat-row"><span>Вы</span><span>⭐ ставка сделана</span></div>
      <div class="stat-row text-muted"><span>Ожидание соперника...</span><span></span></div>
    </section>

    <section class="block">
      <button class="btn btn-secondary" onclick="setTab('games')">Выйти в игры</button>
    </section>
  `;
}

// ====== ПЕРЕКЛЮЧЕНИЕ ТАБОВ ======

function setTab(tab) {
  setActiveTab(tab);
  if (tab === "games") renderGamesScreen();
  if (tab === "balance") renderBalanceScreen();
  if (tab === "profile") renderProfileScreen();
}

// ====== ИНИЦИАЛИЗАЦИЯ ======

(async function init() {
  await loadProfileAndSettings();
  setTab("games");
})();
