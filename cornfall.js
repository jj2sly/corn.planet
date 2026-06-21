// Ambient "Corn Solar System" background effect.
// A corn-cob sun sits centered behind the page content, with real
// planet imagery (NASA-data-based texture maps via Solar System Scope,
// CC BY 4.0) orbiting fully visibly around it. Purely decorative.

(function () {
    const container = document.createElement("div");
    container.id = "cornSystemContainer";
    document.body.appendChild(container);

    // The sun itself (stays as corn for theme)
    const sun = document.createElement("div");
    sun.id = "cornSun";
    sun.textContent = "🌽";
    container.appendChild(sun);

    // Glow behind the sun
    const glow = document.createElement("div");
    glow.id = "cornSunGlow";
    container.appendChild(glow);

    const TEX = "https://www.solarsystemscope.com/textures/download/";

    // Distances/sizes are in vmin (% of the smaller viewport dimension)
    // so the entire system always fits on screen, any device size.
    const planets = [
        { name: "Mercury", img: TEX + "2k_mercury.jpg",       distance: 9,  duration: 9,  size: 1.6 },
        { name: "Venus",   img: TEX + "2k_venus_surface.jpg", distance: 14, duration: 14, size: 2.0 },
        { name: "Earth",   img: TEX + "2k_earth_daymap.jpg",  distance: 19, duration: 20, size: 2.3 },
        { name: "Mars",    img: TEX + "2k_mars.jpg",          distance: 24, duration: 28, size: 1.9 },
        { name: "Jupiter", img: TEX + "2k_jupiter.jpg",       distance: 30, duration: 38, size: 3.4 },
        { name: "Saturn",  img: TEX + "2k_saturn.jpg",        distance: 36, duration: 50, size: 3.0 },
        { name: "Uranus",  img: TEX + "2k_uranus.jpg",        distance: 42, duration: 64, size: 2.3 },
        { name: "Neptune", img: TEX + "2k_neptune.jpg",       distance: 47, duration: 80, size: 2.1 }
    ];

    planets.forEach((p, i) => {
        const ring = document.createElement("div");
        ring.className = "orbitRing";
        ring.style.width = (p.distance * 2) + "vmin";
        ring.style.height = (p.distance * 2) + "vmin";
        container.appendChild(ring);

        const orbit = document.createElement("div");
        orbit.className = "planetOrbit";
        orbit.style.width = (p.distance * 2) + "vmin";
        orbit.style.height = (p.distance * 2) + "vmin";
        orbit.style.animationDuration = p.duration + "s";
        // Stagger starting angle so planets don't all line up
        orbit.style.animationDelay = "-" + (p.duration * (i / planets.length)) + "s";

        const planet = document.createElement("img");
        planet.className = "cornPlanet";
        planet.src = p.img;
        planet.alt = p.name;
        planet.loading = "lazy";
        planet.style.width = p.size + "vmin";
        planet.style.height = p.size + "vmin";

        // Saturn gets a simple ring effect via an extra element
        if (p.name === "Saturn") {
            const ringEl = document.createElement("div");
            ringEl.className = "saturnRing";
            ringEl.style.width = (p.size * 1.9) + "vmin";
            ringEl.style.height = (p.size * 0.5) + "vmin";
            orbit.appendChild(ringEl);
        }

        orbit.appendChild(planet);
        container.appendChild(orbit);
    });

    // CC BY 4.0 attribution (required by license, kept small/unobtrusive)
    const credit = document.createElement("a");
    credit.id = "textureCredit";
    credit.href = "https://www.solarsystemscope.com/textures/";
    credit.target = "_blank";
    credit.rel = "noopener";
    credit.textContent = "Planet textures © Solar System Scope (CC BY 4.0)";
    document.body.appendChild(credit);
})();
