"""Phase 3: actual WebGL compositor, altitude, event, viewport and 120-floor QA.
Development harness only; uses the production engine/renderer unchanged.
Run with a local repository server on port 8000. Chrome here may be software GPU.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).parent
OUT = ROOT / 'qa'
OUT.mkdir(exist_ok=True)
URL = 'http://127.0.0.1:8000/games/signal-stack/'
results = {}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=1.5)
    page = context.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    html = (ROOT/'index.html').read_text().replace('<script type="module" src="./main.js"></script>', '')
    page.route('**/visual-harness', lambda route: route.fulfill(body=html, content_type='text/html'))
    page.goto(URL+'visual-harness')
    page.evaluate('''async () => {
      const [{Engine, CONFIG}, {Renderer}] = await Promise.all([import('./engine.js'), import('./renderer.js')]);
      window.qa = {e: new Engine(), r: new Renderer(document.querySelector('#game'),390,undefined,{autoFallback:false}),CONFIG};
      qa.e.setViewport(qa.r.resize());
      qa.settle = seconds => {
        for(let t=0;t<seconds;t+=.05) {qa.e.update(.05);qa.r.environment.sync(qa.e);}
        qa.r.draw(qa.e);
      };
      qa.contact = (offset=0) => {
        qa.e.spawn();qa.r.draw(qa.e);
        const entry=qa.r.registry.select(qa.e,qa.e.viewHeight).find(e=>e.active);
        const before=qa.r.pool.live.get(entry.id).userData.variant;
        qa.e.release();qa.e.active.x=qa.e.top.x+offset;
        qa.e.active.y=qa.e.top.y-qa.e.active.height-.01;qa.e.update(CONFIG.STEP);qa.r.draw(qa.e);
        const landed=qa.r.pool.live.get(qa.r.registry.idFor(qa.e.top));
        if(Math.abs(offset)<=50 && landed.userData.variant!==before)throw Error('Variant changed on landing');
      };
      qa.r.draw(qa.e);
    }''')
    results['gpu'] = page.evaluate('''() => {const gl=qa.r.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown', revision:qa.r.diagnostics().revision};}''')
    results['altitudes'] = []
    for target in [0,6,12,20,32,50]:
        page.evaluate('''target=>{while(qa.e.height<target){qa.contact();qa.settle(.75);}qa.settle(1.5);}''',target)
        page.screenshot(path=str(OUT/f'phase3-390-altitude-{target}.png'))
        results['altitudes'].append(page.evaluate('({height:qa.e.height,...qa.r.diagnostics()})'))
    assert len({s['environment']['band'] for s in results['altitudes']}) == 5
    # Keep the actual targets alive across resize/restart (never composer.reset).
    page.evaluate('''() => {qa.targetIDs=[qa.r.post.composer.renderTarget1.texture.uuid,qa.r.post.composer.renderTarget2.texture.uuid];}''')
    page.evaluate('qa.e.reset();for(let i=0;i<12;i++){qa.contact();qa.settle(.75);}qa.settle(1.2);')
    results['viewports'] = []
    for width,height in [(360,800),(390,844),(430,932),(1280,900)]:
        page.set_viewport_size({'width':width,'height':height})
        page.evaluate('qa.e.setViewport(qa.r.resize());qa.r.draw(qa.e);')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.evaluate('''() => {const b=document.querySelector('canvas').getBoundingClientRect(),d=qa.r.diagnostics();
          return d.compositor.width===Math.floor(b.width*d.pixelRatio)&&d.compositor.height===Math.floor(b.height*d.pixelRatio);}''')
        page.screenshot(path=str(OUT/f'phase3-{width}-normal.png'))
        results['viewports'].append({'width':width,'height':height,'canvas':page.locator('canvas').bounding_box()})
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('qa.e.setViewport(qa.r.resize());qa.contact();')
    results['perfect'] = []
    previous = 0
    for age in [.04,.12,.22,.32,.45]:
        page.evaluate('dt=>{qa.e.update(dt);qa.r.draw(qa.e);}',age-previous)
        previous = age
        results['perfect'].append(page.evaluate('''({time:qa.e.time, effects:qa.r.effects.diagnostics(),
          energy:[...qa.r.pool.live.values()].map(g=>({y:g.position.y,energy:g.userData.signal.material.emissiveIntensity}))})'''))
        page.screenshot(path=str(OUT/f'phase3-perfect-{int(age*1000)}ms.png'))
    assert results['perfect'][-1]['effects']['perfectTimelines'] == 0
    # Normal landing cannot start a Perfect event.
    page.evaluate('qa.settle(.8);qa.contact(25);qa.e.update(.07);qa.r.draw(qa.e);')
    assert page.evaluate('qa.r.effects.diagnostics().perfectTimelines') == 0
    page.screenshot(path=str(OUT/'phase3-normal-landing.png'))
    # Reduced motion preserves atmosphere and pulse, removes particles/scaling.
    page.emulate_media(reduced_motion='reduce')
    page.evaluate('qa.e.reducedMotion=true;qa.settle(.8);qa.contact();qa.e.update(.07);qa.r.draw(qa.e);')
    assert page.evaluate('qa.r.effects.diagnostics().particles') == 0
    assert page.evaluate('qa.r.environment.diagnostics().cloudCards') == 12
    assert page.locator('[data-hud="combo"]').evaluate('e=>getComputedStyle(e).transform') == 'none'
    page.screenshot(path=str(OUT/'phase3-reduced-motion.png'))
    page.emulate_media(reduced_motion='no-preference')
    page.evaluate('qa.e.reducedMotion=false;qa.settle(1);')
    # Left/right edge failures retain engine rotation, bounded sparks, fading signal.
    for side in [-75,75]:
        page.evaluate('side=>{qa.e.spawn();qa.e.release();qa.e.active.x=qa.e.top.x+side;qa.e.active.y=qa.e.top.y-qa.e.active.height-.01;qa.e.update(qa.CONFIG.STEP);qa.e.update(.18);qa.r.draw(qa.e);}', side)
        page.screenshot(path=str(OUT/f'phase3-failure-{side}.png'))
        assert page.evaluate('qa.r.effects.diagnostics().particles<=6')
    # 120 real engine successes; drawing every active/landing/settled state.
    page.evaluate('qa.e.reset();qa.r.draw(qa.e);')
    results['longRun'] = []
    for target in [30,60,90,120]:
        page.evaluate('target=>{while(qa.e.height<target){qa.contact();qa.settle(.75);}qa.settle(1);}',target)
        results['longRun'].append(page.evaluate('({height:qa.e.height,...qa.r.diagnostics()})'))
    samples=results['longRun']
    assert all(s['allocatedModules']<=32 and s['effects']['particles']==0 and s['effects']['perfectTimelines']==0 for s in samples)
    for key in ['geometries','textures','sceneObjects','allocatedModules']:
        assert len({s[key] for s in samples}) == 1, (key,[s[key] for s in samples])
    assert all(s['compositor']['targets']==13 for s in samples)
    page.evaluate('qa.e.reset();qa.r.draw(qa.e);')
    assert page.evaluate('qa.targetIDs[0]===qa.r.post.composer.renderTarget1.texture.uuid&&qa.targetIDs[1]===qa.r.post.composer.renderTarget2.texture.uuid')
    assert page.evaluate('qa.r.environment.diagnostics().altitude') == 0
    assert page.evaluate('qa.r.effects.diagnostics().perfectTimelines') == 0
    results['restart'] = page.evaluate('qa.r.diagnostics()')
    # Bloom ON/OFF comparison with identical scene/timestamp.
    page.evaluate('for(let i=0;i<13;i++){qa.contact();qa.settle(.75);}qa.settle(1);')
    page.screenshot(path=str(OUT/'phase3-bloom-on.png'))
    results['bloomOn'] = page.evaluate('qa.r.diagnostics()')
    page.evaluate('qa.r.disableBloom();qa.r.draw(qa.e);')
    page.screenshot(path=str(OUT/'phase3-bloom-off.png'))
    results['bloomOff'] = page.evaluate('qa.r.diagnostics()')
    assert results['bloomOff']['compositor'] is None
    assert results['bloomOn']['textures'] - results['bloomOff']['textures'] == 13
    # r186 core owns a module-global DFG LUT, outside application resources.
    results['threeInternalTexture'] = page.evaluate('qa.r.renderer.properties.get(qa.r.modules.materials.body).uniforms.dfgLUT.value.name')
    assert results['threeInternalTexture'] == 'DFG_LUT'
    page.evaluate('qa.r.dispose();qa.r.dispose();')
    results['disposed'] = page.evaluate('({geometries:qa.r.renderer.info.memory.geometries,textures:qa.r.renderer.info.memory.textures,objects:qa.r.scene.children.length})')
    assert results['disposed'] == {'geometries':0,'textures':1,'objects':0}
    # Fresh renderer tests genuine automatic fallback in the same single RAF.
    page.evaluate('''async()=>{const {Renderer}=await import('./renderer.js');qa.r=new Renderer(document.querySelector('#game'),390);
      qa.e.reset();qa.e.setViewport(qa.r.resize());}''')
    results['realFrames'] = page.evaluate('''()=>new Promise(resolve=>{
      let previous=null,start=null;const intervals=[];const quality=[];
      function frame(now){if(start===null)start=now;
        if(previous!==null){intervals.push(now-previous);qa.e.update(Math.min((now-previous)/1000,.1));}
        qa.r.observeFrame(now);qa.r.draw(qa.e);previous=now;
        if(!quality.length||quality.at(-1).bloom!==qa.r.quality.config.bloom)quality.push({at:now-start,bloom:qa.r.quality.config.bloom});
        if(now-start<6500)requestAnimationFrame(frame);else{
          const sorted=[...intervals].sort((a,b)=>a-b);
          resolve({fps:intervals.length*1000/(now-start),median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],quality,...qa.r.diagnostics()});}}
      requestAnimationFrame(frame);
    })''')
    page.evaluate('qa.r.dispose();')
    assert all(r.startswith('http://127.0.0.1:8000/') or r.startswith('data:') for r in requests)
    results['pageErrors']=errors
    assert not errors,errors
    context.close();browser.close()
(OUT/'phase3-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
