// Angry Thud's Revenge: what the first-time tutorial says (thud-tutorial.js shows it). Words only,
// built from the game's own numbers so they never drift from config: the build timer, and the
// ability of the bird you picked.

import { birdType } from "./thud-birds.js";

/** How you set off a bird's ability, in words, by its trigger. */
export function abilityHow(bird) {
  const trigger = bird?.ability?.trigger;
  if (trigger === "tap") return "In flight, tap the screen (or press A / Space).";
  if (trigger === "hold") return "In flight, hold ◀ ▶ (or the arrow keys) to steer.";
  if (trigger === "launch") return "Nothing to press: it's on from the moment it's launched.";
  return "Each bird's card says how.";
}

/**
 * The tutorial's cards, in order: { id, title, lines }. `buildMs` is the build phase's length;
 * `bird` the gameplay bird id this player picked (for the ability card).
 */
export function tutorialCards({ buildMs = 120_000, bird = null } = {}) {
  const seconds = Math.round(buildMs / 1000);
  const b = birdType(bird);
  return [
    { id: "build", title: "BUILD", lines: ["Spend TEAM KERNELS 🌽 to build.", `Build phase: ${seconds} seconds. Done? Vote skip.`] },
    { id: "pick", title: "PICK A BIRD", lines: ["Pick a bird on your turn.", "One bird per agent per turn."] },
    { id: "aim", title: "AIM & LAUNCH", lines: ["Drag back to aim (or ◀ ▶ ▲ ▼).", "Let go to launch (or A / Space)."] },
    { id: "ability", title: "USE THE ABILITY", lines: [b ? `${b.icon} ${b.name}: ${b.blurb}` : "Each bird has an ability.", abilityHow(b)] },
    { id: "goal", title: "THE GOAL", lines: ["Destroy the piggies: Corruption to 0%.", "Do it before the Red Cow finishes."] },
  ];
}
