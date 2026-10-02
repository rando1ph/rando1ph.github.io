"""Targeted real-WebGL quality failure paths and reduced-detail steady frames. No production test hooks."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).parent
URL='http://127.0.0.1:8000/games/signal-stack/'
html=(ROOT/'index.html').read_text().replace('<script type="module" src="./main.js"></script>','')
results={}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    for mode in ['hdr-unavailable','compositor-error','configured-off','sustained-slow-frames']:
        context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1.5)
        if mode=='hdr-unavailable':
            context.add_init_script('''const original=WebGL2RenderingContext.prototype.getExtension;
              WebGL2RenderingContext.prototype.getExtension=function(name){
                return ['EXT_color_buffer_float','EXT_color_buffer_half_float'].includes(name)?null:original.call(this,name);
              };''')
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('**/quality-harness',lambda route:route.fulfill(body=html,content_type='text/html'))
        page.goto(URL+'quality-harness')
        result=page.evaluate('''async mode=>{
          const [{Renderer},{Engine}]=await Promise.all([import('./renderer.js'),import('./engine.js')]);
          const e=new Engine(),r=new Renderer(document.querySelector('canvas'),390,undefined,{bloom:mode!=='configured-off'});
          e.setViewport(r.resize());r.draw(e);
          if(mode==='sustained-slow-frames'){
            for(let i=0;i<12;i++){e.spawn();e.release();e.active.x=e.top.x;e.active.y=e.top.y-e.active.height-.01;e.update(e.config.STEP);e.update(.7);r.draw(e);}
            for(let t=0;t<5000;t+=50)r.observeFrame(t);
          }
          if(mode==='compositor-error')r.post.render=()=>{throw new Error('Simulated driver failure');};
          e.release();e.update(.5);const before=JSON.stringify(e);r.draw(e);
          if(JSON.stringify(e)!==before)throw Error('Renderer mutated engine');
          // Finish queued warm-up draws before measuring real RAF intervals.
          r.renderer.getContext().finish();
          let steady=null;
          if(mode==='sustained-slow-frames')steady=await new Promise(resolve=>{
            let start=null,previous=null;const intervals=[];
            function frame(now){if(start===null)start=now;
              if(previous!==null){if(previous-start>=2000)intervals.push(now-previous);e.update(Math.min((now-previous)/1000,.1));}
              r.draw(e);previous=now;
              if(now-start<7000)requestAnimationFrame(frame);else{
                const sorted=[...intervals].sort((a,b)=>a-b),total=intervals.reduce((a,b)=>a+b,0);
                resolve({fps:intervals.length*1000/total,median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],samples:intervals.length,sampledMs:total});}}
            requestAnimationFrame(frame);
          });
          const result={...r.diagnostics(),steady,autoClear:r.renderer.autoClear,glError:r.renderer.getContext().getError()};
          r.dispose();return result;
        }''',mode)
        assert not result['bloom'] and result['compositor'] is None
        assert result['autoClear'] and result['glError']==0
        if mode=='sustained-slow-frames':
            assert result['environment']['cloudCards']==6 and result['effects']['particles']==0
            assert result['steady']['samples']>0
        assert not errors,errors
        results[mode]=result
        context.close()
    browser.close()
(ROOT/'qa'/'phase3-quality-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
