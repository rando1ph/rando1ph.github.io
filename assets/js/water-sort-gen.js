/* ------------------------------------------------------------------
   Water Sort — challenge generator (randolf.dev)
   Deterministic, seeded, versioned. Runs inside the Web Worker
   (importScripts) and under Node for development stress tests.

   Pipeline per candidate:
     build → structural validation → A* verification → metrics →
     quality filter → accept / reject (bounded attempts, relaxable
     secondary bands; validity + solvability are never relaxed)
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var SOLVER = global.WSSolver;
  var GEN_VERSION = 1;
  var EMPTIES = 2;
  var CAP = SOLVER.CAPACITY;

  var PROFILES = {
    easy: {
      colors: [4, 6],
      depth: [10, 25],
      nodeBudget: 60000,
      attempts: 80,
      relaxAfter: 30
    },
    medium: {
      colors: [6, 9],
      depth: [20, 45],
      nodeBudget: 150000,
      attempts: 60,
      relaxAfter: 25
    },
    hard: {
      colors: [8, 12],
      depth: [35, 70],
      nodeBudget: 350000,
      attempts: 40,
      relaxAfter: 15
    }
  };

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

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(label) {
    return mulberry32(xmur3(label)());
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var k = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[k]; arr[k] = t;
    }
    return arr;
  }

  function buildCandidate(colorCount, rng) {
    var colors = shuffle(Array.from({ length: colorCount }, function (_, i) { return i; }), rng);
    var units = [];
    for (var c = 0; c < colors.length; c += 1) {
      for (var u = 0; u < 4; u += 1) units.push(colors[c]);
    }
    shuffle(units, rng);
    var bottles = [];
    for (var b = 0; b < colorCount; b += 1) {
      bottles.push(units.slice(b * 4, b * 4 + 4));
    }
    bottles.push([], []);
    return bottles;
  }

  function inBand(v, band, slack) {
    var lo = Math.round(band[0] / slack);
    var hi = Math.round(band[1] * slack);
    return v >= lo && v <= hi;
  }

  function bandLo(profile, slack) {
    return Math.round(profile.depth[0] / slack);
  }

  function generate(difficulty, seed, number) {
    var profile = PROFILES[difficulty];
    if (!profile) {
      return { ok: false, reason: "unknown-difficulty" };
    }
    var rng = makeRng("wsgen:" + GEN_VERSION + ":" + difficulty + ":" + number + ":" + seed);
    var rejectReasons = Object.create(null);
    var best = null;
    var attempts = 0;

    while (attempts < profile.attempts) {
      attempts += 1;
      var attemptRng = makeRng("wsatt:" + GEN_VERSION + ":" + difficulty + ":" + number + ":" + seed + ":" + attempts);
      var slack = 1;
      if (attempts > profile.relaxAfter * 2) slack = 1.5;
      else if (attempts > profile.relaxAfter) slack = 1.25;

      var colorCount = profile.colors[0] + Math.floor(attemptRng() * (profile.colors[1] - profile.colors[0] + 1));
      var candidate = buildCandidate(colorCount, attemptRng);

      var before = JSON.stringify(candidate);
      var problems = SOLVER.validateStructure(candidate, {
        colorCount: colorCount,
        empties: EMPTIES,
        bottleCount: colorCount + EMPTIES,
        requireNotSolved: true,
        requireNoDone: true
      });
      if (problems.length) {
        rejectReasons[problems[0]] = (rejectReasons[problems[0]] || 0) + 1;
        if (JSON.stringify(candidate) !== before) return { ok: false, reason: "candidate-mutated" };
        continue;
      }

      var res = SOLVER.solveAStar(candidate, { nodeLimit: profile.nodeBudget });
      if (res.status === "budget") {
        rejectReasons["solver-budget"] = (rejectReasons["solver-budget"] || 0) + 1;
        continue;
      }
      if (res.status !== "solved") {
        rejectReasons["unsolvable"] = (rejectReasons["unsolvable"] || 0) + 1;
        continue;
      }

      var m = SOLVER.metrics(candidate);
      var depth = res.moves.length;
      var cand = {
        def: candidate,
        metrics: {
          colors: colorCount,
          bottles: candidate.length,
          optimalDepth: depth,
          nodes: res.nodes,
          fragmentation: m.fragmentation,
          boundaries: m.boundaries,
          heuristic: m.heuristic,
          legalMoves: m.legalMoves,
          proven: true
        }
      };

      if (inBand(depth, profile.depth, slack)) {
        return {
          ok: true,
          seed: seed,
          number: number,
          difficulty: difficulty,
          gen: GEN_VERSION,
          def: candidate,
          metrics: cand.metrics,
          attempts: attempts,
          rejections: rejectReasons
        };
      }

      rejectReasons[depth < bandLo(profile, slack) ? "too-easy" : "too-hard"] =
        (rejectReasons[depth < bandLo(profile, slack) ? "too-easy" : "too-hard"] || 0) + 1;

      if (!best || Math.abs(depth - (profile.depth[0] + profile.depth[1]) / 2) <
        Math.abs(best.metrics.optimalDepth - (profile.depth[0] + profile.depth[1]) / 2)) {
        best = cand;
      }
    }

    if (best) {
      return {
        ok: true,
        seed: seed,
        number: number,
        difficulty: difficulty,
        gen: GEN_VERSION,
        def: best.def,
        metrics: best.metrics,
        attempts: attempts,
        fallback: true,
        rejections: rejectReasons
      };
    }
    return { ok: false, reason: "attempt-cap", attempts: attempts, rejections: rejectReasons };
  }

  global.WSGen = {
    VERSION: GEN_VERSION,
    EMPTIES: EMPTIES,
    PROFILES: PROFILES,
    generate: generate,
    buildCandidate: buildCandidate,
    makeRng: makeRng
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.WSGen;
  }
})(typeof window !== "undefined" ? window : globalThis);
