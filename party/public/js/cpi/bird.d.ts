// Types for bird.js, so tests (TypeScript) can draw with the module the browser runs.

export declare function drawBird(
  ctx: unknown,
  look: Record<string, unknown>,
  pose?: { x?: number; y?: number; r?: number; angle?: number; facing?: number; state?: string; t?: number; blink?: boolean; squash?: number; alpha?: number; outline?: string | null },
): void;
