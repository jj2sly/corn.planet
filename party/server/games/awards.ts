// Player-created awards: any game can end with a ceremony where agents invent the awards
// ("WHY WOULD YOU DO THAT", "Bro Had a Plan") and then vote on who receives each one.
//
// There is no fixed award list. The ceremony only enforces limits: length, how many each agent
// may create, no duplicate names, one vote per award per agent, and (by default) no voting for
// yourself. Authors stay anonymous in every view. The game owns the phases and timers; this class
// owns the rules.

import { randomBytes } from "node:crypto";
import { PartyError } from "../errors.ts";
import { cleanText } from "../text.ts";

export interface AwardRules {
  nameMax: number;
  descriptionMax: number;
  /** Awards each agent may create. */
  perPlayer: number;
  allowSelfVote: boolean;
}

interface Award {
  id: string;
  authorId: string;
  name: string;
  description: string;
  /** voterId -> recipientId */
  votes: Map<string, string>;
}

export interface AwardResult {
  id: string;
  name: string;
  description: string;
  winners: { playerId: string; name: string; votes: number }[];
  totalVotes: number;
}

/** Case, spacing and punctuation don't make a new award. */
const normalize = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export class AwardCeremony {
  private readonly rules: AwardRules;
  private readonly awards: Award[] = [];

  constructor(rules: AwardRules) {
    this.rules = rules;
  }

  /** Creates an award, or edits one of the author's own when awardId is given. */
  submit(playerId: string, input: { awardId?: unknown; name: unknown; description?: unknown }): void {
    const name = cleanText(input.name, this.rules.nameMax);
    if (!name.ok || normalize(name.value) === "") {
      throw new PartyError("INVALID_INPUT", `Award names are 1–${this.rules.nameMax} characters.`);
    }
    let description = "";
    if (input.description !== undefined && input.description !== null && input.description !== "") {
      const d = cleanText(input.description, this.rules.descriptionMax);
      if (!d.ok && d.reason !== "EMPTY") throw new PartyError("INVALID_INPUT", `Descriptions are up to ${this.rules.descriptionMax} characters.`);
      description = d.ok ? d.value : "";
    }

    const existing = input.awardId !== undefined ? this.awards.find((a) => a.id === input.awardId && a.authorId === playerId) : undefined;
    if (input.awardId !== undefined && !existing) throw new PartyError("NOT_FOUND");
    const key = normalize(name.value);
    if (this.awards.some((a) => a !== existing && normalize(a.name) === key)) throw new PartyError("AWARD_DUPLICATE");

    if (existing) {
      existing.name = name.value;
      existing.description = description;
      return;
    }
    if (this.byAuthor(playerId).length >= this.rules.perPlayer) throw new PartyError("AWARD_LIMIT");
    this.awards.push({ id: randomBytes(6).toString("hex"), authorId: playerId, name: name.value, description, votes: new Map() });
  }

  /** Votes for who receives an award. `eligible` is everyone who may receive one. */
  vote(voterId: string, awardId: unknown, recipientId: unknown, eligible: readonly string[]): void {
    const award = this.awards.find((a) => a.id === awardId);
    if (!award || typeof recipientId !== "string" || !eligible.includes(recipientId)) throw new PartyError("INVALID_VOTE");
    if (!this.rules.allowSelfVote && recipientId === voterId) throw new PartyError("CANNOT_VOTE_OWN", "You can't give an award to yourself.");
    if (award.votes.has(voterId)) throw new PartyError("ALREADY_VOTED");
    award.votes.set(voterId, recipientId);
  }

  byAuthor(playerId: string): { id: string; name: string; description: string }[] {
    return this.awards.filter((a) => a.authorId === playerId).map(({ id, name, description }) => ({ id, name, description }));
  }

  get count(): number {
    return this.awards.length;
  }

  submitters(): Set<string> {
    return new Set(this.awards.map((a) => a.authorId));
  }

  /** Awards as everyone sees them while voting: no authors, no tallies. */
  publicList(): { id: string; name: string; description: string }[] {
    return this.awards.map(({ id, name, description }) => ({ id, name, description }));
  }

  /** The award ids this voter has already voted on, and for whom. */
  votesBy(voterId: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of this.awards) {
      const choice = a.votes.get(voterId);
      if (choice) out[a.id] = choice;
    }
    return out;
  }

  /** Whether this voter has voted on every award they can vote on. */
  doneVoting(voterId: string): boolean {
    return this.awards.every((a) => a.votes.has(voterId));
  }

  /** Drops a departed agent's ballots and removes them as a recipient. */
  forget(playerId: string): void {
    for (const a of this.awards) {
      a.votes.delete(playerId);
      for (const [voter, recipient] of a.votes) if (recipient === playerId) a.votes.delete(voter);
    }
  }

  results(nameOf: (id: string) => string): AwardResult[] {
    return this.awards.map((a) => {
      const counts = new Map<string, number>();
      for (const recipient of a.votes.values()) counts.set(recipient, (counts.get(recipient) ?? 0) + 1);
      const top = Math.max(0, ...counts.values());
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        winners: top === 0 ? [] : [...counts].filter(([, n]) => n === top).map(([playerId, votes]) => ({ playerId, name: nameOf(playerId), votes })),
        totalVotes: a.votes.size,
      };
    });
  }

  /** Everything, including authors and ballots, for the game's saved record. Never sent to clients. */
  record(): { name: string; description: string; authorId: string; votes: Record<string, string> }[] {
    return this.awards.map((a) => ({ name: a.name, description: a.description, authorId: a.authorId, votes: Object.fromEntries(a.votes) }));
  }
}
