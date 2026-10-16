import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const draftKey = 'randolf:beads:draft:v2';
// Accept the editor's intentional resize/export/print confirmations as a user would.
test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  // Exercise the cross-browser download fallback; native OS save dialogs cannot
  // be operated by headless Playwright. The upstream picker path stays intact.
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
});
async function ready(page) {
  await expect(page.locator('#convertOverlay')).not.toHaveClass(/is-visible/, { timeout: 25_000 });
  await expect(page.locator('#patternReadyBar')).toBeVisible();
  await expect.poll(() => page.locator('#totalBeads').textContent()).not.toBe('0');
}
async function openTools(page, mobile) {
  if (mobile) await page.locator('[data-mobile-target="controlPanel"]').click();
}
async function closeTools(page, mobile) {
  if (mobile) await page.keyboard.press('Escape');
}
async function downloadBytes(page, action) {
  const event = page.waitForEvent('download');
  await action();
  const download = await event;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test('Simplified Chinese, navigation, local sample and 82 upstream browser regressions', async ({ page }) => {
  const errors = [], messages = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => messages.push(message.text()));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) network.push({ url: request.url(), method: request.method() });
  });
  await page.addInitScript(() => localStorage.setItem('bead-grid-studio:locale', 'en-US'));
  await page.goto('/beads/?lang=en-US&selftest=1');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle(/拼豆/);
  await expect(page.locator('.randolf-header a[aria-current]')).toHaveText('拼豆');
  await expect(page.locator('button[data-locale]')).toHaveCount(0);
  await expect.poll(() => messages.find(message => message.includes('豆格工坊自检通过'))).toMatch(/82 项/);
  await page.locator('#trySampleBtn').click();
  await ready(page);
  await expect(page.locator('#statusMessage')).toContainText('转换完成');
  expect(network.every(item => item.method === 'GET' && new URL(item.url).origin === 'http://127.0.0.1:4180')).toBe(true);
  expect(errors).toEqual([]);
});

test('tool status messages are translated instead of displaying dictionary keys', async ({ page }) => {
  await page.goto('/beads/');
  await expect(page.locator('#statusMessage')).toContainText('画笔工具');
  await page.keyboard.press('e');
  await expect(page.locator('#statusMessage')).toContainText('橡皮工具');
  await page.keyboard.press('i');
  await expect(page.locator('#statusMessage')).toContainText('取色工具');
});

test('real image converts locally and exports a printable PNG and editable project', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request); });
  await page.goto('/beads/');
  await page.locator('#imageInput').setInputFiles(resolve('upstream/tests/fixtures/rocket-badge.png'));
  await ready(page);
  await openTools(page, mobile);
  await page.locator('[data-size="24"]').click();
  await expect.poll(async () => Math.max(Number(await page.locator('#gridCols').inputValue()), Number(await page.locator('#gridRows').inputValue()))).toBe(24);
  await ready(page);
  await closeTools(page, mobile);
  const png = await downloadBytes(page, () => page.locator('#readyExportBtn').click());
  expect(png.name).toMatch(/24x24\.png$/);
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(png.bytes.length).toBeGreaterThan(10_000);
  const saved = await downloadBytes(page, () => page.locator('#readySaveBtn').click());
  const project = JSON.parse(saved.bytes);
  expect(project.grid.cells.length).toBe(24 * 24);
  expect(project.reference).toEqual({ embedded: false });
  expect(requests.every(request => request.method() === 'GET' && new URL(request.url()).origin === 'http://127.0.0.1:4180')).toBe(true);
  await page.screenshot({ path: info.outputPath('converted.png'), fullPage: true });
});

test('brush, eraser, undo, redo, transforms and project roundtrip preserve cell data', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/beads/');
  // Dismiss the onboarding by drawing via the accessible canvas keyboard controls.
  const canvas = page.locator('#patternCanvas');
  await canvas.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#totalBeads')).toHaveText('1');
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#totalBeads')).toHaveText('2');
  await expect(page.locator('#statusMessage')).toContainText('已使用键盘绘制');
  await expect(page.locator('#statusMessage')).not.toContainText('{label}');
  await page.keyboard.press('Delete');
  await expect(page.locator('#totalBeads')).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#totalBeads')).toHaveText('2');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#totalBeads')).toHaveText('1');
  await openTools(page, mobile);
  await page.locator('#mirrorHBtn').click();
  await page.locator('#rotateBtn').click();
  await closeTools(page, mobile);
  const saved = await downloadBytes(page, () => page.locator('#readySaveBtn').click());
  const before = JSON.parse(saved.bytes);
  expect(before.grid.cells.filter(Boolean)).toHaveLength(1);
  await page.reload();
  await page.locator('#projectInput').setInputFiles({ name: '图纸.json', mimeType: 'application/json', buffer: saved.bytes });
  await ready(page);
  const loaded = await downloadBytes(page, () => page.locator('#readySaveBtn').click());
  expect(JSON.parse(loaded.bytes).grid).toEqual(before.grid);
});

test('material totals, Chinese CSV and making progress survive reload', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/beads/');
  await page.locator('#trySampleBtn').click();
  await ready(page);
  await page.locator('#readyMakeBtn').click();
  await page.locator('#makingCompleteBtn').click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.making.completedColorCodes.length || 0, draftKey)).toBe(1);
  if (mobile) {
    await page.locator('[data-mobile-target="statsSection"]').click();
    await expect.poll(() => page.evaluate(() => {
      const button = document.querySelector('#exportCsvBtn').getBoundingClientRect();
      const heading = document.querySelector('#palettePanel .mobile-sheet-head').getBoundingClientRect();
      return button.top >= heading.bottom;
    })).toBe(true);
  }
  const csv = await downloadBytes(page, () => page.locator('#exportCsvBtn').click());
  const text = csv.bytes.toString('utf8').replace(/^\uFEFF/, '');
  expect(text).toMatch(/^色号,颜色名称,屏幕参考 HEX,数量,制作完成/);
  expect(text).toMatch(/,是\r?\n/);
  const count = text.trim().split(/\r?\n/).slice(1).reduce((sum, row) => sum + Number(row.split(',')[3]), 0);
  expect(count).toBe(Number((await page.locator('#totalBeads').textContent()).replaceAll(',', '')));
  await page.reload();
  await page.locator('#restoreDraftBtn').click();
  await ready(page);
  await page.locator('#readyMakeBtn').click();
  await expect.poll(async () => Number(await page.locator('#makingProgressBar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(page.locator('.stat-row.is-complete')).toHaveCount(1);
});

test('offline cache stays scoped to beads and preserves other applications', async ({ page, context }) => {
  await page.goto('/beads/');
  const scope = await page.evaluate(async () => {
    const other = await caches.open('other-project-cache-v1');
    await other.put('/sentinel.txt', new Response('keep'));
    return (await navigator.serviceWorker.ready).scope;
  });
  expect(scope).toBe('http://127.0.0.1:4180/beads/');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toContain('other-project-cache-v1');
  await context.setOffline(true);
  await page.reload();
  await page.locator('#trySampleBtn').click();
  await ready(page);
  await page.goto('/beads/privacy.html');
  await expect(page).toHaveTitle(/隐私/);
  await page.goto('/beads/terms.html');
  await expect(page).toHaveTitle(/使用/);
});

test('portable download runs from disk in Chinese with no server', async ({ page }) => {
  await page.goto('/beads/');
  const offline = await downloadBytes(page, () => page.locator('#downloadOfflineLink').click());
  expect(offline.bytes.toString()).toContain('Copyright (c) 2020 maxcleme');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('offline.html')).href);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.locator('#trySampleBtn').click();
  await ready(page);
  expect(errors).toEqual([]);
});

test('responsive navigation and panels fit narrow phones, tablets and desktops', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'explicit viewport matrix');
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1440, 1000], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/beads/');
    await expect(page.locator('#trySampleBtn')).toBeVisible();
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      header: document.querySelector('.randolf-header').getBoundingClientRect().right,
      actions: [...document.querySelectorAll('.randolf-header a,#trySampleBtn,#emptyUploadBtn,#downloadOfflineLink,#topExportBtn')].map(node => {
        const { left, right, height } = node.getBoundingClientRect(); return { left, right, height };
      }),
    }));
    expect(geometry.width, `${width} document`).toBeLessThanOrEqual(width);
    for (const action of geometry.actions) {
      expect(action.left).toBeGreaterThanOrEqual(0);
      expect(action.right).toBeLessThanOrEqual(width + .5);
    }
    if (width < 960) {
      await page.locator('[data-mobile-target="controlPanel"]').click();
      await expect(page.locator('#controlPanel')).toHaveAttribute('data-mobile-open', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('#controlPanel')).not.toHaveAttribute('data-mobile-open', 'true');
    }
    await page.screenshot({ path: info.outputPath(`layout-${width}.png`), fullPage: true });
  }
});

test('homepage and every existing site navigation link to the studio', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'static site links checked once');
  for (const path of ['/', '/ai/', '/news/', '/games/', ...['2048','core-shift','cow-cat-can-fly','frontline','gomoku','minesweeper','reversi','rope-tangle','signal-stack','sudoku','water-sort'].map(name => `/games/${name}/`)]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toMatch(/href="(?:\.\.\/)*beads\/">拼豆<\/a>/);
  }
  await page.goto('/');
  await page.locator('.index-row[href="beads/"]').click();
  await expect(page.locator('#trySampleBtn')).toBeVisible();
});

test('share-card PNG and browser print retain full upstream output', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop output workflow');
  await page.goto('/beads/');
  await page.locator('#trySampleBtn').click();
  await ready(page);
  for (const [format, width, height] of [['wide', 1200, 675], ['portrait', 1080, 1440]]) {
    await page.locator('#readyShareCardBtn').click();
    await page.locator('#shareFormat').selectOption(format);
    const image = await downloadBytes(page, () => page.locator('#shareCardDownloadBtn').click());
    expect(image.bytes.readUInt32BE(16)).toBe(width);
    expect(image.bytes.readUInt32BE(20)).toBe(height);
    if (await page.locator('#shareDialog').isVisible()) await page.locator('#shareCardCloseBtn').click();
  }
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.locator('#printBtn').click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.randolf-header')).toBeHidden();
});
