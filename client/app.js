const tg = window.Telegram?.WebApp || null;
if (tg) tg.expand();

let currentGameId = null;
let streamerMode = false;
let lang = "ru";
let pollInterval = null;

// DOM
const gameScreen = document.getElementById("game-screen");
const gameNameEl = document.getElementById("game-name");
const backToMenuBtn = document.getElementById("back-to-menu");
const playersListEl = document.getElementById("players-list");
const bankEl = document.getElementById("bank");
const bankAfterEl = document.getElementById("bank-after");
const countEl = document.getElementById("count");
const statusTextEl = document.getElementById("status-text");

const winPopup = document.getElementById("win-popup");
const closePopupBtn = document.getElementById("close-popup");

const profilePopup = document.getElementById("profile-popup");
const profileBtn = document.getElementById("profile-btn");
const closeProfileBtn = document.getElementById("close-profile");
const profileUsernameEl = document.getElementById("profile-username");

const settingsPopup = document.getElementById("settings-popup");
const settingsBtn = document.getElementById("settings-btn");
const closeSettingsBtn = document.getElementById("close-settings");
const langSelect = document.getElementById("lang-select");
const streamerModeCheckbox = document.getElementById("streamer-mode");

const withdrawPopup = document.getElementById("withdraw-popup");
const withdrawBtn = document.getElementById("withdraw-btn");
const closeWithdrawBtn = document.getElementById("close-withdraw");
const sendWithdrawBtn = document.getElementById("send-withdraw");
const tonWalletInput = document.getElementById("ton-wallet");

// ====== ВСПОМОГАТЕЛЬНЫЕ ======

function showPopup(el) {
    el.classList.add("show");
}

function hidePopup(el) {
    el.classList.remove("show");
}

function showWinPopup() {
    showPopup(winPopup);
}

function hideWinPopup() {
    hidePopup(winPopup);
}

function openGameScreen(id, name) {
    currentGameId = id;
    gameNameEl.textContent = name;
    document.querySelector(".games-menu").classList.add("hidden");
    gameScreen.classList.remove("hidden");
    startPollingGame();
}

function backToMenu() {
    currentGameId = null;
    document.querySelector(".games-menu").classList.remove("hidden");
    gameScreen.classList.add("hidden");
    stopPollingGame();
}

function startPollingGame() {
    if (!currentGameId) return;
    loadGameStatus();
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(loadGameStatus, 2000);
}

function stopPollingGame() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// ====== ЗАГРУЗКА СТАТУСА ИГРЫ ======

async function loadGameStatus() {
    if (!currentGameId) return;

    try {
        const res = await fetch(`/game/${currentGameId}/status`);
        const data = await res.json();

        bankEl.textContent = data.bankRaw;
        bankAfterEl.textContent = data.bankAfterCommission;
        countEl.textContent = data.players.length;

        if (data.status === "waiting") {
            statusTextEl.textContent = "Ожидание игроков...";
        } else if (data.status === "running") {
            statusTextEl.textContent = "Игра идёт...";
        } else if (data.status === "finished") {
            statusTextEl.textContent = "Игра завершена";
        }

        playersListEl.innerHTML = "";

        data.players.forEach(p => {
            const div = document.createElement("div");
            div.className = "player-item";

            const isWinner = data.winnerId && data.winnerId === p.id;
            if (isWinner) {
                div.classList.add("highlight");
            }

            let avatarHtml = "";
            if (!streamerMode) {
                avatarHtml = `<img src="https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
                    p.username
                )}">`;
            }

            div.innerHTML = `
                ${avatarHtml}
                <div class="player-info">
                    <div class="player-name">${p.username}</div>
                    <div class="player-bet">${p.weight} ⭐</div>
                </div>
            `;

            playersListEl.appendChild(div);
        });

        // Если игра завершена и есть победитель — показываем попап
        if (data.status === "finished" && data.winnerId) {
            const me = tg?.initDataUnsafe?.user;
            if (me && data.players.some(p => p.id === data.winnerId && p.username === me.username)) {
                showWinPopup();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// ====== ЗАГРУЗКА СПИСКА ИГР (для обновления банков в меню) ======

async function loadGames() {
    try {
        const res = await fetch("/games");
        const data = await res.json();

        data.games.forEach(g => {
            const span = document.querySelector(`[data-bank="${g.id}"]`);
            if (span) {
                span.textContent = g.bankAfterCommission;
            }
        });
    } catch (e) {
        console.error(e);
    }
}

setInterval(loadGames, 3000);
loadGames();

// ====== СТАРТ ИГРЫ (демо) ======

async function startGame(id) {
    try {
        await fetch(`/game/${id}/start`, {
            method: "POST"
        });
    } catch (e) {
        console.error(e);
    }
}

// ====== ОБРАБОТЧИКИ ======

// Клик по карточке игры
document.querySelectorAll(".game-card").forEach(btn => {
    btn.addEventListener("click", () => {
        const id = btn.dataset.game;
        const name = btn.querySelector(".game-title").textContent;
        openGameScreen(id, name);
        startGame(id);
    });
});

backToMenuBtn.addEventListener("click", backToMenu);

// Кнопки ставок (пока просто лог)
document.querySelectorAll(".bet-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const value = btn.dataset.value;
        if (value === "custom") {
            const v = prompt("Введи свою сумму:");
            console.log("Custom bet:", v);
        } else {
            console.log("Bet:", value);
        }
    });
});

// Попап победы
closePopupBtn.addEventListener("click", hideWinPopup);

// Профиль
profileBtn.addEventListener("click", () => {
    const user = tg?.initDataUnsafe?.user;
    if (user) {
        profileUsernameEl.textContent = `@${user.username || user.id}`;
    }
    showPopup(profilePopup);
});

closeProfileBtn.addEventListener("click", () => hidePopup(profilePopup));

// Настройки
settingsBtn.addEventListener("click", () => {
    langSelect.value = lang;
    streamerModeCheckbox.checked = streamerMode;
    showPopup(settingsPopup);
});

closeSettingsBtn.addEventListener("click", () => hidePopup(settingsPopup));

langSelect.addEventListener("change", e => {
    lang = e.target.value;
    console.log("Language set to:", lang);
});

streamerModeCheckbox.addEventListener("change", e => {
    streamerMode = e.target.checked;
    loadGameStatus();
});

// Вывод
withdrawBtn.addEventListener("click", () => {
    tonWalletInput.value = "";
    showPopup(withdrawPopup);
});

closeWithdrawBtn.addEventListener("click", () => hidePopup(withdrawPopup));

sendWithdrawBtn.addEventListener("click", async () => {
    const wallet = tonWalletInput.value.trim();
    if (!wallet) {
        alert("Введите TON кошелёк");
        return;
    }

    try {
        await fetch("/withdraw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user: tg?.initDataUnsafe?.user || null,
                wallet
            })
        });

        alert("Заявка отправлена!");
        hidePopup(withdrawPopup);
    } catch (e) {
        console.error(e);
        alert("Ошибка при отправке заявки");
    }
});
