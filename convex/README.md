# GOLEM — Convex backend

## Files

| File | Purpose |
| --- | --- |
| `schema.ts` | `sessions`, `runs`, `levelRuns`, `frames`, `decisions` tables. Big engine objects are `v.any()`. |
| `levels.ts` | `tiers({mode})`, `modes()` — public, seed-stripped view of `src/core` level specs. |
| `sessions.ts` | `ensure({sessionId})`, `get({sessionId})`. No auth; the browser keeps `sessionId` in localStorage. |
| `runs.ts` | `create`, `ingest` (public sink for the runner), `get`, `bySession`, `levelRuns`, `frames`, `decisions`. |
| `launch.ts` | `"use node"` internal action scheduled by `runs.create`: Daytona sandbox, or in-process fallback. |
| `_runner/bundle.ts` | **Generated** by `npm run build:runner` (gitignored). Exports `RUNNER_SOURCE`, the esbuild-bundled `src/runner` as one CJS string. |

## Environment variables (Convex dashboard → Settings → Environment Variables)

| Variable | Required | Notes |
| --- | --- | --- |
| `XAI_API_KEY` | yes | x.ai key used by the agent loop (passed into the sandbox, or used in-process). |
| `XAI_MODEL` | no | Defaults to the runtime's default (`grok-4-fast`). |
| `DAYTONA_API_KEY` | no | If set (and the runner bundle is non-empty), runs execute in a Daytona sandbox. Otherwise in-process inside the action. |
| `DAYTONA_API_URL` | no | Defaults to `https://app.daytona.io/api`. |
| `DAYTONA_TARGET` | no | e.g. `us`. |

`CONVEX_CLOUD_URL` / `CONVEX_SITE_URL` are injected by Convex automatically; do not set them.

## How a run flows

1. UI calls `api.runs.create({sessionId, mode, tier, charter})` → validates (mode, unlocked tier, `promptBudget`), inserts a `runs` row (`queued`) and schedules `internal.launch.run`.
2. `launch.run` decides the host:
   - **Daytona**: `daytona.create({language:"typescript", envVars:{RUN_ID, CONVEX_URL, MODE, TIER, CHARTER, XAI_API_KEY, XAI_MODEL}, autoDeleteInterval:15})`, `sandbox.fs.uploadFile(Buffer(RUNNER_SOURCE), "runner.cjs")`, `sandbox.process.executeCommand("node runner.cjs", undefined, undefined, 540)`, then `sandbox.delete()`.
   - **In-process**: imports `runTier` / `createXaiClient` from `src/runtime` and uses `ctx.runMutation(api.runs.ingest)` as the sink.
3. The runner reaches Convex through the built-in function endpoint — no `http.ts` needed:
   ```
   POST {CONVEX_URL}/api/mutation
   Content-Type: application/json
   { "path": "runs:ingest", "args": { "runId": "...", "message": <RunnerMessage> }, "format": "json" }
   ```
   `CONVEX_URL` is the `.convex.cloud` deployment URL (`process.env.CONVEX_CLOUD_URL` inside Convex), **not** the `.convex.site` URL.
4. `runs.ingest` writes `levelRuns` / `decisions` / `frames`, and on `run_end` stores the summary, bumps `sessions.progress[mode]` when the tier was unlocked, and updates `sessions.best["<mode>-<tier>"]`.

Actions are capped at 10 minutes, so the sandbox command timeout is 540 s. A run that exceeds it ends with `status: "error"`.

## Commands

```sh
npx convex dev          # deploy functions, watch convex/ and imported files, regenerate convex/_generated
npm run build:runner    # esbuild src/runner → convex/_runner/bundle.ts
```

`convex dev` watches `convex/_runner/bundle.ts` like any other file, so re-running `npm run build:runner` triggers a redeploy. Without the bundle (placeholder `RUNNER_SOURCE = ""`), `launch.run` logs a warning and falls back to in-process even when `DAYTONA_API_KEY` is set.

`convex.json` marks `@daytonaio/sdk` as an external package (installed on the deployment from `package-lock.json` rather than bundled) because it pulls in AWS SDK / OpenTelemetry transitively.
