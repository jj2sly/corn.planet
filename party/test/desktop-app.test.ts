import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("desktop app shell files exist", async () => {
  for (const file of [
    "../desktop/main.mjs",
    "../desktop/preload.cjs",
    "../desktop/index.html",
    "../desktop/renderer.js",
    "../desktop/styles.css",
  ]) {
    await access(new URL(file, import.meta.url));
  }
});

test("desktop package scripts and build targets are configured", async () => {
  const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  assert.equal(root.scripts.desktop, "npm --prefix desktop run start");
  assert.ok(root.scripts["desktop:pack"]);
  assert.ok(root.scripts["desktop:dist"]);
  assert.equal(desktop.main, "main.mjs");
  assert.ok(desktop.devDependencies.electron);
  assert.ok(desktop.devDependencies["electron-builder"]);
  assert.ok(desktop.build.win.target.includes("portable"));
  assert.ok(desktop.build.mac.target.includes("dmg"));
});

test("desktop app keeps Party content inside the application window", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /loadURL/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /Party Host/);
  assert.match(main, /CPI Database/);
  assert.match(main, /cpi:set-party-url/);
});


test("desktop command center exposes all six group games", async () => {
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  for (const id of ["chaos", "cornorshit", "entityauction", "mycob", "steamdeck", "thud"]) {
    assert.ok(html.includes(`data-game="${id}"`), `missing desktop game card ${id}`);
  }
});

test("desktop health check runs in the Electron main process", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  assert.match(main, /cpi:check-server/);
  assert.match(renderer, /cpiDesktop\.checkServer/);
  assert.doesNotMatch(renderer, /fetch\(/);
});


test("desktop app ships the solo Corn or Shit PC game", async () => {
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));

  await access(new URL("../desktop/pc/cornorshit.html", import.meta.url));
  await access(new URL("../desktop/pc/cornorshit.js", import.meta.url));
  await access(new URL("../desktop/pc/pc.css", import.meta.url));

  assert.match(html, /data-pc-game="cornorshit-solo"/);
  assert.match(main, /cpi:launch-pc-game/);
  assert.match(main, /cpi:fetch-canon/);
  assert.ok(desktop.build.files.includes("pc/**/*"));
});

test("desktop uses a persistent CPI shell with embedded content views", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /WebContentsView/);
  assert.match(main, /addChildView/);
  assert.match(main, /SIDEBAR_WIDTH/);
  assert.match(main, /cpi:active-target/);
});


test("desktop JavaScript parses without syntax errors", async () => {
  for (const file of [
    new URL("../desktop/main.mjs", import.meta.url),
    new URL("../desktop/preload.cjs", import.meta.url),
    new URL("../desktop/renderer.js", import.meta.url),
    new URL("../desktop/pc/cornorshit.js", import.meta.url),
    new URL("../desktop/pc/library.js", import.meta.url),
  ]) {
    await execFileAsync(process.execPath, ["--check", fileURLToPath(file)]);
  }
});


test("desktop readiness diagnostics cover server games and canon", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  assert.match(main, /cpi:readiness/);
  assert.match(main, /\/api\/native\/games/);
  assert.match(main, /\/api\/native\/canon/);
  assert.match(html, /GROUP NIGHT READINESS/);
});


test("desktop PC Games library routes through the persistent shell", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const shell = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  const library = await readFile(new URL("../desktop/pc/index.html", import.meta.url), "utf8");

  assert.match(main, /openPcLibrary/);
  assert.match(main, /target === "pc-games"/);
  assert.match(shell, /data-target="pc-games"/);
  assert.match(library, /Corn or Shit — Solo/);
  assert.match(library, /data-pc-game="cornorshit-solo"/);
});

test("desktop command center can copy the phone join link", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  assert.match(main, /cpi:copy-player-link/);
  assert.match(main, /\/play/);
  assert.match(html, /COPY PHONE LINK/);
});


test("desktop shell recovers from embedded content load failures", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");

  assert.match(main, /did-fail-load/);
  assert.match(main, /cpi:content-error/);
  assert.match(preload, /onContentError/);
  assert.match(renderer, /CONTENT LOAD FAILED/);
});

test("desktop package uses current Electron generation for WebContentsView shell", async () => {
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  assert.equal(desktop.devDependencies.electron, "44.4.5");
  assert.equal(desktop.devDependencies["electron-builder"], "26.15.3");
  assert.equal(desktop.dependencies.qrcode, "1.5.4");
});


test("desktop Group Night presentation mode fills the host display", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");

  assert.match(main, /presentationMode/);
  assert.match(main, /startPresentationHost/);
  assert.match(main, /setFullScreen\(true\)/);
  assert.match(main, /SIDEBAR_WIDTH/);
  assert.match(preload, /startPresentationHost/);
  assert.match(renderer, /startPresentationHost/);
});


test("desktop Group Night panel generates a phone QR", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));

  assert.equal(desktop.dependencies.qrcode, "1.5.4");
  assert.match(main, /QRCode\.toDataURL/);
  assert.match(main, /cpi:player-qr/);
  assert.match(preload, /playerQr/);
  assert.match(html, /id="playerQr"/);
});

test("readiness verifies the exact six authoritative Party game ids", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  for (const id of ["chaos", "cornorshit", "entityauction", "mycob", "steamdeck", "thud"]) {
    assert.ok(main.includes(`"${id}"`), `readiness missing ${id}`);
  }
  assert.match(main, /Missing Party games/);
});


test("desktop keeps Party host alive while navigating other app sections", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");

  assert.match(main, /retainedViews/);
  assert.match(main, /retain = target === "party"/);
  assert.match(main, /cpi:host-state/);
  assert.match(main, /cpi:return-host/);
  assert.match(preload, /hostStatus/);
  assert.match(renderer, /paintHostState/);
  assert.match(html, /HOST DISPLAY LIVE/);
});

test("returning to retained Party host does not force a reload", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /forceNavigate = false/);
  assert.match(main, /!reused \|\| forceNavigate \|\| !currentUrl/);
  assert.match(main, /forceNavigate: true/);
});


test("desktop can explicitly stop a retained Party host", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");

  assert.match(main, /stopRetainedHost/);
  assert.match(main, /cpi:stop-host/);
  assert.match(preload, /stopHost/);
  assert.match(renderer, /stopHostDisplay/);
  assert.match(html, /STOP HOST DISPLAY/);
});

test("desktop prevents duplicate app hosts", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /second-instance/);
});

test("presentation mode prevents the host display from sleeping", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /powerSaveBlocker/);
  assert.match(main, /prevent-display-sleep/);
  assert.match(main, /powerSaveBlocker\.stop/);
});


test("transient embedded desktop views are destroyed when detached", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /const retainedEntry = \[\.\.\.retainedViews\.entries\(\)\]\.find\(\(\[, view\]\) => view === detached\)/);
  assert.match(main, /const retained = Boolean\(retainedEntry\)/);
  assert.match(main, /const shouldDestroy = destroy \|\| !retained/);
  assert.match(main, /detached\.webContents\.close\(\)/);
});


test("desktop guides first-run server setup when localhost is unavailable", async () => {
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../desktop/styles.css", import.meta.url), "utf8");
  assert.match(renderer, /SETUP REQUIRED/);
  assert.match(renderer, /scrollIntoView/);
  assert.match(renderer, /connectionCard/);
  assert.match(styles, /settings-card\.attention/);
});

test("desktop warns before closing a live retained Party host", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(main, /Party host is still live/);
  assert.match(main, /Keep Host Running/);
  assert.match(main, /Close CPI Party/);
});

test("changing Party server stops a retained host tied to the old server", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /url !== current\.partyBase && hostIsRetained\(\)/);
  assert.match(main, /stopRetainedHost\(\)/);
});

test("desktop launch availability combines server state with live-host state", async () => {
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  assert.match(renderer, /let serverOnline = false/);
  assert.match(renderer, /let hostRunning = false/);
  assert.match(renderer, /refreshAvailabilityControls/);
  assert.match(renderer, /!serverOnline \|\| hostRunning/);
});


test("desktop resolves local phone join links to a LAN address", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /networkInterfaces/);
  assert.match(main, /bestLanIpv4/);
  assert.match(main, /privateIpv4Score/);
  assert.match(main, /192\\\.168/);
  assert.match(main, /playerJoinUrl/);
});

test("readiness warns if the phone join URL is still local-only", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /Phone join URL is still local-only/);
  assert.match(main, /phoneUrl: playerJoinUrl\(\)/);
});

test("solo Corn or Shit can verify a reveal against the CPI Database", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/pc/cornorshit.html", import.meta.url), "utf8");
  const game = await readFile(new URL("../desktop/pc/cornorshit.js", import.meta.url), "utf8");
  assert.match(main, /cpi:open-canon-url/);
  assert.match(preload, /openCanonUrl/);
  assert.match(html, /VIEW CPI RECORD/);
  assert.match(game, /openCanonUrl/);
});

test("solo Corn or Shit uses same-kind donors and real accuracy", async () => {
  const game = await readFile(new URL("../desktop/pc/cornorshit.js", import.meta.url), "utf8");
  assert.match(game, /donor\.kind !== source\.kind/);
  assert.match(game, /correctAnswers/);
  assert.match(game, /accuracy/);
});


test("Escape exits presentation mode without killing the retained host", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /before-input-event/);
  assert.match(main, /input\.key !== "Escape"/);
  assert.match(main, /setPresentationMode\(false\)/);
  assert.doesNotMatch(main, /Escape[\s\S]{0,300}stopRetainedHost/);
});

test("desktop package includes the Group Night quick-start guide", async () => {
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  await access(new URL("../desktop/START_HERE.txt", import.meta.url));
  assert.ok(desktop.build.files.includes("START_HERE.txt"));
});


test("desktop monitors Party health without stealing focus", async () => {
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  assert.match(renderer, /setInterval\(\(\) => void checkServer\(\{ quiet: true \}\), 30_000\)/);
  assert.match(renderer, /setInterval\(\(\) => void runReadiness\(\), 120_000\)/);
  assert.match(renderer, /if \(!quiet\)/);
  assert.match(renderer, /healthCheckInFlight/);
});

test("desktop phone join resolver prefers private LAN ranges", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /privateIpv4Score/);
  assert.match(main, /192\\\.168/);
  assert.match(main, /10\\\./);
  assert.match(main, /172\\\.\(\\d\+\)/);
  assert.match(main, /bestLanIpv4/);
});


test("desktop shell exposes the live four-letter room code", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");

  assert.match(main, /liveRoomCode/);
  assert.match(main, /page-title-updated/);
  assert.match(main, /cpi:room-code/);
  assert.match(main, /cpi:copy-room-code/);
  assert.match(preload, /roomCode/);
  assert.match(preload, /copyRoomCode/);
  assert.match(renderer, /paintRoomCode/);
  assert.match(html, /LIVE ROOM CODE/);
  assert.match(html, /COPY CODE/);
});


test("desktop phone join links prefill the live room code", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  const host = await readFile(new URL("../public/js/host.js", import.meta.url), "utf8");

  assert.match(main, /url\.searchParams\.set\("code", liveRoomCode\)/);
  assert.match(main, /url\.searchParams\.set\("join", playerJoinUrl\(\)\)/);
  assert.match(renderer, /onRoomCode[\s\S]*refreshPlayerQr/);
  assert.match(host, /url\.searchParams\.set\("code", state\.code\)/);
  assert.match(host, /requestedJoin/);
});


test("Group Night readiness validates Corn or Shit canon and Auction capacity", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");

  assert.match(main, /cornOrShitPlayable/);
  assert.match(main, /entityCanon/);
  assert.match(main, /24 are recommended/);
  assert.match(main, /cannot currently build a Corn or Shit claim pair/);
  assert.match(renderer, /READY WITH WARNING/);
  assert.match(renderer, /readiness-issues warn/);
});


test("Group Night launch rechecks readiness at click time", async () => {
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");
  assert.match(renderer, /startGroupNight\.addEventListener/);
  assert.match(renderer, /const ready = await runReadiness\(\)/);
  assert.match(renderer, /Group Night launch stopped because readiness changed/);
  assert.match(renderer, /readinessCheckInFlight/);
});

test("live room code survives host title changes after lobby", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /—\\s\*\(\[BCDFGHJKLMNPQRSTVWXZ\]\{4\}\)\\s\*\$/);
  assert.match(main, /if \(nextCode && nextCode !== liveRoomCode\)/);
  assert.doesNotMatch(main, /const nextCode = match\?\.\[1\] \?\? ""/);
});


test("desktop injects the live phone QR into the fullscreen Party host", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /updateHostJoinOverlay/);
  assert.match(main, /QRCode\.toDataURL/);
  assert.match(main, /executeJavaScript/);
  assert.match(main, /cpiDesktopJoinQr/);
  assert.match(main, /did-finish-load/);
});

test("sandboxed desktop preload is CommonJS so Electron can actually load it", async () => {
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  // Sandboxed preloads run without an ESM context; an import statement leaves window.cpiDesktop undefined.
  assert.doesNotMatch(preload, /^\s*import\s/m);
  assert.match(preload, /require\("electron"\)/);
  assert.doesNotMatch(main, /preload\.mjs/);
  assert.equal((main.match(/preload: path\.join\(__dirname, "preload\.cjs"\)/g) ?? []).length, 2);
  assert.ok(desktop.build.files.includes("preload.cjs"));
  assert.match(desktop.scripts.check, /node --check preload\.cjs/);
});

test("desktop validates navigation by origin and path, not string prefix", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(main, /startsWith\(current\.(partyBase|databaseBase)\)/);
  assert.doesNotMatch(main, /startsWith\(PC_ROOT_URL\)/);
  assert.match(main, /function isWithinBase\(candidate, base\)/);
  assert.match(main, /url\.origin !== root\.origin/);
  assert.match(main, /if \(isTrustedContentUrl\(nextUrl\)\) return;/);
});

test("desktop IPC only answers the app's own local pages", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /function isLocalAppSender\(event\)/);
  assert.match(main, /senderFrame/);
  // Every channel goes through the guarded handle(); only the guard itself touches ipcMain.handle.
  assert.equal((main.match(/ipcMain\.handle\(/g) ?? []).length, 1);
  assert.ok((main.match(/\bhandle\("cpi:/g) ?? []).length >= 18);
});

test("desktop dist launches the app to prove the preload bridge works", async () => {
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  const smoke = await readFile(new URL("../desktop/smoke.mjs", import.meta.url), "utf8");
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  // predist runs inside the existing "npm run dist" CI step, so every packaged build is launch-tested.
  assert.equal(desktop.scripts.predist, "npm run smoke");
  assert.equal(desktop.scripts.smoke, "node smoke.mjs");
  assert.ok(!desktop.build.files.includes("smoke.mjs"));
  assert.match(smoke, /CPI_DESKTOP_SMOKE: "1"/);
  assert.match(main, /process\.env\.CPI_DESKTOP_SMOKE === "1"/);
  assert.match(main, /typeof window\.cpiDesktop/);
  assert.match(main, /app\.exit\(ok \? 0 : 1\)/);
});

test("Escape leaves presentation mode even when the sidebar shell has focus", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /mainWindow\.webContents\.on\("before-input-event", exitPresentationOnEscape\)/);
  assert.match(main, /view\.webContents\.on\("before-input-event", exitPresentationOnEscape\)/);
  assert.match(main, /contentView\.webContents\.focus\(\)/);
});
