import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

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
