# CPI Party Godot Client

The native 3D client for CPI Party. It is being built alongside the existing browser party client so the server/game architecture can migrate without throwing away working systems.

## Current state

Phase 1 (native foundation) is in place:
- native CPI Party library shell
- Cold Case kitchen and refrigerator entry
- interconnected interior, pantry, power, freezer, deep interior, outpost, and checkpoint scenes
- first-person keyboard/mouse movement
- temperature progression
- food encounter foundation
- power and cooling repair puzzles
- technician outpost foundation
- core repair interaction
- mission completion/debrief foundation
- shared native runtime, quality, session, and input modules

Phase 2 (server bridge) is in place:
- native host room creation
- native player room joining
- session tokens
- authoritative room-state polling
- native game input forwarding
- host action forwarding
- host configuration/start endpoints
- native session leave
- same Party RoomManager and game state as the browser client

See `party/docs/NATIVE_APP_BRIDGE.md` for the transport contract.

## Authority boundary

Godot owns:
- 3D rendering
- scenes
- materials
- lighting
- animation
- particles
- local input
- camera
- physics presentation
- device quality
- local presentation of authoritative state

The Party server owns:
- accounts
- rooms
- multiplayer authority
- timers
- game/session state
- scores
- persistent data
- statistics
- canon access

Never move authority into the Godot client just to make a feature easier.

## Development direction

1. Finish Cold Case gameplay depth and multiplayer replication.
2. Replace polling with a native realtime transport where needed.
3. Add authenticated app sign-in.
4. Add shared CPI Party account/profile UI.
5. Migrate existing party games behind the native game-library shell.
6. Add platform-specific input and quality profiles.
7. Export the same Godot project for desktop and mobile targets.

The browser client remains the fallback/debug implementation during migration.
