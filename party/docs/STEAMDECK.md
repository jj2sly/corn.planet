# Escape Thad's Steam Deck

Game id `steamdeck`, 2–8 agents. One agent is **Thad** and "holds the Steam Deck"; everyone else is a
**runner** trapped inside it, platforming to the EXIT while Thad tilts the whole world. Runners can draw
planks to bridge gaps. Thad rotates every round, starting with the session leader (whoever joined first).
1–3 rounds (lobby setting, default 2).

The Steam Deck is the theme, not the hardware: every role plays fully on a keyboard, with a mouse, or by
touch, on any device. Motion sensors are an optional extra and never required.

| | Keyboard | Mouse / touch |
|---|---|---|
| Runner | ← → or A D move · Space ↑ W jump · E suggests a plank ahead (arrows nudge it, Enter places, Esc cancels) | ◀ ▶ JUMP buttons · ✏️ then draw a line, Place |
| Thad | ← → or A D lean (hold for more) · ↓ S Space level | the slider · Level |

Every input sends the same packets (`game:stream` buttons/tilt, `game:input` planks), so the game plays the
same whichever you use.

Code: `server/games/steamdeck/{levels,physics,game}.ts`; screens `public/js/games/steamdeck-*.js`.

## Flow

| Phase | Time | What happens |
|---|---|---|
| ASSIGNMENT | 8 s | Roles. Thad can already try the tilt. |
| INTRO | 5 s | The level, its name and a joke. |
| ESCAPE | 35 s | Play. The Deck leans up to 14°. |
| ESCALATION | 25 s | Up to 22°, and the "escalation" spikes arrive. |
| FINAL | 15 s | Up to 30°, the last spikes arrive, the exit pulses. |
| RESULTS | 12 s | Who got out, who didn't, points. Ends early once every runner is out. |

Hazards that haven't arrived yet are drawn as dashed red boxes, so nobody is surprised twice.

## Realtime

The server runs the physics at 20 Hz (4 substeps) and pushes a compact snapshot each tick; screens draw
one tick behind and interpolate, so movement stays smooth. The simulation stops while the room is paused
(`GameContext.paused()`).

Runner buttons (`{ l, r, j }`, `j` a jump-press counter) and Thad's tilt (`{ tilt }`, -1..1) go over
`game:stream`: fire-and-forget, no ack, its own rate limit (30/s per socket), reaching the game only as
the `stream` action. Clients send on change plus a heartbeat (runners 300 ms, Thad 400 ms), so a dropped
packet never leaves a button stuck. Planks go over the normal acked `game:input` (`plank`).

A disconnected runner stops moving and keeps their place; a disconnected Thad's tilt eases back to level.

## Tilt (Thad)

`steamdeck-tilt.js` turns whatever the device has into one number -1..1:

- **Gamepad stick** (the Steam Deck's left stick appears as a gamepad) and **arrow keys** (or A/D) win
  while you're using them.
- Otherwise **motion**, if Thad turned it on ("Use motion": asks for permission on iOS, then waits for
  a reading; the Deck's and desktops' browsers usually have none and say so). Turning it on sets the
  current angle as level; Calibrate does it again; ±30° is full tilt. If the sensor goes quiet, the
  slider takes over and the panel says so.
- Otherwise **the slider**, which always works (Level resets it). Dragging it turns motion off.

The panel always shows the reading, the active input and the motion state (off, on ✓, blocked, no
sensor, no signal). Every source gets the same dead zone, clamp and smoothing (read at 30 Hz, also in a
hidden tab); the server smooths again and clamps. On landscape screens (the Deck) the level and the
panel sit side by side.

Measured with 8 agents: about 0.4 ms of server work per tick and 2.6 KB per view (about 470 KB/s out
for a full room at 20 Hz).

## Planks and the CPI Drawing System

Runners tap ✏️, draw a line over the level and see the exact plank they'll get (green) or why not (red),
then Place. A stroke becomes a flat, one-way plank (land on it from above, jump up through it) across the
stroke's width at its average height, 80–320 units long, lasting 10 s; one plank each, 4 s cooldown.
Escaped runners can keep drawing planks for the others.

The drawing code is reusable and not specific to this game:

- `public/js/drawing.js` (+ `drawing.d.ts`, so the server imports the same module): the data model
  (`Drawing { playerId, strokes, canvasWidth, canvasHeight }`, `Stroke { points, width, tool, layer,
  timestamp }`, normalized 0..1 coordinates), `serialize` / `deserialize` (compact integers, fully
  validated, throws `DrawingError`), `undo`, `clear`, bounds, and `interpret(drawing, rules, context)`:
  a game registers a rule per tool id instead of touching the engine.
- `public/js/drawing-canvas.js`: capture strokes from touch, pen or mouse (`createDrawingPad`, with a
  `decorate` hook for previews) and `renderDrawing`.
- `public/js/games/steamdeck-rules.js`: this game's `plank` rule, shared by the server and the preview.

## Scoring

Escaping: 100 + 2 per second left in the round + 25 for the first one out. Thad: 50 per runner still
inside + 5 per runner death (at most 60 a round). Stats: `escapes`, `deaths`, `planks`, `thadRounds`.
The game record is `steamdeck.v1` (per round: level, Thad, escapes with times, deaths, planks, points).

## Sound

The host plays the game's cues through the My Cob sound manager (`mycob-sound.js`, mapped in
`public/sounds/mycob/sounds.json`): round start, escalation (`alert`), final window (`timer_warning`),
escapes (`success`), deaths (`life_lost`), and the round result. Phones buzz when you die.

## Known limits

- One level per round from three hand-made levels; no editor.
- No client-side prediction: on a slow connection a jump lands a tick or two late.
- A runner can't move while drawing a plank.
