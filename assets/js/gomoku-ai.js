/* ------------------------------------------------------------------
   Gomoku AI — randolf.dev
   Freestyle 15x15. No dependencies. Runs on the main thread and,
   when importScripts()'d, inside a Web Worker.

   Independently implemented. Concepts (pattern scoring, candidate
   restriction, alpha-beta, iterative deepening with a time budget)
   are standard; no code is copied from any reference project.

   Difficulty is calibrated with separate evaluation profiles rather
   than search depth alone:
     easy   — coarse local patterns, low defensive awareness, wide
              sampling among plausible moves, no search
     medium — tactical patterns, depth-2 negamax, mild near-best sampling
     hard   — full pattern evaluation incl. gapped shapes, depth-6
              iterative deepening, deterministic best move

   All levels keep a tactical safety floor: take an immediate win and
   block an immediate loss before anything else.

   Public API (attached to self.GomokuAI):
     SIZE, EMPTY, BLACK, WHITE
     idx(r, c)                         -> board index
     winningLine(board, r, c, player)  -> array of indices or null
     generateCandidates(board, radius) -> array of indices
     evaluatePoint(board, r, c, player)-> heuristic value of a move
     evaluateBoard(board, player)      -> static score from player's view
     chooseMove(board, player, difficulty, budget)
                                        -> { move: index, info: {...} }
   ------------------------------------------------------------------ */

(function (root) {
  "use strict";

  var SIZE = 15;
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var CELLS = SIZE * SIZE;
  var DIRS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  var SCORE = {
    FIVE: 100000000,
    OPEN_FOUR: 10000000,
    FOUR: 1000000,
    OPEN_THREE: 100000,
    THREE: 10000,
    OPEN_TWO: 1000,
    TWO: 100,
    ONE: 10
  };

  /* --- geometry helpers ------------------------------------------ */

  function idx(r, c) {
    return r * SIZE + c;
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function opponent(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  /* All maximal rows / columns / diagonals with length >= 5.
     Precomputed once; used for static board evaluation. */
  var LINES = (function buildLines() {
    var lines = [];
    var r;
    var c;
    var s;
    var line;

    for (r = 0; r < SIZE; r += 1) {
      line = [];
      for (c = 0; c < SIZE; c += 1) {
        line.push(idx(r, c));
      }
      lines.push(line);
    }
    for (c = 0; c < SIZE; c += 1) {
      line = [];
      for (r = 0; r < SIZE; r += 1) {
        line.push(idx(r, c));
      }
      lines.push(line);
    }
    for (s = -(SIZE - 1); s <= SIZE - 1; s += 1) {
      line = [];
      for (r = 0; r < SIZE; r += 1) {
        c = r - s;
        if (c >= 0 && c < SIZE) {
          line.push(idx(r, c));
        }
      }
      if (line.length >= 5) {
        lines.push(line);
      }
    }
    for (s = 0; s <= 2 * (SIZE - 1); s += 1) {
      line = [];
      for (r = 0; r < SIZE; r += 1) {
        c = s - r;
        if (c >= 0 && c < SIZE) {
          line.push(idx(r, c));
        }
      }
      if (line.length >= 5) {
        lines.push(line);
      }
    }
    return lines;
  })();

  /* --- rules ------------------------------------------------------ */

  function winningLine(board, r, c, player) {
    for (var d = 0; d < 4; d += 1) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      var line = [idx(r, c)];
      var k;
      var rr;
      var cc;

      for (k = 1; k < SIZE; k += 1) {
        rr = r - dr * k;
        cc = c - dc * k;
        if (inBounds(rr, cc) && board[idx(rr, cc)] === player) {
          line.unshift(idx(rr, cc));
        } else {
          break;
        }
      }
      for (k = 1; k < SIZE; k += 1) {
        rr = r + dr * k;
        cc = c + dc * k;
        if (inBounds(rr, cc) && board[idx(rr, cc)] === player) {
          line.push(idx(rr, cc));
        } else {
          break;
        }
      }
      if (line.length >= 5) {
        return line;
      }
    }
    return null;
  }

  function isFull(board) {
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] === EMPTY) {
        return false;
      }
    }
    return true;
  }

  /* --- candidate generation --------------------------------------- */

  /* Empty intersections within `radius` (Chebyshev) of an existing
     stone. Empty board -> centre. This keeps the branching factor
     small instead of searching all 225 points. */
  function generateCandidates(board, radius) {
    var mark = new Uint8Array(CELLS);
    var any = false;
    var r;
    var c;
    var dr;
    var dc;

    for (r = 0; r < SIZE; r += 1) {
      for (c = 0; c < SIZE; c += 1) {
        if (board[idx(r, c)] === EMPTY) {
          continue;
        }
        any = true;
        for (dr = -radius; dr <= radius; dr += 1) {
          for (dc = -radius; dc <= radius; dc += 1) {
            var rr = r + dr;
            var cc = c + dc;
            if (inBounds(rr, cc) && board[idx(rr, cc)] === EMPTY) {
              mark[idx(rr, cc)] = 1;
            }
          }
        }
      }
    }

    if (!any) {
      return [idx(7, 7)];
    }

    var out = [];
    for (r = 0; r < SIZE; r += 1) {
      for (c = 0; c < SIZE; c += 1) {
        if (mark[idx(r, c)]) {
          out.push(idx(r, c));
        }
      }
    }
    return out;
  }

  /* --- difficulty evaluation profiles ----------------------------- */

  /* Pattern tables. Easy does not distinguish open from closed fours and
     ignores single stones; Medium distinguishes fours and threes but
     drops the weakest shapes; Hard scores everything. */
  function runScoreEasy(run, openEnds) {
    if (run >= 5) {
      return SCORE.FIVE;
    }
    if (openEnds === 0) {
      return 0;
    }
    if (run === 4) {
      return SCORE.FOUR;
    }
    if (run === 3) {
      return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.THREE;
    }
    if (run === 2) {
      return SCORE.TWO;
    }
    return 0;
  }

  function runScoreMedium(run, openEnds) {
    if (run >= 5) {
      return SCORE.FIVE;
    }
    if (openEnds === 0) {
      return 0;
    }
    if (run === 4) {
      return openEnds === 2 ? SCORE.OPEN_FOUR : SCORE.FOUR;
    }
    if (run === 3) {
      return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.THREE;
    }
    if (run === 2) {
      return SCORE.TWO;
    }
    return 0;
  }

  function runScoreHard(run, openEnds) {
    if (run >= 5) {
      return SCORE.FIVE;
    }
    if (openEnds === 0) {
      return 0;
    }
    if (run === 4) {
      return openEnds === 2 ? SCORE.OPEN_FOUR : SCORE.FOUR;
    }
    if (run === 3) {
      return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.THREE;
    }
    if (run === 2) {
      return openEnds === 2 ? SCORE.OPEN_TWO : SCORE.TWO;
    }
    if (run === 1) {
      return openEnds === 2 ? SCORE.ONE : 0;
    }
    return 0;
  }

  var PROFILES = {
    easy: {
      runScore: runScoreEasy,
      orderDefense: 0.9,
      evalDefense: 0.5,
      gapped: false,
      maxDepth: 0,
      rootLimit: 0,
      budget: 0,
      sample: { topK: 6, margin: 2.6, temperature: 1.2 }
    },
    medium: {
      runScore: runScoreMedium,
      orderDefense: 0.9,
      evalDefense: 0.9,
      gapped: false,
      maxDepth: 2,
      rootLimit: 8,
      budget: 600,
      sample: { topK: 3, margin: 1.1, temperature: 0.6 }
    },
    hard: {
      runScore: runScoreHard,
      orderDefense: 0.9,
      evalDefense: 1.1,
      gapped: true,
      maxDepth: 6,
      rootLimit: 14,
      budget: 2200,
      sample: null
    }
  };

  function profileFor(difficulty) {
    return PROFILES[difficulty] || PROFILES.hard;
  }

  /* --- scoring primitives ----------------------------------------- */

  function windowScore(count) {
    if (count >= 5) {
      return SCORE.FIVE;
    }
    if (count === 4) {
      return SCORE.FOUR;
    }
    if (count === 3) {
      return SCORE.THREE;
    }
    if (count === 2) {
      return SCORE.TWO;
    }
    if (count === 1) {
      return SCORE.ONE;
    }
    return 0;
  }

  /* Value of the line through (r, c) in one direction, assuming a
     `player` stone sits at (r, c). The run/open-end score distinguishes
     open fours / threes; the 5-window score (Hard only) catches gapped
     shapes such as XX_XX. */
  function directionPointScore(board, r, c, dr, dc, player, profile) {
    var vals = [];
    var k;
    var rr;
    var cc;
    var v;

    for (k = -4; k <= 4; k += 1) {
      if (k === 0) {
        vals.push(1);
        continue;
      }
      rr = r + dr * k;
      cc = c + dc * k;
      if (!inBounds(rr, cc)) {
        vals.push(2);
      } else {
        v = board[idx(rr, cc)];
        vals.push(v === EMPTY ? 0 : v === player ? 1 : 2);
      }
    }

    var left = 0;
    var i;
    for (i = 3; i >= 0; i -= 1) {
      if (vals[i] === 1) {
        left += 1;
      } else {
        break;
      }
    }
    var right = 0;
    for (i = 5; i < 9; i += 1) {
      if (vals[i] === 1) {
        right += 1;
      } else {
        break;
      }
    }
    var run = left + 1 + right;
    var openLeft = left < 4 && vals[4 - left - 1] === 0;
    var openRight = right < 4 && vals[4 + right + 1] === 0;
    var best = profile.runScore(run, (openLeft ? 1 : 0) + (openRight ? 1 : 0));

    if (profile.gapped) {
      for (var s = -4; s <= 0; s += 1) {
        var count = 0;
        var blocked = false;
        for (var w = 0; w < 5; w += 1) {
          var val = vals[s + w + 4];
          if (val === 1) {
            count += 1;
          } else if (val === 2) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          best = Math.max(best, windowScore(count));
        }
      }
    }

    return best;
  }

  function evaluatePoint(board, r, c, player, profile) {
    var p = profile || PROFILES.hard;
    var total = 0;
    for (var d = 0; d < 4; d += 1) {
      total += directionPointScore(board, r, c, DIRS[d][0], DIRS[d][1], player, p);
    }
    return total;
  }

  /* --- static board evaluation ------------------------------------ */

  function scorePlayer(board, player, profile) {
    var p = profile || PROFILES.hard;
    var total = 0;
    for (var li = 0; li < LINES.length; li += 1) {
      var line = LINES[li];
      var n = line.length;
      var i = 0;
      while (i < n) {
        if (board[line[i]] === player) {
          var j = i;
          while (j < n && board[line[j]] === player) {
            j += 1;
          }
          var run = j - i;
          var openLeft = i > 0 && board[line[i - 1]] === EMPTY;
          var openRight = j < n && board[line[j]] === EMPTY;
          total += p.runScore(run, (openLeft ? 1 : 0) + (openRight ? 1 : 0));
          i = j;
        } else {
          i += 1;
        }
      }
    }
    return total;
  }

  function evaluateBoard(board, player, profile) {
    var p = profile || PROFILES.hard;
    return (
      scorePlayer(board, player, p) -
      scorePlayer(board, opponent(player), p) * p.evalDefense
    );
  }

  /* --- move helpers ----------------------------------------------- */

  function findWinningMoves(board, player, candidates) {
    var out = [];
    var list = candidates || generateCandidates(board, 2);
    for (var i = 0; i < list.length; i += 1) {
      var ix = list[i];
      board[ix] = player;
      var win = winningLine(board, Math.floor(ix / SIZE), ix % SIZE, player);
      board[ix] = EMPTY;
      if (win) {
        out.push(ix);
      }
    }
    return out;
  }

  function scoreCandidates(board, candidates, player, profile) {
    var p = profile || PROFILES.hard;
    var opp = opponent(player);
    var scored = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var ix = candidates[i];
      var r = Math.floor(ix / SIZE);
      var c = ix % SIZE;
      scored.push({
        ix: ix,
        score:
          evaluatePoint(board, r, c, player, p) +
          evaluatePoint(board, r, c, opp, p) * p.orderDefense
      });
    }
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    return scored;
  }

  function bestOf(moves, board, player, profile) {
    var best = moves[0];
    var bestScore = -Infinity;
    for (var i = 0; i < moves.length; i += 1) {
      var ix = moves[i];
      var s = evaluatePoint(
        board,
        Math.floor(ix / SIZE),
        ix % SIZE,
        player,
        profile
      );
      if (s > bestScore) {
        bestScore = s;
        best = ix;
      }
    }
    return best;
  }

  /* --- controlled randomness -------------------------------------- */

  /* Weighted pick among the leading candidates. Scores are log-compressed
     (so pattern magnitudes do not dominate), gated by a margin, then
     weighted by exp(-gap / temperature). `scored` must be sorted desc. */
  function weightedPick(scored, sample) {
    var n = Math.min(sample.topK, scored.length);
    if (n <= 1) {
      return scored[0].ix;
    }
    var minScore = scored[n - 1].score;
    var cBest = Math.log(1 + Math.max(0, scored[0].score - minScore));
    var pool = [];
    var weights = [];
    var total = 0;

    for (var i = 0; i < n; i += 1) {
      var c = Math.log(1 + Math.max(0, scored[i].score - minScore));
      if (cBest - c > sample.margin) {
        break;
      }
      var w = Math.exp(-(cBest - c) / sample.temperature);
      pool.push(scored[i].ix);
      weights.push(w);
      total += w;
    }

    if (!pool.length) {
      return scored[0].ix;
    }
    var r = Math.random() * total;
    for (var j = 0; j < pool.length; j += 1) {
      r -= weights[j];
      if (r <= 0) {
        return pool[j];
      }
    }
    return pool[pool.length - 1];
  }

  /* --- easy ------------------------------------------------------- */

  function easyMove(board, player, candidates, profile) {
    var opp = opponent(player);
    var scored = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var ix = candidates[i];
      var r = Math.floor(ix / SIZE);
      var c = ix % SIZE;
      scored.push({
        ix: ix,
        score:
          evaluatePoint(board, r, c, player, profile) +
          evaluatePoint(board, r, c, opp, profile) * profile.evalDefense
      });
    }
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    return {
      move: weightedPick(scored, profile.sample),
      info: { reason: "easy" }
    };
  }

  /* --- alpha-beta search ------------------------------------------ */

  function negamax(board, depth, alpha, beta, player, deadline, tracker, profile) {
    tracker.nodes += 1;
    if ((tracker.nodes & 511) === 0 && Date.now() > deadline) {
      tracker.aborted = true;
      return 0;
    }
    if (depth <= 0) {
      return evaluateBoard(board, player, profile);
    }

    var candidates = generateCandidates(board, 2);
    if (!candidates.length) {
      return 0;
    }
    var ordered = scoreCandidates(board, candidates, player, profile);
    var limit = depth >= 4 ? 6 : 8;
    var best = -Infinity;

    for (var i = 0; i < ordered.length && i < limit; i += 1) {
      var ix = ordered[i].ix;
      board[ix] = player;
      var val;
      if (winningLine(board, Math.floor(ix / SIZE), ix % SIZE, player)) {
        val = SCORE.FIVE - (10 - depth);
      } else {
        val = -negamax(
          board,
          depth - 1,
          -beta,
          -alpha,
          opponent(player),
          deadline,
          tracker,
          profile
        );
      }
      board[ix] = EMPTY;
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

  /* Iterative deepening at the root. Returns the best move from the
     last fully completed depth plus the root move scores, so weaker
     levels can sample near-best alternatives. */
  function search(board, player, candidates, maxDepth, budget, profile) {
    var deadline = Date.now() + budget;
    var ordered = scoreCandidates(board, candidates, player, profile);
    var order = ordered.map(function (o) {
      return o.ix;
    });
    var bestMove = order[0];
    var roots = ordered.map(function (o) {
      return { ix: o.ix, score: o.score };
    });
    var info = { depth: 0, nodes: 0, timedOut: false, reason: "search" };

    for (var depth = 2; depth <= maxDepth; depth += 2) {
      var alpha = -Infinity;
      var beta = Infinity;
      var bestScore = -Infinity;
      var bestThisDepth = null;
      var perMove = [];
      var tracker = { nodes: 0, aborted: false };

      for (var i = 0; i < order.length; i += 1) {
        var ix = order[i];
        board[ix] = player;
        var val;
        if (winningLine(board, Math.floor(ix / SIZE), ix % SIZE, player)) {
          val = SCORE.FIVE;
        } else {
          val = -negamax(
            board,
            depth - 1,
            -beta,
            -alpha,
            opponent(player),
            deadline,
            tracker,
            profile
          );
        }
        board[ix] = EMPTY;
        if (tracker.aborted) {
          break;
        }
        perMove.push({ ix: ix, score: val });
        if (val > bestScore) {
          bestScore = val;
          bestThisDepth = ix;
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
        perMove.sort(function (a, b) {
          return b.score - a.score;
        });
        roots = perMove;
        order = [bestMove].concat(
          order.filter(function (x) {
            return x !== bestMove;
          })
        );
      }
      if (bestScore >= SCORE.FIVE) {
        break;
      }
      if (Date.now() > deadline) {
        info.timedOut = true;
        break;
      }
    }

    return { move: bestMove, info: info, roots: roots };
  }

  /* --- entry point ------------------------------------------------ */

  function chooseMove(board, player, difficulty, budget) {
    var start = Date.now();
    var profile = profileFor(difficulty);
    var candidates = generateCandidates(board, 2);

    if (!candidates.length) {
      return { move: -1, info: { reason: "full" } };
    }
    if (candidates.length === 1) {
      return { move: candidates[0], info: { reason: "only" } };
    }

    /* Tactical safety floor (all levels): take an immediate win. */
    var wins = findWinningMoves(board, player, candidates);
    if (wins.length) {
      return {
        move: bestOf(wins, board, player, profile),
        info: { reason: "win" }
      };
    }

    /* Tactical safety floor (all levels): block an immediate loss. */
    var opp = opponent(player);
    var blocks = findWinningMoves(board, opp, candidates);
    if (blocks.length) {
      return {
        move: bestOf(blocks, board, player, profile),
        info: { reason: "block" }
      };
    }

    if (difficulty === "easy") {
      return easyMove(board, player, candidates, profile);
    }

    var ordered = scoreCandidates(board, candidates, player, profile);
    var rootMoves = ordered.slice(0, profile.rootLimit).map(function (o) {
      return o.ix;
    });
    var result = search(
      board,
      player,
      rootMoves,
      profile.maxDepth,
      budget || profile.budget,
      profile
    );
    result.info.elapsed = Date.now() - start;

    /* Weaker levels may sample a near-best root move; Hard is decisive. */
    if (
      profile.sample &&
      result.roots &&
      result.roots.length > 1
    ) {
      return {
        move: weightedPick(result.roots, profile.sample),
        info: result.info
      };
    }
    return result;
  }

  root.GomokuAI = {
    SIZE: SIZE,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    idx: idx,
    winningLine: winningLine,
    isFull: isFull,
    generateCandidates: generateCandidates,
    evaluatePoint: evaluatePoint,
    evaluateBoard: evaluateBoard,
    chooseMove: chooseMove
  };
})(typeof self !== "undefined" ? self : this);
