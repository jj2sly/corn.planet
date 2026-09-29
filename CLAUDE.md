# CPI Party / Corn Planet Development Rules

These rules are intended to keep implementation fast and practical.

## Default operating mode

Act as an implementation agent, not a consultant.

When a task is clear:
- Implement it directly.
- Do not stop to ask for approval on obvious implementation decisions.
- Do not spend large amounts of time producing audits, architecture essays, or plans when the requested result can be built.
- Prefer a working prototype over extensive documentation.
- If something breaks during implementation, diagnose and fix it yourself before reporting back.
- Continue through the requested scope unless genuinely blocked by missing information, credentials, or an unsafe/destructive operation.

## CPI Party branch safety

- The production CPI Database lives on `main`.
- CPI Party development lives on `cpst-party`.
- Do not merge `cpst-party` into `main`.
- Do not force-push.
- Never commit secrets, credentials, or `.env` files.
- Preserve existing working games and shared systems unless the task explicitly requires changing them.
- Make focused, additive changes when practical.

## Build before polish

For game development, prioritize in this order:

1. Core gameplay actually works.
2. Game state and multiplayer synchronization work.
3. Desktop and phone controls work.
4. Failure/recovery paths work.
5. Content and replayability are present.
6. Performance is acceptable.
7. Visual polish and extra UI polish.

Do not spend a large amount of time polishing menus, decorative UI, or documentation while the requested gameplay is still missing.

## Reuse existing systems

Before creating a new system, inspect the existing CPI Party engine and reusable systems.

Prefer extending existing:
- game runtime/state systems
- player/session systems
- input and movement
- touch controls
- first-person systems
- temperature/environment systems
- repair systems
- checkpoints
- inventory/resources
- interaction systems
- shared CPI visuals/audio
- networking/realtime infrastructure

Do not duplicate an existing subsystem just because a new game needs slightly different behavior.

## Implementation passes

For large requests, work in practical passes:

### Pass 1 — Playable
Get the requested gameplay loop functioning end-to-end with minimal polish.

### Pass 2 — Content
Add the requested encounters, systems, progression, hazards, objectives, and replayability.

### Pass 3 — Polish
Improve visuals, feedback, animation, sound, UI, and atmosphere.

### Pass 4 — Verification
Run typecheck/tests and browser/runtime checks. Fix failures rather than merely reporting them.

Do not turn every pass into a planning exercise.

## Testing

After implementation:
- Run the relevant tests.
- Run typecheck when applicable.
- Exercise the actual gameplay path when browser/runtime testing is available.
- Fix failures found during testing.
- Do not claim something is playable merely because the code compiles.

When a deployment is requested, verify the deployed route/functionality if the available tooling permits it.

## Deployment

When explicitly asked to deploy:
- Verify the intended branch and deployment root first.
- Deploy the requested work.
- Verify the live route after deployment when possible.
- Give the user the exact playable URL.
- Do not make unrelated production changes.

## Canon and creative content

CPI/Corn Planet canon belongs to the project owner.

- Do not invent canon text, character notes, story revelations, database entries, or other owner-controlled lore when the task says the user controls the canon.
- Placeholders are acceptable when clearly marked for later user-provided content.
- Existing canon/database content should be reused rather than silently rewritten.

## Communication

Final reports should be short and useful:
1. What was implemented.
2. What was tested.
3. Any real blocker that remains.
4. URL or commit when relevant.

Do not bury the result under a long explanation.

## Decision rule

When choosing between:
- another hour explaining/auditing/planning, or
- another hour making the requested game feature actually work,

choose implementation, provided the task is clear and there is no genuine blocker.
