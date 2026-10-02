export class InputGate {
  constructor() { this.clear(); this.lastPointer = this.resumeAt = -Infinity; }
  clear() { this.held = false; this.pointer = null; }
  quarantine(time) { this.clear(); this.resumeAt = time + 150; }
  key(repeat, time = Infinity) {
    if (repeat || this.held || time < this.resumeAt) return false;
    this.held = true; return true;
  }
  press(id, time) {
    if (this.pointer !== null || time - this.lastPointer < 250 || time < this.resumeAt) return false;
    this.pointer = id; this.lastPointer = time; return true;
  }
}

export function bindInput(canvas, { activate, pause, resume }) {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const gate = new InputGate();
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    if (!gate.press(event.pointerId, event.timeStamp)) return;
    canvas.focus({ preventScroll: true });
    activate();
  }, options);
  // Pointer Events only: no synthetic click/touch listeners to double-release.
  canvas.addEventListener('keydown', event => {
    if (!['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault();
    if (!gate.key(event.repeat, event.timeStamp)) return;
    activate();
  }, options);
  const clear = () => gate.clear();
  window.addEventListener('pointerup', event => { if (event.pointerId === gate.pointer) gate.pointer = null; }, options);
  window.addEventListener('keyup', clear, options);
  canvas.addEventListener('pointercancel', clear, options);
  canvas.addEventListener('blur', clear, options);
  canvas.addEventListener('webglcontextlost', clear, options);
  canvas.addEventListener('webglcontextrestored', () => gate.quarantine(performance.now()), options);
  window.addEventListener('blur', () => { clear(); pause(); }, options);
  const restore = () => { if (!document.hidden) { gate.quarantine(performance.now()); resume(); } };
  window.addEventListener('focus', restore, options);
  document.addEventListener('visibilitychange', () => {
    clear();
    if (document.hidden) pause(); else restore();
  }, options);
  window.addEventListener('pagehide', pause, options);
  window.addEventListener('pageshow', event => { if (event.persisted) restore(); }, options);
  return () => controller.abort();
}
