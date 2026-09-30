# CPI Party Desktop App

The desktop application is the near-term CPI Party shell for group use.

It packages the existing complete Party web experience into one PC application instead of waiting for every game to be rewritten in Godot.

## What it contains

The command center keeps these experiences inside the Electron application:

- Full Corn Planet Party host
- Cornlashing
- Corn or Shit
- Entity Auction
- My Cob Escaped
- Escape Thad's Steam Deck
- Angry Thud's Revenge
- CPI Database
- CPI account and stats
- Prompts and moderation
- Hall of Fame
- PC Games library
- Corn or Shit — Solo
- CPI: Cold Case (prototype)

Players still use their phones for multiplayer controllers.

Cold Case is not on the Group Night critical path.

## Group Night flow

1. Open CPI Party.
2. Configure the Railway Party URL if the app shows **SETUP REQUIRED**.
3. Use the **GROUP NIGHT READINESS** panel.
4. Confirm server online, 6 / 6 games installed, CPI canon loaded and a native protocol number.
5. Give players the QR / phone join link.
6. Press **START GROUP NIGHT**.

Group Night presentation mode:

- opens the Party host in fullscreen;
- hides the CPI sidebar from the presentation;
- prevents the display from sleeping;
- keeps the host WebContents alive if you temporarily return to another CPI section;
- lets Escape leave fullscreen presentation mode without disconnecting the host;
- warns before the desktop app closes while a live host display exists.

The Command Center shows **HOST DISPLAY LIVE** when the Party host remains connected in the background.

## Phone join handling

For Railway, the QR uses the configured public Party URL.

For a local server, the desktop app converts localhost / 127.0.0.1 / 0.0.0.0 into a detected LAN IPv4 address for the player URL. Normal private LAN ranges are preferred over VPN-style interfaces.

If a phone-reachable address cannot be found, Group Night readiness reports it instead of claiming everything is ready.

## Run locally

From `party/`:

```bash
npm install
npm --prefix desktop install
npm run dev
```

In another terminal:

```bash
npm run desktop
```

The desktop client defaults to `http://127.0.0.1:3000`.

## Point the app at Railway

Open the Command Center and enter the Railway Party URL in **Party Server**. The application saves that URL in the desktop user's Electron data directory.

Changing the server URL while a Party host display is retained intentionally stops the old host before switching.

No password or Firebase credential is stored in the desktop settings file.

## PC Games

The desktop shell has a dedicated PC Games library.

### Corn or Shit — Solo

- keyboard / mouse
- no room or phones required
- live CPI canon fetched read-only through the Party server
- real/fabricated claims use matching fields from records of the same canon kind
- redacted/classified placeholder values are skipped
- streak scoring plus true accuracy tracking
- reveal screen can open the actual documented CPI record inside the app

### CPI: Cold Case (prototype)

- the Party server's own `/coldcase` page, opened inside the app (no separate build)
- solo, keyboard (WASD / arrows, E, Space) or gamepad
- needs the configured Party server to be reachable
- see `party/docs/COLDCASE_PROTOTYPE.md`

## Package the desktop app

Install desktop dependencies once:

```bash
npm --prefix desktop install
```

Check desktop JavaScript:

```bash
npm --prefix desktop run check
```

Development package:

```bash
npm run desktop:pack
```

Installer/distributable:

```bash
npm run desktop:dist
```

Configured targets:

- Windows: NSIS installer + portable executable
- macOS: DMG + ZIP
- Linux: AppImage

Artifacts are written to `party/dist-desktop/`.

The GitHub desktop build workflow produces Windows and macOS artifacts and places `START_HERE.txt` beside the generated installer files.

## Architecture

The Electron application is the container. A persistent CPI sidebar stays visible while Party, Database and account pages run in a `WebContentsView`.

The Party host is the only retained remote view. This is deliberate: navigating to Database, Account or other pages does not disconnect an active host display, while transient pages are destroyed when detached so the desktop app does not accumulate hidden browser views.

The authoritative Corn Planet Party server remains the existing Node/Socket.IO server. Existing host/player renderers remain the source of truth for the six multiplayer games.

This avoids duplicating game rules and lets the desktop app ship the whole playable catalog immediately.

Godot remains available for future fully native CPI games, but it is no longer required for the current Party catalog.
