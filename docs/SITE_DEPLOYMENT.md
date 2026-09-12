# GOLEM website deployment

The supplied marketing site and the production game now share one Vite build and one engine. The source pages are in `app/`, the actual game is at `play.html`, and the static output is `dist/`.

## Local preview

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
# Open http://localhost:5173/
```

Without `VITE_CONVEX_URL`, the application clearly labels itself as an offline demonstration. Sample strategies/replays run through the existing game interface. They do not assess the player's charter. The old keyword-based prototype runner is no longer shipped.

```sh
npm run build:demo
npm run check:site
npm run preview
```

## Production (existing GitHub Pages + Convex integration)

1. In the existing Convex production deployment, configure `XAI_API_KEY` and optionally `XAI_MODEL` (default `grok-4-fast`). Set `DAYTONA_API_KEY` only if using Daytona; otherwise the same runtime runs inside the Convex action.
2. In the GitHub `github-pages` environment, set `CONVEX_PRODUCTION_DEPLOY_KEY` to that deployment's production deploy key. Select GitHub Actions as the Pages source.
3. Merge the reviewed branch into `main`. `.github/workflows/deploy.yml` tests the project and deploys Convex in the backend job. It passes the generated `.env.production` and interfaces to the frontend job, which builds the five pages, checks links and publishes `dist/`.

The build follows the [Convex deploy command](https://docs.convex.dev/cli/reference/deploy) contract and the [Vite multi-page build](https://vite.dev/guide/build#multi-page-app). It receives the deployment URL from Convex rather than hard-coding a development environment.

`npm run build` refuses to silently produce a demo if the backend URL is missing. `npm run build:demo` explicitly opts into an offline showcase. The API keys remain on the backend; only the public Convex client URL is embedded in JavaScript. Do not put API keys in any `VITE_` variable.

For another static host, first run `npm run build:runner`, then `npx convex deploy --cmd "node scripts/write-frontend-env.mjs" --cmd-url-env-var-name VITE_CONVEX_URL`. Finally run `npm run build` and publish `dist/`. No SPA catch-all rewrite is required: all five `.html` routes exist. Set `BASE_URL=/your-subdirectory/` when hosting under a subpath. Leave it unset at a domain root.

## Routes

- `index.html`, `levels.html`, `technology.html`, `world.html`: website.
- `play.html#red`, `play.html#key`: Red Floor / Keymaster.
- `play.html#all`: all four modes, including Maze and Tower Defense.
- `play.html#run/<runId>`: restore an existing run from the backend, including its immutable charter. Offline demo runs only exist in the current page session; expired links show a recovery action.

## Verification and screenshots

```sh
npm test
npm run build:demo
npm run check:site
npx playwright install chromium
npm run test:browser
```

CI also repeats the browser checks under `/prompt_tutor/` to catch broken Pages asset paths. It covers all pages, images, mobile navigation, the complete Keymaster loop, and stale run links.

To refresh the real screenshots, start `npm run dev -- --port 5180` in demo mode, then run `npm run screenshots` from another terminal. `CAPTURE_URL` can override the local URL. The script refuses to launch screenshots against live inference. Captures in `app/public/assets/screenshots/` show the real editor, Red Floor replay, Keymaster replay and verified results; their site captions explicitly identify the offline sample strategy.

The original asset sheets remain as concept/production art. The game and result screenshots are actual browser captures, not illustrations.
