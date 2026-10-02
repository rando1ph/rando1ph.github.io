"""Optional browser QA using an already-installed Python Playwright and Chrome.
Start the repository HTTP server on port 8000 first. No game dependencies.
Screenshots are written to qa/ for visual inspection.
"""
import argparse
import json
import math
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8000/games/signal-stack/'
OUT = Path(__file__).parent / 'qa'
OUT.mkdir(exist_ok=True)
CLOCK = """
window.__qaTime = 0;
window.__qaFrames = [];
window.__qaRenderFrame = true;
window.requestAnimationFrame = callback => { window.__qaFrames.push(callback); return 1; };
window.__advance = seconds => {
  const count = Math.max(1, Math.ceil(seconds * 60));
  for (let i = 0; i < count; i++) {
    window.__qaTime += seconds / count;
    window.__qaRenderFrame = i === count - 1;
    const frames = window.__qaFrames.splice(0);
    frames.forEach(callback => callback(window.__qaTime * 1000));
  }
  window.__qaRenderFrame = true;
};
"""

def prepare(page):
    page.wait_for_function('window.__qaFrames.length > 0')
    # Fast-forward checks still run EVERY engine frame and input handler, then
    # submit the final WebGL image. Real-time animation/performance is measured
    # separately by render-browser-checks.py with every draw and no fake clock.
    page.evaluate('''async () => {
      const {Renderer} = await import('./renderer.js');
      const draw = Renderer.prototype.draw;
      Renderer.prototype.draw = function(...args) {
        if(window.__qaRenderFrame) return draw.apply(this,args);
      };
    }''')

def advance(page, seconds):
    page.evaluate('(seconds) => window.__advance(seconds)', seconds)

def time(page):
    return page.evaluate('window.__qaTime')

def status(page):
    return page.locator('#status').inner_text()

def drop(page, touch=False):
    canvas = page.locator('#game')
    if touch:
        canvas.tap(position={'x': 170, 'y': 280})
    else:
        canvas.click(position={'x': 170, 'y': 280})

def at_phase(page, phase, frequency):
    now = time(page)
    target = phase / frequency
    period = 2 * math.pi / frequency
    while target < now + 0.02:
        target += period
    advance(page, target - now)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--viewport', type=int, help='Run just this width (useful for bounded QA sessions).')
parser.add_argument('--modes-only', action='store_true', help='Only reduced motion and storage checks.')
args = parser.parse_args()
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
                                args=['--no-sandbox'])
    for width, height in [(390, 844), (360, 800), (430, 932), (1280, 900)]:
        if args.modes_only or (args.viewport and args.viewport != width):
            continue
        mobile = width < 500
        context = browser.new_context(viewport={'width': width, 'height': height},
                                      device_scale_factor=3 if mobile else 1,
                                      is_mobile=mobile, has_touch=mobile)
        context.add_init_script(CLOCK)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL)
        prepare(page)
        advance(page, 0)
        assert 'Ready' in status(page)
        bounds = page.locator('#game').bounding_box()
        assert bounds['width'] <= width
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('#game').evaluate('(c) => c.width / c.getBoundingClientRect().width') <= 1.51
        assert not page.locator('#render-fallback').is_visible()
        page.screenshot(path=str(OUT / f'{width}-ready.png'))
        # Actual Pointer Event input, including duplicate taps during a drop.
        # Telemetry is a DOM overlay; tapping through it must still release.
        if mobile:
            page.locator('#game').tap(position={'x': 35, 'y': 25})
        else:
            page.locator('#game').click(position={'x': 35, 'y': 25})
        drop(page, mobile)
        advance(page, 0.6)
        assert 'Perfect. Combo 1. Height 1. Score 50.' == status(page), status(page)
        for floor in range(1, 10):
            advance(page, 0.6)
            frequency = 1.7 if floor < 5 else 1.9
            at_phase(page, math.pi, frequency)
            if mobile:
                drop(page, True)
            else:
                page.locator('#game').press('Space' if floor % 2 else 'Enter')
            advance(page, 0.6)
            assert f'Height {floor + 1}.' in status(page), status(page)
            assert f'Combo {floor + 1}.' in status(page), status(page)
        page.screenshot(path=str(OUT / f'{width}-tower.png'))
        assert 'Score 1625.' in status(page), status(page)
        # Resizing a falling block preserves the run and landing.
        advance(page, 0.6)
        at_phase(page, math.pi, 2.15)
        drop(page, mobile)
        advance(page, 0.15)
        page.set_viewport_size({'width': 430 if width == 390 else width, 'height': height - 90})
        advance(page, 0.5)
        assert 'Height 11.' in status(page)
        page.set_viewport_size({'width': width, 'height': height})
        # Pause/focus must discard background time.
        before = status(page)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        advance(page, 10)
        assert status(page) == before
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        advance(page, 0)
        # Persisted records visible after a full document reload.
        page.reload()
        prepare(page)
        advance(page, 0)
        stored = page.evaluate("JSON.parse(localStorage.getItem('randolf:signal-stack:v1'))")
        assert stored == {'bestHeight': 11, 'bestScore': 1925, 'bestCombo': 11, 'gamesPlayed': 1}, stored
        # Right pivot, left pivot, complete miss: three failed modules end run.
        for index, phase in enumerate([
            math.asin(math.asin(75 / 180) / 0.64),
            math.pi + math.asin(math.asin(75 / 180) / 0.64),
            math.pi / 2,
        ]):
            at_phase(page, phase, 1.7)
            drop(page, mobile)
            advance(page, 0.6)
            if width == 390:
                page.screenshot(path=str(OUT / f'failure-{index + 1}.png'))
            advance(page, 2.5)
            if index < 2:
                assert f'{2 - index} integrity remaining.' in status(page), status(page)
            else:
                assert 'Signal lost.' in status(page), status(page)
        page.screenshot(path=str(OUT / f'{width}-gameover.png'))
        if width == 390:
            page.locator('#restart').click()
        else:
            drop(page, mobile)
        assert 'Reconnected.' in status(page)
        advance(page, 0)
        page.locator('#game').press('Enter')
        advance(page, 0.6)
        assert 'Height 1.' in status(page)
        assert not errors, errors
        results.append({'viewport': f'{width}x{height}', 'passed': True, 'errors': errors})
        context.close()
    # Reduced motion and hostile storage use real browser environments.
    for mode in ([] if args.viewport else ['reduced-motion', 'blocked-storage', 'corrupt-storage']):
        context = browser.new_context(viewport={'width': 390, 'height': 844},
                                      reduced_motion='reduce' if mode == 'reduced-motion' else 'no-preference')
        context.add_init_script(CLOCK)
        if mode == 'blocked-storage':
            context.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } });")
        if mode == 'corrupt-storage':
            context.add_init_script("localStorage.setItem('randolf:signal-stack:v1', '{broken');")
        page = context.new_page()
        page.goto(URL)
        prepare(page)
        advance(page, 0)
        drop(page)
        advance(page, 0.6)
        assert 'Height 1.' in status(page), status(page)
        results.append({'mode': mode, 'passed': True})
        context.close()
    browser.close()
print(json.dumps(results, indent=2))
