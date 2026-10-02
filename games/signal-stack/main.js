import { Engine, State } from './engine.js';
import { Renderer } from './renderer.js';
import { bindInput } from './input.js';
import { loadRecords, saveRecords } from './storage.js';
import { SignalAudio, SOUND_KEY } from './audio.js';
import { FrameClock, RunPresentation } from './lifecycle.js';

const canvas = document.querySelector('#game');
const status = document.querySelector('#status');
const fallback = document.querySelector('#render-fallback');
const restart = document.querySelector('#restart');
const sound = document.querySelector('#sound');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const engine = new Engine({ records: loadRecords(), reducedMotion: motion.matches });
const audio = new SignalAudio();

function start() {
  let renderer;
  try { renderer = new Renderer(canvas, engine.config.WORLD_WIDTH); }
  catch (error) {
    fallback.hidden = false;
    canvas.setAttribute('aria-disabled', 'true');
    canvas.tabIndex = -1;
    status.textContent = '3D rendering is unavailable in this browser.';
    console.warn('Signal Stack could not initialize WebGL 2:', error.message);
    return;
  }
  status.textContent = `Ready. ${engine.integrity} integrity remaining. Tap to drop.`;
  const clock = new FrameClock(engine.config.MAX_FRAME_TIME);
  const presentation = new RunPresentation();
  if (document.hidden) clock.pause();
  let available = true, resultShown = false, frameId;
  const lifecycle = new AbortController();
  const options = { signal: lifecycle.signal };
  const draw = () => { if (available) renderer.draw(engine, clock.paused, presentation); };

  function syncSound() {
    sound.setAttribute('aria-pressed', String(audio.enabled));
    sound.textContent = audio.enabled ? 'SOUND ON' : 'SOUND OFF';
  }
  syncSound();
  sound.addEventListener('click', () => {
    audio.setEnabled(!audio.enabled); syncSound();
    if (audio.enabled && !clock.paused && available) audio.gesture(true);
  }, options);
  window.addEventListener('storage', event => {
    if (event.key === SOUND_KEY || event.key === null) {
      audio.setEnabled(event.newValue !== 'off'); syncSound();
    }
  }, options);

  function resize() {
    if (!available) return;
    clock.reset();
    const height = renderer.resize();
    // A restored context or redundant resize must not snap a moving camera.
    if (height !== engine.viewHeight) engine.setViewport(height);
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('resize', resize, options);
  motion.addEventListener('change', event => { engine.reducedMotion = event.matches; draw(); }, options);

  function announceEvents() {
    audio.observe(engine);
    for (const event of engine.drainEvents()) {
      saveRecords(engine.records);
      presentation.event(event); audio.event(event, engine);
      if (event.type === 'landed') {
        status.textContent = `${event.perfect ? `Perfect. Combo ${engine.combo}.` : 'Connected.'} Height ${engine.height}. Score ${engine.score}.`;
      } else if (event.type === 'missed') {
        status.textContent = `Signal dropped. ${engine.integrity} integrity remaining.`;
      }
    }
  }

  function activate() {
    if (!available || document.hidden) return;
    if (clock.paused) { clock.resume(); renderer.quality.resetTiming(); audio.gesture(); draw(); return; }
    if (engine.state === State.GAME_OVER) {
      if (!presentation.ready) return;
      audio.reset(); engine.reset(); presentation.reset();
      clock.reset(); renderer.quality.resetTiming(); resultShown = false;
      audio.gesture(true);
      status.textContent = `Reconnected. ${engine.integrity} integrity remaining. Tap to drop.`;
      canvas.focus({ preventScroll: true });
    } else {
      const connect = !engine.started;
      if (engine.release()) audio.gesture(connect);
    }
    announceEvents(); draw();
  }
  const unbind = bindInput(canvas, {
    activate,
    pause() { clock.pause(); audio.silence(); renderer.quality.resetTiming(); saveRecords(engine.records); draw(); },
    resume() { if (!available) return; clock.resume(); renderer.quality.resetTiming(); draw(); },
  });
  restart.addEventListener('click', activate, options);

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); available = false; clock.pause(); audio.silence(); renderer.quality.resetTiming();
    renderer.loseContext();
    canvas.setAttribute('aria-disabled', 'true');
    fallback.hidden = false;
    fallback.querySelector('h2').textContent = '3D rendering was interrupted.';
    fallback.querySelector('p').textContent = 'Your run is paused while the graphics connection recovers. If this message remains, reload to reconnect. Saved records are kept.';
    status.textContent = 'Graphics interrupted. Your run is paused.';
    saveRecords(engine.records);
  }, options);
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      renderer.restoreContext(); available = true;
      if (!document.hidden) clock.resume();
      canvas.removeAttribute('aria-disabled');
      resize(); fallback.hidden = true;
      status.textContent = 'Graphics restored. Tap to continue.';
    } catch (error) {
      available = false; clock.pause();
      fallback.querySelector('p').textContent = 'Reload to reconnect. Your saved records are kept.';
      console.warn('Signal Stack graphics recovery failed:', error.message);
    }
  }, options);

  function frame(time) {
    if (available && !clock.paused) {
      const dt = clock.sample(time);
      presentation.advance(dt); engine.update(dt);
      announceEvents(); renderer.observeFrame(time); draw();
      if (presentation.ready && !resultShown) {
        resultShown = true;
        status.textContent = `Signal lost. Height ${engine.height}. Best ${engine.records.bestHeight}. Score ${engine.score}. Tap, Space or Enter to reconnect.`;
        // Do not steal focus from the Sound control or site navigation.
        if (document.activeElement === canvas) restart.focus({ preventScroll: true });
      }
    }
    frameId = requestAnimationFrame(frame);
  }
  window.addEventListener('pagehide', event => {
    audio.silence();
    if (event.persisted) return; // BFCache retains its engine and renderer.
    cancelAnimationFrame(frameId); observer.disconnect(); unbind(); lifecycle.abort(); renderer.dispose();
  }, options);
  resize(); canvas.focus({ preventScroll: true }); frameId = requestAnimationFrame(frame);
}
start();
