// Browser-side Cold Case prototype currently uses the level schema only on the server/tooling side.
// Kept as a tiny compatibility module so the prototype client can be served without bundling TypeScript.
// The authoritative definition lives in ./coldcase-level.ts.
export const COLD_CASE_PROTOTYPE = { id: "cold-case-prototype" } as const;
