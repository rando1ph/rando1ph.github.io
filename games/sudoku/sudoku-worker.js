/* ------------------------------------------------------------------
   Sudoku — Web Worker (randolf.dev)
   Runs puzzle generation and difficulty filtering off the main thread
   so the page never freezes while a new puzzle is prepared.

   Message in : { id, type: "generate", difficulty, seed }
   Message out: { id, type: "result", ok, payload?, reason?, attempts?, ... }
   ------------------------------------------------------------------ */

"use strict";

importScripts("sudoku-engine.js");

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || typeof msg.id !== "number") return;

  if (msg.type === "generate") {
    var res = self.SudokuEngine.generateForDifficulty(msg.difficulty, msg.seed, {
      maxAttempts: 600,
      timeBudgetMs: 15000
    });
    if (res.ok) {
      self.postMessage({
        id: msg.id,
        type: "result",
        ok: true,
        payload: res.result,
        attempts: res.attempts,
        elapsedMs: res.elapsedMs
      });
    } else {
      self.postMessage({
        id: msg.id,
        type: "result",
        ok: false,
        reason: res.reason,
        attempts: res.attempts
      });
    }
    return;
  }
};
