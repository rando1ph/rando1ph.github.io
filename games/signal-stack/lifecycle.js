// Wall-clock discontinuities must not become simulation time or queued effects.
export class FrameClock {
  constructor(maxDelta = .1) { this.maxDelta = maxDelta; this.paused = false; this.last = null; }
  reset() { this.last = null; }
  pause() { this.paused = true; this.reset(); }
  resume() { this.paused = false; this.reset(); }
  sample(now) {
    if (this.paused || !Number.isFinite(now)) return 0;
    const elapsed = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    return elapsed > .25 || elapsed < 0 ? 0 : Math.min(elapsed, this.maxDelta);
  }
}

// Presentation time is separate because the accepted engine stops at GAME_OVER.
export class RunPresentation {
  constructor() { this.reset(); }
  reset() { this.lossAge = Infinity; this.gameOverAge = null; }
  event(event) {
    if (event.type === 'missed') this.lossAge = 0;
    if (event.type === 'gameover') this.gameOverAge = 0;
  }
  advance(dt) {
    this.lossAge += dt;
    if (this.gameOverAge !== null) this.gameOverAge += dt;
  }
  get ready() { return this.gameOverAge !== null && this.gameOverAge >= .32; }
  get signal() {
    if (this.gameOverAge !== null) return 1 - .82 * Math.min(1, this.gameOverAge / .24);
    // One restrained dip; no repeated flashing or obscuring the new module.
    return this.lossAge < .24 ? 1 - .42 * Math.sin(Math.PI * this.lossAge / .24) : 1;
  }
}
