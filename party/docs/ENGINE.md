# CPI Party Engine

CPI Party already has a working minigame runtime: rooms own networking, reconnects, timers, scores, stats and persistence while each game owns its rules and viewer-safe state. This document marks the reusable boundary without rewriting the existing games.

## Boundary

- `server/rooms.ts` is the multiplayer host/runtime.
- `server/games/*` contains installed game implementations.
- `server/engine/game.ts` contains the stable game-facing lifecycle contract.
- `server/games/types.ts` remains the compatibility layer for the existing games and game-specific context services.
- `server/games/kit/` contains reusable simulation/economy primitives shared by games.
- `public/js/cpi/` contains reusable client presentation primitives.

A game should not need to know how rooms, Socket.IO, reconnect tokens, persistence, or host/leader authority work.

## Migration rule

Do not move all existing files at once. New shared functionality should be added to the engine or a reusable kit only when at least two games can use it. Existing games stay behavior-compatible while their imports are migrated incrementally.

## Cold Case

CPI: Cold Case should use these contracts from its first implementation. It should not add a second room system, networking layer, account system, or game registry.

## Future extraction candidates

1. Input/action validation helpers.
2. Phase/state-machine helpers for games with explicit phases.
3. Shared mission/debrief records.
4. Shared checkpoint/downed/revive primitives for cooperative games.
5. Shared device/handheld presentation helpers on the client.

These are candidates, not a reason to abstract prematurely.
