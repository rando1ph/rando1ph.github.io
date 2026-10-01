/* ------------------------------------------------------------------
   Core Shift — persistence
   One namespaced blob. Nothing here is shared with the old Core Shift
   build (it used a different key and a different shape), so old saves
   are simply ignored rather than migrated.

   Shape:
     { v, current, unlocked, best: { <i>: {moves,pushes} }, resume: { <i>: <state> } }

   `resume` holds the serialized in-progress board per level so a reload
   drops you back exactly where you were, undo history included.
   ------------------------------------------------------------------ */

(function (global, factory) {
  "use strict";
  var Engine =
    typeof module === "object" && module.exports ? require("./engine.js") : global.CoreShiftEngine;
  var api = factory(Engine, global);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    global.CoreShiftStorage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine, global) {
  "use strict";

  var KEY = "randolf:core-shift:v3";
  var VERSION = 2;

  function empty() {
    return { v: VERSION, current: 0, unlocked: 0, best: {}, resume: {} };
  }

  function available() {
    try {
      var probe = KEY + ":probe";
      global.localStorage.setItem(probe, "1");
      global.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  var usable = available();

  function read() {
    if (!usable) return empty();
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return empty();
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object" || data.v !== VERSION) return empty();
      return normalize(data);
    } catch (e) {
      return empty();
    }
  }

  function normalize(data) {
    var out = empty();
    var i;
    if (typeof data.current === "number" && data.current >= 0) out.current = data.current | 0;
    if (typeof data.unlocked === "number" && data.unlocked >= 0) out.unlocked = data.unlocked | 0;
    if (data.best && typeof data.best === "object") {
      for (i in data.best) {
        if (!Object.prototype.hasOwnProperty.call(data.best, i)) continue;
        var b = data.best[i];
        if (!b || typeof b !== "object") continue;
        var moves = typeof b.moves === "number" && b.moves >= 0 ? b.moves | 0 : null;
        var pushes = typeof b.pushes === "number" && b.pushes >= 0 ? b.pushes | 0 : null;
        if (moves === null && pushes === null) continue;
        out.best[i] = { moves: moves, pushes: pushes };
      }
    }
    if (data.resume && typeof data.resume === "object") {
      for (i in data.resume) {
        if (!Object.prototype.hasOwnProperty.call(data.resume, i)) continue;
        var r = data.resume[i];
        if (!r || typeof r !== "object") continue;
        out.resume[i] = r;
      }
    }
    return out;
  }

  function write(data) {
    if (!usable) return false;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      usable = false; /* quota or a locked-down context — keep playing */
      return false;
    }
  }

  /* ------------------------------------------------------------------
     Convenience wrappers used by main.js
     ------------------------------------------------------------------ */

  function Store(levelCount) {
    this.levelCount = levelCount;
    this.data = read();
    this.clamp();
  }

  Store.prototype.clamp = function () {
    var max = this.levelCount - 1;
    if (this.data.current > max) this.data.current = max;
    if (this.data.unlocked > max) this.data.unlocked = max;
    if (this.data.unlocked < 0) this.data.unlocked = 0;
  };

  Store.prototype.save = function () {
    write(this.data);
  };

  Store.prototype.currentLevel = function () {
    return this.data.current;
  };

  Store.prototype.setCurrentLevel = function (index) {
    this.data.current = Math.max(0, Math.min(index, this.levelCount - 1));
    this.save();
  };

  Store.prototype.isUnlocked = function (index) {
    return index <= this.data.unlocked;
  };

  Store.prototype.unlockedCount = function () {
    return this.data.unlocked + 1;
  };

  Store.prototype.isComplete = function (index) {
    return Object.prototype.hasOwnProperty.call(this.data.best, String(index));
  };

  Store.prototype.completedCount = function () {
    var n = 0;
    for (var i = 0; i < this.levelCount; i += 1) if (this.isComplete(i)) n += 1;
    return n;
  };

  Store.prototype.best = function (index) {
    return this.data.best[String(index)] || null;
  };

  /**
   * Record a finished level. Only improves the stored best, and unlocks
   * the next level. Returns { improvedMoves, improvedPushes, unlocked }.
   */
  Store.prototype.recordCompletion = function (index, moves, pushes) {
    var key = String(index);
    var prev = this.data.best[key] || null;
    var improvedMoves = !prev || prev.moves === null || moves < prev.moves;
    var improvedPushes = !prev || prev.pushes === null || pushes < prev.pushes;
    this.data.best[key] = {
      moves: prev && prev.moves !== null && !improvedMoves ? prev.moves : moves,
      pushes: prev && prev.pushes !== null && !improvedPushes ? prev.pushes : pushes
    };
    delete this.data.resume[key];
    var unlocked = false;
    if (index + 1 < this.levelCount && index + 1 > this.data.unlocked) {
      this.data.unlocked = index + 1;
      unlocked = true;
    }
    this.save();
    return { improvedMoves: improvedMoves, improvedPushes: improvedPushes, unlocked: unlocked };
  };

  /** Remember where the player left a level. Pass null to forget it. */
  Store.prototype.setResume = function (index, state) {
    var key = String(index);
    if (!state || (state.moves === 0 && !state.history.length)) {
      delete this.data.resume[key];
    } else {
      this.data.resume[key] = Engine.serializeState(state);
    }
    this.save();
  };

  Store.prototype.getResume = function (index, level) {
    var raw = this.data.resume[String(index)];
    if (!raw) return null;
    return Engine.deserializeState(level, raw);
  };

  Store.prototype.clearResume = function (index) {
    delete this.data.resume[String(index)];
    this.save();
  };

  Store.prototype.resetAll = function () {
    this.data = empty();
    this.save();
  };

  return {
    KEY: KEY,
    VERSION: VERSION,
    empty: empty,
    read: read,
    write: write,
    available: function () {
      return usable;
    },
    Store: Store
  };
});
