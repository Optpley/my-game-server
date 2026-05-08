// public/lobby.js
const tg = window.Telegram.WebApp;
tg.expand();

let currentUser = null;
let ws = null;
let currentMode = null;
let currentBet = null;
let arenaCanvas = null;
let arenaCtx = null;
let lastPreview = null;
let animFrameId = null;

function $(id) { return document.getElementById(id); }
function getQueryParam(name) { const url = new URL(window.location.href); return url.searchParams.get(name); }

async function fetchMe() {
  const res = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initDataUnsafe: tg.initDataUnsafe }) });
  const data = await res.json(); if (!data.ok) return; currentUser = data.user; $("balanceValue").textContent = currentUser.stars;
}

function initBack() { $("backBtn").addEventListener("click", () => window.location.href = "/index.html"); }

function initBets() {
  document.querySelectorAll(".lobby-bet-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bet = Number(btn.dataset.bet);
      openBetSheet(bet);
    });
  });

  $("customBetInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = Number($("customBetInput").value || 0);
      if (val > 0) openBetSheet(val);
    }
  });

  $("sheetCloseBtn").addEventListener("click", closeBetSheet);
  $("sheetSetBtn").addEventListener("click", () => {
    const amount = Number($("sheetAmount").value || 0);
    if (!amount || amount <= 0) return;
    joinLobby(amount);
    closeBetSheet();
  });
}

function openBetSheet(defaultAmount) {
  $("sheetAmount").value = defaultAmount || 50;
  $("betSheet").classList.add("open");
}

function closeBetSheet() {
  $("betSheet").classList.remove("open");
}

function initWebSocket() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", initDataUnsafe: tg.initDataUnsafe }));
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "lobby_state" && data.lobby.mode === currentMode) renderLobbyState(data.lobby);
    if (data.type === "game_result" && data.game.mode === currentMode) { animateReplayInArena(data.game.replay); fetchMe(); }
  };
}

function joinLobby(bet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "join_lobby", mode: currentMode, bet }));
}

function renderLobbyState(lobby) {
  $("playersCount").textContent = lobby.players.length;
  $("bankValue").textContent = lobby.bet * lobby.players.length;
  if (lobby.pregame) $("pregameTimer").textContent = lobby.pregame.seconds + "s"; else $("pregameTimer").textContent = "—";

  const list = $("playersList"); list.innerHTML = "";
  lobby.players.forEach((p) => {
    const div = document.createElement("div"); div.className = "player-pill";
    const av = document.createElement("div"); av.className = "player-pill-avatar"; if (p.avatar) av.style.backgroundImage = `url(${p.avatar})`;
    const span = document.createElement("span"); span.textContent = (p.username ? "@" + p.username : p.name) + ` • ${p.bet}⭐`;
    div.appendChild(av); div.appendChild(span); list.appendChild(div);
  });

  if (lobby.preview) {
    if (lobby.players.length === 1) lastPreview = [lobby.preview[0] || []];
    else lastPreview = lobby.preview;
    if (currentMode === "ice_arena") animatePixelPreview(lastPreview);
    else animatePreview(lastPreview);
  } else {
    drawIdleArena();
  }
}

function initArena() {
  arenaCanvas = $("arenaCanvas"); arenaCtx = arenaCanvas.getContext("2d");
  function resize() {
    const rect = arenaCanvas.getBoundingClientRect();
    arenaCanvas.width = rect.width * devicePixelRatio;
    arenaCanvas.height = rect.width * devicePixelRatio;
    arenaCtx.setTransform(1,0,0,1,0,0); arenaCtx.scale(devicePixelRatio, devicePixelRatio);
    drawIdleArena();
  }
  resize(); window.addEventListener("resize", resize);
}

function clearArena() { const rect = arenaCanvas.getBoundingClientRect(); arenaCtx.clearRect(0,0,rect.width,rect.height); }

function drawIdleArena() {
  clearArena();
  const rect = arenaCanvas.getBoundingClientRect(); const w = rect.width, h = rect.height;
  const grd = arenaCtx.createRadialGradient(w/2, h/4, 10, w/2, h/2, w/1.2); grd.addColorStop(0, "#0f172a"); grd.addColorStop(1, "#020617");
  arenaCtx.fillStyle = grd; arenaCtx.fillRect(0,0,w,h);
  arenaCtx.strokeStyle = "rgba(148,163,184,0.6)"; arenaCtx.lineWidth = 2; arenaCtx.strokeRect(10,10,w-20,h-20);
}

function animatePreview(frames) {
  if (!frames || !frames.length) return;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  let i = 0;
  const rect = arenaCanvas.getBoundingClientRect(); const w = rect.width, h = rect.height;
  function draw() {
    clearArena();
    const grd = arenaCtx.createRadialGradient(w/2, h/4, 10, w/2, h/2, w/1.2); grd.addColorStop(0, "#0f172a"); grd.addColorStop(1, "#020617");
    arenaCtx.fillStyle = grd; arenaCtx.fillRect(0,0,w,h);
    arenaCtx.strokeStyle = "rgba(148,163,184,0.6)"; arenaCtx.lineWidth = 2; arenaCtx.strokeRect(10,10,w-20,h-20);
    const frame = frames[i] || [];
    frame.forEach((obj) => {
      if (obj.id === "grid") return;
      if (obj.id === "walls") {
        if (obj.extra && obj.extra.wallRemoved) {
          const which = obj.extra.which;
          arenaCtx.fillStyle = "rgba(255,77,79,0.12)";
          if (which === "top") arenaCtx.fillRect(10,10,w-20,20); else arenaCtx.fillRect(10,h-30,w-20,20);
          arenaCtx.strokeStyle = "#ff4d4f"; arenaCtx.lineWidth = 3;
          if (which === "top") arenaCtx.strokeRect(10,10,w-20,20); else arenaCtx.strokeRect(10,h-30,w-20,20);
        }
        return;
      }
      if (!obj.alive) return;
      const x = 10 + (obj.x/100)*(w-20); const y = 10 + (obj.y/100)*(h-20); const r = (obj.r || 5) * (w/300);
      arenaCtx.save(); arenaCtx.beginPath(); arenaCtx.arc(x,y,r,0,Math.PI*2); arenaCtx.closePath(); arenaCtx.clip();
      if (obj.avatar) {
        const img = new Image(); img.src = obj.avatar; img.onload = () => { arenaCtx.drawImage(img, x-r, y-r, r*2, r*2); };
        arenaCtx.fillStyle = obj.color || "#22c55e"; arenaCtx.fill();
      } else { arenaCtx.fillStyle = obj.color || "#22c55e"; arenaCtx.fill(); }
      arenaCtx.restore();
    });
    if (frames.length === 1) animFrameId = requestAnimationFrame(draw);
    else { i = (i + 1) % frames.length; animFrameId = requestAnimationFrame(draw); }
  }
  draw();
}

function animatePixelPreview(frames) {
  if (!frames || !frames.length) return;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  const metaFrame = frames[0] || [];
  let sectorsMeta = null;
  for (const obj of metaFrame) {
    if (obj.id === "sectors_meta") { sectorsMeta = obj.extra && obj.extra.sectors; break; }
  }
  const rect = arenaCanvas.getBoundingClientRect(); const w = rect.width, h = rect.height;
  const gridSize = 24;
  const cx = w/2, cy = h/2, radius = Math.min(w,h)/2 - 20;
  const sectorOwner = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
  if (sectorsMeta) {
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const px = (gx + 0.5) / gridSize * 2 - 1;
        const py = (gy + 0.5) / gridSize * 2 - 1;
        const sx = cx + px * radius;
        const sy = cy + py * radius;
        const dx = sx - cx, dy = sy - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > radius) { sectorOwner[gy][gx] = null; continue; }
        let angle = Math.atan2(dy, dx); if (angle < 0) angle += Math.PI*2;
        let owner = null;
        for (const pid in sectorsMeta) {
          const s = sectorsMeta[pid];
          if (angle >= s.start && angle <= s.end) { owner = pid; break; }
        }
        sectorOwner[gy][gx] = owner;
      }
    }
  }

  function drawStatic() {
    clearArena();
    const grd = arenaCtx.createRadialGradient(w/2, h/4, 10, w/2, h/2, w/1.2); grd.addColorStop(0, "#071226"); grd.addColorStop(1, "#020617");
    arenaCtx.fillStyle = grd; arenaCtx.fillRect(0,0,w,h);
    const cellW = (w - 40) / gridSize;
    const cellH = (h - 40) / gridSize;
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const owner = sectorOwner[gy][gx];
        if (!owner) {
          arenaCtx.fillStyle = "rgba(255,255,255,0.02)";
        } else {
          const frame0 = frames[0] || [];
          const pObj = frame0.find(o => o.id === owner);
          arenaCtx.fillStyle = pObj ? (pObj.color || "#2dd4bf") : "rgba(255,255,255,0.02)";
        }
        arenaCtx.fillRect(20 + gx*cellW, 20 + gy*cellH, Math.max(1,cellW-1), Math.max(1,cellH-1));
      }
    }
    arenaCtx.strokeStyle = "rgba(148,163,184,0.6)"; arenaCtx.lineWidth = 2; arenaCtx.strokeRect(10,10,w-20,h-20);
  }

  let idx = 0;
  function drawFrame() {
    drawStatic();
    const frame = frames[idx] || [];
    frame.forEach((obj) => {
      if (obj.id === "sectors_meta") return;
      if (!obj.alive) return;
      const x = 10 + (obj.x/100)*(w-20);
      const y = 10 + (obj.y/100)*(h-20);
      const r = (obj.r || 5) * (w/300);
      arenaCtx.save();
      arenaCtx.beginPath();
      arenaCtx.arc(x, y, r, 0, Math.PI*2);
      arenaCtx.closePath();
      arenaCtx.clip();
      if (obj.avatar) {
        const img = new Image(); img.src = obj.avatar; img.onload = () => { arenaCtx.drawImage(img, x-r, y-r, r*2, r*2); };
        arenaCtx.fillStyle = obj.color || "#22c55e"; arenaCtx.fill();
      } else {
        arenaCtx.fillStyle = obj.color || "#ffffff";
        arenaCtx.fill();
      }
      arenaCtx.restore();
    });
    if (frames.length === 1) animFrameId = requestAnimationFrame(drawFrame);
    else { idx = (idx + 1) % frames.length; animFrameId = requestAnimationFrame(drawFrame); }
  }

  drawFrame();
}

function animateReplayInArena(replay) {
  if (!replay || !replay.length) return;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  let idx = 0;
  const rect = arenaCanvas.getBoundingClientRect(); const w = rect.width, h = rect.height;
  function drawFrame() {
    clearArena();
    const grd = arenaCtx.createRadialGradient(w/2, h/4, 10, w/2, h/2, w/1.2); grd.addColorStop(0, "#0f172a"); grd.addColorStop(1, "#020617");
    arenaCtx.fillStyle = grd; arenaCtx.fillRect(0,0,w,h);
    arenaCtx.strokeStyle = "rgba(148,163,184,0.6)"; arenaCtx.lineWidth = 2; arenaCtx.strokeRect(10,10,w-20,h-20);
    const frame = replay[idx] || [];
    frame.forEach((obj) => {
      if (obj.id === "grid" || obj.id === "sectors_meta") return;
      if (obj.id === "walls") {
        if (obj.extra && obj.extra.wallRemoved) {
          const which = obj.extra.which;
          arenaCtx.fillStyle = "rgba(255,77,79,0.12)";
          if (which === "top") arenaCtx.fillRect(10,10,w-20,20); else arenaCtx.fillRect(10,h-30,w-20,20);
          arenaCtx.strokeStyle = "#ff4d4f"; arenaCtx.lineWidth = 3;
          if (which === "top") arenaCtx.strokeRect(10,10,w-20,20); else arenaCtx.strokeRect(10,h-30,w-20,20);
        }
        return;
      }
      if (!obj.alive) return;
      const x = 10 + (obj.x/100)*(w-20); const y = 10 + (obj.y/100)*(h-20); const r = (obj.r || 5) * (w/300);
      arenaCtx.save(); arenaCtx.beginPath(); arenaCtx.arc(x,y,r,0,Math.PI*2); arenaCtx.closePath(); arenaCtx.clip();
      if (obj.avatar) {
        const img = new Image(); img.src = obj.avatar; img.onload = () => { arenaCtx.drawImage(img, x-r, y-r, r*2, r*2); };
        arenaCtx.fillStyle = obj.color || "#22c55e"; arenaCtx.fill();
      } else { arenaCtx.fillStyle = obj.color || "#22c55e"; arenaCtx.fill(); }
      arenaCtx.restore();
    });
    idx++;
    if (idx < replay.length) animFrameId = requestAnimationFrame(drawFrame);
    else setTimeout(drawIdleArena, 800);
  }
  drawFrame();
}

function initHistory() {
  $("historyBtn").addEventListener("click", async () => {
    const res = await fetch(`/api/history?mode=${encodeURIComponent(currentMode)}&filter=latest`);
    const data = await res.json(); if (!data.ok) return;
    const list = $("historyList"); list.innerHTML = "";
    data.games.forEach((g) => {
      const div = document.createElement("div"); div.className = "history-item";
      const players = g.players.map((p) => (p.username ? "@" + p.username : "Игрок")).join(" vs ");
      div.textContent = `#${g.id} • ${g.bet}⭐ • ${players}`; list.appendChild(div);
    });
  });
}

window.addEventListener("load", async () => {
  currentMode = getQueryParam("mode") || "ice_arena";
  $("lobbyTitle").textContent = { ice_arena: "Арена", vybivanie: "Выбивание", color_arena: "Цветная арена", ball_race: "Гонка мячей", meteor_fall: "Падение метеоритов", mix: "MIX" }[currentMode] || "Режим";
  await fetchMe(); initBack(); initBets(); initArena(); initHistory(); initWebSocket();
});




