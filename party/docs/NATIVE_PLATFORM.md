# CPI Native Platform

## Purpose

The Godot project under `party/godot/` is the native CPI client/platform. It is not a replacement for the existing Corn Planet Party server and it is not itself a single game.

The platform owns the application shell and shared client systems. Games are modules loaded by the shell.

## Platform layers

```
CPI APP
│
├── Application Shell
│   ├── Home
│   ├── Game Library
│   ├── CPST Database
│   ├── Rooms
│   ├── Profile
│   └── Settings
│
├── Shared Runtime
│   ├── Session / identity
│   ├── Native server bridge
│   ├── Input
│   ├── Audio
│   ├── Quality / device scaling
│   ├── Save data
│   └── Notifications
│
├── CPI Content
│   ├── Game registry
│   ├── CPST entities
│   ├── Characters
│   ├── Items
│   ├── Achievements
│   └── Shared UI
│
└── Modules
    ├── Corn or Shit
    ├── Entity Auction
    ├── My Cob Escaped
    ├── Escape Thad's Steam Deck
    ├── Angry Thud's Revenge
    └── CPI: Cold Case
```

## Ownership

### Native client

The native client should own:

- navigation
- presentation
- local settings
- local profile/session state
- input and controller mapping
- audio
- graphics quality
- game launching
- shared client UI
- client-side caching
- platform notifications

### Existing Party server

The server remains authoritative for:

- room membership
- game state
- timers
- scores
- player validation
- persistence
- multiplayer synchronization
- moderation
- CPI Party game rules

The native client communicates through the existing `/api/native` bridge first. This lets the platform grow without rewriting the multiplayer backend.

### CPI Database

The CPI Database remains the canonical source for CPI entity records and institution canon.

The native app can consume it, but game-generated content must not silently become canon.

## Game module contract

A future game should expose metadata rather than being hardcoded into the shell:

- id
- display name
- category
- description
- player count
- availability status
- client scene
- server game id
- capabilities
- version

The registry in `scripts/app/app_registry.gd` is the first implementation of this concept.

## Migration strategy

Do not rewrite every browser game at once.

1. Stabilize the native platform shell.
2. Move shared client systems into the platform.
3. Build one complete native game module.
4. Add multiplayer session handoff.
5. Migrate existing games one at a time.
6. Add native CPST Database views.
7. Retire duplicate client-only systems only after their replacements work.

Cold Case is currently the first native 3D module, but it should not define the architecture of the whole application.

## Long-term application shape

The finished client should feel like one CPI application rather than a collection of separate games.

A user should be able to:

1. Launch the app.
2. Sign in or continue as a guest.
3. See their CPI profile.
4. Browse games and missions.
5. Create or join a room.
6. Launch a game without leaving the application.
7. Inspect CPST records without opening a separate site.
8. See statistics, achievements and history.
9. Change client-wide settings.
10. Return to the same shell after every game.

## Important constraint

Keep the shell independent of any individual game.

A game may use shared platform services, but the platform must never need to know how a particular game's rules work.
