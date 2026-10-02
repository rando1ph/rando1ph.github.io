// V2 and V3 browser checks. Run alongside browser.cjs with external Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync("/tmp/frontline-v3-qa", { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage(),
    errors = [],
    warnings = [],
    report = {};
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "warning") warnings.push(m.text());
  });
  const url = "http://127.0.0.1:8018/games/frontline/?qa=1";
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.setItem(
      "randolf:frontline:v1",
      JSON.stringify({
        version: 1,
        completed: [0, 1, 2],
        seeds: { 0: 17, 1: 31, 3: 99 },
        best: { distance: 7777, score: 8888, bosses: 3 },
      }),
    );
    localStorage.setItem("randolf:games:sound", "off");
  });
  await page.reload();
  const migrated = await page.evaluate(() => frontlineQA.save);
  assert.deepEqual(migrated.completed, [0, 1, 2]);
  assert.equal(migrated.seeds[3], 99);
  assert.equal(migrated.best.distance, 7777);
  assert.deepEqual(migrated.mastery, {});
  assert.equal(await page.evaluate(() => GameAudio.isEnabled()), false);
  await page.evaluate(() => {
    const q = frontlineQA;
    q.select(0);
    q.start();
    q.freeze();
    q.game.time = 90;
    q.game.squad = 500;
    q.game.state = "won";
    q.step(1);
  });
  await page.evaluate(() => {
    const q = frontlineQA;
    q.start();
    q.freeze();
    q.game.time = 100;
    q.game.squad = 12;
    q.game.state = "won";
    q.step(1);
  });
  assert.deepEqual(await page.evaluate(() => frontlineQA.save.mastery[0]), {
    time: 90,
    survivors: 500,
  });
  await page.reload();
  assert.deepEqual(await page.evaluate(() => frontlineQA.save.mastery[0]), {
    time: 90,
    survivors: 500,
  });
  await page.getByRole("button", { name: "Choose sector" }).click();
  await page.getByRole("button", { name: /Sector 1:/ }).click();
  assert.ok((await page.locator(".mastery").innerText()).includes("500 SCOUTS"));
  // Malformed mastery fields do not invalidate the rest of a valid old save.
  await page.evaluate(() => {
    const key = "randolf:frontline:v1", s = JSON.parse(localStorage.getItem(key));
    s.mastery[1] = { time: 80, survivors: 120 };
    s.mastery[2] = { time: 80, survivors: 61 };
    s.mastery[3] = { time: 80, survivors: Number.MAX_SAFE_INTEGER + 1 };
    s.mastery[4] = { time: 80, survivors: -1 };
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  assert.equal(await page.evaluate(() => frontlineQA.save.mastery[1].survivors), 120);
  assert.equal(await page.evaluate(() => frontlineQA.save.mastery[2].survivors), 61);
  assert.equal(await page.evaluate(() => frontlineQA.save.mastery[3]), undefined);
  assert.equal(await page.evaluate(() => frontlineQA.save.mastery[4]), undefined);
  report.migration =
    "V1 completion, seeds, Endless records and sound retained; mastery added, 61/120/500 survivors retained across replay/reload; invalid mastery discarded individually";
  report.interactions = await page.evaluate(() => {
    const q = frontlineQA;
    q.start();
    q.freeze();
    const g = q.game;
    g.schedule = [];
    g.bossStarted = true;
    g.cooldown = 999;
    g.spawn({
      items: [
        { kind: "amplifier", x: 94, y: 400, value: -2, maxValue: 8 },
        { kind: "weapon", x: 326, y: 400, crated: true, hp: 18 },
        { kind: "squad", x: 210, y: 400, value: 3 },
      ],
    });
    const [panel, crate, supply] = g.pickups;
    g.hitResource(panel, { damage: 100 });
    const negative = panel.value;
    g.hitResource(panel, { damage: 1 });
    const neutral = panel.value;
    g.hitResource(panel, { damage: 1 });
    const positive = panel.value;
    g.hitResource(crate, { damage: 17 });
    const before = crate.type;
    g.hitResource(crate, { damage: 1 });
    const after = crate.type;
    const uncollected = g.weapon;
    g.collect(crate);
    return {
      negative,
      neutral,
      positive,
      before,
      after,
      uncollected,
      weapon: g.weapon,
      supply: supply.value,
    };
  });
  assert.deepEqual(report.interactions, {
    negative: -1,
    neutral: 0,
    positive: 1,
    before: "crate",
    after: "drop",
    uncollected: 0,
    weapon: 1,
    supply: 3,
  });
  // Deliberately staged visual fixtures, separate from the full unmodified play runs.
  const fixture = () => {
    const q = frontlineQA;
    q.start();
    q.freeze();
    const g = q.game;
    g.schedule = [];
    g.bossStarted = true;
    g.squad = 240;
    g.weapon = 2;
    g.time = 45;
    g.wave = 18;
    g.spawn({
      tags: ["horde"],
      items: [
        ...Array.from({ length: 27 }, (_, i) => ({
          kind: i % 8 === 7 ? "elite" : ["grunt", "runner", "brute"][i % 3],
          x: 80 + (i % 3) * 116,
          y: 130 + Math.floor(i / 3) * 36,
          scale: 1,
        })),
        { kind: "amplifier", x: 94, y: 465, value: -12, maxValue: 12 },
        { kind: "weapon", x: 210, y: 470, crated: true, hp: 22 },
        { kind: "amplifier", x: 326, y: 465, value: 8, maxValue: 12 },
        { kind: "squad", x: 94, y: 565, value: 3 },
        { kind: "weapon", x: 326, y: 565, value: 1 },
      ],
    });
    g.pickups[1].hp = 13;
    for (let i = 0; i < 270; i++) g.bullets.push({
      x: 55 + (i % 30) * 10, y: 170 + Math.floor(i / 30) * 42,
      vx: 0, vy: -1508, damage: 1, color: "#ffdc86",
    });
    q.renderer.draw(g);
    q.step(0);
  };
  report.viewports = [];
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(fixture);
    const reserve = await page.evaluate(() => {
      const q = frontlineQA, labels = [], original = q.renderer.text;
      q.renderer.text = function (text, ...args) { labels.push(text); return original.call(this, text, ...args); };
      q.renderer.draw(q.game);
      q.renderer.text = original;
      return { labels, hud: document.getElementById("squad-label").textContent, enemies: q.game.enemies.length };
    });
    assert.ok(reserve.labels.includes("+210"));
    assert.ok(reserve.hud.includes("240"));
    assert.equal(reserve.enemies, 27);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      footer: document.querySelector(".game-foot").getBoundingClientRect()
        .bottom,
      canvas: document.querySelector("canvas").getBoundingClientRect().width,
    }));
    assert.equal(layout.overflow, false);
    assert.ok(layout.footer <= height);
    await page.screenshot({
      path: `/tmp/frontline-v3-qa/v3-mixed-${width}.png`,
    });
    report.viewports.push({ width, height, ...layout });
  }
  // Replay genuine generated encounters through the browser renderer, one
  // six-step batch per RAF (accelerated automation, not human play evidence).
  report.liveRuns = [];
  for (const scenario of [
    { level: 0, seed: 1, seconds: 24 },
    { level: 9, seed: 2, seconds: 36 },
    { level: 0, seed: 22, seconds: 30, late: true },
  ]) {
    const observed = await page.evaluate(async (scenario) => {
      const { pilot } = await import("./tests/pilot.mjs");
      const q = frontlineQA;
      q.select(scenario.level);
      q.start(scenario.late ? "endless" : "campaign", scenario.seed);
      q.freeze();
      const g = q.game;
      if (scenario.late) Object.assign(g, {
        time: 768, nextBoss: 820, nextEndless: 769, squad: 120, weapon: 2,
      });
      const began = g.time;
      let peak = 0, frames = 0;
      while (g.time - began < scenario.seconds && g.state === "playing") {
        await new Promise(requestAnimationFrame);
        if (frames % 2 === 0) pilot(g, "threat-aware");
        q.step(6);
        peak = Math.max(peak, g.enemies.length);
        frames++;
      }
      return { ...scenario, state: g.state, time: g.time, squad: g.squad,
        lost: g.stats.lost, collected: g.stats.collected, panelHits: g.stats.panelHits,
        kills: g.kills, peak, frames };
    }, scenario);
    assert.equal(observed.state, "playing");
    assert.ok(observed.peak <= 30);
    await page.screenshot({ path: `/tmp/frontline-v3-qa/live-${scenario.late ? "endless" : scenario.level + 1}.png` });
    report.liveRuns.push(observed);
  }
  for (const enemyCount of [30, 48]) {
    report[enemyCount === 30 ? "realisticPeak" : "stress"] = await page.evaluate(async (enemyCount) => {
      const q = frontlineQA,
        g = q.game;
      g.banner = null;
      g.enemies = [];
      g.pickups = [];
      g.bullets = [];
      g.effects = [];
      g.hostile = [];
      g.texts = [];
      g.squad = 240;
      g.spawn({
        items: Array.from({ length: enemyCount }, (_, i) => ({
          kind: i % 8 === 7 ? "elite" : ["grunt", "runner", "brute"][i % 3],
          x: 65 + (i % 8) * 40,
          y: 80 + Math.floor(i / 8) * 68,
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
          y: 430 + Math.floor(i / 3) * 100,
        })),
      });
      for (let i = 0; i < 330; i++)
        g.bullets.push({
          x: 55 + (i % 30) * 10,
          y: 170 + Math.floor(i / 30) * 40,
          vx: 0,
          vy: -1508,
          damage: 1,
          color: "#ffdc86",
        });
      g.burst(210, 350, "#ff7799", 140);
      const times = [],
        intervals = [];
      // Instrument the real RAF draw, rather than rendering an extra frame in
      // each RAF or queuing hundreds of raster jobs in a synchronous loop.
      const originalDraw = q.renderer.draw;
      await new Promise((resolve) => {
        let previous;
        q.renderer.draw = function (game) {
          const now = performance.now();
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          originalDraw.call(this, game);
          times.push(performance.now() - now);
          if (times.length >= 180) {
            this.draw = originalDraw;
            resolve();
          }
        };
      });
      times.sort((a, b) => a - b);
      intervals.sort((a, b) => a - b);
      return {
        scouts: g.squad,
        visible: 30,
        enemies: g.enemies.length,
        resources: g.pickups.length,
        bullets: g.bullets.length,
        particles: g.effects.length,
        drawMedian: times[90],
        drawP95: times[171],
        drawWorst: times.at(-1),
        frameMedian: intervals[89],
        frameP95: intervals[170],
        frameWorst: intervals.at(-1),
      };
    }, enemyCount);
    assert.equal(report[enemyCount === 30 ? "realisticPeak" : "stress"].enemies, enemyCount);
    await page.screenshot({ path: `/tmp/frontline-v3-qa/v3-perf-${enemyCount}.png` });
  }
  report.frameIntervals = await page.evaluate(async () => {
    const samples = [];
    let previous;
    await new Promise((resolve) => {
      function frame(t) {
        if (previous) samples.push(t - previous);
        previous = t;
        if (samples.length < 120) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    samples.sort((a, b) => a - b);
    return { median: samples[60], p95: samples[114], worst: samples.at(-1) };
  });
  // Offline rendering checks signal integrity only: this is NOT listening QA.
  report.audio = await page.evaluate(async () => {
    GameAudio.setEnabled(true);
    for (const key of [
      "panelHit",
      "panelPositive",
      "crateHit",
      "crateBreak",
      "horde",
    ])
      GameAudio.fl[key]();
    const result = [];
    for (const name of [
      "fl.panelHit",
      "fl.panelPositive",
      "fl.crateHit",
      "fl.crateBreak",
      "fl.horde",
    ]) {
      const context = new OfflineAudioContext(1, 44100, 44100);
      GameAudio._render(name, context, context.destination, 0);
      const data = (await context.startRendering()).getChannelData(0);
      let peak = 0,
        energy = 0;
      for (const v of data) {
        if (!Number.isFinite(v)) throw Error("nonfinite audio");
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
      result.push({ name, peak, rms: Math.sqrt(energy / data.length) });
    }
    const before = GameAudio._voices();
    for (let i = 0; i < 100; i++) GameAudio.fl.panelHit();
    return {
      cues: result,
      additionalVoices: GameAudio._voices() - before,
      listened: false,
    };
  });
  for (const cue of report.audio.cues) assert.ok(cue.peak > 0 && cue.peak < 1);
  assert.ok(report.audio.additionalVoices <= 1);
  for (const raw of ["{bad json", JSON.stringify({ version: 42 }), "null"]) {
    await page.evaluate((raw) => localStorage.setItem("randolf:frontline:v1", raw), raw);
    await page.reload();
    assert.deepEqual(await page.evaluate(() => frontlineQA.save.completed), []);
    assert.deepEqual(await page.evaluate(() => frontlineQA.save.mastery), {});
    assert.equal(await page.evaluate(() => frontlineQA.save.best.score), 0);
  }
  report.malformedStorage = "invalid JSON, unsupported version and null fall back safely";
  report.errors = errors;
  report.warnings = warnings;
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  fs.writeFileSync(
    "/tmp/frontline-v3-qa/browser-v3-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
