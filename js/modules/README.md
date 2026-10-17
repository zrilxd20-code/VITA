# `js/modules/` — TypeScript Refactor Roadmap (Not Loaded at Runtime)

> **Status: experimental / roadmap.** Nothing in this folder is bundled or executed by the
> shipped game. `index.html` loads only the classic scripts `js/supabase.js`, `js/home.js`,
> `js/prologue.js`, and `js/game.js` (shared global scope).

These modules are a **typed decomposition** of the monolithic `js/game.js`, prepared as a
staging ground for a future modular refactor:

| Module | Responsibility | Runtime counterpart |
| :--- | :--- | :--- |
| `config.ts` | Single source of truth for constants, difficulty/quality enums, and the i18n dictionary | top of `js/game.js` (`CELL`, `LEVELS`, `T`, save keys) |
| `maze.ts` | Procedural maze generation + BFS pathfinding with shared buffers | `genMaze()` / `bfsPath()` / `ensureBfsBuffers()` |
| `entities.ts` | Zero-GC entity pools (particles, projectiles, monsters, effects) | object pool arrays in `js/game.js` |
| `audio.ts` | Procedural WebAudio synthesis (oscillators, filters, gain) | `blip()` and the WebAudio layer in `js/game.js` |

## Rules for contributors & AI agents

1. **Do not treat these files as the source of truth.** Edit the classic `js/*.js` scripts to
   change shipped behavior; a change here has **no effect** until a real bundling/build step exists.
2. **Keep them consistent** with the runtime when you touch a mirrored concept, but do not
   duplicate large logic blocks — the goal is a clean, reviewable target architecture.
3. This folder is intentionally **outside** `tools/check.mjs` and `tools/check_html.cjs` scope, so
   it cannot break `npm run check`. `npm test` does not execute it either.