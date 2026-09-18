// Browser QA uses an external Playwright installation; it adds no site dependency.
// PLAYWRIGHT_MODULE=/path/to/playwright node games/frontline/tests/browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("fs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
  });
  fs.mkdirSync("/tmp/frontline-v2-qa", { recursive: true });
  const errors = [],
    warnings = [],
    report = { viewports: [], tests: [] };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "warning") warnings.push(m.text());
  });
  const url = "http://127.0.0.1:8018/games/frontline/?qa=1";
  await page.goto(url);
  await page.getByRole("button", { name: "DEPLOY SQUAD" }).click();
  const initial = await page.evaluate(() => ({
    seed: frontlineQA.game.seed,
    schedule: JSON.stringify(frontlineQA.game.schedule),
  }));
  const rect = await page.locator("canvas").boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.83 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: rect.x + rect.width * 0.85, y: rect.y + rect.height * 0.83 },
    ],
  });
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => frontlineQA.game.x > 300));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  report.tests.push("Real CDP touch drag moves squad right");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");
  assert.ok(await page.evaluate(() => frontlineQA.game.x < 250));
  report.tests.push("Keyboard steering");
  await page.getByRole("button", { name: "Pause game" }).click();
  const t = await page.evaluate(() => frontlineQA.game.time);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => frontlineQA.game.time), t);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => frontlineQA.screen), "game");
  report.tests.push("Pause freezes time, Escape resumes from focused button");
  await page.getByRole("button", { name: "Pause game" }).click();
  await page
    .getByRole("button", { name: "Restart · same battlefield" })
    .click();
  assert.deepEqual(
    await page.evaluate(() => ({
      seed: frontlineQA.game.seed,
      schedule: JSON.stringify(frontlineQA.game.schedule),
    })),
    initial,
  );
  report.tests.push("Same-seed restart");
  await page.reload();
  await page.getByRole("button", { name: "DEPLOY SQUAD" }).click();
  assert.deepEqual(
    await page.evaluate(() => ({
      seed: frontlineQA.game.seed,
      schedule: JSON.stringify(frontlineQA.game.schedule),
    })),
    initial,
  );
  report.tests.push("Seed persists across reload");
  await page.evaluate(() => {
    const q = frontlineQA;
    q.freeze();
    q.game.collect({ kind: "squad", value: 3, x: 210, y: 635 });
    q.game.collect({ kind: "weapon", value: 1, x: 210, y: 635 });
    q.game.collect({ kind: "weapon", value: 1, x: 210, y: 635 });
    q.step(60);
  });
  assert.equal(await page.evaluate(() => frontlineQA.game.squad), 8);
  assert.equal(await page.evaluate(() => frontlineQA.game.weapon), 2);
  assert.ok(await page.evaluate(() => frontlineQA.game.bullets.length > 8));
  report.tests.push("Visible growth, 3 weapon states, auto-fire");
  await page.evaluate(() => {
    let g = frontlineQA.game;
    g.enemies = [];
    g.bullets = [];
    g.spawn({ items: [{ kind: "grunt", x: g.x, y: 590, scale: 1 }] });
    frontlineQA.step(90);
  });
  assert.ok(await page.evaluate(() => frontlineQA.game.kills > 0));
  report.tests.push("Swept projectile hit and enemy death");
  await page.evaluate(() => {
    let g = frontlineQA.game;
    g.invulnerable = 0;
    g.spawn({ items: [{ kind: "brute", x: g.x, y: 629, scale: 1 }] });
    frontlineQA.step(1);
  });
  assert.equal(await page.evaluate(() => frontlineQA.game.squad), 4);
  report.tests.push("Enemy contact removes scouts");
  await page.evaluate(() => {
    frontlineQA.game.invulnerable = 0;
    frontlineQA.game.hurt(99);
    frontlineQA.step(1);
  });
  await page.getByRole("heading", { name: "Hold on. Try again." }).waitFor();
  report.tests.push("Loss and result UI");
  await page.getByRole("button", { name: "DEPLOY AGAIN" }).click();
  await page.evaluate(() => {
    const g = frontlineQA.game;
    frontlineQA.freeze();
    g.spawnBoss();
    g.boss.y = 167;
    g.boss.cooldown = 0;
    frontlineQA.step(1);
  });
  assert.ok(await page.evaluate(() => frontlineQA.game.boss.attack));
  await page.evaluate(() => {
    frontlineQA.game.boss.hp = 0;
    frontlineQA.step(1);
  });
  await page.getByRole("heading", { name: "Road cleared." }).waitFor();
  assert.ok(await page.evaluate(() => frontlineQA.save.completed.includes(0)));
  await page.getByRole("button", { name: "NEXT SECTOR" }).click();
  assert.equal(await page.evaluate(() => frontlineQA.game.level), 1);
  report.tests.push(
    "Boss telegraph, victory, sequential unlock and Next sector",
  );
  await page.reload();
  await page.getByRole("button", { name: "Choose sector" }).click();
  assert.ok(await page.getByRole("button", { name: /Sector 3:/ }).isDisabled());
  await page.getByRole("button", { name: /Sector 1:/ }).click();
  assert.ok(await page.getByRole("button", { name: "New layout" }).isVisible());
  await page.getByRole("button", { name: "New layout" }).click();
  assert.notEqual(
    await page.evaluate(() => frontlineQA.game.seed),
    initial.seed,
  );
  report.tests.push(
    "Completion persists; locked sectors; cleared-sector reseed",
  );
  await page.getByRole("button", { name: "SOUND ON", exact: true }).click();
  await page.reload();
  assert.ok(
    await page
      .getByRole("button", { name: "SOUND OFF", exact: true })
      .isVisible(),
  );
  await page.getByRole("button", { name: "SOUND OFF", exact: true }).click();
  report.tests.push("Sound preference persists");
  await page.getByRole("button", { name: "ENDLESS EXPEDITION" }).click();
  const eSeed = await page.evaluate(() => frontlineQA.game.seed);
  await page.evaluate(() => {
    const q = frontlineQA;
    q.freeze();
    q.game.distance = 1234;
    q.game.score = 2222;
    q.game.bosses = 2;
    q.game.hurt(99);
    q.step(1);
  });
  await page.getByRole("button", { name: "Replay · same battlefield" }).click();
  assert.equal(await page.evaluate(() => frontlineQA.game.seed), eSeed);
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "Back to operations" }).click();
  assert.ok(
    (
      await page.getByRole("button", { name: "ENDLESS EXPEDITION" }).innerText()
    ).includes("1,234"),
  );
  await page.getByRole("button", { name: "ENDLESS EXPEDITION" }).click();
  assert.notEqual(await page.evaluate(() => frontlineQA.game.seed), eSeed);
  report.tests.push(
    "Endless best stats, same-seed replay, fresh expedition seed",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.evaluate(() => frontlineQA.screen), "paused");
  await page.evaluate(() => {
    delete document.hidden;
  });
  report.tests.push("Hidden-document pause handler");
  await page.getByRole("button", { name: "Back to operations" }).click();
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [430, 932],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `/tmp/frontline-v2-qa/menu-${width}.png` });
    const layout = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      canvas: document.querySelector("canvas").getBoundingClientRect().toJSON(),
      footer: document
        .querySelector(".game-foot")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.ok(layout.scroll <= width);
    assert.ok(layout.footer.bottom <= height);
    report.viewports.push({
      width,
      height,
      canvas: layout.canvas.width,
      overflow: false,
    });
    await page.getByRole("button", { name: "DEPLOY SQUAD" }).click();
    await page.evaluate(() => {
      const q = frontlineQA,
        g = q.game;
      q.freeze();
      g.time = 68;
      g.next = g.schedule.length;
      g.enemies = [];
      g.pickups = [];
      g.squad = 12;
      g.weapon = 2;
      g.spawnBoss();
      g.boss.y = 167;
      g.boss.attack = { lanes: [210], t: 0.7, hit: false };
      g.spawn({
        items: [
          { kind: "elite", x: 95, y: 330, scale: 1 },
          { kind: "runner", x: 320, y: 430, scale: 1 },
          { kind: "grunt", x: 200, y: 390, scale: 1 },
          { kind: "squad", x: 93, y: 525, value: 3 },
          { kind: "weapon", x: 326, y: 555, value: 1 },
        ],
      });
      q.step(12);
    });
    await page.screenshot({ path: `/tmp/frontline-v2-qa/battle-${width}.png` });
    await page.getByRole("button", { name: "Pause game" }).click();
    await page.getByRole("button", { name: "Back to operations" }).click();
  }
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  desktop.on("pageerror", (e) => errors.push(e.message));
  await desktop.goto(url);
  await desktop.screenshot({ path: "/tmp/frontline-v2-qa/desktop.png" });
  await desktop.getByRole("button", { name: "DEPLOY SQUAD" }).click();
  const r = await desktop.locator("canvas").boundingBox();
  await desktop.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.8);
  await desktop.mouse.down();
  await desktop.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.8, {
    steps: 8,
  });
  await desktop.mouse.up();
  await desktop.waitForTimeout(200);
  assert.ok(await desktop.evaluate(() => frontlineQA.game.x < 150));
  report.tests.push("Desktop mouse drag");
  report.stress = await desktop.evaluate(() => {
    const q = frontlineQA,
      g = q.game;
    q.freeze();
    g.enemies = [];
    g.pickups = [];
    g.bullets = [];
    g.squad = 60;
    g.weapon = 2;
    g.rapid = 1.65;
    g.damage = 2.4;
    g.time = 10;
    g.next = g.schedule.length;
    g.bossStarted = true;
    for (let i = 0; i < 48; i++)
      g.spawn({
        items: [
          {
            kind: ["grunt", "runner", "brute", "elite"][i % 4],
            x: 65 + (i % 8) * 40,
            y: 80 + Math.floor(i / 8) * 60,
            scale: 10,
          },
        ],
      });
    q.step(30);
    return {
      scouts: g.squad,
      visible: 30,
      enemies: g.enemies.length,
      bullets: g.bullets.length,
      particles: g.effects.length,
    };
  });
  await desktop.screenshot({ path: "/tmp/frontline-v2-qa/stress.png" });
  await desktop.emulateMedia({ reducedMotion: "reduce" });
  await desktop.reload();
  assert.ok(await desktop.evaluate(() => frontlineQA.renderer.reduced));
  report.tests.push("Reduced-motion rendering");
  report.errors = errors;
  report.warnings = warnings;
  fs.writeFileSync(
    "/tmp/frontline-v2-qa/browser-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
