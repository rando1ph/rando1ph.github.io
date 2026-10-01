/* ------------------------------------------------------------------
   Sudoku engine — randolf.dev
   DOM-free Sudoku mathematics: bitmask candidates, a solution counter
   that stops at two, a backtracking solver, a human-style logical
   solver, difficulty grading, deterministic puzzle generation and a
   seeded PRNG.

   This is an independent implementation informed by mature public
   approaches (constraint propagation, MRV backtracking, rotational
   clue symmetry, strategy-based grading). No third-party source code
   is copied; see the validator report in README notes.

   Loaded three ways:
     <script src="sudoku-engine.js">      -> window.SudokuEngine
     importScripts("sudoku-engine.js")    -> self.SudokuEngine
     require("./sudoku-engine.js")        -> module.exports
   ------------------------------------------------------------------ */

(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SudokuEngine = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Bump when generation semantics change. Saved puzzles stay playable
     from their stored board data regardless of this number. */
  var GENERATOR_VERSION = 1;

  var ALL = 0x1ff; /* bits 0..8 represent digits 1..9 */
  var DIFFICULTIES = ["easy", "medium", "hard"];

  /* ------------------------------------------------------------------
     Geometry — peers and units, computed once
     ------------------------------------------------------------------ */

  var DIGIT_OF_BIT = new Array(512).fill(0);
  var BIT_OF_DIGIT = new Array(10).fill(0);
  (function () {
    for (var d = 1; d <= 9; d += 1) {
      var bit = 1 << (d - 1);
      DIGIT_OF_BIT[bit] = d;
      BIT_OF_DIGIT[d] = bit;
    }
  })();

  var PEERS = new Array(81);
  var UNITS = []; /* 27 units of nine indices each */
  var UNIT_OF = new Array(81);
  var BOX_OF = new Array(81);

  (function buildGeometry() {
    var i;
    for (i = 0; i < 81; i += 1) {
      PEERS[i] = [];
      if (i < 81) boxOf(i);
    }
    function rowOf(i) {
      return (i / 9) | 0;
    }
    function colOf(i) {
      return i % 9;
    }
    function boxOf(i) {
      var b = ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
      BOX_OF[i] = b;
      return b;
    }
    function addPeer(i, j) {
      if (i !== j && PEERS[i].indexOf(j) === -1) PEERS[i].push(j);
    }
    for (i = 0; i < 81; i += 1) {
      var r = rowOf(i);
      var c = colOf(i);
      var b = boxOf(i);
      for (var k = 0; k < 9; k += 1) {
        addPeer(i, r * 9 + k);
        addPeer(i, k * 9 + c);
      }
      var br = ((r / 3) | 0) * 3;
      var bc = ((c / 3) | 0) * 3;
      for (var dr = 0; dr < 3; dr += 1) {
        for (var dc = 0; dc < 3; dc += 1) {
          addPeer(i, (br + dr) * 9 + (bc + dc));
        }
      }
    }
    for (var rr = 0; rr < 9; rr += 1) {
      var row = [];
      for (var cc = 0; cc < 9; cc += 1) row.push(rr * 9 + cc);
      UNITS.push(row);
    }
    for (var cc2 = 0; cc2 < 9; cc2 += 1) {
      var col = [];
      for (var rr2 = 0; rr2 < 9; rr2 += 1) col.push(rr2 * 9 + cc2);
      UNITS.push(col);
    }
    for (var bb = 0; bb < 9; bb += 1) {
      var box = [];
      var b0r = ((bb / 3) | 0) * 3;
      var b0c = (bb % 3) * 3;
      for (var r2 = 0; r2 < 3; r2 += 1) {
        for (var c2 = 0; c2 < 3; c2 += 1) {
          box.push((b0r + r2) * 9 + (b0c + c2));
        }
      }
      UNITS.push(box);
    }
    for (i = 0; i < 81; i += 1) {
      UNIT_OF[i] = [
        (i / 9) | 0, /* row unit */
        9 + (i % 9), /* column unit */
        18 + BOX_OF[i] /* box unit */
      ];
    }
  })();

  function rowOf(i) {
    return (i / 9) | 0;
  }
  function colOf(i) {
    return i % 9;
  }
  function popcount(x) {
    var c = 0;
    while (x) {
      x &= x - 1;
      c += 1;
    }
    return c;
  }
  function lowestBit(x) {
    return x & -x;
  }
  function bitsToDigits(mask) {
    var out = [];
    while (mask) {
      var use = lowestBit(mask);
      mask ^= use;
      out.push(DIGIT_OF_BIT[use]);
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Seeded PRNG (mulberry32) + string hashing
     ------------------------------------------------------------------ */

  function hashSeed(input) {
    var str = String(input);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    var state = a >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = (rng() * (i + 1)) | 0;
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /* ------------------------------------------------------------------
     Board helpers
     ------------------------------------------------------------------ */

  function emptyBoard() {
    return new Array(81).fill(0);
  }

  function cloneBoard(board) {
    return board.slice();
  }

  function countClues(board) {
    var n = 0;
    for (var i = 0; i < 81; i += 1) if (board[i]) n += 1;
    return n;
  }

  function isFull(board) {
    for (var i = 0; i < 81; i += 1) if (!board[i]) return false;
    return true;
  }

  function boardsEqual(a, b) {
    for (var i = 0; i < 81; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  function isValidPlacement(board, cell, digit) {
    if (cell < 0 || cell > 80 || digit < 1 || digit > 9) return false;
    if (board[cell]) return false;
    var peers = PEERS[cell];
    for (var i = 0; i < peers.length; i += 1) {
      if (board[peers[i]] === digit) return false;
    }
    return true;
  }

  /* Returns an array of 81 booleans marking every cell that duplicates
     a peer value, or null when the board has no rule conflicts. */
  function findConflicts(values) {
    var flags = new Array(81).fill(false);
    var any = false;
    for (var i = 0; i < 81; i += 1) {
      var v = values[i];
      if (!v) continue;
      var peers = PEERS[i];
      for (var k = 0; k < peers.length; k += 1) {
        if (values[peers[k]] === v) {
          flags[i] = true;
          flags[peers[k]] = true;
          any = true;
        }
      }
    }
    return any ? flags : null;
  }

  /* A completed board is valid iff every unit holds 1..9 exactly once. */
  function isSolved(board) {
    for (var u = 0; u < 27; u += 1) {
      var mask = 0;
      var cells = UNITS[u];
      for (var k = 0; k < 9; k += 1) {
        var v = board[cells[k]];
        if (!v) return false;
        mask |= BIT_OF_DIGIT[v];
      }
      if (mask !== ALL) return false;
    }
    return true;
  }

  function getCandidates(board) {
    var out = new Array(81).fill(0);
    for (var i = 0; i < 81; i += 1) {
      if (board[i]) continue;
      var used = 0;
      var peers = PEERS[i];
      for (var k = 0; k < peers.length; k += 1) {
        var v = board[peers[k]];
        if (v) used |= BIT_OF_DIGIT[v];
      }
      out[i] = ALL & ~used;
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Solution counting — stops as soon as `limit` solutions are found.
     ------------------------------------------------------------------ */

  function countSolutions(board, limit) {
    limit = limit || 2;
    var grid = cloneBoard(board);
    var rows = new Int32Array(9);
    var cols = new Int32Array(9);
    var boxes = new Int32Array(9);
    var i, r, c, b, v, bit;
    for (i = 0; i < 81; i += 1) {
      v = grid[i];
      if (!v) continue;
      r = (i / 9) | 0;
      c = i % 9;
      b = BOX_OF[i];
      bit = BIT_OF_DIGIT[v];
      if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) return 0;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
    }
    var count = 0;
    function recurse() {
      if (count >= limit) return;
      var best = -1;
      var bestMask = 0;
      var bestCount = 10;
      for (var j = 0; j < 81; j += 1) {
        if (grid[j]) continue;
        var jr = (j / 9) | 0;
        var jc = j % 9;
        var jb = BOX_OF[j];
        var mask = ALL & ~(rows[jr] | cols[jc] | boxes[jb]);
        if (mask === 0) return;
        var n = popcount(mask);
        if (n < bestCount) {
          bestCount = n;
          best = j;
          bestMask = mask;
          if (n === 1) break;
        }
      }
      if (best === -1) {
        count += 1;
        return;
      }
      var rr = (best / 9) | 0;
      var cc = best % 9;
      var bb = BOX_OF[best];
      var rest = bestMask;
      while (rest) {
        var use = lowestBit(rest);
        rest ^= use;
        grid[best] = DIGIT_OF_BIT[use];
        rows[rr] |= use;
        cols[cc] |= use;
        boxes[bb] |= use;
        recurse();
        rows[rr] ^= use;
        cols[cc] ^= use;
        boxes[bb] ^= use;
        grid[best] = 0;
        if (count >= limit) return;
      }
    }
    recurse();
    return count;
  }

  /* ------------------------------------------------------------------
     Backtracking solve
     ------------------------------------------------------------------ */

  function solve(board) {
    var grid = cloneBoard(board);
    var rows = new Int32Array(9);
    var cols = new Int32Array(9);
    var boxes = new Int32Array(9);
    var i, r, c, b, v, bit;
    for (i = 0; i < 81; i += 1) {
      v = grid[i];
      if (!v) continue;
      r = (i / 9) | 0;
      c = i % 9;
      b = BOX_OF[i];
      bit = BIT_OF_DIGIT[v];
      if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) return null;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
    }
    var ok = false;
    function recurse() {
      if (ok) return true;
      var best = -1;
      var bestMask = 0;
      var bestCount = 10;
      for (var j = 0; j < 81; j += 1) {
        if (grid[j]) continue;
        var jr = (j / 9) | 0;
        var jc = j % 9;
        var jb = BOX_OF[j];
        var mask = ALL & ~(rows[jr] | cols[jc] | boxes[jb]);
        if (mask === 0) return false;
        var n = popcount(mask);
        if (n < bestCount) {
          bestCount = n;
          best = j;
          bestMask = mask;
          if (n === 1) break;
        }
      }
      if (best === -1) {
        ok = true;
        return true;
      }
      var rr = (best / 9) | 0;
      var cc = best % 9;
      var bb = BOX_OF[best];
      var rest = bestMask;
      while (rest) {
        var use = lowestBit(rest);
        rest ^= use;
        grid[best] = DIGIT_OF_BIT[use];
        rows[rr] |= use;
        cols[cc] |= use;
        boxes[bb] |= use;
        if (recurse()) return true;
        rows[rr] ^= use;
        cols[cc] ^= use;
        boxes[bb] ^= use;
        grid[best] = 0;
      }
      return false;
    }
    recurse();
    return ok ? grid : null;
  }

  /* Generates a random complete board with MRV backtracking, using the
     supplied deterministic PRNG so a seed reproduces the same grid. */
  function generateSolved(rng) {
    var grid = emptyBoard();
    var rows = new Int32Array(9);
    var cols = new Int32Array(9);
    var boxes = new Int32Array(9);
    function recurse() {
      var best = -1;
      var bestMask = 0;
      var bestCount = 10;
      for (var j = 0; j < 81; j += 1) {
        if (grid[j]) continue;
        var jr = (j / 9) | 0;
        var jc = j % 9;
        var jb = BOX_OF[j];
        var mask = ALL & ~(rows[jr] | cols[jc] | boxes[jb]);
        if (mask === 0) return false;
        var n = popcount(mask);
        if (n < bestCount) {
          bestCount = n;
          best = j;
          bestMask = mask;
          if (n === 1) break;
        }
      }
      if (best === -1) return true;
      var digits = [];
      var restMask = bestMask;
      while (restMask) {
        var use = lowestBit(restMask);
        restMask ^= use;
        digits.push(use);
      }
      shuffle(digits, rng);
      var rr = (best / 9) | 0;
      var cc = best % 9;
      var bb = BOX_OF[best];
      for (var k = 0; k < digits.length; k += 1) {
        var bit = digits[k];
        grid[best] = DIGIT_OF_BIT[bit];
        rows[rr] |= bit;
        cols[cc] |= bit;
        boxes[bb] |= bit;
        if (recurse()) return true;
        rows[rr] ^= bit;
        cols[cc] ^= bit;
        boxes[bb] ^= bit;
        grid[best] = 0;
      }
      return false;
    }
    recurse();
    return grid;
  }

  /* ------------------------------------------------------------------
     Logical solver — human strategies only, simplest first.
     ------------------------------------------------------------------ */

  var TECHNIQUES = {
    nakedSingle: { rank: 1, weight: 1, label: "Naked single" },
    hiddenSingle: { rank: 1, weight: 1.5, label: "Hidden single" },
    lockedCandidate: { rank: 2, weight: 4, label: "Locked candidate" },
    nakedPair: { rank: 3, weight: 8, label: "Naked pair" },
    hiddenPair: { rank: 3, weight: 10, label: "Hidden pair" },
    nakedTriple: { rank: 3, weight: 12, label: "Naked triple" }
  };

  function bandOfRank(rank) {
    if (rank <= 1) return "easy";
    if (rank === 2) return "medium";
    if (rank >= 3) return "hard";
    return "solved";
  }

  function Solver(puzzle) {
    this.values = cloneBoard(puzzle);
    this.cands = new Array(81).fill(0);
    this.counts = {};
    this.score = 0;
    this.steps = 0;
    this.hardest = null;
    this.hardestRank = 0;
    this._init();
  }

  Solver.prototype._init = function () {
    var values = this.values;
    for (var i = 0; i < 81; i += 1) {
      if (values[i]) {
        this.cands[i] = 0;
        continue;
      }
      var used = 0;
      var peers = PEERS[i];
      for (var k = 0; k < peers.length; k += 1) {
        var v = values[peers[k]];
        if (v) used |= BIT_OF_DIGIT[v];
      }
      this.cands[i] = ALL & ~used;
    }
  };

  Solver.prototype.place = function (cell, digit) {
    this.values[cell] = digit;
    this.cands[cell] = 0;
    var bit = BIT_OF_DIGIT[digit];
    var peers = PEERS[cell];
    for (var k = 0; k < peers.length; k += 1) {
      this.cands[peers[k]] &= ~bit;
    }
  };

  Solver.prototype.eliminate = function (cell, digit) {
    this.cands[cell] &= ~BIT_OF_DIGIT[digit];
  };

  Solver.prototype.isSolved = function () {
    return isFull(this.values) && isSolved(this.values);
  };

  Solver.prototype._empty = function (cell) {
    return this.values[cell] === 0;
  };

  Solver.prototype._nakedSingle = function () {
    for (var i = 0; i < 81; i += 1) {
      if (!this._empty(i)) continue;
      var m = this.cands[i];
      if (m === 0) return { technique: "contradiction" };
      if (popcount(m) === 1) {
        var d = DIGIT_OF_BIT[m];
        this.place(i, d);
        return { technique: "nakedSingle", cell: i, digit: d, cells: [i] };
      }
    }
    return null;
  };

  Solver.prototype._hiddenSingle = function () {
    for (var u = 0; u < 27; u += 1) {
      var cells = UNITS[u];
      for (var d = 1; d <= 9; d += 1) {
        var bit = BIT_OF_DIGIT[d];
        var found = -1;
        var n = 0;
        for (var k = 0; k < 9; k += 1) {
          var i = cells[k];
          if (!this._empty(i)) continue;
          if (this.cands[i] & bit) {
            n += 1;
            found = i;
            if (n > 1) break;
          }
        }
        if (n === 1) {
          this.place(found, d);
          return {
            technique: "hiddenSingle",
            cell: found,
            digit: d,
            unit: u,
            cells: [found],
            unitCells: cells.slice()
          };
        }
      }
    }
    return null;
  };

  Solver.prototype._lockedCandidate = function () {
    var b, d, k, i, cells, bit, first, sameRow, sameCol, elim, j, n, u;
    /* Pointing: a digit inside a box confined to one row or column. */
    for (b = 0; b < 9; b += 1) {
      cells = UNITS[18 + b];
      for (d = 1; d <= 9; d += 1) {
        bit = BIT_OF_DIGIT[d];
        first = -1;
        n = 0;
        for (k = 0; k < 9; k += 1) {
          i = cells[k];
          if (this._empty(i) && this.cands[i] & bit) {
            n += 1;
            first = i;
          }
        }
        if (n < 2) continue;
        sameRow = true;
        sameCol = true;
        for (k = 0; k < 9; k += 1) {
          i = cells[k];
          if (this._empty(i) && this.cands[i] & bit) {
            if (rowOf(i) !== rowOf(first)) sameRow = false;
            if (colOf(i) !== colOf(first)) sameCol = false;
          }
        }
        if (sameRow) {
          elim = [];
          for (j = 0; j < 9; j += 1) {
            i = rowOf(first) * 9 + j;
            if (this._empty(i) && this.cands[i] & bit && BOX_OF[i] !== b) {
              elim.push([i, d]);
            }
          }
          if (elim.length) {
            for (k = 0; k < elim.length; k += 1) this.eliminate(elim[k][0], d);
            return {
              technique: "lockedCandidate",
              kind: "pointing-row",
              digit: d,
              box: b,
              unit: 18 + b,
              eliminations: elim,
              cells: cells.filter(function (c) {
                return this._empty(c) && this.cands[c] & bit;
              }, this)
            };
          }
        }
        if (sameCol) {
          elim = [];
          for (j = 0; j < 9; j += 1) {
            i = j * 9 + colOf(first);
            if (this._empty(i) && this.cands[i] & bit && BOX_OF[i] !== b) {
              elim.push([i, d]);
            }
          }
          if (elim.length) {
            for (k = 0; k < elim.length; k += 1) this.eliminate(elim[k][0], d);
            return {
              technique: "lockedCandidate",
              kind: "pointing-col",
              digit: d,
              box: b,
              unit: 18 + b,
              eliminations: elim
            };
          }
        }
      }
    }
    /* Claiming: a digit within a row/column confined to one box. */
    for (u = 0; u < 18; u += 1) {
      cells = UNITS[u];
      for (d = 1; d <= 9; d += 1) {
        bit = BIT_OF_DIGIT[d];
        first = -1;
        n = 0;
        for (k = 0; k < 9; k += 1) {
          i = cells[k];
          if (this._empty(i) && this.cands[i] & bit) {
            n += 1;
            first = i;
          }
        }
        if (n < 2) continue;
        var sameBox = true;
        for (k = 0; k < 9; k += 1) {
          i = cells[k];
          if (this._empty(i) && this.cands[i] & bit && BOX_OF[i] !== BOX_OF[first]) {
            sameBox = false;
            break;
          }
        }
        if (!sameBox) continue;
        var boxUnit = UNITS[18 + BOX_OF[first]];
        elim = [];
        for (k = 0; k < 9; k += 1) {
          i = boxUnit[k];
          if (this._empty(i) && this.cands[i] & bit && UNIT_OF[i].indexOf(u) === -1) {
            elim.push([i, d]);
          }
        }
        if (elim.length) {
          for (k = 0; k < elim.length; k += 1) this.eliminate(elim[k][0], d);
          return {
            technique: "lockedCandidate",
            kind: "claiming",
            digit: d,
            unit: u,
            box: BOX_OF[first],
            eliminations: elim
          };
        }
      }
    }
    return null;
  };

  Solver.prototype._nakedPair = function () {
    for (var u = 0; u < 27; u += 1) {
      var cells = UNITS[u];
      var pair = [];
      for (var k = 0; k < 9; k += 1) {
        var i = cells[k];
        if (this._empty(i) && popcount(this.cands[i]) === 2) pair.push(i);
      }
      for (var a = 0; a < pair.length; a += 1) {
        for (var b2 = a + 1; b2 < pair.length; b2 += 1) {
          var i1 = pair[a];
          var i2 = pair[b2];
          var mask = this.cands[i1];
          if (mask !== this.cands[i2]) continue;
          var elim = [];
          for (var k2 = 0; k2 < 9; k2 += 1) {
            var i3 = cells[k2];
            if (i3 === i1 || i3 === i2) continue;
            if (this._empty(i3) && this.cands[i3] & mask) elim.push([i3, mask]);
          }
          if (elim.length) {
            for (var e = 0; e < elim.length; e += 1) {
              var rest = elim[e][1];
              while (rest) {
                var use = lowestBit(rest);
                rest ^= use;
                this.cands[elim[e][0]] &= ~use;
              }
            }
            return {
              technique: "nakedPair",
              cells: [i1, i2],
              unit: u,
              digits: bitsToDigits(mask),
              eliminations: elim.map(function (x) {
                return [x[0], x[1]];
              })
            };
          }
        }
      }
    }
    return null;
  };

  Solver.prototype._hiddenPair = function () {
    for (var u = 0; u < 27; u += 1) {
      var cells = UNITS[u];
      for (var d1 = 1; d1 <= 9; d1 += 1) {
        for (var d2 = d1 + 1; d2 <= 9; d2 += 1) {
          var bits = BIT_OF_DIGIT[d1] | BIT_OF_DIGIT[d2];
          var found = [];
          for (var k = 0; k < 9; k += 1) {
            var i = cells[k];
            if (!this._empty(i)) continue;
            if (this.cands[i] & bits) found.push(i);
          }
          if (found.length !== 2) continue;
          /* Both digits must genuinely be possible in those two cells,
             otherwise this is just a single/naked deduction in disguise. */
          if (((this.cands[found[0]] | this.cands[found[1]]) & bits) !== bits) continue;
          var extra = (this.cands[found[0]] | this.cands[found[1]]) & ~bits;
          if (extra === 0) continue;
          var elim = [];
          for (var f = 0; f < 2; f += 1) {
            var cell = found[f];
            var remove = this.cands[cell] & ~bits;
            if (remove) elim.push([cell, remove]);
          }
          if (!elim.length) continue;
          for (var e = 0; e < elim.length; e += 1) {
            var rest = elim[e][1];
            while (rest) {
              var use = lowestBit(rest);
              rest ^= use;
              this.cands[elim[e][0]] &= ~use;
            }
          }
          return {
            technique: "hiddenPair",
            cells: found.slice(),
            unit: u,
            digits: [d1, d2],
            eliminations: elim.map(function (x) {
              return [x[0], x[1]];
            })
          };
        }
      }
    }
    return null;
  };

  Solver.prototype._nakedTriple = function () {
    for (var u = 0; u < 27; u += 1) {
      var cells = UNITS[u];
      var cand = [];
      for (var k = 0; k < 9; k += 1) {
        var i = cells[k];
        if (this._empty(i) && popcount(this.cands[i]) <= 3 && this.cands[i] !== 0) {
          cand.push(i);
        }
      }
      for (var a = 0; a < cand.length; a += 1) {
        for (var b2 = a + 1; b2 < cand.length; b2 += 1) {
          var union1 = this.cands[cand[a]] | this.cands[cand[b2]];
          if (popcount(union1) > 3) continue;
          for (var c2 = b2 + 1; c2 < cand.length; c2 += 1) {
            var union = union1 | this.cands[cand[c2]];
            if (popcount(union) !== 3) continue;
            var trio = [cand[a], cand[b2], cand[c2]];
            var elim = [];
            for (var k2 = 0; k2 < 9; k2 += 1) {
              var i3 = cells[k2];
              if (trio.indexOf(i3) !== -1) continue;
              if (this._empty(i3) && this.cands[i3] & union) elim.push([i3, this.cands[i3] & union]);
            }
            if (elim.length) {
              for (var e = 0; e < elim.length; e += 1) {
                var rest = elim[e][1];
                while (rest) {
                  var use = lowestBit(rest);
                  rest ^= use;
                  this.cands[elim[e][0]] &= ~use;
                }
              }
              return {
                technique: "nakedTriple",
                cells: trio,
                unit: u,
                digits: bitsToDigits(union),
                eliminations: elim
              };
            }
          }
        }
      }
    }
    return null;
  };

  Solver.prototype.nextStep = function () {
    return (
      this._nakedSingle() ||
      this._hiddenSingle() ||
      this._lockedCandidate() ||
      this._nakedPair() ||
      this._hiddenPair() ||
      this._nakedTriple()
    );
  };

  Solver.prototype.run = function () {
    var guard = 0;
    for (;;) {
      if (this.isSolved()) return { solved: true };
      if (guard > 4000) return { solved: false, reason: "loop" };
      guard += 1;
      var step = this.nextStep();
      if (!step) return { solved: false, reason: "stall" };
      if (step.technique === "contradiction") {
        return { solved: false, reason: "contradiction" };
      }
      this.steps += 1;
      this.counts[step.technique] = (this.counts[step.technique] || 0) + 1;
      this.score += TECHNIQUES[step.technique].weight;
      var rank = TECHNIQUES[step.technique].rank;
      if (rank > this.hardestRank) {
        this.hardestRank = rank;
        this.hardest = step.technique;
      }
    }
  };

  function gradeBoard(puzzle) {
    var solver = new Solver(puzzle);
    var result = solver.run();
    return {
      solved: result.solved,
      reason: result.reason || null,
      hardest: solver.hardest,
      hardestRank: solver.hardestRank,
      band: result.solved ? bandOfRank(solver.hardestRank) : null,
      score: Math.round(solver.score * 100) / 100,
      steps: solver.steps,
      counts: solver.counts
    };
  }

  /* ------------------------------------------------------------------
     Hint — derived from the current logical state, never from the
     stored solution.
     ------------------------------------------------------------------ */

  function findHint(values) {
    var conflicts = findConflicts(values);
    if (conflicts) return { type: "conflict", conflicts: conflicts };
    if (isFull(values)) return { type: "complete" };
    if (countSolutions(values, 2) === 0) return { type: "unsolvable" };
    var solver = new Solver(values);
    var step = solver.nextStep();
    if (!step || step.technique === "contradiction") return { type: "stalled" };
    return { type: "step", step: step };
  }

  function describeHint(step) {
    if (!step) return "";
    var cellName = function (i) {
      return "row " + (rowOf(i) + 1) + ", column " + (colOf(i) + 1);
    };
    switch (step.technique) {
      case "nakedSingle":
        return (
          "Only " + step.digit + " can go in " + cellName(step.cell) + "."
        );
      case "hiddenSingle":
        return (
          step.digit + " can only appear in " + cellName(step.cell) +
          " within its " + unitName(step.unit) + "."
        );
      case "lockedCandidate":
        return (
          step.digit + " is confined to one " + (step.kind === "claiming" ? "box" : "line") +
          ", so it can be removed elsewhere in the " +
          (step.kind === "claiming" ? "box" : "line") + "."
        );
      case "nakedPair":
        return (
          "These two cells must hold " + step.digits.join(" and ") +
          ", so those candidates can be removed from the rest of the " + unitName(step.unit) + "."
        );
      case "hiddenPair":
        return (
          step.digits.join(" and ") + " can only appear in these two cells, so other candidates there can be removed."
        );
      case "nakedTriple":
        return (
          "These three cells share only " + step.digits.join(", ") +
          ", so those digits can be removed from the rest of the " + unitName(step.unit) + "."
        );
      default:
        return "";
    }
  }

  function unitName(u) {
    if (u < 9) return "row " + (u + 1);
    if (u < 18) return "column " + (u - 9 + 1);
    return "box " + (u - 18 + 1);
  }

  /* ------------------------------------------------------------------
     Generation
     ------------------------------------------------------------------ */

  var DIFFICULTY_CONFIG = {
    easy: { rank: 1, minClues: 38, maxClues: 44, hardCeiling: 50 },
    medium: { rank: 2, minClues: 23, maxClues: 27, hardCeiling: 40 },
    hard: { rank: 3, minClues: 21, maxClues: 25, hardCeiling: 36 }
  };

  /* 180-degree symmetric removal: remove clue pairs, keeping each
     removal only while the puzzle stays uniquely solvable. */
  function removeSymmetric(solution, target, rng) {
    var puzzle = solution.slice();
    var clues = 81;
    var order = [];
    var i;
    for (i = 0; i <= 40; i += 1) order.push(i);
    shuffle(order, rng);
    for (var k = 0; k < order.length && clues > target; k += 1) {
      var a = order[k];
      var b = 80 - a;
      if (puzzle[a] === 0 && (a === b || puzzle[b] === 0)) continue;
      var va = puzzle[a];
      var vb = puzzle[b];
      puzzle[a] = 0;
      if (b !== a) puzzle[b] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        if (va) clues -= 1;
        if (b !== a && vb) clues -= 1;
      } else {
        puzzle[a] = va;
        if (b !== a) puzzle[b] = vb;
      }
    }
    return puzzle;
  }

  /* Unconstrained removal: random single clues, restored individually
     whenever uniqueness is lost. Reaches the sparse layouts that force
     harder techniques. */
  function removeFree(solution, target, rng) {
    var puzzle = solution.slice();
    var clues = 81;
    var order = [];
    var i;
    for (i = 0; i < 81; i += 1) order.push(i);
    shuffle(order, rng);
    for (var k = 0; k < order.length && clues > target; k += 1) {
      var c = order[k];
      if (puzzle[c] === 0) continue;
      var v = puzzle[c];
      puzzle[c] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        clues -= 1;
      } else {
        puzzle[c] = v;
      }
    }
    return puzzle;
  }

  function matchesBand(puzzle, cfg) {
    if (countSolutions(puzzle, 2) !== 1) return null;
    var grade = gradeBoard(puzzle);
    if (!grade.solved) return null;
    if (grade.hardestRank !== cfg.rank) return null;
    var clues = countClues(puzzle);
    if (clues > cfg.hardCeiling) return null;
    return { grade: grade, clues: clues };
  }

  /* One deterministic generation attempt for a specific seed: prefer a
     rotationally symmetric layout, fall back to free removal if the
     band does not match. */
  function generateFromSeed(difficulty, seed) {
    var cfg = DIFFICULTY_CONFIG[difficulty];
    if (!cfg) return null;
    var rng = mulberry32(seed >>> 0);
    var solution = generateSolved(rng);
    var span = cfg.maxClues - cfg.minClues + 1;
    var target = cfg.minClues + ((rng() * span) | 0);

    var puzzle = removeSymmetric(solution, target, rng);
    var match = matchesBand(puzzle, cfg);
    if (!match) {
      puzzle = removeFree(solution, target, rng);
      match = matchesBand(puzzle, cfg);
    }
    if (!match) return null;
    return {
      generatorVersion: GENERATOR_VERSION,
      difficulty: difficulty,
      seed: seed >>> 0,
      puzzle: puzzle,
      solution: solution,
      clues: match.clues,
      grade: match.grade
    };
  }

  /* Tries consecutive seeds from baseSeed until one fits the band. */
  function generateForDifficulty(difficulty, baseSeed, options) {
    options = options || {};
    var maxAttempts = options.maxAttempts || 400;
    var budgetMs = options.timeBudgetMs || 12000;
    var start = Date.now();
    var seed = (baseSeed === undefined ? (Math.random() * 0xffffffff) >>> 0 : baseSeed) >>> 0;
    var rejections = [];
    for (var a = 0; a < maxAttempts; a += 1) {
      if (Date.now() - start > budgetMs) {
        return { ok: false, reason: "timeout", attempts: a, rejections: rejections };
      }
      var attemptSeed = (seed + a) >>> 0;
      var res = generateFromSeed(difficulty, attemptSeed);
      if (res) {
        res.attempts = a + 1;
        res.rejections = rejections.slice(0, 8);
        res.elapsedMs = Date.now() - start;
        return { ok: true, result: res };
      }
      if (rejections.length < 8) rejections.push(attemptSeed);
    }
    return { ok: false, reason: "attempts", attempts: maxAttempts, rejections: rejections };
  }

  return {
    GENERATOR_VERSION: GENERATOR_VERSION,
    DIFFICULTIES: DIFFICULTIES,
    DIFFICULTY_CONFIG: DIFFICULTY_CONFIG,
    TECHNIQUES: TECHNIQUES,

    /* geometry */
    rowOf: rowOf,
    colOf: colOf,
    boxOf: function (i) {
      return BOX_OF[i];
    },
    peersOf: function (i) {
      return PEERS[i].slice();
    },
    units: UNITS,
    unitOf: function (i) {
      return UNIT_OF[i].slice();
    },

    /* prng */
    hashSeed: hashSeed,
    mulberry32: mulberry32,
    shuffle: shuffle,

    /* board */
    emptyBoard: emptyBoard,
    countClues: countClues,
    isFull: isFull,
    isSolved: isSolved,
    boardsEqual: boardsEqual,
    isValidPlacement: isValidPlacement,
    findConflicts: findConflicts,
    getCandidates: getCandidates,

    /* solvers */
    countSolutions: countSolutions,
    solve: solve,
    generateSolved: generateSolved,
    Solver: Solver,
    gradeBoard: gradeBoard,
    bandOfRank: bandOfRank,
    findHint: findHint,
    describeHint: describeHint,

    /* generation */
    generateFromSeed: generateFromSeed,
    generateForDifficulty: generateForDifficulty,
    removeSymmetric: removeSymmetric,
    removeFree: removeFree
  };
});
