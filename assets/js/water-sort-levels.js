/* ------------------------------------------------------------------
   Water Sort — level data + internal validation solver (randolf.dev)
   Bottle arrays are indexed bottom (0) → top (last).
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var CAPACITY = 4;

  var LEVELS = [
    [[2, 0, 0, 2], [1, 1, 0, 1], [1, 2, 2, 0], [], []],
    [[1, 0, 2, 1], [0, 0, 2, 2], [1, 2, 0, 1], [], []],
    [[1, 2, 3, 0], [1, 1, 2, 2], [0, 3, 3, 1], [0, 0, 2, 3], [], []],
    [[1, 2, 0, 2], [0, 3, 1, 3], [0, 1, 2, 3], [0, 1, 3, 2], [], []],
    [[3, 0, 2, 0], [0, 3, 2, 1], [3, 2, 1, 0], [3, 1, 1, 2], [], []],
    [[2, 3, 2, 3], [1, 0, 1, 4], [0, 4, 3, 4], [0, 2, 2, 4], [3, 0, 1, 1], [], []],
    [[4, 2, 3, 1], [1, 1, 0, 1], [4, 2, 2, 3], [0, 3, 0, 4], [0, 3, 4, 2], [], []],
    [[1, 4, 0, 3], [4, 0, 1, 1], [3, 2, 2, 3], [0, 4, 4, 1], [3, 2, 0, 2], [], []],
    [[4, 0, 1, 4], [3, 3, 2, 0], [0, 1, 2, 2], [4, 3, 3, 4], [2, 1, 1, 0], [], []],
    [[3, 1, 2, 3], [3, 4, 4, 1], [1, 3, 2, 0], [0, 4, 4, 2], [0, 1, 2, 0], [], []],
    [[5, 4, 5, 0], [1, 1, 0, 5], [0, 1, 3, 3], [0, 2, 3, 2], [4, 1, 4, 3], [2, 2, 5, 4], [], []],
    [[3, 2, 2, 4], [5, 5, 0, 3], [1, 2, 1, 3], [4, 0, 2, 3], [5, 0, 4, 5], [1, 1, 4, 0], [], []],
    [[5, 5, 1, 1], [2, 5, 1, 2], [4, 4, 0, 3], [3, 3, 2, 4], [0, 3, 0, 4], [1, 2, 5, 0], [], []],
    [[2, 0, 3, 5], [2, 4, 3, 5], [0, 1, 4, 0], [2, 3, 0, 5], [5, 3, 1, 1], [1, 2, 4, 4], [], []],
    [[4, 4, 5, 4], [3, 2, 0, 2], [0, 4, 0, 3], [3, 1, 2, 1], [1, 5, 5, 3], [5, 1, 2, 0], [], []],
    [[3, 1, 3, 0], [2, 4, 1, 4], [2, 0, 4, 3], [0, 1, 4, 1], [2, 5, 5, 5], [2, 0, 3, 5], [], []],
    [[4, 1, 4, 3], [5, 6, 6, 6], [4, 2, 4, 2], [1, 0, 3, 0], [5, 6, 0, 3], [3, 1, 1, 2], [2, 0, 5, 5], [], []],
    [[4, 3, 0, 2], [3, 4, 3, 6], [1, 1, 0, 2], [4, 2, 3, 1], [4, 0, 5, 5], [5, 6, 0, 1], [2, 6, 5, 6], [], []],
    [[6, 6, 6, 5], [4, 3, 1, 0], [3, 2, 4, 0], [3, 5, 2, 1], [5, 4, 0, 5], [4, 0, 6, 2], [1, 2, 1, 3], [], []],
    [[1, 4, 0, 4], [6, 5, 3, 2], [1, 6, 5, 3], [2, 5, 6, 1], [0, 4, 3, 0], [2, 2, 6, 4], [5, 0, 3, 1], [], []],
    [[2, 7, 7, 4], [2, 3, 7, 0], [6, 7, 0, 6], [5, 0, 5, 6], [3, 4, 1, 1], [3, 5, 2, 0], [2, 3, 1, 5], [6, 1, 4, 4], [], []],
    [[3, 2, 0, 1], [6, 1, 7, 4], [7, 3, 4, 5], [6, 1, 1, 5], [0, 2, 4, 0], [6, 5, 2, 4], [6, 0, 3, 2], [3, 7, 5, 7], [], []],
    [[5, 1, 4, 7], [1, 3, 5, 2], [3, 5, 2, 2], [5, 7, 3, 7], [0, 6, 0, 6], [1, 6, 0, 4], [7, 2, 3, 0], [4, 6, 4, 1], [], []],
    [[0, 4, 2, 3], [4, 6, 5, 7], [1, 5, 4, 7], [2, 1, 6, 0], [0, 5, 3, 2], [5, 1, 1, 3], [7, 6, 2, 7], [6, 3, 0, 4], [], []]
  ];

  function isSolved(bottles) {
    for (var i = 0; i < bottles.length; i++) {
      var b = bottles[i];
      if (!b.length) continue;
      if (b.length !== CAPACITY) return false;
      for (var u = 1; u < b.length; u++) {
        if (b[u] !== b[0]) return false;
      }
    }
    return true;
  }

  function serialize(bottles) {
    return bottles.map(function (b) { return b.join("."); }).sort().join("|");
  }

  function legalMoves(bottles) {
    var moves = [];
    var firstEmpty = -1;
    var i;
    for (i = 0; i < bottles.length; i++) {
      if (!bottles[i].length) { firstEmpty = i; break; }
    }
    for (i = 0; i < bottles.length; i++) {
      var src = bottles[i];
      if (!src.length) continue;
      var col = src[src.length - 1];
      var run = 1;
      while (run < src.length && src[src.length - 1 - run] === col) run++;
      if (run === src.length && src.length === CAPACITY) continue;
      for (var j = 0; j < bottles.length; j++) {
        if (i === j) continue;
        var dst = bottles[j];
        var free = CAPACITY - dst.length;
        if (!free) continue;
        if (!dst.length) {
          if (run === src.length) continue;
          if (j !== firstEmpty) continue;
        } else if (dst[dst.length - 1] !== col) {
          continue;
        }
        moves.push({ i: i, j: j, amt: Math.min(run, free) });
      }
    }
    return moves;
  }

  function solve(bottles, nodeLimit) {
    var limit = nodeLimit || 300000;
    var seen = Object.create(null);
    var path = [];
    var nodes = 0;
    var aborted = false;
    var st = bottles.map(function (b) { return b.slice(); });

    function dfs() {
      if (isSolved(st)) return true;
      var k = serialize(st);
      if (seen[k]) return false;
      seen[k] = 1;
      nodes += 1;
      if (nodes > limit) { aborted = true; return false; }
      var moves = legalMoves(st);
      moves.sort(function (a, b) {
        var ae = st[a.j].length ? 1 : 0;
        var be = st[b.j].length ? 1 : 0;
        if (ae !== be) return be - ae;
        return b.amt - a.amt;
      });
      for (var m = 0; m < moves.length; m++) {
        var mv = moves[m];
        var src = st[mv.i];
        var dst = st[mv.j];
        for (var u = 0; u < mv.amt; u++) dst.push(src.pop());
        path.push(mv);
        if (dfs()) return true;
        path.pop();
        for (var v = 0; v < mv.amt; v++) src.push(dst.pop());
      }
      return false;
    }

    var ok = dfs();
    return { solvable: ok, moves: path.slice(), nodes: nodes, aborted: aborted };
  }

  function colorCount(levelIndex) {
    var counts = Object.create(null);
    var bottles = LEVELS[levelIndex];
    for (var i = 0; i < bottles.length; i++) {
      for (var u = 0; u < bottles[i].length; u++) {
        counts[bottles[i][u]] = true;
      }
    }
    return Object.keys(counts).length;
  }

  function validateLevel(index) {
    var bottles = LEVELS[index];
    var n = colorCount(index);
    var counts = Object.create(null);
    var empties = 0;
    var problems = [];
    var i, u;

    for (i = 0; i < bottles.length; i++) {
      var b = bottles[i];
      if (b.length > CAPACITY) problems.push("bottle " + i + " over capacity");
      if (!b.length) empties += 1;
      for (u = 0; u < b.length; u++) {
        var c = b[u];
        if (c < 0 || c >= n) problems.push("bottle " + i + " has unknown color " + c);
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    for (i = 0; i < n; i++) {
      if (counts[i] !== 4) problems.push("color " + i + " appears " + (counts[i] || 0) + " times");
    }
    if (empties !== 2) problems.push(empties + " empty bottles, expected 2");
    if (isSolved(bottles)) problems.push("level already solved");
    if (!problems.length) {
      var res = solve(bottles, 500000);
      if (!res.solvable) problems.push("solver found no solution");
      if (res.aborted) problems.push("solver node limit hit");
      return {
        level: index + 1,
        colors: n,
        bottles: bottles.length,
        valid: problems.length === 0,
        solvable: res.solvable,
        solutionLength: res.moves.length,
        nodes: res.nodes,
        problems: problems
      };
    }
    return {
      level: index + 1,
      colors: n,
      bottles: bottles.length,
      valid: false,
      solvable: false,
      solutionLength: 0,
      nodes: 0,
      problems: problems
    };
  }

  function validateAll() {
    var report = [];
    for (var i = 0; i < LEVELS.length; i++) {
      report.push(validateLevel(i));
    }
    return report;
  }

  var WSLevels = {
    CAPACITY: CAPACITY,
    LEVELS: LEVELS,
    colorCount: colorCount,
    isSolved: isSolved,
    solve: solve,
    validateLevel: validateLevel,
    validateAll: validateAll
  };

  global.WSLevels = WSLevels;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = WSLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
