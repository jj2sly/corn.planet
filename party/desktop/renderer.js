const status = document.querySelector("#serverStatus");
const partyUrl = document.querySelector("#partyUrl");
const version = document.querySelector("#version");

for (const button of document.querySelectorAll("[data-target]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    if (target && target !== "home") window.cpiDesktop.navigate(target);
  });
}

const config = await window.cpiDesktop.config();
partyUrl.textContent = config.partyBase;
version.textContent = `CPI PARTY DESKTOP v${config.version}`;

try {
  const response = await fetch(`${config.partyBase}/healthz`, { cache: "no-store" });
  if (!response.ok) throw new Error("health");
  const health = await response.json();
  status.textContent = `SERVER ONLINE // ${health.rooms ?? 0} ROOMS`;
  status.classList.add("ok");
} catch {
  status.textContent = "SERVER OFFLINE";
  status.classList.add("bad");
}
