// Ambient "Corn Planet" background: one giant anomalous Corn Planet seen from orbit, with the
// CPI Database floating above it. Purely decorative and behind all content.
//
// The kernel/husk surface, cloud layer and star fields are each drawn ONCE into small tileable
// canvases and used as repeating backgrounds. Motion is CSS transform animation only (slow
// rotation, cloud drift, star drift, a scan line), so nothing redraws per frame. Styles live in
// style.css under "CORN PLANET"; prefers-reduced-motion stops all of it.

(function () {
    var TILE_W = 1024;
    var TILE_H = 512;

    // Small deterministic PRNG so the planet looks the same on every visit.
    var seed = 20240917;
    function rand() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    }

    function canvas(w, h) {
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
    }

    // Draws `fn(x, y)` at x and its horizontal/vertical wraps so the tile repeats seamlessly.
    function wrapped(x, y, r, w, h, fn) {
        for (var dx = -1; dx <= 1; dx++) {
            for (var dy = -1; dy <= 1; dy++) {
                var px = x + dx * w;
                var py = y + dy * h;
                if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
                fn(px, py);
            }
        }
    }

    function surfaceTile() {
        var c = canvas(TILE_W, TILE_H);
        var g = c.getContext("2d");

        // Base: deep gold.
        g.fillStyle = "#6b4a05";
        g.fillRect(0, 0, TILE_W, TILE_H);

        // Kernel field: offset rows of rounded kernels, each with its own shade and a highlight.
        // Exact divisors of the tile (and an even row count) so the kernel grid repeats without seams.
        var kw = TILE_W / 46;
        var kh = TILE_H / 28;
        for (var row = 0; row < 28; row++) {
            var offset = row % 2 ? kw / 2 : 0;
            for (var col = -1; col <= 46; col++) {
                var x = col * kw + offset;
                var y = row * kh;
                var tone = 0.75 + rand() * 0.35;
                var r = Math.min(255, Math.round(232 * tone));
                var gch = Math.min(255, Math.round(172 * tone));
                var b = Math.round(28 * tone);
                var grad = g.createRadialGradient(x + kw * 0.38, y + kh * 0.32, 1, x + kw / 2, y + kh / 2, kw * 0.62);
                grad.addColorStop(0, "rgb(" + Math.min(255, r + 30) + "," + Math.min(255, gch + 40) + "," + (b + 40) + ")");
                grad.addColorStop(0.55, "rgb(" + r + "," + gch + "," + b + ")");
                grad.addColorStop(1, "rgb(" + Math.round(r * 0.45) + "," + Math.round(gch * 0.4) + ",0)");
                g.fillStyle = grad;
                g.beginPath();
                if (g.roundRect) g.roundRect(x + 1, y + 1, kw - 2, kh - 2, 7);
                else g.rect(x + 1, y + 1, kw - 2, kh - 2);
                g.fill();
            }
        }

        // Broad tonal regions (ripe orange, pale, scorched) so the surface reads at planet scale.
        var tints = ["rgba(170, 70, 0, 0.35)", "rgba(255, 240, 170, 0.22)", "rgba(40, 20, 0, 0.45)"];
        for (var t = 0; t < 14; t++) {
            var tx = rand() * TILE_W;
            var ty = rand() * TILE_H;
            var tr = 80 + rand() * 160;
            var tint = tints[t % tints.length];
            wrapped(tx, ty, tr, TILE_W, TILE_H, function (px, py) {
                var tg = g.createRadialGradient(px, py, 0, px, py, tr);
                tg.addColorStop(0, tint);
                tg.addColorStop(1, "rgba(0, 0, 0, 0)");
                g.fillStyle = tg;
                g.fillRect(px - tr, py - tr, tr * 2, tr * 2);
            });
        }

        // Husk regions: dark green continents with long fibrous streaks, wrapped so the tile repeats.
        for (var i = 0; i < 11; i++) {
            var cx = rand() * TILE_W;
            var cy = rand() * TILE_H;
            var rx = 110 + rand() * 170;
            var ry = 40 + rand() * 90;
            var rot = (rand() - 0.5) * 0.6;
            var fibres = [];
            for (var f = 0; f < 14; f++) fibres.push([(rand() - 0.5) * rx * 1.4, (rand() - 0.5) * 20, (rand() - 0.5) * 20]);
            wrapped(cx, cy, rx, TILE_W, TILE_H, function (px, py) {
                g.save();
                g.translate(px, py);
                g.rotate(rot);
                g.scale(1, ry / rx);
                // Built after the transform, so every wrapped copy is identical.
                var husk = g.createRadialGradient(0, 0, 0, 0, 0, rx);
                husk.addColorStop(0, "rgba(20, 44, 10, 0.97)");
                husk.addColorStop(0.55, "rgba(34, 62, 16, 0.88)");
                husk.addColorStop(1, "rgba(38, 64, 18, 0)");
                g.fillStyle = husk;
                g.beginPath();
                g.arc(0, 0, rx, 0, Math.PI * 2);
                g.fill();
                // Fibres
                g.strokeStyle = "rgba(120, 150, 60, 0.22)";
                g.lineWidth = 1.5;
                fibres.forEach(function (fb) {
                    g.beginPath();
                    g.moveTo(-rx * 0.85, fb[0]);
                    g.bezierCurveTo(-rx * 0.3, fb[0] + fb[1], rx * 0.3, fb[0] + fb[2], rx * 0.85, fb[0]);
                    g.stroke();
                });
                g.restore();
            });
        }

        // Silk strands: thin pale filaments trailing across the surface.
        g.strokeStyle = "rgba(255, 238, 190, 0.12)";
        g.lineWidth = 1;
        for (var s = 0; s < 40; s++) {
            var sx = rand() * TILE_W;
            var sy = rand() * TILE_H;
            g.beginPath();
            g.moveTo(sx, sy);
            g.quadraticCurveTo(sx + 40 + rand() * 60, sy + (rand() - 0.5) * 30, sx + 90 + rand() * 90, sy + (rand() - 0.5) * 20);
            g.stroke();
        }
        return c;
    }

    function cloudTile() {
        var c = canvas(TILE_W, TILE_H);
        var g = c.getContext("2d");
        for (var i = 0; i < 70; i++) {
            var cx = rand() * TILE_W;
            var cy = rand() * TILE_H;
            var r = 20 + rand() * 70;
            var a = 0.05 + rand() * 0.12;
            wrapped(cx, cy, r * 2.5, TILE_W, TILE_H, function (px, py) {
                g.save();
                g.translate(px, py);
                g.scale(2.5, 1);
                var cl = g.createRadialGradient(0, 0, 0, 0, 0, r);
                cl.addColorStop(0, "rgba(255, 246, 215, " + a + ")");
                cl.addColorStop(1, "rgba(255, 246, 215, 0)");
                g.fillStyle = cl;
                g.beginPath();
                g.arc(0, 0, r, 0, Math.PI * 2);
                g.fill();
                g.restore();
            });
        }
        return c;
    }

    function starTile(count, maxR) {
        var c = canvas(512, 512);
        var g = c.getContext("2d");
        for (var i = 0; i < count; i++) {
            var a = 0.25 + rand() * 0.75;
            var warm = rand() < 0.2;
            g.fillStyle = warm ? "rgba(255, 220, 140, " + a + ")" : "rgba(220, 230, 255, " + a + ")";
            g.beginPath();
            g.arc(rand() * 512, rand() * 512, 0.3 + rand() * maxR, 0, Math.PI * 2);
            g.fill();
        }
        return c;
    }

    function layer(cls, url) {
        var d = document.createElement("div");
        d.className = cls;
        if (url) d.style.backgroundImage = "url(" + url + ")";
        return d;
    }

    // Orbital observation layer. Everything here is decorative interface labelling (no canon,
    // no data), hidden from screen readers. Markers are pinned to points on the planet's
    // surface and re-pinned when the window changes size.
    var MARKERS = [
        // side: which side of the page column it sits beside on wide screens ("center" = below the
        // content). u: fallback position across the planet (0..1). depth: px below the limb.
        { side: "left", u: 0.22, depth: 40, label: "SECTOR C-04", cls: "" },
        { side: "center", u: 0.52, depth: 26, label: "NORTHERN OBSERVATION ZONE", cls: "keep" },
        { side: "right", u: 0.80, depth: 70, label: "RESTRICTED SURFACE REGION", cls: "warn" }
    ];

    function hud() {
        var h = document.createElement("div");
        h.className = "cpHud";
        h.setAttribute("aria-hidden", "true");
        var markers = MARKERS.map(function (m) {
            return '<div class="cpMarker ' + m.cls + '"><span class="cpDot"></span><span class="cpLead"></span><span class="cpTag">' + m.label + '</span></div>';
        }).join("");
        h.innerHTML =
            markers +
            '<div class="cpReticle"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><b></b>' +
            '<span class="cpRetLabel">OBS-07 &middot; MONITORING</span>' +
            '<span class="cpRetCoord">12.04&deg;N 088.31&deg;W</span></div>' +
            '<div class="cpReadout">CPI ORBITAL OBSERVATION &middot; CORN PLANET<br><span class="cpLive">&#9679;</span> OBSERVATION FEED ACTIVE</div>' +
            '<div class="cpSweep"></div>';
        return h;
    }

    // Pins markers and the reticle to the planet's actual surface (its curve differs on phones).
    function pin(scene) {
        var planet = scene.querySelector(".cpPlanet");
        if (!planet) return;
        var r = planet.getBoundingClientRect();
        var R = r.width / 2;
        var cx = r.left + R;
        var cy = r.top + R;
        var vw = window.innerWidth;
        function surfaceY(x) {
            var dx = Math.max(-R, Math.min(R, x - cx));
            return cy - Math.sqrt(R * R - dx * dx);
        }
        var left = Math.max(0, r.left);
        var width = Math.min(vw, r.right) - left;
        var vh = window.innerHeight;

        // Keep markers out from under the page column: beside it in the gutters when there is
        // room, or below the content; otherwise spread across the planet.
        var col = document.body.getBoundingClientRect();
        var gutter = Math.min(col.left, vw - col.right);
        var roomy = gutter >= 170;
        // Without real gutters the corner readout and reticle would just peek out from behind the page.
        var hudEl = scene.querySelector(".cpHud");
        if (hudEl) hudEl.classList.toggle("cramped", !roomy);
        var content = document.getElementById("mainContent");
        var contentBottom = content && content.offsetParent ? content.getBoundingClientRect().bottom : 0;

        function place(el, x, y, flip) {
            var visible = y > 0 && y < vh - 40;
            el.style.visibility = visible ? "" : "hidden";
            el.classList.toggle("flip", !!flip);
            el.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)" + (flip ? " translateX(-100%)" : "");
            // Never let a label run off the screen: point it the other way instead.
            var box = el.getBoundingClientRect();
            if (box.width && (box.right > vw - 6 || box.left < 6)) {
                flip = !flip;
                el.classList.toggle("flip", flip);
                el.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)" + (flip ? " translateX(-100%)" : "");
                box = el.getBoundingClientRect();
                if (box.right > vw - 6 || box.left < 6) {
                    // Too wide either way (narrow phones): slide it fully on screen, label to the right.
                    el.classList.remove("flip");
                    x = Math.max(6, Math.min(x, vw - 6 - box.width));
                    el.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
                }
            }
        }

        scene.querySelectorAll(".cpMarker").forEach(function (el, i) {
            var m = MARKERS[i];
            var x = left + width * m.u;
            var y = surfaceY(x) + m.depth;
            var flip = m.u > 0.6; // labels on the right half point inward
            if (roomy && m.side === "left") x = col.left * 0.5, y = surfaceY(x) + m.depth;
            else if (roomy && m.side === "right") x = col.right + (vw - col.right) * 0.7, y = surfaceY(x) + m.depth, flip = true;
            else if (m.side === "center" && contentBottom) y = Math.max(surfaceY(x) + m.depth, contentBottom + 36);
            place(el, x, y, flip);
        });
        var ret = scene.querySelector(".cpReticle");
        if (ret) {
            var rx = roomy ? col.left * 0.5 : left + width * 0.66;
            var ry = surfaceY(rx) + (roomy ? 110 : 90);
            if (!roomy && contentBottom) ry = Math.max(ry, contentBottom + 70);
            ry = Math.min(ry, vh - 120); // stays clear of the corner readout
            place(ret, rx, ry, false);
        }
        var sweep = scene.querySelector(".cpSweep");
        if (sweep) sweep.style.setProperty("--horizon", Math.round(Math.max(0, r.top)) + "px");
    }

    function build() {
        var scene = document.createElement("div");
        scene.id = "cornPlanetScene";
        scene.setAttribute("aria-hidden", "true");

        var starsFar = starTile(140, 0.7);
        var starsNear = starTile(45, 1.3);
        scene.appendChild(layer("cpStars far", starsFar.toDataURL()));
        scene.appendChild(layer("cpStars", starsNear.toDataURL()));

        var planet = document.createElement("div");
        planet.className = "cpPlanet";
        planet.style.setProperty("--tile", TILE_W + "px");
        planet.appendChild(layer("cpSurface", surfaceTile().toDataURL("image/png")));
        planet.appendChild(layer("cpClouds", cloudTile().toDataURL()));
        planet.appendChild(layer("cpShade"));
        planet.appendChild(layer("cpAtmo"));
        scene.appendChild(planet);

        scene.appendChild(layer("cpVeil"));
        scene.appendChild(hud());
        document.body.insertBefore(scene, document.body.firstChild);
        pin(scene);
        // Content can change size after load (records render, the gate opens): re-pin then too.
        window.addEventListener("load", function () { pin(scene); });
        if (window.ResizeObserver) new ResizeObserver(function () { pin(scene); }).observe(document.body);
        var queued = false;
        window.addEventListener("resize", function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                pin(scene);
            });
        });
        if (/\/(index\.html)?$/.test(location.pathname)) document.body.classList.add("cpHome");
    }

    try {
        build();
    } catch (err) {
        // Decoration only: never let it break the database.
        if (window.console) console.warn("Corn Planet background unavailable:", err);
    }
})();
