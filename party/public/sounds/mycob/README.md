# My Cob Escaped sounds

Drop sound files into the folders below, then list them in `sounds.json`. That file is the only
thing to change; no game code needs touching. Everything plays through
`public/js/games/mycob-sound.js`.

## Folders and names

```
public/sounds/mycob/
  sounds.json
  alarms/      game_start, alert, timer_warning
  responses/   response_in
  outcomes/    success, major_failure, discovery, chaos_up, life_lost
  voting/      vote_start, vote_result
  endings/     contained, terminated, escaped, everyone_dies, game_end
```

Any file name works (the files here keep their original names); `sounds.json` is what ties a file
to a cue. For new files, lowercase with no spaces is safest. Use `.mp3` or `.m4a` so every phone can
play them (older iPhones can't play `.ogg`). Keep most files under about 2 seconds; endings can run
longer.

## Cues

| Cue | When | Where it plays |
|---|---|---|
| `game_start` | The breach alert opens the game | Host |
| `alert` | A stage brings a new problem or a special event | Host |
| `timer_warning` | 10 s left to respond (host), or to respond or vote (a phone that hasn't yet) | Host; phones |
| `response_in` | An agent files a response (not an edit) | Host; your phone for your own |
| `success` | At least one action worked | Host |
| `major_failure` | A catastrophe, or every action failed | Host |
| `discovery` | Something was discovered | Host |
| `chaos_up` | Chaos rose a level | Host |
| `life_lost` | Someone lost a life | Host; your phone for your own |
| `vote_start` / `vote_result` | The stage vote opens / is decided | Host |
| `contained` / `terminated` / `escaped` / `everyone_dies` | The ending | Host |
| `game_end` | The final results | Host |

Escape Thad's Steam Deck uses the cues above (round start, escalation, escapes, deaths, results) plus
short effects played with `playSfx` (right away, beside the cues, dropped rather than queued when
four are already playing). All have synthesized placeholders; map a file to replace one.

| Effect | When | Where it plays |
|---|---|---|
| `device_boot` | The handheld boots at the start of the game | Host; Thad's phone |
| `jump`, `land` | You jump / land hard | Your phone, for your own runner |
| `plank_place` | A plank appears | Host; your phone for your own |
| `hazard_arm` | Spikes arrive | Host |
| `tilt_creak` | Thad leans the Deck past 75% | Host |
| `ui_click` | Device buttons (mute, map, undo) | Phones |

## `sounds.json`

Each cue takes one file, a list of variants (one is picked at random each time), or an object with
a volume (0–2, default 1) to balance a loud or quiet file. Paths are relative to this folder:

```json
{
  "life_lost": "outcomes/life_lost.mp3",
  "success": ["outcomes/success.mp3", "outcomes/success-2.mp3"],
  "escaped": { "files": ["endings/escaped.mp3"], "volume": 0.6 }
}
```

A cue with no file uses the built-in synthesized placeholder if it has one (`alert` and
`timer_warning` have none, so they stay silent until mapped). A file that won't load logs a warning
in the browser console and falls back the same way. Keys starting with `_` are ignored; an unknown
cue name logs a warning.

## Playback rules

- Players set mute and volume on their own device (host board and the bottom of each phone screen),
  and the setting is remembered.
- Nothing plays until the page has been tapped or clicked (a browser rule). Cues before that are
  skipped, not saved up.
- Cues play one after another, never piled on top of each other: at most 3 at once, the same cue
  twice in a row within 0.35 s plays once, and a cue that would wait more than 3 s is dropped. Game
  start, life lost and the endings are never dropped.
