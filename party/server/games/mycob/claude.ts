// A Claude-backed Incident Director. Turned on with MYCOB_DIRECTOR=claude (see config.ts).
//
// Claude gets the whole hidden incident and every agent's own words for the stage, and answers in
// a fixed JSON schema (structured outputs). Its answer is untrusted like any director's: the game
// runs it through validateDirectorOutput(), which clamps it to the engine's rolls, and falls back
// to the built-in director if this call fails, refuses, or takes longer than the processing window.

import Anthropic from "@anthropic-ai/sdk";
import { PERSONNEL_STATUSES } from "./incident.ts";
import { SYSTEM_IDS } from "./content.ts";
import type { DirectorContext, IncidentDirector } from "./director.ts";

export const CLAUDE_DIRECTOR_MODEL = "claude-opus-5";
/** One stage's call. The game's processing window must be a little longer than this. */
export const CLAUDE_DIRECTOR_TIMEOUT_MS = 20_000;

const STATS = ["containment", "facility", "personnel", "resources", "information", "time"];
const string = { type: "string" };
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const list = (properties: Record<string, unknown>) => ({ type: "array", items: object(properties) });

/** The answer Claude must give. Every object is closed and every field required (arrays may be empty). */
export const DIRECTOR_SCHEMA = object({
  narration: string,
  actionInterpretations: list({
    actionId: string,
    summary: string,
    usesRole: { type: "boolean" },
    novelty: { type: "string", enum: ["standard", "inventive", "wild"] },
    intent: { type: "string", enum: ["none", "terminate"] },
  }),
  primaryEffects: list({ actionId: string, stat: { type: "string", enum: STATS }, delta: { type: "integer" } }),
  secondaryEffects: list({ actionId: nullableString, stat: { type: "string", enum: STATS }, delta: { type: "integer" } }),
  chaosEffects: list({ actionId: nullableString, delta: { type: "integer" } }),
  personnelEffects: list({ npcId: string, status: { type: "string", enum: [...PERSONNEL_STATUSES] } }),
  facilityEffects: list({ system: { type: "string", enum: [...SYSTEM_IDS] }, condition: { type: "string", enum: ["nominal", "degraded", "offline"] } }),
  lifeEvents: list({ playerId: string, reason: string }),
  newInformation: list({ factId: nullableString, label: nullableString, text: nullableString }),
  revealEntity: { type: "boolean" },
  newObjectives: list({ text: string }),
  objectiveUpdates: list({ objectiveId: string, status: { type: "string", enum: ["completed", "failed", "impossible"] } }),
  specialEventText: nullableString,
  threatLocation: string,
});

const SYSTEM_PROMPT = `You are the Incident Director for "My Cob Escaped, What Do I Do Now???", a party game played on phones at a Corn Planet Institution containment facility. You run the world and the story; a game engine runs the rules.

Each request is one stage of an incident. You get the full hidden state as JSON, including things the players don't know yet, and each agent's response for this stage: a response type, their own words, an approach (careful, standard or reckless), and whether they put themselves in harm's way. The engine has already rolled every action's outcome (critical, success, partial, failure, catastrophe). Narrate that outcome and never change it: a brilliant plan can still fail and a terrible one can still work, so find the reason.

You decide:
- What each action meant (summary), whether it genuinely used the agent's role (usesRole), and how inventive it was (novelty; "wild" is rare).
- Which stats each action moved: primaryEffects within that action's primaryRange; secondaryEffects for smaller side effects in either direction. Chaos only moves through chaosEffects.
- Consequences for staff and facility systems, discoveries, new problems, and how the actions interacted.
- The narration: 3 to 5 short sentences, under 600 characters, that tie everything into one story. It is read aloud on a TV in about 20 seconds, next to a card per action, so pick the best moments rather than retelling every action.

Rules:
- Take every action seriously enough to interpret it. Impossible or ridiculous actions get a creative reading, not a flat refusal, and the narrator may react to how absurd they are.
- Conflicting actions both happen. The interactions list says which ones collided and who came off worse or accidentally better.
- Refer to agents by name. Nobody's gender is known: use their name or "they", never "he" or "she", for agents and staff alike. Paraphrase what agents did; never quote their words.
- Never mention numbers, stats, rolls or probabilities.
- Players only know facts whose visibility is "known". Mention a discoverable fact only if you reveal it this stage in newInformation by its factId. While the entity's identityKnown is false, never name it or give its id; call it "the entity", unless you set revealEntity (allowed only when limits.identityRevealAllowed is true).
- lifeEvents: one short, specific reason for each agent with lifeAtRisk true or listed in hazards, and nobody else.
- intent "terminate" only for an action that really tries to kill or destroy the entity. It succeeds only when that action's terminationPossible is true; narrate it either way.
- Staff and facility changes need a cause in this stage. Staff only die after a catastrophe.
- New game-only facts (newInformation with label and text, factId null) and new objectives must be small and plausible. At most one new objective.
- You never award points or pick winners.
- Match the tone field (calm, tense or unhinged). Deadpan, silly, with Corn Planet flavor (corn, paperwork, the Records Division). Keep it PG-13.
- Summaries under 180 characters. Use empty arrays when nothing applies. If there is a special event, work it into the narration, and set specialEventText to a one-line banner for it (under 90 characters, without the event's name); otherwise null. threatLocation is "unchanged", "unknown", or a location id.`;

/** Only what the director needs, without links and bookkeeping, to keep each call small. */
function compact(ctx: DirectorContext) {
  const { fields: _fields, url: _url, ...entity } = ctx.incident.entity;
  return {
    ...ctx,
    incident: {
      ...ctx.incident,
      entity,
      personnel: ctx.incident.personnel.map(({ url: _u, ...p }) => p),
      facts: ctx.incident.facts.map(({ source: _s, revealedStage: _r, ...f }) => f),
    },
  };
}

/** Claude's answer, reshaped into the field names validateDirectorOutput() reads. */
export function toDirectorOutput(answer: Record<string, unknown>): Record<string, unknown> {
  const { specialEventText, threatLocation, ...rest } = answer;
  return {
    ...rest,
    specialEvents: typeof specialEventText === "string" && specialEventText ? [{ text: specialEventText }] : [],
    ...(threatLocation === "unknown" ? { threatLocation: null } : threatLocation && threatLocation !== "unchanged" ? { threatLocation } : {}),
  };
}

export class ClaudeIncidentDirector implements IncidentDirector {
  readonly id = CLAUDE_DIRECTOR_MODEL;
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  /** Credentials come from the environment (ANTHROPIC_API_KEY) unless a client is given. */
  constructor(options: { client?: Anthropic; timeoutMs?: number } = {}) {
    this.client = options.client ?? new Anthropic();
    this.timeoutMs = options.timeoutMs ?? CLAUDE_DIRECTOR_TIMEOUT_MS;
  }

  async resolveStage(context: DirectorContext): Promise<unknown> {
    const response = await this.client.beta.messages.create(
      {
        model: CLAUDE_DIRECTOR_MODEL,
        max_tokens: 16000,
        // A declined request is re-run on Anthropic's recommended fallback model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Low effort keeps a stage inside the processing window; the schema keeps the answer usable.
        output_config: { effort: "low", format: { type: "json_schema", schema: DIRECTOR_SCHEMA } },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Stage ${context.stage} of ${context.totalStages}.\n${JSON.stringify(compact(context))}` }],
      },
      // No retries: a retry can't finish inside the window, and the built-in director takes over.
      { timeout: this.timeoutMs, maxRetries: 0 },
    );

    if (response.stop_reason === "refusal") throw new Error(`declined (${response.stop_details?.category ?? "no category"})`);
    if (response.stop_reason === "max_tokens") throw new Error("ran out of tokens before finishing");
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error("no answer in the response");
    return toDirectorOutput(JSON.parse(text.text) as Record<string, unknown>);
  }
}
