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

## Platform direction

The native client is now being treated as the actual CPI application, not a Cold Case launcher. The shell owns:
- Home / command center
- game library and module registry
- party-room control
- CPST Database read-only canon access
- local personnel profile
- shared client settings
- the shared native session/runtime boundary

Game modules plug into this shell instead of creating their own account, room, settings, or canon systems.

### Migration order

1. Keep the application shell and shared runtime stable.
2. Move existing Party games behind the native module contract one at a time.
3. Replace temporary module placeholders with their real native gameplay when ready.
4. Add authenticated CPI identity and server-backed profile/stat persistence.
5. Replace state polling with native realtime transport where needed.
6. Add platform-specific input and quality profiles.
7. Export the same Godot project for desktop and mobile targets.

The browser client remains the fallback/debug implementation during migration.

The browser client remains the fallback/debug implementation during migration.
