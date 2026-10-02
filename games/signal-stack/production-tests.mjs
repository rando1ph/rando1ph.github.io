import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, State } from './engine.js';
import { FrameClock, RunPresentation } from './lifecycle.js';
import { SignalAudio, SOUND_KEY } from './audio.js';
import { InputGate } from './input.js';
import { QualityState } from './render/visual-state.js';
import { loadRecords, saveRecords } from './storage.js';
import * as THREE from './vendor/three/three.module.js';
import { createEffects } from './render/effects.js';
import { createLighting } from './render/lighting.js';
import { ModulePool, ModuleRegistry } from './render/bookkeeping.js';

const source = readFileSync(new URL('../../assets/js/game-audio.js', import.meta.url), 'utf8');
function sharedAudio(raw, blocked = false) {
  const values = new Map([[SOUND_KEY, raw]]);
  const storage = { getItem: k => { if (blocked) throw Error('blocked'); return values.get(k); },
    setItem: (k, v) => { if (blocked) throw Error('blocked'); values.set(k, v); } };
  const context = vm.createContext({ localStorage: storage, document: { hidden: false } });
  vm.runInContext(source, context);
  return { audio: context.GameAudio, values };
}
function audioSpy() {
  const calls = [];
  const shared = { isEnabled: () => true, ss: { unlock: async () => true } };
  for (const key of ['connect', 'land', 'perfect', 'slip', 'miss', 'integrity', 'lost', 'stop'])
    shared.ss[key] = (...args) => calls.push([key, ...args]);
  return { audio: new SignalAudio(shared), calls, shared };
}

test('shared sound defaults on; off persists through adapter and run reset', () => {
  for (const raw of [null, undefined, 'on', 'broken']) assert.equal(sharedAudio(raw).audio.isEnabled(), true);
  const { audio, values } = sharedAudio('off');
  const run = new SignalAudio(audio);
  assert.equal(run.enabled, false);
  run.setEnabled(true); assert.equal(values.get(SOUND_KEY), 'on');
  run.reset(); assert.equal(run.enabled, true);
  run.setEnabled(false); run.reset(); assert.equal(values.get(SOUND_KEY), 'off');
  assert.equal(audio.ss.diagnostics().contextState, 'uncreated');
  assert.equal(values.size, 1);
});
test('blocked preference storage and unavailable Web Audio never break play', async () => {
  const { audio } = sharedAudio(null, true);
  audio.setEnabled(false); audio.setEnabled(true);
  assert.equal(await audio.ss.unlock(), false);
  audio.ss.perfect(999); audio.ss.stop();
  assert.equal(audio.ss.diagnostics().voices, 0);
});
test('audio failure is one cue per module, including pause/resume during a slip', () => {
  const { audio, calls } = audioSpy(), e = new Engine();
  e.state = State.FALLING_LEFT;
  for (let i = 0; i < 10; i++) audio.observe(e);
  audio.silence(); audio.observe(e);
  assert.equal(calls.filter(c => c[0] === 'slip').length, 1);
  e.spawn(); e.state = State.MISSED; audio.observe(e);
  audio.event({ type: 'missed', integrity: 2 }, e);
  audio.event({ type: 'missed', integrity: 0 }, e);
  audio.event({ type: 'gameover' }, e);
  assert.equal(calls.filter(c => c[0] === 'miss').length, 1);
  assert.equal(calls.filter(c => c[0] === 'integrity').length, 1);
  assert.equal(calls.filter(c => c[0] === 'lost').length, 1);
});
test('late audio unlock is cancelled by pause/restart rather than queued', async () => {
  const { audio, calls, shared } = audioSpy();
  let complete;
  shared.ss.unlock = () => new Promise(resolve => { complete = resolve; });
  const pending = audio.gesture(true);
  audio.reset(); complete(true); await pending;
  assert.equal(calls.filter(c => c[0] === 'connect').length, 0);
});
test('landing cues route once with the actual Perfect combo', () => {
  const { audio, calls } = audioSpy();
  audio.event({ type: 'landed', perfect: false }, { combo: 0 });
  audio.event({ type: 'landed', perfect: true }, { combo: 30 });
  assert.deepEqual(calls, [['land'], ['perfect', 30]]);
});
test('frame clock ignores hidden time, initial compilation and debugger gaps', () => {
  const c = new FrameClock();
  assert.equal(c.sample(10), 0); assert.equal(c.sample(26), .016);
  c.pause(); assert.equal(c.sample(500000), 0);
  c.resume(); assert.equal(c.sample(900000), 0);
  assert.equal(c.sample(900016), .016);
  assert.equal(c.sample(905000), 0);
  assert.equal(c.sample(905150), .1);
  c.reset(); assert.equal(c.sample(999999), 0);
});
test('backgrounding a falling module does not advance physics or consume integrity', () => {
  const c = new FrameClock(), e = new Engine();
  e.release(); c.sample(0); e.update(c.sample(16));
  const before = JSON.stringify(e);
  c.pause(); e.update(c.sample(999999)); c.resume(); e.update(c.sample(1000000));
  assert.equal(JSON.stringify(e), before);
  e.update(c.sample(1000016)); assert.ok(e.time > 0);
});
test('resolution locks input for 320ms, stays paused, and resets all visual flags', () => {
  const p = new RunPresentation();
  p.event({ type: 'missed' }); p.advance(.12); assert.ok(p.signal < 1 && p.signal > .5);
  p.advance(.13); assert.equal(p.signal, 1);
  p.event({ type: 'gameover' }); p.advance(.3); assert.equal(p.ready, false);
  p.advance(0); assert.equal(p.ready, false);
  p.advance(.021); assert.equal(p.ready, true); assert.ok(p.signal < .2);
  p.reset(); assert.equal(p.ready, false); assert.equal(p.signal, 1);
});
test('quality ignores isolated long frames, resize/warmup and discontinuities', () => {
  const q = new QualityState();
  let now = 0;
  for (let i = 0; i < 900; i++) { now += i % 90 === 0 ? 180 : 16; q.observe(now); }
  assert.equal(q.config.bloom, true);
  q.observe(now + 30000); assert.equal(q.warmup, 0);
  for (let i = 0; i < 30; i++) q.observe(now + 30050 + i * 50);
  q.resetTiming(); assert.equal(q.warmup, 0); assert.equal(q.config.bloom, true);
});
test('quality requires persistent slowness and never oscillates after fallback', () => {
  const q = new QualityState();
  for (let now = 0; now < 5000; now += 50) q.observe(now);
  assert.equal(q.reason, 'sustained-slow-frames');
  q.resetTiming();
  for (let now = 6000; now < 16000; now += 16) q.observe(now);
  assert.equal(q.config.bloom, false); assert.equal(q.config.particles, false);
});
test('input deduplicates pointer contact, double taps and held keys', () => {
  const gate = new InputGate();
  assert.equal(gate.press(1, 1000), true); assert.equal(gate.press(1, 1100), false);
  gate.clear(); assert.equal(gate.press(2, 1200), false);
  assert.equal(gate.press(2, 1300), true);
  assert.equal(gate.key(false), true); assert.equal(gate.key(true), false); assert.equal(gate.key(false), false);
  gate.clear(); assert.equal(gate.key(false), true);
  gate.quarantine(2000); assert.equal(gate.press(3, 2010), false); assert.equal(gate.key(false, 2010), false);
  assert.equal(gate.press(3, 2160), true);
});
test('50 restart / Perfect / three-miss cycles retain records and bounded renderer state', () => {
  const e = new Engine(), scene = new THREE.Scene(), effects = createEffects(scene), lights = createLighting(scene);
  const pool = new ModulePool(() => new THREE.Group(), g => scene.add(g), g => scene.remove(g));
  const registry = new ModuleRegistry(), presentation = new RunPresentation();
  const storage = new Map();
  const recordsStorage = { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  for (let run = 0; run < 50; run++) {
    e.release(); e.update(.5); effects.sync(e); pool.sync(registry.select(e, e.viewHeight));
    assert.equal(e.combo, 1); assert.equal(effects.diagnostics().perfectTimelines, 1);
    for (let miss = 0; miss < 3; miss++) {
      e.spawn(); e.release(); e.active.x = e.top.x + 500;
      e.update(5); effects.sync(e);
    }
    assert.equal(e.state, State.GAME_OVER);
    presentation.event({ type: 'gameover' }); presentation.advance(.4);
    lights.sync(e, 0, presentation.signal);
    const records = { ...e.records };
    saveRecords(records, recordsStorage);
    e.reset(); presentation.reset(); effects.sync(e); lights.sync(e, 0, presentation.signal);
    pool.sync(registry.select(e, e.viewHeight));
    assert.deepEqual(e.records, records); assert.deepEqual(loadRecords(recordsStorage), records);
    assert.equal(e.records.gamesPlayed, run + 1);
    assert.equal(e.time, 0); assert.equal(e.combo, 0); assert.equal(e.integrity, 3);
    assert.equal(e.feedback, null); assert.equal(e.events.length, 0); assert.equal(e.tower.length, 1);
    assert.deepEqual(e.camera, e.cameraTarget);
    assert.equal(lights.signal.intensity, .6);
    assert.deepEqual(effects.diagnostics(), { perfectTimelines: 0, particles: 0, ring: false });
    assert.ok(pool.allocated <= 4);
  }
  assert.equal(e.records.bestHeight, 1); assert.equal(e.records.bestScore, 50); assert.equal(e.records.bestCombo, 1);
  effects.dispose(); pool.clear();
});
