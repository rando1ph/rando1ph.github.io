// Run: node games/cow-cat-can-fly/tests/core.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cow-cat-can-fly.js');

test('difficulty is smooth, bounded and progresses through 80 towers', () => {
  assert.deepEqual(C.diffAt(0), { speed: 114, gap: 204, spacing: 264, maxDelta: 72 });
  assert.deepEqual(C.diffAt(40), { speed: 143, gap: 180, spacing: 247, maxDelta: 81 });
  assert.deepEqual(C.diffAt(80), { speed: 172, gap: 156, spacing: 230, maxDelta: 90 });
  assert.deepEqual(C.diffAt(1000), C.diffAt(80));
  assert.deepEqual(C.diffAt(-10), C.diffAt(0));
  for (let p = 0; p < 100; p += 0.25) {
    const a = C.diffAt(p), b = C.diffAt(p + 0.25);
    assert.ok(b.speed >= a.speed && b.speed - a.speed < 0.28);
    assert.ok(b.gap <= a.gap && a.gap - b.gap < 0.23);
    assert.ok(b.spacing <= a.spacing && b.spacing >= 230);
    assert.ok(b.gap >= 156 && b.maxDelta <= 90);
  }
  assert.ok(C.diffAt(10).gap > 198 && C.diffAt(20).gap > 193);
});

test('50,000 deterministic gaps respect margins and consecutive height bounds', () => {
  for (let seed = 0; seed < 100; seed++) {
    const rng = C.mulberry(seed);
    let center = 300;
    for (let p = 0; p < 500; p++) {
      const d = C.diffAt(p), next = C.nextGapCenter(center, d, rng);
      assert.ok(Math.abs(next - center) <= d.maxDelta + 1e-9);
      assert.ok(next - d.gap / 2 >= C.TOP_MARGIN - 1e-9);
      assert.ok(next + d.gap / 2 <= C.GROUND_Y - C.BOT_MARGIN + 1e-9);
      center = next;
    }
  }
});

test('closed-form trajectories agree at 20/30/60/120/144Hz, including flaps', () => {
  function trajectory(hz) {
    const body = { cy: 330, vy: C.FLAP_VY };
    for (let segment = 0; segment < 4; segment++) {
      if (segment < 3) body.vy = C.FLAP_VY;
      for (let i = 0; i < hz; i++) C.advanceFlight(body, 1 / hz);
    }
    return body;
  }
  const reference = trajectory(60);
  for (const hz of [20, 30, 120, 144]) {
    const body = trajectory(hz);
    assert.ok(Math.abs(body.cy - reference.cy) < 1e-8);
    assert.ok(Math.abs(body.vy - reference.vy) < 1e-8);
  }
  const falling = { cy: 0, vy: 0 };
  C.advanceFlight(falling, 20);
  assert.ok(Math.abs(falling.vy - C.MAX_FALL) < 1e-8);
});

test('tower collision forgives ears/cheeks but retains the original 24x22 body', () => {
  const pipe = { x: C.CAT_X - 20, center: 300, gap: 200 };
  assert.deepEqual(C.catRect(300), { x: 80, y: 290, w: 24, h: 22 });
  assert.equal(C.hitsPipe(300, pipe), false);
  assert.equal(C.hitsPipe(211, pipe), false);
  assert.equal(C.hitsPipe(210, pipe), true);
  assert.equal(C.hitsPipe(388, pipe), true);
  assert.equal(C.hitsPipe(387, pipe), false);
  pipe.x = 105;
  assert.equal(C.hitsPipe(150, pipe), false);
});

test('food +1, treat +2, both exactly once, and obstacle +1 stay independent', () => {
  const run = C.createScore();
  for (const [kind, value] of [['food', 1], ['treat', 2]]) {
    const pipe = { x: C.CAT_X - C.OBST_W / 2, pickup: { kind, y: 300 } };
    assert.equal(C.collectPickup(run, pipe, 300), value);
    assert.equal(C.collectPickup(run, pipe, 300), 0);
  }
  assert.deepEqual(run, { pipesPassed: 0, bonusScore: 3, score: 3 });
  assert.deepEqual(C.diffAt(run.pipesPassed), C.diffAt(0));
  const pipe = { x: 24, scored: false };
  assert.equal(C.passPipe(run, pipe, 300), false); // touching trailing edge
  pipe.x = 23.99;
  assert.equal(C.passPipe(run, pipe, 300), true);
  assert.equal(C.passPipe(run, pipe, 300), false);
  assert.deepEqual(run, { pipesPassed: 1, bonusScore: 3, score: 4 });
});

test('pickup radius accepts a visible graze but rejects remote/missed items', () => {
  const run = C.createScore();
  const pipe = { x: 119 - C.OBST_W / 2, pickup: { kind: 'food', y: 300 } };
  assert.equal(C.collectPickup(run, pipe, 300), 1); // 15px from body edge
  pipe.pickup.collected = false;
  pipe.x += 0.01;
  assert.equal(C.collectPickup(run, pipe, 300), 0);
  pipe.x = -100;
  assert.equal(C.collectPickup(run, pipe, 300), 0);
  assert.equal(run.score, 1);
});

test('10,000 pickups are deterministic, inset, spaced and mostly food', () => {
  const cadence = { empty: 0 }, copy = { empty: 0 };
  let empty = 0, food = 0, treats = 0, previous = false;
  for (let i = 0; i < 10000; i++) {
    const pipe = { seed: i, center: 300, gap: C.diffAt(i % 100).gap };
    const pickup = C.makePickup(pipe, cadence);
    assert.deepEqual(pickup, C.makePickup(pipe, copy));
    if (pickup) {
      assert.equal(previous, false);
      assert.ok(empty >= 1 && empty <= 3);
      assert.ok(Math.abs(pickup.y - pipe.center) <= pipe.gap / 2 - 40);
      if (pickup.kind === 'food') {
        food++;
        assert.ok(Math.abs(pickup.y - pipe.center) <= 18);
      } else {
        treats++;
        assert.ok(Math.abs(pickup.y - pipe.center) >= 28);
      }
      empty = 0;
    } else empty++;
    assert.ok(empty <= 3);
    previous = !!pickup;
  }
  assert.ok(food > treats * 3 && treats > 500);
  assert.ok(food + treats > 2500 && food + treats < 5000);
});

test('v1 best/runs load, larger total wins, lower score retains best', () => {
  const saved = C.parseStore('{"best":27,"runs":9}');
  assert.deepEqual(saved, { best: 27, runs: 9 });
  assert.equal(C.recordRun(saved, 32), true);
  assert.deepEqual(C.parseStore(JSON.stringify(saved)), { best: 32, runs: 10 });
  assert.equal(C.recordRun(saved, 7), false);
  assert.deepEqual(saved, { best: 32, runs: 11 });
});

test('malformed storage falls back without invalidating valid neighboring fields', () => {
  for (const raw of [null, '{broken', 'null', '{}', '[]', '{"best":-3,"runs":"oops"}', '{"best":1e100}']) {
    assert.deepEqual(C.parseStore(raw), { best: 0, runs: 0 });
  }
  assert.deepEqual(C.parseStore('{"best":15,"runs":-1}'), { best: 15, runs: 0 });
});
