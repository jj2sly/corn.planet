// Ambient "Corn Solar System" background effect.
// A corn-cob sun sits in the corner with real planet imagery (NASA-data-based
// texture maps via Solar System Scope, CC BY 4.0) orbiting around it.
// Purely decorative and non-interactive.

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

    // Planets: real texture images, sized/spaced/timed to feel like a
    // loose solar system rather than a perfect mechanical clock.
    const planets = [
<<<<<<< HEAD
        { name: "Mercury", img: TEX + "2k_mercury.jpg",       distance: 65,  duration: 9,  size: 20 },
        { name: "Venus",   img: TEX + "2k_venus_surface.jpg", distance: 100, duration: 14, size: 26 },
        { name: "Earth",   img: TEX + "2k_earth_daymap.jpg",  distance: 140, duration: 20, size: 30 },
        { name: "Mars",    img: TEX + "2k_mars.jpg",          distance: 185, duration: 28, size: 24 },
        { name: "Jupiter", img: TEX + "2k_jupiter.jpg",       distance: 235, duration: 38, size: 46 },
        { name: "Saturn",  img: TEX + "2k_saturn.jpg",        distance: 295, duration: 50, size: 40 },
        { name: "Uranus",  img: TEX + "2k_uranus.jpg",        distance: 355, duration: 64, size: 30 },
        { name: "Neptune", img: TEX + "2k_neptune.jpg",       distance: 415, duration: 80, size: 28 }
=======
        { name: "Mercury", img: TEX + "2k_mercury.jpg",       distance: 70,  duration: 9,  size: 16 },
        { name: "Venus",   img: TEX + "2k_venus_surface.jpg", distance: 110, duration: 14, size: 20 },
        { name: "Earth",   img: TEX + "2k_earth_daymap.jpg",  distance: 155, duration: 20, size: 24 },
        { name: "Mars",    img: TEX + "2k_mars.jpg",          distance: 205, duration: 28, size: 18 },
        { name: "Jupiter", img: TEX + "2k_jupiter.jpg",       distance: 265, duration: 38, size: 36 },
        { name: "Saturn",  img: TEX + "2k_saturn.jpg",        distance: 330, duration: 50, size: 32 },
        { name: "Uranus",  img: TEX + "2k_uranus.jpg",        distance: 400, duration: 64, size: 24 },
        { name: "Neptune", img: TEX + "2k_neptune.jpg",       distance: 470, duration: 80, size: 22 }
>>>>>>> cdac7fa882155a45e7b41910ad91d43f659d6bc1
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

        const planet = document.createElement("img");
        planet.className = "cornPlanet";
        planet.src = p.img;
        planet.alt = p.name;
        planet.loading = "lazy";
        planet.style.width = p.size + "px";
        planet.style.height = p.size + "px";

        // Saturn gets a simple ring effect via an extra element
        if (p.name === "Saturn") {
            const ringEl = document.createElement("div");
            ringEl.className = "saturnRing";
            ringEl.style.width = (p.size * 1.9) + "px";
            ringEl.style.height = (p.size * 0.5) + "px";
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
