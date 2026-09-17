/* Water Sort — Web Worker (randolf.dev)
   Hint solving and challenge generation off the main thread. */

"use strict";

importScripts("water-sort-solver.js");
importScripts("water-sort-gen.js");

var HINT_BUDGETS = {
  classic: 400000,
  easy: 200000,
  medium: 400000,
  hard: 600000
};

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || typeof msg.id !== "number") return;

  if (msg.type === "hint") {
    var state = msg.state;
    var budget = HINT_BUDGETS[msg.context] || 400000;
    var res = self.WSSolver.solveAStar(state, { nodeLimit: budget });
    if (res.status === "solved") {
      self.postMessage({
        id: msg.id, type: "hint", status: "solved", proven: true,
        move: res.moves[0] || null, path: res.moves, nodes: res.nodes, ms: res.ms
      });
      return;
    }
    if (res.status === "unsolvable") {
      self.postMessage({
        id: msg.id, type: "hint", status: "unsolvable", proven: true,
        nodes: res.nodes, ms: res.ms
      });
      return;
    }
    var greedy = self.WSSolver.solveGreedy(state, { nodeLimit: 120000 });
    self.postMessage({
      id: msg.id, type: "hint", status: greedy.status === "solved" ? "solved" : "unsolvable",
      proven: false, move: greedy.moves[0] || null, path: greedy.moves,
      nodes: res.nodes + greedy.nodes, ms: res.ms
    });
    return;
  }

  if (msg.type === "generate") {
    var gen = self.WSGen.generate(msg.difficulty, msg.seed, msg.number);
    self.postMessage({
      id: msg.id, type: "generate",
      ok: gen.ok, reason: gen.reason || null,
      seed: gen.seed, number: gen.number, difficulty: msg.difficulty,
      gen: gen.gen || self.WSGen.VERSION,
      def: gen.def || null, metrics: gen.metrics || null,
      attempts: gen.attempts, fallback: !!gen.fallback, rejections: gen.rejections || null
    });
    return;
  }
};
