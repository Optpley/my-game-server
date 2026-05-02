const API = window.location.origin + "/api";
let tg = window.Telegram?.WebApp;
tg?.expand?.();

let currentUser = null;
let currentSettings = null;
let currentGame = null;

// ====== УТИЛИТЫ ======

function setHeader(title, subtitle = "AllPvpGamesHub") {
  document.getElementById("screen-title").innerText = title;
  document.getElementById("screen-subtitle").innerText = subtitle;
}

function setTab(tab) {
  document
    .querySelectorAll(".nav-btn")
    .forEach(el => el.classList.remove("nav-btn-active"));
  document
    .querySelector(`.nav-btn[data-tab="${tab}"]`)
    ?.classList.add("nav-btn-active");

  if (tab === "games") renderGamesScreen();
  if (tab === "balance") renderBalanceScreen();
  if (tab === "profile") renderProfileScreen();
}

// ====== ЗАГРУЗКА ПРОФИЛЯ / НАСТРОЕК ======

async function loadProfileData() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  const res = await fetch(API + "/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id, username })
  });

  const data = await res.json();
  if (data.ok) {
    currentUser = data.user;
  }

  const res2 = await fetch(API + "/settings");
  const data2 = await res2.json();
  if (data2.ok) {
    currentSettings = data2;
  }
}

// ====== ЭКРАН: ИГРЫ ======

function renderGamesScreen() {
  setHeader("Игры", "Выберите режим");
  const root = document.getElementById("screen-content");

  root.innerHTML = `
    <div class="block">
      <div class="block-header">
        <div class="block-title">Режимы</div>
        <div class="block-tag">PvP</div>
      </div>
      <div class="block-subtitle">Выберите игру, чтобы войти в лобби.</div>
    </div>

    <div class="block">
      <div class="game-card">
        <div class="game-info">
          <div class="game-title">Арена</div>
          <div class="game-subtitle">Классическая битва 1v1 / 2v2</div>
        </div>
        <button class="btn-small btn" onclick="joinGame('arena')">Играть</button>
      </div>

      <div class="game-card">
        <div class="game-info">
          <div class="game-title">Шары</div>
          <div class="game-subtitle">Ставки на траекторию шаров</div>
        </div>
        <button class="btn-small btn" onclick="joinGame('balls')">Играть</button>
      </div>

      <div class="game-card">
        <div class="game-info">
          <div class="game-title">Гонка</div>
          <div class="game-subtitle">Кто первый добежит до финиша</div>
        </div>
        <button class="btn-small btn" onclick="joinGame('race')">Играть</button>
      </div>
    </div>

    <div class="block">
      <div class="block-header">
        <div class="block-title">Турнир</div>
        <div class="block-tag">Stars</div>
      </div>
      <div class="block-subtitle">Соревнуйтесь за призы, ставя звёзды в играх.</div>
      <button class="btn" onclick="renderTournamentScreen()">Открыть турнир</button>
    </div>
  `;
}

// ====== ЭКРАН: БАЛАНС ======

function renderBalanceScreen() {
  setHeader("Баланс", "Управление звёздами");

  const stars = currentUser?.stars_balance ?? 0;
  const spent = currentUser?.total_stars_spent ?? 0;
  const won = currentUser?.total_stars_won ?? 0;
  const withdrawn = currentUser?.total_stars_withdrawn ?? 0;

  const rate = currentSettings?.stars_per_ton ?? 1000;
  const fee = currentSettings?.withdraw_fee_percent ?? 5;

  const root = document.getElementById("screen-content");
  root.innerHTML = `
    <div class="block">
      <div class="block-header">
        <div class="block-title">Ваш баланс</div>
        <span class="badge">Текущий</span>
      </div>
      <div class="balance-value">${stars} ⭐</div>
      <div class="balance-sub">~ ${(stars / rate).toFixed(4)} TON по курсу 1 TON = ${rate} ⭐</div>
    </div>

    <div class="block">
      <div class="block-title">Действия</div>
      <button class="btn" onclick="alert('Пополнение через CryptoBot / Stars — логика позже')">Пополнить</button>
      <button class="btn btn-secondary" onclick="openWithdrawModal()">Вывести TON</button>
      <div class="text-muted" style="margin-top:8px;">
        Комиссия на вывод: ${fee}% от суммы в TON.
      </div>
    </div>

    <div class="block">
      <div class="block-title">Статистика</div>
      <div class="profile-row"><span>Потрачено звёзд</span><span>${spent}</span></div>
      <div class="profile-row"><span>Выиграно звёзд</span><span>${won}</span></div>
      <div class="profile-row"><span>Выведено звёзд</span><span>${withdrawn}</span></div>
    </div>
  `;
}

function openWithdrawModal() {
  alert("Тут будет красивое модальное окно вывода TON (позже допилим).");
}

// ====== ЭКРАН: ПРОФИЛЬ ======

function renderProfileScreen() {
  setHeader("Профиль", "Ваш аккаунт");

  const username = currentUser?.username || "guest";
  const tid = currentUser?.telegram_id || "-";

  const root = document.getElementById("screen-content");
  root.innerHTML = `
    <div class="block">
      <div class="block-title">Основное</div>
      <div class="profile-row"><span>Username</span><span>@${username}</span></div>
      <div class="profile-row"><span>Telegram ID</span><span>${tid}</span></div>
    </div>

    <div class="block">
      <div class="block-title">Настройки</div>
      <button class="btn btn-secondary" onclick="alert('Смена языка позже')">Сменить язык</button>
      <button class="btn btn-secondary" onclick="alert('Стример-режим позже')">Стример‑режим</button>
    </div>

    <div class="block">
      <div class="block-title">О проекте</div>
      <div class="text-muted">
        AllPvpGamesHub — хаб PvP‑игр, турниров и ставок на звёзды.
      </div>
    </div>
  `;
}

// ====== ЭКРАН: ТУРНИР ======

async function renderTournamentScreen() {
  setHeader("Турнир", "Соревнование по звёздам");
  const root = document.getElementById("screen-content");
  root.innerHTML = `
    <div class="block">
      <div class="center text-muted">Загрузка турнира...</div>
    </div>
  `;

  try {
    const res = await fetch(API + "/tournament/active");
    const data = await res.json();

    if (!data.ok || !data.tournament) {
      root.innerHTML = `
        <div class="block">
          <div class="block-title">Турнир</div>
          <div class="text-muted">Сейчас нет активного турнира.</div>
        </div>
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
            `<div class="profile-row"><span>${i + 1} место</span><span>${p}</span></div>`
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
      <div class="block">
        <div class="tournament-header">
          <div>
            <div class="tournament-name">${t.name}</div>
            <div class="tournament-time text-muted">ID: ${t.id}</div>
          </div>
          <div class="badge">Активен</div>
        </div>
        <div class="tournament-prizes">
          <div class="block-subtitle">Призы:</div>
          ${prizesHtml || '<div class="text-muted">Призы не указаны</div>'}
        </div>
      </div>

      <div class="block">
        <div class="block-title">Таблица лидеров</div>
        <div class="tournament-leaderboard">
          ${lbHtml || '<div class="text-muted">Пока нет участников</div>'}
        </div>
      </div>
    `;
  } catch (e) {
    root.innerHTML = `
      <div class="block">
        <div class="block-title">Турнир</div>
        <div class="text-muted">Ошибка загрузки турнира.</div>
      </div>
    `;
  }
}

// ====== ЭКРАН: ЛОББИ (заглушка) ======

function renderLobbyScreen(mode, gameId) {
  setHeader("Лобби", mode.toUpperCase());

  const root = document.getElementById("screen-content");
  root.innerHTML = `
    <div class="block">
      <div class="lobby-title">Игра: ${mode}</div>
      <div class="lobby-sub">ID лобби: ${gameId}</div>
      <div class="text-muted" style="margin-top:8px;">
        Здесь будет список игроков, таймер, статусы готовности и WebSocket‑обновления.
      </div>
    </div>

    <div class="block">
      <div class="block-title">Игроки</div>
      <div class="lobby-row"><span>Вы</span><span>⭐ ставка сделана</span></div>
      <div class="lobby-row text-muted"><span>Ожидание соперника...</span><span></span></div>
    </div>

    <div class="block">
      <button class="btn btn-secondary" onclick="setTab('games')">Выйти в игры</button>
    </div>
  `;
}

// ====== ВХОД В ИГРУ ======

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

    currentGame = { mode, id: data.game_id };
    renderLobbyScreen(mode, data.game_id);
  } catch (e) {
    alert("Ошибка соединения с сервером");
  }
}

// ====== СТАРТ ПРИЛОЖЕНИЯ ======

(async function init() {
  try {
    await loadProfileData();
  } catch (e) {
    // игнор
  }
  setTab("games");
})();
