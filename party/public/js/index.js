import { $, el, loadConfig } from "./common.js";
import { currentUser, initAuth, onAuthChange } from "./auth.js";

const code = $("#code");
code.addEventListener("input", () => {
  code.value = code.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
});

$("#joinForm").addEventListener("submit", (e) => {
  if (code.value.length !== 4) {
    e.preventDefault();
    code.setCustomValidity("Session codes are 4 letters.");
    code.reportValidity();
    code.setCustomValidity("");
  }
});

setTimeout(() => ($("#boot").textContent = "SECURE LINK ESTABLISHED"), 900);

loadConfig()
  .then((config) => {
    $("#games").replaceChildren(
      ...config.games.map((g) =>
        el(
          "article",
          { class: "game-card" },
          el("h3", { text: g.name }),
          el("p", { class: "muted", text: g.tagline }),
          el("p", { text: g.description }),
          el("p", { class: "mono", text: `${g.minPlayers}–${g.maxPlayers} agents` }),
        ),
      ),
    );
    if (config.auth.mode === "none") $("#accountLink").hidden = true;
  })
  .catch(() => $("#games").replaceChildren(el("p", { class: "notice error", text: "Can't reach the Corn Planet Party server right now." })));

const showUser = (user) => ($("#accountLink").textContent = user ? "My account" : "Log in");
initAuth()
  .then(() => {
    showUser(currentUser());
    onAuthChange(showUser);
  })
  .catch(() => {});
