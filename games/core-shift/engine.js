/* ------------------------------------------------------------------
   Core Shift — engine (pure logic, Node-testable, no DOM).

   Level grid encoding (per row string):
     #  wall / bulkhead
     .  Core Dock (goal)
     $  Energy Core
     *  Core on Dock
     @  robot (player)
     +  robot on Dock
     _  floor (space also accepted)

   State: { player: idx, cores: [idx...] } — idx = y * w + x.
   Moves/pushes are tracked by the caller; engine.step() reports
   what happened per atomic step.
   ------------------------------------------------------------------ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CSEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 }
  };
  var DIR_NAMES = ["up", "down", "left", "right"];

  /* --- parsing ------------------------------------------------------ */

  function parseLevel(def) {
    var rows = def.grid;
    var h = rows.length;
    var w = 0;
    var y, x, ch;
    for (y = 0; y < h; y += 1) w = Math.max(w, rows[y].length);

    var walls = new Uint8Array(w * h);
    var docks = [];
    var cores = [];
    var player = -1;
    var floorCount = 0;

    for (y = 0; y < h; y += 1) {
      for (x = 0; x < w; x += 1) {
        ch = x < rows[y].length ? rows[y].charAt(x) : "_";
        var i = y * w + x;
        if (ch === " ") ch = "_";
        switch (ch) {
          case "#":
            walls[i] = 1;
            break;
          case ".":
            docks.push(i);
            floorCount += 1;
            break;
          case "$":
            cores.push(i);
            floorCount += 1;
            break;
          case "*":
            cores.push(i);
            docks.push(i);
            floorCount += 1;
            break;
          case "@":
            player = i;
            floorCount += 1;
            break;
          case "+":
            player = i;
            docks.push(i);
            floorCount += 1;
            break;
          case "_":
            floorCount += 1;
            break;
          default:
            throw new Error("bad char '" + ch + "' in level '" + def.name + "'");
        }
      }
    }

    if (player < 0) throw new Error("no player in '" + def.name + "'");
    if (docks.length === 0) throw new Error("no docks in '" + def.name + "'");
    if (cores.length !== docks.length) {
      throw new Error(
        "cores (" + cores.length + ") != docks (" + docks.length + ") in '" + def.name + "'"
      );
    }

    return {
      name: def.name,
      theme: def.theme || "",
      w: w,
      h: h,
      walls: walls,
      docks: docks,
      player: player,
      cores: cores
    };
  }

  function initialState(lv) {
    return { player: lv.player, cores: lv.cores.slice() };
  }

  /* --- cell helpers -------------------------------------------------- */

  function isWall(lv, i) {
    return lv.walls[i] === 1;
  }
  function coreAt(lv, st, i) {
    return st.cores.indexOf(i);
  }
  function isFree(lv, st, i) {
    return lv.walls[i] !== 1 && coreAt(lv, st, i) < 0;
  }
  function isDock(lv, i) {
    return lv.docks.indexOf(i) >= 0;
  }

  function neighbor(lv, i, dir) {
    var d = DIRS[dir];
    var x = (i % lv.w) + d.dx;
    var y = Math.floor(i / lv.w) + d.dy;
    if (x < 0 || x >= lv.w || y < 0 || y >= lv.h) return -1;
    return y * lv.w + x;
  }

  /* --- player reachability (no pushing) ------------------------------ */

  function reachability(lv, st) {
    var seen = new Uint8Array(lv.w * lv.h);
    var queue = [st.player];
    seen[st.player] = 1;
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head];
      head += 1;
      for (var k = 0; k < 4; k += 1) {
        var n = neighbor(lv, cur, DIR_NAMES[k]);
        if (n >= 0 && !seen[n] && isFree(lv, st, n)) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    return seen;
  }

  /* --- dead squares: reverse pull-BFS from docks ----------------------
     A core can be pulled from cell c to cell s = c - d only if a robot
     could stand behind s (cell s - d must exist and be floor).  Any
     floor cell never visited cannot ever reach a dock: static dead
     square.  Docks themselves are always alive.                       */

  function deadSquares(lv) {
    var alive = new Uint8Array(lv.w * lv.h);
    var queue = [];
    for (var i = 0; i < lv.docks.length; i += 1) {
      alive[lv.docks[i]] = 1;
      queue.push(lv.docks[i]);
    }
    var head = 0;
    while (head < queue.length) {
      var c = queue[head];
      head += 1;
      for (var k = 0; k < 4; k += 1) {
        var d = DIRS[DIR_NAMES[k]];
        var s = stepIdx(lv, c, -d.dx, -d.dy); /* candidate previous cell */
        var behind = stepIdx(lv, s, -d.dx, -d.dy); /* robot standing spot */
        if (s >= 0 && behind >= 0 && !lv.walls[s] && !lv.walls[behind] && !alive[s]) {
          alive[s] = 1;
          queue.push(s);
        }
      }
    }
    var dead = [];
    for (var j = 0; j < lv.w * lv.h; j += 1) {
      if (!lv.walls[j] && !alive[j]) dead.push(j);
    }
    return { alive: alive, dead: dead };
  }

  function stepIdx(lv, i, dx, dy) {
    var x = (i % lv.w) + dx;
    var y = Math.floor(i / lv.w) + dy;
    if (x < 0 || x >= lv.w || y < 0 || y >= lv.h) return -1;
    return y * lv.w + x;
  }

  /* --- moves ---------------------------------------------------------- */

  /* Returns null if the step is illegal, else a result object:
     { pushed, coreFrom, coreTo, docked (bool), undocked (bool),
       deadLanding (bool), from, to }                                 */
  function step(lv, st, dir, dead) {
    var n = neighbor(lv, st.player, dir);
    if (n < 0) return null;
    var ci = coreAt(lv, st, n);
    if (ci >= 0) {
      var beyond = neighbor(lv, n, dir);
      if (beyond < 0) return null;
      if (lv.walls[beyond] || coreAt(lv, st, beyond) >= 0) return null;
      var res = {
        pushed: true,
        coreIndex: ci,
        coreFrom: n,
        coreTo: beyond,
        from: st.player,
        to: n,
        docked: isDock(lv, beyond) && !isDock(lv, n),
        undocked: isDock(lv, n) && !isDock(lv, beyond),
        deadLanding: dead ? dead.alive[beyond] === 0 : false
      };
      st.cores[ci] = beyond;
      st.player = n;
      return res;
    }
    if (lv.walls[n]) return null;
    var fromCell = st.player;
    st.player = n;
    return {
      pushed: false,
      from: fromCell,
      to: n,
      docked: false,
      undocked: false,
      deadLanding: false
    };
  }

  function isSolved(lv, st) {
    for (var i = 0; i < lv.docks.length; i += 1) {
      if (coreAt(lv, st, lv.docks[i]) < 0) return false;
    }
    return true;
  }

  function dockedCount(lv, st) {
    var n = 0;
    for (var i = 0; i < lv.docks.length; i += 1) {
      if (coreAt(lv, st, lv.docks[i]) >= 0) n += 1;
    }
    return n;
  }

  /* BFS path of cell indices from a to b over free cells (no pushing).
     Returns null when unreachable. Excludes the start cell.           */
  function findPath(lv, st, from, to) {
    if (from === to) return [];
    var prev = new Int32Array(lv.w * lv.h).fill(-2);
    prev[from] = -1;
    var queue = [from];
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head];
      head += 1;
      for (var k = 0; k < 4; k += 1) {
        var n = neighbor(lv, cur, DIR_NAMES[k]);
        if (n < 0 || prev[n] !== -2) continue;
        if (n === to) {
          if (lv.walls[to] || coreAt(lv, st, to) >= 0) continue;
          prev[n] = cur;
          queue.push(n);
        } else if (isFree(lv, st, n)) {
          prev[n] = cur;
          queue.push(n);
        }
      }
    }
    if (prev[to] === -2) return null;
    var path = [];
    var c = to;
    while (c !== from) {
      path.push(c);
      c = prev[c];
    }
    path.reverse();
    return path;
  }

  return {
    DIRS: DIRS,
    DIR_NAMES: DIR_NAMES,
    parseLevel: parseLevel,
    initialState: initialState,
    isWall: isWall,
    coreAt: coreAt,
    isFree: isFree,
    isDock: isDock,
    neighbor: neighbor,
    reachability: reachability,
    deadSquares: deadSquares,
    step: step,
    isSolved: isSolved,
    dockedCount: dockedCount,
    findPath: findPath
  };
});
