// Desktop auto-update controller. Lives in the main process only: the renderer sees a small status
// object and a few named actions through the preload bridge, never the updater itself.
//
// Update source: GitHub Releases for jj2sly/corn.planet (electron-updater's github provider, set in
// package.json "build.publish"). Releases are cut by the desktop release workflow after checks pass.
//
// How far an update can go depends on the build:
//   install — Windows NSIS installer: download in the background, verify (SHA-512), then
//             RESTART & UPDATE. Never while a Party host is live.
//   notify  — macOS (unsigned builds: Squirrel.Mac refuses to install an update without a real
//             code signature) and the Windows portable EXE (no updater support): detect the new
//             version and open its download page. Installing stays a manual step.
//   dev     — unpackaged `electron .`: the updater is off.

export const RELEASES_URL = "https://github.com/jj2sly/corn.planet/releases/latest";
export const HOST_LIVE_MESSAGE = "A Party host is still live. Finish or stop the current session before updating.";
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const STARTUP_DELAY_MS = 15 * 1000;
/** No download progress for this long counts as stalled: report it and let checks run again. */
export const DOWNLOAD_STALL_MS = 10 * 60 * 1000;

const defaultSchedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export function notifyReasonFor({ platform, portable }) {
  if (platform === "darwin") return "unsigned-mac";
  if (platform === "win32" && portable) return "portable";
  return "unsupported";
}

export function updateMode({ platform, isPackaged, portable }) {
  if (!isPackaged) return "dev";
  if (platform === "win32" && !portable) return "install";
  return "notify";
}

/** A short, non-alarming line for the Command Center. The app keeps working whatever happened. */
export function describeUpdateError(error) {
  const code = String(error?.code ?? "");
  const text = String(error?.message ?? error ?? "");
  // GitHub answers /releases/latest with 406 when the repo has no release yet; electron-updater
  // wraps that in a feed-parse error, so match its wording as well as the codes.
  if (code === "ERR_UPDATER_NO_PUBLISHED_VERSIONS" || code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND"
    || /No published versions|Unable to find latest version on GitHub|ensure a production release exists/i.test(text)) {
    return { noRelease: true, message: "No desktop release has been published yet." };
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|net::/i.test(`${code} ${text}`)) {
    return { noRelease: false, message: "Couldn't reach GitHub to check for updates. CPI Party keeps working; it will try again later." };
  }
  if (/sha512|checksum|signature|code sign/i.test(text)) {
    return { noRelease: false, message: "The downloaded update failed verification and was discarded. Your current version is untouched." };
  }
  const firstLine = text.split("\n")[0]?.slice(0, 160) || "Unknown error.";
  return { noRelease: false, message: `Update failed: ${firstLine} Your current version is untouched.` };
}

/**
 * @param {object} deps
 * @param {() => any} deps.getUpdater  lazily returns electron-updater's autoUpdater (never called in dev mode)
 * @param {"install"|"notify"|"dev"} deps.mode
 * @param {"unsigned-mac"|"portable"|"unsupported"|null} [deps.notifyReason]
 * @param {string|null} [deps.arch]  process.arch of this build
 * @param {string} deps.currentVersion
 * @param {() => boolean} deps.hostIsLive  the existing retained-host check
 * @param {(state: object) => void} deps.emit  pushes status to the Command Center
 * @param {(url: string) => void} deps.openExternal
 * @param {() => number} [deps.now]
 */
export function createUpdateController({ getUpdater, mode, notifyReason = null, arch = null, currentVersion, hostIsLive, emit, openExternal, now = Date.now, schedule = defaultSchedule }) {
  let state = {
    mode,
    // This build's CPU architecture, so a manual download can name the right file (x64 = Intel Mac).
    arch,
    // Why a notify-mode build can't install in place: "unsigned-mac" | "portable" | "unsupported".
    notifyReason: mode === "notify" ? notifyReason ?? "unsupported" : null,
    phase: mode === "dev" ? "disabled" : "idle",
    currentVersion,
    availableVersion: null,
    percent: null,
    message: mode === "dev" ? "Updates run in installed builds." : "",
    checkedAt: null,
    blocked: false,
  };
  let updater = null;
  // Set when the current check/download cycle hit an error. Squirrel.Mac, for one, rejects an
  // unsigned app *and* electron-updater still reports "update-downloaded" afterwards; that must not
  // be shown as an update that is ready to install.
  let failedThisCycle = false;

  let cancelStallTimer = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    // Any download that goes quiet for DOWNLOAD_STALL_MS is reported instead of hanging at "Downloading".
    cancelStallTimer?.();
    cancelStallTimer = null;
    if (state.phase === "downloading") {
      cancelStallTimer = schedule(() => {
        if (state.phase !== "downloading") return;
        failedThisCycle = true;
        set({ phase: "error", percent: null, message: "The update download stalled. CPI Party keeps working; it will try again later." });
      }, DOWNLOAD_STALL_MS);
    }
    emit({ ...state });
  };

  const fail = (error) => {
    failedThisCycle = true;
    const { noRelease, message } = describeUpdateError(error);
    // "Nothing published yet" is not a failure from the user's point of view.
    if (noRelease) set({ phase: "up-to-date", message, checkedAt: now(), percent: null });
    else set({ phase: "error", message, percent: null });
  };

  const ensureUpdater = () => {
    if (updater || mode === "dev") return updater;
    updater = getUpdater();
    // Only the NSIS install mode downloads; everywhere else a new version is announced, not fetched.
    updater.autoDownload = mode === "install";
    // Quitting normally (which already warns while a host is live) finishes a downloaded update.
    updater.autoInstallOnAppQuit = mode === "install";
    updater.on("checking-for-update", () => {
      failedThisCycle = false;
      set({ phase: "checking", message: "", blocked: false });
    });
    updater.on("update-not-available", () => set({ phase: "up-to-date", message: "", checkedAt: now(), availableVersion: null, percent: null }));
    updater.on("update-available", (info) =>
      set({
        phase: mode === "install" ? "downloading" : "available",
        availableVersion: String(info?.version ?? ""),
        percent: mode === "install" ? 0 : null,
        checkedAt: now(),
        message: "",
      }),
    );
    updater.on("download-progress", (progress) => set({ phase: "downloading", percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))) }));
    updater.on("update-downloaded", (info) => {
      if (failedThisCycle) return;
      set({ phase: "ready", availableVersion: String(info?.version ?? state.availableVersion ?? ""), percent: 100, message: "" });
    });
    updater.on("error", (error) => fail(error));
    return updater;
  };

  async function check() {
    if (mode === "dev") return { ...state };
    if (state.phase === "checking" || state.phase === "downloading" || state.phase === "ready" || state.phase === "installing") return { ...state };
    try {
      const active = ensureUpdater();
      failedThisCycle = false;
      set({ phase: "checking", message: "", blocked: false });
      const result = await active.checkForUpdates();
      // With autoDownload on, a failed download rejects this promise *and* emits "error" (which is
      // what updates the status). Handle it here so the main process never sees an unhandled rejection.
      result?.downloadPromise?.catch(() => {});
    } catch (error) {
      fail(error);
    }
    return { ...state };
  }

  function install() {
    if (state.phase !== "ready" || mode !== "install") return { ok: false, message: "No update is ready to install." };
    // Mandatory: never restart over a live group game. The download stays ready.
    if (hostIsLive()) {
      set({ blocked: true, message: HOST_LIVE_MESSAGE });
      return { ok: false, blocked: true, message: HOST_LIVE_MESSAGE };
    }
    try {
      set({ phase: "installing", blocked: false, message: "Restarting to finish the update…" });
      // Not silent (the installer shows its progress), and relaunch CPI Party afterwards.
      ensureUpdater().quitAndInstall(false, true);
      return { ok: true };
    } catch (error) {
      fail(error);
      return { ok: false, message: state.message };
    }
  }

  function openDownloadPage() {
    openExternal(RELEASES_URL);
    return true;
  }

  return { status: () => ({ ...state }), check, install, openDownloadPage };
}
