# Escape Thad's Steam Deck

Game id `steamdeck`, 2–8 agents. One agent is **Thad** and "holds the Steam Deck"; everyone else is a
**runner** trapped inside it, platforming to the EXIT while Thad tilts the whole world. Runners can draw
planks to bridge gaps. Thad rotates every round, starting with the session leader (whoever joined first).
1–3 rounds (lobby setting, default 2).

The Steam Deck is the theme, not the hardware: every role plays fully on a keyboard, with a mouse, or by
touch, on any device. Motion sensors are an optional extra and never required.

| | Keyboard | Mouse / touch (the handheld's own buttons) |
|---|---|---|
| Runner | ← → or A D move · Space ↑ W jump · E suggests a plank ahead (arrows nudge it, Enter places, Esc cancels, Z undoes) · M whole-level map | d-pad ◀ ▶ move · A jump · B plank, then draw a line: A places, B cancels, X undoes, the d-pad nudges · MAP |
| Thad | ← → or A D lean (hold for more) · ↓ S Space level | hold the L / R shoulder buttons · the slider · Level |

Every input sends the same packets (`game:stream` buttons/tilt, `game:input` planks), so the game plays the
same whichever you use.

Code: `server/games/steamdeck/{levels,physics,game}.ts`; screens `public/js/games/steamdeck-*.js`.

## Presentation (client only)

Everything below is drawing: no rule, score, timing or packet changed for it, and the server sends
nothing extra. Rendering never feeds back into the game.

- **The CPI KERNEL handheld** (`public/js/cpi/handheld.js`): every screen plays inside a fictional CPI
  handheld (not any real product's look). Landscape on the TV, the Deck and desktops (grips either side),
  portrait on phones (controls underneath). The status bar shows the round and phase, the timer, the
  signal (agents connected) and the battery, which *is* the round clock: it drains over the 75 s of
  play. Phase changes and escapes arrive as notifications in the status bar, never over the level;
  escalation and the final window also flash the screen's edge, shake the device and stamp a banner
  across the top. On the host the device rocks a little with Thad's tilt and its stick and L / R
  shoulders follow Thad's hands.
- **Launch** (host, round 1, 6.8 s of the 8 s roles phase; any key or tap skips): boot, the game
  launches, every occupant is introduced as their character with Thad "holding the Deck", then the
  title. Later rounds skip the boot. Phones get a short personal card ("THIS IS YOU" / "YOU HOLD THE
  DECK"). A screen that joins mid-phase shows where things are without replaying any entrance.
- **Characters** (`public/js/cpi/character.js`): each agent is a CPI field agent in their colour with a
  hat, visor, suit and accessory picked from their player id, so they look the same on every screen.
  Animated from positions alone (`public/js/cpi/animation.js`): idle, run, jump (stretch), fall, land
  (squash, dust by fall height), slip (pushed against where they face), slide (dragged fast), drawing
  (pencil), placing (hammer), hit, ghost, respawn, escape (beamed out through the door).
- **Levels** (`public/js/games/steamdeck-scenery.js`): each level has its own look (the Home Screen's
  UI tiles, the Library's shelves, Proton's gears and Compatibility Reactor) with lamps, signs, cables,
  a few moving screens and parallax. Platforms are dressed from the collision rects, and every walkable
  top edge is the same CPI yellow. Coming spikes are a dashed box with ⚠ and the slots they'll rise from;
  arriving spikes shoot up with sparks. Planks are pine with their owner's colour, build in, creak and
  blink in their last 2 s, then crumble. The static layers are cached, so a frame costs about 1–2 ms
  (measured: host, 7 runners, 1.2 ms mean, 3 ms p95; a 375 px phone 1.9 ms mean).
- **Runner phones**: when the level would be too small to read, the camera follows you (zoomed so you're
  at least 15 px wide, with an arrow to the EXIT when it's off screen); MAP shows the whole level.
  Drawing always switches to the whole level, where the drawing layer is exactly the level (16:9), so
  a stroke's normalized points are level coordinates as before. The preview is the real plank, drawn
  where it will go; an invalid line turns red, and placing it shakes the device and buzzes.
  A level gauge shows which way and how far the Deck leans.
- **Thad's console**: a dial with the lean in degrees against this phase's limit (14° / 22° / 30°), the
  shove as a share of gravity, which input is active, motion and calibration, what's coming next and
  when, and the last few things that happened to the runners.
- **Results**: a session report on the device's screen (verdict stamp, each agent with their character,
  time, points and a line about their fate, and Thad's outcome); phones show their own result in the
  device and the report under it.
- **Reduced motion** (`prefers-reduced-motion`): no shake, fewer particles, no CSS animation.

## The cast and Thad's shake

Every round each runner is dealt a character at random from the cast (`public/js/games/steamdeck-cast.js`,
shared by the server and the screens), with no repeats until the cast runs out. You escape with what you
got. It isn't meant to be fair: some characters are slower, jump lower, or are harder to throw. Thad isn't a
character: Thad's Steam Deck is the item everyone is inside.

| Character | Build | Movement |
|---|---|---|
| Jacob Madden | taller | normal |
| Mrs. Anacker | normal | normal |
| Brady Parish | taller, ball and chain | slower (0.84), lower jump (0.86) |
| Weller | wider, shorter | slower (0.84), lower jump (0.88), hard to throw (0.6) |
| Blake Thomas | skinnier | faster (1.12), higher jump (1.08) |
| Aiden Kane | cut or bulk, a new one each round | faster (1.1), higher jump (1.06) |
| Eli Stenson | normal | faster (1.1), higher jump (1.06) |
| Jacob Madden as Napoleon | shorter | normal |

Everyone keeps the same collision box, so every level has the same shape for everyone; size is drawing only.
To add a character, add an entry: `stats`, `size` (optionally `builds`) and a `look` for the person style
(`public/js/cpi/person.js`: skin, hair style and colour, glasses, beard, hat, top, extras, a held prop).

**Shake** (Thad: the SHAKE button, ↑ / W, or a gamepad's bottom face button; acked `game:input` `shake`):
a 0.5 s rumble every screen shows and feels, then everyone standing on something is thrown up (520) and
sideways (300, a random way each), scaled by their character's `knock`. 8 s to recharge. The view carries
`world.shake: [ms until ready, ms until it lands or -1]`.

## Flow

| Phase | Time | What happens |
|---|---|---|
| ASSIGNMENT | 8 s | Roles. Thad can already try the tilt. |
| INTRO | 5 s | The level, its name and a joke. |
| ESCAPE | 35 s | Play. The Deck leans up to 14°. |
| ESCALATION | 25 s | Up to 22°, and the "escalation" spikes arrive. |
| FINAL | 15 s | Up to 30°, the last spikes arrive, the exit pulses. |
| RESULTS | 12 s | Who got out, who didn't, points. Ends early once every runner is out. |

Hazards that haven't arrived yet are drawn as dashed red boxes with a ⚠, so nobody is surprised twice.

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

Runners press B (✏️, or E), draw a line over the whole level and see the exact plank they'll get or why
not (red), then place it with A. A stroke becomes a flat, one-way plank (land on it from above, jump up through it) across the
stroke's width at its average height, 80–320 units long, lasting 10 s; one plank each, 4 s cooldown.
Escaped runners can keep drawing planks for the others.

The drawing code is reusable and not specific to this game:

- `public/js/drawing.js` (+ `drawing.d.ts`, so the server imports the same module): the data model
  (`Drawing { playerId, strokes, canvasWidth, canvasHeight }`, `Stroke { points, width, tool, layer,
  timestamp }`, normalized 0..1 coordinates), `serialize` / `deserialize` (compact integers, fully
  validated, throws `DrawingError`), `undo`, `clear`, bounds, and `interpret(drawing, rules, context)`:
  a game registers a rule per tool id instead of touching the engine.
- `public/js/drawing-canvas.js`: capture strokes from touch, pen or mouse (`createDrawingPad`, with a
  `decorate` hook for previews) and `renderDrawing`. Built-in feedback, purely visual: strokes are drawn
  smoothed (the stored points never change), a ring follows the finger, an undone stroke fades out.
- `public/js/games/steamdeck-rules.js`: this game's `plank` rule, shared by the server and the preview.

## Scoring

Escaping: 100 + 2 per second left in the round + 25 for the first one out. Thad: 50 per runner still
inside + 5 per runner death (at most 60 a round). Stats: `escapes`, `deaths`, `planks`, `thadRounds`.
The game record is `steamdeck.v1` (per round: level, Thad, escapes with times, deaths, planks, points).

## Sound

Everything goes through the party's sound manager (`mycob-sound.js`, mapped in
`public/sounds/mycob/sounds.json`). The host plays the server's cues: round start, escalation (`alert`),
final window (`timer_warning`), escapes (`success`), deaths (`life_lost`), and the round result; plus
short effects (`playSfx`): the boot chime, planks going down, spikes arriving and the Deck creaking under
a hard lean. Phones play only your own jump, hard landing and plank, quietly (there's a mute on the
device's status bar), and buzz when you die or escape.

## Known limits

- One level per round from three hand-made levels; no editor.
- No client-side prediction: on a slow connection a jump lands a tick or two late.
- A runner can't move while drawing a plank.
- Other players can't see that someone is drawing (the pencil pose is only on your own screen); they see
  the hammer when the plank lands. Sending it would cost a packet field for looks alone.
- Animation is read from 20 Hz positions, so a landing shows a tick after it happens (the view is a tick
  behind anyway) and a sub-tick hop on the spot can be missed.
- Cosmetics are chosen by id; there's no picker or unlock storage yet (`createCharacter` takes
  `appearance` overrides, and `SLOTS` marks unlock-only options, for when there is).
