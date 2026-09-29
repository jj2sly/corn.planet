const status = document.querySelector("#serverStatus");
const partyUrl = document.querySelector("#partyUrl");
const version = document.querySelector("#version");
const input = document.querySelector("#partyServerInput");
const save = document.querySelector("#savePartyServer");
const message = document.querySelector("#serverMessage");
const copyPlayerLink = document.querySelector("#copyPlayerLink");
const readyServer = document.querySelector("#readyServer");
const readyGames = document.querySelector("#readyGames");
const readyCanon = document.querySelector("#readyCanon");
const readyProtocol = document.querySelector("#readyProtocol");
const readinessIssues = document.querySelector("#readinessIssues");
const rerunReadiness = document.querySelector("#rerunReadiness");
const startGroupNight = document.querySelector("#startGroupNight");
const SERVER_TARGETS = new Set(["party", "account", "prompts", "hall"]);

function setServerDependentControls(online) {
  for (const button of document.querySelectorAll("[data-game], [data-pc-game]")) {
    button.disabled = !online;
    button.title = online ? "" : "Party server is offline";
  }
  for (const button of document.querySelectorAll("[data-target]")) {
    if (!SERVER_TARGETS.has(button.dataset.target)) continue;
    button.disabled = !online;
    button.title = online ? "" : "Party server is offline";
  }
}

const navButtons = [...document.querySelectorAll(".rail button")];

function paintActiveTarget(target) {
  for (const button of navButtons) {
    const section = button.dataset.target || button.dataset.section;
    button.classList.toggle("active", section === target);
  }
}

for (const button of document.querySelectorAll("[data-target]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    if (!target) return;
    window.cpiDesktop.navigate(target);
  });
}

window.cpiDesktop.onActiveTarget((target) => paintActiveTarget(target));
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

async function checkServer() {
  status.className = "status";
  status.textContent = "CHECKING SERVER…";
  const result = await window.cpiDesktop.checkServer();
  if (result.ok) {
    const health = result.data || {};
    status.textContent = `SERVER ONLINE // ${health.rooms ?? 0} ROOMS`;
    status.classList.add("ok");
    message.textContent = "Party server reachable.";
    message.className = "server-message ok";
    setServerDependentControls(true);
    return true;
  }
  status.textContent = "SERVER OFFLINE";
  status.classList.add("bad");
  message.textContent = "Could not reach that Party server.";
  message.className = "server-message bad";
  setServerDependentControls(false);
  return false;
}

let config = await window.cpiDesktop.config();
paintActiveTarget(config.activeTarget || "home");
partyUrl.textContent = config.partyBase;
version.textContent = `CPI PARTY DESKTOP v${config.version}`;
input.value = config.partyBase;
await checkServer();
await runReadiness();

save.addEventListener("click", async () => {
  save.disabled = true;
  message.textContent = "Saving…";
  try {
    config = { ...config, ...(await window.cpiDesktop.setPartyUrl(input.value)) };
    input.value = config.partyBase;
    partyUrl.textContent = config.partyBase;
    await checkServer();
    await runReadiness();
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
  await window.cpiDesktop.navigate("party");
});
