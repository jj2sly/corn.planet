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

/**
 * A short-form template ("X is held under MINIMAL containment.") only reads right for a level-like
 * value. When either side of the pair is free text ("cannot be contained") both claims use the
 * quoted form instead — a clumsy true claim beside a clean fake would give the answer away.
 */
interface LevelTemplate {
  short: Template;
  quoted: Template;
}

const LEVEL_VALUE = /^[\p{Lu}\d][\p{Lu}\d .\/-]{0,23}$/u;
const level = (short: Template, label: string): LevelTemplate => ({
  short,
  quoted: (t, v) => `${label} on file for ${t}: "${v}"`,
});

// Which fields can carry a claim, and how each one reads as a sentence. A field with no template
// is never used, so adding a field to canon.ts does not silently produce clumsy claims.
const TEMPLATES: Record<CanonKind, Record<string, Template | LevelTemplate>> = {
  entity: {
    classification: level((t, v) => `${t} is classified ${v}.`, "Classification"),
    containment: level((t, v) => `${t} is held under ${v} containment.`, "Containment"),
    containmentProcedures: (t, v) => `Containment procedure on file for ${t}: "${v}"`,
    description: (t, v) => `The CPI Database says of ${t}: "${v}"`,
  },
  incident: {
    severity: level((t, v) => `${t} is filed at ${v} severity.`, "Severity"),
    status: level((t, v) => `The status of ${t} is ${v}.`, "Status"),
    date: (t, v) => `${t} is on record as occurring ${v}.`,
    summary: (t, v) => `The summary filed for ${t} reads: "${v}"`,
    resolution: (t, v) => `${t} was resolved as follows: "${v}"`,
  },
  personnel: {
    clearance: level((t, v) => `${t} holds ${v} clearance.`, "Clearance"),
    status: level((t, v) => `The service status of ${t} is ${v}.`, "Service status"),
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

const ARTICLE = /^(?:the|a|an)\s+/i;

/**
 * The ways a record's own text tends to name it, longest first:
 * 'Jack “Snaggletooth” Cummins' → Jack Snaggletooth Cummins, Jack Cummins, Jack, Cummins…
 * Nicknames in quotes and parentheticals are dropped, a leading article is optional, and a
 * multi-word name also contributes its first and last capitalised word.
 */
/** A name as prose would use it: 'Baby (Two Heart Emoji)' → Baby, 'Jack “Snaggletooth” Cummins' → Jack Cummins. */
function plainName(title: string): string {
  const plain = title.replace(/[“"][^”"]*[”"]/g, " ").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return plain.length >= 2 ? plain : title;
}

export function nameVariants(title: string): string[] {
  const variants = new Set<string>();
  const add = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean.length >= 3) variants.add(clean);
  };
  const bare = plainName(title);
  for (const form of [title, title.replace(/[“”"]/g, ""), bare]) {
    add(form);
    add(form.trim().replace(ARTICLE, ""));
  }
  const tokens = bare.trim().replace(ARTICLE, "").split(/\s+/);
  const words = tokens
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((word) => word.length >= 3 && /^\p{Lu}/u.test(word));
  if (tokens.length > 1 && words.length > 0) {
    add(words[0]!);
    add(words[words.length - 1]!);
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The donor's value, re-pointed at the source record. Canon descriptions nearly always name their
 * own entity ("Thad Phelps is…"), so a borrowed value would otherwise give the fake away. Names and
 * the donor's designation are swapped in one pass, so an inserted name is never re-matched.
 * GENERATED CONTENT: this only ever exists inside a round; it is never canon.
 */
export function borrowValue(donor: CanonRecord, source: CanonRecord, field: string): string {
  const value = donor.fields[field] ?? "";
  const swaps = new Map<string, string>();
  const sourceName = plainName(source.title);
  for (const variant of nameVariants(donor.title)) swaps.set(variant, sourceName);
  // "CPE-22" style designations point at the donor too; hand them the source's ref.
  const designation = /^([A-Z]{2,4})-0*(\d+)$/.exec(donor.ref);
  if (designation && /^[A-Z]{2,4}-\d+$/.test(source.ref)) {
    swaps.set(donor.ref, source.ref);
    swaps.set(`${designation[1]}-${designation[2]}`, source.ref);
  }
  if (swaps.size === 0) return value;
  const keys = [...swaps.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return value.replace(pattern, (match) => swaps.get(match) ?? match);
}

function namePattern(title: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${nameVariants(title).map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "u");
}

function mentions(value: string, title: string): boolean {
  return nameVariants(title).length > 0 && namePattern(title).test(value);
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

    for (const donor of shuffled(donors, random)) {
      // A donor text that already mentions the source ("…a close cohort of Primate…") reads as
      // being about someone else once attributed to it.
      if (mentions(donor.fields[field]!, source.title)) continue;
      const borrowed = borrowValue(donor, source, field);
      // After re-pointing names the fabrication could coincide with the truth; try another donor.
      if (borrowed.trim().toLowerCase() === realValue.trim().toLowerCase()) continue;
      const real = trim(realValue);
      const fake = trim(borrowed);
      const phrase: Template = typeof template === "function"
        ? template
        : LEVEL_VALUE.test(real) && LEVEL_VALUE.test(fake) ? template.short : template.quoted;
      return {
        source,
        field,
        real: phrase(source.title, real),
        fake: phrase(source.title, fake),
        donor,
      };
    }
  }

  return null;
}
