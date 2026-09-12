# GOLEM — write. animate. observe.

You do not control the unit. You write one immutable **charter** in natural language; a golem (an LLM agent) then plays
three hidden levels of the current tier by that charter. Pass all three to unlock the next tier. Every run is a
deterministic, replayable benchmark.

Modes: **Maze** (fog-of-war pathfinding), **Red Floor** (deadly tiles, planks, keys, levers, crates; narrow vision on tier 3),
**Keymaster** (level 2: key → locked door → exit, with three hidden maps),
**Tower Defense** (deterministic enemy whose rules you read before writing your charter; limited towers).

## Stack

| Piece | Where | Notes |
|---|---|---|
| Deterministic engine | `src/core` | zero deps, seeded PRNG, generators, sim, fog, verifier, scoring, 30-level catalogue |
| Agent runtime | `src/runtime` | prompt assembly, x.ai `grok-4-fast` structured JSON, plan/stopOn loop, replay |
| Runner | `src/runner` → `convex/_runner/bundle.ts` | single-file bundle executed inside a **Daytona** sandbox |
| Backend | `convex/` | **Convex**: sessions, runs, frames, decisions; `launch` action dispatches to Daytona (or runs in-process) |
| UI | `app/` | Vite + React, Canvas 2D, placeholder tiles keyed by `assetKey` (see `docs/ASSETS.md`) |

## Run locally

```bash
npm install
cp .env.example .env.local        # fill VITE_CONVEX_URL after `npx convex dev`
npx convex dev                    # creates the deployment, generates convex/_generated
npm run build:runner              # bundles the Daytona runner (re-run after engine/runtime changes)
npm run dev                       # http://localhost:5173
```

Set these in the Convex dashboard (Settings → Environment Variables): `XAI_API_KEY`, `XAI_MODEL` (default `grok-4-fast`),
and optionally `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET`. Without a Daytona key the run executes inside the
Convex action (same code, same results).

Without `VITE_CONVEX_URL` the UI starts in **mock mode** with a scripted run, so the screens can be demoed offline.

## Command-line runs (no backend needed)

```bash
npx tsx scripts/run-local.ts --mode redfloor --tier 1 --charter "Reach the altar. Never step on red tiles."
npx tsx scripts/run-local.ts --mode maze --tier 2 --fake                     # scripted explorer instead of the LLM
npx tsx scripts/run-local.ts --mode towerdefense --tier 1 --out app/public/demo/td.json
```

Pre-recorded tier-1 replays for all modes live in `app/public/demo/` (demo fallback).

## Tests

```bash
npm test
```

## Layout of a run

```
charter → runs.create → launch (Daytona sandbox | in-process)
   → for each of 3 levels: generateLevel(seed) → observe → LLM decision (intent + plan + stopOn)
   → sim.step per action → frames/decisions streamed to Convex → verify → score
   → run_end: progress/tier unlock, best score per tier
```

See `docs/plans/2026-09-12-golem-mvp.md` for decisions and `docs/ASSETS.md` for the asset request list.

See [Keymaster implementation and testing](docs/KEYMASTER.md) for the new second learning level.
