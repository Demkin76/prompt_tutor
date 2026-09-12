# Keymaster — Level 2

Keymaster extends the existing engine, runner, Convex catalogue and Canvas UI.
It appears after Red Floor in the mode list and as the next-level action after a successful Red Floor run.
Its internal identifier is `keymaster`, tier `1`: this single learning level has three hidden trials, not three difficulty tiers. Existing mode/tier IDs are preserved.

## Play

Select **Keymaster → Уровень 2**, write a charter (up to 400 characters), then **Оживить**.
The same immutable charter is used for all three maps. Each trial has 120 ticks, 40 LLM calls and 180 seconds.
Only observations within radius 3 and previously observed memory reach the model. Plans contain up to five actions; discovery and state changes interrupt them.

Production uses the existing Convex + x.ai configuration described in README. No additional provider or API key is introduced.
Without Convex the UI runs the real engine using an explicitly labelled reference strategy. That demonstration does **not** interpret the entered charter or save progress. It is not a natural-language evaluation.

```sh
node --import tsx scripts/run-local.ts --mode keymaster --tier 1 --fake
# With XAI_API_KEY set, omit --fake and supply a charter:
node --import tsx scripts/run-local.ts --mode keymaster --tier 1 --charter "Исследуй окружение. Подбирай полезные предметы и используй их для устранения препятствий. После открытия пути двигайся к выходу."
```

## World and actions

Production selects fresh approved seeds while preserving the A/B/C layout for each trial. The shared full-knowledge approver proves the key/door route through the real simulator before a map is used.

Three deterministic 16×16 layouts (32-pixel tiles): A has the key on the left and the gate on the right; B reveals the door at the start and keeps the key in the far chamber; C has a nearby key and requires returning along explored cells. Walls seal the exit wing; the gate is its only entrance. Crates occupy optional branches.

`move`, `inspect`, `pickup`, `interact`, `wait`, and the existing `say` are available.
`pickup` takes a key on the current or cardinally adjacent tile. `interact(dir)` uses a carried key on the adjacent locked door. The engine never collects items automatically.
The inventory retains the existing `"key"` wire format for compatibility; the asset and evidence identifier is `item.key`.
Key state is `world → inventory → consumed`; altar state is `idle → active`.

Memory retains observed tiles, unique visited positions, discovered key location/state, door location/state and blocked routes; the latest 25 significant events exclude ordinary movement. Eight repeats of an identical position/inventory/door state within 16 actions end the trial as stuck; normal backtracking remains allowed.

Door assets are `obj.door.closed` and `obj.door.open`; floor, wall, altar, golem, key and crate reuse the existing pixel renderer. Pickup/opening use the interact pose and gold sparkles; completion uses success; failure uses fail. Unknown cells are hidden and remembered cells dimmed.

## Approval and score

The deterministic approver requires the final position on the original altar, an open unlocked gate, consumed key, a living golem, and a successful final status. It also requires strictly ordered evidence: `item_collected:item.key → door_opened:with key → altar_reached`.

Successful trial score: `max(0, 1000 − 3*ticks − charterLength − 10*max(0, calls−1) + bonuses)`.
Bonuses: +100 for no repeated destination before key collection; +100 for no failed door interaction between collection and opening. Passing all three trials adds +100 once to the run score. Completion takes precedence over points; failed trials score zero.

The existing replay captures initial/final states, every applied action, event and concise intent. Tests reconstruct and compare all successful replay frames. The UI explains missing milestones and shows the last decision on failure.

## Verification

`npm test` covers map connectivity with a closed/open door, explicit pickup, consumption, collision, inspect, memory, budget/stuck detection, ordered verdicts, an observation-only policy across all seeds and rejection of a route copied from seed A.

These tests validate the engine and runtime with a deterministic reference policy. Live model charter quality requires the configured x.ai service; it is not inferred from reference-policy results.
