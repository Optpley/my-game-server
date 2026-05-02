// app.js

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

function setAvatar(el, url) {
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
  } else {
    el.style.backgroundImage = "linear-gradient(135deg,#4f46e5,#06b6d4)";
  }
}

function alertInApp(msg) {
  const el = document.getElementById("alert");
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
  document.getElementById("header-balance").textContent =
    currentUser.stars + " ⭐";
  setAvatar(document.getElementById("header-avatar"), currentUser.avatar);
}

function setTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn-active", btn.dataset.tab === tab);
  });

  if (tab === "games") renderGames();
  if (tab === "balance") renderBalance();
  if (tab === "profile") renderProfile();
}

function renderGames() {
  const screen = document.getElementById("screen-content");
  screen.innerHTML = "";

  const modes = [
    {
      id: "ice_arena",
      title: "Ice Arena",
      desc: "Классическая арена: шайба, сектора, один победитель.",
    },
    {
      id: "elimination",
      title: "Выбывание",
      desc: "Каждый раунд выбывает один игрок.",
    },
    {
      id: "ball_race",
      title: "Гонка шаров",
      desc: "Шары катятся по трассе, кто первый — тот победил.",
    },
    {
      id: "color_arena",
      title: "Красочная арена",
      desc: "Игроки закрашивают зоны, побеждает доминирующий.",
    },
    {
      id: "mix",
      title: "Микс режим",
      desc: "Смешение механик всех режимов.",
    },
  ];

  modes.forEach((m) => {
    const card = document.createElement("div");
    card.className = "game-card";

    card.innerHTML = `
      <div class="game-title">${m.title}</div>
      <div class="game-desc">${m.desc}</div>
      <button class="btn-primary">Играть</button>
    `;

    card.querySelector("button").addEventListener("click", () => {
      window.location.href = "/lobby.html?mode=" + m.id;
    });

    screen.appendChild(card);
  });
}

function renderBalance() {
  const screen = document.getElementById("screen-content");
  screen.innerHTML = `
    <div style="font-size:16px;margin-bottom:10px;">Ваш баланс</div>
    <div style="font-size:22px;color:#facc15;">${currentUser.stars} ⭐</div>
    <div style="margin-top:16px;font-size:13px;color:#9ca3af;">
      Пополнение и вывод ты пока делаешь вручную, как мы обсуждали.
    </div>
  `;
}

function renderProfile() {
  const screen = document.getElementById("screen-content");
  screen.innerHTML = "";

  const block = document.createElement("div");
  block.className = "game-card";
  block.innerHTML = `
    <div style="font-size:16px;margin-bottom:8px;">Профиль</div>
    <div>Имя: ${currentUser.name || "Игрок"}</div>
    <div>Username: ${
      currentUser.username ? "@" + currentUser.username : "без username"
    }</div>
    <div style="margin-top:8px;">Баланс: ${currentUser.stars} ⭐</div>
  `;
  screen.appendChild(block);

  const admin = document.createElement("div");
  admin.className = "game-card";
  admin.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Админ-панель</div>
    <div style="font-size:13px;color:#9ca3af;margin-bottom:6px;">Выдача звёзд по username</div>
    <div style="font-size:12px;margin-bottom:4px;">Секрет (временно: dev_secret)</div>
    <input id="adminSecret" type="password" value="dev_secret" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:6px;">
    <div style="font-size:12px;margin-bottom:4px;">Username (без @)</div>
    <input id="adminUsername" type="text" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:6px;">
    <div style="font-size:12px;margin-bottom:4px;">Сколько звёзд (+/-)</div>
    <input id="adminAmount" type="number" value="100" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:8px;">
    <button id="adminGiveBtn" class="btn-primary">Выдать звёзды</button>
  `;
  screen.appendChild(admin);

  const tournaments = document.createElement("div");
  tournaments.className = "game-card";
  tournaments.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Турниры</div>
    <div style="font-size:12px;margin-bottom:4px;">Название турнира</div>
    <input id="tName" type="text" placeholder="Турнир" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:6px;">
    <div style="font-size:12px;margin-bottom:4px;">Режимы</div>
    <label style="font-size:12px;display:block;"><input type="checkbox" class="tMode" value="ice_arena"> Ice Arena</label>
    <label style="font-size:12px;display:block;"><input type="checkbox" class="tMode" value="elimination"> Выбывание</label>
    <label style="font-size:12px;display:block;"><input type="checkbox" class="tMode" value="ball_race"> Гонка шаров</label>
    <label style="font-size:12px;display:block;"><input type="checkbox" class="tMode" value="color_arena"> Красочная арена</label>
    <label style="font-size:12px;display:block;"><input type="checkbox" class="tMode" value="mix"> Микс режим</label>
    <div style="font-size:12px;margin-top:6px;margin-bottom:4px;">Номер игры</div>
    <input id="tGameNumber" type="number" value="1" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:6px;">
    <div style="font-size:12px;margin-bottom:4px;">Длительность (минут)</div>
    <input id="tDuration" type="number" value="30" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:8px;">
    <button id="tCreateBtn" class="btn-primary">Создать турнир</button>
  `;
  screen.appendChild(tournaments);

  const special = document.createElement("div");
  special.className = "game-card";
  special.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Особенная игра</div>
    <div style="font-size:12px;margin-bottom:4px;">Номер будущей игры</div>
    <input id="sGameNumber" type="number" value="1" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:6px;">
    <div style="font-size:12px;margin-bottom:4px;">Длительность (минут)</div>
    <input id="sDuration" type="number" value="10" style="width:100%;padding:6px;border-radius:8px;border:1px solid #1d2442;background:#020617;color:#e5e7eb;font-size:13px;margin-bottom:8px;">
    <button id="sCreateBtn" class="btn-primary">Создать особенную игру</button>
  `;
  screen.appendChild(special);

  const alertDiv = document.createElement("div");
  alertDiv.id = "alert";
  alertDiv.className = "alert";
  document.body.appendChild(alertDiv);

  document.getElementById("adminGiveBtn").addEventListener("click", async () => {
    const secret = document.getElementById("adminSecret").value.trim();
    const username = document.getElementById("adminUsername").value.trim();
    const amount = Number(document.getElementById("adminAmount").value);
    if (!username || !amount) {
      alertInApp("Заполни username и сумму");
      return;
    }
    const res = await fetch("/api/admin/give-stars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminSecret: secret, username, amount }),
    });
    const data = await res.json();
    if (!data.ok) {
      alertInApp("Ошибка админки: " + (data.error || ""));
      return;
    }
    alertInApp("Выдано, новый баланс: " + data.user.stars + "⭐");
    if (currentUser && currentUser.id === data.user.id) {
      currentUser.stars = data.user.stars;
      document.getElementById("header-balance").textContent =
        currentUser.stars + " ⭐";
    }
  });

  document.getElementById("tCreateBtn").addEventListener("click", async () => {
    const secret = document.getElementById("adminSecret").value.trim();
    const name = document.getElementById("tName").value.trim() || "Турнир";
    const modes = Array.from(
      document.querySelectorAll(".tMode:checked")
    ).map((c) => c.value);
    const gameNumber = Number(
      document.getElementById("tGameNumber").value
    );
    const durationMinutes = Number(
      document.getElementById("tDuration").value
    );
    const res = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminSecret: secret,
        name,
        modes,
        gameNumber,
        durationMinutes,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      alertInApp("Ошибка турнира: " + (data.error || ""));
      return;
    }
    alertInApp("Турнир создан: #" + data.tournament.id);
  });

  document.getElementById("sCreateBtn").addEventListener("click", async () => {
    const secret = document.getElementById("adminSecret").value.trim();
    const gameNumber = Number(
      document.getElementById("sGameNumber").value
    );
    const durationMinutes = Number(
      document.getElementById("sDuration").value
    );
    const res = await fetch("/api/special-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminSecret: secret,
        gameNumber,
        durationMinutes,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      alertInApp("Ошибка особенной игры: " + (data.error || ""));
      return;
    }
    alertInApp("Особенная игра создана: #" + data.special.id);
  });
}

(async () => {
  await fetchMe();
  renderGames();
})();




