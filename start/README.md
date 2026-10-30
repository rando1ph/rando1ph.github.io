# START

An independent, local-first browser start page at **https://randolf.dev/start/**. Plain HTML, CSS and ES modules; no build, backend, account, analytics, external fonts or favicon services. GitHub Pages serves this directory directly.

## Use

- Search with Google, Bing, DuckDuckGo or Baidu. Domains and HTTP(S) URLs open directly. Search and shortcuts open in a new tab by default; change this in Settings.
- Use **整理** to rename, reorder or remove categories and reorder shortcuts. Each category's **+** adds a shortcut. Editing a shortcut can also move it to another category.
- Settings offer day, night and system themes, 12/24-hour time, seconds and JSON import/export. The header theme button switches manually; choose **跟随系统** in Settings to restore automatic switching.
- `/` or `Ctrl/⌘ K` focuses search, `Alt E` toggles editing, `?` opens help, and `Esc` closes a dialog or exits editing. All navigation editing is keyboard accessible.

Preferences and navigation are saved under `randolf-start-v1` in this browser's local storage. Export a backup to transfer or preserve them. Imports are validated fully before a separate replacement confirmation. Version 1 supports up to 50 categories and 100 links per category, with a consistent 16 MiB UTF-8 JSON limit; the browser's actual storage quota may be smaller. If storage is unavailable/full, the page keeps working in memory and prompts for an export. When another tab changes the configuration, an open editor retains its draft and blocks stale writes until the dialogs are closed and the newer configuration is loaded.

## Local development and verification

Serve the repository root, then visit `http://127.0.0.1:4173/start/`:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Pure data, routing, unsafe-URL, persistence and import boundary tests use Node's built-in runner:

```sh
node --test start/model.test.mjs
```

Browser acceptance tests require Playwright only during development. To keep dependencies outside the deployed repository:

```sh
npm install --prefix /tmp/start-test-deps playwright
/tmp/start-test-deps/node_modules/.bin/playwright install firefox chromium
PLAYWRIGHT_MODULE=/tmp/start-test-deps/node_modules/playwright/index.mjs node start/browser.test.mjs
```

The browser suite runs Firefox and Chromium, intercepts external destinations locally, and checks navigation CRUD/reordering, search, theme persistence, imports/exports, corrupt/unavailable storage, cross-tab conflicts, keyboard access, modal focus, reduced motion and narrow mobile layouts. Optional environment variables: `START_BASE_URL`, `START_BROWSERS`, `START_TEST_ARTIFACTS`, `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH`. Screenshots default to a temporary directory, outside the repository.

## Files

- `index.html`, `style.css`, `app.mjs`: interface and interactions.
- `model.mjs`: defaults, validated configuration and safe navigation rules.
- `model.test.mjs`, `browser.test.mjs`: repeatable regression and acceptance tests.
- [`assets/README.md`](assets/README.md): original background asset provenance and generation prompt. The optimized local WebP is about 207 KiB. The day theme uses the same landscape through a soft mist treatment.

The page follows reduced-motion preferences, pauses clock scheduling while hidden, and makes no external requests until the user opens a destination. No service worker is installed, so deployment updates follow normal browser caching behavior.
