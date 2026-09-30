// Desktop auto-update: the controller's state machine (run against a fake electron-updater), and the
// wiring that keeps it main-process-only, host-safe and pointed at GitHub Releases.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  DOWNLOAD_STALL_MS,
  HOST_LIVE_MESSAGE,
  RELEASES_URL,
  createUpdateController,
  describeUpdateError,
  notifyReasonFor,
  updateMode,
  type UpdateMode,
  type UpdateState,
} from "../desktop/updater.mjs";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checks = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  onCheck: (updater: FakeUpdater) => void | Promise<void> = (u) => void u.emit("update-not-available", { version: "0.2.1" });
  downloadPromise: Promise<unknown> | null = null;
  async checkForUpdates() {
    this.checks += 1;
    this.emit("checking-for-update");
    await this.onCheck(this);
    return this.downloadPromise ? { downloadPromise: this.downloadPromise } : null;
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installs.push([isSilent, isForceRunAfter]);
  }
}

function setup(mode: UpdateMode, { hostLive = false } = {}) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const opened: string[] = [];
  let created = 0;
  let live = hostLive;
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const controller = createUpdateController({
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
    getUpdater: () => ((created += 1), updater),
    mode,
    notifyReason: mode === "notify" ? "unsigned-mac" : null,
    currentVersion: "0.2.1",
    hostIsLive: () => live,
    emit: (state) => states.push(state),
    openExternal: (url) => opened.push(url),
    now: () => 1_000,
  });
  const fireStallTimer = () => timers.filter((t) => !t.cancelled && t.ms === DOWNLOAD_STALL_MS).at(-1)?.fn();
  return { updater, controller, states, opened, created: () => created, setHostLive: (value: boolean) => (live = value), fireStallTimer };
}

describe("desktop updater: which builds can update themselves", () => {
  it("installs in place only for the packaged Windows NSIS build", () => {
    assert.equal(updateMode({ platform: "win32", isPackaged: true, portable: false }), "install");
    assert.equal(updateMode({ platform: "win32", isPackaged: true, portable: true }), "notify");
    assert.equal(updateMode({ platform: "darwin", isPackaged: true, portable: false }), "notify");
    assert.equal(updateMode({ platform: "linux", isPackaged: true, portable: false }), "notify");
    assert.equal(updateMode({ platform: "win32", isPackaged: false, portable: false }), "dev");
    assert.equal(notifyReasonFor({ platform: "darwin", portable: false }), "unsigned-mac");
    assert.equal(notifyReasonFor({ platform: "win32", portable: true }), "portable");
  });

  it("only downloads (and installs on quit) in install mode", async () => {
    const install = setup("install");
    await install.controller.check();
    assert.equal(install.updater.autoDownload, true);
    assert.equal(install.updater.autoInstallOnAppQuit, true);

    const notify = setup("notify");
    await notify.controller.check();
    assert.equal(notify.updater.autoDownload, false);
    assert.equal(notify.updater.autoInstallOnAppQuit, false);
  });

  it("never touches the updater in an unpackaged dev run", async () => {
    const dev = setup("dev");
    const state = await dev.controller.check();
    assert.equal(state.phase, "disabled");
    assert.equal(dev.created(), 0);
  });
});

describe("desktop updater: status the Command Center shows", () => {
  it("checks, then reports up to date with the installed version", async () => {
    const { controller, states } = setup("install");
    assert.equal(controller.status().currentVersion, "0.2.1");
    assert.equal(controller.status().phase, "idle");
    const state = await controller.check();
    assert.deepEqual(states.map((s) => s.phase).filter((p, i, a) => a[i - 1] !== p), ["checking", "up-to-date"]);
    assert.equal(state.phase, "up-to-date");
    assert.equal(state.checkedAt, 1_000);
  });

  it("walks available → downloading % → ready for an NSIS build", async () => {
    const { controller, updater, states } = setup("install");
    updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("download-progress", { percent: 63.4 });
      u.emit("update-downloaded", { version: "0.2.2" });
    };
    const state = await controller.check();
    assert.ok(states.some((s) => s.phase === "downloading" && s.percent === 63));
    assert.equal(state.phase, "ready");
    assert.equal(state.availableVersion, "0.2.2");
    // A ready update isn't re-checked or re-downloaded.
    await controller.check();
    assert.equal(updater.checks, 1);
  });

  it("announces a new version without downloading on notify-only builds", async () => {
    const { controller, updater, opened } = setup("notify");
    updater.onCheck = (u) => void u.emit("update-available", { version: "0.2.2" });
    const state = await controller.check();
    assert.equal(state.phase, "available");
    assert.equal(state.notifyReason, "unsigned-mac");
    assert.equal(state.availableVersion, "0.2.2");
    assert.deepEqual(controller.install(), { ok: false, message: "No update is ready to install." });
    assert.equal(updater.installs.length, 0);
    controller.openDownloadPage();
    assert.deepEqual(opened, [RELEASES_URL]);
    assert.equal(RELEASES_URL, "https://github.com/jj2sly/corn.planet/releases/latest");
  });
});

describe("desktop updater: failing safely", () => {
  it("turns an unreachable update server into a calm status instead of a crash", async () => {
    const { controller, updater } = setup("install");
    updater.onCheck = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" });
    };
    const state = await controller.check();
    assert.equal(state.phase, "error");
    assert.match(state.message, /Couldn't reach GitHub/);
    assert.match(state.message, /keeps working/);
    // It can simply try again later.
    updater.onCheck = (u) => void u.emit("update-not-available", {});
    assert.equal((await controller.check()).phase, "up-to-date");
  });

  it("absorbs a failed background download without an unhandled rejection", async () => {
    const { controller, updater } = setup("install");
    const failure = Object.assign(new Error("ENOENT: no such file or directory, open 'app-update.yml'"), { code: "ENOENT" });
    updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("error", failure);
    };
    updater.downloadPromise = Promise.reject(failure);
    const state = await controller.check();
    assert.equal(state.phase, "error");
    // Let the microtask queue drain; node:test fails the run on an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("never shows an update as ready after the same download cycle failed (seen with Squirrel.Mac)", async () => {
    const { controller, updater } = setup("install");
    updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("download-progress", { percent: 100 });
      u.emit("error", new Error("Could not get code signature for running application"));
      u.emit("update-downloaded", { version: "0.2.2" });
    };
    const state = await controller.check();
    assert.equal(state.phase, "error");
    assert.deepEqual(controller.install(), { ok: false, message: "No update is ready to install." });
    assert.equal(updater.installs.length, 0);
    // A later, clean cycle can still become ready.
    updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("update-downloaded", { version: "0.2.2" });
    };
    assert.equal((await controller.check()).phase, "ready");
  });

  it("reports a download that goes quiet instead of hanging at 'Downloading'", async () => {
    const { controller, updater, fireStallTimer } = setup("install");
    updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("download-progress", { percent: 12 });
    };
    assert.equal((await controller.check()).phase, "downloading");
    fireStallTimer();
    const state = controller.status();
    assert.equal(state.phase, "error");
    assert.match(state.message, /stalled/);
    // Checks are allowed again, and a stalled cycle can't later claim to be ready.
    updater.emit("update-downloaded", { version: "0.2.2" });
    assert.equal(controller.status().phase, "error");
    updater.onCheck = (u) => void u.emit("update-not-available", {});
    assert.equal((await controller.check()).phase, "up-to-date");
  });

  it("treats 'nothing published yet' as up to date", async () => {
    const { controller, updater } = setup("install");
    updater.onCheck = async () => {
      throw Object.assign(new Error("No published versions on GitHub"), { code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS" });
    };
    const state = await controller.check();
    assert.equal(state.phase, "up-to-date");
    assert.match(state.message, /No desktop release has been published yet/);
  });

  it("recognises GitHub's answer for a repo with no release yet (seen from a real packaged build)", () => {
    const real = Object.assign(
      new Error("Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/jj2sly/corn.planet/releases/latest), please ensure a production release exists: HttpError: 406"),
      { code: "ERR_UPDATER_INVALID_RELEASE_FEED" },
    );
    assert.deepEqual(describeUpdateError(real), { noRelease: true, message: "No desktop release has been published yet." });
  });

  it("reports a download that fails verification and keeps the current version", async () => {
    const { controller, updater } = setup("install");
    updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("error", new Error("sha512 checksum mismatch, expected abc, got def"));
    };
    const state = await controller.check();
    assert.equal(state.phase, "error");
    assert.match(state.message, /failed verification/);
    assert.match(describeUpdateError(new Error("Something odd\nstack")).message, /current version is untouched/);
  });
});

describe("desktop updater: a live Party host always wins", () => {
  async function readyController(hostLive: boolean) {
    const ctx = setup("install", { hostLive });
    ctx.updater.onCheck = (u) => {
      u.emit("update-available", { version: "0.2.2" });
      u.emit("update-downloaded", { version: "0.2.2" });
    };
    await ctx.controller.check();
    return ctx;
  }

  it("refuses to restart while a host is live and keeps the update ready", async () => {
    const { controller, updater, setHostLive } = await readyController(true);
    const result = controller.install();
    assert.deepEqual(result, { ok: false, blocked: true, message: HOST_LIVE_MESSAGE });
    assert.equal(updater.installs.length, 0, "must not quit over an active group game");
    assert.equal(controller.status().phase, "ready");
    assert.equal(controller.status().blocked, true);
    assert.equal(HOST_LIVE_MESSAGE, "A Party host is still live. Finish or stop the current session before updating.");

    // Once the host is stopped, the same button installs.
    setHostLive(false);
    assert.deepEqual(controller.install(), { ok: true });
    assert.deepEqual(updater.installs, [[false, true]]);
    assert.equal(controller.status().phase, "installing");
  });

  it("installs and relaunches straight away when no host is live", async () => {
    const { controller, updater } = await readyController(false);
    assert.deepEqual(controller.install(), { ok: true });
    assert.deepEqual(updater.installs, [[false, true]]);
  });
});

describe("desktop updater wiring", () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

  it("exposes only narrow update calls, and only to the app's own local pages", async () => {
    const preload = await read("../desktop/preload.cjs");
    const guard = preload.indexOf('if (globalThis.location?.protocol === "file:")');
    assert.ok(guard > 0);
    for (const name of ["updateStatus", "checkForUpdates", "installUpdate", "openUpdateDownload", "onUpdateStatus"]) {
      const at = preload.indexOf(`${name}:`);
      assert.ok(at > guard, `${name} must sit inside the file: protocol guard`);
    }
    assert.doesNotMatch(preload, /electron-updater|autoUpdater|require\("(fs|child_process|shell)"\)/);
    assert.doesNotMatch(preload, /openExternal/);
  });

  it("keeps the updater in the main process behind the local-page IPC guard", async () => {
    const main = await read("../desktop/main.mjs");
    for (const channel of ["cpi:update-status", "cpi:check-updates", "cpi:install-update", "cpi:open-update-download"]) {
      assert.match(main, new RegExp(`\\bhandle\\("${channel}"`), `${channel} must use the guarded handle()`);
    }
    assert.equal((main.match(/ipcMain\.handle\(/g) ?? []).length, 1);
    // The download page is a fixed URL; the renderer can't pass one in.
    assert.match(main, /handle\("cpi:open-update-download", \(\) => updates\.openDownloadPage\(\)\)/);
    // Host protection reuses the existing retained-host state.
    assert.match(main, /hostIsLive: \(\) => hostIsRetained\(\)/);
    // Checks never run in the CI launch check or block startup.
    assert.match(main, /if \(!SMOKE_TEST && UPDATE_MODE !== "dev"\)/);
    assert.match(main, /setTimeout\(\(\) => void updates\.check\(\), STARTUP_DELAY_MS\)/);
    assert.match(main, /setInterval\(\(\) => void updates\.check\(\), CHECK_INTERVAL_MS\)/);
    // A local test feed is honoured only in unpackaged runs.
    assert.match(main, /const DEV_UPDATE_FEED = app\.isPackaged \? "" :/);
    // Security settings are unchanged.
    assert.equal((main.match(/contextIsolation: true/g) ?? []).length, 2);
    assert.equal((main.match(/nodeIntegration: false/g) ?? []).length, 2);
    assert.equal((main.match(/sandbox: true/g) ?? []).length, 2);
  });

  it("offers a manual check and the update states in the Command Center", async () => {
    const html = await read("../desktop/index.html");
    const renderer = await read("../desktop/renderer.js");
    assert.match(html, /id="updateCard"/);
    assert.match(html, /CHECK FOR UPDATES/);
    assert.match(html, /RESTART &amp; UPDATE/);
    assert.match(html, /id="updateLater"/);
    assert.match(renderer, /window\.cpiDesktop\.checkForUpdates\(\)/);
    assert.match(renderer, /window\.cpiDesktop\.onUpdateStatus/);
    for (const text of ["Checking for updates…", "Up to date", "UPDATE AVAILABLE", "Downloading ", "UPDATE READY", "is ready."]) {
      assert.ok(renderer.includes(text), `missing state text: ${text}`);
    }
    // The installed version is surfaced, with the build's commit when there is one.
    assert.match(renderer, /Version \$\{state\?\.currentVersion/);
    assert.match(renderer, /config\.build\?\.commit/);
  });

  it("packages the updater, its GitHub Releases source and stable asset names", async () => {
    const desktop = JSON.parse(await read("../desktop/package.json"));
    assert.match(desktop.version, /^\d+\.\d+\.\d+$/);
    assert.equal(desktop.dependencies["electron-updater"], "6.8.10");
    assert.equal(desktop.devDependencies.electron, "44.4.5");
    assert.equal(desktop.devDependencies["electron-builder"], "26.15.3");
    assert.deepEqual(desktop.build.publish, [{ provider: "github", owner: "jj2sly", repo: "corn.planet", releaseType: "release" }]);
    assert.ok(desktop.build.files.includes("updater.mjs"));
    // Builds never upload on their own; the release workflow publishes after checks pass.
    assert.equal(desktop.scripts.dist, "electron-builder --publish never");
    assert.match(desktop.scripts.predist, /npm run smoke/);
    // Asset names without spaces, so latest.yml URLs match the uploaded release assets exactly.
    for (const name of [desktop.build.nsis.artifactName, desktop.build.portable.artifactName, desktop.build.dmg.artifactName, desktop.build.mac.artifactName]) {
      assert.doesNotMatch(name, /\s/);
      assert.match(name, /\$\{version\}/);
    }
    assert.equal(desktop.build.nsis.deleteAppDataOnUninstall, false, "updates must keep desktop settings");
  });

  it("launch smoke test proves the update bridge loads in the real app", async () => {
    const main = await read("../desktop/main.mjs");
    assert.match(main, /updateBridge: typeof window\.cpiDesktop\?\.checkForUpdates/);
    assert.match(main, /result\.updateBridge === "function" && result\.updateVersion === app\.getVersion\(\)/);
  });
});
