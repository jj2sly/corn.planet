# CPI Party Desktop App

The desktop application is the near-term CPI Party shell for group use.

It packages the existing complete Party web experience into one PC application instead of waiting for every game to be rewritten in Godot.

## What it contains

The command center links to and keeps these experiences inside the Electron window:

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

Players still use their phones for multiplayer controllers.

Cold Case is not on the current critical path.

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

No password or Firebase credential is stored in the desktop settings file.

## Package the desktop app

Install desktop dependencies once:

```bash
npm --prefix desktop install
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

## Architecture

The Electron application is the container.

The authoritative Corn Planet Party server remains the existing Node/Socket.IO server on Railway. Existing host/player renderers stay the source of truth for the six multiplayer games.

This avoids duplicating game rules and lets the desktop app ship the whole playable catalog immediately.

Godot remains available for future true PC-native CPI games, but it is no longer a requirement for getting the current Party catalog into an application.
