# CPI Party Runtime

The runtime is the shared foundation for CPI Party. It separates game lifecycle and server authority from rendering, input, assets, and individual game rules.

## Current layers

- Party runtime: game installation, lifecycle, input routing, pause/resume, fixed-step timing and disposal.
- Game contract: stable GameDefinition/GameInstance interfaces used by existing and future games.
- 3D foundation: renderer adapter contract, asset registry, zone streaming, world primitives and first-person support.
- Browser reference runtime: frame loop, input mapping, scene object registry and quality profiles.

## Migration rule

Existing games stay working. New shared behavior belongs in the runtime instead of being copied into individual games.

Cold Case is the first 3D integration target. The current /coldcase page remains a useful prototype/debug target while the real renderer is developed behind the adapter.

## Build order

1. Renderer adapter implementation.
2. Asset loading and caching.
3. World streaming wired to Cold Case zones.
4. Multiplayer snapshot bridge.
5. First Cold Case scene running through the runtime.
6. App shell and final renderer.
7. Migrate existing games one at a time.
