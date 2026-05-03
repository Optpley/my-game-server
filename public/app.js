let tg = window.Telegram.WebApp;
if (tg && tg.expand) tg.expand();

let initDataUnsafe = tg?.initDataUnsafe ?? {
  user: { id: 1, username: "testuser", first_name: "Test", last_name: "User" },
};

let currentUser = null;

function setAvatar(el, url) {
  el.style.backgroundImage = url
    ? `url("${url}")`
    : "linear-gradient(135deg,#4f46e5,#06b6d4)";
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
  document.getElementById("balance-value").textContent =
    currentUser.stars + " ⭐";

  setAvatar(document.getElementById("header-avatar"), currentUser.avatar);
  setAvatar(document.getElementById("profile-avatar"), currentUser.avatar);

  document.getElementById("profile-name").textContent = currentUser.name || "";
  document.getElementById("profile-username").textContent = currentUser.username
    ? "@" + currentUser.username
    : "";
  document.getElementById("profile-stars").textContent =
    "Баланс: " + currentUser.stars + " ⭐";
}

function initTabs() {
  const screens = {
    games: document.getElementById("screen-games"),
    balance: document.getElementById("screen-balance"),
    profile: document.getElementById("screen-profile"),
  };

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;

      document
        .querySelectorAll(".nav-btn")
        .forEach((b) => b.classList.remove("nav-btn-active"));
      btn.classList.add("nav-btn-active");

      Object.values(screens).forEach((s) => s.classList.add("hidden"));
      screens[tab].classList.remove("hidden");
    });
  });
}

function initGames() {
  document.querySelectorAll(".game-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      window.location.href = "/lobby.html?mode=" + mode;
    });
  });
}

function initProfile() {
  const adminOverlay = document.getElementById("admin-overlay");
  const adminBtn = document.getElementById("admin-btn");
  const adminClose = document.getElementById("admin-close");
  const adminSend = document.getElementById("admin-send");
  const adminStatus = document.getElementById("admin-status");

  const broadcastSend = document.getElementById("broadcast-send");
  const broadcastText = document.getElementById("broadcast-text");
  const broadcastStatus = document.getElementById("broadcast-status");

  adminBtn.addEventListener("click", () => {
    adminStatus.textContent = "";
    broadcastStatus.textContent = "";
    adminOverlay.classList.remove("hidden");
  });

  adminClose.addEventListener("click", () => {
    adminOverlay.classList.add("hidden");
  });

  adminSend.addEventListener("click", async () => {
    const username = document.getElementById("admin-username").value.trim();
    const amount = Number(
      document.getElementById("admin-amount").value.trim()
    );
    if (!username || !amount) {
      adminStatus.textContent = "Заполни username и сумму";
      return;
    }

    adminStatus.textContent = "Отправляю...";
    const res = await fetch("/api/admin/give-stars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminSecret: "dev_secret",
        username,
        amount,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      adminStatus.textContent = "Ошибка: " + (data.error || "неизвестно");
      return;
    }
    adminStatus.textContent =
      "Готово. У @" + username + " теперь " + data.user.stars + " ⭐";
  });

  broadcastSend.addEventListener("click", async () => {
    const text = broadcastText.value.trim();
    if (!text) {
      broadcastStatus.textContent = "Введите текст";
      return;
    }

    broadcastStatus.textContent = "Отправляю...";
    const res = await fetch("/api/admin/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminSecret: "dev_secret",
        text,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      broadcastStatus.textContent = "Ошибка: " + (data.error || "неизвестно");
      return;
    }
    broadcastStatus.textContent =
      "Отправлено: " + data.sent + " пользователям";
  });

  document.getElementById("settings-btn").addEventListener("click", () => {
    tg?.showPopup?.({
      title: "Настройки",
      message: "Тут будет:\n• смена языка\n• режим стримера\n• скрытие аватарок",
      buttons: [{ id: "ok", type: "default", text: "Ок" }],
    });
  });
}

function initMixTimer() {
  setInterval(() => {
    const el = document.getElementById("mix-timer");
    if (!el) return;
    const now = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const diff = end - now;

    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");

    el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

(async () => {
  await fetchMe();
  initTabs();
  initGames();
  initProfile();
  initMixTimer();
})();







