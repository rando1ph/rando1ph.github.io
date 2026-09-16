/* ------------------------------------------------------------------
   Gomoku AI worker — randolf.dev
   Loads the shared engine and answers move requests off the main
   thread. Every response echoes the request token so the UI can
   discard stale results safely.
   ------------------------------------------------------------------ */

importScripts("gomoku-ai.js");

self.onmessage = function (event) {
  var data = event.data || {};
  var reply = { token: data.token, move: -1, info: null };

  try {
    var result = self.GomokuAI.chooseMove(
      data.board,
      data.player,
      data.difficulty,
      data.budget
    );
    reply.move = result.move;
    reply.info = result.info;
  } catch (err) {
    reply.info = { error: String((err && err.message) || err) };
  }

  self.postMessage(reply);
};
