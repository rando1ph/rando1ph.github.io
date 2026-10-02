import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three/three.module.js';
import { Engine, State, CONFIG } from './engine.js';
import { scenePoint, modulePose, viewportMapping, screenPoint } from './render/coordinates.js';
import { syncCamera } from './render/scene.js';
import { ModuleRegistry, ModulePool, MAX_MODULES } from './render/bookkeeping.js';
import { createModuleLibrary } from './render/modules.js';
import { perfectEnvelope } from './render/effects.js';

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);
const land = (e, offset = 0) => {
  e.spawn(); e.release(); e.active.x = e.top.x + offset;
  e.active.y = e.top.y - e.active.height - 0.01; e.update(CONFIG.STEP);
};

test('official locally vendored Three.js revision is exactly 186', () => {
  assert.equal(THREE.REVISION, '186');
});
test('engine top-center maps to scene center, y is inverted, depth stays zero', () => {
  assert.deepEqual(scenePoint(120, -220), { x: 1.2, y: 2.2, z: 0 });
  assert.deepEqual(modulePose({ x: 100, y: -66, width: 100, height: 44, angle: 0.5 }),
    { x: 1, y: 0.44, z: 0, width: 1, height: 0.44, rotationZ: -0.5 });
});
test('logical poses are independent of CSS dimensions and pixel ratio', () => {
  const b = { x: 32, y: -88, width: 100, height: 44, angle: -0.4 };
  const expected = modulePose(b);
  for (const [w, h] of [[360, 649], [390, 693], [430, 781], [480, 749]]) {
    const view = viewportMapping(w, h);
    near(view.height * view.scale, h); near(view.width * view.scale, w);
    assert.deepEqual(modulePose(b), expected);
  }
});
test('real PerspectiveCamera projection matches Phase 1 grid at z=0 through resize and camera movement', () => {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  for (const [w, h] of [[360, 649], [390, 693], [430, 781], [480, 749], [780, 480]]) {
    const view = viewportMapping(w, h);
    for (const offset of [{ x: 0, y: -500 }, { x: -230, y: -5000 }]) {
      syncCamera(camera, offset, view.width, view.height);
      for (const [x, y] of [[offset.x, offset.y], [offset.x + 75, offset.y + 340], [offset.x - 150, offset.y + 600]]) {
        const p = scenePoint(x, y), ndc = new THREE.Vector3(p.x, p.y, p.z).project(camera);
        const expected = screenPoint(x, y, offset, view.width);
        near((ndc.x + 1) * view.width / 2, expected.x);
        near((1 - ndc.y) * view.height / 2, expected.y);
      }
    }
  }
});
test('both edge rotations keep the visual pivot on the engine contact point', () => {
  for (const offset of [-75, 75]) {
    const e = new Engine(); land(e, offset); e.update(0.2);
    const b = e.active, pose = modulePose(b);
    const corner = new THREE.Vector3(-b.offset.x * 0.01, b.offset.y * 0.01, 0);
    corner.applyAxisAngle(new THREE.Vector3(0, 0, 1), pose.rotationZ);
    corner.add(new THREE.Vector3(pose.x, pose.y, 0));
    const expected = scenePoint(b.pivot.x, b.pivot.y);
    near(corner.x, expected.x); near(corner.y, expected.y);
  }
});
test('renderer IDs survive the active-to-landed copy and are fresh on spawn/reset', () => {
  const e = new Engine(), registry = new ModuleRegistry();
  const id = registry.idFor(e.active);
  e.release(); e.update(0.5);
  assert.equal(e.state, State.LANDED);
  registry.select(e, e.viewHeight);
  assert.equal(registry.idFor(e.top), id);
  e.update(0.6); assert.notEqual(registry.idFor(e.active), id);
  const oldBase = registry.idFor(e.tower[0]);
  e.reset(); assert.notEqual(registry.idFor(e.tower[0]), oldBase);
});
test('selection and IDs do not mutate gameplay data; culling retains full tower', () => {
  const e = new Engine(), registry = new ModuleRegistry();
  for (let i = 0; i < 1000; i++) land(e);
  e.setViewport(700);
  const before = JSON.stringify(e);
  const selected = registry.select(e, 700);
  assert.equal(JSON.stringify(e), before);
  assert.equal(e.tower.length, 1001);
  assert.ok(selected.length < 24);
  assert.ok(selected.some(entry => entry.block === e.top));
  assert.ok(!selected.some(entry => entry.block.base));
});
test('pool keeps stable instances, recycles failures/restarts, and bounds allocation in Endless', () => {
  let count = 0;
  const attached = new Set();
  const pool = new ModulePool(() => ({ number: ++count }), o => attached.add(o), o => attached.delete(o));
  pool.sync([{ id: 1 }, { id: 2 }]);
  const first = pool.live.get(1); pool.sync([{ id: 1 }, { id: 3 }]);
  assert.equal(pool.live.get(1), first); assert.equal(pool.allocated, 2);
  for (let frame = 0; frame < 1000; frame++) {
    const entries = Array.from({ length: 20 }, (_, i) => ({ id: frame * 2 + i }));
    pool.sync(entries);
    assert.equal(attached.size, 20); assert.equal(pool.allocated, 20);
  }
  pool.sync([{ id: 9000 }]); assert.equal(pool.free.length, 19);
  pool.sync(Array.from({ length: 60 }, (_, id) => ({ id })));
  assert.ok(pool.allocated <= MAX_MODULES);
  pool.clear(); assert.equal(attached.size, 0); assert.equal(pool.allocated, 0);
});
test('oversized viewport still obeys renderer cap and retains active module', () => {
  const e = new Engine(), registry = new ModuleRegistry();
  for (let i = 0; i < 100; i++) land(e);
  e.setViewport(10000); e.spawn();
  const visible = registry.select(e, 10000);
  assert.ok(visible.length <= MAX_MODULES);
  assert.equal(visible.at(-1).block, e.active);
});
test('module groups share all geometry/materials; pulse only changes the latest signal material', () => {
  const library = createModuleLibrary(); const a = library.create(), b = library.create();
  assert.ok(a.isGroup); assert.equal(a.children.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(a.children[i].geometry, b.children[i].geometry);
    assert.equal(a.children[i].material, b.children[i].material);
  }
  library.setPulse(a, true);
  assert.notEqual(a.userData.signal.material, b.userData.signal.material);
  library.setPulse(a, false); assert.equal(a.userData.signal.material, b.userData.signal.material);
  library.dispose();
});
test('Perfect pulse rises and returns to baseline; reduced motion ends within 220ms', () => {
  const e = new Engine(); land(e);
  const landedAt = e.time;
  e.time = landedAt + 0.06; assert.ok(perfectEnvelope(e).pulse > 0.8);
  e.time = landedAt + 0.73; assert.equal(perfectEnvelope(e).pulse, 0);
  assert.equal(perfectEnvelope(e).visible, false);
  e.reducedMotion = true; e.time = landedAt + 0.1;
  assert.equal(perfectEnvelope(e).visible, true);
  e.time = landedAt + 0.23; assert.equal(perfectEnvelope(e).visible, false);
});
