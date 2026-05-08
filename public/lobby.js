<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Лобби</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div id="lobbyApp" class="app-root">
    <header class="top-bar">
      <div class="balance"><span id="balanceValue">0</span> ⭐</div>
      <button id="addStarsBtn" class="icon-btn">+</button>
    </header>

    <main class="main-content">
      <section class="lobby-header">
        <button id="backBtn" class="lobby-history-btn">← Меню</button>
        <div id="lobbyTitle" class="lobby-title">Режим</div>
        <div style="margin-left:auto;color:#9ca3af;font-size:13px;">
          Таймер: <span id="pregameTimer">—</span> • Комиссия: <span id="commission">5%</span>
        </div>
      </section>

      <section class="lobby-arena">
        <canvas id="arenaCanvas"></canvas>
      </section>

      <section class="lobby-bets">
        <div class="lobby-bets-row">
          <button class="lobby-bet-btn" data-bet="50">50 ⭐</button>
          <button class="lobby-bet-btn" data-bet="100">100 ⭐</button>
          <button class="lobby-bet-btn" data-bet="500">500 ⭐</button>
        </div>
        <div class="lobby-bets-row">
          <button class="lobby-bet-btn" data-bet="1000">1000 ⭐</button>
          <button class="lobby-bet-btn" data-bet="2500">2500 ⭐</button>
          <button class="lobby-bet-btn" data-bet="5000">5000 ⭐</button>
        </div>
        <div class="lobby-custom-bet">
          <input id="customBetInput" type="number" placeholder="Своя ставка" />
        </div>
      </section>

      <section class="lobby-players">
        <div class="lobby-players-title">
          Игроки: <span id="playersCount">0</span> • Банк: <span id="bankValue">0</span> ⭐
        </div>
        <div id="playersList" class="lobby-players-list"></div>
      </section>

      <section class="lobby-history">
        <div class="lobby-history-header">
          <button id="historyBtn" class="lobby-history-btn">История</button>
        </div>
        <div id="historyList" class="history-list"></div>
      </section>
    </main>
  </div>

  <div id="betSheet" class="bet-sheet">
    <div style="font-weight:700;margin-bottom:8px;">Поставить ставку</div>
    <div class="sheet-row">
      <input id="sheetAmount" type="number" placeholder="Сумма" />
      <button id="sheetSetBtn" class="primary-btn" style="flex:0 0 120px;">Поставить</button>
    </div>
    <div style="font-size:12px;color:#9ca3af;">Комиссия: 5% будет удержана от банка</div>
    <button id="sheetCloseBtn" class="secondary-btn" style="margin-top:8px;">Отмена</button>
  </div>

  <script src="lobby.js"></script>
</body>
</html>





