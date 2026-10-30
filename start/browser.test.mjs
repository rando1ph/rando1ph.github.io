/**
 * Browser acceptance tests. Serve the repository first (for example,
 * `python3 -m http.server 4173`), install Playwright in an isolated directory:
 * `npm install --prefix /tmp/start-test-deps playwright`
 * `/tmp/start-test-deps/node_modules/.bin/playwright install chromium firefox`
 * `PLAYWRIGHT_MODULE=/tmp/start-test-deps/node_modules/playwright/index.mjs node start/browser.test.mjs`
 *
 * Optional: START_BASE_URL, START_BROWSERS=firefox,chromium,
 * START_TEST_ARTIFACTS, PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE_PATH.
 * All external navigation is fulfilled locally; these tests never contact the
 * real search engines or shortcut destinations.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.START_BASE_URL || "http://127.0.0.1:4173/start/";
const origin = new URL(base).origin;
const artifactDir =
  process.env.START_TEST_ARTIFACTS || join(tmpdir(), "start-browser-tests");
const storageKey = "randolf-start-v1";
const browsers = (process.env.START_BROWSERS || "firefox,chromium").split(",");
await mkdir(artifactDir, { recursive: true });

async function open(browser, options = {}) {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const errors = [];
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>Local navigation fixture</title>Destination intercepted by START tests.",
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  return {
    context,
    page,
    errors,
    async close() {
      await context.close();
      assert.deepEqual(
        errors,
        [],
        "No browser console errors or uncaught page errors",
      );
    },
  };
}
async function visit(page) {
  await page.goto(base);
  await page.locator(".shortcut").first().waitFor();
}
const saved = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
const savedRaw = (page) =>
  page.evaluate((key) => localStorage.getItem(key), storageKey);
const theme = (page) => page.locator("html").getAttribute("data-theme");
const categoryNames = (page) =>
  page.locator(".category-heading h2").allTextContents();
const titlesIn = (page, name) =>
  page
    .getByRole("region", { name, exact: true })
    .locator(".link-title")
    .allTextContents();
async function settings(page) {
  await page.locator("#settings-open").click();
  await page.locator("#settings-dialog").waitFor({ state: "visible" });
}
async function closeSettings(page) {
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}
async function exportDocument(page) {
  const waiting = page.waitForEvent("download");
  await page.locator("#export-config").click();
  const download = await waiting;
  assert.match(download.suggestedFilename(), /^START-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(await readFile(await download.path(), "utf8"));
}
async function importDocument(page, document) {
  await page.locator("#import-file").setInputFiles({
    name: "start-config.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      typeof document === "string" ? document : JSON.stringify(document),
    ),
  });
}
async function waitToast(page, text) {
  await page
    .locator("#toast")
    .filter({ hasText: text })
    .waitFor({ state: "visible" });
}
async function assertNoOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "The viewport has no horizontal overflow",
  );
}
async function assertTarget(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(
    box && box.width >= 43 && box.height >= 43,
    `${label} has an approximately 44px touch target: ${JSON.stringify(box)}`,
  );
}

for (const browserName of browsers) {
  await test(browserName, async (t) => {
    const launch = { headless: true };
    if (browserName === "chromium" && process.env.CHROMIUM_EXECUTABLE_PATH)
      launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
    const browser = await playwright[browserName].launch(launch);
    try {
      await t.test(
        "a fresh start renders useful defaults, time, date and local assets",
        async () => {
          const fixture = await open(browser),
            { page } = fixture;
          try {
            const remoteRequests = [];
            page.on("request", (request) => {
              if (new URL(request.url()).origin !== origin)
                remoteRequests.push(request.url());
            });
            await visit(page);
            assert.equal(await page.locator(".shortcut").count(), 16);
            assert.deepEqual(await categoryNames(page), [
              "Daily",
              "Development",
              "Reading",
              "Tools",
            ]);
            assert.match(
              await page.locator("#clock").innerText(),
              /^\d{2}:\d{2}$/,
            );
            assert.match(
              await page.locator("#date").innerText(),
              /\d{4}年\d{1,2}月\d{1,2}日/,
            );
            assert.match(
              await page.locator("#weekday").innerText(),
              /星期[一二三四五六日]/,
            );
            assert.equal(
              await page
                .locator(
                  '.shortcut[target="_blank"][rel="noopener noreferrer"]',
                )
                .count(),
              16,
            );
            assert.deepEqual(
              remoteRequests,
              [],
              "Initial page uses no external services",
            );
            await page.screenshot({
              path: join(artifactDir, `${browserName}-desktop-dark.png`),
              fullPage: true,
            });
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "search engine preferences, safe popup navigation, direct URLs and same-tab navigation",
        async () => {
          const fixture = await open(browser),
            { page } = fixture;
          try {
            await visit(page);
            await page.locator("#search").fill("an existing query");
            await page.locator("#search-engine").selectOption("bing");
            assert.equal(
              await page.locator("#search-caption").innerText(),
              "使用 Bing 搜索",
              "Changing the engine updates the caption for an existing query",
            );
            for (const [engine, expected] of [
              [
                "google",
                "https://www.google.com/search?q=quiet%20morning%20%26%20coffee",
              ],
              [
                "bing",
                "https://www.bing.com/search?q=quiet%20morning%20%26%20coffee",
              ],
              [
                "duckduckgo",
                "https://duckduckgo.com/?q=quiet%20morning%20%26%20coffee",
              ],
              [
                "baidu",
                "https://www.baidu.com/s?wd=quiet%20morning%20%26%20coffee",
              ],
            ]) {
              await page.locator("#search-engine").selectOption(engine);
              await page.locator("#search").fill("quiet morning & coffee");
              const popupWait = page.waitForEvent("popup");
              await page.locator("#search").press("Enter");
              const popup = await popupWait;
              await popup.waitForURL(expected);
              assert.equal(
                await popup.evaluate(() => window.opener),
                null,
                "New tabs have no opener",
              );
              await popup.close();
            }
            await page.reload();
            assert.equal(
              await page.locator("#search-engine").inputValue(),
              "baidu",
            );
            await page.locator("#search").fill("example.test/somewhere?a=1");
            assert.match(
              await page.locator("#search-caption").innerText(),
              /直接前往 example\.test/,
            );
            const popupWait = page.waitForEvent("popup");
            await page.locator("#search-submit").click();
            const popup = await popupWait;
            await popup.waitForURL("https://example.test/somewhere?a=1");
            await popup.close();
            const hrefBefore = page.url();
            await page.locator("#search").fill("javascript:alert(1)");
            await page.locator("#search").press("Enter");
            await waitToast(page, /仅支持/);
            assert.equal(page.url(), hrefBefore);
            await settings(page);
            await page.locator("#setting-newtab").uncheck();
            await closeSettings(page);
            assert.equal(await page.locator(".shortcut[target]").count(), 0);
            await page.locator("#search").fill("https://example.test/same-tab");
            await page.locator("#search").press("Enter");
            await page.waitForURL("https://example.test/same-tab");
            await visit(page);
            assert.equal((await saved(page)).settings.newTab, false);
            await page
              .getByRole("link", { name: /ChatGPT AI assistant/ })
              .click();
            await page.waitForURL("https://chatgpt.com/");
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "manual and live system themes persist, with 12/24-hour and seconds controls",
        async () => {
          const fixture = await open(browser),
            { page } = fixture;
          try {
            await visit(page);
            assert.equal(await theme(page), "dark");
            await page.locator("#theme-toggle").click();
            assert.equal(await theme(page), "light");
            await page.reload();
            assert.equal(await theme(page), "light");
            await page.emulateMedia({ colorScheme: "dark" });
            assert.equal(
              await theme(page),
              "light",
              "Manual preference remains stable when the system changes",
            );
            await page.screenshot({
              path: join(artifactDir, `${browserName}-desktop-light.png`),
              fullPage: true,
            });
            await settings(page);
            await page
              .getByRole("button", { name: "跟随系统", exact: true })
              .click();
            assert.equal(await theme(page), "dark");
            await page.emulateMedia({ colorScheme: "light" });
            await page.waitForFunction(
              () => document.documentElement.dataset.theme === "light",
            );
            assert.equal((await saved(page)).settings.theme, "system");
            await page
              .getByRole("button", { name: "夜间", exact: true })
              .click();
            assert.equal(await theme(page), "dark");
            await page.locator("#setting-clock24").uncheck();
            await page.locator("#setting-seconds").check();
            assert.equal(await page.locator("#period").isVisible(), true);
            assert.equal(await page.locator(".clock-seconds").count(), 1);
            await closeSettings(page);
            await page.reload();
            assert.equal(await theme(page), "dark");
            assert.equal(await page.locator("#period").isVisible(), true);
            assert.equal(await page.locator(".clock-seconds").count(), 1);
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "keyboard shortcuts, modal focus containment, Escape and destructive confirmation",
        async () => {
          const fixture = await open(browser),
            { page } = fixture;
          try {
            await visit(page);
            await page.keyboard.press("/");
            assert.equal(
              await page
                .locator("#search")
                .evaluate((element) => element === document.activeElement),
              true,
            );
            await page.keyboard.type("preserve this");
            await page.keyboard.press("Control+k");
            assert.equal(
              await page
                .locator("#search")
                .evaluate(
                  (element) => element.selectionEnd - element.selectionStart,
                ),
              13,
            );
            await page.keyboard.press("Escape");
            assert.equal(await page.locator("#search").inputValue(), "");
            await page.keyboard.press("Alt+e");
            assert.equal(
              await page.locator("#edit-toggle").getAttribute("aria-pressed"),
              "true",
            );
            await page.keyboard.press("Escape");
            assert.equal(
              await page.locator("#edit-toggle").getAttribute("aria-pressed"),
              "false",
            );
            await page.keyboard.press("?");
            assert.equal(
              await page.locator("#settings-dialog").isVisible(),
              true,
            );
            for (let i = 0; i < 23; i++) {
              await page.keyboard.press("Tab");
              const focus = await page.evaluate(() => ({
                modal: document.activeElement.closest("dialog")?.id,
                tag: document.activeElement.tagName,
              }));
              // Chromium permits a stop in the browser's own UI during a full
              // cycle (reported as BODY), but must never focus background controls.
              assert.ok(
                focus.modal === "settings-dialog" || focus.tag === "BODY",
                "Tab never focuses a control behind the modal",
              );
              if (focus.tag === "BODY") {
                await page.keyboard.press("Tab");
                assert.equal(
                  await page.evaluate(
                    () => document.activeElement.closest("dialog")?.id,
                  ),
                  "settings-dialog",
                  "Tab returns from browser UI to the modal",
                );
              }
            }
            await page.keyboard.press("Escape");
            assert.equal(
              await page.locator("#settings-dialog").isVisible(),
              false,
            );
            await settings(page);
            await page.keyboard.press("Escape");
            assert.equal(
              await page
                .locator("#settings-open")
                .evaluate((element) => element === document.activeElement),
              true,
            );
            await page.locator("#edit-toggle").click();
            await page
              .getByRole("button", { name: "编辑分类 Daily", exact: true })
              .click();
            await page
              .getByRole("button", { name: "删除分类", exact: true })
              .click();
            assert.equal(
              await page
                .getByRole("button", { name: "取消", exact: true })
                .last()
                .evaluate((element) => element === document.activeElement),
              true,
              "Destructive confirmation starts on Cancel",
            );
            await page.keyboard.press("Escape");
            assert.equal(
              await page.locator("#editor-dialog").isVisible(),
              true,
            );
            assert.deepEqual(await categoryNames(page), [
              "Daily",
              "Development",
              "Reading",
              "Tools",
            ]);
            await page.keyboard.press("Escape");
            assert.equal(
              await page.locator("#editor-dialog").isVisible(),
              false,
            );
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "categories and links support add, edit, move, ordering, cancel and confirmed delete",
        async () => {
          const fixture = await open(browser),
            { page } = fixture;
          try {
            await visit(page);
            await page.locator("#edit-toggle").click();
            await page.locator("#add-category").click();
            await page
              .locator('#category-form [name="name"]')
              .fill("灵感 / Inspiration");
            await page
              .locator('#category-form [name="icon"]')
              .selectOption("book");
            await page.locator('#category-form button[type="submit"]').click();
            assert.equal(
              (await categoryNames(page)).at(-1),
              "灵感 / Inspiration",
            );
            await page
              .getByRole("button", {
                name: "编辑分类 灵感 / Inspiration",
                exact: true,
              })
              .click();
            await page
              .locator('#category-form [name="name"]')
              .fill("My corner");
            await page.locator('#category-form button[type="submit"]').click();
            await page
              .getByRole("button", { name: "上移分类 My corner", exact: true })
              .click();
            assert.deepEqual(await categoryNames(page), [
              "Daily",
              "Development",
              "Reading",
              "My corner",
              "Tools",
            ]);
            await page
              .getByRole("button", { name: "下移分类 My corner", exact: true })
              .click();
            await page
              .getByRole("button", {
                name: "添加链接到 My corner",
                exact: true,
              })
              .click();
            await page
              .locator('#link-form [name="title"]')
              .fill("Design Library");
            await page
              .locator('#link-form [name="url"]')
              .fill("example.test/library");
            await page
              .locator('#link-form [name="description"]')
              .fill("A useful place");
            await page.locator('#link-form button[type="submit"]').click();
            assert.deepEqual(await titlesIn(page, "My corner"), [
              "Design Library",
            ]);
            await page
              .getByRole("button", {
                name: "编辑链接 Design Library",
                exact: true,
              })
              .click();
            await page
              .locator('#link-form [name="url"]')
              .fill("javascript:alert(1)");
            await page.locator('#link-form button[type="submit"]').click();
            assert.equal(await page.locator("#editor-error").isVisible(), true);
            assert.equal(
              (await saved(page)).categories.at(-1).links[0].url,
              "https://example.test/library",
            );
            await page.locator('#link-form [name="title"]').fill("My Library");
            await page
              .locator('#link-form [name="url"]')
              .fill("https://example.test/library?x=1&y=2");
            await page
              .locator('#link-form [name="description"]')
              .fill("<img src=x onerror=alert(1)>");
            await page
              .locator('#link-form [name="category"]')
              .selectOption("daily");
            await page.locator('#link-form button[type="submit"]').click();
            assert.deepEqual(await titlesIn(page, "My corner"), []);
            assert.equal((await titlesIn(page, "Daily")).at(-1), "My Library");
            assert.equal(
              await page.locator(".link-card img").count(),
              0,
              "User text is rendered as text",
            );
            await page
              .getByRole("button", { name: "前移链接 My Library", exact: true })
              .click();
            assert.deepEqual((await titlesIn(page, "Daily")).slice(-2), [
              "My Library",
              "Google Drive",
            ]);
            await page
              .getByRole("button", { name: "后移链接 My Library", exact: true })
              .click();
            assert.equal((await titlesIn(page, "Daily")).at(-1), "My Library");
            await page.reload();
            assert.equal(
              (await titlesIn(page, "Daily")).at(-1),
              "My Library",
              "Edits survive reload",
            );
            await page.locator("#edit-toggle").click();
            await page
              .getByRole("button", { name: "编辑链接 My Library", exact: true })
              .click();
            await page.locator("#delete-link").click();
            await page
              .locator("#confirm-dialog")
              .getByRole("button", { name: "取消", exact: true })
              .click();
            assert.equal((await titlesIn(page, "Daily")).at(-1), "My Library");
            await page.locator("#delete-link").click();
            await page.locator("#confirm-accept").click();
            assert.equal(
              await page
                .getByRole("button", {
                  name: "编辑链接 My Library",
                  exact: true,
                })
                .count(),
              0,
            );
            await page
              .getByRole("button", { name: "编辑分类 My corner", exact: true })
              .click();
            await page.locator("#delete-category").click();
            await page
              .locator("#confirm-dialog")
              .getByRole("button", { name: "取消", exact: true })
              .click();
            assert.equal((await categoryNames(page)).at(-1), "My corner");
            await page.locator("#delete-category").click();
            await page.locator("#confirm-accept").click();
            assert.deepEqual(await categoryNames(page), [
              "Daily",
              "Development",
              "Reading",
              "Tools",
            ]);
            assert.equal(await page.locator(".shortcut").count(), 16);
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "configuration export/import round trip is atomic, cancellable and rejects unsafe files",
        async () => {
          const fixture = await open(browser),
            { page } = fixture;
          try {
            await visit(page);
            await settings(page);
            const original = await exportDocument(page);
            const imported = structuredClone(original);
            imported.categories[0].name = "Imported corner";
            imported.categories[0].links[0].title =
              "<img src=x onerror=alert(1)>";
            imported.settings.theme = "light";
            imported.settings.engine = "bing";
            const before = await savedRaw(page);
            await importDocument(page, imported);
            await page.locator("#confirm-dialog").waitFor({ state: "visible" });
            assert.equal(
              await savedRaw(page),
              before,
              "Reading a valid file does not apply it",
            );
            await page
              .locator("#confirm-dialog")
              .getByRole("button", { name: "取消", exact: true })
              .click();
            assert.equal(
              await savedRaw(page),
              before,
              "Cancel leaves configuration unchanged",
            );
            await importDocument(page, imported);
            await page.locator("#confirm-accept").click();
            assert.equal(await theme(page), "light");
            assert.equal((await categoryNames(page))[0], "Imported corner");
            assert.equal(await page.locator("#categories img").count(), 0);
            assert.deepEqual(
              await exportDocument(page),
              imported,
              "The exported document matches the imported settings and navigation",
            );
            const stable = await savedRaw(page);
            const unsafe = structuredClone(imported);
            unsafe.categories[0].links[0].url =
              "javascript:alert(document.cookie)";
            for (const candidate of [
              "{ broken json",
              { version: 42 },
              unsafe,
              { ...imported, categories: "wrong-type" },
            ]) {
              await importDocument(page, candidate);
              await waitToast(page, /导入失败/);
              assert.equal(
                await page
                  .locator("#toast")
                  .evaluate((element) => element.closest("dialog")?.open),
                true,
                "Import errors are inside the active dialog top layer",
              );
              assert.equal(
                await page.locator("#confirm-dialog").isVisible(),
                false,
              );
              assert.equal(
                await savedRaw(page),
                stable,
                "An invalid import leaves the complete previous document untouched",
              );
            }
            await importDocument(page, " ".repeat(16 * 1024 * 1024 + 1));
            await waitToast(page, /不能超过 16 MB/);
            assert.equal(await savedRaw(page), stable);
            await page.screenshot({
              path: join(artifactDir, `${browserName}-invalid-import.png`),
              fullPage: true,
            });
            await importDocument(page, original);
            await page.locator("#confirm-accept").click();
            assert.deepEqual(await exportDocument(page), original);
            await closeSettings(page);
            await page.reload();
            assert.deepEqual(await categoryNames(page), [
              "Daily",
              "Development",
              "Reading",
              "Tools",
            ]);
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "storage denial preserves current-session editing and export with a visible warning",
        async () => {
          const fixture = await open(browser),
            { page, context } = fixture;
          try {
            await context.addInitScript(() => {
              Storage.prototype.setItem = function () {
                throw new DOMException(
                  "Storage unavailable",
                  "QuotaExceededError",
                );
              };
            });
            await visit(page);
            await page.locator("#theme-toggle").click();
            await waitToast(page, /浏览器未能保存配置/);
            assert.match(
              await page.locator(".footer-local").innerText(),
              /暂未保存/,
            );
            assert.equal(await theme(page), "light");
            await page
              .getByRole("button", { name: "添加链接到 Daily", exact: true })
              .click();
            await page
              .locator('#link-form [name="title"]')
              .fill("Session-only bookmark");
            await page
              .locator('#link-form [name="url"]')
              .fill("example.test/session");
            await page.locator('#link-form button[type="submit"]').click();
            assert.equal(
              (await titlesIn(page, "Daily")).at(-1),
              "Session-only bookmark",
            );
            await settings(page);
            const backup = await exportDocument(page);
            assert.equal(backup.settings.theme, "light");
            assert.equal(
              backup.categories[0].links.at(-1).title,
              "Session-only bookmark",
            );
            assert.equal(await savedRaw(page), null);
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "another tab synchronizes changes and cannot silently overwrite an open editor or confirmation",
        async () => {
          const fixture = await open(browser),
            { page, context } = fixture;
          try {
            await visit(page);
            const other = await context.newPage();
            other.setDefaultTimeout(5000);
            await visit(other);
            await page.locator("#edit-toggle").click();
            await page
              .getByRole("button", { name: "编辑链接 ChatGPT", exact: true })
              .click();
            await page
              .locator('#link-form [name="title"]')
              .fill("Unsaved draft");
            await other.locator("#theme-toggle").click();
            await waitToast(page, /另一标签页/);
            const externallySaved = await savedRaw(other);
            await page.locator('#link-form button[type="submit"]').click();
            await page
              .locator("#editor-error")
              .filter({ hasText: /另一标签页/ })
              .waitFor({ state: "visible" });
            assert.equal(
              await page.locator("#editor-dialog").isVisible(),
              true,
            );
            assert.equal(
              await page.locator('#link-form [name="title"]').inputValue(),
              "Unsaved draft",
              "Conflict preserves the unsaved form for review",
            );
            assert.equal(
              await savedRaw(page),
              externallySaved,
              "An outdated form cannot overwrite the other tab",
            );
            await page.keyboard.press("Escape");
            await page.waitForFunction(
              () => document.documentElement.dataset.theme === "light",
            );
            assert.equal((await titlesIn(page, "Daily"))[0], "ChatGPT");
            await other.locator("#search-engine").selectOption("bing");
            await page.waitForFunction(
              () => document.querySelector("#search-engine").value === "bing",
            );
            await page
              .getByRole("button", { name: "编辑分类 Daily", exact: true })
              .click();
            await page.locator("#delete-category").click();
            await other.locator("#theme-toggle").click();
            await waitToast(page, /另一标签页/);
            await page.locator("#confirm-accept").click();
            assert.equal(
              await page.locator("#confirm-dialog").isVisible(),
              true,
              "An outdated delete confirmation remains blocked",
            );
            assert.equal((await saved(page)).categories.length, 4);
            await page.keyboard.press("Escape");
            await page.keyboard.press("Escape");
            await page.waitForFunction(
              () => document.documentElement.dataset.theme === "dark",
            );
            assert.deepEqual(await categoryNames(page), [
              "Daily",
              "Development",
              "Reading",
              "Tools",
            ]);
            await other.evaluate(() => localStorage.clear());
            await page.waitForFunction(
              () => document.querySelector("#search-engine").value === "google",
            );
            assert.equal(
              await page.locator(".shortcut").count(),
              16,
              "Clearing storage in another tab restores the defaults safely",
            );
            await settings(page);
            const backup = await exportDocument(page);
            backup.categories[0].name = "Outdated import";
            await importDocument(page, backup);
            await page.locator("#confirm-dialog").waitFor({ state: "visible" });
            await other.reload();
            await other.locator("#search-engine").selectOption("duckduckgo");
            await waitToast(page, /另一标签页/);
            await page.locator("#confirm-accept").click();
            assert.equal(
              await page.locator("#confirm-dialog").isVisible(),
              true,
              "An outdated import confirmation remains blocked",
            );
            assert.equal((await saved(page)).categories[0].name, "Daily");
            assert.equal((await saved(page)).settings.engine, "duckduckgo");
            await page.keyboard.press("Escape");
            await closeSettings(page);
            await page.waitForFunction(
              () =>
                document.querySelector("#search-engine").value === "duckduckgo",
            );
          } finally {
            await fixture.close();
          }
        },
      );

      await t.test(
        "unreadable or damaged storage keeps the page usable and preserves damaged data",
        async () => {
          const unreadable = await open(browser);
          try {
            await unreadable.context.addInitScript(() => {
              Storage.prototype.getItem = function () {
                throw new DOMException("Blocked", "SecurityError");
              };
            });
            await visit(unreadable.page);
            await waitToast(unreadable.page, /配置读取异常/);
            assert.equal(
              await unreadable.page.locator(".shortcut").count(),
              16,
            );
            await settings(unreadable.page);
            assert.equal(
              (await exportDocument(unreadable.page)).categories.length,
              4,
            );
          } finally {
            await unreadable.close();
          }
          const damaged = await open(browser);
          try {
            await damaged.context.addInitScript(
              (key) => localStorage.setItem(key, "{ damaged original backup"),
              storageKey,
            );
            await visit(damaged.page);
            await waitToast(damaged.page, /配置读取异常/);
            assert.equal(
              await savedRaw(damaged.page),
              "{ damaged original backup",
            );
            assert.equal(await damaged.page.locator(".shortcut").count(), 16);
          } finally {
            await damaged.close();
          }
        },
      );

      await t.test(
        "320px and 390px layouts fit, remain touch-friendly and support settings and reduced motion",
        async () => {
          for (const width of [320, 390]) {
            const fixture = await open(browser, {
              viewport: { width, height: 844 },
              reducedMotion: "reduce",
              isMobile: browserName === "chromium",
              hasTouch: true,
            });
            const { page } = fixture;
            try {
              await visit(page);
              await assertNoOverflow(page);
              for (const [selector, label] of [
                ["#theme-toggle", "Theme"],
                ["#settings-open", "Settings"],
                ["#search-submit", "Search"],
                ["#edit-toggle", "Edit navigation"],
                [".category-add", "Add link"],
              ]) {
                await assertTarget(page.locator(selector).first(), label);
              }
              assert.equal(
                await page
                  .locator(".shortcut")
                  .first()
                  .evaluate(
                    (element) => getComputedStyle(element).transitionDuration,
                  ),
                "0s",
              );
              await page.locator("#theme-toggle").click();
              assert.equal(await theme(page), "light");
              await settings(page);
              await page
                .getByRole("button", { name: "夜间", exact: true })
                .click();
              assert.equal(await theme(page), "dark");
              await assertNoOverflow(page);
              await closeSettings(page);
              await page.locator("#edit-toggle").click();
              await assertNoOverflow(page);
              await assertTarget(
                page.getByRole("button", {
                  name: "编辑链接 ChatGPT",
                  exact: true,
                }),
                "Edit link",
              );
              await page
                .getByRole("button", { name: "添加链接到 Daily", exact: true })
                .click();
              await assertNoOverflow(page);
              await page
                .getByRole("button", { name: "关闭编辑", exact: true })
                .click();
              await page.locator("#edit-toggle").click();
              await page.screenshot({
                path: join(artifactDir, `${browserName}-mobile-${width}.png`),
                fullPage: true,
              });
            } finally {
              await fixture.close();
            }
          }
        },
      );
    } finally {
      await browser.close();
    }
  });
}
