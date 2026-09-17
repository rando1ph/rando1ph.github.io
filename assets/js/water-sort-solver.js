/* ------------------------------------------------------------------
   Water Sort — shared rules + solver (randolf.dev)
   Single source of truth for game semantics. Used by gameplay,
   the Web Worker, the generator and the development test suite.

   Bottle arrays are indexed bottom (0) → top (last).
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var CAPACITY = 4;

  /* --- production rules ------------------------------------------- */

  function getTopColor(bottle) {
    return bottle[bottle.length - 1];
  }

  function getTopRunLength(bottle) {
    var col = getTopColor(bottle);
    var run = 1;
    while (run < bottle.length && bottle[bottle.length - 1 - run] === col) {
      run += 1;
    }
    return run;
  }

  function getFreeSpace(bottle) {
    return CAPACITY - bottle.length;
  }

  function canPour(src, dst) {
    if (!src.length || dst.length >= CAPACITY) return false;
    if (!dst.length) return true;
    return getTopColor(dst) === getTopColor(src);
  }

  function getPourAmount(src, dst) {
    if (!canPour(src, dst)) return 0;
    return Math.min(getTopRunLength(src), getFreeSpace(dst));
  }

  function applyPour(bottles, si, di) {
    var amt = getPourAmount(bottles[si], bottles[di]);
    for (var u = 0; u < amt; u += 1) {
      bottles[di].push(bottles[si].pop());
    }
    return amt;
  }

  function isDone(bottle) {
    return bottle.length === CAPACITY && getTopRunLength(bottle) === CAPACITY;
  }

  function isSolved(bottles) {
    for (var i = 0; i < bottles.length; i += 1) {
      var b = bottles[i];
      if (!b.length) continue;
      if (b.length !== CAPACITY) return false;
      if (getTopRunLength(b) !== CAPACITY) return false;
    }
    return true;
  }

  function cloneBottles(bottles) {
    return bottles.map(function (b) { return b.slice(); });
  }

  /* --- canonicalization -------------------------------------------- */

  function stateKey(bottles) {
    var parts = [];
    for (var i = 0; i < bottles.length; i += 1) {
      parts.push(bottles[i].join("."));
    }
    return parts.sort().join("|");
  }

  /* --- admissible heuristic -----------------------------------------
     h = Σ_bottles color boundaries  +  Σ_colors max(0, bottomCount − 1)

     Part 1: every run sitting above a different color must eventually
     leave its bottle; one move removes exactly one run.
     Part 2: each color ends in exactly one bottle; if a color rests at
     the bottom of k bottles, at least k−1 of those bottom runs must
     themselves be poured out — each its own move. The two sets of runs
     (non-bottom vs bottom) are disjoint, so the sum never double counts
     and every term is a hard requirement → h is a lower bound.        */

  function heuristic(bottles) {
    var h = 0;
    var bottoms = Object.create(null);
    for (var i = 0; i < bottles.length; i += 1) {
      var b = bottles[i];
      for (var u = 1; u < b.length; u += 1) {
        if (b[u] !== b[u - 1]) h += 1;
      }
      if (b.length) {
        var c = b[0];
        bottoms[c] = (bottoms[c] || 0) + 1;
      }
    }
    for (var key in bottoms) {
      if (bottoms[key] > 1) h += bottoms[key] - 1;
    }
    return h;
  }

  /* --- move generation (safe prunes) --------------------------------
     All three prunes only discard moves whose result is isomorphic to
     another reachable state at equal or lower depth, so they preserve
     both completeness AND optimality:
       1. never pour from a completed bottle (isomorphic empty-swap)
       2. never pour a monochrome bottle into an empty (isomorphic swap)
       3. only consider the first empty bottle (empties interchangeable) */

  function legalMoves(bottles) {
    var moves = [];
    var firstEmpty = -1;
    var i;
    for (i = 0; i < bottles.length; i += 1) {
      if (!bottles[i].length) { firstEmpty = i; break; }
    }
    for (i = 0; i < bottles.length; i += 1) {
      var src = bottles[i];
      if (!src.length) continue;
      var col = getTopColor(src);
      var run = getTopRunLength(src);
      if (run === src.length && src.length === CAPACITY) continue;
      for (var j = 0; j < bottles.length; j += 1) {
        if (i === j) continue;
        var dst = bottles[j];
        var free = CAPACITY - dst.length;
        if (!free) continue;
        if (!dst.length) {
          if (run === src.length) continue;
          if (j !== firstEmpty) continue;
        } else if (getTopColor(dst) !== col) {
          continue;
        }
        moves.push({ i: i, j: j, amt: Math.min(run, free) });
      }
    }
    return moves;
  }

  function applyMove(bottles, mv) {
    var src = bottles[mv.i];
    var dst = bottles[mv.j];
    for (var u = 0; u < mv.amt; u += 1) {
      dst.push(src.pop());
    }
  }

  function undoMove(bottles, mv) {
    var src = bottles[mv.i];
    var dst = bottles[mv.j];
    for (var u = 0; u < mv.amt; u += 1) {
      src.push(dst.pop());
    }
  }

  /* --- binary min-heap ---------------------------------------------- */

  function MinHeap() {
    this.items = [];
  }

  MinHeap.prototype.push = function (item) {
    var items = this.items;
    items.push(item);
    var k = items.length - 1;
    while (k > 0) {
      var p = (k - 1) >> 1;
      if (items[p].f <= items[k].f) break;
      var t = items[p]; items[p] = items[k]; items[k] = t;
      k = p;
    }
  };

  MinHeap.prototype.pop = function () {
    var items = this.items;
    var top = items[0];
    var last = items.pop();
    if (items.length) {
      items[0] = last;
      var k = 0;
      for (;;) {
        var l = 2 * k + 1;
        var r = l + 1;
        var m = k;
        if (l < items.length && items[l].f < items[m].f) m = l;
        if (r < items.length && items[r].f < items[m].f) m = r;
        if (m === k) break;
        var t = items[m]; items[m] = items[k]; items[k] = t;
        k = m;
      }
    }
    return top;
  };

  MinHeap.prototype.size = function () {
    return this.items.length;
  };

  /* --- A* optimal solver ---------------------------------------------
     Unit move costs + admissible h ⇒ the first goal popped from the
     open set is a minimum-move solution. Node budget: if exhausted the
     result is reported as 'budget' (no optimality claim).             */

  function solveAStar(bottles, opts) {
    var nodeLimit = (opts && opts.nodeLimit) || 200000;
    var start = cloneBottles(bottles);
    var startKey = stateKey(start);
    var nodes = 0;
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    if (isSolved(start)) {
      return { status: "solved", moves: [], nodes: 0, optimal: true, ms: 0 };
    }

    var open = new MinHeap();
    var bestG = Object.create(null);
    var parents = Object.create(null);
    var states = Object.create(null);

    bestG[startKey] = 0;
    states[startKey] = start;
    open.push({ key: startKey, f: heuristic(start), g: 0 });

    var goalKey = null;

    while (open.size()) {
      var cur = open.pop();
      var ck = cur.key;
      if (cur.g > bestG[ck]) continue;
      var state = states[ck];
      if (isSolved(state)) { goalKey = ck; break; }

      nodes += 1;
      if (nodes > nodeLimit) {
        return { status: "budget", nodes: nodes, optimal: false, ms: now() - t0 };
      }

      var moves = legalMoves(state);
      for (var m = 0; m < moves.length; m += 1) {
        var mv = moves[m];
        applyMove(state, mv);
        var nk = stateKey(state);
        var ng = cur.g + 1;
        if (!(nk in bestG) || ng < bestG[nk]) {
          bestG[nk] = ng;
          states[nk] = cloneBottles(state);
          parents[nk] = { key: ck, move: mv };
          open.push({ key: nk, f: ng + heuristic(state), g: ng });
        }
        undoMove(state, mv);
      }
    }

    if (!goalKey) {
      return { status: "unsolvable", nodes: nodes, optimal: false, ms: now() - t0 };
    }

    var path = [];
    var k = goalKey;
    while (k !== startKey) {
      var p = parents[k];
      path.push(p.move);
      k = p.key;
    }
    path.reverse();
    return { status: "solved", moves: path, nodes: nodes, optimal: true, ms: now() - t0 };

    function now() {
      return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    }
  }

  /* --- BFS reference solver (cross-check, also optimal) -------------- */

  function solveBFS(bottles, opts) {
    var nodeLimit = (opts && opts.nodeLimit) || 200000;
    var start = cloneBottles(bottles);
    var startKey = stateKey(start);
    var nodes = 0;

    if (isSolved(start)) {
      return { status: "solved", moves: [], nodes: 0, optimal: true };
    }

    var queue = [startKey];
    var head = 0;
    var parents = Object.create(null);
    var states = Object.create(null);
    states[startKey] = start;
    parents[startKey] = null;

    while (head < queue.length) {
      var ck = queue[head];
      head += 1;
      var state = states[ck];
      if (isSolved(state)) {
        var path = [];
        var k = ck;
        while (parents[k]) {
          path.push(parents[k].move);
          k = parents[k].key;
        }
        path.reverse();
        return { status: "solved", moves: path, nodes: nodes, optimal: true };
      }
      nodes += 1;
      if (nodes > nodeLimit) {
        return { status: "budget", nodes: nodes, optimal: false };
      }
      var moves = legalMoves(state);
      for (var m = 0; m < moves.length; m += 1) {
        var mv = moves[m];
        applyMove(state, mv);
        var nk = stateKey(state);
        if (!(nk in parents)) {
          parents[nk] = { key: ck, move: mv };
          states[nk] = cloneBottles(state);
          queue.push(nk);
        }
        undoMove(state, mv);
      }
    }
    return { status: "unsolvable", nodes: nodes, optimal: false };
  }

  /* --- greedy fallback (any solution, no optimality claim) ------------ */

  function solveGreedy(bottles, opts) {
    var nodeLimit = (opts && opts.nodeLimit) || 100000;
    var seen = Object.create(null);
    var path = [];
    var nodes = 0;
    var st = cloneBottles(bottles);

    function dfs() {
      if (isSolved(st)) return true;
      var k = stateKey(st);
      if (seen[k]) return false;
      seen[k] = 1;
      nodes += 1;
      if (nodes > nodeLimit) return false;
      var moves = legalMoves(st);
      moves.sort(function (a, b) {
        var ae = st[a.j].length ? 1 : 0;
        var be = st[b.j].length ? 1 : 0;
        if (ae !== be) return be - ae;
        return b.amt - a.amt;
      });
      for (var m = 0; m < moves.length; m += 1) {
        applyMove(st, moves[m]);
        path.push(moves[m]);
        if (dfs()) return true;
        path.pop();
        undoMove(st, moves[m]);
      }
      return false;
    }

    var ok = dfs();
    return { status: ok ? "solved" : "unsolvable", moves: ok ? path.slice() : [], nodes: nodes, optimal: false };
  }

  /* --- structural validation ------------------------------------------ */

  function validateStructure(bottles, opts) {
    var problems = [];
    var colorTotal = opts && opts.colorCount ? opts.colorCount : 0;
    var counts = Object.create(null);
    var empties = 0;
    for (var i = 0; i < bottles.length; i += 1) {
      var b = bottles[i];
      if (b.length > CAPACITY) problems.push("capacity");
      if (!b.length) { empties += 1; continue; }
      for (var u = 0; u < b.length; u += 1) {
        var c = b[u];
        if (typeof c !== "number" || c < 0 || c !== Math.floor(c)) problems.push("value");
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    for (var key in counts) {
      if (counts[key] !== 4) problems.push("count");
      if (colorTotal && key >= colorTotal) problems.push("color-range");
    }
    if (opts) {
      if (opts.empties != null && empties !== opts.empties) problems.push("empties");
      if (opts.bottleCount != null && bottles.length !== opts.bottleCount) problems.push("bottle-count");
      if (colorTotal) {
        for (var c = 0; c < colorTotal; c += 1) {
          if (counts[c] !== 4) problems.push("count");
        }
      }
      if (opts.requireNoDone) {
        for (i = 0; i < bottles.length; i += 1) {
          if (isDone(bottles[i])) problems.push("pre-done");
        }
      }
      if (opts.requireNotSolved && isSolved(bottles)) problems.push("solved");
    }
    return problems;
  }

  /* --- difficulty metrics ---------------------------------------------- */

  function metrics(bottles) {
    var frag = 0;
    var bottoms = Object.create(null);
    var boundaries = 0;
    var colors = Object.create(null);
    for (var i = 0; i < bottles.length; i += 1) {
      var b = bottles[i];
      for (var u = 1; u < b.length; u += 1) {
        if (b[u] !== b[u - 1]) boundaries += 1;
      }
      if (b.length) {
        bottoms[b[0]] = (bottoms[b[0]] || 0) + 1;
      }
      for (u = 0; u < b.length; u += 1) {
        colors[b[u]] = true;
      }
    }
    var colorList = Object.keys(colors);
    for (i = 0; i < colorList.length; i += 1) {
      var c = colorList[i];
      var k = 0;
      for (var j = 0; j < bottles.length; j += 1) {
        if (bottles[j].indexOf(Number(c)) >= 0) k += 1;
      }
      if (k > 1) frag += k - 1;
    }
    return {
      colorCount: colorList.length,
      fragmentation: frag,
      boundaries: boundaries,
      heuristic: heuristic(bottles),
      legalMoves: legalMoves(bottles).length
    };
  }

  var WSSolver = {
    CAPACITY: CAPACITY,
    getTopColor: getTopColor,
    getTopRunLength: getTopRunLength,
    getFreeSpace: getFreeSpace,
    canPour: canPour,
    getPourAmount: getPourAmount,
    applyPour: applyPour,
    isDone: isDone,
    isSolved: isSolved,
    cloneBottles: cloneBottles,
    stateKey: stateKey,
    heuristic: heuristic,
    legalMoves: legalMoves,
    applyMove: applyMove,
    undoMove: undoMove,
    solveAStar: solveAStar,
    solveBFS: solveBFS,
    solveGreedy: solveGreedy,
    validateStructure: validateStructure,
    metrics: metrics
  };

  global.WSSolver = WSSolver;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = WSSolver;
  }
})(typeof window !== "undefined" ? window : globalThis);
