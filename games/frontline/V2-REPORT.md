# Frontline V2 — pace and target priority

Review URL: **http://127.0.0.1:8018/games/frontline/**

V2 evolves the existing Canvas game. The ten sectors, two bosses, three weapons, procedural characters, site shell, controls, and module boundaries remain. No framework, dependencies for the site, commercial assets, economy, extra boss, commit, or push was added.

## Resumption and files

On resumption, the main V2 gameplay implementation, initial simulation work, and early/mid/late browser play evidence were already present as uncommitted changes. The V1 baseline tag remained intact. Work resumed from those edits; nothing was reset or discarded. Remaining work completed: Endless escalation play, migration/mastery checks, new-object visual fixtures, audio signal checks, maximum-density profiling, regression reruns, readable formatting, and this report.

Modified:

- `content.js`: pacing, existing sector skeletons, reusable horde compositions and resource generation.
- `engine.js`: nearest projectile intersection, panels, crates, footprint collision, warnings, revised boss cadence.
- `render.js`: panel/crate/drop art, warnings, crisp trails, cached procedural projectile sprites using the existing cache approach.
- `main.js`: additive save migration, mastery records, instructions, loopback-only QA sector selection.
- `index.html`, `frontline.css`: V2 instructions/edition and mastery text; established layout retained.
- `../../assets/js/game-audio.js`: five additive Frontline cues; existing recipes unchanged.
- `tests/simulation.mjs`, `tests/browser.cjs`: updated checks and local preview configuration.
- `README.md`: link to this report; historical V1 report retained below it.

Added: `tests/pilot.mjs`, `tests/browser-v2.cjs`, and this report. Tests use an external Playwright installation; no package/build system was added to the site.

## Combat and resources

Projectile speed is tuned separately from approach/cadence. Values are logical pixels per second:

| Weapon | V1 speed → V2 | V1 volley interval → V2 | V2 behavior |
| --- | --- | --- | --- |
| Pulse | 610 → 1040 | .52s → .44s | Single cyan shot, damage 1 |
| Repeater | 730 → 1420 | .29s → .24s | Fast mint shots, damage 1.25 |
| Trident | 650 → 1160 | .43s → .42s | Three gold shots, damage 1.15 each, ±.10-radian spread |

Base enemy speeds: grunt 37→49, runner 69→92, brute 26→32, elite 30→40. Progression adds at most 30% band speed plus 12% encounter-phase speed. Brutes remain distinctly slower. Resource approach is 80–94, versus V1's 66; boss entrance is 62 versus 44. Road scroll is 39 versus 31. This is not one global speed multiplier.

**Amplifiers:** every intersecting projectile adds exactly one, regardless of projectile damage. Mild starts are -4…-7 and cap at +8; deep starts -10…-14 and cap at +12; positive starts +2…+3 and cap at +6. A defensive lower bound is -16. Crossing applies the displayed value; negative values can defeat a small squad. Panels turn from red through neutral to cyan, bump/flash on hits, and announce crossing into positive. At cap they still intercept shots and display MAX: moving away is a real target-priority choice. Targets above y=55 cannot be farmed offscreen.

**Fixed supplies:** solid blue boxes, normally +2/+3; guarded risk supplies +4. Bullets pass through; their value never changes.

**Sealed upgrades:** braced boxes with an HP bar and numeric remaining HP. Weapon crates start at 14–26 HP across all bands; power/rate crates at 10–22. Player damage applies normally. At zero the box bursts and becomes a diamond pickup, with a brief .25-second release pause. Shooting does not automatically equip it. Crossing an unopened crate loses `ceil(remaining / maximum × 3)` scouts, bounded to 1–3; 1 HP costs one scout. Resource penalties cannot be bypassed using contact-damage grace.

Bullets travel along their visible trajectories. Swept segment/rectangle collision selects the first physical intersection among enemies, panels, crates and the boss. There is no target snapping or invisible lane lock. Supplies and released drops are transparent to fire. Panels and crates can shield enemies until the player moves or breaks them.

More scouts still mean more firepower and a wider footprint. Contacts with enemies, shards, resources and boss attack lanes use the visible formation. Squad cap remains 60, with 30 visible scouts and corresponding damage scaling. Pickups resolve once at the front collection line; a wide squad can reach neighboring safe rewards, but cannot sweep all lanes while a pickup travels through rear rows. This rule was tightened after testing revealed overly generous collection.

## Campaign, Endless and bosses

Campaign keeps its original names and sequential unlocks. Sector 1 develops the squad; 2 introduces amplifiers; 3 sealed crates/runners; 4 resource conflicts/brutes; 5 has three hordes; 6 introduces elite screens and Rift Maw; 7–10 layer four to six hordes with mixed packs, elites and resources. Early blocks breathe, later gaps tighten, and supply/recovery blocks separate pressure peaks. Campaign skeleton timing is designed; lane order, small counts, resource variants and minor stats are seeded.

Horde templates include grunt swarms, runner/grunt pressure, brute with runner escorts, elites behind grunt screens, staggered two-wave attacks, dual elite pressure and amplifier-versus-weapon-versus-horde choices. They reuse the existing lane/template generator; they are not imperative per-sector spawn scripts. Compositions occupy at most two enemy lanes per block and spawn above the visible battlefield. A resource may make the remaining lane risky; the structural rule does not prove every overlap harmless.

Endless advances bands every 32 seconds (V1: 45), to band 12. Budget rises from 3 to 22 and admits increasingly demanding templates. Regular gaps tighten from 6.3 to 3.5 seconds, with one extra second after a horde. Every fifth regular block is recovery; extra recovery precedes bosses. HP increases modestly and caps around 1.56× base, while composition, mixed lanes, approach speed and timing carry progression.

Iron Warden and Rift Maw retain their silhouettes, movement and telegraphed patterns. First Endless boss is planned at 52 seconds (V1: 75); subsequent bosses at 43 seconds after the previous defeat (V1: 70). Normal generation stops seven seconds before the planned arrival, offers recovery and warns. Bosses wait until unresolved enemies and shards clear. Campaign uses its final recovery followed by a short warning; it no longer waits through an unnecessary empty tail. Arrival can still be delayed by an uncleared road. Campaign boss HP is 600 + sectorIndex×145 to match greater firepower; Endless boss HP is 700 + defeated×320, capped at 3100. Later Endless bosses retain runner/elite escorts with offscreen entrances.

## Saves and replay records

The same `randolf:frontline:v1` key and version 1 remain. Completed sectors, unlocked progression, stored numerical seeds and Endless best score/distance/boss count survive. A validated optional `mastery` map adds best survivors and fastest completion per sector. These two records are independent bests, not necessarily from the same run. Failed runs do not overwrite campaign mastery; worse replays do not degrade it.

`randolf:games:sound` remains the shared on/off preference. No other storage key was introduced. Old seed numbers persist, but V2's changed generator produces V2 layouts: this is save compatibility, not preservation of V1 geometry. Within V2, restart/reload retain layouts; cleared-sector New layout remains explicit. No mid-run save was added.

## Generation and simulation evidence

The checked-in simulation suite extracts `content.js` and `engine.js` read-only from `frontline-v1-baseline` into a temporary directory. The same steering policy runs V1 and V2; no checkout/reset occurs. Samples: 1,000 Campaign layouts, 18,000 Endless blocks, 300 complete Campaign attempts per version, and three six-minute Endless attempts per version. Checks cover determinism, bounds, openings, recovery, budget eligibility, offscreen spawns, target ordering, panel signs/caps, crate release/collision, formation exposure, elites, boss waiting, frame clamping and full same-input state reproduction.

| Sector | Mean enemies V1 → V2 | V2 hordes | Shootable resource/conflict blocks | Mean winning seconds V1 → V2 | V2 wins | Mean V2 survivors on wins |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 9.0 → 21.8 | 0 | 0 | 83.6 → 74.8 | 30/30 | 17.2 |
| 2 | 12.0 → 21.6 | 0 | 3 | 84.3 → 78.1 | 30/30 | 27.1 |
| 3 | 13.6 → 22.8 | 0 | 4 | 87.6 → 78.5 | 30/30 | 24.4 |
| 4 | 13.0 → 23.2 | 0 | 6 | 89.0 → 78.5 | 30/30 | 31.5 |
| 5 | 12.0 → 40.5 | 3 | 6 | 91.1 → 84.0 | 30/30 | 33.2 |
| 6 | 13.9 → 45.5 | 3 | 7 | 96.3 → 96.3 | 25/30 | 22.4 |
| 7 | 18.6 → 54.6 | 4 | 6 | 95.2 → 85.7 | 29/30 | 39.8 |
| 8 | 17.7 → 64.1 | 5 | 7 | 103.5 → 88.0 | 26/30 | 43.0 |
| 9 | 21.1 → 74.5 | 6 | 7 | 108.4 → 90.1 | 27/30 | 46.5 |
| 10 | 21.7 → 72.4 | 6 | 8 | 118.5 → 93.1 | 28/30 | 45.1 |

Horde count is fixed by Campaign identity; enemy counts/positions vary. Campaign V2 win rate under this heuristic was 285/300 versus V1 273/300. The mean of sector mean winning times was 84.7s versus 95.8s. **More activity does not imply a higher failure rate:** rewards and responsiveness also improve survival. These are policy results, not player difficulty ratings.

| Endless band | Mean enemies/block | p95 / maximum enemies | Horde blocks | Blocks with elite | Shootable resource conflicts | Recovery |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 2.44 | 5 / 6 | 0% | 0% | 36.8% | 20% |
| 1 | 2.23 | 5 / 6 | 0% | 0% | 46.4% | 20% |
| 2 | 4.48 | 9 / 9 | 39.8% | 5.4% | 25.8% | 20% |
| 4 | 5.70 | 12 / 13 | 46.4% | 12.8% | 49.6% | 20% |
| 7 | 6.68 | 12 / 13 | 59.0% | 19.0% | 49.8% | 20% |
| 12 | 7.74 | 13 / 14 | 62.6% | 20.2% | 49.8% | 20% |

Each band samples 100 seeds × 30 blocks; boss pauses are excluded. The small band-1 dip is real: new choices do not all contain more enemies. Horde entry at band 2 drives the marked escalation. Recovery remains regular; there is no monotonic HP multiplier.

Campaign amplifier starts: min -14, mean -4.89, p95/max +3. Crate HP: min 11, mean 17.75, p95 22, max 24. An isolated five-scout Pulse squad can turn a -14 test panel into +12 before crossing; this is an achievable upper bound under uninterrupted focus, not expected growth during combat. Campaign mean winning survivors rise from 17.2 in sector 1 to 45.1 in sector 10; cap 60 prevents unbounded growth.

In six-minute Endless simulations, all three seeds survived, with 21–24 hordes and six bosses defeated versus four V1 bosses. V2 peak simultaneous enemies were 14–19 versus 5–6; losses were 7–18 versus 1–4. A well-developed squad can still sustain long runs. This remains an arcade growth game, not inevitable attrition.

Visible enemies plus shootable resources occupied about 20–47% of sampled mid/late Campaign time. A sector-8 seed compared idle/combat/resource/balanced policies: resource priority lost 19 scouts and won at 87.9s; combat priority lost five and won at 85.6s; balanced lost 13 and won at 97.0s; idle had not finished at 180s. That demonstrates that allocation changes outcomes, not that one policy is globally optimal.

Empty-screen time fell in most sectors, including sector 5 from about 34% to 19% and sector 8 from 20% to 14%. Sectors 9/10 still had approximately 15%/13% versus V1 13%/13%: strong squads can clear the larger packs quickly. This tail is not hidden by the overall averages.

## Browser play and visual QA

The available Browser connection had no connected browser. Local Chromium was opened with external Playwright, pages were interacted with, and screenshots were actually viewed. These runs use a controlled browser clock: decisions were made from the running scene and sent as CDP touch events. They are **clock-assisted agent play, not real-time human phone play**. Later sectors were selected through the loopback-only QA API; health, equipment and enemy damage were not cheated during these play runs. Endless includes automated steering chunks between manually chosen actions.

| Run | Result | Evidence |
| --- | --- | --- |
| Sector 1 | Won, 77.17s, 23 survivors | Growth/weapon lane choices, first boss dodge; before final empty-tail adjustment |
| Sector 5, seed 17 | Won, 83.92s, 40 survivors | Three hordes, four crates broken, +22 panel recruits, one breach; before final empty-tail adjustment |
| Sector 10, seed 31 | Won, 88.35s, 60 survivors | Six hordes, five crates broken, +46 panel recruits; after empty-tail adjustment |
| Endless, seed 9 | Playing at 182.98s, 2195m, 60 survivors | Seven hordes, three bosses defeated, three crates broken, 11 scouts lost |

Observed decisions included switching off a capped amplifier so bullets could reach threats, leaving a negative panel to secure Trident, accepting a one-scout breach rather than steering into a runner, abandoning a late reward to focus two elites, and leaving a marked boss lane. Chasing Rift Maw without checking its warning lost scouts. Large late squads made mistakes less costly and sometimes erased packs quickly; this is why no claim of universally harder or “more fun” is made.

Visual iterations included distinct chamfered amplifier, braced crate and diamond drop shapes; signed large numbers and red/neutral/cyan transitions; restrained number flashes; longer projectile trails; compact warnings; and a countdown instead of misleading “clear the road” text while an already-cleared road awaited the boss. The post-clear wait was shortened after mid-sector play. Existing soldiers/monsters/road and the visual direction were preserved.

Actually tested and visually inspected: **360×800, 390×844, 430×932, desktop 1440×1000**. New staged fixtures include 48 scouts, mixed enemies, negative/positive panels, damaged crate with 13 HP remaining, fixed supply and released weapon together. Separate boss/elite/runner fixtures and live boss runs were viewed. No horizontal overflow; mobile canvas widths 358/388/428 CSS pixels and footer controls fit. Phone tests are Chromium touch/viewport emulation, not physical iOS/Android or Safari.

Browser regressions passed for touch, mouse, keyboard, pause/resume, autofire, hits/deaths, squad growth, all weapons, collisions, elite simulation, boss telegraph/victory, defeat/results, campaign unlocks, locked sectors, restart/reload seed persistence, new-layout behavior, Endless same/fresh seeds and records, sound preference, reduced motion, additive V1 migration, mastery improvement/non-regression/reload, panel sign transitions and crate release/collection. Visibility handling was tested with a synthetic hidden-document event; actual OS/background-tab visibility is not claimed as verified.

## Performance and audio

Maximum frozen rendering fixture (simulation paused): 60 scouts (30 visible), 48 enemies, six shootable resources, 330 bullets and 140 particles, DPR 2. Instrumenting the actual RAF render gave **1.0ms median / 1.4ms p95 / 3.4ms worst draw-call CPU time**. Frame start intervals in that sample were **30.9ms median / 34.3ms p95 / 35.8ms worst**; a separate RAF sample reached a worst 50ms. Thus the extreme fixture was around 30 FPS in this headless environment, not a demonstrated 60 FPS physical-phone result.

Separately, 300 Node CPU samples exercised one full simulation step with the same 60/48/6/330/140 peak counts, rebuilding fixtures outside the timer: **1.51ms median / 2.08ms p95 / 2.53ms worst**. This isolates collision/update cost; it is not an end-to-end physical phone benchmark.

An initial synchronous loop queued 300 renders without yielding and produced raster-backlog stalls around 0.5 seconds. The test was corrected to observe the actual RAF draw once per frame. An intermediate test accidentally drew a second frame per RAF; those doubled-work intervals are not the final figures. Cached projectile artwork keeps repeated strokes out of the draw loop, but no isolated hardware FPS gain is claimed. The extreme fixture is intentionally much denser and noisier than generated encounters; it is not a shipped encounter pattern. Existing fixed-step simulation, frame clamp, entity caps and sprite caching remain.

Five new shared-audio Frontline recipes: panel hit (140ms gate), crossing into positive (250ms), crate hit (140ms), crate break plus release chime (200ms), horde warning (1200ms). Existing sound architecture and other games' recipes were preserved. Five OfflineAudioContext renders were finite, nonzero and unclipped, with standalone peaks approximately .032–.087. A 100-hit burst added at most one voice. Playback and persisted toggle were exercised. **No auditory monitoring was available: sounds were not listened to; subjective sound QA remains open.**

Final browser suites reported **zero page errors, zero console errors and zero console warnings**. JS syntax and `git diff --check` passed.

## Reproduction and remaining limits

From the repository root:

```sh
python3 -m http.server 8018 --bind 127.0.0.1
node games/frontline/tests/simulation.mjs
PLAYWRIGHT_MODULE=/tmp/frontline-qa/node_modules/playwright node games/frontline/tests/browser.cjs
PLAYWRIGHT_MODULE=/tmp/frontline-qa/node_modules/playwright node games/frontline/tests/browser-v2.cjs
```

The local server is left running at the review URL. Browser tests assume `/usr/bin/google-chrome`; Playwright is outside the repository. Temporary screenshots, JSON distributions and play notes are under `/tmp/frontline-v2-qa/`. The `?qa=1` hook is restricted to localhost/127.0.0.1 and adds no production UI.

Remaining limits: subjective listening, physical-device/Safari performance, actual background-tab visibility, real-time human balance validation, and very-late maxed-squad difficulty. Progression bands cap; a skilled player may survive indefinitely. Automated structural constraints and sampled seeds do not prove every overlapping encounter fair. The final implementation was stopped here rather than expanding content or adding an economy.

Repository scope at handoff: only the Frontline files listed above plus additive shared Frontline audio are our changes. The unrelated untracked `.playwright-mcp/`, four `cs-qa-*.png` screenshots and `games/core-shift/` were already present on resumption and were left untouched. Baseline tag `frontline-v1-baseline` exists; no reset, commit or push was performed. CNAME, News, AI, games index and other games were not edited in this pass.

Final `git status --short` snapshot:

```text
 M assets/js/game-audio.js
 M games/frontline/README.md
 M games/frontline/content.js
 M games/frontline/engine.js
 M games/frontline/frontline.css
 M games/frontline/index.html
 M games/frontline/main.js
 M games/frontline/render.js
 M games/frontline/tests/browser.cjs
 M games/frontline/tests/simulation.mjs
?? .playwright-mcp/
?? cs-qa-01-initial.png
?? cs-qa-02-full.png
?? cs-qa-03-docked.png
?? cs-qa-04-result.png
?? games/core-shift/
?? games/frontline/V2-REPORT.md
?? games/frontline/tests/browser-v2.cjs
?? games/frontline/tests/pilot.mjs
```
