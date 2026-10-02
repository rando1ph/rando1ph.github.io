// Deterministic comparative evidence, not a prediction of human scores.
// Run: node games/cow-cat-can-fly/tests/playability.cjs
const assert = require('node:assert/strict');
const C = require('../cow-cat-can-fly.js');
const OLD = {
  ...C, GRAVITY: 1450, FLAP_VY: -460, MAX_FALL: 620,
  diffAt(progress) {
    const t = Math.max(0, Math.min(progress, 45)) / 45;
    const e = t * t * (3 - 2 * t);
    return { speed: 132 + 68 * e, gap: 168 - 46 * e,
      spacing: 224 - 44 * e, maxDelta: 150 - 30 * e };
  },
  advanceFlight(body, dt) {
    const k = 1450 / 620, e = Math.exp(-k * dt);
    body.cy += 620 * dt + (body.vy - 620) * (1 - e) / k;
    body.vy = 620 + (body.vy - 620) * e;
  }
};

function simulate(core, seed, policy, initialProgress = 0) {
  // Separate geometry and controller RNG; identical samples across versions.
  const rng = C.mulberry(seed), decisions = C.mulberry(seed ^ 0x731);
  const body = { cy: 330, vy: core.FLAP_VY };
  const run = { pipesPassed: initialProgress, score: initialProgress, bonusScore: 0 };
  const pipes = [{ x: 480, center: 300 + (rng() * 2 - 1) * (core === OLD ? 40 : 24),
    gap: core.diffAt(initialProgress).gap, scored: false }];
  let nextDecision = 0, maxPipes = 0;
  const dt = 1 / 120;
  for (let frame = 0; frame < 120 * 300; frame++) {
    const time = frame * dt;
    if (time >= nextDecision && policy !== 'idle') {
      nextDecision = time + policy.interval + decisions() * policy.jitter;
      const next = pipes.find(p => p.x + C.OBST_W >= C.catRect(body.cy).x);
      const target = (next?.center || 300) + 24 + (decisions() * 2 - 1) * policy.error;
      // Ordinary reactive height targeting, no future trajectory search.
      if (body.vy >= 0 && body.cy + body.vy * policy.lookahead > target) body.vy = core.FLAP_VY;
    }
    core.advanceFlight(body, dt);
    if (body.cy < 14) { body.cy = 14; body.vy = Math.max(body.vy, 0); }
    const d = core.diffAt(run.pipesPassed);
    for (const pipe of pipes) pipe.x -= d.speed * dt;
    const last = pipes.at(-1);
    if (last.x <= C.W - d.spacing) pipes.push({ x: last.x + d.spacing,
      center: C.nextGapCenter(last.center, d, rng), gap: d.gap, scored: false });
    if (pipes[0].x + C.OBST_W < -12) pipes.shift();
    maxPipes = Math.max(maxPipes, pipes.length);
    for (const pipe of pipes) {
      if (C.hitsPipe(body.cy, pipe)) return { passed: run.pipesPassed - initialProgress, time, maxPipes };
      C.passPipe(run, pipe, body.cy);
    }
    if (body.cy + 11 >= C.GROUND_Y) return { passed: run.pipesPassed - initialProgress, time, maxPipes };
    if (run.pipesPassed - initialProgress >= 100) break;
  }
  return { passed: run.pipesPassed - initialProgress, capped: true, maxPipes };
}

const policies = {
  slow: { interval: 0.2, jitter: 0.16, error: 26, lookahead: 0.08 },
  learning: { interval: 0.16, jitter: 0.13, error: 22, lookahead: 0.08 },
  steady: { interval: 0.12, jitter: 0.1, error: 16, lookahead: 0.1 },
  precise: { interval: 0.06, jitter: 0.03, error: 5, lookahead: 0.12 }
};
function summary(runs) {
  const scores = runs.map(r => r.passed).sort((a,b) => a-b);
  return { p10: scores[20], median: scores[100], p90: scores[180],
    mean: +(scores.reduce((a,b) => a+b, 0) / runs.length).toFixed(2),
    reach10: scores.filter(s => s >= 10).length,
    reach20: scores.filter(s => s >= 20).length,
    capped: runs.filter(r => r.capped).length,
    maxPipes: Math.max(...runs.map(r => r.maxPipes)) };
}
const report = { seedsPerPolicy: 200, cap: '100 passed towers or 300 seconds', policies: {}, late: {} };
for (const [name, policy] of Object.entries(policies)) {
  const before = summary(Array.from({length: 200}, (_,i) => simulate(OLD, i+1, policy)));
  const after = summary(Array.from({length: 200}, (_,i) => simulate(C, i+1, policy)));
  report.policies[name] = { before, after };
  assert.ok(after.median > before.median, name + ' should benefit materially');
}
for (const name of ['slow', 'steady', 'precise']) {
  report.late[name] = summary(Array.from({length: 200}, (_,i) => simulate(C, i+1, policies[name], 80)));
}
assert.equal(simulate(C, 1, 'idle').passed, 0);
assert.ok(report.policies.slow.after.median >= 10);
assert.ok(report.late.slow.median < report.policies.slow.after.median, 'late game retains pressure');
report.geometry = [0, 10, 20, 40, 80].map(progress => {
  const a = OLD.diffAt(progress), b = C.diffAt(progress);
  return { progress, old: a, current: b,
    safeHeight: [a.gap - 22, b.gap - 22],
    secondsBetweenPairs: [a.spacing / a.speed, b.spacing / b.speed],
    unobstructedSeconds: [(a.spacing - 56 - 24) / a.speed, (b.spacing - 56 - 24) / b.speed] };
});
console.log(JSON.stringify(report, null, 2));
