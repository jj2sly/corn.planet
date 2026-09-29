const status = document.querySelector("#serverStatus");
const hostLiveBanner = document.querySelector("#hostLiveBanner");
const returnToHost = document.querySelector("#returnToHost");
const stopHostDisplay = document.querySelector("#stopHostDisplay");
const partyUrl = document.querySelector("#partyUrl");
const version = document.querySelector("#version");
const input = document.querySelector("#partyServerInput");
const save = document.querySelector("#savePartyServer");
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
const SERVER_TARGETS = new Set(["party", "account", "prompts", "hall"]);
let serverOnline = false;
let hostRunning = false;
let healthCheckInFlight = false;

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

function paintHostState(detail) {
  hostRunning = Boolean(detail?.running);
  const active = Boolean(detail?.active);
  hostLiveBanner.classList.toggle("hidden", !hostRunning || active);
  refreshAvailabilityControls();
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
window.cpiDesktop.onPresentationMode((enabled) => {
  document.body.classList.toggle("presentation-mode", enabled);
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

async function runReadiness() {
  rerunReadiness.disabled = true;
  readinessIssues.textContent = "Checking Party server, game catalog and CPI canon…";
  const result = await window.cpiDesktop.readiness();

  readyServer.textContent = result.server ? "ONLINE" : "OFFLINE";
  readyServer.className = result.server ? "ready-ok" : "ready-bad";

  readyGames.textContent = `${result.games} / 6`;
  readyGames.className = result.games >= 6 ? "ready-ok" : "ready-bad";

  readyCanon.textContent = String(result.canon);
  readyCanon.className = result.canon >= 2 ? "ready-ok" : "ready-bad";

  readyProtocol.textContent = result.protocol ? String(result.protocol) : "—";
  readyProtocol.className = result.protocol ? "ready-ok" : "ready-bad";

  const ready = result.server && result.games >= 6 && result.canon >= 2 && !(result.issues?.length);
  startGroupNight.disabled = !ready;

  if (!ready) {
    readinessIssues.textContent = result.issues?.length ? result.issues.join(" • ") : "Group Night requirements are not met yet.";
    readinessIssues.className = "readiness-issues bad";
  } else {
    readinessIssues.textContent = "READY FOR GROUP NIGHT";
    readinessIssues.className = "readiness-issues ok";
  }
  rerunReadiness.disabled = false;
}

async function checkServer({ quiet = false } = {}) {
  if (healthCheckInFlight) return serverOnline;
  healthCheckInFlight = true;
  if (!quiet) {
    status.className = "status";
    status.textContent = "CHECKING SERVER…";
  }
  const result = await window.cpiDesktop.checkServer();
  if (result.ok) {
    const health = result.data || {};
    status.textContent = `SERVER ONLINE // ${health.rooms ?? 0} ROOMS`;
    status.classList.add("ok");
    message.textContent = "Party server reachable.";
    message.className = "server-message ok";
    connectionCard?.classList.remove("attention");
    setServerDependentControls(true);
    healthCheckInFlight = false;
    return true;
  }
  status.textContent = "SERVER OFFLINE";
  status.classList.add("bad");
  const configured = String(input.value || config?.partyBase || "");
  const localDefault = /\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/i.test(configured.replace(/\/+$/, ""));
  message.textContent = localDefault
    ? "No local Party server is running. Paste the Railway Party URL below, then SAVE & CHECK."
    : "Could not reach that Party server. Check the URL or Railway deployment.";
  message.className = "server-message bad";
  connectionCard?.classList.toggle("attention", localDefault);
  if (localDefault) {
    status.textContent = "SETUP REQUIRED";
    input.focus();
    setTimeout(() => connectionCard?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }
  setServerDependentControls(false);
  healthCheckInFlight = false;
  return false;
}

let config = await window.cpiDesktop.config();
paintActiveTarget(config.activeTarget || "home");
paintHostState(await window.cpiDesktop.hostStatus());
partyUrl.textContent = config.partyBase;
version.textContent = `CPI PARTY DESKTOP v${config.version}`;
input.value = config.partyBase;
await checkServer();
await runReadiness();
await refreshPlayerQr();

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


rerunReadiness.addEventListener("click", runReadiness);


copyPlayerLink.addEventListener("click", async () => {
  const url = await window.cpiDesktop.copyPlayerLink();
  message.textContent = `Copied ${url}`;
  message.className = "server-message ok";
});


startGroupNight.addEventListener("click", async () => {
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
