// Cleans free text coming from players before it is stored or shown to anyone.
// Rendering is always done with textContent on the client; this is about keeping text sane.

export const LIMITS = {
  nameMax: 16,
  answerMax: 80,
  promptMin: 5,
  promptMax: 150,
  reasonMax: 200,
  tagMax: 20,
  tagsMax: 5,
} as const;

export type CleanResult = { ok: true; value: string } | { ok: false; reason: "EMPTY" | "TOO_LONG" | "INVALID" };

// Format characters (bidi overrides, zero-width spaces, …) except the zero-width joiner that
// multi-part emoji need.
const FORMAT_CHARS = /(?!‍)\p{Cf}/gu;
const CONTROL_CHARS = /\p{Cc}/gu;

export function cleanText(input: unknown, maxLength: number, minLength = 1): CleanResult {
  if (typeof input !== "string") return { ok: false, reason: "INVALID" };
  // Refuse absurd payloads before doing any work on them.
  if (input.length > maxLength * 8 + 64) return { ok: false, reason: "TOO_LONG" };

  const value = input
    .normalize("NFC")
    .replace(CONTROL_CHARS, " ")
    .replace(FORMAT_CHARS, "")
    .replace(/\s+/gu, " ")
    .trim();

  const length = [...value].length;
  if (length === 0) return { ok: false, reason: "EMPTY" };
  if (length < minLength) return { ok: false, reason: "INVALID" };
  if (length > maxLength) return { ok: false, reason: "TOO_LONG" };
  return { ok: true, value };
}

export function cleanName(input: unknown): string | null {
  const result = cleanText(input, LIMITS.nameMax);
  return result.ok ? result.value : null;
}

export function cleanTags(input: unknown): string[] | null {
  if (input === undefined || input === null || input === "") return [];
  const raw = typeof input === "string" ? input.split(",") : input;
  if (!Array.isArray(raw) || raw.length > LIMITS.tagsMax * 2) return null;

  const tags = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const tag = item.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag === "") continue;
    if (!/^[a-z0-9-]+$/.test(tag) || tag.length > LIMITS.tagMax) return null;
    tags.add(tag);
  }
  if (tags.size > LIMITS.tagsMax) return null;
  return [...tags];
}

export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : null;
}
