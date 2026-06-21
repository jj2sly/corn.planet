// Ambient "Corn Solar System" background effect.
// A corn-cob sun sits in the corner with planets orbiting around it,
// purely decorative and non-interactive.

(function () {
    const container = document.createElement("div");
    container.id = "cornSystemContainer";
    document.body.appendChild(container);

    // The sun itself
    const sun = document.createElement("div");
    sun.id = "cornSun";
    sun.textContent = "🌽";
    container.appendChild(sun);

    // Glow behind the sun
    const glow = document.createElement("div");
    glow.id = "cornSunGlow";
    container.appendChild(glow);

    // Planets: each gets its own orbit ring (for the path) and a
    // planet element that spins around it. Distance/speed/size vary
    // so it reads as a loose solar system rather than a perfect clock.
    const planets = [
        { emoji: "🪨", distance: 70,  duration: 9,  size: 0.7 },
        { emoji: "🌑", distance: 110, duration: 14, size: 0.8 },
        { emoji: "🌍", distance: 155, duration: 20, size: 1.0 },
        { emoji: "🔴", distance: 205, duration: 28, size: 0.85 },
        { emoji: "🟠", distance: 265, duration: 38, size: 1.3 },
        { emoji: "🪐", distance: 330, duration: 50, size: 1.2 },
        { emoji: "🔵", distance: 400, duration: 64, size: 0.95 },
        { emoji: "🌌", distance: 470, duration: 80, size: 0.9 }
    ];

    planets.forEach((p, i) => {
        const ring = document.createElement("div");
        ring.className = "orbitRing";
        ring.style.width = (p.distance * 2) + "px";
        ring.style.height = (p.distance * 2) + "px";
        container.appendChild(ring);

        const orbit = document.createElement("div");
        orbit.className = "planetOrbit";
        orbit.style.width = (p.distance * 2) + "px";
        orbit.style.height = (p.distance * 2) + "px";
        orbit.style.animationDuration = p.duration + "s";
        // Stagger starting angle so planets don't all line up
        orbit.style.animationDelay = "-" + (p.duration * (i / planets.length)) + "s";

        const planet = document.createElement("span");
        planet.className = "cornPlanet";
        planet.textContent = p.emoji;
        planet.style.fontSize = p.size + "rem";

        orbit.appendChild(planet);
        container.appendChild(orbit);
    });
})();
