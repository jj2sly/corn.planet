# CPI Party Godot Client

This is the native 3D client foundation for CPI Party.

## Purpose

The Godot client is intentionally being built alongside the existing web Party client. The web client remains playable and is the rapid prototype/debug target. Godot becomes the full 3D/native runtime.

## First target

CPI: Cold Case.

The first migration target is the kitchen -> refrigerator -> interior path. Existing Cold Case gameplay logic is the specification; it is not being discarded.

## Architecture

Godot owns:
- 3D rendering
- scenes
- materials
- lighting
- animation
- particles
- local input
- camera
- physics
- device quality

The existing Party server owns:
- rooms
- accounts
- multiplayer authority
- persistent data
- game/session state
- statistics

Do not duplicate server authority in the client.

## Development order

1. Native app shell
2. Cold Case kitchen scene
3. First-person controller
4. Refrigerator interaction
5. Interior/pantry
6. Server session bridge
7. Multiplayer player replication
8. Food/temperature
9. Repair systems
10. Full mission
