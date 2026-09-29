# CPI Native App Platform Roadmap

The Godot client is the long-term CPI Party application shell. Existing browser games remain usable while native modules are migrated.

## Current platform foundation

Implemented now:

- Application shell and navigation
- Searchable game library
- Favorites and recent-game persistence
- Server-discovered game catalog
- Party room creation and joining
- Shared native session/network bridge
- Backend health/protocol check
- Read-only CPI canon access and record search
- Local personnel profile
- Shared client settings
- Notification/activity center
- Shared platform service container
- Shared native module manager
- Server-authoritative game boundary

The shell is intentionally independent of individual game rules.

## Runtime services

The native application owns a small shared service container. Current services include:

- `state` — persistent local app state
- `session` — room/session and native HTTP bridge
- `notifications` — shared activity/event center
- `modules` — native module lifecycle
- `shell` — platform navigation/presentation

Future services can be registered without making the shell know game-specific rules.

## Module contract

Every native game module should receive shared platform services instead of recreating them:

- session / room identity
- player identity
- input
- audio
- settings / quality
- save and statistics access
- canon access
- notifications
- navigation back to the platform

A game owns its rules and presentation. The platform owns identity, navigation, shared services, and the connection to the authoritative Party server.

## Server discovery

The native bridge exposes:

- `GET /api/native/health`
- `GET /api/native/games`
- `GET /api/native/canon`
- room/session endpoints

The app checks backend health at startup and then discovers the installed server game catalog. This lets the client distinguish local/native scenes from modules actually available on the authoritative Party server.

## Migration

1. Keep the application shell and shared runtime stable.
2. Add authenticated CPI identity/account sync.
3. Add server-backed profile stats and achievements.
4. Move existing Party games behind the native module contract one at a time.
5. Reuse existing authoritative server game logic wherever possible.
6. Replace placeholder launch flows with real native gameplay modules.
7. Add native realtime transport where polling is insufficient.
8. Add platform-specific input and quality profiles.
9. Export desktop and mobile builds.

## Non-goals

- Do not move authoritative game rules into the client.
- Do not duplicate the CPI Database into a second writable canon source.
- Do not make individual games responsible for platform navigation or account management.
- Do not merge the party branch into the CPI Database production branch.


## Group Night bridge

For near-term group sessions, the native CPI app does not wait for every browser game to be rewritten in Godot.

The Game Library exposes server-backed games as **GROUP PLAY**. The app opens the existing full host experience with a direct game deep-link:

`/host?game=<server-game-id>`

The browser host creates/resumes the authoritative room, preselects the requested game, and keeps using the complete existing host and phone renderers.

The Command Center also exposes **GROUP NIGHT**, which opens the complete Party host/library directly.

Current group-play catalog:

- Cornlashing (`chaos`)
- Corn or Shit (`cornorshit`)
- Entity Auction (`entityauction`)
- My Cob Escaped (`mycob`)
- Escape Thad's Steam Deck (`steamdeck`)
- Angry Thud's Revenge (`thud`)

CPI: Cold Case remains a native playable-alpha module.

This bridge is intentional: it keeps all existing playable content available while individual games are migrated to native modules without putting group sessions behind the migration schedule.
