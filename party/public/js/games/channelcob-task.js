// Channel Cob's phone logic without any DOM (the tests run it in Node): which single task a player
// should be looking at right now, and the short state label beside their role. The phone shows
// exactly one task card; a breaking update or a quick call REPLACES the on-air/listen card instead of
// stacking on top of it.

/** The phase's place in the segment loop, for the little step marker: PREP → LIVE → FACT CHECK → RECAP. */
export const SEGMENT_STEPS = ["PREP", "LIVE", "FACT CHECK", "RECAP"];

export function segmentStep(phase) {
  return phase === "INTRO" || phase === "PREP" ? 0 : phase === "LIVE" ? 1 : phase === "POLL" ? 2 : phase === "RECAP" || phase === "FINALE" ? 3 : -1;
}

/** "ON AIR" | "UP NEXT" | "OFF AIR" | "PREP" for the state chip next to the role. */
export function stateLabel(game) {
  const y = game.you;
  if (game.phase === "LIVE") return y.onAir ? "ON AIR" : y.upNext ? "UP NEXT" : "OFF AIR";
  if (game.phase === "INTRO" || game.phase === "PREP") return "PREP";
  return "OFF AIR";
}

/**
 * The one current task for a player. Kinds: intro, prep, decision, breaking, live, next, listen.
 * Priority while LIVE: an unanswered quick call, then breaking news, then your turn on air, then
 * up next, then just listening.
 */
export function currentTask(game) {
  const y = game.you;
  if (game.phase === "INTRO") return { kind: "intro", title: `YOU ARE THE ${y.roleName.toUpperCase()}`, text: "Read your notes below.", note: game.segment > 1 ? "New role this segment." : "" };
  if (game.phase === "PREP") return { kind: "prep", title: "READ YOUR NOTES", text: "Don't show your phone." };
  if (y.decision && y.decision.chosen === null) return { kind: "decision", title: "QUICK CALL", text: y.decision.question, id: y.decision.id, options: y.decision.options };
  const note = y.decision ? "Call made. Act it out on air." : "";
  if (y.breaking.length) return { kind: "breaking", tag: "BREAKING NEWS", text: y.breaking[0].text, job: "Go live and explain it.", id: y.breaking[0].id, more: y.breaking.length - 1, note };
  if (y.onAir) return { kind: "live", title: "YOU'RE LIVE", text: y.prompt || "Talk!", note };
  if (y.upNext) return { kind: "next", title: "UP NEXT", text: y.prompt || "Get ready.", note };
  return { kind: "listen", title: "LISTEN", text: game.speaker ? `On air: ${game.speaker.roleName}` : "React if you're asked.", note };
}
