# Frontline V3 — pressure and reserves

Review URL: **http://127.0.0.1:8018/games/frontline/**. The local preview server is running. This pass changes Frontline only; shared audio, other games and the historical V2 report are untouched.

## Implementation

Squad recruitment, amplifier rewards and Endless boss rewards no longer cap at 60. Formation geometry and projectile emission remain bounded to 30 visible scouts. Formations cache by `clamp(floor(count), 0, 30)`, giving at most 31 entries. The HUD shows the real count; a backed reserve badge shows `+(squad − 30)` beside the rear formation. Its side changes near the road edges with hysteresis, keeping it on the canvas without flickering at the center.

Per-projectile formation scaling for squad size `s` is:

```text
s <= 60: max(1, s / 30)
s > 60:  2 + log2(s / 60)
```

Below 30, growth comes from additional visible shooters. At 30/60/120/240/500 scouts the multiplier is 1/2/3/4/~5.06. Hidden reserves emit no additional bullets. Weapon damage, volley intervals and upgrade ceilings are unchanged. Player projectile speeds increase exactly 30%: Pulse 1040→1352, Repeater 1420→1846, Trident 1160→1508 logical pixels/second. Trident spread narrows from ±0.10 to ±0.06 radians after late idle-squad checks showed its wide cone covering too much of the road. Swept collision still selects the nearest intersection.

Base enemy speeds change substantially:

| Class | V2 → V3 | Increase | Breach loss |
| --- | --- | --- | --- |
| Grunt | 49 → 69 | 40.8% | 1 |
| Runner | 92 → 120 | 30.4% | 1 |
| Brute | 32 → 44 | 37.5% | 2 |
| Elite | 40 → 56 | 40% | 2 |

Speed progression is `1 + min(.7, band × .045) + min(.35, max(0, band − 12) × .008) + phase × .12`, with a separate ceiling of 2.17×. HP bases and the existing small bounded HP multiplier are retained. Hostile projectile speed remains 155; their count now has an explicit ceiling of 80.

Ordinary grunt/runner layers use rounded 1.5× quantities; Horde layers use `1.85 + .35 × band / (band + 24)`. Heavy layer counts remain unchanged. Encounters contain at most 24 enemies; overlapping normal waves admit at most 30 enemies and four elites, including enemies still above the visible screen. Overflow admissions are omitted, not accumulated into an unbounded backlog. Explicit test-only fixture arguments allow 48 enemies for stress measurement.

Campaign removes the opening band discount and long initial gap weighting. Its encounter window becomes `(duration − 17) × (.76 − level × .012)`, retaining nonuniform recovery/surge weights and the existing role pools. Across 100 seeds per sector, mean gaps change from 7.14→5.39 seconds in Sector 1 and 6.18→4.00 in Sector 10. Mean total enemies change from 21.83→35.01 and 72.39→134.62 respectively. Boss readiness follows the earlier final recovery; sector identities, boss entrance protection and unlocks remain.

At the resource line (`y >= 635`), negative amplifiers apply their full displayed penalty regardless of lane or combat grace. Zero safely disappears. Positives require the existing visible-footprint contact and otherwise disappear without reward or damage. Each projectile still adds exactly +1. Avoided supplies, sealed crates and released upgrades cause no global damage. Resource penalties no longer grant combat grace; they continue bypassing it.

Enemy contact retains full class contact damage (2/4) with 0.35 seconds of direct-contact grace, down from 0.7. A contact during grace becomes a class-sensitive breach instead of disappearing harmlessly. Off-axis enemies breach at the defensive line (`y >= 649`), rather than waiting until 735. Every breach adds loss to a numeric debt. At most two queued scouts are removed per 0.12-second tick, independently of contact grace; losses are spread over time without forgiving the cluster. Contact and queued loss can coexist in a frame. A 24-grunt cluster costs 24 off-axis or 25 on contact after draining, rather than wiping 100 scouts instantly or costing only one hit.

## Endless after band 12

Band is now `floor(time / 32)` without a global cap. Regular interval is `2.4 + 2.5 / (1 + .25 × band)`: 3.025 seconds at band 12, 2.757 at 24, 2.592 at 48 and 2.481 at 120. Horde gaps add only .25 seconds (previously 1); every fifth block remains recovery with .6 seconds of extra breathing space.

Random Horde probability grows as `.22 + .76 × band / (band + 8)`, alongside the fixed surge beat and bounded threat budget. Beyond band 12, an increasing proportion of grunts become runners, non-recovery supply slots become amplifiers, and panels lean toward deeper negatives (bounded at −16). These changes preserve each block's enemy-lane structure. Sampled Horde frequency rises from 63.8% at band 12 to 72.2% at 24 and 77% at 48; runners/block rise 3.37→5.24→6.81 and red panels/block .264→.366→.446.

Endless bosses also continue applying pressure: time until the next boss trends from 43 toward 24 seconds after defeat, adds intervals trend toward 2.6 seconds, and recovery between marked attacks shortens by up to one third. The 1.35-second telegraph stays unchanged. Entity and raw-speed ceilings remain separate from continued cadence/composition progression.

## Validation and balance evidence

All final commands exited **0**:

```sh
node games/frontline/tests/simulation.mjs
PLAYWRIGHT_MODULE=/home/randolph/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node games/frontline/tests/browser.cjs
PLAYWRIGHT_MODULE=/home/randolph/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node games/frontline/tests/browser-v2.cjs
git diff --check
```

Simulation covers 1,000 Campaign layouts and 27,000 Endless blocks through band 120, plus direct assertions for 61/120/500 scouts, bounded cached geometry/emission, the firepower curve, every amplifier state, avoided rewards/crates, staggered and clustered breaches, heavy breach debt, fatal ignored waves, high-speed/diagonal nearest hits and same-seed/input Campaign and late Endless state reproduction. Normal generated runs enforce enemy, hostile, projectile and particle ceilings.

For reproducible comparison the suite loads V2 content/engine from commit `457fc9e9f469958be3f6329619743ec4f0e22251`, alongside the existing V1 baseline tag. It performs 300 attempts per version with the same original balanced policy, plus 300 V3 attempts with a separate threat-aware policy. The latter prioritizes red panels, approaching enemies and timed collection rather than waiting under distant rewards. Default pilot behavior remains unchanged.

| Measure | V2 | V3 |
| --- | --- | --- |
| Original balanced pilot Campaign wins | 285/300 | 25/300 |
| Original balanced pilot Sector 1 wins | 30/30 | 11/30 |
| Original balanced pilot Endless seeds 1/22/914 | All playing at 900s, 60 scouts | Lost at 16.60/20.55/15.03s |
| V3 idle Sector 1 | — | 0/30 wins; mean survival 22.41s |
| Separate V3 threat-aware Campaign policy | — | 267/300 wins |

Threat-aware wins by sector: **30, 30, 30, 30, 28, 28, 27, 25, 20, 19** out of 30 each. This establishes available successful decisions without proving every seed fair. An initial excessive insertion pass produced 8/300 original-policy wins and four times Sector 1's enemies; those inserted packs were removed before final tuning.

The threat-aware Endless policy still survives all three 900-second samples, with **947/1000/969** scouts. This is an explicit remaining limit: steering and panel investment can accumulate substantial reserves, and these checks do not demonstrate eventual failure for competent play.

Late fixtures start at 384/768/1536 seconds with 120 or 240 scouts, Trident and bounded upgrades, over seeds 1/22/914. All 18 active cases outperform their idle counterparts. All idle cases lose real reserves; several 120-scout cases die. At the 1536-second start all three idle 120-scout cases die within approximately three minutes, while idle 240-scout cases lose about half their reserves over four minutes. Active cases remain strong. These are constructed late-run fixtures, distinct from full runs grown from five scouts.

Both browser suites finish with **zero page errors, console errors or warnings**. Existing controls, pause/resume, restart/reload seeds, new layout, Campaign completion/unlocks, bosses, weapons, Endless records, reduced motion and sound preference pass. Save tests retain V1 completion/seeds/records/sound, preserve 61/120/500 survivor mastery on reload, reject invalid mastery individually and safely handle malformed JSON/null/unsupported versions. Storage key and version stay `randolf:frontline:v1` / 1.

Visually inspected mixed scenes at **360×800, 390×844, 430×932 and 1440×1000**: reserve badge legible, full 240-scout HUD present, 27 enemies/resources/projectiles on canvas, no horizontal overflow, footer controls fit. Generated accelerated browser replays also cover Sector 1 (24s), Sector 10 seed 2 (36s, 29-enemy peak, five losses) and band-24 Endless (30s, 120→162 scouts, 30-enemy peak, two losses). These use the real renderer with automated steering, not human real-time playtesting.

## Performance and handoff

Separate samples measure simulation/update work and actual RAF Canvas draw submission. Both peak fixtures use **240 real / 30 visible scouts, six resources, 330 projectiles and 140 particles**. Fixture construction is outside the Node timer. Canvas fixtures are frozen; draw timing excludes eventual GPU/raster completion.

| Measurement, milliseconds | 30 enemies: intended peak | 48 enemies: extreme stress |
| --- | --- | --- |
| Node update median / p95 / worst (300 samples) | .900 / 1.304 / 3.676 | 1.285 / 1.636 / 1.835 |
| Canvas draw median / p95 / worst (180 RAF draws) | .9 / 1.1 / 2.7 | 1.0 / 1.2 / 2.1 |
| Browser frame interval median / p95 / worst | 22.8 / 25.3 / 46.0 | 29.2 / 33.9 / 36.2 |

These are desktop/headless Chromium measurements at DPR 2, not physical-phone FPS. No physical iOS/Android, Safari, subjective listening or human balance playtest was available. Synthetic visibility checks are not proof of OS/background-tab behavior. At ceilings, encounter admission can omit surplus enemies; continuous asymptotic progression does not guarantee an uncapped squad can never outgrow difficulty.

Changes: `content.js`, `engine.js`, `render.js`, `main.js`; tiny rule/edition text edits in `index.html`; the four existing test files; README's current-version link; this new report. Historical V1/V2 claims were retained. Raw results and screenshots are under `/tmp/frontline-v3-qa/`, `/tmp/frontline-v3-final.json` and `/tmp/frontline-v2-baseline.json`.

Work remains in the original `main` worktree. The pre-existing unrelated untracked `games/naiwa-run/` is preserved. No branch/worktree creation, stash, reset, commit, push, production change or deployment was performed.
