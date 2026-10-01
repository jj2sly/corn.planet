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
  { ask: "WHAT DOES MY DEPARTMENT NEED?", glyph: "🗂️", lines: ["You run one CPI department.", "Your phone shows its request and what it's good and bad at."] },
  { ask: "HOW MUCH MONEY IS THERE?", glyph: "🌽", lines: ["The group shares one pool of kernels.", "It's never enough for everyone's request."] },
  { ask: "HOW MUCH SHOULD I FIGHT FOR?", glyph: "📊", lines: ["Funding is a tier: Underfunded → Adequate → Well Funded.", "Near your request is Adequate. Much more is wasted."] },
  { ask: "HOW DO WE DECIDE?", glyph: "🗣️", lines: ["Argue it out loud. Make deals.", "Phone: build a plan or back one, then LOCK IN."] },
  { ask: "WHEN DO WE VOTE?", glyph: "🗳️", lines: ["When everyone locks in (or time's up): APPROVE or REJECT the top plan.", "Fail twice and Emergency Allocation decides for you."] },
  { ask: "WHAT IF WE UNDERFUND SOMETHING?", glyph: "🚨", lines: ["Incidents test the departments they need.", "Underfunded = worse odds, blame and damage that sticks."] },
  { ask: "WHAT'S MY SECRET?", glyph: "🤫", lines: ["You have a hidden priority. Only you can see it.", "Hit it for big points."] },
  { ask: "WHY NOT JUST BE SELFISH?", glyph: "🏛️", lines: ["If CPI Stability hits zero, the CPI collapses.", "Everyone loses the group bonus and secrets score half."] },
];
