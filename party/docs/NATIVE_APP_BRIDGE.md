# CPI Party native app bridge

The Godot client is the native presentation/runtime layer. The existing Party server remains authoritative for rooms, players, game state, scores, and persistence.

## Current bridge

The native client uses a small HTTP session bridge under `/api/native`.

- `POST /api/native/host` creates a room and returns a session token.
- `POST /api/native/player` joins a room and returns a player session token.
- `GET /api/native/state` returns the same room view model used by the browser party client.
- `POST /api/native/configure` changes host configuration.
- `POST /api/native/start` starts the configured server game.
- `POST /api/native/input` forwards player game input.
- `POST /api/native/host-action` forwards host/leader actions.
- `POST /api/native/leave` detaches the native session.

The session token is sent in `X-CPI-Session`. Firebase bearer authentication may also be supplied through the normal `Authorization` header.

## Why this exists

Godot cannot directly consume the browser's Socket.IO client protocol without adding a compatible client implementation. The HTTP bridge gives the native application a stable transport-independent contract now. A native realtime transport can be added later without changing the game-facing session API.

## Authority boundary

Godot owns rendering, local input, camera, animation, physics presentation, effects, and device quality.

The Party server owns room membership, authoritative game state, timers, scores, and persistent records.

Never move authority into the Godot client merely to make a feature easier.
