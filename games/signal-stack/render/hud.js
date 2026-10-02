import { perfectEnvelope } from './effects.js';
import { State } from '../engine.js';

export class HUD {
  constructor(root = document) {
    this.elements = Object.fromEntries([...root.querySelectorAll('[data-hud]')].map(el => [el.dataset.hud, el]));
  }
  text(key, value) {
    const el = this.elements[key];
    if (el && el.textContent !== String(value)) el.textContent = value;
  }
  sync(engine, paused, presentation = null) {
    this.text('height', String(engine.height).padStart(2, '0'));
    this.text('best', engine.records.bestHeight);
    this.text('score', engine.score);
    this.text('combo', `×${engine.combo}`);
    const comboPulse = !engine.reducedMotion && perfectEnvelope(engine).visible;
    this.elements.combo?.classList.toggle('energy-pulse', comboPulse);
    this.text('integrity', `${'● '.repeat(engine.integrity)}${'○ '.repeat(engine.misses)}`.trim());
    this.elements.integrity?.setAttribute('aria-label', `${engine.integrity} of ${engine.config.MAX_MISSES} integrity remaining`);
    this.text('feedback', engine.feedback ? engine.feedback.perfect ? 'PERFECT!' : engine.feedback.text : '');
    this.text('bonus', engine.feedback?.points ? `+${engine.feedback.points}` : '');
    if (this.elements.feedback) this.elements.feedback.dataset.perfect = String(Boolean(engine.feedback?.perfect));
    if (this.elements.cue) this.elements.cue.hidden = ![State.READY, State.SWINGING].includes(engine.state) || paused;
    if (this.elements.paused) this.elements.paused.hidden = !paused;
    if (this.elements.gameover) this.elements.gameover.hidden = engine.state !== State.GAME_OVER || (presentation && !presentation.ready);
    this.text('result-height', `${engine.height} m`);
    this.text('result-best', `${engine.records.bestHeight} m`);
    this.text('result-score', engine.score);
    this.text('result-combo', `×${engine.bestCombo}`);
    if (this.elements['result-streak']) this.elements['result-streak'].hidden = engine.bestCombo === 0;
  }
}
