/* ------------------------------------------------------------------
   Core Shift — solver
   Push-state search used by the headless validator, the unit tests and
   the level-selection pass. It searches push states rather than single
   robot steps: from a state it floods the robot's walkable region, then
   branches on every push reachable from there. That keeps the search
   small enough to prove levels solvable rather than merely "look fine".

   Node: require('./solver.js')   Browser: globalThis.CoreShiftSolver
   ------------------------------------------------------------------ */

(function (global, factory) {
  "use strict";
  var Engine =
    typeof module === "object" && module.exports ? require("./engine.js") : global.CoreShiftEngine;
  var api = factory(Engine);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    global.CoreShiftSolver = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";

  var DIRS = Engine.DIRS;

  function isWall(level, x, y) {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return true;
    return level.walls[y * level.w + x] === 1;
  }

  /* ------------------------------------------------------------------
     Dead squares
     Computed by reverse reachability ("pulling"): start from the docks
     and ask which cells a core could have been pulled from. Anything a
     core can never pull back to a dock is dead, whatever the robot does.

     This deliberately ignores the robot's actual position and the other
     cores, which makes it an over-approximation of "live" — so pruning
     with it can never discard a real solution, only hopeless branches.
     ------------------------------------------------------------------ */

  function deadSquares(level) {
    var n = level.w * level.h;
    var live = new Uint8Array(n);
    var queue = [];
    var i;

    for (i = 0; i < n; i += 1) {
      if (level.goals[i] && level.floor[i]) {
        live[i] = 1;
        queue.push(i);
      }
    }

    var head = 0;
    while (head < queue.length) {
      var cur = queue[head];
      head += 1;
      var cx = cur % level.w;
      var cy = (cur - cx) / level.w;
      for (var d = 0; d < 4; d += 1) {
        /* A core sitting at `from` can be pushed into `cur` when the cell
           beyond `cur` and the robot's standing cell both exist. */
        var fx = cx - DIRS[d].dx;
        var fy = cy - DIRS[d].dy;
        var px = cx - 2 * DIRS[d].dx;
        var py = cy - 2 * DIRS[d].dy;
        if (isWall(level, fx, fy) || isWall(level, px, py)) continue;
        var fi = fy * level.w + fx;
        if (live[fi] || !level.floor[fi]) continue;
        live[fi] = 1;
        queue.push(fi);
      }
    }

    var dead = new Uint8Array(n);
    for (i = 0; i < n; i += 1) {
      if (level.floor[i] && !live[i]) dead[i] = 1;
    }
    return dead;
  }

  /* ------------------------------------------------------------------
     Push-state search
     ------------------------------------------------------------------ */

  function encode(player, boxes) {
    return player + "|" + boxes.join(",");
  }

  /**
   * Breadth-first search over push states — returns the fewest pushes.
   *
   * opts.limit     max states to expand before giving up (default 200k)
   * opts.solution  also reconstruct the full robot-step sequence
   * opts.start     { player, boxes } to solve from a mid-game state
   *                (defaults to the level's initial state)
   *
   * Returns { solvable, minPushes, expansions, solution, capped }.
   * `solution` is a flat list of direction indices (0=up 1=right 2=down
   * 3=left) that the engine can replay step by step.
   */
  function solve(level, opts) {
    opts = opts || {};
    var limit = opts.limit || 200000;
    var wantSolution = !!opts.solution;
    var dead = deadSquares(level);

    /* The validator solves from the level's initial state; the in-game hint
       solves from wherever the player is right now via opts.start. */
    var startBoxes = opts.start && opts.start.boxes ? opts.start.boxes.slice() : level.boxes.slice();
    var startPlayer = opts.start && typeof opts.start.player === "number" ? opts.start.player : level.player;
    var start = { player: startPlayer, boxes: startBoxes };

    if (Engine.isSolved(level, start)) {
      return { solvable: true, minPushes: 0, expansions: 0, solution: [], capped: false };
    }

    /* Compact parallel arrays — the frontier only keeps the robot cell, the
       sorted core cells and back-pointers. Walk paths are recomputed on
       demand when a solution is actually requested, which keeps the search
       itself cheap in memory. */
    var players = [startPlayer];
    var boxesList = [startBoxes];
    var parents = [-1];
    var viaPush = [-1];
    var viaFrom = [-1];
    var depths = [0];
    var seen = Object.create(null);
    seen[encode(startPlayer, startBoxes)] = 0;

    var head = 0;
    var expansions = 0;
    var capped = false;
    var found = -1;

    while (head < players.length) {
      if (expansions >= limit) {
        capped = true;
        break;
      }
      var si = head;
      head += 1;
      expansions += 1;

      var cur = { player: players[si], boxes: boxesList[si] };
      var region = Engine.reachable(level, cur);
      var bx = cur.boxes;

      for (var bi = 0; bi < bx.length && found === -1; bi += 1) {
        var box = bx[bi];
        var bxc = box % level.w;
        var byc = (box - bxc) / level.w;

        for (var d = 0; d < 4; d += 1) {
          var tx = bxc + DIRS[d].dx;
          var ty = byc + DIRS[d].dy;
          if (isWall(level, tx, ty)) continue;
          var to = ty * level.w + tx;
          if (dead[to]) continue;
          if (Engine.boxAt(cur, to) !== -1) continue;
          var sx = bxc - DIRS[d].dx;
          var sy = byc - DIRS[d].dy;
          if (isWall(level, sx, sy)) continue;
          var from = sy * level.w + sx;
          if (!region[from]) continue;

          var nextBoxes = bx.slice();
          nextBoxes[bi] = to;
          nextBoxes.sort(function (a, b) {
            return a - b;
          });
          /* The robot ends the push standing where the core used to be. */
          var landing = from + DIRS[d].dx + DIRS[d].dy * level.w;
          var key = encode(landing, nextBoxes);
          if (seen[key] !== undefined) continue;
          seen[key] = players.length;

          players.push(landing);
          boxesList.push(nextBoxes);
          parents.push(si);
          viaPush.push(d);
          viaFrom.push(from);
          depths.push(depths[si] + 1);

          if (Engine.isSolved(level, { player: landing, boxes: nextBoxes })) {
            found = players.length - 1;
            break;
          }
        }
      }
    }

    if (found === -1) {
      return { solvable: false, minPushes: -1, expansions: expansions, solution: null, capped: capped };
    }

    var result = {
      solvable: true,
      minPushes: depths[found],
      expansions: expansions,
      capped: false,
      solution: null
    };

    if (wantSolution) {
      result.solution = reconstruct(level, players, boxesList, parents, viaPush, viaFrom, found);
    }

    return result;
  }

  /**
   * Walk the parent chain back to the start, rebuilding the robot steps
   * that lead to each push. Each link contributes one segment — the walk to
   * the standing cell followed by the push itself — and the segments are
   * stitched in forward order. Null if any link turns out to be unwalkable.
   */
  function reconstruct(level, players, boxesList, parents, viaPush, viaFrom, found) {
    var segments = [];
    var node = found;
    while (node !== 0) {
      var parent = parents[node];
      var state = { player: players[parent], boxes: boxesList[parent] };
      var walk = Engine.pathTo(level, state, viaFrom[node]);
      if (!walk) return null;
      var segment = walk.slice();
      segment.push(viaPush[node]);
      segments.push(segment);
      node = parent;
    }
    var moves = [];
    for (var i = segments.length - 1; i >= 0; i -= 1) {
      for (var k = 0; k < segments[i].length; k += 1) moves.push(segments[i][k]);
    }
    return moves;
  }

  function directionBetween(from, to, w) {
    var fx = from % w;
    var fy = (from - fx) / w;
    var tx = to % w;
    var ty = (to - tx) / w;
    var dx = tx - fx;
    var dy = ty - fy;
    for (var d = 0; d < 4; d += 1) {
      if (DIRS[d].dx === dx && DIRS[d].dy === dy) return d;
    }
    return -1;
  }

  /* ------------------------------------------------------------------
     Replay — drives a step sequence through the engine and reports what
     happened. Used by validate.js and the unit tests so that a level is
     only ever declared solvable after the real rules reproduce it.
     ------------------------------------------------------------------ */

  function replay(level, moves) {
    var state = Engine.createState(level);
    var pushes = 0;
    for (var i = 0; i < moves.length; i += 1) {
      var r = Engine.step(level, state, moves[i]);
      if (!r) {
        return { ok: false, at: i, reason: "blocked step", state: state, pushes: pushes };
      }
      if (r.pushed) pushes += 1;
    }
    return {
      ok: Engine.isSolved(level, state),
      at: moves.length,
      reason: Engine.isSolved(level, state) ? null : "sequence ended without docking every core",
      state: state,
      pushes: pushes
    };
  }

  return {
    deadSquares: deadSquares,
    solve: solve,
    replay: replay,
    directionBetween: directionBetween
  };
});
