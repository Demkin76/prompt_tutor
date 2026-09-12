# GOLEM

A training game for learning prompting.

You never move the unit. You write one immutable **charter** — a short natural-language policy — then watch an LLM agent play three hidden worlds by those words alone. The maps are generated after the charter is locked, so a hard-coded route fails and a general instruction has to survive. Rating = levels passed by one charter; shorter text, fewer ticks, and fewer model calls break ties.

Pass all three levels of a tier and the same run climbs automatically (a "ladder"). The run stops at the first tier that is not fully passed. Every seed is first proven passable by a full-knowledge solver (`approveLevel`) through the real simulation. Every run is deterministic and replayable.

## Modes

| Mode | What it trains | Shape |
|---|---|---|
| **Red Floor** | Constraints. A goal is not enough — the charter must name what is forbidden. | Deadly tiles; later tiers add planks, keys, levers, crates; vision shrinks on tier 3. |
| **Maze** | Exploration under fog of war. | Perfect labyrinth on tier 1; later tiers add loops and a smaller vision window. |
| **Tower Defense** | Read the opponent's rules, then write a counter-policy. | Deterministic enemy charter is shown *before* you write yours. Limited towers. |

Playable entry points: `play.html#red`, `play.html#maze`, `play.html#tower`. All modes: `play.html#all`. Restore a live run: `play.html#run/<runId>`.

Prompt budget grows with tier (200 / 300 / 400 characters).

## Stack

| Piece | Where | Notes |
|---|---|---|
| Deterministic engine | `src/core` | zero deps, seeded PRNG, generators, sim, fog, verifier, scoring, 27-level catalogue |
| Agent runtime | `src/runtime` | prompt assembly, x.ai `grok-4-fast` structured JSON, plan/stopOn loop, replay |
| Runner | `src/runner` → `convex/_runner/bundle.ts` | single-file bundle executed inside a **Daytona** sandbox |
| Backend | `convex/` | **Convex**: sessions, runs, frames, decisions; `launch` action dispatches to Daytona (or runs in-process) |
| Website + game | `app/` | Five-page Vite site, React game, Canvas 2D sprites, live Convex runs and replay |

Requires Node.js 22+.

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

Without `VITE_CONVEX_URL` the UI starts in **mock mode** with a scripted run, so the screens can be demoed offline. The demo does **not** evaluate the typed charter.

Live Convex play requires sign-in. Public sign-up is disabled.

## Auth administration

Register an account through the authenticated Convex CLI:

```bash
npm run auth:register:dev -- person@example.com
npm run auth:register:prod -- person@example.com
```

The script prompts for the password and initializes `ADMIN_REGISTRATION_SECRET` on the selected deployment if needed.

Rotate the JWT signing pair (active access tokens will be invalidated):

```bash
npm run auth:rotate:dev
npm run auth:rotate:prod
```

## Deploy (CI)

`.github/workflows/deploy.yml` runs two jobs on every push to `main`:

- **`backend`** — builds the runner bundle, runs `convex codegen`, typechecks, pushes the functions to the Convex
  production deployment, and uploads `convex/_generated` plus a generated `.env.production` (holding `VITE_CONVEX_URL`)
  as the `convex-generated` artifact.
- **`frontend`** — `needs: backend`, downloads that artifact, builds Vite, and publishes `dist/` to GitHub Pages.

Setup: create a production deploy key in Convex, save it as the `CONVEX_PRODUCTION_DEPLOY_KEY` secret in the repository's
`github-pages` environment, then select **GitHub Actions** as the Pages source. Local development continues to use the
separate deployment in `.env.local`. The frontend job supplies GitHub's path as `BASE_URL`, and Vite exposes the
normalized value to client code as `import.meta.env.BASE_URL`.

The standard generated Convex interfaces are committed so a fresh checkout can build and run checks offline. Production codegen refreshes them, and the frontend job consumes those current files plus the public deployment URL as an artifact. The frontend job does not need a deploy key.

## Command-line runs (no backend needed)

```bash
npx tsx scripts/run-local.ts --mode redfloor --tier 1 --charter "Reach the altar. Never step on red tiles."
npx tsx scripts/run-local.ts --mode maze --tier 2 --fake                     # scripted explorer instead of the LLM
npx tsx scripts/run-local.ts --mode towerdefense --tier 1 --out app/public/demo/td.json
```

Pre-recorded tier-1 (and later) replays for maze, red floor, and tower defense live in `app/public/demo/` (demo fallback).

## Tests

```bash
npm test                  # vitest: engine, runtime, scoring
npm run check:site        # static page/asset checks
npm run test:browser      # playwright, after `npx playwright install chromium`
```

CI (`.github/workflows/checks.yml`) also builds the demo under `/prompt_tutor/` and runs the browser suite.

## Layout of a run

```
charter → runs.create → launch (Daytona sandbox | in-process) for the current tier
   → for each of 3 levels: pickApprovedSeed → generateLevel(seed) → observe → LLM decision (intent + plan + stopOn)
   → sim.step per action → frames/decisions streamed to Convex → verify → score
   → run_end (tier): ladder entry, progress/tier unlock, best score per tier
   → 3/3 and tiers left? schedule launch again for tier+1 (new sandbox) : finish the run
```

See `docs/plans/2026-09-12-golem-mvp.md` for design decisions and `docs/ASSETS.md` for the asset request list.
