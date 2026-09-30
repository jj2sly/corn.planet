const status = document.querySelector("#serverStatus");
const hostLiveBanner = document.querySelector("#hostLiveBanner");
const returnToHost = document.querySelector("#returnToHost");
const stopHostDisplay = document.querySelector("#stopHostDisplay");
const liveRoomCode = document.querySelector("#liveRoomCode");
const readinessRoomCode = document.querySelector("#readinessRoomCode");
const copyRoomCode = document.querySelector("#copyRoomCode");
const partyUrl = document.querySelector("#partyUrl");
const version = document.querySelector("#version");
const input = document.querySelector("#partyServerInput");
const save = document.querySelector("#savePartyServer");
const usePublicServer = document.querySelector("#usePublicServer");
const message = document.querySelector("#serverMessage");
const connectionCard = document.querySelector(".settings-card");
const copyPlayerLink = document.querySelector("#copyPlayerLink");
const playerQr = document.querySelector("#playerQr");
const playerJoinUrl = document.querySelector("#playerJoinUrl");
const readyServer = document.querySelector("#readyServer");
const readyGames = document.querySelector("#readyGames");
const readyCanon = document.querySelector("#readyCanon");
const readyProtocol = document.querySelector("#readyProtocol");
const readinessIssues = document.querySelector("#readinessIssues");
const rerunReadiness = document.querySelector("#rerunReadiness");
const startGroupNight = document.querySelector("#startGroupNight");
const updateCard = document.querySelector("#updateCard");
const updateHeadline = document.querySelector("#updateHeadline");
const updateDetail = document.querySelector("#updateDetail");
const updateProgress = document.querySelector("#updateProgress");
const updateProgressBar = document.querySelector("#updateProgressBar");
const checkForUpdates = document.querySelector("#checkForUpdates");
const installUpdate = document.querySelector("#installUpdate");
const openUpdateDownload = document.querySelector("#openUpdateDownload");
const updateLater = document.querySelector("#updateLater");
const updatePill = document.querySelector("#updatePill");
const SERVER_TARGETS = new Set(["party", "account", "prompts", "hall"]);
let config = null;
let serverOnline = false;
let hostRunning = false;
let healthCheckInFlight = false;
let readinessCheckInFlight = false;
let updateState = null;
let updateLaterFor = null;
let updateNotice = null;

function refreshAvailabilityControls() {
  for (const button of document.querySelectorAll("[data-game]")) {
    button.disabled = !serverOnline || hostRunning;
    button.title = !serverOnline
      ? "Party server is offline"
      : hostRunning
        ? "A Party host is already live. Return to the host to choose another game."
        : "";
  }

  for (const button of document.querySelectorAll("[data-pc-game]")) {
    button.disabled = !serverOnline;
    button.title = serverOnline ? "" : "Party server is offline";
  }

  for (const button of document.querySelectorAll("[data-target]")) {
    if (!SERVER_TARGETS.has(button.dataset.target)) continue;
    button.disabled = !serverOnline;
    button.title = serverOnline ? "" : "Party server is offline";
  }
}

function setServerDependentControls(online) {
  serverOnline = Boolean(online);
  refreshAvailabilityControls();
}

const navButtons = [...document.querySelectorAll(".rail button")];

function paintActiveTarget(target) {
  for (const button of navButtons) {
    const section = button.dataset.target || button.dataset.section;
    button.classList.toggle("active", section === target);
  }
}

function paintRoomCode(detail) {
  const code = String(detail?.code || "").toUpperCase();
  liveRoomCode.textContent = code || "—";
  readinessRoomCode.textContent = code || "WAITING FOR HOST";
  copyRoomCode.disabled = !code;
}

function paintHostState(detail) {
  hostRunning = Boolean(detail?.running);
  const active = Boolean(detail?.active);
  hostLiveBanner.classList.toggle("hidden", !hostRunning || active);
  refreshAvailabilityControls();
  if (updateState) paintUpdate(updateState);
}

const NOTIFY_REASONS = {
  "unsigned-mac": "This Mac build isn't code-signed, so macOS won't let it replace itself. Download the new version from GitHub and drag it into Applications.",
  portable: "The portable EXE doesn't update itself. Download the new version from GitHub (the installer version updates automatically).",
  unsupported: "Download the new version from GitHub.",
};

function formatClock(ms) {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

/** The Command Center's DESKTOP UPDATE card. Every state is informational; none blocks the app. */
function paintUpdate(state) {
  updateState = state;
  const phase = state?.phase ?? "idle";
  const next = state?.availableVersion ? `v${state.availableVersion}` : "a new version";
  const later = updateLaterFor && updateLaterFor === state?.availableVersion;
  let headline = `Version ${state?.currentVersion ?? "—"}`;
  let detail = state?.message || "Updates are checked automatically.";
  let tone = "";

  if (phase === "disabled") detail = state.message || "Updates run in installed builds.";
  else if (phase === "checking") detail = "Checking for updates…";
  else if (phase === "up-to-date") {
    headline = `Up to date · v${state.currentVersion}`;
    detail = state.message || (state.checkedAt ? `Checked at ${formatClock(state.checkedAt)}.` : "");
  } else if (phase === "available") {
    headline = `UPDATE AVAILABLE · ${next}`;
    detail = NOTIFY_REASONS[state.notifyReason] ?? NOTIFY_REASONS.unsupported;
    tone = "warn";
  } else if (phase === "downloading") {
    headline = `UPDATE AVAILABLE · ${next}`;
    detail = `Downloading ${state.percent ?? 0}%`;
  } else if (phase === "ready") {
    headline = "UPDATE READY";
    detail = later ? `CPI Party ${state.availableVersion} installs the next time you quit.` : `CPI Party ${state.availableVersion} is ready.`;
    if (state.blocked && hostRunning) {
      detail = state.message;
      tone = "warn";
    }
  } else if (phase === "installing") {
    headline = "UPDATING";
    detail = state.message || "Restarting to finish the update…";
  } else if (phase === "error") {
    detail = state.message;
    tone = "bad";
  }
  if (updateNotice) {
    detail = updateNotice;
    tone = "warn";
  }

  updateHeadline.textContent = headline;
  updateDetail.textContent = detail;
  updateDetail.className = `update-detail${tone ? ` ${tone}` : ""}`;
  updateProgress.hidden = phase !== "downloading";
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, state?.percent ?? 0))}%`;
  checkForUpdates.disabled = ["disabled", "checking", "downloading", "ready", "installing"].includes(phase);
  installUpdate.hidden = phase !== "ready" || later;
  updateLater.hidden = phase !== "ready" || later;
  openUpdateDownload.hidden = phase !== "available";
  updateCard.classList.toggle("ready", (phase === "ready" && !later) || phase === "available");
  updatePill.hidden = !((phase === "ready" && !later) || phase === "available");
  updatePill.textContent = phase === "ready" ? "UPDATE READY" : "UPDATE AVAILABLE";
}

for (const button of document.querySelectorAll("[data-target]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    if (!target) return;
    window.cpiDesktop.navigate(target);
  });
}

window.cpiDesktop.onActiveTarget((target) => paintActiveTarget(target));
window.cpiDesktop.onHostState((detail) => paintHostState(detail));
window.cpiDesktop.onRoomCode((detail) => {
  paintRoomCode(detail);
  void refreshPlayerQr();
  // A new room usually means the host just reconnected after an outage; don't wait for the poll.
  if (detail?.code) void checkServer({ quiet: true });
});
window.cpiDesktop.onPresentationMode((enabled) => {
  document.body.classList.toggle("presentation-mode", enabled);
});

window.cpiDesktop.onUpdateStatus((state) => {
  updateNotice = null;
  paintUpdate(state);
});

window.cpiDesktop.onContentError((detail) => {
  status.className = "status bad";
  status.textContent = "CONTENT LOAD FAILED";
  message.textContent = `${String(detail?.target || "page").toUpperCase()}: ${detail?.message || "Could not load content."}`;
  message.className = "server-message bad";
});

for (const button of document.querySelectorAll("[data-pc-game]")) {
  button.addEventListener("click", async () => {
    const gameId = button.dataset.pcGame;
    if (!gameId) return;
    button.disabled = true;
    try {
      await window.cpiDesktop.launchPcGame(gameId);
    } finally {
      button.disabled = false;
    }
  });
}

for (const button of document.querySelectorAll("[data-game]")) {
  button.addEventListener("click", async () => {
    const gameId = button.dataset.game;
    if (!gameId) return;
    button.disabled = true;
    try {
      await window.cpiDesktop.launchGame(gameId);
    } finally {
      button.disabled = false;
    }
  });
}

async function refreshPlayerQr() {
  try {
    const qr = await window.cpiDesktop.playerQr();
    playerQr.src = qr.dataUrl;
    playerQr.hidden = false;
    playerJoinUrl.textContent = qr.url;
  } catch {
    playerQr.hidden = true;
    playerJoinUrl.textContent = "QR unavailable";
  }
}

// Callers that arrive while a check is running (e.g. START GROUP NIGHT during the periodic check)
// share its result instead of being told readiness failed.
let readinessPromise = null;
function runReadiness() {
  if (readinessCheckInFlight && readinessPromise) return readinessPromise;
  readinessCheckInFlight = true;
  readinessPromise = performReadiness().finally(() => {
    rerunReadiness.disabled = false;
    readinessCheckInFlight = false;
  });
  return readinessPromise;
}

async function performReadiness() {
  rerunReadiness.disabled = true;
  readinessIssues.textContent = "Checking Party server, game catalog and CPI canon…";
  let result;
  try {
    result = await window.cpiDesktop.readiness();
  } catch (error) {
    result = { server: false, games: 0, canon: 0, protocol: 0, issues: [error?.message || "Readiness check failed."], warnings: [] };
  }

  readyServer.textContent = result.server ? "ONLINE" : "OFFLINE";
  readyServer.className = result.server ? "ready-ok" : "ready-bad";

  readyGames.textContent = `${result.games} / 6`;
  readyGames.className = result.games >= 6 ? "ready-ok" : "ready-bad";

  readyCanon.textContent = result.entityCanon
    ? `${result.canon} TOTAL / ${result.entityCanon} ENT`
    : String(result.canon);
  readyCanon.className = result.canon >= 2 && result.cornOrShitPlayable ? "ready-ok" : "ready-bad";

  readyProtocol.textContent = result.protocol ? String(result.protocol) : "—";
  readyProtocol.className = result.protocol ? "ready-ok" : "ready-bad";

  const ready = result.server && result.games >= 6 && result.canon >= 2 && !(result.issues?.length);
  startGroupNight.disabled = !ready;

  if (!ready) {
    readinessIssues.textContent = result.issues?.length ? result.issues.join(" • ") : "Group Night requirements are not met yet.";
    readinessIssues.className = "readiness-issues bad";
  } else if (result.warnings?.length) {
    readinessIssues.textContent = `READY WITH WARNING • ${result.warnings.join(" • ")}`;
    readinessIssues.className = "readiness-issues warn";
  } else {
    readinessIssues.textContent = "READY FOR GROUP NIGHT";
    readinessIssues.className = "readiness-issues ok";
  }
  return ready;
}

async function checkServer({ quiet = false } = {}) {
  if (healthCheckInFlight) return serverOnline;
  healthCheckInFlight = true;
  if (!quiet) {
    status.className = "status";
    status.textContent = "CHECKING SERVER…";
  }
  let result;
  try {
    result = await window.cpiDesktop.checkServer();
  } catch (error) {
    result = { ok: false, error: error?.message };
  }
  if (result.ok) {
    const health = result.data || {};
    status.textContent = `SERVER ONLINE // ${health.rooms ?? 0} ROOMS`;
    status.classList.add("ok");
    message.textContent = "Party server reachable.";
    message.className = "server-message ok";
    connectionCard?.classList.remove("attention");
    usePublicServer.hidden = true;
    setServerDependentControls(true);
    healthCheckInFlight = false;
    return true;
  }
  status.textContent = "SERVER OFFLINE";
  status.classList.add("bad");
  const configured = String(input.value || config?.partyBase || "");
  const localDefault = /\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/i.test(configured.replace(/\/+$/, ""));
  message.textContent = localDefault
    ? "No local Party server is running. Choose USE PUBLIC SERVER, or paste another Party URL and SAVE & CHECK."
    : "Could not reach that Party server. Check the URL or Railway deployment.";
  message.className = "server-message bad";
  connectionCard?.classList.toggle("attention", localDefault);
  // No local server: offer the public Railway server as one click instead of a URL to go find.
  usePublicServer.hidden = !(localDefault && config?.publicPartyBase);
  if (localDefault) {
    status.textContent = "SETUP REQUIRED";
    if (!quiet) {
      input.focus();
      setTimeout(() => connectionCard?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  }
  setServerDependentControls(false);
  healthCheckInFlight = false;
  return false;
}

config = await window.cpiDesktop.config();
paintActiveTarget(config.activeTarget || "home");
paintHostState(await window.cpiDesktop.hostStatus());
paintRoomCode(await window.cpiDesktop.roomCode());
partyUrl.textContent = config.partyBase;
version.textContent = `CPI PARTY DESKTOP v${config.version}${config.build?.commit ? ` · ${config.build.commit}` : ""}`;
paintUpdate(await window.cpiDesktop.updateStatus());
input.value = config.partyBase;

save.addEventListener("click", async () => {
  save.disabled = true;
  message.textContent = "Saving…";
  try {
    config = { ...config, ...(await window.cpiDesktop.setPartyUrl(input.value)) };
    input.value = config.partyBase;
    partyUrl.textContent = config.partyBase;
    await checkServer();
    await runReadiness();
    await refreshPlayerQr();
  } catch (error) {
    message.textContent = error?.message || "That server URL is not valid.";
    message.className = "server-message bad";
  } finally {
    save.disabled = false;
  }
});


rerunReadiness.addEventListener("click", () => void runReadiness());

checkForUpdates.addEventListener("click", async () => {
  updateNotice = null;
  paintUpdate(await window.cpiDesktop.checkForUpdates());
});

installUpdate.addEventListener("click", async () => {
  installUpdate.disabled = true;
  try {
    const result = await window.cpiDesktop.installUpdate();
    // Blocked while a host is live: the download stays ready and nothing restarts.
    if (!result?.ok) {
      updateNotice = result?.message || "The update could not be installed.";
      paintUpdate(updateState);
    }
  } finally {
    installUpdate.disabled = false;
  }
});

updateLater.addEventListener("click", () => {
  updateLaterFor = updateState?.availableVersion ?? null;
  paintUpdate(updateState);
});

openUpdateDownload.addEventListener("click", () => void window.cpiDesktop.openUpdateDownload());

updatePill.addEventListener("click", () => updateCard.scrollIntoView({ behavior: "smooth", block: "center" }));

usePublicServer.addEventListener("click", () => {
  if (!config?.publicPartyBase) return;
  input.value = config.publicPartyBase;
  save.click();
});


copyPlayerLink.addEventListener("click", async () => {
  const url = await window.cpiDesktop.copyPlayerLink();
  message.textContent = `Copied ${url}`;
  message.className = "server-message ok";
});


startGroupNight.addEventListener("click", async () => {
  startGroupNight.disabled = true;
  const ready = await runReadiness();
  if (!ready) {
    message.textContent = "Group Night launch stopped because readiness changed. Fix the highlighted issue and try again.";
    message.className = "server-message bad";
    return;
  }
  await window.cpiDesktop.startPresentationHost();
});


returnToHost.addEventListener("click", async () => {
  await window.cpiDesktop.returnHost();
});


stopHostDisplay.addEventListener("click", async () => {
  const confirmed = confirm("Stop the live host display? This can pause an active game until a host reconnects.");
  if (!confirmed) return;
  await window.cpiDesktop.stopHost();
  paintHostState({ running: false, active: false });
  message.textContent = "Host display stopped.";
  message.className = "server-message ok";
});


setInterval(() => void checkServer({ quiet: true }), 30_000);
setInterval(() => void runReadiness(), 120_000);


copyRoomCode.addEventListener("click", async () => {
  const code = await window.cpiDesktop.copyRoomCode();
  if (!code) return;
  message.textContent = `Copied room code ${code}`;
  message.className = "server-message ok";
});


// Slow network checks run last so every button above is already wired while they're in flight.
await checkServer();
await refreshPlayerQr();
await runReadiness();
