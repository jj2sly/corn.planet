import { $, api, el, loadConfig, notice, ordinal } from "./common.js";
import { authMode, currentUser, devSignIn, getToken, initAuth, onAuthChange, register, signIn, signOut } from "./auth.js";

const main = $("#main");
const masthead = main.querySelector(".masthead");

function page(...nodes) {
  main.replaceChildren(masthead, ...nodes);
}

async function render() {
  const mode = authMode();
  if (mode === "none") {
    return page(el("p", { class: "banner", text: "Accounts aren't enabled on this server. Everyone plays as a guest." }));
  }
  if (!currentUser()) return page(mode === "dev" ? devLoginForm() : loginForm());

  const token = await getToken();
  try {
    const [me, stats, history] = await Promise.all([
      api("/me", { token }),
      api("/me/stats", { token }),
      api("/me/history", { token }),
    ]);
    page(profilePanel(me), statsPanel(stats), historyPanel(history));
  } catch (err) {
    page(
      el("p", { class: "banner danger", role: "alert", text: err.message }),
      el("button", { class: "btn", type: "button", text: "Log out and try again", onclick: () => signOut() }),
    );
  }
}

// ------------------------------------------------------------------ logged out

function loginForm() {
  const note = el("p", { class: "notice" });
  const email = el("input", { id: "email", type: "email", autocomplete: "email", required: true });
  const password = el("input", { id: "password", type: "password", autocomplete: "current-password", required: true, minlength: "6" });
  const confirmField = el("div", { class: "field", hidden: true });
  const confirmInput = el("input", { id: "confirm", type: "password", autocomplete: "new-password", minlength: "6" });
  confirmField.append(el("label", { for: "confirm", text: "Confirm password" }), confirmInput);
  let registering = false;

  const submit = el("button", { class: "btn big", type: "submit", text: "Access system" });
  const toggle = el("button", {
    class: "btn subtle",
    type: "button",
    text: "No account? Register",
    onclick: () => {
      registering = !registering;
      confirmField.hidden = !registering;
      password.autocomplete = registering ? "new-password" : "current-password";
      submit.textContent = registering ? "Register" : "Access system";
      toggle.textContent = registering ? "Already registered? Log in" : "No account? Register";
      notice(note, "");
    },
  });

  return el(
    "section",
    { class: "panel stack shell narrow" },
    el("h2", { text: "Access terminal" }),
    el("p", {}, "Use your ", el("strong", { text: "CPST Database" }), " email and password — it's the same account."),
    el(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          if (!email.value || password.value.length < 6) return notice(note, "Enter your email and a password of at least 6 characters.", "error");
          if (registering && password.value !== confirmInput.value) return notice(note, "Passwords don't match.", "error");
          submit.disabled = true;
          notice(note, registering ? "Registering…" : "Verifying…");
          try {
            await (registering ? register(email.value.trim(), password.value) : signIn(email.value.trim(), password.value));
            notice(note, "Access granted.", "ok");
          } catch (err) {
            notice(note, err.message, "error");
          } finally {
            submit.disabled = false;
          }
        },
      },
      el("div", { class: "field" }, el("label", { for: "email", text: "Email" }), email),
      el("div", { class: "field" }, el("label", { for: "password", text: "Password" }), password),
      confirmField,
      submit,
      note,
    ),
    toggle,
    el("p", { class: "hint", text: "New accounts start with Viewer clearance, exactly like on the database site. Guests can still play; logging in records your stats." }),
  );
}

function devLoginForm() {
  const uid = el("input", { id: "uid", type: "text", value: "tester", pattern: "[A-Za-z0-9_\\-]{1,40}", required: true });
  const role = el(
    "select",
    { id: "role" },
    ["VIEWER", "CPI_EMPLOYEE", "CORRESPONDENT", "OVERSEER", "EXEC"].map((r) => el("option", { value: r, text: r })),
  );
  return el(
    "section",
    { class: "panel stack shell narrow" },
    el("p", { class: "warning", text: "Development login" }),
    el("p", { text: "This server runs AUTH_MODE=dev for local testing. Pick any id and CPI role. Production servers refuse this." }),
    el(
      "form",
      {
        class: "stack",
        onsubmit: (e) => {
          e.preventDefault();
          if (uid.checkValidity()) devSignIn(uid.value, role.value);
        },
      },
      el("div", { class: "field" }, el("label", { for: "uid", text: "Test user id" }), uid),
      el("div", { class: "field" }, el("label", { for: "role", text: "CPI role" }), role),
      el("button", { class: "btn big", type: "submit", text: "Log in (dev)" }),
    ),
  );
}

// ------------------------------------------------------------------ logged in

function profilePanel(me) {
  const note = el("p", { class: "notice" });
  const name = el("input", { id: "displayName", type: "text", maxlength: "16", value: me.displayName, required: true });
  return el(
    "section",
    { class: "panel stack" },
    el("h2", { text: "Agent profile" }),
    el(
      "p",
      {},
      "Logged in as ",
      el("strong", { text: currentUser()?.label ?? "" }),
      " · clearance ",
      el("span", { class: "stamp", text: me.role.replace("_", " ") }),
      me.isModerator ? el("span", { class: "stamp ok", text: "Prompt moderator" }) : null,
    ),
    el(
      "form",
      {
        class: "row",
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const saved = await api("/me", { method: "PUT", token: await getToken(), body: { displayName: name.value } });
            name.value = saved.displayName;
            notice(note, "Display name saved.", "ok");
          } catch (err) {
            notice(note, err.message, "error");
          }
        },
      },
      el("div", { class: "field grow" }, el("label", { for: "displayName", text: "Display name (shown to other agents)" }), name),
      el("button", { class: "btn", type: "submit", text: "Save" }),
    ),
    note,
    el("p", { class: "hint", text: "Your email is never shown to other players." }),
    el("div", { class: "row" }, el("button", { class: "btn subtle", type: "button", text: "Log out", onclick: () => signOut() })),
  );
}

function stat(value, name) {
  return el("div", { class: "stat" }, el("span", { class: "value", text: String(value) }), el("span", { class: "name", text: name }));
}

function statsPanel(s) {
  return el(
    "section",
    { class: "panel stack" },
    el("h2", { text: "Service record" }),
    s.gamesPlayed === 0 ? el("p", { class: "muted", text: "No operations on file yet. Join a session while logged in to start your record." }) : null,
    el(
      "div",
      { class: "stat-grid" },
      stat(s.gamesPlayed, "Operations"),
      stat(s.wins, "Wins"),
      stat(s.bestPlacement ? ordinal(s.bestPlacement) : "—", "Best finish"),
      stat(s.totalPoints.toLocaleString(), "Total points"),
      stat(s.roundsPlayed, "Rounds"),
      stat(s.answersSubmitted, "Reports filed"),
      stat(s.votesCast, "Votes cast"),
      stat(s.votesReceived, "Votes received"),
      stat(s.unanimousRulings, "Unanimous rulings"),
      stat(s.promptsCreated, "Prompts written"),
      stat(s.promptUses, "Prompt uses"),
    ),
    s.favoriteCategories.length
      ? el("p", {}, "Favorite incident categories: ", el("strong", { text: s.favoriteCategories.map((c) => `${c.category} (${c.count})`).join(", ") }))
      : null,
  );
}

function historyPanel(history) {
  return el(
    "section",
    { class: "panel stack" },
    el("h2", { text: "Operation history" }),
    history.length === 0
      ? el("p", { class: "muted", text: "Nothing yet." })
      : el(
          "div",
          { class: "table-wrap" },
          el(
            "table",
            {},
            el("thead", {}, el("tr", {}, ["Date", "Operation", "Finish", "Points", "Agents"].map((h) => el("th", { scope: "col", text: h })))),
            el(
              "tbody",
              {},
              history.map((h) =>
                el(
                  "tr",
                  {},
                  el("td", { text: new Date(h.endedAt).toLocaleDateString() }),
                  el("td", { text: h.gameId === "chaos" ? "CPST Chaos" : h.gameId }),
                  el("td", { text: ordinal(h.placement) }),
                  el("td", { class: "mono", text: h.score.toLocaleString() }),
                  el("td", { text: String(h.playerCount) }),
                ),
              ),
            ),
          ),
        ),
  );
}

(async () => {
  try {
    await loadConfig();
    await initAuth();
  } catch {
    return page(el("p", { class: "banner danger", role: "alert", text: "Can't reach the CPST Party server. Refresh to try again." }));
  }
  onAuthChange(() => render());
  render();
})();
