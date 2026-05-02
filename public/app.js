const API = window.location.origin + "/api";

let tg = window.Telegram?.WebApp;
tg?.expand();

async function loadProfile() {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  const res = await fetch(API + "/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id, username })
  });

  const data = await res.json();
  if (data.ok) {
    document.getElementById("balance").innerText = data.user.stars_balance + " ⭐";
  } else {
    document.getElementById("balance").innerText = "Ошибка";
  }
}

async function joinGame(mode) {
  const telegram_id = tg?.initDataUnsafe?.user?.id || 0;
  const username = tg?.initDataUnsafe?.user?.username || "guest";

  const amount = 1; // ставка по умолчанию

  const res = await fetch(API + "/game/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id, username, mode, amount })
  });

  const data = await res.json();
  if (data.ok) {
    alert("Вы вошли в игру! ID: " + data.game_id);
  } else {
    alert("Ошибка: " + data.error);
  }
}

async function openTournament() {
  const res = await fetch(API + "/tournament/active");
  const data = await res.json();

  if (!data.tournament) {
    alert("Активного турнира нет");
    return;
  }

  alert("Турнир: " + data.tournament.name);
}

loadProfile();
