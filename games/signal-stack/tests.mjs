import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, State, CONFIG, difficultyAt, pendulumAt, classifyLanding } from './engine.js';
import { loadRecords, saveRecords, STORAGE_KEY } from './storage.js';

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);
function contact(engine, offset = 0) {
  engine.spawn();
  engine.release();
  engine.active.x = engine.top.x + offset;
  engine.active.y = engine.top.y - engine.active.height - 0.01;
  engine.update(CONFIG.STEP);
}
function finishFailure(engine) {
  for (let i = 0; i < 1500 && ![State.SWINGING, State.GAME_OVER].includes(engine.state); i++) engine.update(CONFIG.STEP);
  assert.ok([State.SWINGING, State.GAME_OVER].includes(engine.state));
}

test('initial state and configurable integrity', () => {
  const e = new Engine();
  assert.equal(e.state, State.READY);
  assert.deepEqual([e.height, e.score, e.combo, e.bestCombo, e.misses], [0, 0, 0, 0, 0]);
  assert.equal(e.integrity, CONFIG.MAX_MISSES);
  assert.equal(e.tower.length, 1);
  assert.equal(new Engine({ config: { MAX_MISSES: 1 } }).integrity, 1);
});
test('deterministic pendulum position and angular velocity', () => {
  const band = difficultyAt(0), origin = { x: 20, y: -100 };
  const a = pendulumAt(0, origin, band);
  near(a.x, 20); near(a.y, 80); near(a.angularVelocity, band.amplitude * band.frequency);
  const b = pendulumAt(Math.PI / (2 * band.frequency), origin, band);
  near(b.angle, band.amplitude);
  near(b.x, 20 + 180 * Math.sin(band.amplitude));
  near(b.y, -100 + 180 * Math.cos(band.amplitude));
  near(b.angularVelocity, 0);
});
test('tap detaches at current position; repeated input is ignored', () => {
  const e = new Engine(); e.update(0.4);
  const position = { x: e.active.x, y: e.active.y };
  assert.equal(e.release(), true); assert.equal(e.state, State.RELEASING);
  assert.equal(e.release(), false);
  assert.deepEqual({ x: e.active.x, y: e.active.y }, position);
  e.update(CONFIG.STEP); assert.equal(e.state, State.FALLING);
  assert.equal(e.release(), false); near(e.active.x, position.x);
  assert.equal(e.records.gamesPlayed, 1);
});
test('gravity follows y = y0 + 1/2 gt² with no frame-count dependency', () => {
  const e = new Engine(); e.release(); const y = e.active.y;
  e.update(0.2);
  near(e.active.y, y + 0.5 * CONFIG.GRAVITY * 0.2 ** 2);
  near(e.active.vy, CONFIG.GRAVITY * 0.2);
});
test('60 Hz and 144 Hz produce identical drops, score and camera', () => {
  const a = new Engine(), b = new Engine(); a.release(); b.release();
  for (let i = 0; i < 120; i++) a.update(1 / 60);
  for (let i = 0; i < 288; i++) b.update(1 / 144);
  assert.equal(a.state, b.state); assert.equal(a.score, b.score);
  near(a.active.x, b.active.x); near(a.camera.y, b.camera.y);
});
test('clean normal landing becomes tower top without cropping', () => {
  const e = new Engine(); contact(e, 20);
  assert.equal(e.state, State.LANDED); assert.equal(e.height, 1);
  assert.equal(e.top.width, CONFIG.BLOCK_WIDTH); assert.equal(e.top.x, 20);
  assert.equal(e.top.y, -CONFIG.BLOCK_HEIGHT); assert.equal(e.score, CONFIG.BASE_SCORE);
});
for (const [offset, state, direction] of [[-75, State.FALLING_LEFT, -1], [75, State.FALLING_RIGHT, 1]]) {
  test(`${state}: contact edge stays fixed while block rotates, then falls away`, () => {
    const e = new Engine(); contact(e, offset);
    assert.equal(e.state, state); assert.equal(e.height, 0);
    const b = e.active, pivot = { ...b.pivot };
    e.update(0.1);
    assert.equal(Math.sign(b.angle), direction);
    const vx = -b.offset.x, vy = -b.offset.y;
    near(b.x + vx * Math.cos(b.angle) - vy * Math.sin(b.angle), pivot.x);
    near(b.y + b.height / 2 + vx * Math.sin(b.angle) + vy * Math.cos(b.angle), pivot.y);
    e.update(0.7); assert.equal(b.detached, true);
    finishFailure(e); assert.equal(e.misses, 1);
  });
}
test('complete miss never lands on lower floors', () => {
  const e = new Engine(); contact(e, CONFIG.BLOCK_WIDTH + 1);
  assert.equal(e.state, State.MISSED); finishFailure(e);
  assert.equal(e.height, 0); assert.equal(e.score, 0); assert.equal(e.integrity, 2);
});
test('Perfect threshold inclusive on both sides; float noise is tolerated', () => {
  const top = { x: 0, width: 100 };
  for (const sign of [-1, 1]) {
    assert.equal(classifyLanding({ x: sign * 10, width: 100 }, top), 'PERFECT');
    assert.equal(classifyLanding({ x: sign * (10 + 1e-9), width: 100 }, top), 'PERFECT');
    assert.equal(classifyLanding({ x: sign * 10.001, width: 100 }, top), 'SUCCESS');
    assert.equal(classifyLanding({ x: sign * 50, width: 100 }, top), 'SUCCESS');
    assert.equal(classifyLanding({ x: sign * 50.001, width: 100 }, top), sign < 0 ? 'LEFT' : 'RIGHT');
    assert.equal(classifyLanding({ x: sign * 100, width: 100 }, top), 'MISS');
  }
});
test('Perfect snaps to exact alignment and consecutive score grows 50, 75, 100', () => {
  const e = new Engine();
  for (let i = 1; i <= 3; i++) {
    const score = e.score; contact(e, 9);
    assert.equal(e.top.x, 0); assert.equal(e.combo, i); assert.equal(e.bestCombo, i);
    assert.equal(e.score - score, 25 + 25 * i);
  }
  assert.equal(e.score, 225);
});
test('ordinary success resets current Perfect streak but keeps best', () => {
  const e = new Engine(); contact(e); contact(e); contact(e, 20);
  assert.equal(e.combo, 0); assert.equal(e.bestCombo, 2); assert.equal(e.score, 150);
});
test('miss decrements integrity exactly once and clears combo', () => {
  const e = new Engine(); contact(e); contact(e, 110); finishFailure(e);
  assert.equal(e.combo, 0); assert.equal(e.misses, 1);
  e.update(1); assert.equal(e.misses, 1); assert.equal(e.integrity, 2);
});
test('game over at configured MAX_MISSES, no further release allowed', () => {
  for (const lives of [1, 3, 5]) {
    const e = new Engine({ config: { MAX_MISSES: lives } });
    for (let i = 0; i < lives; i++) { contact(e, 110); finishFailure(e); }
    assert.equal(e.state, State.GAME_OVER); assert.equal(e.integrity, 0);
    assert.equal(e.release(), false); e.update(20); assert.equal(e.misses, lives);
  }
});
test('restart resets run and preserves round-tripped best records and games played', () => {
  const e = new Engine(); contact(e); contact(e);
  const storage = { getItem() { return this.value; }, setItem(key, value) { assert.equal(key, STORAGE_KEY); this.value = value; } };
  saveRecords(e.records, storage);
  const records = loadRecords(storage); e.reset();
  assert.deepEqual(e.records, records); assert.equal(e.state, State.READY);
  assert.equal(e.tower.length, 1); assert.equal(e.height + e.score + e.combo + e.misses, 0);
  const refreshed = new Engine({ records }); assert.equal(refreshed.records.bestCombo, 2);
  e.release(); assert.equal(e.records.gamesPlayed, 2);
});
test('difficulty bands change at 5, 10, 20 and stop escalating', () => {
  for (const boundary of [5, 10, 20]) {
    assert.ok(difficultyAt(boundary).frequency > difficultyAt(boundary - 1).frequency);
    assert.ok(difficultyAt(boundary).amplitude > difficultyAt(boundary - 1).amplitude);
  }
  assert.deepEqual(difficultyAt(1000), difficultyAt(20));
});
test('camera advances after several placements, retains world geometry', () => {
  const e = new Engine(), initial = e.cameraTarget.y;
  contact(e); assert.equal(e.cameraTarget.y, initial);
  for (let i = 0; i < 8; i++) contact(e);
  assert.ok(e.cameraTarget.y < initial);
  assert.equal(e.tower[0].y, 0); assert.equal(e.top.y, -9 * CONFIG.BLOCK_HEIGHT);
  e.update(0.4); near(e.top.y, -9 * CONFIG.BLOCK_HEIGHT);
});
test('resize during flight changes only view; reduced motion snaps camera', () => {
  const e = new Engine({ reducedMotion: true });
  for (let i = 0; i < 7; i++) contact(e);
  e.update(CONFIG.STEP); near(e.camera.y, e.cameraTarget.y);
  e.spawn(); e.release(); e.update(0.1);
  const b = { ...e.active }, tower = JSON.stringify(e.tower);
  e.setViewport(800);
  assert.deepEqual(e.active, b); assert.equal(JSON.stringify(e.tower), tower);
});
test('corrupt, unavailable and malformed storage falls back safely', () => {
  for (const value of ['{broken', 'null', '[]', '42', '{"bestHeight":-3,"bestScore":"10","bestCombo":1e100}']) {
    assert.deepEqual(loadRecords({ getItem: () => value }), { bestHeight: 0, bestScore: 0, bestCombo: 0, gamesPlayed: 0 });
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(loadRecords(blocked).bestHeight, 0); assert.equal(saveRecords({}, blocked), false);
  assert.equal(loadRecords({ getItem: () => '{"bestHeight":12}' }).bestHeight, 12);
});
test('widest late-game swing remains below the HUD in short windows', () => {
  const e = new Engine({ viewHeight: 390 });
  for (let i = 0; i < 22; i++) contact(e);
  e.setViewport(390);
  e.time = Math.PI / (2 * e.difficulty.frequency);
  e.spawn();
  assert.ok(e.active.y - e.camera.y > 94);
});
