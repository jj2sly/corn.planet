# CPI Godot Game Modules

Godot is reserved for CPI games that benefit from a dedicated game engine. The main CPI Party launcher is the Electron desktop app in `party/desktop/`, and the six Party games continue to use the authoritative Node/Socket.IO Party server plus browser phone controllers.

Do not migrate the working Party catalog into Godot just for architectural consistency.

## Cold Case

`CPI: Cold Case` is currently a back-burner PC-game prototype.

**The playable version today is the browser game** at `/coldcase` on the Party server
(`party/public/js/coldcase/`, see `party/docs/COLDCASE_PROTOTYPE.md`). It does not depend on this
Godot project; the Godot scene stays a possible native path for later.

The old first-person 3D prototype has been retired. Cold Case is now being rebuilt as a top-down 2D/2.5D cooperative mission inspired by the readability of social-deduction room layouts without copying another game's art, roles or rules.

Current top-down foundation:

- room-based impossible refrigerator map
- keyboard top-down movement
- camera follow
- kitchen / entry / food storage / power / freezer / technician outpost / deep interior
- temperature zones
- warm technician-outpost recovery
- food-threat chase foundation
- repair interactions
- stabilized checkpoint
- refrigerator core repair sequence
- extraction objective and mission-complete state
- CPI mission HUD
- reusable temperature controller
- reusable core-repair logic

Cold Case remains lower priority than CPI Party group-night reliability.

## Intended Cold Case direction

Keep the original mission concept while making production practical:

1. Explore an interconnected impossible refrigerator from a top-down view.
2. Repair short interactive systems instead of building full 3D repair interfaces.
3. Use room hazards, cold zones, food threats and system failures to create pressure.
4. Find the missing CPI Refrigerator Technician as an optional/secondary objective.
5. Stabilize the refrigerator core and extract.
6. Preserve `STABILIZED — MONITORING REQUIRED` as the debrief state.
7. Add multiplayer/network authority only after the local gameplay loop is solid.

Do not invent Chuck notes or new CPI canon text in code. Canon-facing narrative content remains user-controlled.

## Shared runtime

The existing Godot shell/runtime code remains available for future native modules:

- identity/session interfaces
- networking bridge
- navigation
- audio
- quality settings
- module registration

The Party server remains authoritative for shared CPI accounts, rooms, statistics and canon where a native game later needs those systems.

## Platform strategy

- **CPI Party desktop launcher:** Electron
- **Party phone controllers:** browser `/play`
- **Six multiplayer Party games:** existing web/Socket.IO stack
- **Cold Case / future engine-heavy PC games:** Godot modules launched from CPI Party when ready

This keeps the current Party platform shippable while still giving games like Cold Case a real engine when they need one.
