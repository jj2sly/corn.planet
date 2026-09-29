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
    "../desktop/preload.mjs",
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
    new URL("../desktop/preload.mjs", import.meta.url),
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
  const preload = await readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../desktop/renderer.js", import.meta.url), "utf8");

  assert.match(main, /did-fail-load/);
  assert.match(main, /cpi:content-error/);
  assert.match(preload, /onContentError/);
  assert.match(renderer, /CONTENT LOAD FAILED/);
});

test("desktop package uses current Electron generation for WebContentsView shell", async () => {
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  assert.match(desktop.devDependencies.electron, /^\^44\./);
  assert.match(desktop.devDependencies["electron-builder"], /^\^26\.15\./);
});


test("desktop Group Night presentation mode fills the host display", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8");
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
  const preload = await readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../desktop/index.html", import.meta.url), "utf8");
  const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));

  assert.equal(desktop.dependencies.qrcode, "^1.5.4");
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
  const preload = await readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8");
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
  const preload = await readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8");
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
