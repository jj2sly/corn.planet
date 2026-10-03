// A short group tutorial any party game can run before its first round: a few cards the host screen
// pages through on a timer, which phones show too. The host can page on (Skip ▸) or skip it all;
// it also ends as soon as every agent taps "Got it". Phones that have already seen this game's
// tutorial tap it for you, so in practice it only waits for first-time agents.
//
// The game owns the phase and the timer; this class owns the cards and who is ready.

export interface TutorialStep {
  /** The big question this card answers, e.g. "WHO AM I?". */
  ask: string;
  lines: readonly string[];
  glyph: string;
}

export const TUTORIAL_STEP_MS = 7_000;

export class GroupTutorial {
  readonly steps: readonly TutorialStep[];
  index = 0;
  private readonly ready = new Set<string>();

  constructor(steps: readonly TutorialStep[]) {
    this.steps = steps;
  }

  /** Moves to the next card; false when there are no more. */
  advance(): boolean {
    if (this.index + 1 >= this.steps.length) return false;
    this.index += 1;
    return true;
  }

  markReady(playerId: string): void {
    this.ready.add(playerId);
  }

  allReady(playerIds: readonly string[]): boolean {
    return playerIds.length > 0 && playerIds.every((id) => this.ready.has(id));
  }

  view(playerId: string | null, players: number) {
    return {
      index: this.index,
      total: this.steps.length,
      step: this.steps[this.index],
      steps: this.steps,
      readyCount: this.ready.size,
      players,
      ...(playerId ? { ready: this.ready.has(playerId) } : {}),
    };
  }
}

export const CHANNEL_COB_TUTORIAL: readonly TutorialStep[] = [
  { ask: "WHO AM I?", glyph: "🎙️", lines: ["Everyone gets a broadcast role: Anchor, Field Reporter, CPI Spokesperson…", "Your role is at the top of your phone. Roles rotate every segment."] },
  { ask: "WHAT DO I KNOW?", glyph: "🤫", lines: ["Your phone has private notes. Nobody has the same ones.", "Don't show your phone. The notes disagree on purpose."] },
  { ask: "WHO TALKS NOW?", glyph: "📺", lines: ["The big screen shows who is ON AIR and who is UP NEXT."] },
  { ask: "WHAT DO I DO ON AIR?", glyph: "🗣️", lines: ["Talk out loud. Improvise. No typing.", "Your phone gives a nudge. Tap HAND OFF when you're done."] },
  { ask: "BREAKING NEWS?", glyph: "⚡", lines: ["New info can arrive on your phone only.", "Tap GO LIVE to break it first — or it hits the ticker without you."] },
  { ask: "QUICK CALLS", glyph: "👆", lines: ["Sometimes your phone asks: DENY? CONFIRM? WARN? DOWNPLAY?", "Tap fast. Your call changes what happens next."] },
  { ask: "THE GOAL", glyph: "🏆", lines: ["Keep the broadcast together while chaos hits.", "After each segment: a one-tap fact check and an MVP vote."] },
];

export const BUDGET_CUTS_TUTORIAL: readonly TutorialStep[] = [
  { ask: "WHAT DO WE WANT?", glyph: "🗂️", lines: ["Each department wants funding.", "There are never enough kernels."] },
  { ask: "HOW DO WE SPLIT IT?", glyph: "🗣️", lines: ["Argue out loud. Back a plan on your phone.", "Everyone LOCKS IN, then you vote."] },
  { ask: "WHAT IF WE UNDERFUND?", glyph: "🚨", lines: ["Incidents hit. Underfunded departments fail and get blamed.", "Stability at zero: the CPI collapses."] },
  { ask: "WHAT'S MY SECRET?", glyph: "🤫", lines: ["Your phone has a hidden goal.", "Hit it for big points."] },
];
