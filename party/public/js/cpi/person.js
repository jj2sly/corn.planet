// CPI characters, person style: a real-looking (well, cartoon) human instead of a helmeted agent.
// Used by cpi/character.js when a character has a `person` look. Everything is data, so a new cast
// member is a new look, not new drawing code:
//
//   { skin, hair: { style, color }, glasses: "rect" | "round", beard, hat: "cap" | "bicorne",
//     top: { style, color, … }, legs, extras: ["lanyard", "ribbon", "necklace", "ballchain"],
//     prop: "chips" | "icecream" | "headgear", smile }
//
// Same units and pose joints as the agents: facing right, feet at (0, 0), about 36 tall.

const TAU = Math.PI * 2;
const INK = "#0c0d12";

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function paint(ctx, fill, line = INK, width = 1.3) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function darker(hex, k = 0.3) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function limb(ctx, px, py, angle, length, width, fill, end, line) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-angle);
  rr(ctx, -width / 2, -width / 2, width, length + width / 2, width / 2);
  paint(ctx, fill, line);
  if (end) {
    rr(ctx, -width / 2, length - 2, width, 2 + width / 2, width / 2);
    paint(ctx, end, null);
  }
  ctx.restore();
}

/** A bumpy blob: curly hair. */
function curls(ctx, cx, cy, rx, ry, bumps, color, line) {
  ctx.beginPath();
  for (let i = 0; i <= bumps; i++) {
    const a = (i / bumps) * TAU;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else {
      const m = ((i - 0.5) / bumps) * TAU;
      ctx.quadraticCurveTo(cx + Math.cos(m) * rx * 1.18, cy + Math.sin(m) * ry * 1.18, x, y);
    }
  }
  ctx.closePath();
  paint(ctx, color, line, 1.1);
}

// ------------------------------------------------------------------ parts

function hairBack(ctx, hair, line) {
  const c = hair.color;
  if (hair.style === "curly") curls(ctx, 0, -27, 13, 11.5, 11, c, line);
  else if (hair.style === "bigcurly") curls(ctx, -0.5, -25, 15, 14, 13, c, line);
  else if (hair.style === "shaggy") {
    rr(ctx, -10.5, -36, 20, 17, 7);
    paint(ctx, c, line);
  } else if (hair.style === "tied") {
    // Pulled back: a bun behind.
    ctx.beginPath();
    ctx.arc(-9.5, -27, 3.6, 0, TAU);
    paint(ctx, c, line, 1.1);
  }
}

function hairFront(ctx, hair, line) {
  const c = hair.color;
  ctx.save();
  switch (hair.style) {
    case "shaggy":
      // Heavy fringe down to the eyebrows.
      ctx.beginPath();
      ctx.moveTo(-9.5, -24);
      ctx.quadraticCurveTo(-9, -37, 2, -36.5);
      ctx.quadraticCurveTo(11.5, -35, 11, -26);
      ctx.lineTo(9, -28.5);
      ctx.lineTo(7, -26.5);
      ctx.lineTo(4.5, -29);
      ctx.lineTo(2, -27);
      ctx.lineTo(-1, -29.5);
      ctx.lineTo(-4, -27);
      ctx.closePath();
      paint(ctx, c, line, 1.1);
      break;
    case "tied":
      ctx.beginPath();
      ctx.moveTo(-9.5, -24);
      ctx.quadraticCurveTo(-9, -36.5, 2, -36);
      ctx.quadraticCurveTo(10.5, -35, 10.5, -28);
      ctx.quadraticCurveTo(4, -33, -3, -30);
      ctx.closePath();
      paint(ctx, c, line, 1.1);
      break;
    case "curly":
      curls(ctx, 1, -33, 10.5, 5, 9, c, line);
      ctx.beginPath();
      ctx.arc(8.5, -28, 3, 0, TAU);
      paint(ctx, c, null);
      break;
    case "bigcurly":
      curls(ctx, 1.5, -33, 12.5, 6, 10, c, line);
      ctx.beginPath();
      ctx.arc(9.5, -27, 3.2, 0, TAU);
      ctx.arc(3, -29.5, 2.6, 0, TAU);
      paint(ctx, c, null);
      break;
    case "buzz":
      ctx.beginPath();
      ctx.arc(1, -26.5, 9.8, Math.PI * 1.05, Math.PI * 1.95);
      ctx.quadraticCurveTo(4, -33, -8.5, -29);
      paint(ctx, c, line, 1);
      break;
    case "messy":
      // Wild, spiky, going everywhere.
      ctx.beginPath();
      ctx.moveTo(-10, -25);
      const spikes = [[-11, -34], [-6, -33], [-5, -40], [-1, -35], [2, -41], [4, -35], [9, -39], [8.5, -33], [13, -33], [10.5, -28]];
      for (const [x, y] of spikes) ctx.lineTo(x, y);
      ctx.lineTo(6, -30);
      ctx.lineTo(2, -29);
      ctx.lineTo(-2, -30.5);
      ctx.closePath();
      paint(ctx, c, line, 1);
      break;
    default:
      // Short.
      ctx.beginPath();
      ctx.moveTo(-9.5, -25);
      ctx.quadraticCurveTo(-9.5, -37, 2, -36.5);
      ctx.quadraticCurveTo(11, -35.5, 10.5, -29);
      ctx.quadraticCurveTo(4, -32, -2, -30.5);
      ctx.quadraticCurveTo(-6, -29, -7, -24);
      ctx.closePath();
      paint(ctx, c, line, 1.1);
  }
  ctx.restore();
}

function face(ctx, look, eyes, blink, line) {
  // Head.
  ctx.beginPath();
  ctx.ellipse(1, -26, 9.5, 10, 0, 0, TAU);
  paint(ctx, look.skin, line);
  // Ear, cheek.
  ctx.beginPath();
  ctx.ellipse(-6.5, -25, 2, 2.6, 0, 0, TAU);
  paint(ctx, look.skin, line, 1);
  ctx.fillStyle = "rgba(230, 110, 100, 0.25)";
  ctx.beginPath();
  ctx.arc(7, -22.5, 2, 0, TAU);
  ctx.fill();
  if (look.beard) {
    ctx.beginPath();
    ctx.moveTo(-4, -22);
    ctx.quadraticCurveTo(-3, -15.5, 4, -16);
    ctx.quadraticCurveTo(10, -16.5, 10, -21.5);
    ctx.quadraticCurveTo(6, -19, 2, -20);
    ctx.closePath();
    paint(ctx, look.beard, null);
  }
  eyes(ctx, "#2a1c14", blink);
  // Mouth.
  ctx.strokeStyle = "#7a3a2e";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (look.smile) ctx.arc(6, -21.5, 2.2, 0.15, Math.PI - 0.15);
  else {
    ctx.moveTo(4.5, -20.3);
    ctx.lineTo(8, -20.5);
  }
  ctx.stroke();
  if (look.glasses === "rect") {
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 1.2;
    for (const x of [3.2, 7.8]) {
      rr(ctx, x - 2.4, -28, 4.8, 3.8, 0.8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-6, -26);
    ctx.lineTo(0.8, -26.5);
    ctx.stroke();
  } else if (look.glasses === "round") {
    ctx.strokeStyle = "#8a8f98";
    ctx.lineWidth = 1.1;
    for (const x of [3.2, 7.8]) {
      ctx.beginPath();
      ctx.arc(x, -26, 2.5, 0, TAU);
      ctx.stroke();
    }
  }
}

function hat(ctx, kind, line) {
  if (kind === "cap") {
    ctx.beginPath();
    ctx.arc(1, -32, 9.5, Math.PI, 0);
    ctx.closePath();
    paint(ctx, "#3a3c42", line);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(-2, -38, 5, 2.5);
    rr(ctx, 5, -33.5, 10, 2.8, 1.3);
    paint(ctx, "#2a2b30", line, 1);
  } else if (kind === "bicorne") {
    // Napoleon's hat, worn sideways: a big dark crescent.
    ctx.beginPath();
    ctx.moveTo(-15, -30);
    ctx.quadraticCurveTo(-8, -50, 1, -47);
    ctx.quadraticCurveTo(10, -50, 17, -30);
    ctx.quadraticCurveTo(1, -35, -15, -30);
    ctx.closePath();
    paint(ctx, "#3a2a20", line);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -33);
    ctx.quadraticCurveTo(1, -37, 12, -33);
    ctx.stroke();
  }
}

function torso(ctx, top, line) {
  const color = top.color;
  if (top.style === "singlet") {
    // Arms and shoulders bare; the singlet is a vest in the colour with trim.
    rr(ctx, -8, -18.5, 16, 13.5, 4);
    paint(ctx, top.skin ?? "#f0c0a0", line);
    ctx.beginPath();
    ctx.moveTo(-6.5, -18.5);
    ctx.lineTo(-3.5, -18.5);
    ctx.quadraticCurveTo(1, -12, 5.5, -18.5);
    ctx.lineTo(7.5, -18.5);
    ctx.lineTo(8, -5);
    ctx.lineTo(-8, -5);
    ctx.closePath();
    paint(ctx, color, line, 1.1);
    ctx.strokeStyle = top.trim ?? "#fff";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-3.5, -18);
    ctx.quadraticCurveTo(1, -11.8, 5.5, -18);
    ctx.stroke();
    if (top.letter) {
      ctx.fillStyle = "#f2c230";
      ctx.font = "700 6px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(top.letter, 1, -7.5);
    }
    return;
  }
  rr(ctx, -8, -18.5, 16, 13.5, 4);
  paint(ctx, color, line);
  ctx.save();
  rr(ctx, -8, -18.5, 16, 13.5, 4);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(-8, -18.5, 16, 2);
  switch (top.style) {
    case "sweater":
      if (top.logo) {
        ctx.fillStyle = "#9aa0a8";
        ctx.font = "700 6.5px serif";
        ctx.textAlign = "center";
        ctx.fillText("cK", 1.5, -9.5);
      }
      break;
    case "quarterzip":
      ctx.fillStyle = top.under ?? "#e8b21c";
      ctx.beginPath();
      ctx.moveTo(-2, -18.5);
      ctx.lineTo(5, -18.5);
      ctx.lineTo(1.5, -14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#c9ccd2";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(1.5, -14);
      ctx.lineTo(1.5, -8);
      ctx.stroke();
      if (top.patch === "tiger") {
        ctx.fillStyle = "#8a1c2a";
        ctx.fillRect(-6, -16, 3, 3);
        ctx.fillStyle = "#f2b01c";
        ctx.fillRect(-5.2, -15.2, 1.4, 1.4);
      }
      break;
    case "hoodie":
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(0, -12);
      ctx.moveTo(3.5, -18);
      ctx.lineTo(3.5, -12.5);
      ctx.stroke();
      if (top.print === "flower") {
        ctx.fillStyle = "#b02a30";
        for (const [x, y] of [[4, -11], [5.5, -9.5], [3, -9]]) {
          ctx.beginPath();
          ctx.arc(x, y, 1.3, 0, TAU);
          ctx.fill();
        }
      }
      break;
    case "tee":
      if (top.print === "sublime") {
        ctx.fillStyle = "#9aa0a8";
        ctx.font = "italic 700 5px serif";
        ctx.textAlign = "center";
        ctx.fillText("Sublime", 1, -9);
      } else if (top.print === "maroon") {
        ctx.fillStyle = "#8a1c2a";
        ctx.fillRect(-2, -13, 8, 4);
        ctx.fillStyle = "#e8b21c";
        ctx.fillRect(-1, -12, 6, 1);
      }
      break;
    case "coat":
      // Napoleon: a white plastron and gold buttons down the front.
      ctx.fillStyle = top.front ?? "#f2f0e8";
      ctx.fillRect(-1, -18.5, 8, 13);
      ctx.fillStyle = top.buttons ?? "#d4a93a";
      for (const y of [-16.5, -13.5, -10.5, -7.5]) {
        ctx.beginPath();
        ctx.arc(5.5, y, 0.9, 0, TAU);
        ctx.fill();
      }
      break;
  }
  ctx.restore();
  if (top.style === "hoodie") {
    // The hood, bunched behind the neck.
    ctx.beginPath();
    ctx.ellipse(-4.5, -18.5, 5, 2.6, 0, 0, TAU);
    paint(ctx, color, line, 1);
  }
}

function extrasOnTorso(ctx, extras, line) {
  if (extras.includes("lanyard")) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3, -18.5);
    ctx.lineTo(2, -9);
    ctx.lineTo(6, -18.5);
    ctx.stroke();
  }
  if (extras.includes("ribbon")) {
    ctx.strokeStyle = "#9fd8f0";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-5, -9.5);
    ctx.lineTo(-3.5, -14);
    ctx.lineTo(-2, -9.5);
    ctx.stroke();
  }
  if (extras.includes("necklace")) {
    ctx.strokeStyle = "#cfd3d8";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-3, -18.5);
    ctx.quadraticCurveTo(1.5, -13, 6, -18.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(1.5, -13.2, 1.5, 0, TAU);
    ctx.stroke();
  }
}

/** A ball and chain, from the back ankle to an iron ball dragging behind. */
function ballAndChain(ctx, legAngle, speed, t, line) {
  const ax = -3 + Math.sin(legAngle) * 6;
  const ay = -1;
  const drag = Math.min(1, speed / 200);
  const bx = -16 - drag * 3;
  const by = -3.5 + Math.abs(Math.sin(t * 9)) * drag * 1.2;
  ctx.strokeStyle = "#8b9097";
  ctx.lineWidth = 1.1;
  ctx.setLineDash?.([1.4, 1]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + bx) / 2, 0.5, bx + 3, by);
  ctx.stroke();
  ctx.setLineDash?.([]);
  ctx.beginPath();
  ctx.arc(bx, by, 3.6, 0, TAU);
  paint(ctx, "#2b2d33", line, 1.1);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.arc(bx - 1.2, by - 1.2, 1, 0, TAU);
  ctx.fill();
}

function prop(ctx, kind, line) {
  // Held in front, at the waist.
  if (kind === "chips") {
    rr(ctx, 4, -15, 8, 10, 1.5);
    paint(ctx, "#d8322c", line, 1);
    ctx.fillStyle = "#f5a623";
    ctx.fillRect(5.5, -10, 5, 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(6, -13.5, 4, 1);
  } else if (kind === "icecream") {
    rr(ctx, 4.5, -14, 8, 8, 1.5);
    paint(ctx, "#c8262c", line, 1);
    ctx.fillStyle = "#6b4028";
    ctx.beginPath();
    ctx.ellipse(8.5, -14, 4, 1.5, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(9.5, -14);
    ctx.lineTo(12, -18);
    ctx.stroke();
  } else if (kind === "headgear") {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(8.5, -9, 3.6, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#d8322c";
    ctx.beginPath();
    ctx.arc(8.5, -9, 2, 0, TAU);
    ctx.fill();
  }
}

/**
 * Draws a person in the pose `j` (from character.js's jointsFor). `eyes(ctx, color, blink)` draws the
 * expression; `ghost` draws a tail instead of legs.
 */
export function drawPerson(ctx, look, j, { eyes, blink, clock, speed, line }) {
  const top = { ...look.top, skin: look.skin };
  const sleeve = top.style === "singlet" ? look.skin : top.color;
  const legs = look.legs ?? "#2e3440";
  const extras = look.extras ?? [];
  if (look.hair) hairBack(ctx, look.hair, line);
  if (extras.includes("ballchain") && !j.ghost) ballAndChain(ctx, j.backLeg, speed, clock, line);
  limb(ctx, -3.5, -16, j.backArm, 8, 4, darker(sleeve, 0.25), look.skin, line);
  if (j.ghost) {
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    for (let i = 0; i <= 4; i++) ctx.lineTo(-8 + i * 4, -2 + (i % 2 ? -2 : 1) + Math.sin(clock * 6 + i) * 0.8);
    ctx.lineTo(8, -8);
    ctx.closePath();
    paint(ctx, darker(top.color, 0.2), line, 1.1);
  } else {
    limb(ctx, -3, -7, j.backLeg, j.legLength, 5, darker(legs, 0.25), "#1c1d22", line);
    limb(ctx, 3, -7, j.frontLeg, j.legLength, 5, legs, "#1c1d22", line);
  }
  torso(ctx, top, line);
  extrasOnTorso(ctx, extras, line);
  face(ctx, look, eyes, blink, line);
  if (look.hair && !(look.hat === "cap" && look.hair.style === "short")) hairFront(ctx, look.hair, line);
  if (look.hat) hat(ctx, look.hat, line);
  if (look.prop && !j.item && !j.ghost) prop(ctx, look.prop, line);
  limb(ctx, 4, -16, j.frontArm, 8, 4, sleeve, look.skin, line);
  if (top.style === "coat" && top.cuff) {
    // Napoleon's red cuff on the front arm.
    ctx.save();
    ctx.translate(4, -16);
    ctx.rotate(-j.frontArm);
    ctx.fillStyle = top.cuff;
    ctx.fillRect(-2, 4, 4, 2.5);
    ctx.restore();
  }
}
