// Shared helpers for every CPST Party page. All user-provided text is inserted with
// textContent (via el()), never as HTML.

/** Creates an element. attrs: class, text, dataset, on* handlers, and plain attributes. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);

/** Storage that never throws (private mode, blocked storage). */
export const store = {
  get(kind, key) {
    try {
      const raw = window[kind].getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(kind, key, value) {
    try {
      window[kind].setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: the session just won't survive a refresh */
    }
  },
  remove(kind, key) {
    try {
      window[kind].removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** Shows a message in a .notice element. kind: "error" | "ok" | "" */
export function notice(target, message, kind = "") {
  if (!target) return;
  target.textContent = message || "";
  target.className = `notice ${message ? kind : ""}`.trim();
  target.setAttribute("role", kind === "error" ? "alert" : "status");
}

let configPromise = null;
export function loadConfig() {
  configPromise ??= fetch("/api/config").then((r) => {
    if (!r.ok) throw new Error("config");
    return r.json();
  });
  return configPromise;
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Calls the CPST Party API with the current login token. */
export async function api(path, { method = "GET", body, token } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the CPST Party server. Check your connection.", 0);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error ?? "SERVER_ERROR", data?.message ?? "Something went wrong. Try again.", response.status);
  }
  return data;
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Report letters: A, B, C… */
export const letter = (i) => String.fromCharCode(65 + i);

const FLAVOR = [
  "WARNING: EXCESSIVE CORN ACTIVITY DETECTED",
  "COB-AI RESEARCH DIVISION IS WATCHING",
  "ALL INCIDENT REPORTS ARE LEGALLY BINDING (THEY ARE NOT)",
  "REMINDER: DO NOT FEED THE COSMIC-CLASS ENTITIES",
  "CONTAINMENT STATUS: NOMINAL-ISH",
  "RECORDS DIVISION REQUESTS YOU STOP LAUGHING",
  "THE CORN SUN SEES ALL",
  "CLASSIFIED PARTY SESSION IN PROGRESS",
];

export function flavorLine(seed = Date.now()) {
  return FLAVOR[Math.abs(Math.floor(seed / 9000)) % FLAVOR.length];
}

/** Keeps every [data-deadline] element counting down. Deadlines are local epoch ms. */
export function startCountdowns() {
  const tick = () => {
    for (const node of document.querySelectorAll("[data-deadline]")) {
      const unit = node.querySelector(".unit");
      const value = node.querySelector(".value");
      if (node.dataset.paused === "true") {
        value.textContent = "--";
        unit.textContent = "PAUSED";
        node.classList.remove("low");
        continue;
      }
      const seconds = Math.max(0, Math.ceil((Number(node.dataset.deadline) - Date.now()) / 1000));
      value.textContent = String(seconds);
      unit.textContent = "SEC";
      node.classList.toggle("low", seconds <= 5);
    }
  };
  tick();
  setInterval(tick, 250);
}

/** A countdown element for a room timer ({remainingMs, paused}) or null. */
export function timerEl(timer, label = "Time remaining") {
  if (!timer) return el("span");
  return el(
    "span",
    {
      class: "timer",
      role: "timer",
      "aria-label": label,
      dataset: { deadline: String(Date.now() + timer.remainingMs), paused: String(timer.paused) },
    },
    el("span", { class: "value", text: String(Math.ceil(timer.remainingMs / 1000)) }),
    el("span", { class: "unit", text: timer.paused ? "PAUSED" : "SEC" }),
  );
}

/**
 * Re-renders a region only when its key changes; otherwise calls the view's update().
 * Keeps typing, focus and scroll intact while live state keeps arriving.
 */
export function createMount(root) {
  let currentKey = null;
  let current = null;
  return (key, build, state) => {
    if (key !== currentKey || !current || !root.contains(current.node)) {
      current = build(state);
      root.replaceChildren(current.node);
      currentKey = key;
    }
    current.update?.(state);
  };
}

/** Announces a short message to screen readers through a polite live region. */
export function announce(message) {
  let region = document.getElementById("live-region");
  if (!region) {
    region = el("div", { id: "live-region", class: "sr-only", "aria-live": "polite" });
    document.body.append(region);
  }
  region.textContent = message;
}

/** Ranks entries by score (ties share a placement). */
export function rank(entries) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  return sorted.map((e) => ({ ...e, placement: 1 + sorted.filter((o) => o.score > e.score).length }));
}

/** Scoreboard list. rows: [{ name, score, placement, note? }] already ranked. */
export function scoreboardEl(rows) {
  const max = Math.max(1, ...rows.map((r) => r.score));
  return el(
    "ol",
    { class: "scoreboard" },
    rows.map((r) => {
      const bar = el("span", { class: "bar" }, r.name, r.note ? el("span", { class: "stamp muted", text: r.note }) : null);
      // CSSOM, not a style attribute, so the Content-Security-Policy stays strict.
      bar.style.setProperty("--pct", `${Math.round((Math.max(0, r.score) / max) * 100)}%`);
      return el(
        "li",
        { class: r.placement === 1 ? "first" : "" },
        el("span", { class: "rank", text: ordinal(r.placement) }),
        bar,
        el("span", { class: "score", text: r.score.toLocaleString() }),
      );
    }),
  );
}
