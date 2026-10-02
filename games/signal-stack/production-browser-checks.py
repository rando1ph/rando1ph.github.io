"""Phase 4 real browser/audio/GL checks. Requires local :8000 server.
Harness-only instrumentation; no production test hooks or synthetic audio stack.
Subjective listening and physical phone GPU checks remain manual.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
OUT = ROOT / 'qa'
OUT.mkdir(exist_ok=True)
URL = 'http://127.0.0.1:8000/games/signal-stack/'
CLOCK = """
window.__time=0; window.__frames=[]; window.__draw=true;
window.requestAnimationFrame=cb=>{__frames.push(cb);return 1;};
window.advance=seconds=>{
  const n=Math.max(1,Math.ceil(seconds*60));
  for(let i=0;i<n;i++){
    __time+=seconds/n;__draw=i===n-1;
    __frames.splice(0).forEach(cb=>cb(__time*1000));
  }
  __draw=true;
};
window.__audioContexts=[];
const NativeAC=window.AudioContext;
window.AudioContext=new Proxy(NativeAC,{construct(C,args){const c=new C(...args);__audioContexts.push(c);return c;}});
"""
results = {}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1.5,is_mobile=True,has_touch=True)
    context.add_init_script(CLOCK)
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('__frames.length>0')
    page.evaluate('''async()=>{
      const {Renderer}=await import('./renderer.js');const draw=Renderer.prototype.draw;
      Renderer.prototype.draw=function(e,paused,presentation){
        window.qa={e,r:this,p:presentation};
        // The result must be rendered on its first visible frame so native
        // focus can move to the now-visible reconnect button.
        if(__draw || presentation?.ready && document.querySelector('[data-hud="gameover"]').hidden)
          draw.call(this,e,paused,presentation);
      };advance(0);
    }''')
    assert page.evaluate('__audioContexts.length')==0
    page.locator('#sound').click()
    assert page.locator('#sound').get_attribute('aria-pressed')=='false'
    assert page.evaluate('__audioContexts.length')==0
    page.locator('#sound').click()
    page.wait_for_function('__audioContexts.length===1 && __audioContexts[0].state==="running"')
    assert page.evaluate('qa.e.started') is False
    page.locator('#game').tap(position={'x':160,'y':280})
    assert page.evaluate('qa.e.state')=='RELEASING'
    page.locator('#game').dispatch_event('click')
    page.locator('#game').tap(position={'x':160,'y':280})
    page.evaluate('advance(.6)')
    assert page.evaluate('qa.e.height')==1
    assert page.evaluate('qa.e.records.gamesPlayed')==1
    results['firstGesture']='One tap unlocks/starts/releases; Sound and synthetic click do not drop.'

    # Actual Web Audio: every recipe, finite output, short envelopes and clamped pitch.
    results['audio']=page.evaluate('''async()=>{
      const a=GameAudio,ss=a.ss;
      for(const key of ['connect','land','slip','miss','integrity','lost'])ss[key]();ss.perfect(1);
      ss.stop();
      const names=a._recipeNames().filter(k=>k.startsWith('ss.')),rendered=[];
      for(const name of names){
        const c=new OfflineAudioContext(1,24000,48000);
        a._render(name,c,c.destination,.01);
        const buffer=await c.startRendering(),v=buffer.getChannelData(0);
        let peak=0,energy=0,tail=0;
        for(let i=0;i<v.length;i++){if(!Number.isFinite(v[i]))throw Error('Nonfinite audio');peak=Math.max(peak,Math.abs(v[i]));energy+=v[i]*v[i];if(i>22000)tail=Math.max(tail,Math.abs(v[i]));}
        if(peak<=0||peak>=1||tail>.0001)throw Error('Invalid envelope '+name);
        rendered.push({name,peak,rms:Math.sqrt(energy/v.length),tail});
      }
      function frequencies(combo){
        ss.perfect(combo);ss.stop();
        const c=new OfflineAudioContext(1,24000,48000),freq=[],create=c.createOscillator.bind(c);
        c.createOscillator=()=>{const o=create(),set=o.frequency.setValueAtTime.bind(o.frequency);
          o.frequency.setValueAtTime=(value,time)=>{freq.push(value);return set(value,time);};return o;};
        a._render('ss.perfect',c,c.destination,.01);
        return c.startRendering().then(()=>freq);
      }
      const cap=await frequencies(8),high=await frequencies(10000);
      if(JSON.stringify(cap)!==JSON.stringify(high))throw Error('Pitch not clamped');
      let maxVoices=0;
      for(let i=0;i<50;i++){ss.stop();ss.connect();ss.perfect(i+1);ss.miss();ss.integrity();ss.lost();maxVoices=Math.max(maxVoices,ss.diagnostics().voices);ss.stop();}
      await new Promise(resolve=>setTimeout(resolve,400));
      return {rendered,clampedFrequencies:high,maxVoices,after:ss.diagnostics(),sharedVoices:a._voices(),contexts:__audioContexts.length};
    }''')
    assert len(results['audio']['rendered'])==7
    assert results['audio']['after']['voices']==0 and results['audio']['sharedVoices']==0
    assert results['audio']['contexts']==1
    assert results['audio']['after']['cueKeys']==7

    # Production visibility handling: falling state is byte-for-byte stable while hidden.
    page.evaluate('advance(.6);qa.e.release();advance(.12)')
    before=page.evaluate('JSON.stringify(qa.e)')
    page.evaluate('''Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));advance(120);''')
    assert page.evaluate('JSON.stringify(qa.e)')==before
    assert page.evaluate('GameAudio.ss.diagnostics().voices')==0
    page.evaluate('''Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));advance(0);''')
    assert page.evaluate('JSON.stringify(qa.e)')==before
    page.evaluate('advance(.2)')
    results['visibility']='Hidden/resume preserve falling position, camera, integrity; no queued voices.'

    # 50 full renderer restart cycles, repeated Perfect effects and edge/miss/gameover.
    # Sample actual production resources with full Bloom retained for stress.
    results['restarts']=page.evaluate('''async()=>{
      const {Engine}=await import('./engine.js');
      qa.e.reset();advance(0);const targets=qa.r.post? [qa.r.post.composer.renderTarget1.texture.uuid,qa.r.post.composer.renderTarget2.texture.uuid]:null;
      const samples=[];
      for(let run=1;run<=50;run++){
        qa.e.spawn();qa.e.release();qa.e.active.x=qa.e.top.x;qa.e.active.y=qa.e.top.y-qa.e.active.height-.01;
        qa.e.update(qa.e.config.STEP);advance(.08);
        if(qa.r.effects.diagnostics().perfectTimelines!==1)throw Error('Perfect missing');
        for(const offset of [-75,75,500]){
          qa.e.spawn();qa.e.release();qa.e.active.x=qa.e.top.x+offset;
          // Keep every engine tick, submit contact / rotation / exit checkpoints.
          for(const dt of [.5,.15,3.5]){qa.e.update(dt);qa.r.draw(qa.e,false,qa.p);}
          advance(0);
        }
        if(qa.e.state!=='GAME_OVER')throw Error('No gameover');
        advance(.35);
        if(!qa.p.ready)throw Error('No resolution');
        document.querySelector('#restart').click();
        if(qa.e.state!=='READY'||qa.e.height!==0||qa.e.integrity!==3)throw Error('Bad reset');
        const d=qa.r.diagnostics();
        if(d.effects.perfectTimelines||d.effects.particles||d.effects.ring||d.environment.altitude!==0)throw Error('Stale effect');
        if(run%10===0)samples.push({run,...d});
      }
      return {samples,targetsStable:!targets||targets[0]===qa.r.post.composer.renderTarget1.texture.uuid&&targets[1]===qa.r.post.composer.renderTarget2.texture.uuid,records:qa.e.records};
    }''')
    samples=results['restarts']['samples']
    for key in ['allocatedModules','sceneObjects','geometries','textures']:
        assert len({s[key] for s in samples})==1,(key,[s[key] for s in samples])
    assert results['restarts']['targetsStable']
    assert all(s['compositor']['targets']==13 for s in samples)

    # Pause resolution, input lock, result accessibility, preference surviving reconnect.
    page.evaluate('''qa.e.release();for(let i=0;i<3;i++){qa.e.spawn();qa.e.release();qa.e.active.x=qa.e.top.x+500;qa.e.update(5);}advance(0);''')
    assert page.locator('[data-hud="gameover"]').is_hidden()
    page.locator('#game').press('Enter')
    assert page.evaluate('qa.e.state')=='GAME_OVER'
    page.evaluate('advance(.35)')
    assert page.locator('[data-hud="gameover"]').is_visible()
    assert page.locator('#restart').evaluate('e=>e===document.activeElement')
    page.locator('#sound').click()
    saved=page.evaluate('JSON.stringify(qa.e.records)')
    page.locator('#restart').press('Enter')
    assert page.evaluate('JSON.stringify(qa.e.records)')==saved
    assert page.locator('#sound').get_attribute('aria-pressed')=='false'
    assert page.evaluate('localStorage.getItem("randolf:games:sound")')=='off'
    assert page.evaluate('qa.e.time')==0
    assert page.locator('#game').evaluate('e=>e===document.activeElement')
    page.reload();page.wait_for_function('__frames.length>0')
    assert page.locator('#sound').get_attribute('aria-pressed')=='false'
    assert page.evaluate('__audioContexts.length')==0
    results['restartAndStorage']='50 restarts, keyboard focus, final resolution lock, persistent records and sound passed.'
    results['pageErrors']=errors;assert not errors,errors
    context.close()
    browser.close()
(OUT/'phase4-production-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
