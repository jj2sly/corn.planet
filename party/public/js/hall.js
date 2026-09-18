// Hall of Fame: the reports the review board accepted. Moderators can hide one, or promote one to
// CPI canon — which opens the Records Division prefilled, for a person to file. Nothing on this
// page writes to the CPI Database.

import { $, api, el, notice } from "./common.js";
import { authMode, currentUser, getToken, initAuth, onAuthChange } from "./auth.js";

const main = $("#main");
const masthead = main.querySelector(".masthead");
let me = null;
let sort = "top";

const call = async (path, options = {}) => api(path, { ...options, token: await getToken() });

const when = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function stamps(m) {
  const unanimous = m.votesPossible >= 2 && m.votes === m.votesPossible;
  const canon = m.canonRef
    ? m.canonUrl
      ? el("a", { class: "stamp ok", href: m.canonUrl, target: "_blank", rel: "noopener noreferrer", text: `Canon · ${m.canonRef}` })
      : el("span", { class: "stamp ok", text: `Canon · ${m.canonRef}` })
    : null;
  return el(
    "span",
    { class: "row" },
    canon,
    unanimous ? el("span", { class: "stamp solid", text: "Unanimous" }) : null,
    m.mine ? el("span", { class: "stamp", text: "Your report" }) : null,
    m.status === "hidden" ? el("span", { class: "stamp danger", text: "Hidden" }) : null,
    !m.canonRef && m.promotionStartedAt ? el("span", { class: "stamp muted", text: "Promotion started" }) : null,
  );
}

function moderatorActions(m, note, replace) {
  const hide = el("button", {
    class: "btn subtle small",
    type: "button",
    text: m.status === "hidden" ? "Unhide" : "Hide",
    onclick: async () => {
      try {
        const { moment } = await call(`/mod/moments/${m.id}`, {
          method: "PATCH",
          body: { status: m.status === "hidden" ? "visible" : "hidden" },
        });
        replace(moment);
      } catch (err) {
        notice(note, err.message, "error");
      }
    },
  });

  const promote =
    !m.canonRef && m.status !== "hidden"
      ? el("button", {
          class: "btn small",
          type: "button",
          text: m.promotionStartedAt ? "Reopen in Records Division" : "Promote to canon",
          onclick: async () => {
            // Open the tab now, while this still counts as a click; a tab opened after the
            // request returns would be blocked as a popup.
            const tab = window.open("", "_blank");
            try {
              const { url, moment } = await call(`/mod/moments/${m.id}/promote`, { method: "POST" });
              if (tab) {
                tab.opener = null;
                tab.location.href = url;
              }
              replace(moment, (fresh) =>
                notice(
                  fresh,
                  "The Records Division is open with this filled in as an incident. Review it and file it there — it shows as canon here within about 10 minutes.",
                  "ok",
                ),
              );
              if (!tab) window.location.href = url;
            } catch (err) {
              tab?.close();
              notice(note, err.message, "error");
            }
          },
        })
      : null;

  return el("div", { class: "row" }, hide, promote);
}

function momentItem(m) {
  const note = el("p", { class: "notice" });
  const item = el("li", { class: "moment" });

  // Swap this entry for its updated version in place; `after` gets the new entry's notice.
  const replace = (updated, after) => {
    const fresh = momentItem(updated);
    item.replaceWith(fresh.item);
    after?.(fresh.note);
  };

  item.append(
    el("p", { class: "eyebrow", text: m.context }),
    el("p", { class: "moment-text", text: `“${m.text}”` }),
    el("p", { class: "muted", text: `— ${m.authorName} · accepted by ${m.votes} of ${m.votesPossible} · ${when(m.createdAt)}` }),
    stamps(m),
    me.isModerator ? moderatorActions(m, note, replace) : null,
    note,
  );
  return { item, note };
}

function hallList() {
  const list = el("ul", { class: "list moments" });
  const more = el("button", { class: "btn subtle", type: "button", text: "Load more", hidden: true });
  let offset = 0;

  const load = async (reset) => {
    if (reset) offset = 0;
    try {
      const { moments, pageSize } = await call(`/moments?sort=${sort}&offset=${offset}`);
      const items = moments.map((m) => momentItem(m).item);
      if (reset) list.replaceChildren(...items);
      else list.append(...items);
      if (reset && !moments.length) {
        list.replaceChildren(
          el("li", { class: "muted", text: "Nothing here yet. Play Cornlashing: every report the review board accepts lands in the Hall of Fame." }),
        );
      }
      offset += moments.length;
      more.hidden = moments.length < pageSize;
    } catch (err) {
      list.replaceChildren(el("li", { class: "notice error", text: err.message }));
    }
  };
  more.addEventListener("click", () => load(false));

  const sortButtons = [
    ["top", "Top rated"],
    ["recent", "Most recent"],
  ].map(([value, label]) =>
    el("button", {
      class: `game-choice ${value === sort ? "selected" : ""}`.trim(),
      type: "button",
      "aria-pressed": String(value === sort),
      text: label,
      onclick: () => {
        sort = value;
        for (const b of sortButtons) {
          const on = b.dataset.sort === sort;
          b.classList.toggle("selected", on);
          b.setAttribute("aria-pressed", String(on));
        }
        load(true);
      },
      dataset: { sort: value },
    }),
  );

  load(true);
  return el("section", { class: "panel stack" }, el("div", { class: "game-list", role: "group", "aria-label": "Sort" }, sortButtons), list, more);
}

async function render() {
  if (authMode() === "none") {
    return main.replaceChildren(masthead, el("p", { class: "banner", text: "Accounts aren't enabled on this server, so the Hall of Fame isn't available." }));
  }
  if (!currentUser()) {
    return main.replaceChildren(
      masthead,
      el(
        "section",
        { class: "panel stack shell narrow" },
        el("h2", { text: "Clearance required" }),
        el("p", { text: "Log in with your CPI account to browse the Hall of Fame." }),
        el("a", { class: "btn", href: "/account", text: "Log in" }),
      ),
    );
  }
  try {
    me = await call("/me");
  } catch (err) {
    return main.replaceChildren(masthead, el("p", { class: "banner danger", role: "alert", text: err.message }));
  }

  main.replaceChildren(
    masthead,
    me.isModerator
      ? el(
          "p",
          { class: "banner", role: "note" },
          "Moderator: ",
          el("strong", { text: "Promote to canon" }),
          " opens the Records Division with the report filled in as an incident. Nothing becomes canon until someone files it there.",
        )
      : null,
    hallList(),
  );
}

(async () => {
  try {
    await initAuth();
  } catch {
    return main.replaceChildren(masthead, el("p", { class: "banner danger", role: "alert", text: "Can't reach the Corn Planet Party server. Refresh to try again." }));
  }
  onAuthChange(() => render());
  render();
})();
