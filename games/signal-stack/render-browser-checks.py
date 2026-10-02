"""Phase 2 WebGL lifecycle / memory / real-frame QA. Development only.
Uses installed desktop Chrome, not physical mobile hardware.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
URL = 'http://127.0.0.1:8000/games/signal-stack/'
OUT = ROOT / 'qa'
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--lifecycle-only', action='store_true')
parser.add_argument('--no-bloom', action='store_true', help='Run the original 1,000-floor baseline without postprocessing; Phase 3 QA separately forces Bloom ON.')
args = parser.parse_args()
results = {}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3,
                                  is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    if not args.lifecycle_only:
        # Isolated renderer harness: same DOM, CSS and public classes as the game.
        # No main.js means the measured RAF below is the ONLY animation loop.
        html = (ROOT / 'index.html').read_text().replace('<script type="module" src="./main.js"></script>', '')
        page.route('**/qa-harness', lambda route: route.fulfill(body=html, content_type='text/html'))
        page.goto(URL + 'qa-harness')
        page.evaluate('''async quality => {
          const [{Engine, CONFIG}, {Renderer}] = await Promise.all([import('./engine.js'), import('./renderer.js')]);
          window.qa = { e: new Engine(), r: new Renderer(document.querySelector('#game'), 390, undefined, quality), CONFIG };
          qa.e.setViewport(qa.r.resize());
          qa.contact = offset => {
            qa.e.spawn(); qa.e.release(); qa.e.active.x = qa.e.top.x + offset;
            qa.e.active.y = qa.e.top.y - qa.e.active.height - 0.01; qa.e.update(CONFIG.STEP);
          };
          qa.r.draw(qa.e);
        }''', {'bloom': not args.no_bloom, 'autoFallback': False})
        results['initial'] = page.evaluate('qa.r.diagnostics()')
        results['gpu'] = page.evaluate('''() => {
          const gl=qa.r.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
          return {renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable',
            userAgent: navigator.userAgent};
        }''')
        results['growth'] = page.evaluate('''() => {
          const samples=[];
          for (let i=1; i<=1000; i++) {
            qa.contact(0); qa.e.update(0.7);
            qa.r.draw(qa.e);
            if ([20,100,500,1000].includes(i)) samples.push({height:qa.e.height,...qa.r.diagnostics()});
          }
          return samples;
        }''')
        assert all(s['allocatedModules'] <= 32 for s in results['growth'])
        assert len({s['geometries'] for s in results['growth']}) == 1
        assert len({s['sceneObjects'] for s in results['growth']}) == 1
        # Return to a modest tower for an acceptance screenshot and real-time run.
        page.evaluate('''() => {
          qa.e.reset();
          for (let i=0;i<9;i++) {qa.contact(0);qa.e.update(0.8);}
          qa.e.update(0.2); qa.r.draw(qa.e);
        }''')
        page.screenshot(path=str(OUT / 'phase2-390-active-tower.png'))
        page.evaluate('qa.contact(0); qa.e.update(0.075); qa.r.draw(qa.e);')
        page.screenshot(path=str(OUT / 'phase2-390-perfect.png'))
        # Real wall-clock rendering including swing, a drop, Perfect and camera motion.
        results['frames'] = page.evaluate('''() => new Promise(resolve => {
          const intervals=[], work=[]; let previous=null, start=null, tapped=false;
          function frame(now) {
            if(start===null)start=now;
            if(previous!==null) intervals.push(now-previous);
            const t0=performance.now();
            if(previous!==null)qa.e.update(Math.min((now-previous)/1000,0.1));
            if (!tapped && now-start>1800 && Math.abs(qa.e.active.x-qa.e.top.x)<4) {
              qa.e.release();tapped=true;
            }
            qa.r.draw(qa.e); work.push(performance.now()-t0); previous=now;
            if(now-start<7000)requestAnimationFrame(frame);
            else {
              const stats=a=>{const b=[...a].sort((x,y)=>x-y);return {median:b[Math.floor(b.length*.5)],p95:b[Math.floor(b.length*.95)],max:b.at(-1)}};
              resolve({durationMs:now-start, frames:intervals.length, fps:intervals.length*1000/(now-start),
                intervalMs:stats(intervals),cpuSubmitMs:stats(work),tapped,...qa.r.diagnostics()});
            }
          }
          requestAnimationFrame(frame);
        })''')
        # Address bar-sized changes and portrait/landscape do not reset the run.
        old_height = page.evaluate('qa.e.height')
        for width, height in [(430, 780), (844, 390), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.evaluate('qa.e.setViewport(qa.r.resize());qa.r.draw(qa.e);')
            assert page.evaluate('qa.e.height') == old_height
        results['resize'] = 'portrait / landscape / viewport-height changes preserved run'
        page.evaluate('qa.e.reset();qa.r.draw(qa.e);')
        results['restart'] = page.evaluate('qa.r.diagnostics()')
        page.evaluate('qa.r.dispose();qa.r.dispose();')
        results['disposed'] = page.evaluate('({geometries:qa.r.renderer.info.memory.geometries,objects:qa.r.scene.children.length})')
        assert results['disposed'] == {'geometries': 0, 'objects': 0}
    else:
        requests = []
        page.on('request', lambda r: requests.append(r.url))
        page.goto(URL)
        page.wait_for_function('!!document.querySelector("canvas").getContext("webgl2")')
        page.evaluate('''() => {
          window.qaLost = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
          qaLost.loseContext();
        }''')
        page.wait_for_function('!document.querySelector("#render-fallback").hidden')
        page.evaluate('qaLost.restoreContext()')
        page.wait_for_function('document.querySelector("#render-fallback").hidden')
        page.locator('#game').tap(position={'x':170,'y':280})
        results['contextRecovery'] = 'loss fallback + restore + input passed'
        assert all(url.startswith('http://127.0.0.1:8000/') or url.startswith('data:') for url in requests)
        results['network'] = 'all runtime requests local'
        fallback_context = browser.new_context(viewport={'width':360,'height':800})
        fallback_context.add_init_script('''const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            return kind === 'webgl2' ? null : original.call(this, kind, ...args);
          };''')
        fallback_page = fallback_context.new_page()
        fallback_page.goto(URL)
        fallback_page.wait_for_selector('#render-fallback', state='visible')
        assert '3D rendering is unavailable' in fallback_page.locator('#render-fallback').inner_text()
        fallback_page.screenshot(path=str(OUT / 'phase2-webgl-fallback.png'))
        results['webgl2Unavailable'] = 'readable fallback, no blank screen'
        fallback_context.close()
    results['pageErrors'] = errors
    assert not errors, errors
    context.close()
    browser.close()
print(json.dumps(results, indent=2))
