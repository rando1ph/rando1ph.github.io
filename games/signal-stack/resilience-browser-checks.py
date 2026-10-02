"""Targeted Phase 4 recovery, first-gesture audio and cross-tab preference QA."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).parent
URL='http://127.0.0.1:8000/games/signal-stack/'
results={}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1.5,is_mobile=True,has_touch=True)
    context.add_init_script('''window.framesQA=[];window.requestAnimationFrame=cb=>{framesQA.push(cb);return 1;};''')
    page=context.new_page();errors=[];console=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:console.append(m.text) if m.type in ['error','warning'] else None)
    page.goto(URL);page.wait_for_function('framesQA.length>0',polling=50)
    assert page.evaluate('GameAudio.ss.diagnostics().contextState')=='uncreated'
    page.locator('#game').tap(position={'x':170,'y':280})
    page.wait_for_function('GameAudio.ss.diagnostics().contextState==="running"',polling=50)
    assert page.evaluate('JSON.parse(localStorage.getItem("randolf:signal-stack:v1")).gamesPlayed')==1
    results['firstTap']='Fresh enabled page: no context before gesture; first tap releases and unlocks real AudioContext.'
    page.evaluate('''async()=>{
      const {Renderer}=await import('./renderer.js'),draw=Renderer.prototype.draw;
      Renderer.prototype.draw=function(e,...args){window.qa={e,r:this};return draw.call(this,e,...args);};
      framesQA.splice(0).forEach(cb=>cb(0));
    }''')
    assert page.evaluate('qa.r.diagnostics().bloom')
    page.evaluate('''()=>{
      for(let i=0;i<9;i++){
        qa.e.spawn();qa.e.release();qa.e.active.x=qa.e.top.x;
        qa.e.active.y=qa.e.top.y-qa.e.active.height-.01;qa.e.update(qa.e.config.STEP);
        if(i<8)qa.e.update(.7);
      }
      qa.r.draw(qa.e);
      if(qa.e.camera.y===qa.e.cameraTarget.y)throw Error('QA needs a moving camera');
    }''')
    before=page.evaluate('JSON.stringify(qa.e)')
    targets=page.evaluate('[qa.r.post.composer.renderTarget1.texture.uuid,qa.r.post.composer.renderTarget2.texture.uuid]')
    for cycle in range(3):
        page.evaluate('window.extQA=qa.r.renderer.getContext().getExtension("WEBGL_lose_context");extQA.loseContext()')
        page.wait_for_function('!document.querySelector("#render-fallback").hidden',polling=50)
        assert page.locator('.reload').is_visible()
        page.evaluate('framesQA.splice(0).forEach(cb=>cb(900000))')
        assert page.evaluate('JSON.stringify(qa.e)')==before
        page.evaluate('extQA.restoreContext()')
        page.wait_for_function('document.querySelector("#render-fallback").hidden',polling=50)
        # Retained engine is unchanged; reallocated GPU resources produce a real frame.
        assert page.evaluate('JSON.stringify(qa.e)')==before
        d=page.evaluate('qa.r.diagnostics()')
        assert d['bloom'] and d['compositor']['targets']==13
        gl_error=page.evaluate('qa.r.renderer.getContext().getError()')
        assert gl_error==0,{'cycle':cycle,'glError':gl_error,'console':console}
    restored=page.evaluate('[qa.r.post.composer.renderTarget1.texture.uuid,qa.r.post.composer.renderTarget2.texture.uuid]')
    assert restored!=targets
    page.screenshot(path=str(ROOT/'qa'/'phase4-context-restored.png'))
    results['context']={'cycles':3,'runPreserved':True,'resources':d,'pageErrors':errors}
    # A small smoke regression for shared tone/noise cleanup used by other games.
    page.locator('#sound').click();page.locator('#sound').click()
    page.wait_for_function('GameAudio.ss.diagnostics().contextState==="running"',polling=50)
    page.evaluate('GameAudio.ms.reveal();GameAudio.cs.ui();GameAudio.rv.flips(3,30)')
    page.wait_for_function('GameAudio._voices()===0',polling=50)
    results['sharedCleanup']=page.evaluate('''async()=>{
      const cues=['ms.reveal','cs.ui','rv.flips'];
      for(const cue of cues){const c=new OfflineAudioContext(1,24000,48000);GameAudio._render(cue,c,c.destination,.01);await c.startRendering();}
      return {cues,voices:GameAudio._voices()};
    }''')
    assert results['sharedCleanup']['voices']==0
    second=context.new_page();second.goto(URL)
    second.evaluate('localStorage.setItem("randolf:games:sound","off")')
    page.wait_for_function('document.querySelector("#sound").getAttribute("aria-pressed")==="false"',polling=50)
    second.evaluate('localStorage.setItem("randolf:games:sound","on")')
    page.wait_for_function('document.querySelector("#sound").getAttribute("aria-pressed")==="true"',polling=50)
    results['sharedPreference']='on/off storage events synchronize the existing shared preference across tabs.'
    second.close()
    results['context']['disposed']=page.evaluate('''()=>{qa.r.dispose();return {geometries:qa.r.renderer.info.memory.geometries,glError:qa.r.renderer.getContext().getError()};}''')
    assert results['context']['disposed']=={'geometries':0,'glError':0},console
    assert not errors,errors
    context.close();browser.close()
(ROOT/'qa'/'phase4-resilience-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
