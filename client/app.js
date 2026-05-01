const tg = window.Telegram.WebApp;
tg.expand();

document.getElementById("load").onclick = async () => {
    const res = await fetch("http://localhost:3000/game/status");
    const data = await res.json();

    document.getElementById("output").textContent =
        JSON.stringify(data, null, 2);
};

