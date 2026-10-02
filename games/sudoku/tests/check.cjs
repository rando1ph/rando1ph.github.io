// Start a local HTTP server at the repository root before running.
// PLAYWRIGHT_MODULE=/path/to/playwright SUDOKU_URL=http://127.0.0.1:8024/games/sudoku/ node games/sudoku/tests/check.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../sudoku-engine.js');
const puzzle = Array.from('530070000600195000098000060800060003400803001700020006060000280000419005000080079', Number);
const solution = Array.from('534678912672195348198342567859761423426853791713924856961537284287419635345286179', Number);
const key = 'randolf:sudoku:v1';
const url = process.env.SUDOKU_URL || 'http://127.0.0.1:8024/games/sudoku/';
const output = '/tmp/sudoku-check-qa';
const fixture = (values = puzzle.slice()) => ({
  v: 1, generatorVersion: E.GENERATOR_VERSION, difficulty: 'easy', seed: 12345,
  puzzle, solution, values, notes: Array(81).fill(0), elapsedMs: 65000,
  hintCount: 2, completed: false, selected: null, notesMode: false
});

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  fs.mkdirSync(output, { recursive: true });
  const context = await browser.newContext();
  // Apply fixtures after the old page's pagehide save, before the new UI boots.
  await context.addInitScript(({ key }) => {
    const pending = sessionStorage.getItem('sudoku-check-fixture');
    if (pending !== null) {
      if (pending === 'null') localStorage.removeItem(key);
      else localStorage.setItem(key, pending);
      sessionStorage.removeItem('sudoku-check-fixture');
    }
  }, { key });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const check = page.getByRole('button', { name: 'Check', exact: true });
  const cell = i => page.locator('.sd-cell').nth(i);
  const feedback = () => page.locator('[data-sd-feedback]').textContent();
  const save = () => page.evaluate(k => localStorage.getItem(k), key);
  const load = async data => {
    await page.goto(url);
    await page.evaluate(data => sessionStorage.setItem('sudoku-check-fixture', JSON.stringify(data)), data);
    await page.reload();
    await check.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-sd-hints]').textContent(), String(data.hintCount));
  };
  const enter = async (i, d) => { await cell(i).click(); await cell(i).press(String(d)); };
  const marked = () => page.locator('.is-check-error').count();
  const cleared = () => page.waitForFunction(() => !document.querySelector('.is-check-error'));
  try {
    await load(fixture());
    for (const [width, height] of [[360, 800], [390, 844], [430, 932], [1280, 900]]) {
      await page.setViewportSize({ width, height });
      const layout = await page.locator('.sd-actions').first().evaluate(el => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttons: Array.from(el.children, b => {
          const r = b.getBoundingClientRect();
          return { text: b.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
        })
      }));
      assert.equal(layout.overflow, false);
      assert.equal(layout.buttons.length, 5);
      for (const b of layout.buttons) assert.ok(b.w >= 44 && b.h >= 44 && b.x + b.w <= width);
      assert.equal(new Set(layout.buttons.map(b => b.y)).size, width <= 520 ? 2 : 1);
      await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
      console.log(`PASS layout ${width}×${height}: ${layout.buttons.map(b => `${b.text} ${Math.round(b.w)}×${b.h}`).join(', ')}`);
    }

    await check.click();
    assert.equal(await feedback(), 'No mistakes so far.');
    assert.equal(await marked(), 0);
    await enter(3, solution[3]);
    await enter(10, 'n');
    await cell(10).press('2');
    await cell(10).press('n');
    await enter(2, 1); // Locally legal, but the unique answer is 4.
    assert.equal(await page.locator('.is-conflict').count(), 0);
    const before = await save();
    const beforeLabels = await page.locator('.sd-cell').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    await page.evaluate(() => {
      window.checkSamples = [];
      const el = document.querySelectorAll('.sd-cell')[2];
      const end = performance.now() + 1400;
      function sample() {
        const bg = getComputedStyle(el).backgroundColor;
        window.checkSamples.push({ marked: el.classList.contains('is-check-error'), bg });
        if (performance.now() < end) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await check.click();
    assert.equal(await feedback(), '1 mistake found.');
    assert.equal(await page.locator('[data-sd-live]').textContent(), '1 mistake found.');
    assert.equal(await marked(), 1);
    const animation = await cell(2).evaluate(el => {
      const css = getComputedStyle(el);
      return [css.animationDuration, css.animationIterationCount];
    });
    assert.deepEqual(animation, ['0.3s', '3']);
    await page.waitForTimeout(110);
    await page.screenshot({ path: `${output}/red-pulse.png`, fullPage: true });
    await cleared();
    assert.equal(await save(), before, 'Check must not write persistence');
    assert.deepEqual(await page.locator('.sd-cell').evaluateAll(els => els.map(e => e.getAttribute('aria-label'))), beforeLabels);
    const samples = await page.evaluate(() => window.checkSamples);
    const red = samples.map(s => s.marked && /^rgba?\(255, 107, 107, 0\.(?:[34]|42)/.test(s.bg));
    assert.equal(red.filter((on, i) => on && !red[i - 1]).length, 3, 'three visible red peaks');
    assert.equal(await page.locator('[data-sd-hints]').textContent(), '2');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await cell(2).getAttribute('aria-label'), 'Row 1 Column 3, empty', 'Check creates no Undo operation');
    console.log('PASS three measured red pulses, singular/live feedback, values/notes/save/hints unchanged, Undo unchanged');

    await check.click();
    assert.equal(await feedback(), 'No mistakes so far.');
    await enter(2, 5);
    await enter(5, 2);
    await enter(6, 1);
    const conflicts = await page.locator('.is-conflict').count();
    assert.ok(conflicts > 0);
    await check.click();
    assert.equal(await feedback(), '3 mistakes found.');
    assert.equal(await marked(), 3);
    await page.waitForTimeout(500);
    await check.click();
    await page.waitForTimeout(500);
    assert.equal(await marked(), 3, 'second Check replaces the cleanup timer');
    await cleared();
    assert.equal(await page.locator('.is-conflict').count(), conflicts);
    console.log('PASS plural feedback, repeated Check restarts, conflicts preserved');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const timerBefore = await page.locator('[data-sd-timer]').textContent();
    await check.click();
    await page.waitForTimeout(50); // Allow the existing 0.01ms reduced-motion transition to settle.
    for (let n = 0; n < 3; n++) {
      const style = await cell(2).evaluate(el => {
        const css = getComputedStyle(el);
        return [css.animationName, css.backgroundColor, getComputedStyle(el.querySelector('.sd-val')).color];
      });
      assert.deepEqual(style, ['none', 'rgba(255, 107, 107, 0.42)', 'rgb(255, 107, 107)']);
      await page.waitForTimeout(200);
    }
    assert.equal(await marked(), 3);
    await page.screenshot({ path: `${output}/reduced-motion.png`, fullPage: true });
    await cleared();
    await page.waitForTimeout(600);
    assert.notEqual(await page.locator('[data-sd-timer]').textContent(), timerBefore, 'timer keeps running');
    console.log('PASS reduced motion stays static, then clears; timer keeps running');

    await check.click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    assert.equal(await marked(), 0);
    assert.equal(await check.isDisabled(), true);
    await page.locator('[data-sd-confirm]').click();
    assert.equal(await check.isEnabled(), true);
    assert.equal(await marked(), 0);
    await enter(2, 1);
    await check.click();
    await page.locator('[data-sd-new-bar]').click();
    assert.equal(await marked(), 0);
    assert.equal(await check.isDisabled(), true);
    await page.locator('[data-sd-confirm]').click();
    await page.waitForFunction(() => !document.querySelector('[data-sd-check]').disabled);
    assert.equal(await marked(), 0);
    console.log('PASS restart/new puzzle and confirmation cleanup');

    const almost = solution.slice();
    almost[2] = 1;
    await load(fixture(almost));
    await check.click();
    await enter(2, solution[2]);
    assert.equal(await marked(), 0);
    assert.equal(await check.isDisabled(), true);
    assert.equal(await page.locator('[data-sd-panel="complete"]').isVisible(), true);
    await page.reload();
    assert.equal(await check.isDisabled(), true);
    console.log('PASS completion clears Check and disables gameplay controls, including after reload');

    // Hold generation responses so the disabled state can be inspected reliably.
    await page.route('**/sudoku-worker.js', route => route.fulfill({
      contentType: 'text/javascript', body: 'onmessage = function () {};'
    }));
    await page.evaluate(() => sessionStorage.setItem('sudoku-check-fixture', 'null'));
    await page.reload();
    assert.equal(await page.locator('[data-sd-panel="generating"]').isVisible(), true);
    assert.equal(await check.isDisabled(), true);
    assert.equal(await page.locator('[data-sd-hint]').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS generation disables Check; no page errors');
    console.log('ALL CHECK UI TESTS PASSED');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
