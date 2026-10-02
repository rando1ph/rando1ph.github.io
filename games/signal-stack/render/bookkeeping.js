import { State } from '../engine.js';

export const MAX_MODULES = 32;
export const OVERSCAN = 100;

// Renderer-owned IDs. Landing copies the active object in Phase 1; link that
// copy here without adding fields or changing the gameplay engine at all.
export class ModuleRegistry {
  constructor() { this.ids = new WeakMap(); this.nextId = 1; }
  idFor(block) {
    if (!this.ids.has(block)) this.ids.set(block, this.nextId++);
    return this.ids.get(block);
  }
  select(engine, height) {
    if (engine.state === State.LANDED) this.ids.set(engine.top, this.idFor(engine.active));
    const top = engine.camera.y - OVERSCAN;
    const bottom = engine.camera.y + height + OVERSCAN;
    const tower = engine.tower;
    // Tower y decreases monotonically. Find the first potentially visible
    // level in O(log n), then visit only the visible range, even in Endless.
    let lo = 0, hi = tower.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tower[mid].y > bottom) lo = mid + 1; else hi = mid;
    }
    const entries = [];
    for (let i = lo; i < tower.length; i++) {
      const block = tower[i];
      if (block.y + block.height < top) break;
      entries.push({ id: this.idFor(block), block, floor: i, active: false });
    }
    const b = engine.active;
    const activeVisible = ![State.LANDED, State.GAME_OVER].includes(engine.state)
      && b.y + b.height + b.width >= top && b.y - b.width <= bottom;
    const visible = entries.slice(-(MAX_MODULES - (activeVisible ? 1 : 0)));
    if (activeVisible) visible.push({ id: this.idFor(b), block: b, floor: engine.height + 1, active: true });
    return visible;
  }
}

export class ModulePool {
  constructor(create, attach, detach, limit = MAX_MODULES) {
    Object.assign(this, { create, attach, detach, limit });
    this.live = new Map(); this.free = []; this.allocated = 0;
  }
  sync(entries) {
    const wanted = new Set(entries.map(entry => entry.id));
    for (const [id, object] of this.live) {
      if (!wanted.has(id)) {
        this.detach(object); this.live.delete(id); this.free.push(object);
      }
    }
    for (const entry of entries) {
      if (this.live.has(entry.id)) continue;
      if (!this.free.length && this.allocated >= this.limit) continue;
      const object = this.free.pop() || this.allocate();
      this.live.set(entry.id, object); this.attach(object);
    }
    return this.live;
  }
  allocate() { this.allocated++; return this.create(); }
  clear() {
    for (const object of this.live.values()) this.detach(object);
    this.live.clear(); this.free.length = 0; this.allocated = 0;
    // Shared resources are disposed once by their owning library at teardown.
  }
}
