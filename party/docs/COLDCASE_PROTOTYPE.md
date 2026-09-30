# CPI: Cold Case (browser, top-down)

Open `/coldcase` on the Party server. Solo, no session needed; desktop keyboard first, touch and gamepad supported.

The old first-person WebGL prototype is retired. Godot stays a possible native path; the web game does not depend on it.

## Files

- `public/js/coldcase/map.js` — the map: rooms, doors, stations, threats, hazards, lights (tile units, 1 tile = 1 m).
- `public/js/coldcase/sim.js` — deterministic, DOM-free simulation (movement, temperature/warmth, food threats, doors, repair panels, checkpoints, objectives). Tuning lives in `CONFIG`.
- `public/js/coldcase/content.js` — every visible line. **Chuck's lines are placeholders pending owner canon.**
- `render.js` / `art.js` (canvas), `hud.js`, `input.js`, `audio.js` (through the shared `games/mycob-sound.js`), `bot.js` (scripted agent).
- Tests: `test/coldcase.test.ts`, including full bot playthroughs.

## Loop

Briefing → open fridge (portal) → food storage thermostat (thaws the power room hatch; above +6.5 °C the milk spoils) → breakers + main bus → freezer valves + compressor (ice cream hardens) → technician outpost (Chuck, warm zone, locker) → deep interior (heat lamps, vents) → core (coils, pressure, temperature, hold the ring) → emergency lift → exit → debrief (`STABILIZED — MONITORING REQUIRED`).

Controls: WASD/arrows move, E interact (hold for repairs), Space heat pack, Esc/P pause, M map. `?autopilot` plays it with the bot; `?debug` exposes `window.__coldcase`.
