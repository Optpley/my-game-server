const ADMIN_KEY = "SUPER_SECRET_ADMIN_KEY"; // тот же, что в server.js

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "x-admin-key": ADMIN_KEY,
            ...(options.headers || {})
        }
    });
    return res.json();
}

const rateValueEl = document.getElementById("rate-value");
const rateInputEl = document.getElementById("rate-input");
const saveRateBtn = document.getElementById("save-rate");

const grantUsernameEl = document.getElementById("grant-username");
const grantAmountEl = document.getElementById("grant-amount");
const grantBtn = document.getElementById("grant-btn");

const usersListEl = document.getElementById("users-list");

async function loadSettings() {
    const data = await api("/admin/settings");
    rateValueEl.textContent = data.rate;
}

async function saveRate() {
    const rate = rateInputEl.value.trim();
    if (!rate) return alert("Введите курс");
    const data = await api("/admin/settings/rate", {
        method: "POST",
        body: JSON.stringify({ rate })
    });
    rateValueEl.textContent = data.rate;
    alert("Курс обновлён");
}

async function grantStars() {
    const username = grantUsernameEl.value.trim();
    const amount = grantAmountEl.value.trim();
    if (!username || !amount) return alert("Заполни поля");

    const data = await api("/admin/grant-stars", {
        method: "POST",
        body: JSON.stringify({ username, amount })
    });

    if (data.error) {
        alert("Ошибка: " + data.error);
    } else {
        alert("Звёзды выданы");
        loadUsers();
    }
}

async function loadUsers() {
    const data = await api("/admin/users");
    usersListEl.innerHTML = "";
    data.users.forEach(u => {
        const div = document.createElement("div");
        div.className = "player-item";
        div.innerHTML = `
            <div class="player-info">
                <div class="player-name">@${u.username || "no_username"}</div>
                <div class="player-bet">stars: ${u.stars} | tg_id: ${u.tg_id}</div>
            </div>
        `;
        usersListEl.appendChild(div);
    });
}

saveRateBtn.addEventListener("click", saveRate);
grantBtn.addEventListener("click", grantStars);

loadSettings();
loadUsers();
