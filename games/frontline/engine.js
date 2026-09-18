import {
  W,
  H,
  LANES,
  WEAPONS,
  ENEMIES,
  LEVELS,
  random,
  campaign,
  encounter,
  endlessEncounter,
} from "./content.js";
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const formations = new Map();
export function formation(count) {
  if (formations.has(count)) return formations.get(count);
  const n = Math.min(count, 30),
    cols = Math.min(6, Math.ceil(Math.sqrt(n * 1.5))),
    points = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols),
      inRow = Math.min(cols, n - row * cols);
    points.push({
      x:
        ((i % cols) - (inRow - 1) / 2) * (n > 12 ? 23 : 28) +
        Math.sin(i * 8) * 2,
      y: row * (n > 12 ? 20 : 29) + Math.cos(i * 6) * 2,
    });
  }
  formations.set(count, points);
  return points;
}
// Segment/rectangle entry time: every projectile resolves its nearest physical hit.
// This also handles fast diagonal Trident shots crossing more than one target per step.
export function segmentHit(x0, y0, x1, y1, x, y, rx, ry) {
  let near = 0,
    far = 1;
  for (const [start, delta, min, max] of [
    [x0, x1 - x0, x - rx, x + rx],
    [y0, y1 - y0, y - ry, y + ry],
  ]) {
    if (Math.abs(delta) < 1e-8) {
      if (start < min || start > max) return Infinity;
      continue;
    }
    let a = (min - start) / delta,
      b = (max - start) / delta;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  return near;
}
export class Game {
  constructor({
    seed = 1,
    level = 0,
    mode = "campaign",
    emit = () => {},
  } = {}) {
    this.seed = seed >>> 0;
    this.level = level;
    this.mode = mode;
    this.rng = random(seed);
    this.emit = emit;
    this.time = 0;
    this.x = 210;
    this.target = 210;
    this.squad = 5;
    this.weapon = 0;
    this.damage = 1;
    this.rapid = 1;
    this.enemies = [];
    this.pickups = [];
    this.bullets = [];
    this.hostile = [];
    this.effects = [];
    this.texts = [];
    this.state = "playing";
    this.score = 0;
    this.kills = 0;
    this.distance = 0;
    this.wave = 0;
    this.bosses = 0;
    this.cooldown = 0.15;
    this.invulnerable = 0;
    this.flash = 0;
    this.shake = 0;
    this.next = 0;
    this.nextEndless = 1;
    this.boss = null;
    this.schedule = mode === "campaign" ? campaign(seed, level) : [];
    this.bossStarted = false;
    this.nextBoss = 52;
    this.bossPending = false;
    this.banner = null;
    this.taught = [];
    this.rescue = 0;
    this.stats = {
      shots: 0,
      hits: 0,
      collected: 0,
      lost: 0,
      panelHits: 0,
      panelGain: 0,
      cratesBroken: 0,
      crateCollisions: 0,
      hordes: 0,
      enemyEscapes: 0,
      bossArrivals: [],
    };
  }
  say(text, x = this.x, y = 585, color = "#b0f6ff") {
    this.texts.push({ text, x, y, color, life: 1.5 });
  }
  burst(x, y, color, count = 9) {
    for (let i = 0; i < count && this.effects.length < 140; i++) {
      const a = i * 2.399,
        speed = 30 + (i % 4) * 22;
      this.effects.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.3 + (i % 3) * 0.1,
        max: 0.5,
        color,
        size: 2 + (i % 3),
      });
    }
  }
  announce(text, detail, kind = "horde") {
    this.banner = { text, detail, kind, life: 2.2 };
    this.emit(kind === "horde" ? "horde" : "warning");
  }
  contact(x, y, rx = 10, ry = 10) {
    return formation(this.squad).some(
      (p) =>
        Math.abs(this.x + p.x - x) < rx + 9 &&
        Math.abs(649 + p.y - y) < ry + 12,
    );
  }
  spawn(block) {
    for (const [kind, title, detail] of [
      ["amplifier", "AMPLIFIER", "Shoot +1 per hit · cross to claim"],
      ["crate", "SEALED UPGRADE", "Break it first · unopened crates hurt"],
    ]) {
      if (
        !this.taught.includes(kind) &&
        block.items.some((p) => (kind === "crate" ? p.crated : p.kind === kind))
      ) {
        this.taught.push(kind);
        this.announce(title, detail, "lesson");
      }
    }
    if (block.tags?.includes("horde")) {
      this.stats.hordes++;
      this.announce("HORDE INBOUND", "Choose a firing line");
    }
    block.items.forEach((item) => {
      const d = ENEMIES[item.kind];
      if (d)
        this.enemies.push({
          ...item,
          ...d,
          hp: d.hp * (item.scale ?? 1),
          maxHp: d.hp * (item.scale ?? 1),
          speed: d.speed * (item.speedScale ?? 1),
          phase: this.rng() * 6.28,
          baseX: item.x,
          age: 0,
          hit: 0,
          fire: 3,
        });
      else {
        const guard = block.tags?.includes("risk")
          ? this.enemies.find(
              (e) => Math.abs(e.baseX - item.x) < 25 && e.hp > 0,
            )
          : null;
        const crated =
          item.crated === true &&
          ["weapon", "damage", "rapid"].includes(item.kind);
        this.pickups.push({
          ...item,
          age: 0,
          guard,
          speed: item.speed ?? 82,
          hit: 0,
          type:
            item.kind === "amplifier"
              ? "panel"
              : crated
                ? "crate"
                : ["weapon", "damage", "rapid"].includes(item.kind)
                  ? "drop"
                  : "supply",
          hp: crated ? (item.hp ?? 18) : 0,
          maxHp: crated ? (item.hp ?? 18) : 0,
          minValue: item.minValue ?? -16,
          maxValue: item.maxValue ?? 10,
          tint: item.value < 0 ? -1 : item.value > 0 ? 1 : 0,
        });
      }
    });
    this.wave++;
  }
  prepareBoss() {
    this.bossPending = true;
    this.bossReadyAt = this.time + (this.mode === "campaign" ? 3 : 7);
    this.announce(
      "GUARDIAN INBOUND",
      "Clear the road · take the supplies",
      "boss",
    );
  }
  spawnBoss() {
    this.bossPending = false;
    this.stats.bossArrivals.push(this.time);
    const kind =
      this.mode === "campaign"
        ? LEVELS[this.level].boss
        : this.bosses % 2
          ? "maw"
          : "warden";
    const hp =
      this.mode === "endless"
        ? 700 + Math.min(2400, this.bosses * 320)
        : 600 + this.level * 145;
    this.boss = {
      kind,
      x: 210,
      y: -90,
      hp,
      maxHp: hp,
      radius: 62,
      age: 0,
      hit: 0,
      cooldown: 1.1,
      adds: 5,
      attack: null,
    };
    this.bossStarted = true;
    this.rescue = this.time + 12;
    this.emit("boss");
    this.say(
      kind === "maw" ? "THE RIFT MAW" : "THE IRON WARDEN",
      210,
      250,
      "#ffbbcd",
    );
  }
  collect(p) {
    if (p.type === "crate" && p.hp > 0) {
      this.stats.crateCollisions++;
      this.hurt(Math.max(1, Math.ceil((p.hp / p.maxHp) * 3)), p.x, true);
      this.say("CRATE IMPACT", p.x, 570, "#ffb39c");
      return;
    }
    this.stats.collected++;
    if (p.kind === "amplifier") {
      const value = clamp(p.value, p.minValue ?? -16, p.maxValue ?? 10);
      if (value < 0) this.hurt(-value, p.x, true);
      else {
        const gain = Math.min(60 - this.squad, value);
        this.squad += gain;
        this.stats.panelGain += gain;
        this.say(`+${gain} SCOUTS`);
        this.emit(gain ? "growth" : "pickup");
      }
      this.burst(p.x, p.y, value < 0 ? "#ff849b" : "#63ebff", 8);
      return;
    }
    if (p.kind === "squad") {
      const old = this.squad;
      this.squad = Math.min(60, this.squad + p.value);
      this.say(`+${this.squad - old} SCOUTS`);
      this.emit("growth");
    }
    if (p.kind === "weapon") {
      if (this.weapon < 2) {
        this.weapon++;
        this.say(WEAPONS[this.weapon].name + " ONLINE", this.x, 570, "#ffdf8f");
      } else {
        this.damage = Math.min(2.4, this.damage + 0.15);
        this.say("OVERCHARGE +15%");
      }
      this.emit("upgrade");
    }
    if (p.kind === "damage") {
      this.damage = Math.min(2.4, this.damage + 0.2);
      this.say("POWER +20%");
      this.emit("pickup");
    }
    if (p.kind === "rapid") {
      this.rapid = Math.min(1.65, this.rapid + 0.15);
      this.say("RATE +15%");
      this.emit("pickup");
    }
    this.burst(p.x, p.y, p.kind === "weapon" ? "#ffcf71" : "#63ebff", 15);
  }
  hurt(amount, x = this.x, resource = false) {
    if ((!resource && this.invulnerable > 0) || this.state !== "playing")
      return;
    const lost = Math.min(this.squad, amount);
    this.squad -= lost;
    this.stats.lost += lost;
    this.invulnerable = 0.7;
    this.shake = 5;
    this.say(`−${lost} SCOUT${lost === 1 ? "" : "S"}`, this.x, 600, "#ff8c9d");
    this.burst(x, 643, "#79dafa", 13);
    this.emit("damage");
    if (this.squad <= 0) this.finish(false);
  }
  finish(win) {
    if (this.state !== "playing") return;
    this.state = win ? "won" : "lost";
    this.emit(win ? "victory" : "defeat");
  }
  endlessBlock() {
    const block = endlessEncounter(
      this.rng() * 4294967296,
      this.wave,
      this.time,
    );
    this.spawn(block);
    this.nextEndless =
      this.time +
      block.pace.interval +
      (block.tags.includes("horde") ? 1.0 : 0);
  }
  hitResource(p, b) {
    p.hit = 0.11;
    this.stats.hits++;
    if (p.type === "panel") {
      const old = p.value;
      p.value = Math.min(p.maxValue, p.value + 1);
      this.stats.panelHits++;
      if (old === 0 && p.value === 1) {
        this.emit("panelPositive");
        this.burst(p.x, p.y, "#8bf2ff", 5);
      } else if (p.value !== old) this.emit("panelHit");
    } else {
      p.hp = Math.max(0, p.hp - b.damage);
      this.emit("crateHit");
      if (p.hp === 0) {
        p.type = "drop";
        p.released = 0.25;
        this.stats.cratesBroken++;
        this.burst(p.x, p.y, "#ffd58d", 12);
        this.emit("crateBreak");
      }
    }
  }
  animateEffects(dt) {
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    for (const p of this.effects) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.effects = this.effects.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.y -= 18 * dt;
      t.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }
  step(dt, input = 0) {
    if (this.state !== "playing") {
      this.endTime = (this.endTime || 0) + Math.min(dt, 0.05);
      this.animateEffects(dt);
      this.shake = Math.max(0, this.shake - dt * 20);
      return;
    }
    dt = clamp(dt, 0, 0.05);
    this.time += dt;
    this.distance = Math.floor(this.time * 12);
    if (input) this.target = clamp(this.target + input * 310 * dt, 60, 360);
    const margin = this.squad > 12 ? 85 : this.squad > 6 ? 83 : 60;
    this.target = clamp(this.target, margin, W - margin);
    this.x += (this.target - this.x) * (1 - Math.exp(-18 * dt));
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt * 20);
    if (this.mode === "campaign") {
      while (
        this.next < this.schedule.length &&
        this.time >= this.schedule[this.next].at
      )
        this.spawn(this.schedule[this.next++]);
      const finale = Math.min(
        LEVELS[this.level].duration - 5,
        (this.schedule.at(-1)?.at ?? 0) + 8,
      );
      if (!this.bossStarted && !this.bossPending && this.time >= finale)
        this.prepareBoss();
      if (
        this.bossPending &&
        this.time >= this.bossReadyAt &&
        this.enemies.length === 0 &&
        this.hostile.length === 0
      )
        this.spawnBoss();
    } else if (!this.boss) {
      // Stop normal blocks for a horde -> supplies -> warning -> boss transition.
      if (!this.bossPending && this.time >= this.nextBoss - 7) {
        this.spawn(encounter("recovery", this.rng() * 4294967296));
        this.prepareBoss();
      }
      if (this.bossPending) {
        if (
          this.time >= this.nextBoss &&
          this.enemies.length === 0 &&
          this.hostile.length === 0
        )
          this.spawnBoss();
      } else if (this.time >= this.nextEndless) this.endlessBlock();
    }
    if (this.boss && this.time >= this.rescue) {
      this.pickups.push({
        kind: this.weapon < 2 && this.boss.age > 18 ? "weapon" : "squad",
        value: 2,
        x: LANES[Math.floor(this.rng() * 3)],
        y: 240,
        age: 0,
        type: this.weapon < 2 && this.boss.age > 18 ? "drop" : "supply",
      });
      this.rescue = this.time + 12;
    }
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      const w = WEAPONS[this.weapon],
        points = formation(this.squad);
      this.cooldown += w.interval / this.rapid;
      this.flash = 0.065;
      points.forEach((p) =>
        w.spread.forEach((a) => {
          if (this.bullets.length < 330)
            this.bullets.push({
              x: this.x + p.x + 5,
              y: 631 + p.y,
              vx: Math.sin(a) * w.speed,
              vy: -w.speed,
              damage: w.damage * this.damage * Math.max(1, this.squad / 30),
              color: w.color,
            });
        }),
      );
      this.stats.shots += points.length * w.spread.length;
      this.emit("shot", this.weapon);
    }
    for (const e of this.enemies) {
      e.age += dt;
      e.hit = Math.max(0, e.hit - dt);
      e.y += e.speed * dt;
      e.x =
        e.baseX +
        Math.sin(e.age * (e.kind === "runner" ? 4 : 1.6) + e.phase) *
          (e.kind === "elite" ? 24 : e.kind === "runner" ? 13 : 4);
      if (e.kind === "elite" && e.y > 70 && e.y < 450) {
        e.fire -= dt;
        if (e.fire <= 0) {
          e.fire = 3;
          this.hostile.push({ x: e.x, y: e.y + 20, vx: 0, vy: 155, r: 7 });
          this.burst(e.x, e.y, "#f677ce", 5);
        }
      }
      if (this.contact(e.x, e.y, e.radius * 0.82, e.radius * 0.8)) {
        this.hurt(e.hurt, e.x);
        e.hp = 0;
        e.escaped = true;
      } else if (e.y > 735) {
        e.hp = 0;
        e.escaped = true;
        this.stats.enemyEscapes++;
        if (this.invulnerable <= 0) {
          this.hurt(1, e.x);
          this.say("BREACH", e.x, 705, "#ff98aa");
        }
      }
    }
    const boss = this.boss;
    if (boss) {
      boss.age += dt;
      boss.hit = Math.max(0, boss.hit - dt);
      boss.y = Math.min(167, boss.y + 62 * dt);
      boss.x =
        210 + Math.sin(boss.age * 0.65) * (boss.kind === "maw" ? 92 : 65);
      if (boss.y >= 167) {
        if (this.mode === "endless" && this.bosses >= 2) {
          boss.adds -= dt;
          if (boss.adds <= 0) {
            boss.adds = 6;
            const x = LANES[Math.floor(this.rng() * 3)];
            this.spawn({
              items: [
                {
                  kind: this.bosses >= 4 ? "elite" : "runner",
                  x,
                  y: -30,
                  scale: 1 + Math.min(0.5, this.bosses * 0.06),
                },
              ],
            });
          }
        }
        boss.cooldown -= dt;
        if (boss.cooldown <= 0 && !boss.attack) {
          const lane = LANES.reduce(
            (a, b) => (Math.abs(b - this.x) < Math.abs(a - this.x) ? b : a),
            210,
          );
          boss.attack = { lanes: [lane], t: 0, hit: false };
          if (boss.kind === "maw" && boss.hp < boss.maxHp * 0.65)
            boss.attack.lanes.push(LANES[(LANES.indexOf(lane) + 1) % 3]);
          this.emit("warning");
        }
        if (boss.attack) {
          const a = boss.attack;
          a.t += dt;
          if (a.t > 1.35 && !a.hit) {
            a.hit = true;
            if (
              a.lanes.some((l) =>
                formation(this.squad).some(
                  (p) => Math.abs(l - this.x - p.x) < 44 + 8,
                ),
              )
            )
              this.hurt(3);
            this.shake = 3;
            this.emit("impact");
          }
          if (a.t > 1.8) {
            boss.attack = null;
            boss.cooldown = boss.kind === "maw" ? 1.5 : 2.1;
          }
        }
      }
    }
    for (const b of this.bullets) {
      const ox = b.x,
        oy = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let target = null,
        first = Infinity,
        resource = false;
      const check = (e, rx, ry, isResource) => {
        // Offscreen targets cannot absorb bullets or be farmed before arrival.
        if (e.y < 55 || e.y > 760) return;
        const t = segmentHit(ox, oy, b.x, b.y, e.x, e.y, rx, ry);
        if (t < first) {
          first = t;
          target = e;
          resource = isResource;
        }
      };
      for (const e of this.enemies)
        if (e.hp > 0) check(e, e.radius * 0.85 + 2, e.radius * 0.85, false);
      for (const p of this.pickups)
        if (!p.done && (p.type === "panel" || (p.type === "crate" && p.hp > 0)))
          check(
            p,
            p.type === "panel" ? 42 : 32,
            p.type === "panel" ? 25 : 28,
            true,
          );
      if (boss && boss.y >= 167 && boss.hp > 0)
        check(boss, boss.radius, 55, false);
      if (target) {
        if (resource) this.hitResource(target, b);
        else {
          target.hp -= b.damage;
          target.hit = 0.075;
          this.stats.hits++;
          this.emit("hit");
          if (this.effects.length < 95)
            this.burst(
              ox + (b.x - ox) * first,
              oy + (b.y - oy) * first,
              "#ffc982",
              2,
            );
        }
        b.y = -100;
      }
    }
    this.bullets = this.bullets.filter(
      (b) => b.y > -20 && b.x > 15 && b.x < W - 15,
    );
    for (const e of this.enemies)
      if (e.hp <= 0 && !e.escaped) {
        this.score += e.points;
        this.kills++;
        this.burst(e.x, e.y, e.kind === "elite" ? "#e7a2ff" : "#da6589", 10);
        this.emit("death");
      }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    if (boss && boss.hp <= 0) {
      this.burst(boss.x, boss.y, "#ffad80", 40);
      this.say("GUARDIAN DOWN", 210, 255, "#ffdeac");
      this.score += 1000;
      this.bosses++;
      this.boss = null;
      this.shake = 6;
      this.emit("bossDeath");
      if (this.mode === "campaign") this.finish(true);
      else {
        this.nextBoss = this.time + 43;
        this.nextEndless = this.time + 3;
        this.squad = Math.min(60, this.squad + 4);
      }
    }
    for (const p of this.pickups) {
      p.age += dt;
      p.hit = Math.max(0, (p.hit || 0) - dt);
      p.locked = !!(p.guard && p.guard.hp > 0);
      if (p.type === "panel")
        p.tint += (Math.sign(p.value) - p.tint) * (1 - Math.exp(-14 * dt));
      if (p.released > 0) p.released -= dt;
      else p.y += (p.locked ? p.guard.speed : (p.speed ?? 82)) * dt;
      // The same rendered scout footprint touches good and dangerous objects.
      if (!p.done && p.y >= 635) {
        p.done = true;
        if (
          this.contact(
            p.x,
            649,
            p.type === "panel" ? 42 : p.type === "drop" ? 19 : 32,
            22,
          )
        )
          this.collect(p);
      }
      if (p.y > H + 45) p.done = true;
    }
    this.pickups = this.pickups.filter((p) => !p.done);
    for (const h of this.hostile) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (this.contact(h.x, h.y, h.r, h.r)) {
        this.hurt(2, h.x);
        h.y = 900;
      }
    }
    this.hostile = this.hostile.filter((h) => h.y < 780);
    this.animateEffects(dt);
  }
}
