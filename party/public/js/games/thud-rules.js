// Angry Thud's Revenge: rules both sides use, so a phone's preview is exactly what the server
// accepts. Placement (the server's word is final: it checks against the real world) and the
// aiming arc (a preview only: the real flight is the server's physics).

/**
 * Can a building of size w×h go at x? It snaps to 5 units, must sit wholly inside a build zone on
 * the ground, and `clear(cx, cy, w, h)` must say nothing is in the way.
 */
export function placement({ x, w, h }, { zones, groundY, clear }) {
  const at = Math.round(x / 5) * 5;
  const inZone = zones.some(([a, b]) => at - w / 2 >= a && at + w / 2 <= b);
  if (!inZone) return { ok: false, x: at, reason: "Build inside the marked zones, on your side." };
  if (!clear(at, groundY - h / 2, w, h)) return { ok: false, x: at, reason: "Something's in the way there." };
  return { ok: true, x: at, reason: "" };
}

/** Axis-aligned overlap test against body rows ([id, kind, sub, x, y, angle, hw, hh, …]). */
export function clearOf(rows) {
  return (cx, cy, w, h) =>
    !rows.some((r) => {
      const hw = r[6];
      const hh = r[7];
      const a = Math.abs((r[5] ?? 0) / 1000);
      // A rotated box's bounds, roughly.
      const ex = hw * Math.cos(a) + hh * Math.sin(a);
      const ey = hw * Math.sin(a) + hh * Math.cos(a);
      return r[3] - ex < cx + w / 2 - 1 && r[3] + ex > cx - w / 2 + 1 && r[4] - ey < cy + h / 2 - 1 && r[4] + ey > cy - h / 2 + 1;
    });
}

/**
 * The first part of a launch's arc, for aiming: `sling` { x, y, maxSpeed, gravity }, angle in
 * degrees above the horizon, power 0..1. Returns [x, y] points every `dt` seconds for `seconds`.
 * No wind: the weather is yours to judge.
 */
export function arc(sling, angle, power, { seconds = 0.9, dt = 0.05 } = {}) {
  const v = sling.maxSpeed * power;
  const rad = (angle * Math.PI) / 180;
  const vx = Math.cos(rad) * v;
  const vy = -Math.sin(rad) * v;
  const out = [];
  for (let t = dt; t <= seconds + 1e-9; t += dt) out.push([sling.x + vx * t, sling.y + vy * t + 0.5 * sling.gravity * t * t]);
  return out;
}

/** Angle and power from a pull-back drag (the pouch pulled from the sling toward dx, dy). */
export function aimFromPull(dx, dy, { maxPull = 160, minAngle = -35, maxAngle = 80, minPower = 0.15 } = {}) {
  const len = Math.hypot(dx, dy);
  const power = Math.max(minPower, Math.min(1, len / maxPull));
  // You pull back and down to shoot up and forward.
  const angle = Math.max(minAngle, Math.min(maxAngle, (Math.atan2(dy, -dx) * 180) / Math.PI));
  return { angle: Math.round(angle * 10) / 10, power: Math.round(power * 100) / 100 };
}
