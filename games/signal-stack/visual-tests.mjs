import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from './vendor/three/three.module.js';
import { Engine, CONFIG } from './engine.js';
import { ModuleRegistry } from './render/bookkeeping.js';
import { createModuleLibrary } from './render/modules.js';
import { createEffects } from './render/effects.js';
import { ARCHETYPES, getModuleVariant, environmentAt, ALTITUDE_BANDS, parallaxOffset, propagationAt, QualityState } from './render/visual-state.js';

test('six deterministic archetypes with early pacing and rare Core', () => {
  const types = Array.from({ length: 121 }, (_, i) => getModuleVariant(i));
  assert.deepEqual(new Set(types), new Set(ARCHETYPES));
  assert.deepEqual(types.slice(0, 6), ['RELAY','RELAY','COOLING','STRUCTURE','RELAY','COOLING']);
  assert.ok(types.filter(t => t === 'CORE').length < 9);
  for (let i = 120; i >= 0; i--) assert.equal(getModuleVariant(i), types[i]);
  assert.equal(getModuleVariant(NaN), 'RELAY');
});
test('visual floor identity survives active/landed copies, skipped render frames and restart', () => {
  const engine = new Engine(), registry = new ModuleRegistry();
  for (let floor = 1; floor <= 50; floor++) {
    engine.spawn();
    const entry = registry.select(engine, engine.viewHeight).find(e => e.active);
    const before = getModuleVariant(entry.floor);
    engine.release(); engine.active.x = engine.top.x;
    engine.active.y = engine.top.y - engine.active.height - .01; engine.update(CONFIG.STEP);
    engine.update(.6); // Intentionally skip the LANDED render.
    const after = registry.select(engine, engine.viewHeight).find(e => e.block === engine.top);
    assert.equal(before, getModuleVariant(after.floor));
  }
  engine.reset();
  assert.equal(getModuleVariant(registry.select(engine, engine.viewHeight).find(e => e.active).floor), 'RELAY');
});
test('every family retains shared batches, finite geometry and restrained bounds', () => {
  const library = createModuleLibrary(), a = library.create(), b = library.create();
  const signatures = new Set();
  for (const type of ARCHETYPES) {
    library.setVariant(a, type); library.setVariant(b, type);
    assert.equal(a.children.length, 5); assert.equal(a.userData.variant, type);
    signatures.add(a.children[1].geometry.uuid);
    for (let i = 0; i < 5; i++) {
      const g = a.children[i].geometry; assert.equal(g, b.children[i].geometry); g.computeBoundingBox();
      assert.ok(g.boundingBox.min.x >= -.52 && g.boundingBox.max.x <= .52);
      assert.ok(g.boundingBox.min.y >= -.23 && g.boundingBox.max.y <= .235);
      assert.ok([...g.attributes.position.array].every(Number.isFinite));
    }
  }
  assert.equal(signatures.size, 6);
  library.setEnergy(a, 1); library.setEnergy(b, 0);
  assert.ok(a.userData.signal.material.emissiveIntensity > b.userData.signal.material.emissiveIntensity);
  library.dispose();
});
test('altitude names and endpoints are bounded, including negative and endless heights', () => {
  for (const b of ALTITUDE_BANDS) assert.equal(environmentAt(b.floor).band, b.name);
  assert.equal(environmentAt(-10).altitude, 0);
  assert.equal(environmentAt(10000).band, 'NEAR SPACE');
  assert.equal(environmentAt(10000).city, 0);
  for (let i = 0; i < 130; i += .1) {
    for (const k of ['city','cloud','stars','haze','space']) assert.ok(environmentAt(i)[k] >= 0 && environmentAt(i)[k] <= 1);
  }
});
test('environment interpolation is continuous at every boundary and moves before floor eight', () => {
  for (const b of ALTITUDE_BANDS.slice(1)) {
    for (const k of ['city','cloud','stars','haze','space']) {
      assert.ok(Math.abs(environmentAt(b.floor - .001)[k] - environmentAt(b.floor + .001)[k]) < .001);
    }
  }
  assert.ok(environmentAt(5).city < environmentAt(0).city);
  assert.ok(environmentAt(5).cloud > environmentAt(0).cloud);
  assert.ok(environmentAt(20).city < .4);
});
test('parallax preserves near/far speed hierarchy and never shifts a negative altitude', () => {
  const speeds = ['near','clouds','far','mountains','moon','stars'].map(k => Math.abs(parallaxOffset(10, k)));
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] < speeds[i-1]);
  assert.equal(Math.abs(parallaxOffset(-1, 'near')), 0);
  assert.equal(parallaxOffset(10, 'unknown'), 0);
});
test('Perfect propagation moves top to bottom and cleans up within 340ms', () => {
  assert.ok(propagationAt(.03, 0, 500) > .9);
  assert.equal(propagationAt(.03, 44, 500), 0);
  assert.ok(propagationAt(.14, 88, 500) > 0);
  assert.equal(propagationAt(.14, 500, 500), 0);
  assert.ok(propagationAt(.25, 500, 500) > 0);
  for (const d of [0, 44, 400, 1000]) {
    assert.equal(propagationAt(.341, d, 500), 0);
    assert.equal(propagationAt(-1, d, 500), 0);
    assert.equal(propagationAt(.181, d, 500, true), 0);
  }
  assert.ok(propagationAt(.06, 500, 500, true) > 0);
});
test('Perfect visual timeline resets, does not consume events, and bounds particles', () => {
  const engine = new Engine(), scene = new THREE.Scene(), effects = createEffects(scene);
  engine.release(); engine.update(.5);
  const before = JSON.stringify(engine); effects.sync(engine);
  assert.equal(JSON.stringify(engine), before);
  assert.equal(effects.diagnostics().perfectTimelines, 1);
  assert.ok(effects.diagnostics().particles <= 24);
  engine.update(.4); effects.sync(engine);
  assert.equal(effects.diagnostics().perfectTimelines, 0);
  engine.reset(); effects.sync(engine);
  assert.deepEqual(effects.diagnostics(), { perfectTimelines: 0, particles: 0, ring: false });
  effects.dispose(); assert.equal(scene.children.length, 0);
});
test('quality defaults on, accepts opt-out, and sustained slow frames disable Bloom once', () => {
  const normal = new QualityState();
  for (let t = 0; t < 10000; t += 16.67) normal.observe(t);
  assert.equal(normal.config.bloom, true);
  const slow = new QualityState();
  for (let t = 0; t < 5000; t += 50) slow.observe(t);
  assert.equal(slow.config.bloom, false); assert.equal(slow.reason, 'sustained-slow-frames');
  assert.equal(slow.config.atmosphereDetail, .5); assert.equal(slow.config.particles, false);
  for (let t = 5000; t < 15000; t += 16) slow.observe(t);
  assert.equal(slow.config.bloom, false);
  assert.equal(new QualityState({ bloom: false }).config.bloom, false);
});
test('quality ignores resume gaps and warm-up, with forced quality available to QA', () => {
  const q = new QualityState();
  q.observe(0); q.observe(16); q.observe(100000, true); q.observe(200000); q.observe(200016);
  assert.equal(q.config.bloom, true);
  const forced = new QualityState({ autoFallback: false });
  for (let t = 0; t < 10000; t += 80) forced.observe(t);
  assert.equal(forced.config.bloom, true);
});
test('official vendor checksums and recursive addon import closure are complete', () => {
  const base = new URL('./', import.meta.url);
  for (const line of readFileSync(new URL('vendor/three/SHA256SUMS', base), 'utf8').trim().split('\n')) {
    const [hash, file] = line.split(/\s+/);
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, base))).digest('hex'), hash);
  }
  const folder = new URL('vendor/three/addons/', base);
  const files = readdirSync(folder, { recursive: true }).filter(f => f.endsWith('.js'));
  assert.equal(files.length, 10);
  for (const file of files) {
    const url = new URL(file, folder), code = readFileSync(url, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, spec] of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (spec !== 'three') assert.doesNotThrow(() => readFileSync(new URL(spec, url)));
    }
  }
});
