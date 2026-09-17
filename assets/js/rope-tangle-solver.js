/* ------------------------------------------------------------------
   Rope Tangle — solver (randolf.dev)

   Bounded breadth-first search over endpoint assignments for an exact
   shortest solution, with a best-first fallback when the state space
   explodes (Hard campaign). Evaluation is incremental: moving one
   endpoint only re-tests that rope against the others, and rope-pair
   crossing results are memoised under numeric keys.

   Exposed as window.RopeTangleSolver.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  function solve(pts, ropes0, opts) {
    opts = opts || {};
    var nodeCap = opts.nodeCap || 50000;
    var timeCap = opts.timeCap || 2000;
    var Gen = window.RopeTangleGen;
    var R = ropes0.length;
    var P = pts.length;
    var t0 = Date.now();

    var polyCache = new Map();
    var pairCache = new Map();

    function enc(a, b) {
      return a < b ? a * 32 + b : b * 32 + a;
    }

    function ropePoly(r, e) {
      var key = r * 1024 + e;
      var v = polyCache.get(key);
      if (!v) {
        var a = (e / 32) | 0;
        var b = e % 32;
        var g = Gen.buildRopeGeometry(pts[a][0], pts[a][1], pts[b][0], pts[b][1], r);
        v = Gen.sampleRopePath(g, 26);
        polyCache.set(key, v);
      }
      return v;
    }

    function pairCross(r1, e1, r2, e2) {
      var key;
      if (r1 < r2) {
        key = ((r1 * 8 + r2) * 1024 + e1) * 1024 + e2;
      } else {
        key = ((r2 * 8 + r1) * 1024 + e2) * 1024 + e1;
      }
      var v = pairCache.get(key);
      if (v === undefined) {
        v = Gen.polysIntersect(ropePoly(r1, e1), ropePoly(r2, e2)) ? 1 : 0;
        if (pairCache.size > 400000) pairCache.clear();
        pairCache.set(key, v);
      }
      return v;
    }

    function evalFull(ropes) {
      var h = 0;
      for (var i = 0; i < R; i += 1) {
        var ei = enc(ropes[i][0], ropes[i][1]);
        for (var j = i + 1; j < R; j += 1) {
          h += pairCross(i, ei, j, enc(ropes[j][0], ropes[j][1]));
        }
      }
      return h;
    }

    /* crossing contribution of one rope against all others */
    function ropeSum(ropes, r, e) {
      var s = 0;
      for (var j = 0; j < R; j += 1) {
        if (j === r) continue;
        s += pairCross(r, e, j, enc(ropes[j][0], ropes[j][1]));
      }
      return s;
    }

    function stateKey(ropes) {
      var s = "";
      for (var r = 0; r < R; r += 1) {
        var a = ropes[r][0];
        var b = ropes[r][1];
        s += (a < b ? a * 32 + b : b * 32 + a) + ";";
      }
      return s;
    }

    function emptiesOf(ropes) {
      var occ = new Array(P).fill(false);
      for (var r = 0; r < R; r += 1) {
        occ[ropes[r][0]] = true;
        occ[ropes[r][1]] = true;
      }
      var out = [];
      for (var p = 0; p < P; p += 1) if (!occ[p]) out.push(p);
      return out;
    }

    function cloneRopes(ropes) {
      var out = new Array(R);
      for (var r = 0; r < R; r += 1) out[r] = ropes[r].slice();
      return out;
    }

    var start = cloneRopes(ropes0);
    var nodes = 1;
    var startH = evalFull(start);

    if (startH === 0) {
      return { found: true, depth: 0, nodes: 1, exact: true };
    }

    /* --- bounded BFS (exact shortest) ---------------------------------- */

    var visited = new Set([stateKey(start)]);
    var frontier = [{ ropes: start, h: startH }];
    var depth = 0;
    var capped = false;

    while (frontier.length && !capped) {
      depth += 1;
      var next = [];
      for (var f = 0; f < frontier.length; f += 1) {
        if ((f & 255) === 0 && Date.now() - t0 > timeCap) {
          capped = true;
          break;
        }
        var node = frontier[f];
        var em = emptiesOf(node.ropes);
        for (var r = 0; r < R; r += 1) {
          var oldE = enc(node.ropes[r][0], node.ropes[r][1]);
          for (var e = 0; e < 2; e += 1) {
            for (var q = 0; q < em.length; q += 1) {
              var child = cloneRopes(node.ropes);
              var oldPeg = child[r][e];
              child[r][e] = em[q];
              var ck = stateKey(child);
              if (visited.has(ck)) continue;
              visited.add(ck);
              nodes += 1;
              if (nodes > nodeCap || Date.now() - t0 > timeCap) {
                capped = true;
                break;
              }
              var newE = enc(child[r][0], child[r][1]);
              var ch = node.h - ropeSum(node.ropes, r, oldE) + ropeSum(child, r, newE);
              if (ch === 0) {
                return { found: true, depth: depth, nodes: nodes, exact: true };
              }
              next.push({ ropes: child, h: ch });
            }
            if (capped) break;
          }
          if (capped) break;
        }
        if (capped) break;
      }
      frontier = next;
    }

    /* --- best-first fallback (valid, near-shortest) ---------------------- */

    var heap = [];
    var heapNodes = 0;
    var visited2 = new Set();

    function heapPush(item) {
      heap.push(item);
      var i = heap.length - 1;
      while (i > 0) {
        var par = (i - 1) >> 1;
        if (heap[par].f <= heap[i].f) break;
        var t = heap[par];
        heap[par] = heap[i];
        heap[i] = t;
        i = par;
      }
    }

    function heapPop() {
      var top = heap[0];
      var last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var i = 0;
        for (;;) {
          var l = i * 2 + 1;
          var rr = l + 1;
          var m = i;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (rr < heap.length && heap[rr].f < heap[m].f) m = rr;
          if (m === i) break;
          var t2 = heap[m];
          heap[m] = heap[i];
          heap[i] = t2;
          i = m;
        }
      }
      return top;
    }

    heapPush({ f: startH * 1.3, g: 0, ropes: start, h: startH });
    visited2.add(stateKey(start));

    while (heap.length) {
      if (Date.now() - t0 > timeCap * 1.6) break;
      var hnode = heapPop();
      heapNodes += 1;
      if (heapNodes > nodeCap) break;
      if (hnode.h === 0) {
        return {
          found: true,
          depth: hnode.g,
          nodes: nodes + heapNodes,
          exact: false
        };
      }
      var em2 = emptiesOf(hnode.ropes);
      for (var r2 = 0; r2 < R; r2 += 1) {
        var oldE2 = enc(hnode.ropes[r2][0], hnode.ropes[r2][1]);
        for (var e2 = 0; e2 < 2; e2 += 1) {
          for (var q2 = 0; q2 < em2.length; q2 += 1) {
            var child2 = cloneRopes(hnode.ropes);
            child2[r2][e2] = em2[q2];
            var ck2 = stateKey(child2);
            if (visited2.has(ck2)) continue;
            visited2.add(ck2);
            var h2 = hnode.h - ropeSum(hnode.ropes, r2, oldE2) + ropeSum(child2, r2, enc(child2[r2][0], child2[r2][1]));
            heapPush({ f: hnode.g + 1 + h2 * 1.3, g: hnode.g + 1, ropes: child2, h: h2 });
          }
        }
      }
    }

    return { found: false, nodes: nodes + heapNodes, exact: false, capped: true };
  }

  window.RopeTangleSolver = { solve: solve };
})();
