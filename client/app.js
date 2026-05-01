// ===============================
// 1. Telegram WebApp API + init
// ===============================
const tg = window.Telegram.WebApp;
tg.expand();

async function initUser() {
    const initData = tg.initDataUnsafe;

    if (!initData || !initData.user) {
        console.error("No Telegram user data");
        return;
    }

    const res = await fetch("/user/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: initData.user })
    });

    const data = await res.json();
    console.log("User loaded:", data.user);

    window.currentUser = data.user;
}

initUser();


// ===============================
// 2. Твой UI и логика приложения
// ===============================

// Открытие экранов
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.style.display = "none");
    document.getElementById(id).style.display = "block";
}

// Обновление списка игр
async function loadGames() {
    const res = await fetch("/games");
    const data = await res.json();

    const list = document.getElementById("games-list");
    list.innerHTML = "";

    data.games.forEach(g => {
        const div = document.createElement("div");
        div.className = "game-card";
        div.innerHTML = `
            <h3>${g.name}</h3>
            <p>Игроков: ${g.playersCount}</p>
            <p>Банк: ${g.bankAfterCommission}</p>
            <button class="open-game" data-id="${g.id}">Открыть</button>
        `;
        list.appendChild(div);
    });

    document.querySelectorAll(".open-game").forEach(btn => {
        btn.onclick = () => openGame(btn.dataset.id);
    });
}

loadGames();
setInterval(loadGames, 3000);


// Открытие конкретной игры
async function openGame(id) {
    const res = await fetch(`/game/${id}/status`);
    const g = await res.json();

    document.getElementById("game-title").textContent = g.name;
    document.getElementById("game-bank").textContent = g.bankAfterCommission;

    const players = document.getElementById("game-players");
    players.innerHTML = "";

    g.players.forEach(p => {
        const li = document.createElement("li");
        li.textContent = `${p.username} (${p.weight})`;
        players.appendChild(li);
    });

    showScreen("game-screen");
}


// Старт игры
document.getElementById("start-game").onclick = async () => {
    const id = document.getElementById("game-title").textContent.toLowerCase().replace(" ", "_");

    await fetch(`/game/${id}/start`, { method: "POST" });

    document.getElementById("game-status").textContent = "Игра идёт...";

    setTimeout(async () => {
        const res = await fetch(`/game/${id}/status`);
        const g = await res.json();

        document.getElementById("game-status").text
