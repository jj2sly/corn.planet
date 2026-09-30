// Minimal Jest-style `expect` built on node:assert, for engine tests written in that style.
// node:test has no `expect` export, so importing it from there fails at module link time.
import assert from "node:assert/strict";

interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeDefined(): void;
  toBeGreaterThan(expected: number): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
}

export function expect(actual: unknown): Matchers & { not: Matchers } {
  const matchers = (negate: boolean): Matchers => {
    const check = (pass: boolean, message: string) => {
      if (pass === negate) assert.fail(`${negate ? "Expected not: " : "Expected: "}${message}`);
    };
    return {
      toBe: (expected) => check(Object.is(actual, expected), `${String(actual)} to be ${String(expected)}`),
      toEqual: (expected) => {
        let equal = true;
        try { assert.deepStrictEqual(actual, expected); } catch { equal = false; }
        check(equal, `${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      },
      toBeNull: () => check(actual === null, `${String(actual)} to be null`),
      toBeDefined: () => check(actual !== undefined, "value to be defined"),
      toBeGreaterThan: (expected) => check(typeof actual === "number" && actual > expected, `${String(actual)} > ${expected}`),
      toContain: (expected) => {
        const pass = typeof actual === "string"
          ? typeof expected === "string" && actual.includes(expected)
          : Array.isArray(actual) && actual.includes(expected);
        check(pass, `${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      },
      toHaveLength: (expected) => {
        const length = (actual as { length?: unknown } | null | undefined)?.length;
        check(length === expected, `length ${String(length)} to be ${expected}`);
      },
    };
  };
  return Object.assign(matchers(false), { not: matchers(true) });
}
