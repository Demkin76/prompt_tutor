# GOLEM — write. animate. observe.

You do not control the unit. You write one immutable **charter** in natural language; a golem (an LLM agent) then plays
three hidden levels of the current tier by that charter. Pass all three and the same run climbs to the next tier
automatically (a "ladder"); the run ends at the first tier that is not fully passed. Rating = levels passed by one
charter. Worlds are generated from fresh random seeds every run, and every seed is first proven passable by a
full-knowledge solver (`approveLevel`) through the real simulation. Every run is deterministic and replayable.

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
| Website + game | `app/` | Five-page Vite site, React game, Canvas 2D sprites, live Convex runs and replay |

## Website

The homepage, levels, technology and world pages share a build with the real game at `play.html`. See [site deployment, checks and screenshots](docs/SITE_DEPLOYMENT.md). Run `npm run build:demo` for an explicitly labeled offline build; production `npm run build` requires `VITE_CONVEX_URL`.

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

## Deploy the frontend to GitHub Pages

Create a production deploy key in Convex, save it as the `CONVEX_PRODUCTION_DEPLOY_KEY` secret in the repository's
`github-pages` environment, then select **GitHub Actions** as the Pages source. Pushes to `main` deploy the Convex backend,
inject that deployment's URL into the Vite build as `VITE_CONVEX_URL`, and publish `dist/`. Local development continues
to use the separate deployment in `.env.local`. The workflow supplies GitHub's path as `BASE_URL`, and Vite exposes the
normalized value to client code as `import.meta.env.BASE_URL`.

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
charter → runs.create → launch (Daytona sandbox | in-process) for the current tier
   → for each of 3 levels: pickApprovedSeed → generateLevel(seed) → observe → LLM decision (intent + plan + stopOn)
   → sim.step per action → frames/decisions streamed to Convex → verify → score
   → run_end (tier): ladder entry, progress/tier unlock, best score per tier
   → 3/3 and tiers left? schedule launch again for tier+1 (new sandbox) : finish the run
```

See `docs/plans/2026-09-12-golem-mvp.md` for decisions and `docs/ASSETS.md` for the asset request list.

See [Keymaster implementation and testing](docs/KEYMASTER.md) for the new second learning level.
