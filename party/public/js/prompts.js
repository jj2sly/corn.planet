import { $, api, el, notice, plural } from "./common.js";
import { currentUser, getToken, initAuth, onAuthChange, authMode } from "./auth.js";

const main = $("#main");
const masthead = main.querySelector(".masthead");
let me = null;
let config = null;
let activeTab = "write";

const call = async (path, options = {}) => api(path, { ...options, token: await getToken() });

const STATUS_TEXT = {
  approved: ["Approved", "ok"],
  pending: ["Pending review", ""],
  disabled: ["Disabled", "danger"],
};

function stamps(p) {
  const [statusLabel, statusClass] = STATUS_TEXT[p.status] ?? [null, ""];
  return el(
    "span",
    { class: "row" },
    el("span", { class: "stamp muted", text: p.category }),
    el("span", { class: `stamp ${p.rating === "chaos" ? "danger" : ""}`, text: p.rating }),
    p.status ? el("span", { class: `stamp ${statusClass}`, text: statusLabel }) : null,
    p.openReports ? el("span", { class: "stamp danger", text: plural(p.openReports, "report") }) : null,
  );
}

function ratingChoices(name, current = "safe") {
  return el(
    "fieldset",
    {},
    el("legend", { text: "Humor rating" }),
    el(
      "div",
      { class: "choices" },
      [
        ["safe", "Safe"],
        ["chaos", "Chaos"],
      ].map(([value, label]) =>
        el("label", { class: "choice" }, el("input", { type: "radio", name, value, checked: value === current }), el("span", { text: label })),
      ),
    ),
    el("p", { class: "hint", text: "Safe: general silly humor. Chaos: edgier and more absurd. Never sexual content or graphic violence." }),
  );
}

function categorySelect(id, current) {
  return el(
    "select",
    { id },
    config.categories.map((c) => el("option", { value: c, text: c, selected: c === current })),
  );
}

/** The shared create/edit form. onSave receives the payload and returns the saved prompt. */
function promptForm({ prompt, submitLabel, onSave, onCancel }) {
  const uid = Math.random().toString(36).slice(2, 8);
  const note = el("p", { class: "notice" });
  const text = el("textarea", { id: `text-${uid}`, maxlength: String(config.limits.promptMax), rows: "3", required: true });
  text.value = prompt?.text ?? "";
  const counter = el("p", { class: "counter", "aria-live": "polite" });
  const updateCounter = () => (counter.textContent = `${text.value.length}/${config.limits.promptMax}`);
  text.addEventListener("input", updateCounter);
  updateCounter();
  const category = categorySelect(`cat-${uid}`, prompt?.category ?? "general");
  const tags = el("input", { id: `tags-${uid}`, type: "text", value: (prompt?.tags ?? []).join(", "), placeholder: "silo, cob-ai" });
  const rating = ratingChoices(`rating-${uid}`, prompt?.rating ?? "safe");
  const submit = el("button", { class: "btn", type: "submit", text: submitLabel });

  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const saved = await onSave({
            text: text.value,
            category: category.value,
            tags: tags.value,
            rating: form.querySelector(`input[name="rating-${uid}"]:checked`).value,
          });
          notice(
            note,
            saved.status === "approved" ? "Filed and approved — it can appear in games now." : "Filed. A moderator will review it before it appears in games.",
            "ok",
          );
          if (!prompt) {
            text.value = "";
            tags.value = "";
            updateCounter();
          }
        } catch (err) {
          notice(note, err.message, "error");
        } finally {
          submit.disabled = false;
        }
      },
    },
    el(
      "div",
      { class: "field" },
      el("label", { for: `text-${uid}`, text: "Incident prompt" }),
      text,
      counter,
      el("p", { class: "hint", text: "Use ____ for a blank, or ask a question. 5–150 characters." }),
    ),
    el("div", { class: "grid-2" }, el("div", { class: "field" }, el("label", { for: `cat-${uid}`, text: "Category" }), category), el("div", { class: "field" }, el("label", { for: `tags-${uid}`, text: "Tags (optional, comma separated)" }), tags)),
    rating,
    el("div", { class: "row" }, submit, onCancel ? el("button", { class: "btn subtle", type: "button", text: "Cancel", onclick: onCancel }) : null),
    note,
  );
  return form;
}

// ------------------------------------------------------------------ tabs

function writeTab() {
  return el(
    "section",
    { class: "panel stack" },
    el("h2", { text: "File a new incident prompt" }),
    promptForm({ submitLabel: "File prompt", onSave: (body) => call("/prompts", { method: "POST", body }) }),
  );
}

function mineTab() {
  const list = el("ul", { class: "list" }, el("li", { class: "muted", text: "Loading…" }));
  const load = async () => {
    try {
      const prompts = await call("/prompts/mine");
      if (!prompts.length) return list.replaceChildren(el("li", { class: "muted", text: "You haven't written any prompts yet." }));
      list.replaceChildren(...prompts.map((p) => mineItem(p, load)));
    } catch (err) {
      list.replaceChildren(el("li", { class: "notice error", text: err.message }));
    }
  };
  load();
  return el("section", { class: "panel stack" }, el("h2", { text: "My prompts" }), list);
}

function mineItem(p, reload) {
  const note = el("p", { class: "notice" });
  const item = el(
    "li",
    {},
    el("div", { class: "grow stack" }, el("p", { class: "quote", text: p.text }), stamps(p), el("p", { class: "hint", text: `Used in ${plural(p.usageCount, "game round")}` })),
    el(
      "div",
      { class: "row" },
      el("button", {
        class: "btn subtle small",
        type: "button",
        text: "Edit",
        onclick: () =>
          item.replaceChildren(
            promptForm({
              prompt: p,
              submitLabel: "Save changes",
              onSave: async (body) => {
                const saved = await call(`/prompts/${p.id}`, { method: "PATCH", body });
                setTimeout(reload, 1200);
                return saved;
              },
              onCancel: reload,
            }),
          ),
      }),
      el("button", {
        class: "btn danger small",
        type: "button",
        text: "Delete",
        onclick: async () => {
          if (!confirm("Delete this prompt permanently?")) return;
          try {
            await call(`/prompts/${p.id}`, { method: "DELETE" });
            reload();
          } catch (err) {
            notice(note, err.message, "error");
          }
        },
      }),
    ),
    note,
  );
  return item;
}

function libraryTab() {
  const search = el("input", { id: "q", type: "search", placeholder: "Search prompts" });
  const rating = el("select", { id: "fRating", "aria-label": "Rating" }, el("option", { value: "", text: "Any rating" }), el("option", { value: "safe", text: "Safe" }), el("option", { value: "chaos", text: "Chaos" }));
  const category = el("select", { id: "fCategory", "aria-label": "Category" }, el("option", { value: "", text: "Any category" }), config.categories.map((c) => el("option", { value: c, text: c })));
  const list = el("ul", { class: "list" });
  const more = el("button", { class: "btn subtle", type: "button", text: "Load more" });
  let page = 0;

  const load = async (reset) => {
    if (reset) page = 0;
    const params = new URLSearchParams({ page: String(page) });
    if (search.value.trim()) params.set("q", search.value.trim());
    if (rating.value) params.set("rating", rating.value);
    if (category.value) params.set("category", category.value);
    try {
      const prompts = await call(`/prompts/library?${params}`);
      const items = prompts.map(libraryItem);
      if (reset) list.replaceChildren(...items);
      else list.append(...items);
      if (reset && !prompts.length) list.replaceChildren(el("li", { class: "muted", text: "No prompts match." }));
      more.hidden = prompts.length < 50;
    } catch (err) {
      list.replaceChildren(el("li", { class: "notice error", text: err.message }));
    }
  };
  more.addEventListener("click", () => {
    page += 1;
    load(false);
  });
  let debounce;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => load(true), 250);
  });
  rating.addEventListener("change", () => load(true));
  category.addEventListener("change", () => load(true));
  load(true);

  return el(
    "section",
    { class: "panel stack" },
    el("h2", { text: "Approved library" }),
    el("div", { class: "grid-2" }, el("div", { class: "field" }, el("label", { for: "q", text: "Search" }), search), el("div", { class: "row" }, rating, category)),
    list,
    more,
  );
}

function libraryItem(p) {
  const note = el("p", { class: "notice" });
  const reason = el("input", { type: "text", maxlength: "200", placeholder: "What's wrong with it? (optional)", "aria-label": "Report reason" });
  const reportForm = el(
    "form",
    {
      class: "row",
      hidden: true,
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const result = await call(`/prompts/${p.id}/report`, { method: "POST", body: { reason: reason.value } });
          reportForm.hidden = true;
          notice(note, result.alreadyReported ? "You already reported this prompt." : "Report filed. Moderators will review it.", "ok");
        } catch (err) {
          notice(note, err.message, "error");
        }
      },
    },
    reason,
    el("button", { class: "btn small", type: "submit", text: "Send report" }),
    el("button", { class: "btn subtle small", type: "button", text: "Cancel", onclick: () => (reportForm.hidden = true) }),
  );
  return el(
    "li",
    {},
    el(
      "div",
      { class: "grow stack" },
      el("p", { class: "quote", text: p.text }),
      el("span", { class: "row" }, el("span", { class: "muted", text: `by ${p.author}` }), stamps({ ...p, status: undefined })),
      reportForm,
      note,
    ),
    p.mine ? el("span", { class: "stamp", text: "Yours" }) : el("button", { class: "btn subtle small", type: "button", text: "Report", onclick: () => ((reportForm.hidden = false), reason.focus()) }),
  );
}

// ------------------------------------------------------------------ moderation

function moderationTab() {
  const content = el("div", { class: "stack" });
  const views = [
    ["pending", "Pending"],
    ["reported", "Reported"],
    ["disabled", "Disabled"],
    ["approved", "Approved"],
    ["packs", "Packs & categories"],
    ["settings", "Policy"],
  ];
  let view = "pending";
  const bar = el("div", { class: "choices", role: "group", "aria-label": "Moderation view" });
  const drawBar = () =>
    bar.replaceChildren(
      ...views.map(([id, label]) =>
        el("button", { class: `btn small ${id === view ? "" : "subtle"}`, type: "button", "aria-pressed": String(id === view), text: label, onclick: () => ((view = id), drawBar(), load()) }),
      ),
    );

  const load = async () => {
    content.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
    try {
      if (view === "packs") return content.replaceChildren(await packsView());
      if (view === "settings") return content.replaceChildren(await settingsView());
      const [prompts, packs] = await Promise.all([call(`/mod/prompts?view=${view}`), call("/mod/packs")]);
      content.replaceChildren(
        prompts.length ? el("ul", { class: "list" }, prompts.map((p) => moderationItem(p, packs, load))) : el("p", { class: "muted", text: "Nothing in this queue. Suspiciously calm." }),
      );
    } catch (err) {
      content.replaceChildren(el("p", { class: "notice error", text: err.message }));
    }
  };
  drawBar();
  load();
  return el("section", { class: "panel stack" }, el("h2", { text: "Moderation console" }), bar, content);
}

function moderationItem(p, packs, reload) {
  const note = el("p", { class: "notice" });
  const reports = el("ul", { class: "list", hidden: true });
  const act = async (fn) => {
    try {
      await fn();
      reload();
    } catch (err) {
      notice(note, err.message, "error");
    }
  };
  const packSelect = el(
    "select",
    {
      "aria-label": "Prompt pack",
      onchange: () => act(() => call(`/prompts/${p.id}`, { method: "PATCH", body: { packId: packSelect.value ? Number(packSelect.value) : null } })),
    },
    el("option", { value: "", text: "No pack (community)" }),
    packs.map((k) => el("option", { value: String(k.id), text: k.name, selected: k.id === p.packId })),
  );
  return el(
    "li",
    {},
    el(
      "div",
      { class: "grow stack" },
      el("p", { class: "quote", text: p.text }),
      el("span", { class: "row" }, el("span", { class: "muted", text: `by ${p.author} · used ${p.usageCount}×` }), stamps(p)),
      packSelect,
      reports,
      note,
    ),
    el(
      "div",
      { class: "row" },
      p.status !== "approved" ? el("button", { class: "btn small", type: "button", text: "Approve", onclick: () => act(() => call(`/prompts/${p.id}`, { method: "PATCH", body: { status: "approved" } })) }) : null,
      p.status !== "disabled" ? el("button", { class: "btn subtle small", type: "button", text: "Disable", onclick: () => act(() => call(`/prompts/${p.id}`, { method: "PATCH", body: { status: "disabled" } })) }) : null,
      p.openReports
        ? el("button", {
            class: "btn subtle small",
            type: "button",
            text: "Show reports",
            onclick: async () => {
              const list = await call(`/mod/prompts/${p.id}/reports`);
              reports.hidden = false;
              reports.replaceChildren(...list.map((r) => el("li", {}, el("span", { class: "grow", text: r.reason || "(no reason given)" }), el("span", { class: "stamp muted", text: r.resolved ? "resolved" : "open" }))));
            },
          })
        : null,
      p.openReports ? el("button", { class: "btn subtle small", type: "button", text: "Dismiss reports", onclick: () => act(() => call(`/mod/prompts/${p.id}/dismiss-reports`, { method: "POST", body: {} })) }) : null,
      el("button", { class: "btn danger small", type: "button", text: "Remove", onclick: () => confirm("Permanently remove this prompt?") && act(() => call(`/prompts/${p.id}`, { method: "DELETE" })) }),
    ),
  );
}

async function packsView() {
  const [packs, fresh] = await Promise.all([call("/mod/packs"), api("/config")]);
  config.categories = fresh.categories;
  const node = el("div", { class: "grid-2" });
  const packNote = el("p", { class: "notice" });
  const catNote = el("p", { class: "notice" });
  const reload = async () => node.replaceWith(await packsView());

  const packName = el("input", { id: "packName", type: "text", maxlength: "40", required: true });
  const packDesc = el("input", { id: "packDesc", type: "text", maxlength: "200" });
  const catName = el("input", { id: "catName", type: "text", maxlength: "24", required: true, placeholder: "snacks" });

  node.append(
    el(
      "div",
      { class: "stack" },
      el("h3", { text: "Prompt packs" }),
      el("p", { class: "hint", text: "Prompts in a disabled pack never appear in games." }),
      el(
        "ul",
        { class: "list" },
        packs.map((k) =>
          el(
            "li",
            {},
            el("span", { class: "grow" }, el("strong", { text: k.name }), el("span", { class: "muted", text: ` · ${plural(k.promptCount, "prompt")}` })),
            el("button", {
              class: `btn small ${k.enabled ? "subtle" : ""}`,
              type: "button",
              text: k.enabled ? "Disable pack" : "Enable pack",
              onclick: async () => {
                try {
                  await call(`/mod/packs/${k.id}`, { method: "PATCH", body: { enabled: !k.enabled } });
                  reload();
                } catch (err) {
                  notice(packNote, err.message, "error");
                }
              },
            }),
          ),
        ),
      ),
      el(
        "form",
        {
          class: "stack",
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await call("/mod/packs", { method: "POST", body: { name: packName.value, description: packDesc.value } });
              reload();
            } catch (err) {
              notice(packNote, err.message, "error");
            }
          },
        },
        el("div", { class: "field" }, el("label", { for: "packName", text: "New pack name" }), packName),
        el("div", { class: "field" }, el("label", { for: "packDesc", text: "Description" }), packDesc),
        el("button", { class: "btn", type: "submit", text: "Create pack" }),
        packNote,
      ),
    ),
    el(
      "div",
      { class: "stack" },
      el("h3", { text: "Categories" }),
      el("p", { class: "hint", text: "Deleting a category moves its prompts to “general”." }),
      el(
        "ul",
        { class: "list" },
        config.categories.map((c) =>
          el(
            "li",
            {},
            el("span", { class: "grow", text: c }),
            c === "general"
              ? el("span", { class: "stamp muted", text: "default" })
              : el("button", {
                  class: "btn danger small",
                  type: "button",
                  text: "Delete",
                  onclick: async () => {
                    if (!confirm(`Delete category “${c}”?`)) return;
                    try {
                      await call(`/mod/categories/${encodeURIComponent(c)}`, { method: "DELETE" });
                      reload();
                    } catch (err) {
                      notice(catNote, err.message, "error");
                    }
                  },
                }),
          ),
        ),
      ),
      el(
        "form",
        {
          class: "row",
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await call("/mod/categories", { method: "POST", body: { name: catName.value } });
              reload();
            } catch (err) {
              notice(catNote, err.message, "error");
            }
          },
        },
        el("div", { class: "field grow" }, el("label", { for: "catName", text: "New category" }), catName),
        el("button", { class: "btn", type: "submit", text: "Add" }),
      ),
      catNote,
    ),
  );
  return node;
}

async function settingsView() {
  const settings = await call("/mod/settings");
  const note = el("p", { class: "notice" });
  const threshold = el("input", { id: "threshold", type: "text", inputmode: "numeric", value: String(settings.reportThreshold) });
  const policies = [
    ["all", "Auto-approve everything", "Any logged-in agent's prompt goes straight into games."],
    ["safe", "Review chaos prompts", "Safe prompts are approved automatically; chaos-rated prompts wait for a moderator."],
    ["none", "Review everything", "Every new or edited prompt waits for a moderator."],
  ];
  return el(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const policy = e.target.querySelector('input[name="policy"]:checked').value;
          await call("/mod/settings", { method: "PUT", body: { moderationPolicy: policy, reportThreshold: Number(threshold.value) } });
          notice(note, "Policy saved.", "ok");
        } catch (err) {
          notice(note, err.message, "error");
        }
      },
    },
    el(
      "fieldset",
      {},
      el("legend", { text: "New prompt policy" }),
      el(
        "div",
        { class: "stack" },
        policies.map(([value, label, hint]) =>
          el(
            "div",
            {},
            el("label", { class: "choice" }, el("input", { type: "radio", name: "policy", value, checked: settings.moderationPolicy === value }), el("span", { text: label })),
            el("p", { class: "hint", text: hint }),
          ),
        ),
      ),
    ),
    el(
      "div",
      { class: "field" },
      el("label", { for: "threshold", text: "Auto-disable after this many reports" }),
      threshold,
      el("p", { class: "hint", text: "0 turns automatic disabling off. Disabled prompts wait in the Reported queue." }),
    ),
    el("button", { class: "btn", type: "submit", text: "Save policy" }),
    note,
  );
}

// ------------------------------------------------------------------ page

async function render() {
  if (authMode() === "none") {
    return main.replaceChildren(masthead, el("p", { class: "banner", text: "Accounts aren't enabled on this server, so the shared prompt library is read-only for everyone." }));
  }
  if (!currentUser()) {
    return main.replaceChildren(
      masthead,
      el(
        "section",
        { class: "panel stack shell narrow" },
        el("h2", { text: "Clearance required" }),
        el("p", { text: "Log in with your CPST account to write, browse and report prompts." }),
        el("a", { class: "btn", href: "/account", text: "Log in" }),
      ),
    );
  }
  try {
    [me, config] = await Promise.all([call("/me"), api("/config")]);
  } catch (err) {
    return main.replaceChildren(masthead, el("p", { class: "banner danger", role: "alert", text: err.message }));
  }

  const tabs = [
    ["write", "File prompt", writeTab],
    ["mine", "My prompts", mineTab],
    ["library", "Library", libraryTab],
    ...(me.isModerator ? [["moderation", "Moderation", moderationTab]] : []),
  ];
  if (!tabs.some(([id]) => id === activeTab)) activeTab = "write";

  const panel = el("div", { role: "tabpanel", id: "tabpanel", tabindex: "-1" });
  const tablist = el("div", { class: "tabs", role: "tablist", "aria-label": "Prompt archive sections" });
  const select = (id, focus = false) => {
    activeTab = id;
    for (const button of tablist.children) {
      const selected = button.dataset.tab === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    panel.setAttribute("aria-labelledby", `tab-${id}`);
    panel.replaceChildren(tabs.find(([t]) => t === id)[2]());
  };
  tablist.append(
    ...tabs.map(([id, label]) =>
      el("button", {
        type: "button",
        role: "tab",
        id: `tab-${id}`,
        "aria-controls": "tabpanel",
        dataset: { tab: id },
        text: label,
        onclick: () => select(id),
        onkeydown: (e) => {
          const index = tabs.findIndex(([t]) => t === id);
          const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (step) select(tabs[(index + step + tabs.length) % tabs.length][0], true);
        },
      }),
    ),
  );
  main.replaceChildren(
    masthead,
    el("p", { class: "muted" }, `Filing as `, el("strong", { text: me.displayName }), me.isModerator ? " · prompt moderator" : ""),
    tablist,
    panel,
  );
  select(activeTab);
}

(async () => {
  try {
    await initAuth();
  } catch {
    return main.replaceChildren(masthead, el("p", { class: "banner danger", role: "alert", text: "Can't reach the CPST Party server. Refresh to try again." }));
  }
  onAuthChange(() => render());
  render();
})();
