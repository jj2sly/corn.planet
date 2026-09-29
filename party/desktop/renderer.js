const status = document.querySelector("#serverStatus");
const partyUrl = document.querySelector("#partyUrl");
const version = document.querySelector("#version");
const input = document.querySelector("#partyServerInput");
const save = document.querySelector("#savePartyServer");
const message = document.querySelector("#serverMessage");

for (const button of document.querySelectorAll("[data-target]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    if (target && target !== "home") window.cpiDesktop.navigate(target);
  });
}

async function checkServer(base) {
  status.className = "status";
  status.textContent = "CHECKING SERVER…";
  try {
    const response = await fetch(`${base}/healthz`, { cache: "no-store" });
    if (!response.ok) throw new Error("health");
    const health = await response.json();
    status.textContent = `SERVER ONLINE // ${health.rooms ?? 0} ROOMS`;
    status.classList.add("ok");
    message.textContent = "Party server reachable.";
    message.className = "server-message ok";
    return true;
  } catch {
    status.textContent = "SERVER OFFLINE";
    status.classList.add("bad");
    message.textContent = "Could not reach that Party server.";
    message.className = "server-message bad";
    return false;
  }
}

let config = await window.cpiDesktop.config();
partyUrl.textContent = config.partyBase;
version.textContent = `CPI PARTY DESKTOP v${config.version}`;
input.value = config.partyBase;
await checkServer(config.partyBase);

save.addEventListener("click", async () => {
  save.disabled = true;
  message.textContent = "Saving…";
  try {
    config = { ...config, ...(await window.cpiDesktop.setPartyUrl(input.value)) };
    input.value = config.partyBase;
    partyUrl.textContent = config.partyBase;
    await checkServer(config.partyBase);
  } catch (error) {
    message.textContent = error?.message || "That server URL is not valid.";
    message.className = "server-message bad";
  } finally {
    save.disabled = false;
  }
});
