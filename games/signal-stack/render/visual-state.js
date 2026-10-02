// Pure visual policy. Nothing here feeds back into the gameplay engine.
export const ARCHETYPES = Object.freeze(['RELAY', 'COOLING', 'STRUCTURE', 'POWER', 'ARRAY', 'CORE']);
const EARLY = ['RELAY', 'RELAY', 'COOLING', 'STRUCTURE', 'RELAY', 'COOLING'];
const MATURE = ['POWER', 'RELAY', 'ARRAY', 'COOLING', 'STRUCTURE', 'POWER', 'ARRAY', 'RELAY'];
export function getModuleVariant(floor) {
  const n = Math.max(0, Math.floor(Number.isFinite(floor) ? floor : 0));
  if (n < EARLY.length) return EARLY[n];
  if (n >= 13 && (n - 13) % 17 === 0) return 'CORE';
  return MATURE[(n - EARLY.length) % MATURE.length];
}

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
export const ALTITUDE_BANDS = Object.freeze([
  { floor: 0, name: 'CITY', city: 1, cloud: .12, stars: .32, haze: .8, space: 0 },
  { floor: 8, name: 'SKYLINE', city: .78, cloud: .35, stars: .43, haze: 1, space: .08 },
  { floor: 18, name: 'CLOUDS', city: .32, cloud: .85, stars: .58, haze: .78, space: .2 },
  { floor: 30, name: 'UPPER ATMOSPHERE', city: .06, cloud: .46, stars: .8, haze: .42, space: .6 },
  { floor: 46, name: 'NEAR SPACE', city: 0, cloud: .15, stars: 1, haze: .18, space: 1 },
]);
export function environmentAt(floors) {
  const altitude = Math.max(0, Number.isFinite(floors) ? floors : 0);
  const index = Math.max(0, ALTITUDE_BANDS.findLastIndex(b => altitude >= b.floor));
  const a = ALTITUDE_BANDS[index], b = ALTITUDE_BANDS[Math.min(index + 1, ALTITUDE_BANDS.length - 1)];
  const blend = a === b ? 0 : smooth((altitude - a.floor) / (b.floor - a.floor));
  const result = { altitude, band: a.name, index, blend };
  for (const key of ['city', 'cloud', 'stars', 'haze', 'space']) result[key] = a[key] + (b[key] - a[key]) * blend;
  return result;
}
export const PARALLAX = Object.freeze({ near: .62, far: .25, mountains: .11, clouds: .38, moon: .018, stars: .004 });
export function parallaxOffset(altitude, layer) {
  return -Math.max(0, altitude) * (PARALLAX[layer] ?? 0) || 0;
}

// A 340ms energy event: top snap, then a bounded sweep down the visible tower.
export function propagationAt(age, distance, visibleSpan, reducedMotion = false) {
  if (age < 0 || age >= (reducedMotion ? .18 : .34)) return 0;
  const depth = clamp(distance / Math.max(44, visibleSpan));
  const delay = distance <= 0 ? 0 : reducedMotion ? .025 : .08 + depth * .14;
  const local = age - delay;
  const duration = distance <= 0 ? .16 : reducedMotion ? .13 : .12;
  if (local < 0 || local >= duration) return 0;
  return Math.min(1, local / .025) * Math.min(1, (duration - local) / .07);
}

export const DEFAULT_QUALITY = Object.freeze({ bloom: true, particles: true, atmosphereDetail: 1, autoFallback: true });
export class QualityState {
  constructor(options = {}) {
    this.config = { ...DEFAULT_QUALITY, ...options };
    this.reason = this.config.bloom ? null : 'configured';
    this.resetTiming();
  }
  resetTiming() { this.last = null; this.warmup = 0; this.elapsed = 0; this.frames = 0; this.slowFrames = 0; }
  disableBloom(reason) {
    this.config.bloom = false; this.reason = reason;
    if (reason === 'sustained-slow-frames') {
      this.config.atmosphereDetail = Math.min(this.config.atmosphereDetail, .5);
      this.config.particles = false;
    }
    this.resetTiming();
  }
  observe(now, paused = false) {
    if (paused) { this.resetTiming(); return; }
    const dt = this.last === null ? 0 : now - this.last; this.last = now;
    if (dt > 250 || dt < 0) { this.resetTiming(); return; }
    if (!this.config.bloom || !this.config.autoFallback || dt <= 0) {
      this.elapsed = this.frames = this.slowFrames = 0; return;
    }
    this.warmup += dt;
    if (this.warmup < 2000) return;
    this.elapsed += dt; this.frames++;
    if (dt > 36) this.slowFrames++;
    if (this.elapsed >= 2000 && this.frames >= 30) {
      if (this.slowFrames / this.frames >= .8 && this.elapsed / this.frames > 36) this.disableBloom('sustained-slow-frames');
      else this.elapsed = this.frames = this.slowFrames = 0;
    }
  }
}
