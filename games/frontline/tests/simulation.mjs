// Node-only combat, bounded generation and V1/V2/V3 balance comparisons.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Game, formation, firepowerScale, MAX_ENEMIES, segmentHit } from "../engine.js";
import {
  LEVELS,
  WEAPONS,
  pacing,
  ENEMIES,
  LANES,
  campaign,
  encounter,
  endlessEncounter,
} from "../content.js";
import { pilot } from "./pilot.mjs";
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const summary = (a) => ({
  min: Math.min(...a),
  mean: +mean(a).toFixed(2),
  p95: [...a].sort((a, b) => a - b)[Math.floor(a.length * 0.95)],
  max: Math.max(...a),
});
function fixture() {
  const g = new Game();
  g.schedule = [];
  g.bossStarted = true;
  g.cooldown = 999;
  return g;
}
function step(g, n = 1) {
  for (let i = 0; i < n; i++) g.step(1 / 60);
}
function bullet(g, x, y, damage = 1) {
  g.bullets.push({ x, y, vx: 0, vy: -1200, damage, color: "#fff" });
}
// First physical intersection, not array order or target class, wins.
assert.equal(segmentHit(0, 0, 10, 10, 5, 5, 1, 1), 0.4);
assert.equal(segmentHit(0, 0, 0, 10, 5, 5, 1, 1), Infinity);
for (const panelNear of [true, false]) {
  const g = fixture();
  g.spawn({
    items: [
      { kind: "grunt", x: 210, y: panelNear ? 390 : 420, scale: 1 },
      { kind: "amplifier", x: 210, y: panelNear ? 420 : 370, value: -4 },
    ],
  });
  bullet(g, 210, 465);
  g.bullets[0].vy = -6000;
  step(g);
  assert.equal(g.pickups[0].value, panelNear ? -3 : -4);
  assert.equal(g.enemies[0].hp, panelNear ? 6 : 5);
}
const amp = fixture();
amp.spawn({
  items: [{ kind: "amplifier", x: 210, y: 400, value: -2, maxValue: 8 }],
});
const panel = amp.pickups[0];
for (let i = 0; i < 30; i++) amp.hitResource(panel, { damage: 999 });
assert.equal(panel.value, 8);
const neg = fixture();
neg.squad = 10;
neg.invulnerable = 1;
neg.collect({ kind: "amplifier", value: -6, x: 210, y: 635 });
assert.equal(neg.squad, 4, "negative panels cannot be bypassed with hit grace");
const fatal = fixture();
fatal.collect({ kind: "amplifier", value: -6, x: 210, y: 635 });
assert.equal(fatal.state, "lost");
const neutral = fixture();
neutral.collect({ kind: "amplifier", value: 0, x: 210, y: 635 });
assert.equal(neutral.squad, 5);
const off = fixture();
off.spawn({ items: [{ kind: "amplifier", x: 210, y: 0, value: -4 }] });
bullet(off, 210, 20);
step(off);
assert.equal(off.pickups[0].value, -4, "no offscreen farming");
const fixed = fixture();
fixed.spawn({ items: [{ kind: "squad", x: 210, y: 400, value: 3 }] });
bullet(fixed, 210, 440);
step(fixed, 4);
assert.equal(fixed.pickups[0].value, 3);
assert.equal(fixed.bullets.length, 1, "fixed supplies do not absorb fire");
for (const hp of [1, 6, 18]) {
  const g = fixture();
  g.collect({ type: "crate", kind: "weapon", hp, maxHp: 18, x: 210, y: 635 });
  assert.equal(g.squad, 5 - Math.ceil((hp / 18) * 3));
  assert.equal(g.weapon, 0);
}
const crate = fixture();
crate.spawn({
  items: [{ kind: "weapon", x: 210, y: 400, crated: true, hp: 18 }],
});
const box = crate.pickups[0];
crate.hitResource(box, { damage: 17 });
assert.equal(box.type, "crate");
crate.hitResource(box, { damage: 1 });
assert.equal(box.type, "drop");
assert.equal(crate.weapon, 0);
crate.collect(box);
assert.equal(crate.weapon, 1);
const narrow = fixture(),
  wide = fixture();
wide.squad = 30;
assert.equal(narrow.contact(290, 649, 18, 18), false);
assert.equal(wide.contact(290, 649, 18, 18), true);
assert.equal(formation(60).length, 30);
const boss = fixture();
boss.spawnBoss();
boss.boss.y = 167;
boss.boss.cooldown = 0;
step(boss);
assert.ok(boss.boss.attack);
boss.boss.hp = 0;
step(boss);
assert.equal(boss.state, "won");
const waiting = new Game({ mode: "endless" });
waiting.time = 52;
waiting.bossPending = true;
waiting.spawn({ items: [{ kind: "brute", x: 94, y: 200, scale: 1 }] });
step(waiting);
assert.equal(waiting.boss, null, "boss waits for unresolved wave");
const elite = fixture();
elite.spawn({ items: [{ kind: "elite", x: 94, y: 200, scale: 1 }] });
elite.enemies[0].fire = 0;
step(elite);
assert.equal(elite.hostile.length, 1);
const gap = fixture();
gap.step(10);
assert.equal(gap.time, 0.05);
const sameA = new Game({ seed: 372, level: 6 }),
  sameB = new Game({ seed: 372, level: 6 });
for (let i = 0; i < 6000; i++) {
  if (i % 12 === 0) {
    pilot(sameA);
    pilot(sameB);
  }
  step(sameA);
  step(sameB);
}
assert.equal(JSON.stringify(sameA), JSON.stringify(sameB));
// Uncapped real squad, bounded/reused visible geometry and reserve firepower.
for (const count of [61, 120, 500]) {
  const g = fixture();
  g.squad = count;
  g.collect({ kind: "squad", value: 3, x: 210, y: 635 });
  g.collect({ kind: "amplifier", value: 8, x: 210, y: 635 });
  assert.equal(g.squad, count + 11);
  g.cooldown = 0;
  step(g);
  assert.equal(g.bullets.length, 30);
  assert.equal(g.bullets[0].damage, firepowerScale(count + 11));
  assert.equal(formation(count).length, 30);
  assert.strictEqual(formation(count), formation(30), "same cached visible geometry");
}
for (let count = 30; count < 10000; count++) assert.strictEqual(formation(count), formation(30));
assert.equal(firepowerScale(30), 1);
assert.equal(firepowerScale(60), 2);
assert.equal(firepowerScale(120), 3);
assert.equal(firepowerScale(240), 4);
assert.ok(firepowerScale(500) < 6);
assert.ok(firepowerScale(240) - firepowerScale(120) < firepowerScale(120) - firepowerScale(60) + 1e-8);
assert.ok((firepowerScale(500) - firepowerScale(240)) / 260 < (firepowerScale(120) - firepowerScale(60)) / 60);
const rewardBoss = new Game({ mode: "endless" });
rewardBoss.squad = 500;
rewardBoss.spawnBoss();
rewardBoss.boss.hp = 0;
step(rewardBoss);
assert.equal(rewardBoss.squad, 504);
// Breach at the front line: red is global, zero is safe, positive is physical.
for (const value of [-8, 0, 8]) for (const touch of [false, true]) {
  const g = fixture();
  g.squad = 20;
  g.x = g.target = touch ? 94 : 326;
  g.invulnerable = 1;
  g.spawn({ items: [{ kind: "amplifier", x: 94, y: 634, value }] });
  step(g);
  assert.equal(g.squad, 20 + (value < 0 ? value : touch ? value : 0));
  assert.equal(g.pickups.length, 0);
  assert.equal(g.invulnerable, 1 - 1 / 60, "resource penalties do not grant contact grace");
}
for (const kind of ["squad", "weapon", "damage", "rapid"]) {
  const g = fixture();
  g.x = g.target = 326;
  g.spawn({ items: [{ kind, x: 94, y: 634, value: 3, crated: true, hp: 20 }] });
  step(g);
  assert.equal(g.squad, 5, "avoided physical rewards/crates cause no global damage");
  assert.equal(g.weapon, 0);
  assert.equal(g.damage, 1);
  assert.equal(g.rapid, 1);
  assert.equal(g.pickups.length, 0);
}
for (const kind of Object.keys(ENEMIES)) {
  const g = fixture();
  g.squad = 30;
  g.x = g.target = 326;
  g.invulnerable = 1;
  g.spawn({ items: [{ kind, x: 94, y: 649, scale: 1 }] });
  step(g);
  assert.equal(g.squad, 30 - ENEMIES[kind].breach);
  assert.equal(g.stats.enemyEscapes, 1);
}
const staggered = fixture();
staggered.squad = 30;
staggered.x = staggered.target = 326;
for (let i = 0; i < 5; i++) {
  staggered.spawn({ items: [{ kind: "grunt", x: 94, y: 649 }] });
  step(staggered, 10);
}
assert.equal(staggered.squad, 25);
for (const contact of [false, true]) {
  const g = fixture();
  g.squad = 100;
  g.x = g.target = contact ? 94 : 326;
  g.spawn({ items: Array.from({ length: 24 }, () => ({ kind: "grunt", x: 94, y: 649 })) });
  step(g);
  assert.ok(g.squad >= 96, "cluster cannot wipe a large squad in one frame");
  assert.ok(g.breachDebt > 0, "grace cannot swallow the rest of the pack");
  step(g, 180);
  assert.equal(g.squad, contact ? 75 : 76, "all leaks eventually apply their loss");
  assert.equal(g.breachDebt, 0);
}
const heavyCluster = fixture();
heavyCluster.squad = 100;
heavyCluster.x = heavyCluster.target = 326;
heavyCluster.spawn({ items: Array.from({ length: 12 }, () => ({ kind: "brute", x: 94, y: 649 })) });
step(heavyCluster);
assert.equal(heavyCluster.squad, 98);
step(heavyCluster, 180);
assert.equal(heavyCluster.squad, 76, "queued heavy breaches retain class-sensitive loss");
const leakWipe = fixture();
leakWipe.x = leakWipe.target = 326;
leakWipe.spawn({ items: Array.from({ length: 12 }, () => ({ kind: "grunt", x: 94, y: 649 })) });
step(leakWipe, 120);
assert.equal(leakWipe.state, "lost", "an ignored wave is disastrous");
for (const weapon of [0, 1, 2]) {
  const g = fixture();
  g.squad = 500;
  g.weapon = weapon;
  g.cooldown = 0;
  step(g);
  assert.equal(g.squad, 500);
  assert.equal(g.bullets.length, 30 * WEAPONS[weapon].spread.length);
}
const endlessA = new Game({ seed: 73, mode: "endless" }),
  endlessB = new Game({ seed: 73, mode: "endless" });
for (const g of [endlessA, endlessB]) Object.assign(g, {
  squad: 120, weapon: 2, time: 768, nextBoss: 820, nextEndless: 769,
});
for (let i = 0; i < 1800; i++) {
  if (i % 12 === 0) { pilot(endlessA, "threat-aware"); pilot(endlessB, "threat-aware"); }
  step(endlessA); step(endlessB);
}
assert.equal(JSON.stringify(endlessA), JSON.stringify(endlessB));
// Raw entities/speeds have ceilings; band, composition and cadence keep advancing.
for (const band of [12, 24, 48, 120]) {
  assert.ok(pacing(band + 12).interval < pacing(band).interval);
  assert.ok(pacing(band).enemySpeed <= 2.17);
  for (let seed = 1; seed <= 100; seed++) {
    const block = endlessEncounter(seed, 13, band * 32);
    assert.equal(block.band, band);
    assert.deepEqual(block, endlessEncounter(seed, 13, band * 32));
    assert.ok(block.items.filter((p) => ENEMIES[p.kind]).length <= 24);
    const g = fixture();
    for (let n = 0; n < 5; n++) g.spawn(block);
    assert.ok(g.enemies.length <= 30);
    assert.ok(g.enemies.filter((p) => p.kind === "elite").length <= 4);
  }
}
for (const weapon of WEAPONS) for (const angle of weapon.spread) {
  const g = fixture();
  const vx = Math.sin(angle) * weapon.speed;
  g.spawn({ items: [
    { kind: "grunt", x: 210 + vx * 0.03, y: 390 },
    { kind: "amplifier", x: 210 + vx * 0.015, y: 420, value: -4 },
  ] });
  g.bullets.push({ x: 210, y: 465, vx, vy: -weapon.speed, damage: 1 });
  g.step(0.05);
  assert.equal(g.pickups[0].value, -3, "fast diagonal shot hits nearer panel first");
  assert.equal(g.enemies[0].hp, 6);
}
const temp = mkdtempSync(join(tmpdir(), "frontline-baseline-"));
for (const name of ["content", "engine"])
  writeFileSync(
    join(temp, name + ".mjs"),
    execFileSync(
      "git",
      ["show", `frontline-v1-baseline:games/frontline/${name}.js`],
      { encoding: "utf8" },
    ).replace("./content.js", "./content.mjs"),
  );
const V1 = await import(pathToFileURL(join(temp, "content.mjs")));
const { Game: GameV1 } = await import(pathToFileURL(join(temp, "engine.mjs")));
const v2temp = mkdtempSync(join(tmpdir(), "frontline-v2-baseline-"));
for (const name of ["content", "engine"])
  writeFileSync(join(v2temp, name + ".mjs"), execFileSync("git",
    ["show", `457fc9e9f469958be3f6329619743ec4f0e22251:games/frontline/${name}.js`],
    { encoding: "utf8" }).replace("./content.js", "./content.mjs"));
const V2 = await import(pathToFileURL(join(v2temp, "content.mjs")));
const { Game: GameV2 } = await import(pathToFileURL(join(v2temp, "engine.mjs")));
const densities = [],
  amps = [],
  hp = [],
  endless = [];
function counts(b) {
  return {
    enemies: b.items.filter((p) => ENEMIES[p.kind]).length,
    resources: b.items.filter((p) => !ENEMIES[p.kind]).length,
  };
}
for (let level = 0; level < 10; level++) {
  const enemy = [],
    old = [],
    v2 = [],
    hordes = [],
    conflicts = [],
    intervals = [];
  for (let seed = 1; seed <= 100; seed++) {
    const schedule = campaign(seed, level);
    assert.deepEqual(schedule, campaign(seed, level));
    assert.equal(schedule[0].key, "welcome");
    assert.equal(schedule.at(-1).key, "recovery");
    enemy.push(schedule.reduce((n, b) => n + counts(b).enemies, 0));
    old.push(
      V1.campaign(seed, level).reduce((n, b) => n + counts(b).enemies, 0),
    );
    v2.push(V2.campaign(seed, level).reduce((n, b) => n + counts(b).enemies, 0));
    hordes.push(schedule.filter((b) => b.tags.includes("horde")).length);
    conflicts.push(
      schedule.filter(
        (b) =>
          counts(b).enemies &&
          b.items.some((p) => p.kind === "amplifier" || p.crated),
      ).length,
    );
    schedule.forEach((b, i) => {
      if (i) intervals.push(b.at - schedule[i - 1].at);
      const lanes = new Set(
        b.items
          .filter((p) => ENEMIES[p.kind])
          .map((p) =>
            LANES.reduce((a, x) =>
              Math.abs(x - p.x) < Math.abs(a - p.x) ? x : a,
            ),
          ),
      );
      assert.ok(lanes.size <= 2);
      assert.ok(b.items.length <= 27);
      for (const p of b.items) {
        assert.ok(p.y <= -35, "no close spawns");
        if (p.kind === "amplifier") {
          amps.push(p.value);
          assert.ok(p.value >= -14 && p.value <= 3);
        }
        if (p.crated) {
          hp.push(p.hp);
          assert.ok(p.hp >= 10 && p.hp <= 30);
        }
      }
    });
  }
  densities.push({
    sector: level + 1,
    enemies: summary(enemy),
    v1Mean: mean(old),
    v2Mean: mean(v2),
    hordes: mean(hordes),
    simultaneousShootableConflicts: mean(conflicts),
    spacing: summary(intervals),
  });
}
for (const band of [0, 1, 2, 4, 7, 12, 24, 48, 120]) {
  let foes = [],
    hordes = 0,
    elites = 0,
    conflicts = 0,
    recoveries = 0,
    redPanels = 0,
    runners = 0;
  for (let seed = 1; seed <= 100; seed++)
    for (let wave = 2; wave < 32; wave++) {
      const b = endlessEncounter(seed, wave, band * 32);
      assert.deepEqual(b, endlessEncounter(seed, wave, band * 32));
      assert.ok(b.threatBudget <= b.budget);
      assert.ok(b.items.length <= 27);
      if (wave % 5 === 4) {
        assert.equal(b.key, "recovery");
        recoveries++;
      }
      redPanels += b.items.filter((p) => p.kind === "amplifier" && p.value < 0).length;
      runners += b.items.filter((p) => p.kind === "runner").length;
      foes.push(counts(b).enemies);
      hordes += +b.tags.includes("horde");
      elites += +b.items.some((p) => p.kind === "elite");
      conflicts += +(
        counts(b).enemies > 0 &&
        b.items.some((p) => p.kind === "amplifier" || p.crated)
      );
    }
  endless.push({
    band,
    enemyCount: summary(foes),
    hordePercent: hordes / 30,
    elitePercent: elites / 30,
    conflictPercent: conflicts / 30,
    recoveryPercent: recoveries / 30,
    redPanelsPerBlock: redPanels / 3000,
    runnersPerBlock: runners / 3000,
    interval: pacing(band).interval,
  });
}
// Achievability measures a five-scout Pulse squad focusing one unobstructed panel.
const achievable = [];
for (const start of [-14, -10, -7, -4, 2, 3]) {
  const g = fixture();
  g.cooldown = 0;
  g.spawn({
    items: [
      {
        kind: "amplifier",
        x: 210,
        y: -35,
        value: start,
        maxValue: 12,
        speed: 88,
      },
    ],
  });
  while (g.pickups.length && g.state === "playing") step(g);
  achievable.push({ start, gain: g.stats.panelGain, hits: g.stats.panelHits });
  assert.ok(g.stats.panelGain > 0);
}
function run(
  C,
  level,
  seed,
  mode = "campaign",
  limit = 180,
  style = "balanced",
  setup = {},
) {
  const g = new C({ level, seed, mode });
  Object.assign(g, setup);
  let maxEnemies = 0,
    empty = 0,
    conflict = 0,
    samples = 0;
  for (let i = 0; i < 60 * limit && g.state === "playing"; i++) {
    if (i % 12 === 0 && style !== "idle") pilot(g, style);
    step(g);
    maxEnemies = Math.max(maxEnemies, g.enemies.length);
    if (i % 60 === 0) {
      samples++;
      empty += +(g.enemies.filter((e) => e.y > 60).length === 0 && !g.boss);
      conflict += +(
        g.enemies.some((e) => e.y > 60) &&
        g.pickups.some(
          (p) => p.y > 60 && (p.type === "panel" || p.type === "crate"),
        )
      );
    }
    assert.ok(g.bullets.length <= 330 && g.effects.length <= 140);
    if (C === Game) assert.ok(g.enemies.length <= MAX_ENEMIES && g.hostile.length <= 80);
  }
  return {
    state: g.state,
    bosses: g.bosses,
    time: +g.time.toFixed(2),
    survivors: g.squad,
    weapon: g.weapon,
    maxEnemies,
    emptyPercent: (100 * empty) / samples,
    conflictPercent: (100 * conflict) / samples,
    stats: g.stats,
  };
}
const runs = [];
for (let level = 0; level < 10; level++) {
  const now = [],
    before = [],
    v2 = [];
  for (let seed = 1; seed <= 30; seed++) {
    now.push(run(Game, level, seed));
    before.push(run(GameV1, level, seed));
    v2.push(run(GameV2, level, seed));
  }
  runs.push({
    sector: level + 1,
    wins: now.filter((r) => r.state === "won").length,
    v2Wins: v2.filter((r) => r.state === "won").length,
    v2Survivors: summary(v2.filter((r) => r.state === "won").map((r) => r.survivors)),
    v1Wins: before.filter((r) => r.state === "won").length,
    winningSeconds: summary(
      now.filter((r) => r.state === "won").map((r) => r.time),
    ),
    v1WinningSeconds: summary(
      before.filter((r) => r.state === "won").map((r) => r.time),
    ),
    survivors: summary(
      now.filter((r) => r.state === "won").map((r) => r.survivors),
    ),
    peakEnemies: Math.max(...now.map((r) => r.maxEnemies)),
    emptyPercent: mean(now.map((r) => r.emptyPercent)),
    v1EmptyPercent: mean(before.map((r) => r.emptyPercent)),
    conflictPercent: mean(now.map((r) => r.conflictPercent)),
    panelGain: mean(now.map((r) => r.stats.panelGain)),
    crateBreaks: mean(now.map((r) => r.stats.cratesBroken)),
    losses: mean(now.map((r) => r.stats.lost)),
  });
}
const awareRuns = [];
for (let level = 0; level < 10; level++) {
  const attempts = Array.from({ length: 30 }, (_, i) => ({
    seed: i + 1,
    ...run(Game, level, i + 1, "campaign", 180, "threat-aware"),
  }));
  awareRuns.push({
    sector: level + 1,
    winningSeeds: attempts.filter((r) => r.state === "won").map((r) => r.seed),
    wins: attempts.filter((r) => r.state === "won").length,
    survivors: summary(attempts.filter((r) => r.state === "won").map((r) => r.survivors)),
    lossesAt: summary(attempts.filter((r) => r.state === "lost").map((r) => r.time)),
  });
}
const expeditions = [1, 22, 914].map((seed) => ({
  seed,
  aware: run(Game, 0, seed, "endless", 900, "threat-aware"),
  v3: run(Game, 0, seed, "endless", 900),
  v2: run(GameV2, 0, seed, "endless", 900),
  v1: run(GameV1, 0, seed, "endless", 360),
}));
const passiveOpening = Array.from({ length: 30 }, (_, i) => run(Game, 0, i + 1, "campaign", 180, "idle"));
const lateSquads = [];
for (const startTime of [384, 768, 1536]) for (const squad of [120, 240]) {
  const attempts = [1, 22, 914].map((seed) => {
    const setup = {
      time: startTime, nextBoss: startTime + 52, nextEndless: startTime + 1,
      squad, weapon: 2, damage: 1.4, rapid: 1.3,
    };
    return {
      seed,
      active: run(Game, 0, seed, "endless", 240, "threat-aware", setup),
      idle: run(Game, 0, seed, "endless", 240, "idle", setup),
    };
  });
  lateSquads.push({ startTime, squad, attempts });
}
for (const sample of lateSquads) for (const run of sample.attempts)
  assert.ok(run.idle.survivors < sample.squad && run.active.survivors > run.idle.survivors,
    "late reserves still need steering; idle play must erode the real squad");
assert.equal(passiveOpening.filter((r) => r.state === "won").length, 0);
const policies = ["idle", "combat", "resources", "balanced"].map((style) => ({
  style,
  ...run(Game, 7, 31, "campaign", 180, style),
}));
// CPU-only peak-density collision work, measured separately from browser raster.
// Reset outside the timer so every sample starts with the same maximum density.
const engineFixtures = [];
for (const enemyCount of [30, 48]) {
  const engineTimes = [];
  for (let sample = 0; sample < 360; sample++) {
    const g = fixture();
    g.squad = 240;
    g.weapon = 2;
    g.spawn({
      items: Array.from({ length: enemyCount }, (_, i) => ({
        kind: i % 8 === 7 ? "elite" : ["grunt", "runner", "brute"][i % 3],
        x: 65 + (i % 8) * 40,
        y: 80 + Math.floor(i / 8) * 60,
        scale: 10,
      })),
    }, { enemyLimit: enemyCount });
    g.spawn({
      items: Array.from({ length: 6 }, (_, i) => ({
        kind: i % 2 ? "weapon" : "amplifier",
        crated: !!(i % 2),
        hp: 24,
        value: -10,
        x: 94 + (i % 3) * 116,
        y: 420 + Math.floor(i / 3) * 90,
      })),
    });
    for (let i = 0; i < 330; i++)
      g.bullets.push({
        x: 55 + (i % 30) * 10,
        y: 450 + Math.floor(i / 30) * 12,
        vx: 0,
        vy: -1508,
        damage: 1,
        color: "#ffdc86",
      });
    g.burst(210, 350, "#ff7799", 140);
    assert.equal(g.enemies.length, enemyCount);
    const begin = performance.now();
    g.step(1 / 60);
    const elapsed = performance.now() - begin;
    if (sample >= 60) engineTimes.push(elapsed);
  }
  engineTimes.sort((a, b) => a - b);
  engineFixtures.push({
    samples: 300,
    scouts: 240,
    visible: 30,
    enemies: enemyCount,
    resources: 6,
    bullets: 330,
    particles: 140,
    median: engineTimes[150],
    p95: engineTimes[285],
    worst: engineTimes.at(-1),
  });
}
console.log(
  JSON.stringify(
    {
      checks: "passed",
      campaignLayouts: 1000,
      endlessBlocks: 27000,
      densities,
      endless,
      panelStarts: summary(amps),
      crateHP: summary(hp),
      achievable,
      runs,
      awareRuns,
      lateSquads,
      expeditions,
      policies,
      passiveOpening: { wins: passiveOpening.filter((r) => r.state === "won").length, meanSeconds: mean(passiveOpening.map((r) => r.time)) },
      engineFixtures,
    },
    null,
    2,
  ),
);
