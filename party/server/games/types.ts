// Compatibility surface for existing games.
//
// The runtime contracts now live in server/engine/game.ts. Existing game files may continue
// importing from "./types.ts" while they migrate; new shared/runtime code should import from
// "../engine/game.ts" instead.
//
// Keeping this as a re-export gives us one source of truth instead of two GameDefinition
// interfaces that could drift apart.

export * from "../engine/game.ts";
