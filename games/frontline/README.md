# Frontline V1

Original, dependency-free Canvas 2D arcade game for randolf.dev. No commercial art, textures, sounds, models, branding, framework, backend, analytics, or account system.

Local preview: **http://localhost:8008/games/frontline/**

The preview server was left running from the repository root. To start it again:

```sh
python3 -m http.server 8008
```

## Files and architecture

Added in `games/frontline/`:

- `index.html`: accessible shell, navigation, canvas, compact HUD, status announcements.
- `frontline.css`: responsive near-black/lime site shell, mobile overlays, focus states.
- `content.js`: weapons, enemies, ten sector definitions, encounter templates, seeded generators.
- `engine.js`: browser-independent combat simulation, formation, progression within a run, boss patterns and effects.
- `render.js`: original procedural artwork, cached sprites, road scenery and canvas drawing.
- `main.js`: fixed 60 Hz simulation accumulator, input, menus, persistence, audio wiring and lifecycle handling.
- `tests/simulation.mjs`: deterministic generation, combat and balance checks; runs with Node without dependencies.
- `tests/browser.cjs`: Chromium/Playwright regression checks using an external test installation, not a site dependency.
- `README.md`: implementation and QA report.

Modified existing files:

- `games/index.html`: one Frontline release entry; existing layout retained.
- `assets/js/game-audio.js`: additive `GameAudio.fl` sound recipes. Existing recipes and Water Sort files remain unchanged.

## Rendering and combat

The logical battlefield is 420 × 760. Device pixel ratio is capped at 2. A cached scrolling road tile supplies cracks, rubble and subtle lane guides. Roadside rails and lights, shadows, foreground combat and upper fog give depth without 3D.

Scouts have cyan helmets, dark visors, armored torsos/backpacks, boots, short guns and ground shadows. Individual offsets and small bobs soften the formation. Firing shows recoil, muzzle flashes and luminous traveling projectiles. The renderer bakes these original procedural drawings into offscreen sprites once, avoiding repeated path construction in large battles.

Squad size caps at 60, with up to 30 visible scouts. Damage per visible scout scales beyond the display cap. Formation spacing and steering boundaries adapt to squad size. Projectiles and particles are bounded at 330 and 140 respectively.

Enemies use magenta/purple bodies, bright eyes and spikes. Grunts have compact rounded bodies; runners have pointed, low silhouettes and faster movement; brutes have broad arms and high health; elites have violet armor/halo outlines, health bars and shard attacks. Contacts remove scouts. Enemies that escape off-axis cost one scout, with a short shared damage grace period.

Weapons:

| State | Behavior |
| --- | --- |
| Pulse | Cyan single projectiles; 0.52-second volley interval |
| Repeater | Mint projectiles, faster travel; 0.29-second interval |
| Trident | Three gold projectiles per visible scout; 0.43-second interval |

Power and rate crates additionally improve damage/cadence within caps. Crates are always collected by crossing them with the squad's central rally marker, not by shooting. Guarded supply crates follow their guard until it dies. Blue boxes recruit or improve firepower; gold boxes upgrade weapons.

## Encounters, campaign and seeds

Reusable three-lane templates contain lane contents, threat/reward budgets and tags. No imperative per-level spawn scripts. Each campaign sector has a fixed duration, encounter skeleton, allowed enemy pool and boss. A seeded generator shuffles lanes and varies bounded group counts, offsets, squad rewards and small health differences.

The campaign is: First light, Supply line, Red rush, Heavy weather, Violet signal, The fracture, Narrow escape, Nightfall, Last relay and Daybreak. It introduces recruitment/weapon choices, runners, brutes, elites, guarded supplies, the second boss and mixed pressure. Sectors unlock sequentially. Progression is sector completion, not a permanent damage grind.

A sector's seed is saved when generated. Restart and reload reproduce its schedule. Clearing a sector unlocks an explicit **New layout** option; ordinary replay still keeps the old seed. The simulation uses a fixed step, so identical seeds plus identical timed inputs reproduce outcomes.

## Endless and bosses

A new expedition gets a fresh seed; result-screen replay preserves that run's seed. Every 45 seconds the generator advances a progression band, up to band 12. A growing threat budget admits more demanding encounter templates. Group size increases within bounds, late heavy/elite groups gain runner escorts, and spacing tightens from 7 to 4.6 seconds. Every fourth block is recovery. Templates leave at least one lane without spawned enemies. This is a structural fairness constraint, not proof that every possible overlapping situation is harmless.

The first Endless boss arrives at 75 seconds; subsequent bosses arrive 70 seconds after the previous defeat. Normal blocks pause during boss fights. Later bosses add escorts; supply drops continue. Best score, distance and defeated-boss count persist.

Iron Warden sweeps horizontally and marks the player's lane before a delayed strike. Rift Maw has a wider clawed silhouette, third eye, faster/wider movement and two-lane strikes below 65% health. Telegraphs last 1.35 seconds. Both have health bars, protected entrances, hit flashes, impact cues, death bursts and brief result delays. Low-weapon squads can receive weapon resupply during extended fights.

## Audio and storage

Frontline reuses the shared lazy AudioContext, master gain, noise buffer, voice cap and persisted sound toggle. Thirteen short cue recipes cover weapons, impacts, deaths, pickups, recruitment, upgrades, damage, boss arrival/warnings/strikes/death and results. Gunfire is rate-gated at 110 ms; no context is created per shot. There is no music.

Storage keys:

- `randolf:frontline:v1`: version, completed sectors, per-sector seeds, Endless best score/distance/boss count.
- `randolf:games:sound`: shared `on` / `off` preference.

Malformed or unavailable storage falls back safely. Reload resumes progress and seeds, not an in-progress battle.

## Controls and mobile

One-finger relative drag with pointer capture steers horizontally. Mouse drag and Left/Right or A/D also work. Space/Escape pause; Escape resumes from the pause panel. Pointer cancellation, focus loss and hidden-document events clear active control and pause. Returning to play requires an explicit resume.

The game fits portrait viewports without horizontal overflow. Controls are approximately 44–48 CSS pixels. Focus outlines and result announcements are provided. Reduced motion suppresses shake and character bobs/rotations; essential movement and attack telegraphs remain. Sound carries no exclusive gameplay information.

## QA actually performed

Chromium was launched locally through Playwright after the supplied Browser connection reported no available browser. The running page and captured screenshots were visually inspected, not just source reviewed.

Viewports tested and visually inspected:

- 360 × 800, mobile touch emulation, DPR 2.
- 390 × 844, mobile touch emulation, DPR 2; also a headed real-time touch-event run.
- 430 × 932, mobile touch emulation, DPR 2.
- 1440 × 1000 desktop, mouse and keyboard.

No horizontal overflow at the three phone sizes; canvas widths were 358, 388 and 428 CSS pixels. The sound/footer controls fit on screen.

Visual/gameplay iterations after opening the game:

1. Widened the tightly packed scout formation.
2. Added a dark backing to the weapon HUD so crates cannot obscure it.
3. Protected the boss entrance after simulation showed it could die before fighting.
4. Brought the first boss telegraph forward and added a short death-effects delay.
5. Corrected guarded crates that were overtaking their slower guards.
6. Darkened the menu backdrop to separate text from the battlefield.
7. Cached procedural character art after stress testing exposed draw stalls.
8. Added distinct claws and a third eye to Rift Maw.
9. Adjusted squad boundaries so large formations remain on the road.

Browser regression coverage: real touch-event drag, mouse drag, keyboard steering, autofire, projectile hits, enemy deaths/contact, visible squad growth, weapon upgrades, boss telegraph, win/loss panels, restart, pause/resume, sequential unlocks, locked sectors, cleared-sector regeneration, same-seed restart/reload, persisted sound state, Endless records and fresh/same-seed run behavior, reduced motion, and malformed-save recovery. Elite behavior and boss fights were also exercised in full-run simulation.

A headed Chromium run steered with real touch events for an entire first sector: victory at **97.55 game seconds**, 23 surviving scouts, 9 pickups, 2,817 projectiles and 443 hits. This used a simple automated steering policy, not a human phone playtest.

Lifecycle qualification: a synthetic hidden-document event verified the visibility handler. Minimizing the headed window exercised actual focus-loss pause. Automated background-tab switching did not expose a hidden document in this environment, so actual tab visibility transitions are not claimed as verified.

Randomness/gameplay simulation:

- **1,000 campaign layouts**: ten sectors × 100 seeds, stable reproduction, bounded contents/rewards, safe opening, recovery and an unoccupied threat lane per block.
- **8,000 Endless blocks**: budget eligibility, deterministic reproduction, regular recovery, bounded size.
- **300 complete campaign attempts** using a basic supply-seeking/dodging policy: 275 wins, 25 losses; early sectors 30/30 each, sector 9 22/30, sector 10 13/30.
- Winning times: sectors 1–7 about 88–105 seconds; sector 8 about 101–127; sector 9 about 103–120; sector 10 about 111–161.
- A **15-minute simulated Endless run** survived ten bosses, reached 10,799 m and the 60-scout cap; projectile count remained bounded. Expert/automated play can sustain long runs.
- Additional direct assertions: collision damage, defeat, all weapon states, recruitment/power/rate changes, boss warning/death, formation cap, and full same-seed/same-input state reproduction.

Performance on this desktop Chromium environment:

- Stress fixture: 60 scouts (30 visible), 48 enemies, 175 active projectiles.
- After caching: 240 draw calls measured **0.5 ms median / 1.7 ms p95** in the final pass. These are canvas draw-call timings, not a physical phone FPS guarantee.
- Before caching, the same style of synchronous stress test had roughly 1.7 ms median / 95.8 ms p95 stalls.
- A separate 120-frame headed sample measured 16.7 ms median and 33.4 ms p95 frame intervals.
- Fixed 60 Hz simulation, clamped 50 ms frame gaps, bounded particles/projectiles, cached scenery/sprites/formations and no DOM entities.

Audio QA: all 13 cue recipes rendered successfully through OfflineAudioContext, produced finite nonzero samples, and had unclipped standalone peaks (approximately 0.018–0.224 before the shared master gain). Playback was exercised in Chromium and the toggle persisted. **No auditory monitoring was available; the sounds were not listened to and subjective sound QA remains outstanding.**

Console: **zero page errors and zero console warnings in the final browser regression run**. Syntax checks and `git diff --check` passed.

## Running checks

```sh
node games/frontline/tests/simulation.mjs

# With a separately installed Playwright and local server on port 8008:
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node games/frontline/tests/browser.cjs
```

The browser suite expects `/usr/bin/google-chrome` and writes temporary screenshots/results under `/tmp/frontline-qa`. It uses isolated browser storage. A `?qa=1` diagnostic API exists only on localhost/127.0.0.1; no developer controls appear in the production UI.

## Known limits and repository status

- No physical iOS/Android or Safari test; mobile results are Chromium viewport/touch emulation.
- Subjective listening remains unverified; actual background-tab visibility could not be reproduced in the automation environment.
- Late sectors can exceed the target 120 seconds with weaker weapon choices. Layout tests and a steering heuristic cannot prove every seed fair or replace human balance feedback.
- Endless progression bands eventually cap; skilled players can sustain long runs. No mid-run save/resume.
- The battlefield is deliberately stylized procedural art, not illustration-level reproduction of the concept.

Final scope: new `games/frontline/` directory; modified `games/index.html` and `assets/js/game-audio.js`. CNAME, News, AI and every other game implementation remain unchanged. No commit or push was performed.
