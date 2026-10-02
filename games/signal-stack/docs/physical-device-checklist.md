# Signal Stack — physical-device acceptance

**Pending. None of these checks has been signed off on physical phone hardware.**
Desktop Chrome touch emulation and software GPU results do not establish phone
performance, Safari compatibility, speaker quality, heating or battery use.

Record device / OS / browser version / date / tester / sound output / result:

`_______________________________________________________________`

Serve the repository on an accessible local network or use the user's later
approved deployment. Open `/games/signal-stack/` directly; the games index does
not list it yet. No production deployment is part of this checklist.

- [ ] Cold load: title, HUD, base, suspended module and TAP TO DROP are readable;
  no blank canvas, clipped controls or unexpected page movement.
- [ ] First tap drops immediately. No splash tap is consumed. Enabled audio
  unlocks on a real tap; repeat with sound initially off.
- [ ] Tap latency feels immediate. One tap releases once; double tap / long
  touch / two fingers never release the following module. Sound never drops it.
- [ ] Play at least 10 successful floors; compare normal and Perfect feedback.
  Increasing Perfect pitch remains restrained, including long streaks.
- [ ] Listen to normal landing, Perfect/combo, both edge slips, complete miss,
  integrity loss, connect/reconnect and final Signal Lost on phone speakers.
  Check comfortable volume, no harsh transient, clipping, clicks or music.
- [ ] Lose one integrity: one pip disappears once; brief signal dip and cue are
  distinct from game over; the next module stays visible.
- [ ] Reach the cloud layer (around floors 18–20); inspect module contrast,
  city transition, cloud softness and Bloom. Check upper atmosphere if possible.
- [ ] Play for 5–10 minutes: note sustained smoothness, hitching, input latency,
  any fallback in glow/cloud detail, obvious heating and battery-heavy behavior.
  Record observations; do not infer an FPS value without measurement.
- [ ] Background for 30 seconds while swinging, falling and during final loss.
  Return without a physics jump, lost integrity, stale tap or audio burst.
- [ ] Lock/unlock the phone and interrupt audio (e.g. another media app).
  A fresh gesture should restore available sound without restarting the run.
- [ ] Rotate portrait → landscape → portrait; expand/collapse browser chrome.
  Height/integrity remain unchanged and the active module is visible. Short
  landscape may scroll; primary portrait layout must remain comfortable.
- [ ] Zero integrity: failed module leaves view, signal fades briefly, then
  SIGNAL LOST / height / best / optional streak / TAP TO RECONNECT are readable.
- [ ] Reconnect repeatedly: no reload or stale particles, combo, lights, camera
  or altitude. Best height/score/combo and games played remain stored.
- [ ] Toggle Sound during play and after reconnect; reload and verify the
  choice persists. Check another shared-audio randolf.dev game uses that choice.
- [ ] Enable OS reduced motion: particles and combo scaling disappear, cloud
  drift is restrained, short Perfect feedback and gameplay remain clear.
- [ ] With VoiceOver/TalkBack and external keyboard if available: meaningful
  canvas name; Sound state announced; Space/Enter work; result and reconnect
  are discoverable; announcements happen on events, never continuously.
- [ ] iPhone Safari: repeat cold autoplay unlock, silent-mode/volume checks,
  lock/unlock, app switching, back/forward cache return, safe-area around the
  notch/home indicator, address-bar resize, reduced motion and 10+ floors.
  Record any AudioContext interruption or WebGL recovery problem separately.

Failures / device notes / screenshots reference:

`_______________________________________________________________`
