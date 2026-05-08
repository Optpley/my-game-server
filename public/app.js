// public/app.js (фрагменты для mix modal behavior)
document.addEventListener("DOMContentLoaded", () => {
  const mixThumbBtn = document.getElementById("mixThumbBtn");
  const mixModal = document.getElementById("mixModal");
  const mixCloseBtn = document.getElementById("mixCloseBtn");
  const mixPlayBtn = document.getElementById("mixPlayBtn");

  if (mixThumbBtn && mixModal) {
    mixThumbBtn.addEventListener("click", () => {
      mixModal.classList.remove("hidden");
    });
  }
  if (mixCloseBtn && mixModal) {
    mixCloseBtn.addEventListener("click", () => {
      mixModal.classList.add("hidden");
    });
  }

  // mixPlayBtn starts a MIX game (normal flow)
  if (mixPlayBtn) {
    mixPlayBtn.addEventListener("click", () => {
      window.location.href = `/lobby.html?mode=${encodeURIComponent("mix")}`;
    });
  }

  // ensure thumbnails are preview-only: no click handlers that call join_lobby
  // thumbnails are static placeholders for now
});






