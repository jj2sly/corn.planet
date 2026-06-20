// Ambient falling corn background effect.
// Spawns drifting corn particles that fall from the top of the screen,
// purely decorative and non-interactive.

(function () {
    const container = document.createElement("div");
    container.id = "cornFallContainer";
    document.body.appendChild(container);

    function spawnCorn() {
        const corn = document.createElement("span");
        corn.className = "cornParticle";
        corn.textContent = "🌽";

        const startX = Math.random() * 100; // vw
        const duration = 8 + Math.random() * 7; // seconds
        const size = 0.8 + Math.random() * 1.4; // rem
        const drift = (Math.random() - 0.5) * 120; // px sideways drift
        const spinDirection = Math.random() < 0.5 ? 1 : -1;

        corn.style.left = startX + "vw";
        corn.style.fontSize = size + "rem";
        corn.style.animationDuration = duration + "s";
        corn.style.setProperty("--drift", drift + "px");
        corn.style.setProperty("--spin", (360 * spinDirection) + "deg");

        container.appendChild(corn);

        setTimeout(() => {
            corn.remove();
        }, duration * 1000 + 200);
    }

    // Spawn a new piece of corn at a steady, gentle interval
    setInterval(spawnCorn, 900);

    // Seed a few immediately so it doesn't feel empty on page load
    for (let i = 0; i < 4; i++) {
        setTimeout(spawnCorn, i * 400);
    }
})();
