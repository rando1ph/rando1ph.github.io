/* ------------------------------------------------------------------
   Reversi / Othello engine — randolf.dev
   Standard 8x8 rules, no dependencies. Runs on the main thread and,
   when importScripts()'d, inside a Web Worker.

   Independently implemented. The concepts used here (legal-move
   generation by bracketing, disc flipping, pass handling, negamax +
   alpha-beta, phase-aware evaluation with mobility / corners /
   stability / frontier) are standard Reversi technique; no code is
   copied from any reference project.

   Board: flat array of 64 values, 0 empty, 1 black, 2 white.
   Index = row * 8 + col.

   Public API (attached to self.ReversiAI):
     SIZE, EMPTY, BLACK, WHITE
     idx(r, c)
     initialBoard()
     flipsFor(board, index, player)   -> array of indices or null
     legalMoves(board, player)        -> array of indices
     hasMoves(board, player)          -> boolean
     applyMove(board, index, player)  -> flipped indices (mutates board)
     discCount(board)                 -> { black, white, empty }
     nextTurn(board, mover)           -> { current, pass, passed, over }
     evaluate(board, player)          -> score from player's view
     chooseMove(board, player, difficulty, budget)
                                      -> { move: index|-1, info }
   ------------------------------------------------------------------ */

(function (root) {
  "use strict";

  var SIZE = 8;
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var CELLS = SIZE * SIZE;

  var DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];

  /* Standard positional table. Corners are excellent; squares next to
     empty corners (C and X squares) are dangerous. */
  var BASE_WEIGHTS = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120
  ];

  var CORNERS = [0, 7, 56, 63];

  /* Squares touching each corner: C squares (orthogonal) and X squares
     (diagonal). Used to relax danger once a corner is owned. */
  var CORNER_ADJACENT = {
    0: [1, 8, 9],
    7: [6, 15, 14],
    56: [48, 57, 49],
    63: [62, 55, 54]
  };

  function idx(r, c) {
    return r * SIZE + c;
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function opponent(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  function initialBoard() {
    var board = new Array(CELLS).fill(EMPTY);
    board[idx(3, 3)] = WHITE;
    board[idx(3, 4)] = BLACK;
    board[idx(4, 3)] = BLACK;
    board[idx(4, 4)] = WHITE;
    return board;
  }

  /* --- rules ------------------------------------------------------ */

  /* Discs that would be captured by placing `player` on `index`.
     Returns an array of flipped indices, or null when the move is
     illegal. */
  function flipsFor(board, index, player) {
    if (index < 0 || index >= CELLS || board[index] !== EMPTY) {
      return null;
    }
    var r = Math.floor(index / SIZE);
    var c = index % SIZE;
    var opp = opponent(player);
    var all = [];

    for (var d = 0; d < DIRS.length; d += 1) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      var line = [];
      var rr = r + dr;
      var cc = c + dc;

      while (inBounds(rr, cc) && board[idx(rr, cc)] === opp) {
        line.push(idx(rr, cc));
        rr += dr;
        cc += dc;
      }
      if (line.length && inBounds(rr, cc) && board[idx(rr, cc)] === player) {
        all = all.concat(line);
      }
    }
    return all.length ? all : null;
  }

  function legalMoves(board, player) {
    var moves = [];
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] === EMPTY && flipsFor(board, i, player)) {
        moves.push(i);
      }
    }
    return moves;
  }

  function hasMoves(board, player) {
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] === EMPTY && flipsFor(board, i, player)) {
        return true;
      }
    }
    return false;
  }

  /* Mutates the board. Returns the flipped indices (or an empty array
     if the move was illegal, in which case the board is unchanged). */
  function applyMove(board, index, player) {
    var flips = flipsFor(board, index, player);
    if (!flips) {
      return [];
    }
    board[index] = player;
    for (var i = 0; i < flips.length; i += 1) {
      board[flips[i]] = player;
    }
    return flips;
  }

  function discCount(board) {
    var black = 0;
    var white = 0;
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] === BLACK) {
        black += 1;
      } else if (board[i] === WHITE) {
        white += 1;
      }
    }
    return { black: black, white: white, empty: CELLS - black - white };
  }

  /* Who moves next after `mover` has just moved. A single forced pass
     is not game over; only when neither side can move is it terminal. */
  function nextTurn(board, mover) {
    var other = opponent(mover);
    if (hasMoves(board, other)) {
      return { current: other, pass: false, passed: 0, over: false };
    }
    if (hasMoves(board, mover)) {
      return { current: mover, pass: true, passed: other, over: false };
    }
    return { current: mover, pass: false, passed: 0, over: true };
  }

  /* --- evaluation ------------------------------------------------- */

  /* Dynamic positional table: once a corner is owned the adjacent
     C/X squares are no longer as dangerous. */
  function dynamicWeights(board) {
    var w = BASE_WEIGHTS.slice();
    for (var k = 0; k < CORNERS.length; k += 1) {
      var corner = CORNERS[k];
      if (board[corner] !== EMPTY) {
        var adj = CORNER_ADJACENT[corner];
        for (var j = 0; j < adj.length; j += 1) {
          if (w[adj[j]] < 0) {
            w[adj[j]] = w[adj[j]] * 0.25;
          }
        }
      }
    }
    return w;
  }

  function frontierCount(board, player) {
    var count = 0;
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] !== player) {
        continue;
      }
      var r = Math.floor(i / SIZE);
      var c = i % SIZE;
      for (var d = 0; d < DIRS.length; d += 1) {
        var rr = r + DIRS[d][0];
        var cc = c + DIRS[d][1];
        if (inBounds(rr, cc) && board[idx(rr, cc)] === EMPTY) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  function potentialMoves(board, player) {
    var seen = new Uint8Array(CELLS);
    var count = 0;
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] !== player) {
        continue;
      }
      var r = Math.floor(i / SIZE);
      var c = i % SIZE;
      for (var d = 0; d < DIRS.length; d += 1) {
        var rr = r + DIRS[d][0];
        var cc = c + DIRS[d][1];
        if (inBounds(rr, cc)) {
          var j = idx(rr, cc);
          if (board[j] === EMPTY && !seen[j]) {
            seen[j] = 1;
            count += 1;
          }
        }
      }
    }
    return count;
  }

  /* Approximate stability: corners plus edge runs connected to a
     corner of the same colour. */
  function stableCount(board, player) {
    var stable = new Uint8Array(CELLS);
    var defs = [
      [0, 0, 0, 1],
      [0, 7, 0, -1],
      [7, 0, 0, 1],
      [7, 7, 0, -1]
    ];
    for (var k = 0; k < defs.length; k += 1) {
      var baseR = defs[k][0];
      var baseC = defs[k][1];
      var stepC = defs[k][3];
      if (board[idx(baseR, baseC)] !== player) {
        continue;
      }
      stable[idx(baseR, baseC)] = 1;
      var c;
      for (c = baseC + stepC; c >= 0 && c < SIZE; c += stepC) {
        if (board[idx(baseR, c)] !== player) {
          break;
        }
        stable[idx(baseR, c)] = 1;
      }
      var r;
      for (r = 0; r < SIZE; r += 1) {
        if (board[idx(r, baseC)] !== player) {
          break;
        }
        stable[idx(r, baseC)] = 1;
      }
    }
    var count = 0;
    for (var i = 0; i < CELLS; i += 1) {
      if (stable[i]) {
        count += 1;
      }
    }
    return count;
  }

  function evaluate(board, player) {
    var opp = opponent(player);
    var empties = 0;
    var myCount = 0;
    var oppCount = 0;
    var i;

    for (i = 0; i < CELLS; i += 1) {
      if (board[i] === EMPTY) {
        empties += 1;
      } else if (board[i] === player) {
        myCount += 1;
      } else {
        oppCount += 1;
      }
    }

    var myMoves = legalMoves(board, player).length;
    var oppMoves = legalMoves(board, opp).length;
    var mobility =
      myMoves + oppMoves > 0
        ? (myMoves - oppMoves) / (myMoves + oppMoves)
        : 0;

    var w = dynamicWeights(board);
    var pos = 0;
    for (i = 0; i < CELLS; i += 1) {
      if (board[i] === player) {
        pos += w[i];
      } else if (board[i] === opp) {
        pos -= w[i];
      }
    }

    var cornerScore = 0;
    for (i = 0; i < CORNERS.length; i += 1) {
      if (board[CORNERS[i]] === player) {
        cornerScore += 1;
      } else if (board[CORNERS[i]] === opp) {
        cornerScore -= 1;
      }
    }

    var frontier = frontierCount(board, opp) - frontierCount(board, player);
    var stability = stableCount(board, player) - stableCount(board, opp);
    var discDiff = myCount - oppCount;
    var potential = potentialMoves(board, player) - potentialMoves(board, opp);

    var weights;
    if (empties > 40) {
      weights = { mob: 900, corner: 1600, pos: 1, frontier: 14, stable: 30, disc: 0, pot: 10 };
    } else if (empties > 12) {
      weights = { mob: 600, corner: 2200, pos: 1, frontier: 10, stable: 60, disc: 4, pot: 6 };
    } else {
      weights = { mob: 120, corner: 4000, pos: 1, frontier: 4, stable: 100, disc: 160, pot: 0 };
    }

    return (
      weights.mob * mobility +
      weights.corner * cornerScore +
      weights.pos * pos +
      weights.frontier * frontier +
      weights.stable * stability +
      weights.disc * discDiff +
      weights.pot * potential
    );
  }

  /* --- search ----------------------------------------------------- */

  function terminalScore(board, player) {
    var c = discCount(board);
    var diff = player === BLACK ? c.black - c.white : c.white - c.black;
    if (diff > 0) {
      return 100000 + diff;
    }
    if (diff < 0) {
      return -100000 + diff;
    }
    return 0;
  }

  function orderMoves(moves, w) {
    moves.sort(function (a, b) {
      return w[b] - w[a];
    });
    return moves;
  }

  function negamax(board, player, depth, alpha, beta, deadline, tracker) {
    tracker.nodes += 1;
    if ((tracker.nodes & 1023) === 0 && Date.now() > deadline) {
      tracker.aborted = true;
      return 0;
    }

    var moves = legalMoves(board, player);
    if (!moves.length) {
      if (!hasMoves(board, opponent(player))) {
        return terminalScore(board, player);
      }
      /* Forced pass: hand over without consuming depth. */
      return -negamax(board, opponent(player), depth, alpha, beta, deadline, tracker);
    }
    if (depth <= 0) {
      return evaluate(board, player);
    }

    orderMoves(moves, dynamicWeights(board));
    var best = -Infinity;
    for (var i = 0; i < moves.length; i += 1) {
      var next = board.slice();
      applyMove(next, moves[i], player);
      var val = -negamax(
        next,
        opponent(player),
        depth - 1,
        -beta,
        -alpha,
        deadline,
        tracker
      );
      if (tracker.aborted) {
        return 0;
      }
      if (val > best) {
        best = val;
      }
      if (val > alpha) {
        alpha = val;
      }
      if (alpha >= beta) {
        break;
      }
    }
    return best;
  }

  function search(board, player, moves, maxDepth, budget) {
    var deadline = Date.now() + budget;
    var w = dynamicWeights(board);
    var order = orderMoves(moves.slice(), w);
    var bestMove = order[0];
    var info = { depth: 0, nodes: 0, timedOut: false, reason: "search" };

    for (var depth = 2; depth <= maxDepth; depth += 2) {
      var alpha = -Infinity;
      var beta = Infinity;
      var bestThisDepth = null;
      var bestScore = -Infinity;
      var tracker = { nodes: 0, aborted: false };

      for (var i = 0; i < order.length; i += 1) {
        var next = board.slice();
        applyMove(next, order[i], player);
        var val = -negamax(
          next,
          opponent(player),
          depth - 1,
          -beta,
          -alpha,
          deadline,
          tracker
        );
        if (tracker.aborted) {
          break;
        }
        if (val > bestScore) {
          bestScore = val;
          bestThisDepth = order[i];
        }
        if (val > alpha) {
          alpha = val;
        }
      }

      info.nodes += tracker.nodes;
      if (tracker.aborted) {
        info.timedOut = true;
        break;
      }
      if (bestThisDepth !== null) {
        bestMove = bestThisDepth;
        info.depth = depth;
        info.score = bestScore;
        order = [bestMove].concat(
          order.filter(function (x) {
            return x !== bestMove;
          })
        );
      }
      if (Math.abs(bestScore) >= 100000) {
        break; /* solved to a terminal result */
      }
      if (Date.now() > deadline) {
        info.timedOut = true;
        break;
      }
    }

    return { move: bestMove, info: info };
  }

  /* --- easy ------------------------------------------------------- */

  function easyMove(board, player, moves) {
    var w = dynamicWeights(board);
    var scored = moves.map(function (m) {
      return { m: m, s: w[m] + Math.random() * 18 };
    });
    scored.sort(function (a, b) {
      return b.s - a.s;
    });
    var best = scored[0].s;
    var pool = [];
    for (var i = 0; i < scored.length && i < 4; i += 1) {
      if (scored[i].s >= best - 22) {
        pool.push(scored[i].m);
      }
    }
    return {
      move: pool[Math.floor(Math.random() * pool.length)],
      info: { reason: "easy" }
    };
  }

  /* --- entry point ------------------------------------------------ */

  function chooseMove(board, player, difficulty, budget) {
    var moves = legalMoves(board, player);
    if (!moves.length) {
      return { move: -1, info: { reason: "pass" } };
    }
    if (moves.length === 1) {
      return { move: moves[0], info: { reason: "only" } };
    }
    if (difficulty === "easy") {
      return easyMove(board, player, moves);
    }

    var empties = 0;
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] === EMPTY) {
        empties += 1;
      }
    }

    var maxDepth = difficulty === "hard" ? 8 : 4;
    var b = budget || (difficulty === "hard" ? 2000 : 800);
    if (empties <= 12) {
      maxDepth = Math.max(maxDepth, empties);
      if (difficulty === "hard") {
        b = Math.max(b, 2500);
      }
    }
    return search(board, player, moves, maxDepth, b);
  }

  root.ReversiAI = {
    SIZE: SIZE,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    idx: idx,
    initialBoard: initialBoard,
    flipsFor: flipsFor,
    legalMoves: legalMoves,
    hasMoves: hasMoves,
    applyMove: applyMove,
    discCount: discCount,
    nextTurn: nextTurn,
    evaluate: evaluate,
    chooseMove: chooseMove
  };
})(typeof self !== "undefined" ? self : this);
