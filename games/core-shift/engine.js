/* ------------------------------------------------------------------
   Core Shift — engine
   Pure Sokoban rules. No DOM, no canvas, no timers.

   Authoritative game state lives here; the renderer only ever reads
   from it. Loadable as a plain <script> (exposes globalThis.CoreShiftEngine)
   or via require() from Node for the validator and the unit tests.

   Level encoding (canonical Sokoban):
     #  wall            .  core dock (goal)
     ' ' floor          *  energy core on a dock
     $  energy core     +  robot on a dock
     @  robot (player)
   ------------------------------------------------------------------ */

(function (global, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    global.CoreShiftEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Direction order is part of the persistence format — do not reorder. */
  var DIRS = [
    { dx: 0, dy: -1, name: "up" },
    { dx: 1, dy: 0, name: "right" },
    { dx: 0, dy: 1, name: "down" },
    { dx: -1, dy: 0, name: "left" }
  ];
  var DIR_INDEX = { up: 0, right: 1, down: 2, left: 3 };

  var LEGAL_CHARS = "# .$*@+";

  /* ------------------------------------------------------------------
     Parsing
     ------------------------------------------------------------------ */

  function pad(rows) {
    var w = 0;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (rows[i].length > w) w = rows[i].length;
    }
    var out = [];
    for (i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      while (r.length < w) r += " ";
      out.push(r);
    }
    return out;
  }

  /**
   * Parse rows of ASCII into a level. Never throws: malformed input comes
   * back as a level with `errors` populated so validate.js can report it.
   */
  function parse(rows) {
    var errors = [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { errors: ["empty level"], rows: [], w: 0, h: 0 };
    }
    rows = pad(rows.slice());
    var h = rows.length;
    var w = rows[0].length;
    var n = w * h;

    var walls = new Uint8Array(n);
    var goals = new Uint8Array(n);
    var boxes = [];
    var player = -1;
    var players = 0;
    var i, x, y, ch;

    for (y = 0; y < h; y += 1) {
      for (x = 0; x < w; x += 1) {
        i = y * w + x;
        ch = rows[y][x];
        if (LEGAL_CHARS.indexOf(ch) === -1) {
          errors.push("illegal character " + JSON.stringify(ch) + " at " + x + "," + y);
          continue;
        }
        if (ch === "#") walls[i] = 1;
        if (ch === "." || ch === "*" || ch === "+") goals[i] = 1;
        if (ch === "$" || ch === "*") boxes.push(i);
        if (ch === "@" || ch === "+") {
          players += 1;
          if (player === -1) player = i;
        }
      }
    }

    if (players !== 1) errors.push("expected exactly one robot, found " + players);
    if (player === -1) errors.push("no robot start position");
    if (boxes.length === 0) errors.push("no energy cores");

    var goalCount = 0;
    for (i = 0; i < n; i += 1) goalCount += goals[i];
    if (goalCount !== boxes.length) {
      errors.push("cores (" + boxes.length + ") != docks (" + goalCount + ")");
    }

    /* Interior = cells the robot can reach ignoring cores. Everything else
       (including the blank margin outside the hull) counts as solid. This
       keeps stray padding spaces from becoming walkable floor. */
    var floor = new Uint8Array(n);
    if (player !== -1) {
      var stack = [player];
      floor[player] = 1;
      while (stack.length) {
        var cur = stack.pop();
        var cx = cur % w;
        var cy = (cur - cx) / w;
        for (var d = 0; d < 4; d += 1) {
          var nx = cx + DIRS[d].dx;
          var ny = cy + DIRS[d].dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (walls[ni] || floor[ni]) continue;
          floor[ni] = 1;
          stack.push(ni);
        }
      }
    }

    /* A core stranded outside the hull can never be docked — unless it is
       already sitting on one. Same for a dock nothing can ever reach. */
    for (i = 0; i < boxes.length; i += 1) {
      if (!floor[boxes[i]] && !goals[boxes[i]]) {
        errors.push(
          "core at " + (boxes[i] % w) + "," + Math.floor(boxes[i] / w) + " sits outside the hull"
        );
      }
    }
    for (i = 0; i < n; i += 1) {
      if (goals[i] && !floor[i] && boxes.indexOf(i) === -1) {
        errors.push(
          "dock at " + (i % w) + "," + Math.floor(i / w) + " sits outside the hull"
        );
      }
      if (!walls[i] && !floor[i]) walls[i] = 1; /* seal the exterior */
    }

    boxes.sort(function (a, b) {
      return a - b;
    });

    return {
      rows: rows,
      w: w,
      h: h,
      walls: walls,
      goals: goals,
      floor: floor,
      boxes: boxes,
      player: player,
      boxCount: boxes.length,
      goalCount: goalCount,
      errors: errors
    };
  }

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  function createState(level) {
    return {
      player: level.player,
      boxes: level.boxes.slice(),
      moves: 0,
      pushes: 0,
      history: []
    };
  }

  function cloneState(state) {
    return {
      player: state.player,
      boxes: state.boxes.slice(),
      moves: state.moves,
      pushes: state.pushes,
      history: state.history.slice()
    };
  }

  function boxAt(state, index) {
    /* boxes are kept sorted, so this is a cheap linear scan */
    for (var i = 0; i < state.boxes.length; i += 1) {
      if (state.boxes[i] === index) return i;
    }
    return -1;
  }

  /**
   * Apply one step. Returns null when the step is blocked, otherwise
   * { pushed, from, to } describing what happened. Mutates `state`.
   */
  function step(level, state, dir) {
    var d = DIRS[dir];
    if (!d) return null;
    var w = level.w;
    var p = state.player;
    var px = p % w;
    var py = (p - px) / w;
    var nx = px + d.dx;
    var ny = py + d.dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= level.h) return null;
    var target = ny * w + nx;
    if (level.walls[target]) return null;

    var pushed = false;
    var beyond = -1;
    var bi = boxAt(state, target);
    if (bi !== -1) {
      var bx = nx + d.dx;
      var by = ny + d.dy;
      if (bx < 0 || by < 0 || bx >= w || by >= level.h) return null;
      beyond = by * w + bx;
      if (level.walls[beyond] || boxAt(state, beyond) !== -1) return null;
      state.boxes[bi] = beyond;
      state.boxes.sort(function (a, b) {
        return a - b;
      });
      pushed = true;
      state.pushes += 1;
    }

    state.history.push(dir | (pushed ? 4 : 0));
    state.player = target;
    state.moves += 1;
    /* boxFrom is the cell the core vacated — the cell the robot now occupies */
    return { pushed: pushed, dir: dir, player: target, boxFrom: pushed ? target : -1, boxTo: beyond };
  }

  /**
   * Revert one step. Returns null when there is nothing to undo,
   * otherwise { dir, pushed }.
   */
  function undo(level, state) {
    if (!state.history.length) return null;
    var code = state.history.pop();
    var dir = code & 3;
    var pushed = (code & 4) !== 0;
    var d = DIRS[dir];
    var w = level.w;
    var p = state.player;
    var px = p % w;
    var py = (p - px) / w;

    if (pushed) {
      var boxFrom = p;
      var boxTo = (py + d.dy) * w + (px + d.dx);
      var bi = boxAt(state, boxTo);
      if (bi !== -1) {
        state.boxes[bi] = boxFrom;
        state.boxes.sort(function (a, b) {
          return a - b;
        });
      }
      state.pushes -= 1;
    }

    state.player = (py - d.dy) * w + (px - d.dx);
    state.moves -= 1;
    return { dir: dir, pushed: pushed };
  }

  function dockedCount(level, state) {
    var n = 0;
    for (var i = 0; i < state.boxes.length; i += 1) {
      if (level.goals[state.boxes[i]]) n += 1;
    }
    return n;
  }

  function isSolved(level, state) {
    return dockedCount(level, state) === level.goalCount && level.goalCount > 0;
  }

  function isDocked(level, index) {
    return level.goals[index] === 1;
  }

  /* ------------------------------------------------------------------
     Movement helpers (used by tap-to-walk and by the solver)
     ------------------------------------------------------------------ */

  /** Cells the robot can walk to, treating cores as walls. */
  function reachable(level, state, from) {
    var n = level.w * level.h;
    var seen = new Uint8Array(n);
    var blocked = new Uint8Array(n);
    var i;
    for (i = 0; i < state.boxes.length; i += 1) blocked[state.boxes[i]] = 1;
    var queue = [from === undefined ? state.player : from];
    seen[queue[0]] = 1;
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head];
      head += 1;
      var cx = cur % level.w;
      var cy = (cur - cx) / level.w;
      for (var d = 0; d < 4; d += 1) {
        var nx = cx + DIRS[d].dx;
        var ny = cy + DIRS[d].dy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        var ni = ny * level.w + nx;
        if (level.walls[ni] || blocked[ni] || seen[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return seen;
  }

  /**
   * Shortest walk from the robot to `target`, as an array of direction
   * indices. Null when unreachable.
   */
  function pathTo(level, state, target) {
    if (target === state.player) return [];
    var prev = new Int32Array(level.w * level.h).fill(-1);
    var blocked = new Uint8Array(level.w * level.h);
    for (var i = 0; i < state.boxes.length; i += 1) blocked[state.boxes[i]] = 1;
    var queue = [state.player];
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head];
      head += 1;
      if (cur === target) break;
      var cx = cur % level.w;
      var cy = (cur - cx) / level.w;
      for (var d = 0; d < 4; d += 1) {
        var nx = cx + DIRS[d].dx;
        var ny = cy + DIRS[d].dy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        var ni = ny * level.w + nx;
        if (level.walls[ni] || blocked[ni] || prev[ni] !== -1 || ni === state.player) continue;
        prev[ni] = cur * 4 + d;
        queue.push(ni);
      }
    }
    if (target !== state.player && prev[target] === -1) return null;

    var path = [];
    var node = target;
    while (node !== state.player) {
      var code = prev[node];
      if (code === -1) return null;
      path.push(code & 3);
      node = (code - (code & 3)) / 4;
    }
    path.reverse();
    return path;
  }

  /**
   * Which directions could the robot push the core sitting at `index`?
   * A push is legal when the robot can stand on the opposite side and the
   * far side is clear. Returns an array of { dir, from, to, walk }.
   */
  function pushOptions(level, state, index) {
    var out = [];
    if (boxAt(state, index) === -1) return out;
    var w = level.w;
    var cx = index % w;
    var cy = (index - cx) / w;
    var region = reachable(level, state);
    for (var d = 0; d < 4; d += 1) {
      var tx = cx + DIRS[d].dx;
      var ty = cy + DIRS[d].dy;
      var sx = cx - DIRS[d].dx;
      var sy = cy - DIRS[d].dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= level.h) continue;
      if (sx < 0 || sy < 0 || sx >= w || sy >= level.h) continue;
      var to = ty * w + tx;
      var from = sy * w + sx;
      if (level.walls[to] || boxAt(state, to) !== -1) continue;
      if (!region[from]) continue;
      out.push({ dir: d, from: from, to: to });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Serialization (persistence)
     ------------------------------------------------------------------ */

  function serializeState(state) {
    return {
      p: state.player,
      b: state.boxes.slice(),
      m: state.moves,
      u: state.pushes,
      h: state.history.slice()
    };
  }

  /**
   * Rebuild a state from persisted data. Returns null when the payload does
   * not fit the level (older save, edited level) so callers can fall back to
   * a fresh state instead of rendering a corrupt board.
   */
  function deserializeState(level, data) {
    if (!data || typeof data !== "object") return null;
    if (typeof data.p !== "number" || !Array.isArray(data.b) || !Array.isArray(data.h)) return null;
    if (data.b.length !== level.boxCount) return null;
    if (data.p < 0 || data.p >= level.w * level.h) return null;
    if (level.walls[data.p]) return null;

    var seen = new Uint8Array(level.w * level.h);
    var boxes = [];
    var i;
    for (i = 0; i < data.b.length; i += 1) {
      var b = data.b[i];
      if (typeof b !== "number" || b < 0 || b >= seen.length) return null;
      if (level.walls[b] || seen[b] || b === data.p) return null;
      seen[b] = 1;
      boxes.push(b);
    }
    boxes.sort(function (a, b2) {
      return a - b2;
    });

    var history = [];
    for (i = 0; i < data.h.length; i += 1) {
      var code = data.h[i];
      if (typeof code !== "number" || code < 0 || code > 7) return null;
      history.push(code);
    }

    return {
      player: data.p,
      boxes: boxes,
      moves: typeof data.m === "number" && data.m >= 0 ? data.m : history.length,
      pushes: typeof data.u === "number" && data.u >= 0 ? data.u : 0,
      history: history
    };
  }

  return {
    DIRS: DIRS,
    DIR_INDEX: DIR_INDEX,
    LEGAL_CHARS: LEGAL_CHARS,
    parse: parse,
    createState: createState,
    cloneState: cloneState,
    step: step,
    undo: undo,
    boxAt: boxAt,
    dockedCount: dockedCount,
    isSolved: isSolved,
    isDocked: isDocked,
    reachable: reachable,
    pathTo: pathTo,
    pushOptions: pushOptions,
    serializeState: serializeState,
    deserializeState: deserializeState
  };
});
