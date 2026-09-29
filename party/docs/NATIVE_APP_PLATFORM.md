# CPI Native App Platform Roadmap

The Godot client is the long-term CPI Party application shell. Existing browser games remain usable while native modules are migrated.

## Platform foundation

- Application shell and navigation
- Shared game registry
- Shared persistent client state
- Shared native session/network bridge
- Party room creation and joining
- Read-only CPI canon access
- Shared profile and settings
- Server-authoritative game boundary

## Module contract

Every game module should receive the same platform services instead of recreating them:

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

## Migration

1. Keep the shell stable.
2. Add one native module at a time.
3. Reuse existing server game logic wherever possible.
4. Replace placeholders with real native gameplay.
5. Add authenticated account sync.
6. Add persistent statistics and achievements.
7. Add native realtime transport where polling is insufficient.
8. Export desktop and mobile builds.

## Non-goals

- Do not move authoritative game rules into the client.
- Do not duplicate the CPI Database into a second writable canon source.
- Do not make individual games responsible for platform navigation or account management.
- Do not merge the party branch into the CPI Database production branch.
