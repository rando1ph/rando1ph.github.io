// Core swing/drop/collision behavior adapted from iamkun/tower_game (MIT).
// See LICENSE-tower-game.txt. World coordinates, fixed-step integration,
// camera tracking and the surrounding Signal Stack architecture are new.
export const State = Object.freeze({
  READY: 'READY', SWINGING: 'SWINGING', RELEASING: 'RELEASING',
  FALLING: 'FALLING', LANDED: 'LANDED', FALLING_LEFT: 'FALLING_LEFT',
  FALLING_RIGHT: 'FALLING_RIGHT', MISSED: 'MISSED', GAME_OVER: 'GAME_OVER',
});

// Distances are world pixels; times are seconds; angles are radians.
export const CONFIG = Object.freeze({
  WORLD_WIDTH: 390, BLOCK_WIDTH: 100, BLOCK_HEIGHT: 44,
  CARRIER_LENGTH: 180, DROP_GAP: 110, GRAVITY: 1250,
  PERFECT_TOLERANCE: 10, CONTACT_EPSILON: 1e-7, MAX_MISSES: 3,
  BASE_SCORE: 25, PERFECT_BONUS: 25,
  STEP: 1 / 240, MAX_FRAME_TIME: 0.1, LAND_PAUSE: 0.48,
  PIVOT_SPEED: 4.2, PIVOT_RELEASE_ANGLE: 1.3,
  FALL_SPIN: 1.4, FALL_SIDE_SPEED: 100,
  INITIAL_FLOOR_RATIO: 0.78, TOP_SCREEN_RATIO: 0.56, MIN_TOP_SCREEN: 340,
  CAMERA_RATE: 10, FEEDBACK_DURATION: 1.1,
});

// Adapted from utils.js height bands; restrained speeds for portrait play.
export const DIFFICULTY = Object.freeze([
  Object.freeze({ height: 0, amplitude: 0.64, frequency: 1.7 }),
  Object.freeze({ height: 5, amplitude: 0.72, frequency: 1.9 }),
  Object.freeze({ height: 10, amplitude: 0.82, frequency: 2.15 }),
  Object.freeze({ height: 20, amplitude: 0.92, frequency: 2.35 }),
]);
export function difficultyAt(height) {
  return DIFFICULTY.findLast(band => height >= band.height) || DIFFICULTY[0];
}

// block.js / hook.js: sinusoidal angle, then sine/cosine rope projection.
export function pendulumAt(time, carrier, band, length = CONFIG.CARRIER_LENGTH) {
  const phase = time * band.frequency;
  const angle = band.amplitude * Math.sin(phase);
  const angularVelocity = band.amplitude * band.frequency * Math.cos(phase);
  return {
    angle, angularVelocity,
    x: carrier.x + Math.sin(angle) * length,
    y: carrier.y + Math.cos(angle) * length,
  };
}

// Upstream's line.x/collisionX are half-width-offset support limits.
// Here x is the center: the same rule is explicit as center-of-mass support.
export function classifyLanding(block, top, config = CONFIG) {
  const delta = block.x - top.x;
  const overlap = (block.width + top.width) / 2 - Math.abs(delta);
  if (overlap <= config.CONTACT_EPSILON) return 'MISS';
  if (delta < -top.width / 2 - config.CONTACT_EPSILON) return 'LEFT';
  if (delta > top.width / 2 + config.CONTACT_EPSILON) return 'RIGHT';
  return Math.abs(delta) <= config.PERFECT_TOLERANCE + config.CONTACT_EPSILON
    ? 'PERFECT' : 'SUCCESS';
}

export class Engine {
  constructor({ config = {}, viewHeight = 650, reducedMotion = false, records = {} } = {}) {
    this.config = { ...CONFIG, ...config };
    this.viewHeight = viewHeight;
    this.reducedMotion = reducedMotion;
    this.records = { bestHeight: 0, bestScore: 0, bestCombo: 0, gamesPlayed: 0, ...records };
    this.reset();
  }

  reset() {
    const c = this.config;
    this.state = State.READY;
    this.time = 0;
    this.accumulator = 0;
    this.height = this.score = this.combo = this.bestCombo = this.misses = 0;
    this.started = false;
    this.events = [];
    this.feedback = null;
    this.tower = [{ x: 0, y: 0, width: c.BLOCK_WIDTH, height: c.BLOCK_HEIGHT, base: true }];
    this.camera = { x: 0, y: -Math.max(c.MIN_TOP_SCREEN, this.viewHeight * c.INITIAL_FLOOR_RATIO) };
    this.updateCameraTarget();
    this.spawn(State.READY);
  }

  get top() { return this.tower[this.tower.length - 1]; }
  get integrity() { return this.config.MAX_MISSES - this.misses; }
  get difficulty() { return difficultyAt(this.height); }
  drainEvents() { return this.events.splice(0); }

  setViewport(viewHeight) {
    this.viewHeight = viewHeight;
    this.updateCameraTarget();
    // Resizing only changes the view, never tower/collision coordinates.
    this.camera = { ...this.cameraTarget };
  }

  updateCameraTarget() {
    this.cameraTarget = {
      x: this.top.x,
      // Reserve clearance for the widest pendulum arc below the fixed HUD,
      // including short desktop/landscape windows.
      y: Math.min(-Math.max(this.config.MIN_TOP_SCREEN, this.viewHeight * this.config.INITIAL_FLOOR_RATIO),
        this.top.y - Math.max(this.config.MIN_TOP_SCREEN, this.viewHeight * this.config.TOP_SCREEN_RATIO)),
    };
  }

  spawn(state = State.SWINGING) {
    const c = this.config;
    this.carrier = { x: this.top.x,
      y: this.top.y - c.BLOCK_HEIGHT - c.DROP_GAP - c.CARRIER_LENGTH };
    this.active = { x: 0, y: 0, width: c.BLOCK_WIDTH, height: c.BLOCK_HEIGHT,
      angle: 0, vy: 0, vx: 0 };
    this.state = state;
    this.updateSwing();
  }

  updateSwing() {
    const pose = pendulumAt(this.time, this.carrier, this.difficulty, this.config.CARRIER_LENGTH);
    this.swing = pose;
    this.active.x = pose.x;
    this.active.y = pose.y; // Rope ends at the module's top-center.
  }

  release() {
    if (![State.READY, State.SWINGING].includes(this.state)) return false;
    if (!this.started) {
      this.started = true;
      this.records.gamesPlayed += 1;
      this.events.push({ type: 'started' });
    }
    // Upstream beforeDrop: detach without inheriting horizontal momentum.
    this.state = State.RELEASING;
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || this.state === State.GAME_OVER) return;
    this.accumulator += dt;
    const step = this.config.STEP;
    while (this.accumulator + 1e-12 >= step) {
      this.accumulator -= step;
      this.tick(step);
      if (this.state === State.GAME_OVER) { this.accumulator = 0; break; }
    }
  }

  tick(dt) {
    const c = this.config;
    this.time += dt;
    if (this.feedback && this.time > this.feedback.until) this.feedback = null;
    const ease = this.reducedMotion ? 1 : 1 - Math.exp(-c.CAMERA_RATE * dt);
    this.camera.x += (this.cameraTarget.x - this.camera.x) * ease;
    this.camera.y += (this.cameraTarget.y - this.camera.y) * ease;
    switch (this.state) {
      case State.READY:
      case State.SWINGING: this.updateSwing(); break;
      case State.RELEASING:
        this.state = State.FALLING;
        this.drop(dt);
        break;
      case State.FALLING: this.drop(dt); break;
      case State.LANDED:
        if (this.time >= this.nextAt) this.spawn();
        break;
      case State.FALLING_LEFT:
      case State.FALLING_RIGHT: this.tip(dt); break;
      case State.MISSED:
        this.freeFall(dt);
        this.checkOut();
        break;
    }
  }

  freeFall(dt) {
    const b = this.active;
    b.x += b.vx * dt;
    b.y += b.vy * dt + 0.5 * this.config.GRAVITY * dt * dt;
    b.vy += this.config.GRAVITY * dt;
  }

  drop(dt) {
    this.freeFall(dt);
    if (this.active.y + this.active.height < this.top.y) return;
    const result = classifyLanding(this.active, this.top, this.config);
    if (result === 'MISS') { this.state = State.MISSED; return; }
    this.active.y = this.top.y - this.active.height;
    if (result === 'LEFT' || result === 'RIGHT') this.startTip(result);
    else this.land(result === 'PERFECT');
  }

  startTip(side) {
    const b = this.active;
    b.direction = side === 'LEFT' ? -1 : 1;
    b.pivot = { x: this.top.x + b.direction * this.top.width / 2, y: this.top.y };
    b.offset = { x: b.x - b.pivot.x, y: b.y + b.height / 2 - b.pivot.y };
    b.tipSpeed = this.config.PIVOT_SPEED * Math.max(0.5, Math.abs(b.offset.x) / (b.width / 2));
    b.detached = false;
    b.vy = 0;
    this.state = side === 'LEFT' ? State.FALLING_LEFT : State.FALLING_RIGHT;
  }

  tip(dt) {
    const b = this.active, c = this.config;
    if (!b.detached) {
      b.angle += b.direction * b.tipSpeed * dt;
      // Rigid rotation around the supporting top corner, adapted from block.js.
      const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
      b.x = b.pivot.x + b.offset.x * cos - b.offset.y * sin;
      b.y = b.pivot.y + b.offset.x * sin + b.offset.y * cos - b.height / 2;
      if (Math.abs(b.angle) >= c.PIVOT_RELEASE_ANGLE) {
        b.detached = true;
        b.vx = b.direction * c.FALL_SIDE_SPEED;
      }
    } else {
      if (!this.reducedMotion) b.angle += b.direction * c.FALL_SPIN * dt;
      this.freeFall(dt);
      this.checkOut();
    }
  }

  land(perfect) {
    const b = this.active, c = this.config;
    if (perfect) b.x = this.top.x;
    b.perfect = perfect;
    this.combo = perfect ? this.combo + 1 : 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    // utils.js addScore: base + (bonus * consecutive Perfect count).
    const points = c.BASE_SCORE + c.PERFECT_BONUS * this.combo;
    this.score += points;
    this.height += 1;
    this.tower.push({ ...b });
    this.records.bestHeight = Math.max(this.records.bestHeight, this.height);
    this.records.bestScore = Math.max(this.records.bestScore, this.score);
    this.records.bestCombo = Math.max(this.records.bestCombo, this.bestCombo);
    this.state = State.LANDED;
    this.nextAt = this.time + c.LAND_PAUSE;
    this.feedback = { text: perfect ? `PERFECT ×${this.combo}` : 'CONNECTED',
      points, perfect, until: this.time + c.FEEDBACK_DURATION };
    this.updateCameraTarget();
    this.events.push({ type: 'landed', perfect, points });
  }

  checkOut() {
    const b = this.active;
    if (b.y - b.width < this.camera.y + this.viewHeight) return;
    this.misses += 1;
    this.combo = 0;
    this.events.push({ type: 'missed', integrity: this.integrity });
    if (this.integrity <= 0) {
      this.state = State.GAME_OVER;
      this.events.push({ type: 'gameover' });
    } else {
      this.feedback = { text: 'SIGNAL DROPPED', until: this.time + this.config.FEEDBACK_DURATION };
      this.spawn();
    }
  }
}
