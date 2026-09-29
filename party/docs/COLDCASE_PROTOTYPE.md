# CPI: Cold Case prototype

The first playable slice is intentionally small and concrete.

## Browser entry

Open `/coldcase` on the Party server.

## Current slice

`KITCHEN → FRIDGE_ENTRANCE → PANTRY → POWER_ROOM`

The client is a dependency-free WebGL prototype. It does not require Three.js or a bundler.

Controls:
- Desktop: WASD/arrows, mouse look, E to interact, Shift to sprint.
- Touch: left joystick to move, right side swipe to look, INTERACT button.

## Gameplay proof

The slice demonstrates:
1. normal kitchen
2. anomalous refrigerator transition
3. oversized refrigerator interior
4. pantry exploration
5. temperature manipulation
6. first milk encounter
7. power-room entry
8. interactive four-step power repair

The authoritative level description is `server/coldcase/level.ts`.

## Expansion rule

Do not add another generic engine abstraction unless the playable slice exposes a real missing capability. Expand the actual level first, then extract reusable behavior only when it is clearly shared by another Cold Case area or CPI game.
