// External Playwright only; no site dependencies. Serve repository on port 8028.
// PLAYWRIGHT_MODULE=/path/to/playwright node games/cow-cat-can-fly/tests/browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OUT = '/tmp/cow-cat-qa';
const URL = process.env.COW_CAT_URL || 'http://127.0.0.1:8028/games/cow-cat-can-fly/';
const source = fs.readFileSync(path.join(__dirname, '../cow-cat-can-fly.js'), 'utf8');
// Instrument the served copy only. Production has no mutable QA interface.
const hooks = `
  window.__qa = {
    step: function(dt, render = true) { if (!paused) update(dt); if (render) draw(); }, draw: draw,
    reset: function() { resetRun(); state = ST.READY; paused = false; setPauseUI(false); draw(); },
    start: startRun, sound: Sound,
    get cat() { return cat; }, get pipes() { return pipes; },
    get run() { return run; }, get saved() { return store; },
    get difficulty() { return d(); },
    get effects() { return pickupEffects; },
    grids: [SPR_GLIDE, SPR_FLAP, SPR_DIVE], pickups: PICKUP_SPRITES,
    fixture: function(kind) {
      resetRun(); state = ST.PLAYING; paused = false; setPauseUI(false);
      cat.cy = 300; cat.vy = 0;
      pipes.push({ x: CAT_X - OBST_W / 2, center: 300, gap: 204,
        seed: 1, scored: false, pickup: { kind: kind, y: 300, collected: false } });
      draw();
    }
  };
  draw();
`;
const instrumented = source.replaceAll('window.requestAnimationFrame(frame);', '')
  .replace(/\}\)\(\);\s*$/, hooks + '})();');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const report = { viewports: [], checks: [], errors: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.route('**/cow-cat-can-fly.js', route => route.fulfill({ contentType: 'text/javascript', body: instrumented }));
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.goto(URL);
    await page.evaluate(() => {
      localStorage.setItem('randolf:cow-cat-can-fly:v1', '{"best":7,"runs":12}');
      localStorage.setItem('randolf:games:sound', 'off');
    });
    await page.reload();
    assert.deepEqual(await page.evaluate(() => __qa.saved), { best: 7, runs: 12 });
    assert.equal(await page.locator('[data-cc-sound]').getAttribute('aria-pressed'), 'false');

    // Actual touch events and keyboard events exercise existing lifecycle handlers.
    await page.locator('canvas').tap({ position: { x: 80, y: 150 } });
    assert.equal(await page.evaluate(() => __CC_STATE().state), 1);
    for (const key of ['Space', 'ArrowUp', 'KeyW']) {
      await page.evaluate(() => { __qa.cat.vy = 100; });
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => __qa.cat.vy), -340);
    }
    await page.locator('[data-cc-pause]').click();
    const stopped = await page.evaluate(() => __CC_STATE());
    await page.evaluate(() => __qa.step(0.05));
    assert.deepEqual(await page.evaluate(() => __CC_STATE()), stopped);
    await page.locator('canvas').tap({ position: { x: 80, y: 150 } });
    assert.equal(await page.evaluate(() => __CC_STATE().paused), false);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('KeyP');
    assert.equal(await page.evaluate(() => __CC_STATE().paused), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => __CC_STATE().paused), false);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.evaluate(() => __CC_STATE().paused), true);
    await page.locator('canvas').tap({ position: { x: 80, y: 150 } });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
    });
    assert.equal(await page.evaluate(() => __CC_STATE().paused), true);
    report.checks.push('touch, Space/Up/W, button/P/Escape pause, frozen state, tap resume, synthetic blur/visibility');

    for (const [kind, value] of [['food', 1], ['treat', 2]]) {
      await page.evaluate(kind => { __qa.fixture(kind); __qa.step(0); }, kind);
      const state = await page.evaluate(() => __CC_STATE());
      assert.equal(state.score, value);
      assert.equal(state.bonusScore, value);
      assert.equal(state.pipesPassed, 0);
      assert.deepEqual(await page.evaluate(() => __qa.difficulty),
        await page.evaluate(() => __CC_TEST.diffAt(0)));
      await page.evaluate(() => __qa.step(0));
      assert.equal(await page.evaluate(() => __CC_STATE().score), value);
      await page.waitForTimeout(50);
      assert.match(await page.locator('[data-cc-live]').innerText(), new RegExp('Score ' + value));
      await page.screenshot({ path: `${OUT}/pickup-${kind}.png` });
    }
    report.checks.push('food +1 / treat +2 once, visible feedback and ARIA totals');

    // Symmetry and identity checks include every authored pixel, plus real-size art sheet.
    assert.ok(await page.evaluate(() => __qa.grids.every(grid => grid.every(row =>
      row.length === 20 && row === row.split('').reverse().join('')))));
    assert.ok(await page.evaluate(() => __qa.grids.slice(1).every(grid =>
      grid.slice(1, 17).join() === __qa.grids[0].slice(1, 17).join())));
    await page.evaluate(() => {
      const c = document.createElement('canvas'); c.id = 'art-qa'; c.width = 400; c.height = 180;
      c.style.cssText = 'position:fixed;top:0;left:0;z-index:1000;width:400px;height:180px';
      document.body.appendChild(c);
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.fillStyle = '#0e1526'; g.fillRect(0,0,400,180);
      Object.values(__CC_SPRITES).forEach((sprite,i) => {
        g.drawImage(sprite, 18+i*70, 12);
        g.drawImage(sprite, 8+i*130, 60, 120, 108);
      });
      g.drawImage(__qa.pickups.food, 270, 24); g.drawImage(__qa.pickups.treat, 310, 24);
    });
    await page.locator('#art-qa').screenshot({ path: `${OUT}/sprite-sheet.png` });
    await page.evaluate(() => document.querySelector('#art-qa').remove());

    for (const [width, height] of [[360,800], [390,844], [430,932], [1440,1000]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { __qa.reset(); });
      await page.waitForTimeout(100);
      await page.evaluate(() => __qa.draw());
      const layout = await page.evaluate(() => {
        const stage = document.querySelector('[data-cc-stage]').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.cc-chip')].map(b => b.getBoundingClientRect().bottom);
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          top: stage.top, bottom: stage.bottom, stageWidth: stage.width, buttons,
          smoothing: document.querySelector('canvas').getContext('2d').imageSmoothingEnabled };
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.bottom <= height && layout.top >= 0, JSON.stringify({width,height,...layout}));
      assert.ok(layout.buttons.every(bottom => bottom < height));
      assert.equal(layout.smoothing, false);
      await page.screenshot({ path: `${OUT}/ready-${width}.png` });
      await page.evaluate(() => {
        __qa.fixture('food');
        __qa.pipes[0].x = 175;
        __qa.pipes.push({ x: 305, center: 310, gap: 180, seed: 3,
          pickup: { kind: 'treat', y: 344, collected: false } });
        __qa.draw();
      });
      await page.screenshot({ path: `${OUT}/flight-${width}.png` });
      report.viewports.push({ width, height, dpr: 2, ...layout });
    }
    report.checks.push('all sprite rows symmetric; face identical across frames; viewport/DPR2 layout and smoothing');

    // Generated gameplay: real update/collision/scoring, accelerated fixed steps.
    report.generatedRun = await page.evaluate(() => {
      Math.random = __CC_TEST.mulberry(617);
      __qa.start();
      let food = 0, treats = 0, peakEffects = 0, peakPipes = 0, nextDecision = 0;
      for (let i = 0; i < 120*160 && __CC_STATE().state === 1; i++) {
        const state = __CC_STATE(), pipe = state.pipes.find(p => !p.scored);
        const item = pipe && pipe.pickup;
        const target = item && !item.collected ? item.y : pipe ? pipe.center : 300;
        if (i >= nextDecision) {
          nextDecision = i + 12;
          if (state.cat.vy >= 0 && state.cat.cy + state.cat.vy * 0.1 > target + 20)
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        }
        const before = __qa.run.bonusScore;
        __qa.step(1/120, i % 120 === 0);
        const gain = __qa.run.bonusScore - before;
        if (gain === 1) food++; if (gain === 2) treats++;
        peakEffects = Math.max(peakEffects, __qa.effects.length);
        peakPipes = Math.max(peakPipes, __qa.pipes.length);
        if (__qa.run.pipesPassed >= 50) break;
      }
      __qa.draw();
      return { ...__CC_STATE(), food, treats, peakEffects, peakPipes };
    });
    assert.ok(report.generatedRun.pipesPassed >= 20);
    assert.ok(report.generatedRun.food > 0 && report.generatedRun.treats > 0);
    assert.equal(report.generatedRun.score, report.generatedRun.pipesPassed + report.generatedRun.food + 2*report.generatedRun.treats);
    assert.ok(report.generatedRun.peakPipes <= 3 && report.generatedRun.peakEffects <= 4);
    await page.screenshot({ path: `${OUT}/generated-run.png` });
    await page.evaluate(() => {
      for (let i=0; i<600 && __CC_STATE().state !== 3; i++) __qa.step(1/60);
    });
    assert.equal(await page.evaluate(() => __CC_STATE().state), 3);
    await page.waitForTimeout(50);
    const final = await page.evaluate(() => __CC_STATE());
    assert.equal(final.best, report.generatedRun.score);
    assert.match(await page.locator('[data-cc-live]').innerText(), new RegExp(String(final.score)));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('randolf:cow-cat-can-fly:v1'))),
      { best: final.score, runs: 13 });
    await page.screenshot({ path: `${OUT}/game-over.png` });
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Space'); // guard
    assert.equal(await page.evaluate(() => __CC_STATE().state), 3);
    await page.evaluate(() => __qa.step(0.6));
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => __CC_STATE().state), 0);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => __CC_STATE().state), 1);
    await page.reload();
    assert.equal(await page.evaluate(() => __CC_STATE().best), final.score);
    report.checks.push('generated run collects both types; total save/reload, game over, ARIA, restart guard and restart');

    await page.locator('[data-cc-sound]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('randolf:games:sound')), 'on');
    report.pickupVoices = await page.evaluate(async () => {
      const proto = (window.AudioContext || window.webkitAudioContext).prototype;
      const original = proto.createOscillator;
      let voices = 0;
      proto.createOscillator = function() { voices++; return original.call(this); };
      try {
        __qa.sound.pickup(1);
        const food = voices;
        await new Promise(resolve => setTimeout(resolve, 100));
        __qa.sound.pickup(2);
        return { food, treat: voices - food };
      } finally { proto.createOscillator = original; }
    });
    assert.deepEqual(report.pickupVoices, { food: 1, treat: 2 });
    await page.locator('[data-cc-sound]').click();
    for (const raw of ['{broken', 'null']) {
      await page.evaluate(raw => localStorage.setItem('randolf:cow-cat-can-fly:v1', raw), raw);
      await page.reload();
      assert.deepEqual(await page.evaluate(() => __qa.saved), { best: 0, runs: 0 });
    }
    report.checks.push('sound preference toggles, pickup audio calls without errors; malformed storage recovers');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    const still = await page.locator('canvas').screenshot();
    await page.evaluate(() => __qa.step(2));
    assert.deepEqual(await page.locator('canvas').screenshot(), still);
    await page.evaluate(() => { __qa.fixture('treat'); __qa.step(0); });
    const beforeEffect = await page.evaluate(() => ({...__qa.effects[0]}));
    await page.evaluate(() => __qa.step(0.1));
    assert.equal(await page.evaluate(() => __qa.effects[0].y), beforeEffect.y);
    await page.screenshot({path:`${OUT}/reduced-motion.png`});
    report.checks.push('reduced-motion ready canvas stays pixel-identical; pickup label persists without movement');

    // Unmodified game, real RAF, independent desktop/DPR1 smoke test.
    const live = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    live.on('pageerror', e => report.errors.push(e.message));
    await live.goto(URL);
    await live.locator('canvas').click({position:{x:80,y:150}});
    await live.waitForTimeout(100);
    assert.equal(await live.evaluate(() => __CC_STATE().state), 1);
    const y = await live.evaluate(() => __CC_STATE().cat.cy);
    await live.waitForTimeout(100);
    assert.notEqual(await live.evaluate(() => __CC_STATE().cat.cy), y);
    await live.keyboard.press('KeyP');
    const paused = await live.evaluate(() => __CC_STATE());
    await live.waitForTimeout(100);
    assert.deepEqual(await live.evaluate(() => __CC_STATE()), paused);
    await live.screenshot({path:`${OUT}/desktop-dpr1-paused.png`});
    report.checks.push('unmodified production script: desktop click, RAF flight, keyboard pause at DPR1');
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
