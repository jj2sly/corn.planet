// Escape Thad's Steam Deck: draws the world on a canvas, for the host screen, runners' phones and
// Thad's Deck. The server sends a snapshot every tick (20 Hz); this draws one tick behind and
// interpolates between the last two, so movement stays smooth at 60 fps.

import { fitCanvas } from "../drawing-canvas.js";

const INK = {
  bg: "#07080a",
  grid: "rgba(255, 212, 0, 0.05)",
  platform: "#2e333d",
  edge: "#ffd400",
  hazard: "#ff4d4d",
  exit: "#39d353",
  plank: "#c98a4b",
};

/**
 * `rotate` leans the whole world with Thad's tilt (host and Deck); otherwise an arrow shows it.
 * `you` highlights one runner. Call update(game) with every state; destroy() when done.
 */
export function createWorldView(canvas, { rotate = false, you = null, labels = false } = {}) {
  let game = null;
  let prev = null;
  let curr = null;
  let raf = 0;

  const colors = () => new Map([...(game?.roster ?? []).map((r) => [r.id, r.color])]);
  const names = () => new Map([...(game?.roster ?? []).map((r) => [r.id, r.name])]);

  const update = (next) => {
    game = next;
    if (!curr || next.tick !== curr.tick) {
      prev = curr;
      curr = { tick: next.tick, at: performance.now(), runners: new Map(next.world.runners.map((r) => [r[0], r])) };
    }
  };

  const position = (id) => {
    const c = curr?.runners.get(id);
    if (!c) return null;
    const p = prev?.runners.get(id);
    const t = Math.min(1, (performance.now() - curr.at) / (game.tickMs || 50));
    // Teleports (respawn) and state changes snap instead of sliding across the screen.
    if (!p || p[4] !== c[4] || Math.hypot(c[1] - p[1], c[2] - p[2]) > 150) return { x: c[1], y: c[2], facing: c[3], state: c[4] };
    return { x: p[1] + (c[1] - p[1]) * t, y: p[2] + (c[2] - p[2]) * t, facing: c[3], state: c[4] };
  };

  const rect = (ctx, [x, y, w, h]) => ctx.fillRect(x, y, w, h);

  const draw = () => {
    if (!game) return;
    const { width, height, dpr } = fitCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const L = game.level;
    const scale = Math.min(width / L.width, height / L.height);
    const tiltDeg = game.world.tilt * game.world.maxTilt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    // Leaning shrinks the world a little so the corners don't leave the screen.
    if (rotate) ctx.rotate((tiltDeg * Math.PI) / 180);
    const fit = rotate ? 0.86 : 1;
    ctx.scale(scale * fit, scale * fit);
    ctx.translate(-L.width / 2, -L.height / 2);

    ctx.fillStyle = INK.bg;
    ctx.fillRect(0, 0, L.width, L.height);
    ctx.strokeStyle = INK.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= L.width; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, L.height);
    }
    for (let y = 0; y <= L.height; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(L.width, y);
    }
    ctx.stroke();

    // Exit.
    const pulse = game.phase === "FINAL" ? 0.55 + 0.45 * Math.sin(performance.now() / 150) : 1;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = INK.exit;
    rect(ctx, L.exit);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.font = "bold 22px monospace";
    ctx.textAlign = "center";
    ctx.fillText("EXIT", L.exit[0] + L.exit[2] / 2, L.exit[1] + L.exit[3] / 2 + 8);

    // Platforms.
    for (const p of L.platforms) {
      ctx.fillStyle = INK.platform;
      rect(ctx, p);
      ctx.fillStyle = INK.edge;
      ctx.fillRect(p[0], p[1], p[2], 5);
    }

    // Hazards: live ones are spikes, coming ones a dashed warning.
    for (const [x, y, w, h, live] of L.hazards) {
      if (live) {
        ctx.fillStyle = INK.hazard;
        ctx.beginPath();
        const teeth = Math.max(1, Math.round(w / 20));
        for (let i = 0; i < teeth; i++) {
          const tx = x + (i * w) / teeth;
          ctx.moveTo(tx, y + h);
          ctx.lineTo(tx + w / teeth / 2, y);
          ctx.lineTo(tx + w / teeth, y + h);
        }
        ctx.fill();
      } else {
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = "rgba(255, 77, 77, 0.45)";
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    }

    // Planks fade out over their last two seconds.
    for (const [x1, x2, y, , ttl] of game.world.planks) {
      ctx.globalAlpha = Math.min(1, ttl / 2000) * 0.9 + 0.1;
      ctx.fillStyle = INK.plank;
      ctx.fillRect(x1, y, x2 - x1, 10);
      ctx.globalAlpha = 1;
    }

    // Runners.
    const [rw, rh] = game.world.size;
    const color = colors();
    const name = names();
    for (const [id] of game.world.runners) {
      const r = position(id);
      if (!r || r.state === 2) continue;
      ctx.globalAlpha = r.state === 1 ? 0.3 : 1;
      ctx.fillStyle = color.get(id) ?? "#fff";
      ctx.fillRect(r.x, r.y, rw, rh);
      // Eyes look where you're going; X eyes when you're dead.
      ctx.fillStyle = "#000";
      const ex = r.x + (r.facing > 0 ? 15 : 5);
      if (r.state === 1) {
        ctx.font = "bold 12px monospace";
        ctx.fillText("x x", r.x + rw / 2, r.y + 14);
      } else {
        ctx.fillRect(ex, r.y + 8, 4, 6);
        ctx.fillRect(ex + 6, r.y + 8, 4, 6);
      }
      if (id === you) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x - 3, r.y - 3, rw + 6, rh + 6);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(r.x + rw / 2 - 10, r.y - 22);
        ctx.lineTo(r.x + rw / 2 + 10, r.y - 22);
        ctx.lineTo(r.x + rw / 2, r.y - 10);
        ctx.fill();
      }
      if (labels) {
        ctx.fillStyle = color.get(id) ?? "#fff";
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(name.get(id) ?? "", r.x + rw / 2, r.y - 12);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Without rotation, an arrow shows which way the Deck leans.
    if (!rotate && Math.abs(game.world.tilt) > 0.08) {
      const dir = Math.sign(game.world.tilt);
      const strength = Math.min(1, Math.abs(game.world.tilt));
      ctx.fillStyle = `rgba(255, 212, 0, ${0.4 + 0.6 * strength})`;
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.fillText(dir > 0 ? "TILT ➜" : "⬅ TILT", width / 2, 20);
    }
  };

  const frame = () => {
    if (!canvas.isConnected) return (raf = 0);
    draw();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    update,
    destroy: () => cancelAnimationFrame(raf),
  };
}
