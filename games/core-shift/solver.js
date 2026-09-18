/* ------------------------------------------------------------------
   Core Shift — push-state solver (Node-testable, no DOM).

   Searches over abstract states:
     state  = (sorted core positions, canonical player cell)
     player canonical cell = smallest index in the player's reachable
     region, so all equivalent robot placements collapse into one node.

   Successors: every legal push from every core.  States landing a
   core on a static dead square are pruned.  Plain BFS => push-optimal
   solutions for the levels it solves (player walk steps not counted).
   ------------------------------------------------------------------ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"));
  } else {
    root.CSSolver = factory(root.CSEngine);
  }
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  function key(coresSorted, playerRoot) {
    return coresSorted.join(",") + "|" + playerRoot;
  }

  /* Solves lv.  Returns
     { solved, pushes, dirs:[..], nodes }
     or { solved:false, nodes } when exhausted.                       */
  function solve(lv, opts) {
    opts = opts || {};
    var maxNodes = opts.maxNodes || 400000;
    var dead = E.deadSquares(lv);
    var deadLookup = dead.alive;
    var w = lv.w;

    var start = E.initialState(lv);
    var startReach = E.reachability(lv, start);
    var startRoot = firstTrue(startReach);

    var startKey = key(start.cores.slice().sort(function (a, b) {
      return a - b;
    }), startRoot);

    var visited = {};
    visited[startKey] = true;

    /* node: {cores, reach(root already applied via parent walk), parent,
              pushDir, pushCoreFrom} — reach arrays are recomputed lazily
              via parent chain?  No: store reach bitmap per node (levels
              are tiny, memory is fine).                              */
    var queue = [
      {
        cores: start.cores.slice(),
        reach: startReach,
        parent: null,
        dir: null,
        coreFrom: -1
      }
    ];
    var head = 0;
    var nodes = 0;

    while (head < queue.length) {
      var node = queue[head];
      head += 1;
      nodes += 1;
      if (nodes > maxNodes) {
        return { solved: false, nodes: nodes, reason: "node limit" };
      }

      if (E.isSolved(lv, { cores: node.cores })) {
        var dirs = [];
        var n = node;
        while (n.parent) {
          dirs.push(n.dir);
          n = n.parent;
        }
        dirs.reverse();
        return { solved: true, pushes: dirs.length, dirs: dirs, nodes: nodes };
      }

      var st = { cores: node.cores };
      for (var ci = 0; ci < node.cores.length; ci += 1) {
        var core = node.cores[ci];
        for (var k = 0; k < 4; k += 1) {
          var dir = E.DIR_NAMES[k];
          var d = E.DIRS[dir];
          var from = core;
          var to = E.neighbor(lv, core, dir);
          var stand = E.neighbor(lv, core, opposite(dir));
          if (to < 0 || stand < 0) continue;
          if (lv.walls[to] || hasCore(node.cores, to)) continue;
          if (deadLookup[to] === 0 && !E.isDock(lv, to)) continue; /* prune */
          if (!node.reach[stand]) continue; /* robot must reach pushing side */

          var newCores = node.cores.slice();
          newCores[ci] = to;
          var st2 = { cores: newCores };
          /* robot ends where the core was */
          st2.player = from;
          var reach2 = E.reachability(lv, st2);
          var root2 = firstTrue(reach2);
          var kk = key(newCores.slice().sort(function (a, b) {
            return a - b;
          }), root2);
          if (visited[kk]) continue;
          visited[kk] = true;
          queue.push({
            cores: newCores,
            reach: reach2,
            parent: node,
            dir: dir,
            coreFrom: from
          });
        }
      }
    }
    return { solved: false, nodes: nodes, reason: "exhausted" };
  }

  function hasCore(cores, i) {
    return cores.indexOf(i) >= 0;
  }
  function opposite(dir) {
    return { up: "down", down: "up", left: "right", right: "left" }[dir];
  }
  function firstTrue(arr) {
    for (var i = 0; i < arr.length; i += 1) if (arr[i]) return i;
    return -1;
  }

  return { solve: solve };
});
