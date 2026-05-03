let tg = window.Telegram.WebApp;
if (tg && tg.expand) tg.expand();

let initDataUnsafe = tg?.initDataUnsafe ?? {
  user: { id: 1, username: "testuser", first_name: "Test", last_name: "User" }
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
    body: JSON.stringify({ initDataUnsafe })
  });
  const data = await res.json();
  if (!data.ok) return;

  currentUser = data.user;
  document.getElementById("header-balance").textContent =
    currentUser.stars + " ⭐";
  setAvatar(document.getElementById("header-avatar"), currentUser.avatar);
}

function setTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("nav-btn-active", b.dataset.tab === tab)
  );

  if (tab === "games") renderGames();
  if (tab === "balance") renderBalance();
  if (tab === "profile") renderProfile();
}

function renderGames() {
  document.querySelectorAll(".game-btn").forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.mode;
      window.location.href = "/lobby.html?mode=" + mode;
    };
  });
}

function renderBalance() {
  const screen = document.getElementById("screen-content");
  screen.innerHTML = `
    <div style="font-size:16px;margin-bottom:10px;">Ваш баланс</div>
    <div style="font-size:22px;color:#facc15;">${currentUser.stars} ⭐</div>
  `;
}

function renderProfile() {
  const screen = document.getElementById("screen-content");
  screen.innerHTML = `
    <div class="game-card">
      <div style="font-size:16px;margin-bottom:8px;">Профиль</div>
      <div>Имя: ${currentUser.name}</div>
      <div>Username: @${currentUser.username}</div>
      <div style="margin-top:8px;">Баланс: ${currentUser.stars} ⭐</div>
    </div>
  `;
}

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

(async () => {
  await fetchMe();
  renderGames();
})();





