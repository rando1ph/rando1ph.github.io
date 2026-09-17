/* ------------------------------------------------------------------
   2048 — randolf.dev

   Classic 4×4 sliding-tile puzzle.

   The move / merge algorithm is adapted from the canonical MIT-licensed
   implementation by Gabriele Cirulli (https://github.com/gabrielecirulli/2048):
   direction vectors, traversal order, farthest-position search and the
   one-merge-per-tile-per-move rule. See LICENSE-2048.txt for the
   required MIT license notice.

   Rendering, input (touch / keyboard), animation scheduling, undo,
   persistence, audio and accessibility are randolf.dev-specific code.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  /* --- constants --------------------------------------------------- */

  var SIZE = 4;
  var STORE_KEY = "randolf:2048:v1";
  var SLIDE_MS = 115;
  var SWIPE_MIN = 24;
  var QUEUE_MAX = 3;

  /* 0: up, 1: right, 2: down, 3: left — canonical vectors */
  var DIRS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];

  var KEYMAP = {
    ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
    w: 0, d: 1, s: 2, a: 3,
    W: 0, D: 1, S: 2, A: 3
  };

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function slideMs() {
    return reduceMotion ? 0 : SLIDE_MS;
  }

  /* --- dom ---------------------------------------------------------- */

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var boardEl = $("[data-g2-board]");
  var tilesEl = $("[data-g2-tiles]");
  var cellsEl = $("[data-g2-cells]");
  var stageEl = $("[data-g2-stage]");
  var overlayEl = $("[data-g2-overlay]");
  var scoreEl = $("[data-g2-score]");
  var bestEl = $("[data-g2-best]");
  var liveEl = $("[data-g2-live]");
  var undoBtn = $("[data-g2-undo]");
  var newBtn = $("[data-g2-new]");
  var soundBtn = $("[data-g2-sound]");
  var finalScoreEl = $("[data-g2-final-score]");
  var finalBestEl = $("[data-g2-final-best]");

  var panels = {
    win: $('[data-g2-panel="win"]'),
    over: $('[data-g2-panel="over"]'),
    confirm: $('[data-g2-panel="confirm"]')
  };

  /* --- state --------------------------------------------------------- */

  var grid;          /* grid[r][c] -> tile | null */
  var score = 0;
  var best = 0;
  var over = false;
  var won = false;
  var keepPlaying = false;
  var pending;       /* {p, v} — pre-drawn randomness for the next spawn */
  var undoSnap = null;

  var nextId = 1;
  var animating = false;
  var queue = [];
  var finalizeTimer = 0;
  var panelTimer = 0;

  /* --- small helpers -------------------------------------------------- */

  function rand100k() {
    return Math.floor(Math.random() * 100000);
  }

  function emptyCells() {
    var list = [];
    for (var r = 0; r < SIZE; r += 1) {
      for (var c = 0; c < SIZE; c += 1) {
        if (!grid[r][c]) list.push({ r: r, c: c });
      }
    }
    return list;
  }

  function withinBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function makeTile(r, c, value) {
    return { id: nextId++, value: value, r: r, c: c, el: null, merged: false, sources: null };
  }

  function cellsToValues() {
    var out = [];
    for (var r = 0; r < SIZE; r += 1) {
      for (var c = 0; c < SIZE; c += 1) {
        out.push(grid[r][c] ? grid[r][c].value : 0);
      }
    }
    return out;
  }

  /* --- persistence ----------------------------------------------------- */

  function save() {
    try {
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          v: 1,
          cells: cellsToValues(),
          score: score,
          best: best,
          over: over,
          won: won,
          keepPlaying: keepPlaying,
          pending: pending,
          undo: undoSnap
        })
      );
    } catch (e) {
      /* storage unavailable — the game still plays, it just won't persist */
    }
  }

  function validPending(p) {
    return (
      p &&
      typeof p.p === "number" && p.p >= 0 && p.p < 100000 &&
      typeof p.v === "number" && p.v >= 0 && p.v < 100000
    );
  }

  function validCells(cells) {
    if (!Array.isArray(cells) || cells.length !== SIZE * SIZE) return false;
    for (var i = 0; i < cells.length; i += 1) {
      var v = cells[i];
      if (v === 0) continue;
      if (typeof v !== "number" || v < 2 || v > 2097152 || (v & (v - 1)) !== 0) {
        return false;
      }
    }
    return true;
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !validCells(data.cells)) return null;
      if (typeof data.score !== "number" || data.score < 0) return null;
      if (!validPending(data.pending)) return null;
      if (data.undo && !validCells(data.undo.cells)) data.undo = null;
      return data;
    } catch (e) {
      return null;
    }
  }

  /* --- tiles / spawning ------------------------------------------------ */

  function draw() {
    return { p: rand100k(), v: rand100k() };
  }

  /* Consumes the pre-drawn randomness, then redraws for the next spawn.
     This makes Undo + replay fully deterministic: restoring a snapshot
     restores its pending draw, so replaying the same move always spawns
     the same tile — no rerolling. */
  function spawnRandomTile() {
    var cells = emptyCells();
    if (!cells.length) return null;
    var p = pending.p / 100000;
    var v = pending.v / 100000;
    var cell = cells[Math.min(cells.length - 1, Math.floor(p * cells.length))];
    var value = v < 0.9 ? 2 : 4;
    var tile = makeTile(cell.r, cell.c, value);
    grid[tile.r][tile.c] = tile;
    pending = draw();
    return tile;
  }

  /* --- canonical move algorithm (adapted from gabrielecirulli/2048) ---- */

  function findFarthest(r, c, vector) {
    var pr = r;
    var pc = c;
    var nr = r + vector.y;
    var nc = c + vector.x;
    while (withinBounds(nr, nc) && !grid[nr][nc]) {
      pr = nr;
      pc = nc;
      nr += vector.y;
      nc += vector.x;
    }
    return {
      farthest: { r: pr, c: pc },
      next: withinBounds(nr, nc) ? { r: nr, c: nc } : null
    };
  }

  function tileMatchesAvailable() {
    for (var r = 0; r < SIZE; r += 1) {
      for (var c = 0; c < SIZE; c += 1) {
        var tile = grid[r][c];
        if (!tile) continue;
        for (var d = 0; d < 4; d += 1) {
          var nr = r + DIRS[d].y;
          var nc = c + DIRS[d].x;
          if (withinBounds(nr, nc) && grid[nr][nc] && grid[nr][nc].value === tile.value) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function movesAvailable() {
    return emptyCells().length > 0 || tileMatchesAvailable();
  }

  function captureUndo() {
    return {
      cells: cellsToValues(),
      score: score,
      won: won,
      keepPlaying: keepPlaying,
      pending: { p: pending.p, v: pending.v }
    };
  }

  function isTerminated() {
    return over || (won && !keepPlaying);
  }

  /* Runs one canonical move. Returns a result object even for no-ops so
     the queue can keep flowing; render/finalize only run when moved. */
  function move(dir) {
    if (isTerminated()) return { moved: false };

    var vector = DIRS[dir];
    var cs = [0, 1, 2, 3];
    var rs = [0, 1, 2, 3];
    if (vector.x === 1) cs.reverse();
    if (vector.y === 1) rs.reverse();

    var snapshot = null;
    var moved = false;
    var slideCount = 0;
    var merges = [];
    var maxMerged = 0;
    var wasWon = won;

    var r, c, ci, ri;

    for (r = 0; r < SIZE; r += 1) {
      for (c = 0; c < SIZE; c += 1) {
        var tile = grid[r][c];
        if (tile) tile.merged = false;
      }
    }

    for (ci = 0; ci < SIZE; ci += 1) {
      c = cs[ci];
      for (ri = 0; ri < SIZE; ri += 1) {
        r = rs[ri];
        var t = grid[r][c];
        if (!t) continue;

        var pos = findFarthest(r, c, vector);
        var nextTile = pos.next ? grid[pos.next.r][pos.next.c] : null;

        if (nextTile && nextTile.value === t.value && !nextTile.merged && !t.merged) {
          if (!snapshot) snapshot = captureUndo();
          var merged = makeTile(pos.next.r, pos.next.c, t.value * 2);
          merged.merged = true;
          merged.sources = [t, nextTile];
          grid[r][c] = null;
          grid[pos.next.r][pos.next.c] = merged;
          score += merged.value;
          if (merged.value === 2048) won = true;
          if (merged.value > maxMerged) maxMerged = merged.value;
          merges.push(merged);
          moved = true;
        } else if (pos.farthest.r !== r || pos.farthest.c !== c) {
          if (!snapshot) snapshot = captureUndo();
          grid[r][c] = null;
          grid[pos.farthest.r][pos.farthest.c] = t;
          t.r = pos.farthest.r;
          t.c = pos.farthest.c;
          slideCount += 1;
          moved = true;
        }
      }
    }

    if (!moved) return { moved: false };

    undoSnap = snapshot;
    var spawned = spawnRandomTile();
    if (!movesAvailable()) over = true;
    if (score > best) best = score;
    save();

    return {
      moved: true,
      merges: merges,
      slideCount: slideCount,
      maxMerged: maxMerged,
      spawned: spawned,
      reached: !wasWon && won,
      gameOver: over
    };
  }

  /* --- rendering ------------------------------------------------------- */

  function buildCellsDom() {
    for (var i = 0; i < SIZE * SIZE; i += 1) {
      cellsEl.appendChild(document.createElement("i"));
    }
  }

  function digitClass(value) {
    return "d" + Math.min(7, String(value).length);
  }

  function positionTile(tile) {
    tile.el.style.setProperty("--r", tile.r);
    tile.el.style.setProperty("--c", tile.c);
  }

  function createTileEl(tile, animClass) {
    var root = document.createElement("div");
    root.className = "g2-tile " + digitClass(tile.value) + (animClass ? " " + animClass : "");
    root.setAttribute("data-v", tile.value);
    var inner = document.createElement("div");
    inner.className = "g2-tile-inner";
    inner.textContent = tile.value;
    root.appendChild(inner);
    tile.el = root;
    positionTile(tile);
    tilesEl.appendChild(root);
  }

  function destroyAllTileEls() {
    tilesEl.textContent = "";
  }

  function rebuildBoard(fadeIn) {
    destroyAllTileEls();
    for (var r = 0; r < SIZE; r += 1) {
      for (var c = 0; c < SIZE; c += 1) {
        var tile = grid[r][c];
        if (tile) createTileEl(tile, fadeIn ? "is-new" : null);
      }
    }
  }

  function render(result) {
    /* slides + merge-source slides: update position vars, CSS animates */
    var i;
    for (i = 0; i < result.merges.length; i += 1) {
      var m = result.merges[i];
      for (var s = 0; s < m.sources.length; s += 1) {
        var src = m.sources[s];
        if (src.el) {
          src.el.classList.add("is-dying");
          src.r = m.r;
          src.c = m.c;
          positionTile(src);
        }
      }
    }

    for (var r = 0; r < SIZE; r += 1) {
      for (var c = 0; c < SIZE; c += 1) {
        var tile = grid[r][c];
        if (!tile) continue;
        if (tile.merged && !tile.el) continue; /* appears after the slide */
        if (tile === result.spawned) {
          createTileEl(tile, "is-new");
          continue;
        }
        if (!tile.el) createTileEl(tile);
        positionTile(tile);
      }
    }
  }

  function finalize(result) {
    for (var i = 0; i < result.merges.length; i += 1) {
      var m = result.merges[i];
      for (var s = 0; s < m.sources.length; s += 1) {
        if (m.sources[s].el) {
          m.sources[s].el.remove();
          m.sources[s].el = null;
        }
      }
      createTileEl(m, "is-merged");
    }
  }

  function updateHud(bumpScore) {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    if (bumpScore) {
      scoreEl.classList.add("is-bump");
      setTimeout(function () {
        scoreEl.classList.remove("is-bump");
      }, 160);
    }
  }

  function updateUndoBtn() {
    undoBtn.disabled = !undoSnap;
  }

  function announce(text) {
    if (!liveEl) return;
    liveEl.textContent = "";
    window.setTimeout(function () {
      liveEl.textContent = text;
    }, 30);
  }

  /* --- overlays --------------------------------------------------------- */

  function showPanel(name) {
    hidePanels();
    overlayEl.classList.add("is-shown");
    panels[name].hidden = false;
    var btn = panels[name].querySelector("button");
    if (btn) btn.focus({ preventScroll: true });
  }

  function hidePanels() {
    Object.keys(panels).forEach(function (k) {
      panels[k].hidden = true;
    });
    overlayEl.classList.remove("is-shown");
  }

  function anyPanelOpen() {
    return overlayEl.classList.contains("is-shown");
  }

  /* --- audio / haptics --------------------------------------------------- */

  function audio() {
    return window.GameAudio && window.GameAudio.g2048;
  }

  function playMoveSounds(result) {
    var a = audio();
    if (!a) return;
    if (result.merges.length) {
      a.merge(result.merges.length, result.maxMerged);
    } else if (result.slideCount) {
      a.slide();
    }
  }

  function buzz(ms) {
    try {
      if (window.navigator && typeof window.navigator.vibrate === "function") {
        window.navigator.vibrate(ms);
      }
    } catch (e) {
      /* never required for gameplay */
    }
  }

  /* --- input queue / rapid swipes ------------------------------------------ */

  function requestMove(dir) {
    if (isTerminated() || anyPanelOpen()) return false;
    if (queue.length >= QUEUE_MAX) return false;
    queue.push(dir);
    processQueue();
    return true;
  }

  function processQueue() {
    if (animating || !queue.length) return;
    var dir = queue.shift();
    var result = move(dir);
    if (!result.moved) {
      processQueue(); /* no-op move: nothing animated, keep flowing */
      return;
    }

    render(result);
    playMoveSounds(result);
    updateHud(true);

    animating = true;
    finalizeTimer = window.setTimeout(function () {
      finalize(result);
      animating = false;
      updateUndoBtn();
      afterMove(result);
      processQueue();
    }, slideMs());
  }

  function afterMove(result) {
    if (result.reached) {
      boardEl.classList.add("is-glow");
      window.setTimeout(function () {
        var a = audio();
        if (a) a.win();
        buzz(15);
        announce("2048 reached. Keep playing or start a new game.");
        showPanel("win");
      }, 220);
      return;
    }
    if (result.gameOver) {
      window.setTimeout(function () {
        var a = audio();
        if (a) a.over();
        buzz(15);
        announce("Game over. Score " + score + ". Best " + best + ".");
        finalScoreEl.textContent = String(score);
        finalBestEl.textContent = String(best);
        showPanel("over");
      }, 260);
    }
  }

  /* --- actions -------------------------------------------------------------- */

  function newGame() {
    window.clearTimeout(finalizeTimer);
    window.clearTimeout(panelTimer);
    queue.length = 0;
    animating = false;

    grid = [];
    for (var r = 0; r < SIZE; r += 1) {
      grid.push([null, null, null, null]);
    }
    score = 0;
    over = false;
    won = false;
    keepPlaying = false;
    undoSnap = null;
    pending = draw();

    spawnRandomTile();
    spawnRandomTile();

    boardEl.classList.remove("is-glow");
    hidePanels();
    rebuildBoard(true);
    updateHud(false);
    updateUndoBtn();
    save();
    announce("New game.");
  }

  function undo() {
    if (!undoSnap || animating) return;
    window.clearTimeout(finalizeTimer);
    window.clearTimeout(panelTimer);
    queue.length = 0;
    animating = false;

    var snap = undoSnap;
    undoSnap = null;

    grid = [];
    var i = 0;
    for (var r = 0; r < SIZE; r += 1) {
      var row = [];
      for (var c = 0; c < SIZE; c += 1) {
        var v = snap.cells[i];
        i += 1;
        row.push(v ? makeTile(r, c, v) : null);
      }
      grid.push(row);
    }
    score = snap.score;
    won = snap.won;
    keepPlaying = snap.keepPlaying;
    pending = { p: snap.pending.p, v: snap.pending.v };
    over = false;

    boardEl.classList.remove("is-glow");
    hidePanels();
    rebuildBoard(false);
    updateHud(false);
    updateUndoBtn();
    save();
    announce("Move undone.");
  }

  /* --- persistence-aware startup ---------------------------------------------- */

  function restore(data) {
    grid = [];
    var i = 0;
    for (var r = 0; r < SIZE; r += 1) {
      var row = [];
      for (var c = 0; c < SIZE; c += 1) {
        var v = data.cells[i];
        i += 1;
        row.push(v ? makeTile(r, c, v) : null);
      }
      grid.push(row);
    }
    score = data.score;
    best = typeof data.best === "number" ? data.best : data.score;
    over = !!data.over;
    won = !!data.won;
    keepPlaying = !!data.keepPlaying;
    pending = { p: data.pending.p, v: data.pending.v };
    undoSnap = null;
    if (data.undo && data.undo.pending) {
      undoSnap = {
        cells: data.undo.cells,
        score: data.undo.score,
        won: !!data.undo.won,
        keepPlaying: !!data.undo.keepPlaying,
        pending: { p: data.undo.pending.p, v: data.undo.pending.v }
      };
    }
  }

  /* --- wiring ------------------------------------------------------------------ */

  function bindInput() {
    window.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var dir = KEYMAP[e.key];
      if (dir === undefined) return;
      if (anyPanelOpen()) return; /* overlays require an explicit button action */
      e.preventDefault();
      requestMove(dir);
    });

    /* swipe — pointer events + touch-action:none on the board only */
    var track = null;
    stageEl.addEventListener("pointerdown", function (e) {
      if (anyPanelOpen()) return;
      track = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    stageEl.addEventListener("pointerup", function (e) {
      if (!track || e.pointerId !== track.id) return;
      var dx = e.clientX - track.x;
      var dy = e.clientY - track.y;
      track = null;
      var adx = Math.abs(dx);
      var ady = Math.abs(dy);
      if (Math.max(adx, ady) < SWIPE_MIN) return;
      var dir = adx > ady ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      requestMove(dir);
    });
    stageEl.addEventListener("pointercancel", function () {
      track = null;
    });
    stageEl.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });

    undoBtn.addEventListener("click", undo);

    newBtn.addEventListener("click", function () {
      if (score > 0 || undoSnap) {
        showPanel("confirm");
      } else {
        newGame();
      }
    });

    panels.confirm.querySelector("[data-g2-cancel]").addEventListener("click", function () {
      hidePanels();
      newBtn.focus({ preventScroll: true });
    });

    panels.confirm.querySelector("[data-g2-confirm]").addEventListener("click", function () {
      hidePanels();
      newGame();
    });

    panels.win.querySelector("[data-g2-keep]").addEventListener("click", function () {
      keepPlaying = true;
      boardEl.classList.remove("is-glow");
      hidePanels();
      save();
      announce("Keep playing. Next target 4096.");
    });

    panels.win.querySelector("[data-g2-restart]").addEventListener("click", newGame);
    panels.over.querySelector("[data-g2-restart]").addEventListener("click", newGame);

    soundBtn.addEventListener("click", function () {
      if (window.GameAudio) {
        var on = window.GameAudio.toggle();
        soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
      }
    });
  }

  function initSoundBtn() {
    var on = window.GameAudio ? window.GameAudio.isEnabled() : false;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /* --- test hook (used by manual QA scripts; harmless in production) ---------- */

  window.__g2048 = {
    move: move,
    newGame: newGame,
    undo: undo,
    values: cellsToValues,
    score: function () { return score; },
    flags: function () { return { over: over, won: won, keepPlaying: keepPlaying }; },
    setPending: function (p, v) { pending = { p: p, v: v }; },
    setCells: function (cells) {
      grid = [];
      var i = 0;
      for (var r = 0; r < SIZE; r += 1) {
        var row = [];
        for (var c = 0; c < SIZE; c += 1) {
          var v = cells[i];
          i += 1;
          row.push(v ? makeTile(r, c, v) : null);
        }
        grid.push(row);
      }
      score = 0;
      over = false;
      won = false;
      keepPlaying = false;
      undoSnap = null;
    }
  };

  /* --- boot ---------------------------------------------------------------------- */

  buildCellsDom();
  bindInput();
  initSoundBtn();

  var saved = load();
  if (saved) {
    restore(saved);
    rebuildBoard(false);
    updateHud(false);
    updateUndoBtn();
    if (over) {
      finalScoreEl.textContent = String(score);
      finalBestEl.textContent = String(best);
      window.setTimeout(function () {
        showPanel("over");
      }, 150);
    } else if (won && !keepPlaying) {
      boardEl.classList.add("is-glow");
      window.setTimeout(function () {
        showPanel("win");
      }, 150);
    }
  } else {
    newGame();
  }
})();
