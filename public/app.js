const tg = window.Telegram.WebApp;
tg.expand();

let currentUser = null;
let ws = null;

function $(id) {
  return document.getElementById(id);
}

async function fetchMe() {
  const res = await fetch("/api/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initDataUnsafe: tg.initDataUnsafe }),
  });
  const data = await res.json();
  if (!data.ok) return;

  currentUser = data.user;
  $("balanceValue").textContent = currentUser.stars;
  const b2 = $("balanceValueBalance");
  if (b2) b2.textContent = currentUser.stars;

  if ($("profileName")) {
    $("profileName").textContent = currentUser.name;
    $("profileUsername").textContent = currentUser.username
      ? "@" + currentUser.username
      : "";
    if (currentUser.avatar) {
      $("profileAvatar").style.backgroundImage = `url(${currentUser.avatar})`;
    }
  }
}

function initWebSocket() {
  ws = new WebSocket(
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host
  );

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "auth",
        initDataUnsafe: tg.initDataUnsafe,
      })
    );
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "global_stats") {
      const online = $("onlineCount");
      const bank = $("totalBank");
      if (online) online.textContent = data.online;
      if (bank) bank.textContent = data.totalBank;
    }
  };
}

function initTabs() {
  const buttons = document.querySelectorAll(".nav-btn");
  const tabs = {
    games: $("tab-games"),
    balance: $("tab-balance"),
    profile: $("tab-profile"),
  };

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("nav-btn-active"));
      btn.classList.add("nav-btn-active");

      const tab = btn.dataset.tab;
      Object.keys(tabs).forEach((key) => {
        tabs[key].classList.toggle("active-tab", key === tab);
      });
    });
  });
}

function initGames() {
  document.querySelectorAll(".game-big-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      window.location.href = `/lobby.html?mode=${encodeURIComponent(mode)}`;
    });
  });

  const mixBtn = $("mixPlayBtn");
  if (mixBtn) {
    mixBtn.addEventListener("click", () => {
      const allModes = [
        "ice_arena",
        "elimination",
        "color_arena",
        "ball_race",
        "meteor_fall",
      ];
      const mode = allModes[Math.floor(Math.random() * allModes.length)];
      window.location.href = `/lobby.html?mode=${encodeURIComponent(mode)}`;
    });
  }
}

function initAdmin() {
  const adminOverlay = $("adminOverlay");
  const adminBtn = $("adminBtn");
  const adminCloseBtn = $("adminCloseBtn");
  const adminGiveBtn = $("adminGiveBtn");
  const adminBroadcastBtn = $("adminBroadcastBtn");
  const tournamentCreateBtn = $("tournamentCreateBtn");

  if (!adminBtn) return;

  adminBtn.addEventListener("click", () => {
    if (
      !currentUser ||
      (currentUser.username !== "Capibaraboyonrealnokrutoy" &&
        currentUser.tg_id !== 0)
    ) {
      tg.showPopup({
        title: "Недоступно",
        message: "У вас нет доступа к админ‑панели",
        buttons: [{ id: "ok", type: "default", text: "Ок" }],
      });
      return;
    }
    adminOverlay.classList.remove("hidden");
  });

  adminCloseBtn.addEventListener("click", () => {
    adminOverlay.classList.add("hidden");
  });

  adminGiveBtn.addEventListener("click", async () => {
    const username = $("adminUser").value.replace("@", "").trim();
    const amount = Number($("adminAmount").value || 0);
    if (!username || !amount) return;

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
    tg.showAlert(
      data.ok ? "Звёзды выданы" : "Ошибка: " + (data.error || "unknown")
    );
  });

  adminBroadcastBtn.addEventListener("click", async () => {
    const text = $("adminBroadcastText").value.trim();
    if (!text) return;

    const res = await fetch("/api/admin/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminSecret: "dev_secret",
        text,
      }),
    });
    const data = await res.json();
    tg.showAlert(
      data.ok ? `Отправлено: ${data.sent}` : "Ошибка: " + (data.error || "unknown")
    );
  });

  tournamentCreateBtn.addEventListener("click", async () => {
    const bet = Number($("tournamentBet").value || 50);
    const prize = Number($("tournamentPrize").value || 1000);
    const modes = Array.from(document.querySelectorAll(".t-mode"))
      .filter((c) => c.checked)
      .map((c) => c.value);

    const res = await fetch("/api/admin/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminSecret: "dev_secret",
        modes,
        bet,
        prize,
      }),
    });
    const data = await res.json();
    tg.showAlert(data.ok ? "Турнир создан" : "Ошибка");
  });
}

window.addEventListener("load", async () => {
  await fetchMe();
  initWebSocket();
  initTabs();
  initGames();
  initAdmin();
});







