const tg = window.Telegram.WebApp;
tg.expand();

async function loadStatus() {
    const res = await fetch("http://localhost:3000/game/status");
    const data = await res.json();

    document.getElementById("bank").textContent =
        data.players.reduce((sum, p) => sum + p.weight, 0);

    document.getElementById("count").textContent = data.players.length;

    const list = document.getElementById("players-list");
    list.innerHTML = "";

    data.players.forEach(p => {
        const div = document.createElement("div");
        div.className = "player-item";

        div.innerHTML = `
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${p.username}">
            <div class="player-info">
                <div class="player-name">${p.username}</div>
                <div class="player-bet">${p.weight} ⭐</div>
            </div>
        `;

        list.appendChild(div);
    });
}

loadStatus();
setInterval(loadStatus, 2000);
