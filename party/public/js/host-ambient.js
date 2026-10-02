// Ambient backgrounds for the host/TV screen: a quiet, game-specific layer of CPI paperwork,
// terminals and indicators drifting far behind the game so big dark areas don't feel dead.
//
// Decorative only. One root element (.host-ambient, aria-hidden, pointer-events none, behind
// everything) holds a handful of layers built from the primitives below; each theme picks and
// configures them. CSS does all the moving (slow transform/opacity loops, party.css); nothing here
// runs on a timer. The host page owns it (host.js): phones/controllers never load this module.
//
// Layout of each theme is deterministic (no Math.random), so re-showing a theme looks the same.

const THEMES = {
  chaos: "incident",
  entityauction: "bay",
  budgetcuts: "ledger",
  channelcob: "newsroom",
  mycob: "facility",
  cornorshit: "database",
  steamdeck: "device",
  thud: "range",
};

/** The ambient theme for a game id, or null for none (the lobby, results and unknown games get none). */
export const ambientTheme = (gameId) => (typeof gameId === "string" && Object.hasOwn(THEMES, gameId) ? THEMES[gameId] : null);

// Broad moods only: reveal/result phases are a little livelier, danger phases get a red accent.
// Anything not listed is "quiet".
const MOODS = {
  chaos: { VERDICT: "active", STANDINGS: "active" },
  entityauction: { EVENT: "active", REVEALED: "active" },
  budgetcuts: { VERDICT: "active", CONSEQUENCES: "active" },
  channelcob: { INTRO: "active", RECAP: "active", FINALE: "active" },
  mycob: { ALERT: "alert", CONSEQUENCE: "active", OUTCOME: "active" },
  cornorshit: { REVEAL: "active" },
  steamdeck: { RESULTS: "active" },
  thud: { PROCESS: "active" },
};

/** "quiet" | "active" | "alert" for a game's phase. */
export const ambientMood = (gameId, phase) => (ambientTheme(gameId) && MOODS[gameId]?.[phase]) || "quiet";

// ------------------------------------------------------------------ primitives

/** A tiny deterministic generator (0..1), so a theme lays out the same way every time. */
function seeded(seed) {
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

const SVG = "http://www.w3.org/2000/svg";

/** An element with a class and CSS variables, set through the CSSOM (the page's CSP blocks style attributes). */
function node(tag, cls, vars = {}, ...children) {
  const n = tag === "svg" || tag === "path" || tag === "g" ? document.createElementNS(SVG, tag) : document.createElement(tag);
  if (cls) n.setAttribute("class", cls);
  for (const [key, value] of Object.entries(vars)) n.style.setProperty(`--${key}`, String(value));
  for (const child of children) n.append(child);
  return n;
}

const layer = (name, ...children) => node("div", `amb-layer amb-${name}`, {}, ...children);
const between = (rand, lo, hi) => lo + rand() * (hi - lo);
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];
const hex = (rand, n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("").toUpperCase();

/** A drifting grid (the whole layer is oversized and glides one cell, so it never shows an edge). */
const grid = () => layer("grid");

/** A soft diagonal band of light that sweeps across very slowly. */
const sweep = (seconds = 38) => layer("sweep", node("div", "amb-sweep-band", { dur: `${seconds}s` }));

/**
 * Ghosted paper: `count` cards drifting gently back and forth near the edges of the screen. Each is
 * a title, a few text bars and (optionally) a redaction bar sliding over one of them.
 */
function cards(rand, { count, titles, redact = true, low = 2, w = [150, 230] }) {
  const out = layer("cards");
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : 0;
    // Most sit toward the edges; the last few lie low across the bottom, where screens are emptiest.
    const bottom = i >= count - low;
    const x = bottom ? between(rand, 18 + (i % 2) * 28, 40 + (i % 2) * 30) : side ? between(rand, 74, 92) : between(rand, 1, 17);
    const lines = Array.from({ length: 4 + (i % 3) }, () => node("i", "amb-line", { w: `${Math.round(between(rand, 38, 100))}%` }));
    const body = [node("b", "amb-card-title", {}, `${pick(rand, titles)} ${hex(rand, 4)}`), ...lines];
    if (redact) body.splice(2 + (i % 2), 0, node("i", "amb-redact", { w: `${Math.round(between(rand, 36, 70))}%`, dur: `${Math.round(between(rand, 16, 30))}s`, delay: `-${Math.round(between(rand, 0, 20))}s` }));
    out.append(
      node(
        "div",
        "amb-card",
        {
          x: `${x.toFixed(1)}%`,
          y: `${(bottom ? between(rand, 66, 80) : between(rand, 4, 62)).toFixed(1)}%`,
          w: `${Math.round(between(rand, w[0], w[1]))}px`,
          dx: `${Math.round(between(rand, 10, 38)) * (side ? -1 : 1)}px`,
          dy: `${Math.round(between(rand, -70, -24))}px`,
          rot: `${between(rand, -5, 5).toFixed(1)}deg`,
          rot2: `${between(rand, -6, 6).toFixed(1)}deg`,
          dur: `${Math.round(between(rand, 28, 46))}s`,
          delay: `-${Math.round(between(rand, 0, 40))}s`,
        },
        ...body,
      ),
    );
  }
  return out;
}

/**
 * Scrolling terminal text: columns of dim fragments creeping upward, faded at both ends. The text is
 * doubled so the loop is seamless.
 */
function columns(rand, { positions, lines, fragments, seconds = [70, 110] }) {
  const out = layer("columns");
  positions.forEach((x, i) => {
    const text = Array.from({ length: lines }, () => pick(rand, fragments).replace("#", hex(rand, 4))).join("\n");
    out.append(node("div", "amb-col", { x: `${x}%`, dur: `${Math.round(between(rand, seconds[0], seconds[1]))}s`, delay: `-${i * 17}s` }, node("pre", "amb-col-text", {}, `${text}\n${text}\n`)));
  });
  return out;
}

/** Faint stamps that fade up for a few seconds, once in a long while, at the edges. */
function stamps(rand, words) {
  const out = layer("stamps");
  words.forEach((word, i) => {
    out.append(
      node("div", "amb-stamp", {
        x: `${(i % 2 ? between(rand, 66, 80) : between(rand, 3, 14)).toFixed(1)}%`,
        y: `${between(rand, 56, 84).toFixed(1)}%`,
        rot: `${between(rand, -14, 14).toFixed(1)}deg`,
        dur: `${Math.round(between(rand, 46, 66))}s`,
        delay: `-${Math.round(between(rand, 0, 50))}s`,
      }, word),
    );
  });
  return out;
}

/** A system-monitor trace along the bottom (a periodic wave, so sliding it half its width loops cleanly). */
function wave(rand, { top = 82, amp = 1 } = {}) {
  const points = [];
  const phase = rand() * 6;
  for (let x = 0; x <= 2000; x += 20) {
    const t = (x / 1000) * Math.PI * 2;
    const y = 60 + amp * (14 * Math.sin(t * 3 + phase) + 7 * Math.sin(t * 7 + phase * 2) + (Math.floor(x / 20) % 17 === 0 ? 22 : 0));
    points.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`);
  }
  const path = node("path", "amb-wave-path");
  path.setAttribute("d", points.join(" "));
  path.setAttribute("fill", "none");
  const svg = node("svg", "amb-wave-svg", { dur: `${Math.round(between(rand, 26, 38))}s` });
  svg.setAttribute("viewBox", "0 0 2000 120");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.append(path);
  return layer("wave", node("div", "amb-wave-box", { top: `${top}%` }, svg));
}

/** Small indicator lights that slowly brighten and dim; never a blink. */
function lights(rand, { count, y = [6, 94], spread = [3, 97] }) {
  const out = layer("lights");
  for (let i = 0; i < count; i++) out.append(node("i", `amb-light${i % 5 === 0 ? " hot" : ""}`, { x: `${between(rand, spread[0], spread[1]).toFixed(1)}%`, y: `${between(rand, y[0], y[1]).toFixed(1)}%`, dur: `${Math.round(between(rand, 9, 19))}s`, delay: `-${Math.round(between(rand, 0, 18))}s` }));
  return out;
}

/** A long strip of text sliding sideways along an edge. */
function ticker(rand, { y, items, seconds = 120 }) {
  const text = `${items.join("   ◆   ")}   ◆   `;
  return layer("ticker", node("div", "amb-ticker-strip", { y: `${y}%`, dur: `${seconds}s` }, node("span", "amb-ticker-text", {}, `${text}${text}`)));
}

/** Rows of plates/doors in two depths, sliding slowly in opposite directions (parallax). */
function plates(rand, { rows, label, count = 7 }) {
  const out = layer("plates");
  rows.forEach((row, r) => {
    const strip = node("div", `amb-plate-row${r % 2 ? " rev" : ""}`, { y: `${row.y}%`, dur: `${row.seconds}s`, scale: row.scale ?? 1 });
    for (let i = 0; i < count * 2; i++) strip.append(node("div", "amb-plate", {}, node("b", "", {}, `${label} ${String((i % count) + 1 + r * 3).padStart(2, "0")}`), node("i", "amb-plate-bar", { w: `${Math.round(between(rand, 30, 90))}%` })));
    out.append(strip);
  });
  return out;
}

/** Monitor frames with a faint test pattern, a couple of them lit a little brighter by a slow glow. */
function monitors(rand, count) {
  const out = layer("monitors");
  for (let i = 0; i < count; i++) {
    const side = i % 2;
    // The first four stand at the edges; any more sit low across the bottom, where screens are emptiest.
    const low = i >= 4;
    const x = low ? (side ? between(rand, 56, 70) : between(rand, 24, 38)) : side ? between(rand, 80, 91) : between(rand, 2, 12);
    const y = low ? between(rand, 68, 76) : 8 + (i >> 1) * 36 + between(rand, 0, 8);
    out.append(
      node(
        "div",
        "amb-monitor",
        { x: `${x.toFixed(1)}%`, y: `${y.toFixed(1)}%`, dur: `${Math.round(between(rand, 14, 26))}s`, delay: `-${Math.round(between(rand, 0, 20))}s` },
        node("i", "amb-bars"),
        node("b", "", {}, pick(rand, ["CAM", "FEED", "SAT", "DESK"]) + ` ${i + 1}`),
      ),
    );
  }
  return out;
}

/** Signal bars (like a meter): a few columns whose heights breathe at different, slow speeds. */
function signal(rand, { count, x }) {
  const out = layer("signal");
  const group = node("div", "amb-signal-bars", { x: `${x}%` });
  for (let i = 0; i < count; i++) group.append(node("i", "amb-signal-bar", { dur: `${Math.round(between(rand, 8, 16))}s`, delay: `-${Math.round(between(rand, 0, 14))}s`, lo: between(rand, 0.25, 0.45).toFixed(2), hi: between(rand, 0.65, 1).toFixed(2) }));
  out.append(group);
  return out;
}

/** Concentric schematic rings (SVG), one turning extremely slowly, with a pulse ring expanding now and then. */
function rings(rand, { x, y, size }) {
  const svg = node("svg", "amb-rings-svg", { x: `${x}%`, y: `${y}%`, size: `${size}vmin` });
  svg.setAttribute("viewBox", "-100 -100 200 200");
  const circle = (r, cls) => {
    const c = node("path", cls);
    c.setAttribute("d", `M${-r} 0 a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`);
    c.setAttribute("fill", "none");
    return c;
  };
  const turning = node("path", "amb-ring-tick");
  turning.setAttribute("fill", "none");
  let ticks = "";
  for (let a = 0; a < 360; a += 10) {
    const rad = (a * Math.PI) / 180;
    const inner = a % 30 === 0 ? 78 : 84;
    ticks += `M${(Math.cos(rad) * inner).toFixed(1)} ${(Math.sin(rad) * inner).toFixed(1)} L${(Math.cos(rad) * 90).toFixed(1)} ${(Math.sin(rad) * 90).toFixed(1)} `;
  }
  turning.setAttribute("d", ticks);
  const spin = node("g", "amb-ring-spin", { dur: `${Math.round(between(rand, 220, 300))}s` });
  spin.append(turning);
  svg.append(circle(94, "amb-ring"), circle(60, "amb-ring"), circle(32, "amb-ring dashed"), spin, circle(94, "amb-ring-pulse"));
  return layer("rings", svg);
}

/** Floor-plan lines (SVG): corridors and room outlines, drifting a little. */
function plan(rand) {
  const svg = node("svg", "amb-plan-svg", { dur: `${Math.round(between(rand, 60, 90))}s` });
  svg.setAttribute("viewBox", "0 0 1200 700");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  let d = "";
  for (let i = 0; i < 9; i++) {
    const x = Math.round(between(rand, 20, 1000) / 20) * 20;
    const y = Math.round(between(rand, 20, 560) / 20) * 20;
    const w = Math.round(between(rand, 80, 260) / 20) * 20;
    const h = Math.round(between(rand, 60, 180) / 20) * 20;
    d += `M${x} ${y} h${w} v${h} h${-w} Z M${x + w} ${y + Math.round(h / 40) * 20} h${Math.round(between(rand, 60, 160) / 20) * 20} `;
  }
  const path = node("path", "amb-plan-path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  svg.append(path);
  return layer("plan", svg);
}

/** A targeting reticle in each corner and a faint far horizon of silhouettes, all still. */
function range() {
  const out = layer("range");
  for (const corner of ["tl", "tr", "bl", "br"]) out.append(node("i", `amb-reticle amb-reticle-${corner}`));
  const hills = node("svg", "amb-hills");
  hills.setAttribute("viewBox", "0 0 1200 120");
  hills.setAttribute("preserveAspectRatio", "none");
  const path = node("path", "amb-hills-path");
  path.setAttribute("d", "M0 120 L0 84 L60 70 L120 88 L190 52 L240 76 L330 60 L420 92 L520 66 L600 80 L690 48 L760 72 L860 62 L950 90 L1040 58 L1120 78 L1200 66 L1200 120 Z");
  hills.append(path);
  out.append(hills);
  return out;
}

/** A thin bar of light that travels slowly down (or across) the screen. */
const scan = (seconds, axis = "y") => layer(`scan amb-scan-${axis}`, node("div", "amb-scan-bar", { dur: `${seconds}s` }));

const alert = () => layer("alert", node("div", "amb-alert-glow"));
const vignette = () => node("div", "amb-vignette");

// ------------------------------------------------------------------ themes

const BUILDERS = {
  // Cornlashing: an incident terminal. Ghosted incident forms with redaction bars, terminal columns,
  // a system trace, and the odd faint stamp. The main one.
  incident(rand) {
    return [
      grid(),
      sweep(42),
      cards(rand, { count: 7, titles: ["INCIDENT FORM", "RESPONSE LOG", "CONTAINMENT REPORT", "BREACH NOTICE"] }),
      columns(rand, {
        positions: [1.5, 91],
        lines: 34,
        fragments: ["> RESPONSE QUEUE # ... OK", "INCIDENT # FILED", "BREACH PROTOCOL: STANDBY", "CLASSIFIED // REVIEW PENDING", "> SYNC # ........ 100%", "REDACTED REDACTED REDACTED", "AGENT FEED # NOMINAL", "> FILE # ARCHIVED"],
      }),
      wave(rand, { top: 82 }),
      ticker(rand, { y: 95.5, items: ["RESPONSE QUEUE OPEN", "INCIDENT FORMS FILED", "BREACH PROTOCOL STANDBY", "CLASSIFIED", "AWAITING REVIEW"], seconds: 150 }),
      stamps(rand, ["CLASSIFIED", "BREACH", "RESPONSE", "REDACTED"]),
      lights(rand, { count: 5, y: [90, 97] }),
      alert(),
      vignette(),
    ];
  },

  // Entity Auction: containment bays. Numbered plates in two depths, a slow scan line, bay lights.
  bay(rand) {
    return [
      grid(),
      plates(rand, { label: "BAY", rows: [{ y: 5, seconds: 150, scale: 1 }, { y: 90, seconds: 110, scale: 0.8 }] }),
      scan(46, "y"),
      lights(rand, { count: 9 }),
      columns(rand, { positions: [0.8, 94], lines: 26, fragments: ["BAY # SEALED", "LOCK # ENGAGED", "> PRESSURE NOMINAL", "SCAN # CLEAR", "DOOR # CLOSED"], seconds: [90, 130] }),
      alert(),
      vignette(),
    ];
  },

  // Budget Cuts: bureaucratic forms and ledgers, with approval/rejection stamps sliding past.
  ledger(rand) {
    return [
      grid(),
      cards(rand, { count: 6, titles: ["BUDGET FORM", "LEDGER", "REQUISITION", "APPROVAL SHEET"], redact: false }),
      columns(rand, { positions: [1, 14, 83, 93], lines: 40, fragments: ["1,204.00", "  388.50", "9,017.25", "  -42.00", "   0.00", "12,880.10", "  611.75", "4,096.00"], seconds: [90, 140] }),
      stamps(rand, ["APPROVED", "DENIED", "PENDING", "AUDITED"]),
      sweep(52),
      alert(),
      vignette(),
    ];
  },

  // Channel Cob: newsroom monitors, signal bars, a ticker strip and a moving studio light.
  newsroom(rand) {
    return [
      grid(),
      monitors(rand, 6),
      signal(rand, { count: 14, x: 1.5 }),
      sweep(30),
      ticker(rand, { y: 96, items: ["CHANNEL COB", "DEVELOPING STORY", "STAND BY", "LIVE FROM THE DESK", "SIGNAL NOMINAL"], seconds: 140 }),
      lights(rand, { count: 4, y: [3, 8] }),
      alert(),
      vignette(),
    ];
  },

  // My Cob Escaped: a containment facility. Schematic rings, floor-plan lines, warning lights, pulses.
  facility(rand) {
    return [
      plan(rand),
      rings(rand, { x: 10, y: 68, size: 46 }),
      rings(rand, { x: 92, y: 18, size: 30 }),
      lights(rand, { count: 7 }),
      scan(52, "y"),
      alert(),
      vignette(),
    ];
  },

  // Corn or Shit: a CPI database scan. Rows of entries, drifting fact cards, a slow scan bar.
  database(rand) {
    return [
      grid(),
      columns(rand, { positions: [1.2, 12, 85, 93.5], lines: 36, fragments: ["ENTRY # | FILED", "ENTRY # | ACTIVE", "ENTRY # | SEALED", "REC # ........ OK", "INDEX # CACHED"], seconds: [80, 120] }),
      cards(rand, { count: 5, titles: ["FACT CARD", "ENTRY", "DOSSIER"], redact: true }),
      stamps(rand, ["CLASSIFIED", "ENTRY", "ARCHIVE"]),
      scan(26, "y"),
      alert(),
      vignette(),
    ];
  },

  // Steam Deck: handheld-device ambience. Telemetry columns, a trace, a grid; kept apart from the game's own UI.
  device(rand) {
    return [
      grid(),
      columns(rand, { positions: [1.2, 94], lines: 24, fragments: ["CPU 41%   GPU 38%", "TEMP 38C   FAN 22%", "BAT 87%   LINK OK", "FPS 60   LAT 12MS", "MEM 5.1G / 16G"], seconds: [100, 150] }),
      cards(rand, { count: 4, titles: ["DIAGNOSTICS", "TELEMETRY"], redact: false, low: 1, w: [130, 190] }),
      wave(rand, { top: 88, amp: 0.7 }),
      lights(rand, { count: 4, y: [92, 97] }),
      alert(),
      vignette(),
    ];
  },

  // Angry Thud's Revenge: the most restrained. Corner reticles, a far horizon, a single slow scan.
  range() {
    return [range(), scan(60, "x"), alert(), vignette()];
  },
};

// ------------------------------------------------------------------ the host's ambient root

/**
 * The host page's ambient layer. `show(gameId, phase)` puts up (or keeps, or swaps) the theme for
 * a game and sets its mood; `hide()` removes it. There is only ever one root, and `destroy()`
 * removes it and the reduced-motion listener.
 */
export function createAmbient(parent = document.body, { matchMedia = globalThis.matchMedia?.bind(globalThis) } = {}) {
  let root = null;
  let calm = false;
  const query = matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  const motion = () => (calm ? "still" : "drift");

  const sync = () => {
    calm = query?.matches === true;
    if (root) root.dataset.motion = motion();
  };
  sync();
  query?.addEventListener?.("change", sync);

  const removeAll = () => {
    for (const stale of parent.querySelectorAll(":scope > .host-ambient")) stale.remove();
    root = null;
  };

  return {
    get root() {
      return root;
    },
    /** "still" when reduced motion is on (the layer keeps its look but stops moving), else "drift". */
    get motion() {
      return motion();
    },
    show(gameId, phase) {
      const theme = ambientTheme(gameId);
      if (!theme) return this.hide();
      const mood = ambientMood(gameId, phase);
      if (root?.isConnected && root.dataset.theme === theme) {
        if (root.dataset.mood !== mood) root.dataset.mood = mood;
        return;
      }
      removeAll();
      const rand = seeded(theme);
      root = node("div", "host-ambient", {}, ...BUILDERS[theme](rand));
      root.setAttribute("aria-hidden", "true");
      root.dataset.theme = theme;
      root.dataset.game = gameId;
      root.dataset.mood = mood;
      root.dataset.motion = motion();
      parent.prepend(root);
    },
    hide() {
      removeAll();
    },
    destroy() {
      removeAll();
      query?.removeEventListener?.("change", sync);
    },
  };
}
