for (const button of document.querySelectorAll("[data-pc-game]")) {
  button.addEventListener("click", async () => {
    const gameId = button.dataset.pcGame;
    if (!gameId) return;
    button.disabled = true;
    try {
      await window.cpiDesktop.launchPcGame(gameId);
    } finally {
      button.disabled = false;
    }
  });
}
