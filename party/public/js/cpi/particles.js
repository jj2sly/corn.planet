// CPI particles: small, short-lived effects (dust, sparks, confetti, debris, rings, pop-up text)
// from a fixed pool, so a busy moment can never grow memory or frame time: when the pool is full the
// oldest particle is reused. Drawn in whatever units the canvas is transformed to (a game's world
// units), below or above the characters (`layer`).
//
//   const fx = createParticles({ max: 160 });
//   fx.burst("dust", x, y, 6, { vx: 40 });   // presets below; options override any field
//   fx.update(dt); fx.draw(ctx, "back"); …characters… fx.draw(ctx, "front");

const PRESETS = {
  // Puffs kicked up by feet: grey, slow, growing, fading.
  dust: { life: 0.45, size: 6, grow: 10, speed: 60, spread: Math.PI, angle: -Math.PI / 2, gravity: -20, drag: 3, color: "rgba(214, 206, 190, 0.55)", shape: "circle", layer: "back" },
  // Hot streaks: impacts, hazards arming, metal on metal.
  spark: { life: 0.35, size: 7, grow: -12, speed: 380, spread: Math.PI * 2, gravity: 900, drag: 1, color: "#ffd166", shape: "line", layer: "front" },
  // Celebration.
  confetti: { life: 1.3, size: 5, grow: 0, speed: 420, spread: Math.PI * 0.7, angle: -Math.PI / 2, gravity: 700, drag: 1.4, color: ["#ffd400", "#4dd4ff", "#ff5fa2", "#7dff6a", "#ffffff"], shape: "rect", spin: 12, layer: "front" },
  // Chunks: a plank breaking, a hard landing on metal.
  debris: { life: 0.8, size: 4, grow: 0, speed: 260, spread: Math.PI, angle: -Math.PI / 2, gravity: 1400, drag: 0.5, color: "#8b5a2b", shape: "rect", spin: 16, layer: "front" },
  // An expanding outline: spawns, placements, shockwaves.
  ring: { life: 0.45, size: 8, grow: 110, speed: 0, gravity: 0, drag: 0, color: "rgba(255, 255, 255, 0.8)", shape: "ring", layer: "front" },
  // Floating words: "+100", "SPLAT".
  text: { life: 1, size: 26, grow: 0, speed: 70, spread: 0, angle: -Math.PI / 2, gravity: -10, drag: 1.5, color: "#ffffff", shape: "text", layer: "front" },
  // Slow drifting specks in the air (ambient).
  mote: { life: 4, size: 2.5, grow: 0, speed: 12, spread: Math.PI * 2, gravity: -4, drag: 0, color: "rgba(255, 236, 170, 0.35)", shape: "circle", layer: "back" },
  // Rolling smoke after a blast: dark, rising, growing, slow to fade.
  smoke: { life: 1.6, size: 14, grow: 26, speed: 70, spread: Math.PI * 2, gravity: -60, drag: 1.6, color: ["rgba(60, 56, 54, 0.5)", "rgba(90, 84, 80, 0.42)", "rgba(40, 38, 40, 0.5)"], shape: "puff", layer: "back" },
  // Glowing bits thrown out of a fire, falling.
  ember: { life: 0.9, size: 2.6, grow: -1.5, speed: 320, spread: Math.PI * 2, gravity: 500, drag: 0.8, color: ["#ffd166", "#ff9a3d", "#ff5a1f"], shape: "glow", layer: "front" },
  // Sharp broken pieces (glass, ice): spinning triangles.
  shard: { life: 0.9, size: 7, grow: 0, speed: 300, spread: Math.PI * 1.4, angle: -Math.PI / 2, gravity: 1300, drag: 0.4, color: ["rgba(220, 245, 255, 0.95)", "rgba(160, 215, 245, 0.85)", "#ffffff"], shape: "shard", spin: 18, layer: "front" },
  // A soft flash of light: a blast's fireball, a spark's bloom.
  glow: { life: 0.35, size: 40, grow: 160, speed: 0, gravity: 0, drag: 0, color: "#ffc45a", shape: "glow", layer: "front" },
};

export const PARTICLE_KINDS = Object.freeze(Object.keys(PRESETS));

/** Seeded or not: effects never affect a game, so Math.random is fine by default. */
export function createParticles({ max = 160, random = Math.random } = {}) {
  const pool = Array.from({ length: max }, () => ({ alive: false }));
  let next = 0;
  let live = 0;

  const spawn = (kind, x, y, opts = {}) => {
    const preset = PRESETS[kind];
    if (!preset) return null;
    const cfg = { ...preset, ...opts };
    const p = pool[next];
    next = (next + 1) % max;
    if (!p.alive) live += 1;
    const angle = (cfg.angle ?? 0) + (random() - 0.5) * (cfg.spread ?? 0);
    const speed = cfg.speed * (0.55 + random() * 0.45);
    const color = Array.isArray(cfg.color) ? cfg.color[Math.floor(random() * cfg.color.length)] : cfg.color;
    Object.assign(p, {
      alive: true,
      kind,
      x,
      y,
      vx: Math.cos(angle) * speed + (cfg.vx ?? 0),
      vy: Math.sin(angle) * speed + (cfg.vy ?? 0),
      age: 0,
      life: cfg.life * (0.8 + random() * 0.4),
      size: cfg.size * (0.75 + random() * 0.5),
      grow: cfg.grow,
      gravity: cfg.gravity,
      drag: cfg.drag,
      color,
      shape: cfg.shape,
      rot: random() * Math.PI * 2,
      spin: (cfg.spin ?? 0) * (random() - 0.5) * 2,
      layer: cfg.layer,
      text: cfg.text ?? "",
      font: cfg.font ?? "700 1px sans-serif",
    });
    return p;
  };

  return {
    /** One particle. Options override the preset (vx/vy add to its random velocity). */
    emit: spawn,
    /** `count` particles at once. */
    burst(kind, x, y, count, opts) {
      for (let i = 0; i < count; i++) spawn(kind, x, y, opts);
    },
    update(dt) {
      if (!live) return;
      const step = Math.min(0.1, Math.max(0, dt));
      for (const p of pool) {
        if (!p.alive) continue;
        p.age += step;
        if (p.age >= p.life) {
          p.alive = false;
          live -= 1;
          continue;
        }
        const drag = Math.max(0, 1 - p.drag * step);
        p.vx *= drag;
        p.vy = p.vy * drag + p.gravity * step;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.size = Math.max(0.1, p.size + p.grow * step);
        p.rot += p.spin * step;
      }
    },
    draw(ctx, layer = "front") {
      if (!live) return;
      ctx.save();
      for (const p of pool) {
        if (!p.alive || p.layer !== layer) continue;
        const fade = 1 - p.age / p.life;
        ctx.globalAlpha = p.shape === "text" ? Math.min(1, fade * 2) : fade;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        switch (p.shape) {
          case "circle":
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            break;
          case "rect":
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            ctx.restore();
            break;
          case "line": {
            const len = Math.hypot(p.vx, p.vy) || 1;
            ctx.lineWidth = Math.max(0.5, p.size * 0.35);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - (p.vx / len) * p.size * 2, p.y - (p.vy / len) * p.size * 2);
            ctx.stroke();
            break;
          }
          case "ring":
            ctx.lineWidth = 3 * fade + 0.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.stroke();
            break;
          case "puff": {
            // A soft cloud: a radial fade, so overlapping puffs build up like smoke.
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
            g.addColorStop(0, p.color);
            g.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case "glow": {
            // Light adds up: drawn "lighter", a bright core fading out.
            const prev = ctx.globalCompositeOperation;
            ctx.globalCompositeOperation = "lighter";
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
            g.addColorStop(0, "rgba(255, 255, 255, 0.9)");
            g.addColorStop(0.25, p.color);
            g.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = prev;
            break;
          }
          case "shard":
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.beginPath();
            ctx.moveTo(0, -p.size / 2);
            ctx.lineTo(p.size * 0.35, p.size / 2);
            ctx.lineTo(-p.size * 0.3, p.size * 0.3);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            break;
          case "text":
            ctx.font = p.font.replace("1px", `${Math.round(p.size)}px`);
            ctx.textAlign = "center";
            ctx.lineWidth = Math.max(2, p.size / 6);
            ctx.strokeStyle = "rgba(0,0,0,0.75)";
            ctx.strokeText(p.text, p.x, p.y);
            ctx.fillText(p.text, p.x, p.y);
            break;
        }
      }
      ctx.restore();
    },
    /** Live particles right now. */
    get count() {
      return live;
    },
    get max() {
      return max;
    },
    clear() {
      for (const p of pool) p.alive = false;
      live = 0;
    },
  };
}
