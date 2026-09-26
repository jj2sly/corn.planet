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
    {
      id: "build",
      title: "BUILD",
      lines: [
        "The team shares one pile of kernels 🌽. Spend them together.",
        "Build nests (more birds), walls and shields, clone tanks and a weather machine.",
        `The build phase lasts ${seconds} seconds. Done early? Everyone votes to skip.`,
      ],
    },
    {
      id: "aim",
      title: "AIM & LAUNCH",
      lines: ["Drag back on the screen to aim (or ◀ ▶ angle, ▲ ▼ power).", "Let go to launch (or press A / Space).", "Each agent launches one bird per turn."],
    },
    {
      id: "ability",
      title: "BIRD ABILITIES",
      lines: [
        "Every bird has its own special ability.",
        b ? `${b.icon} ${b.name}, ${b.title}: ${b.blurb}` : "Pick a bird to see what it does.",
        abilityHow(b),
      ],
    },
    {
      id: "goal",
      title: "THE TEAM'S GOAL",
      lines: ["Pop Corn Piggies and wreck their fort.", "That lowers the Corruption Meter. Get it to 0%…", "…before the piggies finish building the Red Cow. You win or lose as a team."],
    },
    {
      id: "weather",
      title: "WEATHER",
      lines: ["Wind, rain, fog and lightning can knock your shots off course.", "A Weather Machine forecasts what's coming. Upgrade it to see further."],
    },
    {
      id: "team",
      title: "TEAMWORK",
      lines: ["Kernels are shared: agree what to build.", "Nests hatch new birds. Two agents at one nest can breed an extra one.", "Out of birds? A teammate can donate one of theirs."],
    },
  ];
}
