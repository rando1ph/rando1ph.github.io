import { State } from './engine.js';

export const SOUND_KEY = 'randolf:games:sound';

// Own only this run's event bookkeeping. Synthesis, context and preference are
// provided by the repository's shared GameAudio layer.
export class SignalAudio {
  constructor(shared = globalThis.GameAudio) {
    this.shared = shared;
    this.epoch = 0;
    this.failure = null;
  }
  get enabled() { return this.shared?.isEnabled() ?? false; }
  setEnabled(on) {
    this.silence();
    this.shared?.setEnabled(on);
    return this.enabled;
  }
  async gesture(connect = false) {
    const epoch = this.epoch;
    const ready = await this.shared?.ss.unlock();
    if (ready && epoch === this.epoch && connect) this.shared.ss.connect();
  }
  observe(engine) {
    if (this.failure === engine.active) return;
    if ([State.FALLING_LEFT, State.FALLING_RIGHT, State.MISSED].includes(engine.state)) {
      this.failure = engine.active;
      if (engine.state === State.MISSED) this.shared?.ss.miss();
      else this.shared?.ss.slip();
    }
  }
  event(event, engine) {
    if (event.type === 'landed') {
      if (event.perfect) this.shared?.ss.perfect(engine.combo);
      else this.shared?.ss.land();
    }
    if (event.type === 'missed' && event.integrity > 0) this.shared?.ss.integrity();
    if (event.type === 'gameover') this.shared?.ss.lost();
  }
  silence() { this.epoch++; this.shared?.ss.stop(); }
  reset() { this.silence(); this.failure = null; }
}
