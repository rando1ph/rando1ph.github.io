// Run with: node games/frontline/tests/simulation.mjs
import assert from "node:assert/strict";
import { Game, formation } from "../engine.js";
import {
  LEVELS,
  BLOCKS,
  LANES,
  WEAPONS,
  campaign,
  encounter,
  endlessEncounter,
} from "../content.js";
function pilot(g) {
  const a = g.boss?.attack;
  if (a) {
    g.target = LANES.filter((x) => !a.lanes.includes(x)).sort(
      (x, y) => Math.abs(x - g.x) - Math.abs(y - g.x),
    )[0];
    return;
  }
  const p = g.pickups
    .filter((p) => p.y > 280 && p.y < 638)
    .sort((a, b) => b.y - a.y)[0];
  if (p) g.target = p.x;
  else if (g.boss) g.target = g.boss.x;
  else {
    const e = g.enemies.filter((e) => e.y > 0).sort((a, b) => b.y - a.y)[0];
    if (e) g.target = e.x;
  }
}
let layouts = new Set(),
  campaigns = 0,
  endlessBlocks = 0;
for (let l = 0; l < LEVELS.length; l++)
  for (let seed = 1; seed <= 100; seed++) {
    const schedule = campaign(seed, l);
    assert.deepEqual(schedule, campaign(seed, l));
    layouts.add(JSON.stringify(schedule));
    assert.equal(schedule[0].key, "welcome");
    assert.equal(schedule.at(-1).key, "recovery");
    assert.ok(schedule[0].items.some((p) => p.kind === "squad"));
    assert.ok(schedule.every((b) => b.items.length <= 9));
    for (const block of schedule) {
      assert.ok(block.items.every((p) => p.x > 60 && p.x < 360));
      const threatLanes = new Set(
        block.items
          .filter((p) => ["grunt", "brute", "runner", "elite"].includes(p.kind))
          .map((p) =>
            LANES.reduce((a, b) =>
              Math.abs(p.x - a) < Math.abs(p.x - b) ? a : b,
            ),
          ),
      );
      assert.ok(threatLanes.size <= 2, "must leave an unoccupied threat lane");
      assert.ok(
        block.items
          .filter((p) => p.kind === "squad")
          .every((p) => p.value >= 2 && p.value <= 4),
      );
    }
    campaigns++;
  }
assert.equal(layouts.size, 1000, "campaign variation");
for (let seed = 1; seed <= 100; seed++)
  for (let wave = 0; wave < 80; wave++) {
    const time = wave * 7,
      b = endlessEncounter(seed, wave, time);
    assert.deepEqual(b, endlessEncounter(seed, wave, time));
    assert.ok(
      b.threatBudget <= b.budget || wave < 2 || b.tags.includes("recovery"),
    );
    if (wave % 4 === 3) assert.equal(b.key, "recovery");
    assert.ok(b.items.length <= 9);
    endlessBlocks++;
  }
let wins = 0,
  losses = 0,
  times = [],
  reports = [];
for (let level = 0; level < 10; level++) {
  let levelWins = 0,
    lo = Infinity,
    hi = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = new Game({ seed, level });
    for (let i = 0; i < 60 * 180 && g.state === "playing"; i++) {
      pilot(g);
      g.step(1 / 60);
    }
    if (g.state === "won") {
      wins++;
      levelWins++;
      times.push(g.time);
      lo = Math.min(lo, g.time);
      hi = Math.max(hi, g.time);
    } else losses++;
    assert.ok(g.stats.shots > 0 && g.stats.hits > 0 && g.stats.collected > 0);
    assert.ok(
      g.enemies.length < 50 &&
        g.bullets.length <= 330 &&
        g.effects.length <= 140,
    );
  }
  reports.push({
    level: level + 1,
    wins: levelWins,
    seconds: [lo.toFixed(1), hi.toFixed(1)],
  });
}
// Same seed + the same fixed-step inputs reproduce the whole simulation.
const a = new Game({ seed: 372 }),
  b = new Game({ seed: 372 });
for (let i = 0; i < 4000; i++) {
  pilot(a);
  pilot(b);
  a.step(1 / 60);
  b.step(1 / 60);
}
assert.equal(JSON.stringify(a), JSON.stringify(b));
const impact = new Game();
impact.spawn({ items: [{ kind: "brute", scale: 1, x: 210, y: 629 }] });
impact.step(1 / 60);
assert.equal(impact.squad, 1);
impact.invulnerable = 0;
impact.hurt(2);
assert.equal(impact.state, "lost");
const rewards = new Game();
for (const kind of ["squad", "weapon", "weapon", "damage", "rapid"])
  rewards.collect({ kind, value: 3, x: 210, y: 635 });
assert.equal(rewards.squad, 8);
assert.equal(rewards.weapon, 2);
assert.ok(rewards.damage > 1 && rewards.rapid > 1);
const boss = new Game();
boss.spawnBoss();
boss.boss.y = 167;
boss.boss.cooldown = 0;
boss.step(1 / 60);
assert.ok(boss.boss.attack);
boss.boss.hp = 0;
boss.step(1 / 60);
assert.equal(boss.state, "won");
assert.equal(formation(60).length, 30);
assert.notEqual(WEAPONS[0].interval, WEAPONS[1].interval);
assert.equal(WEAPONS[2].spread.length, 3);
const endless = new Game({ mode: "endless", seed: 914 });
let peakEnemies = 0,
  peakBullets = 0;
for (let i = 0; i < 60 * 900 && endless.state === "playing"; i++) {
  pilot(endless);
  endless.step(1 / 60);
  peakEnemies = Math.max(peakEnemies, endless.enemies.length);
  peakBullets = Math.max(peakBullets, endless.bullets.length);
}
const elite = new Game();
elite.spawn({ items: [{ kind: "elite", x: 94, y: 200, scale: 1 }] });
elite.enemies[0].fire = 0;
elite.step(1 / 60);
assert.equal(elite.hostile.length, 1, "elite fires a visible shard");
const guarded = new Game();
guarded.spawn(encounter("risk", 18));
const cache = guarded.pickups[0];
assert.ok(cache.guard);
guarded.step(1 / 60);
assert.ok(cache.locked);
cache.guard.hp = 0;
guarded.step(1 / 60);
assert.equal(cache.locked, false);
const maw = new Game({ level: 5 });
maw.spawnBoss();
maw.boss.y = 167;
maw.boss.hp *= 0.6;
maw.boss.cooldown = 0;
maw.step(1 / 60);
assert.equal(
  maw.boss.attack.lanes.length,
  2,
  "Maw leaves exactly one safe lane",
);
const gap = new Game();
gap.step(10);
assert.equal(gap.time, 0.05, "pathological frame gaps are clamped");
console.log(
  JSON.stringify(
    {
      campaignLayouts: campaigns,
      endlessBlocks,
      wins,
      losses,
      campaignResults: reports,
      endless: {
        state: endless.state,
        time: endless.time,
        distance: endless.distance,
        bosses: endless.bosses,
        squad: endless.squad,
        peakEnemies,
        peakBullets,
      },
    },
    null,
    2,
  ),
);
