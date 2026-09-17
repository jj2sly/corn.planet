// Turning canon into a true claim and a false one.
//
// The false claim is built by template, not by an AI: take a real field from one canon record and
// attribute it to another. That keeps fabrications in-universe and plausible for free, with no
// model, no API key and no cost — and, because the value is only ever moved between records of the
// same kind, the result always reads like something the CPI Database could have said.
//
// Everything produced here is GENERATED CONTENT. It is never canon, never written back to the CPI
// Database, and is always labelled as fabricated once a round is revealed (see docs/CANON.md).

import { isRedacted, type CanonKind, type CanonRecord } from "../canon.ts";

/** Longest a quoted field may be before it is cut, so a claim still fits a host screen. */
const MAX_VALUE = 180;
/** Below this a field is too thin to make an interesting claim ("", "n/a"). */
const MIN_VALUE = 2;

type Template = (title: string, value: string) => string;

// Which fields can carry a claim, and how each one reads as a sentence. A field with no template
// is never used, so adding a field to canon.ts does not silently produce clumsy claims.
const TEMPLATES: Record<CanonKind, Record<string, Template>> = {
  entity: {
    classification: (t, v) => `${t} is classified ${v}.`,
    containment: (t, v) => `${t} is held under ${v} containment.`,
    containmentProcedures: (t, v) => `Containment procedure on file for ${t}: "${v}"`,
    description: (t, v) => `The CPI Database says of ${t}: "${v}"`,
  },
  incident: {
    severity: (t, v) => `${t} is filed at ${v} severity.`,
    status: (t, v) => `The status of ${t} is ${v}.`,
    date: (t, v) => `${t} is on record as occurring ${v}.`,
    summary: (t, v) => `The summary filed for ${t} reads: "${v}"`,
    resolution: (t, v) => `${t} was resolved as follows: "${v}"`,
  },
  personnel: {
    clearance: (t, v) => `${t} holds ${v} clearance.`,
    status: (t, v) => `The service status of ${t} is ${v}.`,
    designation: (t, v) => `${t} is designated ${v}.`,
    specialisation: (t, v) => `${t} specialises in: "${v}"`,
  },
};

export interface ClaimPair {
  /** The canon record the round is about. This is the reference players are shown afterwards. */
  source: CanonRecord;
  /** The canon field the claim was built from, e.g. "containmentProcedures". */
  field: string;
  /** The documented claim. */
  real: string;
  /** The fabricated claim. Generated content — never canon. */
  fake: string;
  /**
   * The record the fabricated value was borrowed from. Kept for the reveal ("that one is really
   * Chuck's"), deliberately NOT recorded as a source of the round.
   */
  donor: CanonRecord;
}

function trim(value: string): string {
  if (value.length <= MAX_VALUE) return value;
  // Cut on a word boundary where there is one close enough to the limit.
  const cut = value.slice(0, MAX_VALUE);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_VALUE - 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A field is usable when it is present, long enough, and not hiding anything behind a redaction. */
function usable(record: CanonRecord, field: string): boolean {
  const value = record.fields[field];
  return typeof value === "string" && value.length >= MIN_VALUE && !isRedacted(value);
}

/** The fields of `record` that could carry a claim, in template order. */
export function claimableFields(record: CanonRecord): string[] {
  return Object.keys(TEMPLATES[record.kind] ?? {}).filter((field) => usable(record, field));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Builds a true/false claim pair about `source`, borrowing the false value from another record in
 * `pool`. Returns null when nothing in the pool can produce an honest pair — the caller should try
 * a different source rather than inventing something.
 */
export function buildClaimPair(
  source: CanonRecord,
  pool: readonly CanonRecord[],
  random: () => number = Math.random,
): ClaimPair | null {
  const templates = TEMPLATES[source.kind] ?? {};

  for (const field of shuffled(claimableFields(source), random)) {
    const template = templates[field]!;
    const realValue = source.fields[field]!;

    const donors = pool.filter(
      (candidate) =>
        candidate.ref !== source.ref &&
        candidate.kind === source.kind &&
        usable(candidate, field) &&
        // The borrowed value must actually differ, or the "lie" would be true.
        candidate.fields[field]!.trim().toLowerCase() !== realValue.trim().toLowerCase(),
    );
    if (donors.length === 0) continue;

    const donor = shuffled(donors, random)[0]!;
    return {
      source,
      field,
      real: template(source.title, trim(realValue)),
      fake: template(source.title, trim(donor.fields[field]!)),
      donor,
    };
  }

  return null;
}
