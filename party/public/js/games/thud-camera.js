// Angry Thud's Revenge: where the camera looks. Screens only, and pure (no drawing, no DOM), so
// it's tested like the rules.
//
// The camera frames a *box* of the world for each moment (the sling while aiming, the bird in
// flight, the fort as it settles, the build zone while building) and fits it to the screen, minus
// what the HUD covers. Spare height goes to the sky, not the dirt: views sit on the ground. Every
// box has a floor and a ceiling on zoom, so a small phone and a TV both frame it sensibly. The big
// screen shows the whole field (everyone's watching it), leaning in on the fort when a shot lands.
//
// `bodies` are the smoothed bodies being drawn ({ row, x, y, vx, vy, leaving }, thud-interp.js).

/** The piggies' fort right now: every piggy and piggy-side block (and the Red Cow behind it). */
export function fortBox(bodies, level) {
  let l = Infinity;
  let r = -Infinity;
  let t = Infinity;
  for (const b of bodies) {
    const code = b.row[1];
    if (code !== "p" && !(code === "b" && !(b.row[9] & 2))) continue;
    const ext = Math.max(b.row[6], b.row[7]);
    l = Math.min(l, b.x - ext);
    r = Math.max(r, b.x + ext);
    t = Math.min(t, b.y - ext);
  }
  if (!Number.isFinite(l)) return { l: level.cowX - 900, r: level.cowX + 170, t: level.groundY - 380 };
  return { l, r: Math.max(r, level.cowX + 150), t: Math.min(t, level.groundY - 340) };
}

/** A box grown to take in anything still flying (bombs, debris in a tornado). */
export function withMovers(box, bodies) {
  const out = { ...box };
  for (const b of bodies) {
    if (Math.hypot(b.vx, b.vy) < 80) continue;
    out.l = Math.min(out.l, b.x - 120);
    out.r = Math.max(out.r, b.x + 120);
    out.t = Math.min(out.t, b.y - 120);
  }
  return out;
}

/**
 * The camera ({ x, y, s }: the world point at the screen's centre, and screen pixels per world
 * unit) that shows `box` ({ l, r, t, b }, world units) on a screen `width` × `height` whose top
 * and bottom `insets` are covered by a HUD. Options: `minSpan` (never closer than this many world
 * units across), `maxSpan` (never wider), `fill` (0-1: from showing the whole box toward filling
 * the screen with it, cropping the sides on a screen shaped unlike the box, such as a tall phone),
 * `anchor` ({ x, at }: when the sides are cropped, that world x sits that fraction across), and
 * `wholeHeight` (never crop the box's top: a bird high in the air stays in view). Views always
 * sit on the ground: if anything is cropped top-to-bottom, it's sky.
 */
export function fit(box, { width, height, insets = { top: 0, bottom: 0 }, level, top = -420 }, { minSpan = 0, maxSpan = Infinity, fill = 0, anchor = null, wholeHeight = false } = {}) {
  const inTop = Math.min(insets.top, height * 0.3);
  const inBottom = Math.min(insets.bottom, height * 0.3);
  const h = Math.max(40, height - inTop - inBottom);
  const sx = width / Math.max(1, box.r - box.l);
  const sy = h / Math.max(1, box.b - box.t);
  const sFit = Math.min(sx, sy);
  let s = sFit * (Math.max(sx, sy) / sFit) ** fill;
  // A tall screen (a phone held upright) may come in closer: it has the height for the arc.
  const tall = Math.min(1, Math.max(0.8, Math.sqrt(width / height)));
  s = Math.min(s, width / Math.max(1, minSpan * tall));
  s = Math.max(s, width / maxSpan);
  if (wholeHeight) s = Math.min(s, sy);
  const halfW = width / 2 / s;
  const halfH = height / 2 / s;
  let x = (box.l + box.r) / 2;
  if (anchor && halfW * 2 < box.r - box.l) x = anchor.x + halfW * 2 * (0.5 - anchor.at);
  // Sit on the ground: the box's bottom at the bottom of the safe area (the rest is sky).
  let y = box.b + inBottom / s - halfH;
  // Never show past the level's edges, the bottom of the dirt or the top of the sky.
  const minX = -400 + halfW;
  const maxX = level.width + 400 - halfW;
  x = minX > maxX ? level.width / 2 : Math.min(maxX, Math.max(minX, x));
  y = Math.min(y, level.groundY + 150 + inBottom / s - halfH);
  y = Math.max(y, top + halfH);
  return { x, y, s };
}

/**
 * The camera for this moment of the game `g`. `view`: { width, height, insets, mode ("host" |
 * "phone"), camMode ("auto" | "map"), ghost (a building being placed, or null), top }.
 */
export function frameShot(g, bodies, view) {
  const { width, height, mode = "phone", camMode = "auto", ghost = null } = view;
  const L = g.level;
  const at = { ...view, level: L };
  const sling = L.sling;
  const floor = L.groundY + 40;
  const zones = L.zones.flat();
  const left = Math.min(...zones, sling.x - 200) - 20;
  const overview = { l: left, r: L.cowX + 170, t: L.groundY - 560, b: floor };
  const bird = bodies.find((b) => b.row[1] === "B" && !b.leaving && Math.hypot(b.vx, b.vy) > 60) ?? null;
  const flying = g.phase === "ACTION" && g.action?.stage === "FLIGHT";
  // The Red Cow's moment: every screen pans in to watch it grow.
  if (g.phase === "COW") return fit({ l: L.cowX - 260, r: L.cowX + 200, t: L.groundY - 420, b: floor }, at, { minSpan: 480, fill: mode === "phone" ? 0.4 : 0 });
  if (camMode === "map") return fit(overview, at);
  const fort = fortBox(bodies, L);
  const fortView = { l: fort.l - 120, r: fort.r + 60, t: fort.t - 140, b: floor };
  if (mode === "host") {
    // The big screen shows the whole field, leaning in on the fort once a shot gets there.
    if (flying && bird) {
      const near = bird.x > fort.l - 350 && bird.vy > -50;
      const box = near ? { l: Math.min(bird.x - 260, fort.l - 180), r: overview.r, t: Math.min(bird.y - 120, fort.t - 160), b: floor } : { ...overview, t: Math.min(overview.t, bird.y - 90) };
      return fit(box, at, { wholeHeight: true });
    }
    if (flying || g.phase === "PROCESS") return fit(withMovers({ l: fort.l - 220, r: overview.r, t: fort.t - 200, b: floor }, bodies), at);
    return fit(overview, at);
  }
  // A phone: close on what matters to you. An upright screen crops the sides to fill its height;
  // a landscape one mostly shows the whole box.
  const upright = height > width * 0.9;
  const lean = (tallFill, wideFill) => (upright ? tallFill : wideFill);
  const fortMid = { x: (fort.l + fort.r) / 2, at: 0.5 };
  if (g.phase === "BUILD") {
    if (ghost) return fit({ l: ghost.x - 380, r: ghost.x + 380, t: L.groundY - 360, b: floor }, at, { minSpan: 620, fill: lean(0.6, 0.2), anchor: { x: ghost.x, at: 0.5 } });
    return fit({ l: left, r: Math.max(...zones) + 240, t: L.groundY - 380, b: floor }, at, { minSpan: 700, fill: lean(0.6, 0.1), anchor: { x: sling.x, at: 0.5 } });
  }
  if (g.phase === "ACTION") {
    if (flying && bird) {
      // Follow the bird, a little ahead of it; take in the fort as it arrives.
      const lead = Math.max(-120, Math.min(260, bird.vx * 0.22));
      const box = { l: bird.x - 320 + lead, r: bird.x + 520 + lead, t: Math.min(bird.y - 160, L.groundY - 420), b: floor };
      if (bird.x + 700 > fort.l) box.r = Math.max(box.r, Math.min(fort.r + 60, bird.x + 950));
      return fit(box, at, { minSpan: 820, maxSpan: 1700, fill: lean(0.5, 0.3), anchor: { x: bird.x + lead, at: 0.4 }, wholeHeight: true });
    }
    // The shot's landed: watch the fort settle.
    if (flying) return fit(withMovers(fortView, bodies), at, { minSpan: 760, fill: lean(0.5, 0.2), anchor: fortMid });
    // Aiming (yours or a teammate's): the sling a quarter of the way in, and the way to the fort.
    // Steady while you aim: it doesn't follow the pull.
    return fit({ l: sling.x - 230, r: sling.x + 820, t: sling.y - 320, b: floor }, at, { minSpan: 700, fill: lean(0.6, 0.6), anchor: { x: sling.x, at: 0.28 } });
  }
  if (g.phase === "PROCESS") return fit(withMovers(fortView, bodies), at, { minSpan: 760, fill: lean(0.5, 0.2), anchor: fortMid });
  // Choosing birds, launching, the end: a look at what you're up against.
  return fit(fortView, at, { minSpan: 760, fill: lean(0.5, 0.2), anchor: fortMid });
}
