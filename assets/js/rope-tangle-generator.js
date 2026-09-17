/* ------------------------------------------------------------------
   Rope Tangle — generator core (randolf.dev)
   Plain browser game. No dependencies.

   Structure:
     - rng        : seeded, deterministic (xmur3 + mulberry32)
     - geometry   : quadratic rope curves + polyline sampling
     - crossings  : segment intersection + clustering
     - rules      : pure endpoint-move helpers
     - layouts    : structured peg layout families
     - generation : solved assignment -> scramble -> evaluate -> accept
   Exposed as window.RopeTangleGen. Solver lives in rope-tangle-solver.js.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var GEN_VERSION = 1;
  var VB_W = 100;
  var VB_H = 74;
  var MIN_PEG_DIST = 9.5;

  /* --- seeded rng ------------------------------------------------- */

  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i += 1) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seedStr) {
    return mulberry32(xmur3(String(seedStr))());
  }

  /* --- geometry ---------------------------------------------------- */

  function bendFactor(id) {
    return (id % 2 === 0 ? 1 : -1) * (0.15 + (id % 3) * 0.02);
  }

  function buildRopeGeometry(ax, ay, bx, by, id) {
    var dx = bx - ax;
    var dy = by - ay;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) {
      dx = 1;
      dy = 0;
      dist = 1;
    }
    var nx = -dy / dist;
    var ny = dx / dist;
    var bend = dist * bendFactor(id);
    if (bend > 12) bend = 12;
    if (bend < -12) bend = -12;
    return {
      ax: ax,
      ay: ay,
      bx: bx,
      by: by,
      cx: (ax + bx) / 2 + nx * bend,
      cy: (ay + by) / 2 + ny * bend
    };
  }

  function quadPoint(g, t) {
    var mt = 1 - t;
    return {
      x: mt * mt * g.ax + 2 * mt * t * g.cx + t * t * g.bx,
      y: mt * mt * g.ay + 2 * mt * t * g.cy + t * t * g.by
    };
  }

  function sampleRopePath(g, n) {
    n = n || 26;
    var pts = new Array(n + 1);
    for (var i = 0; i <= n; i += 1) {
      pts[i] = quadPoint(g, i / n);
    }
    return pts;
  }

  /* --- crossings ----------------------------------------------------- */

  function segmentIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    var d1x = x2 - x1;
    var d1y = y2 - y1;
    var d2x = x4 - x3;
    var d2y = y4 - y3;
    var den = d1x * d2y - d1y * d2x;
    if (den > -1e-12 && den < 1e-12) return null;
    var ex = x3 - x1;
    var ey = y3 - y1;
    var t = (ex * d2y - ey * d2x) / den;
    var u = (ex * d1y - ey * d1x) / den;
    if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
    return { x: x1 + t * d1x, y: y1 + t * d1y };
  }

  function polysIntersect(A, B) {
    for (var a = 0; a < A.length - 1; a += 1) {
      for (var b = 0; b < B.length - 1; b += 1) {
        if (
          segmentIntersection(
            A[a].x, A[a].y, A[a + 1].x, A[a + 1].y,
            B[b].x, B[b].y, B[b + 1].x, B[b + 1].y
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function clusterHits(hits, cd) {
    var byPair = {};
    var k, h, key;
    for (k = 0; k < hits.length; k += 1) {
      h = hits[k];
      key = h.i + "_" + h.j;
      if (!byPair[key]) byPair[key] = [];
      byPair[key].push(h);
    }
    var clusters = [];
    for (key in byPair) {
      var list = byPair[key];
      var used = new Array(list.length).fill(false);
      for (k = 0; k < list.length; k += 1) {
        if (used[k]) continue;
        var sx = 0, sy = 0, count = 0, minAng = 180;
        var stack = [k];
        used[k] = true;
        while (stack.length) {
          var idx = stack.pop();
          var cur = list[idx];
          sx += cur.x;
          sy += cur.y;
          count += 1;
          if (cur.angle < minAng) minAng = cur.angle;
          for (var m = 0; m < list.length; m += 1) {
            if (used[m]) continue;
            var dx = list[m].x - cur.x;
            var dy = list[m].y - cur.y;
            if (dx * dx + dy * dy <= cd * cd) {
              used[m] = true;
              stack.push(m);
            }
          }
        }
        clusters.push({
          i: list[k].i,
          j: list[k].j,
          x: sx / count,
          y: sy / count,
          angle: minAng
        });
      }
    }
    clusters.sort(function (a, b) {
      return a.i - b.i || a.j - b.j || a.x - b.x;
    });
    return clusters;
  }

  function findRopeIntersections(polys, clusterDist) {
    var hits = [];
    var i, j, a, b, hit;
    for (i = 0; i < polys.length; i += 1) {
      for (j = i + 1; j < polys.length; j += 1) {
        var A = polys[i];
        var B = polys[j];
        for (a = 0; a < A.length - 1; a += 1) {
          for (b = 0; b < B.length - 1; b += 1) {
            hit = segmentIntersection(
              A[a].x, A[a].y, A[a + 1].x, A[a + 1].y,
              B[b].x, B[b].y, B[b + 1].x, B[b + 1].y
            );
            if (hit) {
              var a1x = A[a + 1].x - A[a].x;
              var a1y = A[a + 1].y - A[a].y;
              var b1x = B[b + 1].x - B[b].x;
              var b1y = B[b + 1].y - B[b].y;
              var la = Math.sqrt(a1x * a1x + a1y * a1y) || 1;
              var lb = Math.sqrt(b1x * b1x + b1y * b1y) || 1;
              var dot = Math.abs((a1x * b1x + a1y * b1y) / (la * lb));
              if (dot > 1) dot = 1;
              hits.push({
                i: i,
                j: j,
                x: hit.x,
                y: hit.y,
                angle: (Math.acos(dot) * 180) / Math.PI
              });
            }
          }
        }
      }
    }
    return clusterHits(hits, clusterDist == null ? 3.2 : clusterDist);
  }

  function countIntersections(polys) {
    return findRopeIntersections(polys).length;
  }

  /* --- rules --------------------------------------------------------- */

  function cloneState(ropes) {
    return ropes.map(function (r) { return r.slice(); });
  }

  function getOccupancy(ropes, pegCount) {
    var occ = new Array(pegCount).fill(false);
    for (var r = 0; r < ropes.length; r += 1) {
      occ[ropes[r][0]] = true;
      occ[ropes[r][1]] = true;
    }
    return occ;
  }

  function getEmptyPegs(ropes, pegCount) {
    var occ = getOccupancy(ropes, pegCount);
    var out = [];
    for (var p = 0; p < pegCount; p += 1) {
      if (!occ[p]) out.push(p);
    }
    return out;
  }

  function isPegOccupied(ropes, pegIdx) {
    for (var r = 0; r < ropes.length; r += 1) {
      if (ropes[r][0] === pegIdx || ropes[r][1] === pegIdx) return true;
    }
    return false;
  }

  function canMoveEndpoint(ropes, ropeIdx, endIdx, pegIdx) {
    if (ropeIdx < 0 || ropeIdx >= ropes.length) return false;
    if (endIdx !== 0 && endIdx !== 1) return false;
    if (typeof pegIdx !== "number") return false;
    if (ropes[ropeIdx][endIdx] === pegIdx) return false;
    if (isPegOccupied(ropes, pegIdx)) return false;
    return true;
  }

  function applyEndpointMove(ropes, ropeIdx, endIdx, pegIdx) {
    var next = cloneState(ropes);
    next[ropeIdx][endIdx] = pegIdx;
    return next;
  }

  function isSolved(ropes, pegs) {
    return countIntersections(ropesToPolys(ropes, pegs)) === 0;
  }

  function ropesToPolys(ropes, pegs) {
    var polys = [];
    for (var i = 0; i < ropes.length; i += 1) {
      var g = buildRopeGeometry(
        pegs[ropes[i][0]][0], pegs[ropes[i][0]][1],
        pegs[ropes[i][1]][0], pegs[ropes[i][1]][1],
        i
      );
      polys.push(sampleRopePath(g, 26));
    }
    return polys;
  }

  /* --- peg layouts ---------------------------------------------------- */

  function distribute(n, rows) {
    var base = Math.floor(n / rows);
    var extra = n % rows;
    var counts = [];
    for (var r = 0; r < rows; r += 1) counts.push(base + (r < extra ? 1 : 0));
    return counts;
  }

  function minPairDist(pts) {
    var min = Infinity;
    for (var i = 0; i < pts.length; i += 1) {
      for (var j = i + 1; j < pts.length; j += 1) {
        var dx = pts[i][0] - pts[j][0];
        var dy = pts[i][1] - pts[j][1];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < min) min = d;
      }
    }
    return min;
  }

  function withJitter(rng, base, amp) {
    return base.map(function (p) {
      return [p[0] + (rng() * 2 - 1) * amp, p[1] + (rng() * 2 - 1) * amp];
    });
  }

  function settleJitter(rng, base, amp) {
    var cur = withJitter(rng, base, amp);
    for (var t = 0; t < 24; t += 1) {
      if (minPairDist(cur) >= MIN_PEG_DIST) return cur;
      cur = withJitter(rng, base, amp);
    }
    return cur;
  }  function layoutRows(rng, n) {
    var rows = n <= 8 ? 2 : n <= 14 ? 3 : 4;
    var x0 = 16, x1 = 84, y0 = 17, y1 = VB_H - 17;
    var counts = distribute(n, rows);
    var maxCols = Math.max.apply(null, counts);
    var step = (x1 - x0) / (maxCols - 0.5);
    var half = step / 2;
    var base = [];
    for (var r = 0; r < rows; r += 1) {
      var y = y0 + (y1 - y0) * (r / (rows - 1));
      var off = r % 2 === 1 ? half : 0;
      for (var c = 0; c < counts[r]; c += 1) {
        base.push([x0 + off + c * step, y]);
      }
    }
    return { family: "rows", base: base };
  }

  function layoutArcs(rng, n) {
    var top = Math.ceil(n / 2);
    var bot = n - top;
    var x0 = 16, x1 = 84;
    var base = [];
    var i, t, x, y;
    for (i = 0; i < top; i += 1) {
      t = top === 1 ? 0.5 : 0.08 + 0.84 * (i / (top - 1));
      x = x0 + (x1 - x0) * t;
      y = 23 - 9 * Math.sin(Math.PI * t);
      base.push([x, y]);
    }
    for (i = 0; i < bot; i += 1) {
      t = bot === 1 ? 0.5 : 0.08 + 0.84 * (i / (bot - 1));
      x = x0 + (x1 - x0) * t;
      y = VB_H - 23 + 9 * Math.sin(Math.PI * t);
      base.push([x, y]);
    }
    return { family: "arcs", base: base };
  }

  function layoutDiamond(rng, n) {
    var cx = 50, cy = VB_H / 2;
    var vx = [cx, cx + 33, cx, cx - 33];
    var vy = [cy - 21, cy, cy + 21, cy];
    var side = Math.sqrt(33 * 33 + 21 * 21);
    var perim = side * 4;
    var base = [];
    for (var k = 0; k < n; k += 1) {
      var s = ((k + 0.5) / n) * perim;
      var e = Math.floor(s / side);
      var f = (s - e * side) / side;
      var a = e % 4;
      var b = (e + 1) % 4;
      base.push([
        vx[a] + (vx[b] - vx[a]) * f,
        vy[a] + (vy[b] - vy[a]) * f
      ]);
    }
    return { family: "diamond", base: base };
  }

  /* stretch a layout to fill the usable board area so puzzles never
     leave large dead zones, whatever the family or peg count */
  function normalizePts(pts) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i += 1) {
      if (pts[i][0] < minX) minX = pts[i][0];
      if (pts[i][0] > maxX) maxX = pts[i][0];
      if (pts[i][1] < minY) minY = pts[i][1];
      if (pts[i][1] > maxY) maxY = pts[i][1];
    }
    var tx0 = 14, tx1 = 86, ty0 = 15, ty1 = VB_H - 15;
    return pts.map(function (p) {
      return [
        tx0 + (tx1 - tx0) * (maxX === minX ? 0.5 : (p[0] - minX) / (maxX - minX)),
        ty0 + (ty1 - ty0) * (maxY === minY ? 0.5 : (p[1] - minY) / (maxY - minY))
      ];
    });
  }

  function generatePegLayout(rng, n) {
    var fams = ["rows"];
    if (n <= 12) {
      fams.push("arcs", "diamond");
      if (n <= 10) fams.push("rows");
    }
    var fam = fams[Math.floor(rng() * fams.length)];
    var layout;
    if (fam === "arcs") layout = layoutArcs(rng, n);
    else if (fam === "diamond") layout = layoutDiamond(rng, n);
    else layout = layoutRows(rng, n);
    var pts = settleJitter(rng, normalizePts(layout.base), 1.6);
    /* safety net: layouts that cannot keep pegs apart fall back to rows */
    if (minPairDist(pts) < MIN_PEG_DIST - 2) {
      layout = layoutRows(rng, n);
      pts = settleJitter(rng, normalizePts(layout.base), 1.6);
    }
    return { family: layout.family, pts: pts };
  }

  /* --- solved assignment ------------------------------------------------ */

  function pickEmptyPegs(rng, pts) {
    var best = null;
    var bestD = -1;
    for (var t = 0; t < 30; t += 1) {
      var i = Math.floor(rng() * pts.length);
      var j = Math.floor(rng() * pts.length);
      while (j === i) j = Math.floor(rng() * pts.length);
      var dx = pts[i][0] - pts[j][0];
      var dy = pts[i][1] - pts[j][1];
      var d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        best = [i, j];
        if (d > 45 * 45) break;
      }
    }
    return best;
  }

  function pairConsecutive(order) {
    var ropes = [];
    for (var i = 0; i + 1 < order.length; i += 2) {
      ropes.push([order[i], order[i + 1]]);
    }
    return ropes;
  }

  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function generateSolvedAssignment(rng, pts, ropeCount) {
    var empties = pickEmptyPegs(rng, pts);
    var occ = [];
    for (var p = 0; p < pts.length; p += 1) {
      if (p !== empties[0] && p !== empties[1]) occ.push(p);
    }
    var tries = [];
    var byX = occ.slice().sort(function (a, b) {
      return pts[a][0] - pts[b][0] || pts[a][1] - pts[b][1];
    });
    tries.push(pairConsecutive(byX));
    var byY = occ.slice().sort(function (a, b) {
      return pts[a][1] - pts[b][1] || pts[a][0] - pts[b][0];
    });
    tries.push(pairConsecutive(byY));
    for (var t = 0; t < 120; t += 1) {
      tries.push(pairConsecutive(shuffled(occ, rng)));
    }
    for (t = 0; t < tries.length; t += 1) {
      var polys = [];
      for (var i = 0; i < tries[t].length; i += 1) {
        var g = buildRopeGeometry(
          pts[tries[t][i][0]][0], pts[tries[t][i][0]][1],
          pts[tries[t][i][1]][0], pts[tries[t][i][1]][1],
          i
        );
        polys.push(sampleRopePath(g, 26));
      }
      if (countIntersections(polys) === 0) {
        return { ropes: tries[t], empties: empties };
      }
    }
    return null;
  }

  /* --- scramble ----------------------------------------------------------- */

  function scramble(rng, ropes, pegCount, k) {
    var cur = cloneState(ropes);
    var moves = [];
    var last = null;
    for (var m = 0; m < k; m += 1) {
      var empties = getEmptyPegs(cur, pegCount);
      var cands = [];
      for (var r = 0; r < cur.length; r += 1) {
        for (var e = 0; e < 2; e += 1) {
          for (var q = 0; q < empties.length; q += 1) {
            if (last && last.r === r && last.e === e && last.from === empties[q]) continue;
            cands.push([r, e, empties[q]]);
          }
        }
      }
      if (!cands.length) break;
      var mv = cands[Math.floor(rng() * cands.length)];
      var from = cur[mv[0]][mv[1]];
      cur[mv[0]][mv[1]] = mv[2];
      last = { r: mv[0], e: mv[1], from: from };
      moves.push({ r: mv[0], e: mv[1], from: from, to: mv[2] });
    }
    return { ropes: cur, moves: moves };
  }

  /* --- difficulty targets --------------------------------------------------- */

  function pegsHash(pts) {
    var s = "";
    for (var i = 0; i < pts.length; i += 1) {
      s += Math.round(pts[i][0] * 2) + "," + Math.round(pts[i][1] * 2) + ";";
    }
    var h = 5381;
    for (i = 0; i < s.length; i += 1) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  function puzzleSignature(family, pegs, ropes, crossings) {
    return family + "|" + ropes.length + "|" + pegsHash(pegs) + "|" + Math.round(crossings / 2);
  }

  var CAMPAIGNS = {
    easy: [
      { ropes: 3, cross: [2, 3], depth: [1, 2] },
      { ropes: 3, cross: [2, 3], depth: [1, 2] },
      { ropes: 3, cross: [2, 3], depth: [1, 2] },
      { ropes: 4, cross: [3, 5], depth: [2, 3] },
      { ropes: 4, cross: [3, 5], depth: [2, 3] },
      { ropes: 4, cross: [3, 5], depth: [2, 3] },
      { ropes: 4, cross: [3, 5], depth: [2, 3] },
      { ropes: 5, cross: [3, 6], depth: [2, 3] },
      { ropes: 5, cross: [3, 6], depth: [2, 3] },
      { ropes: 5, cross: [3, 6], depth: [2, 3] }
    ],
    medium: [
      { ropes: 5, cross: [4, 7], depth: [2, 3] },
      { ropes: 5, cross: [4, 7], depth: [2, 3] },
      { ropes: 5, cross: [4, 7], depth: [2, 3] },
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 7, cross: [6, 10], depth: [3, 4] },
      { ropes: 7, cross: [6, 10], depth: [3, 4] },
      { ropes: 7, cross: [6, 10], depth: [3, 4] }
    ],
    hard: [
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 6, cross: [5, 9], depth: [2, 4] },
      { ropes: 7, cross: [6, 11], depth: [3, 5] },
      { ropes: 7, cross: [6, 11], depth: [3, 5] },
      { ropes: 7, cross: [6, 11], depth: [3, 5] },
      { ropes: 7, cross: [6, 11], depth: [3, 5] },
      { ropes: 8, cross: [7, 13], depth: [3, 5] },
      { ropes: 8, cross: [7, 13], depth: [3, 5] },
      { ropes: 8, cross: [7, 13], depth: [3, 5] }
    ]
  };

  var SOLVER_CAPS = {
    easy: { nodeCap: 20000, timeCap: 500 },
    medium: { nodeCap: 40000, timeCap: 1000 },
    hard: { nodeCap: 50000, timeCap: 1200 }
  };

  function slotParams(diff, slot) {
    return CAMPAIGNS[diff][slot];
  }

  /* --- validation -------------------------------------------------------------- */

  function validatePuzzle(def) {
    if (!def || typeof def !== "object") return { ok: false, reason: "shape" };
    var pegs = def.pegs;
    var ropes = def.ropes;
    if (!Array.isArray(pegs) || !Array.isArray(ropes)) return { ok: false, reason: "shape" };
    if (ropes.length < 3 || ropes.length > 8) return { ok: false, reason: "rope-count" };
    if (pegs.length !== ropes.length * 2 + 2) return { ok: false, reason: "peg-count" };
    var i, j;
    for (i = 0; i < pegs.length; i += 1) {
      if (!Array.isArray(pegs[i]) || pegs[i].length !== 2) return { ok: false, reason: "peg" };
      if (typeof pegs[i][0] !== "number" || typeof pegs[i][1] !== "number") {
        return { ok: false, reason: "peg" };
      }
      if (!isFinite(pegs[i][0]) || !isFinite(pegs[i][1])) return { ok: false, reason: "peg" };
      if (pegs[i][0] < 6 || pegs[i][0] > 94 || pegs[i][1] < 5 || pegs[i][1] > 69) {
        return { ok: false, reason: "peg-bounds" };
      }
    }
    var seen = {};
    for (i = 0; i < ropes.length; i += 1) {
      if (!Array.isArray(ropes[i]) || ropes[i].length !== 2) return { ok: false, reason: "rope" };
      var a = ropes[i][0];
      var b = ropes[i][1];
      if (a !== Math.floor(a) || b !== Math.floor(b)) return { ok: false, reason: "rope" };
      if (a < 0 || b < 0 || a >= pegs.length || b >= pegs.length) return { ok: false, reason: "rope-range" };
      if (a === b) return { ok: false, reason: "rope-same-peg" };
      if (seen["p" + a] || seen["p" + b]) return { ok: false, reason: "peg-conflict" };
      seen["p" + a] = true;
      seen["p" + b] = true;
    }
    var empties = getEmptyPegs(ropes, pegs.length);
    if (empties.length !== 2) return { ok: false, reason: "empty-count" };
    if (minPairDist(pegs) < 6) return { ok: false, reason: "peg-spacing" };
    var crossings = countIntersections(ropesToPolys(ropes, pegs));
    if (crossings <= 0) return { ok: false, reason: "not-scrambled" };
    return { ok: true, crossings: crossings, empties: empties };
  }

  /* --- generation ----------------------------------------------------------------- */

  /*
   * Greedy width: fraction of legal moves that immediately reduce the
   * crossing count. Low width = fewer obvious moves = trickier puzzle.
   * Only the moved rope needs re-testing (incremental), so this is cheap.
   */
  function greedyWidth(pts, ropes) {
    var R = ropes.length;
    var polys = ropesToPolys(ropes, pts);
    var h0 = 0;
    var i, j;
    for (i = 0; i < R; i += 1) {
      for (j = i + 1; j < R; j += 1) {
        if (polysIntersect(polys[i], polys[j])) h0 += 1;
      }
    }
    var empties = getEmptyPegs(ropes, pts.length);
    var total = 0;
    var reducing = 0;
    for (var r = 0; r < R; r += 1) {
      for (var e = 0; e < 2; e += 1) {
        for (var q = 0; q < empties.length; q += 1) {
          var moved = applyEndpointMove(ropes, r, e, empties[q]);
          var g = buildRopeGeometry(
            pts[moved[r][0]][0], pts[moved[r][0]][1],
            pts[moved[r][1]][0], pts[moved[r][1]][1],
            r
          );
          var movedPoly = sampleRopePath(g, 26);
          var h = h0;
          for (j = 0; j < R; j += 1) {
            if (j === r) continue;
            var was = polysIntersect(polys[r], polys[j]) ? 1 : 0;
            var now = polysIntersect(movedPoly, polys[j]) ? 1 : 0;
            h += now - was;
          }
          total += 1;
          if (h < h0) reducing += 1;
        }
      }
    }
    return total ? reducing / total : 1;
  }

  function candidateScore(crossings, depth, p) {
    var dc = 0;
    if (crossings < p.cross[0]) dc = p.cross[0] - crossings;
    else if (crossings > p.cross[1]) dc = crossings - p.cross[1];
    var dd = 0;
    if (depth == null) dd = 1;
    else if (depth < p.depth[0]) dd = p.depth[0] - depth;
    else if (depth > p.depth[1]) dd = depth - p.depth[1];
    return dc * 2 + dd;
  }

  function generatePuzzle(diff, slot, opts) {
    opts = opts || {};
    var avoid = opts.avoid || [];
    var maxAttempts = opts.maxAttempts || 44;
    var p = slotParams(diff, slot);
    var caps = SOLVER_CAPS[diff];
    var solver = window.RopeTangleSolver;
    var t0 = Date.now();
    var fallback = null;
    var bestScore = Infinity;
    var attempt;

    for (attempt = 1; attempt <= maxAttempts; attempt += 1) {
      var relax = attempt > 30 ? 1 : 0;
      var relaxHard = attempt > 38 ? 1 : 0;
      var seed = "rt" + GEN_VERSION + ":" + diff + ":" + slot + ":" + attempt;
      var rng = makeRng(seed);
      var nPegs = p.ropes * 2 + 2;

      var layout = generatePegLayout(rng, nPegs);
      var solved = generateSolvedAssignment(rng, layout.pts, p.ropes);
      if (!solved) continue;

      var k = p.cross[1] + p.ropes + Math.floor(rng() * 3);
      var sc = scramble(rng, solved.ropes, nPegs, k);
      if (sc.moves.length < p.depth[0]) continue;

      var polys = ropesToPolys(sc.ropes, layout.pts);
      var clusters = findRopeIntersections(polys);
      if (!clusters.length) continue;

      var minAng = 180;
      for (var ci = 0; ci < clusters.length; ci += 1) {
        if (clusters[ci].angle < minAng) minAng = clusters[ci].angle;
      }

      var sol = solver.solve(layout.pts, sc.ropes, {
        nodeCap: caps.nodeCap,
        timeCap: caps.timeCap
      });
      var depth = sol.found ? sol.depth : null;

      var score = candidateScore(clusters.length, depth, p);
      if (!fallback || score < bestScore) {
        fallback = {
          seed: seed,
          generatorVersion: GEN_VERSION,
          family: layout.family,
          pegs: layout.pts,
          ropes: sc.ropes,
          scrambleMoves: sc.moves,
          crossings: clusters.length,
          minAngle: minAng,
          depth: depth,
          solverNodes: sol.nodes,
          solverExact: sol.exact === true,
          attempts: attempt,
          timeMs: Date.now() - t0
        };
        bestScore = score;
      }

      if (
        clusters.length < p.cross[0] - relax ||
        clusters.length > p.cross[1] + relax * 2 + relaxHard
      ) continue;

      if (minAng < 15 && !relaxHard) continue;

      /* depth null means the solver exhausted its budget without finding
         a zero-crossing state — genuinely search-hard, always acceptable */
      var depthFloor = diff === "easy" ? 1 : 2;
      if (sol.found) {
        if (
          depth < Math.max(depthFloor, p.depth[0] - relax) ||
          depth > p.depth[1] + relax * 2 + relaxHard
        ) continue;
      }

      /* greedy width: fewer obvious improving moves = better puzzle */
      var width = greedyWidth(layout.pts, sc.ropes);
      var widthMax = diff === "hard" ? 0.45 : diff === "medium" ? 0.45 : 0.62;
      if (width > widthMax + relaxHard * 0.1 && attempt <= maxAttempts - 6) continue;

      var sig = puzzleSignature(layout.family, layout.pts, sc.ropes, clusters.length);
      if (avoid.indexOf(sig) >= 0 && attempt <= maxAttempts - 4) continue;

      return {
        seed: seed,
        generatorVersion: GEN_VERSION,
        family: layout.family,
        pegs: layout.pts,
        ropes: sc.ropes,
        scrambleMoves: sc.moves,
        crossings: clusters.length,
        minAngle: minAng,
        depth: depth,
        solverNodes: sol.nodes,
        solverExact: sol.exact === true,
        width: width,
        attempts: attempt,
        timeMs: Date.now() - t0
      };
    }

    return fallback;
  }

  window.RopeTangleGen = {
    GEN_VERSION: GEN_VERSION,
    VB_W: VB_W,
    VB_H: VB_H,
    makeRng: makeRng,
    buildRopeGeometry: buildRopeGeometry,
    sampleRopePath: sampleRopePath,
    segmentIntersection: segmentIntersection,
    polysIntersect: polysIntersect,
    findRopeIntersections: findRopeIntersections,
    countIntersections: countIntersections,
    cloneState: cloneState,
    getOccupancy: getOccupancy,
    getEmptyPegs: getEmptyPegs,
    isPegOccupied: isPegOccupied,
    canMoveEndpoint: canMoveEndpoint,
    applyEndpointMove: applyEndpointMove,
    isSolved: isSolved,
    ropesToPolys: ropesToPolys,
    generatePegLayout: generatePegLayout,
    generateSolvedAssignment: generateSolvedAssignment,
    scramble: scramble,
    slotParams: slotParams,
    puzzleSignature: puzzleSignature,
    validatePuzzle: validatePuzzle,
    generatePuzzle: generatePuzzle
  };
})();
