# Signal Stack — Phase 4 final production report

Date: 2026-10-03. Release candidate for final human acceptance, held in the
working tree for the user's later multi-game batch. No Git status inspection,
reset, restore, stash, clean, branch operation, commit, push, deployment or
`games/index.html` integration was performed. No other game was modified.

## Scope and maintained baseline

The accepted gameplay engine is unchanged, including swing/release, gravity,
support/pivot collision, Perfect tolerance, score/combo, difficulty, three
integrity points and camera rules. `engine.js`, the original `tests.mjs`,
`render-tests.mjs` and `render/coordinates.js` retain their starting SHA-256
hashes. There is no new game mode, progression system, backend or music.

Phase 3 module geometry, six-family assignment, environment composition,
altitude progression, camera projection and Bloom art direction are retained.
The only new scene feedback is a restrained signal-energy dip after integrity
loss and a short final signal fade. Optional altitude labels were omitted to
keep the accepted HUD uncluttered.

## Files changed

Modified:

- `../../assets/js/game-audio.js`: additive `GameAudio.ss` cue family; shared
  source cleanup disconnects ended nodes and guards against double completion.
- `index.html`, `signal-stack.css`: compact Sound control, result semantics,
  optional run-best Perfect streak, reconnect label and explicit reload link.
- `main.js`: audio/event wiring, timing, visibility, delayed result, focus,
  storage synchronization, context loss/recovery and teardown.
- `input.js`: small tested gate for pointer contact, rapid taps, held keys and
  focus/resume quarantine; Pointer Events remain the sole canvas pointer input.
- `renderer.js`: presentation energy, context-resource cleanup/recovery,
  unchanged scene/render architecture.
- `render/hud.js`, `render/lighting.js`: result timing/streak and signal strength.
- `render/visual-state.js`: resilient quality sampling.
- `render/modules.js`, `render/environment.js`, `render/effects.js`: separate
  GPU release from final disposal, retaining CPU resources across context loss.
- `visual-browser-checks.py`: target identity checks use texture UUIDs; r186
  RenderTarget itself does not expose a UUID.
- `README.md`: launch/test entry point and release documentation links.

Created:

- `audio.js`: shared preference adapter and run audio event ownership.
- `lifecycle.js`: pure frame clock and run presentation timing.
- `production-tests.mjs`: non-WebGL production regression tests.
- `production-browser-checks.py`: live/offline Web Audio, event lifecycle,
  storage, input, result focus and 50-restart renderer checks.
- `resilience-browser-checks.py`: real context loss/recovery/cleanup,
  first-gesture unlock, shared-audio smoke regression and cross-tab preference.
- `docs/final-report.md`, `docs/physical-device-checklist.md`.

Generated screenshots and JSON/text logs live in ignored `qa/`, not runtime
assets. Existing harnesses retain their historical Phase 2/3 artifact names.

## Architecture and dependencies

Static browser ES modules with one RAF in `main.js`. No build/install step,
CDN, asset request to a third party, backend or runtime package manager.
The engine advances at its accepted 1/240 s fixed step. The outer FrameClock
only bounds real-time input; the renderer and audio never decide collisions.

The renderer remains **Three.js r186 WebGLRenderer / WebGL 2**. The off-axis
PerspectiveCamera maps the z=0 collision plane to the accepted logical grid;
module depth extends behind it. DPR remains capped at 1.5. Renderer-owned
WeakMap IDs and binary-search culling feed a pool capped at 32 assemblies.
All six families share their geometry/material batches; each pool slot owns
one independently pulsed signal material. The full engine tower remains in CPU
memory (linear in successful floors); GPU/scene/effect counts are bounded.

Local core and ten official addons are unchanged. Provenance and SHA-256
checksums: [vendor/three/README.md](../vendor/three/README.md) and
[vendor/three/SHA256SUMS](../vendor/three/SHA256SUMS). The import map resolves
all addons to the same local r186 core.

Gameplay is adapted from [iamkun/tower_game](https://github.com/iamkun/tower_game):
`hook.js` pendulum/release, `block.js` / `line.js` support and edge pivot,
`utils.js` Perfect/streak scoring and height difficulty, and `animateFuncs.js`
placement/camera progression inspiration. No upstream assets, UI, branding or
build dependencies are included. The retained upstream MIT license credits
2018 BMQB, Inc: [LICENSE-tower-game.txt](../LICENSE-tower-game.txt).
Three.js core/addons retain the three.js authors' MIT license:
[LICENSE-three.txt](../LICENSE-three.txt). Sound is repository-owned synthesis;
there are no licensed audio recordings or background tracks to distribute.

## Gameplay and visual pipeline

One tap/click or Space/Enter releases the suspended module. Complete misses and
unsupported edges consume one integrity after the failed module leaves view.
Perfect snaps to the previous center and extends the streak. Score remains
25 base plus 25 per consecutive Perfect. Difficulty changes at heights 5, 10
and 20, then stops escalating. Three failures end the run.

Six existing families: RELAY, COOLING, STRUCTURE, POWER, ARRAY and CORE. Early
floors retain the Relay/Cooling/Structure sequence; mature floors rotate through
the accepted eight-entry pattern. Core appears at floors 13, 30, 47….
Families have identical gameplay footprints. Failed placements do not advance
the visual sequence.

The existing environment uses 52 far and 14 near buildings, instanced city
batches, procedural window atlas, mountains/haze, moon, 350 stars, four beams
and twelve shared-texture cloud cards. Continuous altitude anchors remain at
0 / 8 / 18 / 30 / 46 floors: CITY / SKYLINE / CLOUDS / UPPER ATMOSPHERE /
NEAR SPACE. Parallax and visual interpolation remain unchanged.

RenderPass → UnrealBloomPass → OutputPass. Bloom strength .17, radius .12,
threshold 1.65; ACES exposure 1.15 and sRGB output. The DOM HUD is outside the
compositor. No major shake, glow increase, new archetypes or camera changes.

Perfect remains a 340 ms event: snap/connector rise, ring from about 45 ms,
downward pulse from about 80 ms, existing HUD/combo feedback. The matching
Perfect audio is triggered from the same landed event, with a confirmation
attack at 12 ms and a second partial at 70 ms. Normal landings get a smaller
mechanical transient and do not trigger Perfect effects.

## Sound and persistence

All synthesis uses `assets/js/game-audio.js`, its lazy AudioContext and master
gain. Signal Stack adds seven reusable recipes in the `ss` namespace:

| Cue | Character / timing |
| --- | --- |
| Connect/reconnect | Low relay engagement plus short signal confirmation, ~220 ms |
| Normal landing | Low mechanical weight, filtered contact noise, quiet confirmation, ~130 ms |
| Perfect + combo | Stronger contact plus two clean high partials, ~290 ms |
| Edge slip | Short descending filtered contact texture, ~120 ms |
| Complete miss | Falling signal tone and low filtered air, ~200 ms |
| Integrity loss | Restrained descending confirmation, ~165 ms |
| Signal Lost | Low shutdown and fading signal, ~300 ms |

The Perfect pitch factor increases by a half-semitone per streak step and
caps at streak eight (factor about 1.224; upper confirmation about 2,020 Hz).
No background music. Nodes are created only for events, never for RAF updates.
Only a user gesture creates/resumes the context. An epoch cancels late unlock
callbacks after pause/reset; suspended/hidden cues are discarded, not queued.
Ended and interrupted sources disconnect and release bookkeeping immediately.
A fixed set of seven recipe/gate keys prevents combo/run-dependent key growth.

| Key | Contents |
| --- | --- |
| `randolf:signal-stack:v1` | `bestHeight`, `bestScore`, `bestCombo`, `gamesPlayed` |
| `randolf:games:sound` | Shared `on` / `off`, default on |

Records are sanitized; unavailable/corrupt storage falls back safely. Sound uses
`GameAudio.isEnabled()` / `setEnabled()`; there is no separate game sound key.
The 44 px-high header control exposes `aria-pressed`, persists across restarts
and reloads, and follows cross-tab storage changes without releasing a module.

## Start, loss and restart

The initial scene immediately shows SIGNAL STACK and TAP TO DROP. First input
unlocks sound and releases the current module; there is no splash interception.

After the final failed module exits, the engine is already stopped. Independent
presentation time fades signal energy over 240 ms and locks reconnect for
320 ms, then reveals SIGNAL LOST, height, best, score, an optional nonzero
run-best Perfect streak, and TAP TO RECONNECT. The overlay has a named DOM
region. Keyboard focus moves from the playfield to reconnect when it appears;
focus on Sound/site navigation is not stolen.

Reconnect resets the engine, pending events, combo/integrity, active module,
feedback, ring/sparks, environment interpolation, camera, temporary lighting,
presentation time and audio state. It reuses the existing module pool and
Composer targets. Records, games played and shared sound preference survive;
games played increments only on the first release, not on reset. No reload.

## Timing, quality and background behavior

FrameClock discards initial timestamps and gaps over 250 ms, clamps other
simulation deltas to the existing 100 ms maximum, and discards all hidden/blur
intervals. Visibility, focus and BFCache handlers clear held input and sound
voices. A 150 ms input quarantine after restoration avoids stale focus gestures;
normal play resumes with a fresh timing sample. No accumulated audio is replayed.

Quality starts at the accepted full configuration. Pause/resize/discontinuity
resets sampling. A two-second warm-up precedes a minimum two-second / 30-frame
window; at least 80% of samples must exceed 36 ms, and the window average must
also exceed 36 ms. Isolated slow frames cannot trigger fallback. Gaps above
250 ms are excluded and restart warm-up. Fallback disables Bloom, frees its
13 targets, reduces clouds to six and disables sparks. It never changes engine
rules or simulation speed. Degradation stays sticky for the page's renderer
lifetime (including reconnects), avoiding quality oscillation and target churn.
Reload restores the default. Missing HDR support and compositor exceptions keep
the existing direct-render fallback.

## WebGL recovery

Context loss calls `preventDefault`, locks gameplay, stops voices, saves
records and displays a useful recovery message with an explicit reload link.
GPU disposal listeners/resources are released while GL is lost, before old
handles could be deleted against a restored context. CPU geometry/textures,
scene objects, engine state and visual timelines remain available.

On restoration Three reuploads retained resources and the compositor is
recreated. A redundant resize does not call engine.setViewport, so an in-progress
camera ease does not snap. If restoration fails, the readable reload instruction
remains. Reload preserves saved records but cannot preserve the unfinished run.
No vendor modifications or renderer architecture replacement were required.

## Accessibility and reduced motion

Canvas has a meaningful button name and keyboard Space/Enter support. Canvas,
links, Sound and reconnect have visible keyboard focus. Major landed, integrity
and result events use one polite live region; animation frames do not write live
announcements. The Sound state and remaining integrity have explicit accessible
states/names. Result focus returns to the playfield on reconnect.

Reduced motion preserves required feedback: the accepted shorter (~180 ms)
Perfect pulse and near-static ring, no sparks or combo scale, restrained cloud
and star drift, and no unnecessary detached-module spin. The single integrity
dip/final fade does not repeatedly flash. Real screen-reader usability remains
part of the physical-device checklist.

## Verification

All **54 Node tests pass**: original Phase 1 20, Phase 2 11, Phase 3 11, and
12 new production regressions. Command from the repository root:

```sh
node --test games/signal-stack/tests.mjs games/signal-stack/render-tests.mjs games/signal-stack/visual-tests.mjs games/signal-stack/production-tests.mjs
```

New tests cover real shared preference state/default/blocked storage, audio event
ownership and late-unlock cancellation, timing pause/clamp, final presentation
reset, quality hysteresis, input deduplication, 50 engine/effect restart cycles,
and persistent record bookkeeping. No full mocked audio/WebGL implementation.

Browser checks use installed Chrome 152 / Playwright with actual WebGL and Web
Audio. This environment identifies its GPU as ANGLE Vulkan SwiftShader. It is
not a physical phone or a hardware GPU performance acceptance result.

- Existing browser suite: 360×800, 390×844, 430×932 and 1280×900; 10+ floors,
  Perfect, both edge failures, complete miss, result/reconnect, keyboard/touch,
  resize, records, reduced motion, blocked storage and corrupt storage passed.
- Screenshots inspected for title/HUD/Sound/integrity, active module, canvas,
  TAP TO DROP, game-over overlay and no horizontal overflow. All four primary
  sizes preserve the portrait framing; safe-area CSS is retained. Actual notch
  insets/browser chrome need physical-device checks.
- Existing visual suite repeated: all altitude bands, six families, Perfect
  progression, normal landing, reduced motion, Bloom on/off, viewport changes,
  restart and resource disposal passed.
- All four quality cases passed: configured off, HDR unavailable, compositor
  exception and sustained slow frames. Default quality was not reduced in
  response to software-GPU FPS.
- Lifecycle checks include unavailable WebGL and readable fallback. Targeted
  real loss/restoration verifies three cycles, unchanged run/camera, recreated
  compositor targets, successful rendered output and clean teardown.
- Real AudioContext first-gesture path and all seven OfflineAudioContext recipes
  passed. Peaks were below 0.21 before the shared master gain, all samples finite,
  and the final 40 ms of each 500 ms render was silent. Streak 8 and 10,000 used
  identical capped tone frequencies. Shared tone/noise cleanup smoke checks
  also covered existing Minesweeper/Core Shift/Reversi recipes.

**Audio limitation:** these measurements prove cue execution, bounded envelopes,
cleanup and lack of exceptions. Synthetic/offline rendering is not listening on
real speakers and does not establish subjective sound quality or comfort.

## Long-run observations

| Run | Allocated modules | Scene objects | GPU geometries | Textures | Composer targets |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full quality, floors 30 / 60 / 90 / 120 | 11 | 111 | 44 | 21 | 13 |
| Bloom off, floors 20 / 100 / 500 / 1,000 | 11 | 111 | 41 | 8 | 0 |
| Full quality, restart 10 / 20 / 30 / 40 / 50 | 3 | 57 | 24 | 21 | 13 |

The 120-floor test retains normal production visual settings with automatic
fallback disabled solely to keep Bloom on throughout deterministic stress.
It submits active/contact/settled frames. The 1,000-floor test repeats the
existing Bloom-off renderer bookkeeping strategy; it is not a full-quality
1,000-floor performance claim. Different geometry counts reflect which
variants/effects have been uploaded, not continuing growth.

The 50 restart cycles each include a Perfect and left/right/complete failures
(150 failures total), with real engine ticks and selected rendered checkpoints.
Module/scene/geometry/texture counts are stable at all sampled restart cycles.
Ring, particles and Perfect timeline return to zero; environment returns to
altitude zero. Composer texture identities survive ordinary restart/resize.
Engine records preserve the previously completed games and best results.

Separate 50-cycle audio stress peaked at **14 simultaneous voices**, returned
to **0**, retained **7** recipe keys, and used **1** live AudioContext. Perfect
uses at most 24 reusable spark vertices and one ring/timeline. Final ordinary
renderer teardown reports zero geometries/scene children. The one internal
Three DFG LUT texture noted in Phase 3 remains a library-owned resource; app
textures are released. These are resource-count observations, not a heap
profiler proof of zero allocation or a phone battery measurement.

Evidence: `qa/phase4-node-results.txt`, `phase4-gameplay-results.json`,
`phase4-production-results.json`, `phase4-resilience-results.json`,
`phase4-lifecycle-results.json`, `phase4-thousand-results.json`, plus repeated
`phase3-results.json` and `phase3-quality-results.json`. Screenshots include
`{360,390,430,1280}-{ready,tower,gameover}.png`, Phase 3 visual states, and
`phase4-context-restored.png` and `phase4-390-streak-result.png`.

## Remaining acceptance and launch

[Physical-device checklist](physical-device-checklist.md) is explicitly pending:
iPhone/Safari, Android hardware frame smoothness/tap latency, speaker sound,
heating/battery, actual safe areas, OS interruption/lock/unlock and assistive
technology. No physical iPhone/Android pass or target FPS is claimed.

From `/home/randolph/Documents/randolf.dev`:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/games/signal-stack/>. The game is ready for final
human acceptance of this local release candidate. Commit/push/site integration
remain with the user's later batch.
