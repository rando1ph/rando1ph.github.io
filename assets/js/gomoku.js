/* ------------------------------------------------------------------
   Gomoku — randolf.dev
   Freestyle 15x15, player vs AI. Plain browser JS, no dependencies.

   Layers:
     rules / AI      -> assets/js/gomoku-ai.js (shared with the worker)
     game state      -> this file (board, history, turn, result)
     AI orchestration-> Web Worker with a synchronous fallback
     rendering       -> Canvas board
     UI              -> setup, HUD, result panel, local statistics
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var AI = window.GomokuAI;
  var canvas = document.querySelector("[data-gm-board]");
  if (!AI || !canvas) {
    return;
  }

  var ctx = canvas.getContext("2d");
  var SIZE = AI.SIZE;
  var EMPTY = AI.EMPTY;
  var BLACK = AI.BLACK;
  var WHITE = AI.WHITE;
  var IDX = AI.idx;

  var STAR_POINTS = [
    [3, 3],
    [3, 11],
    [7, 7],
    [11, 3],
    [11, 11]
  ];

  var DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };
  var DIFFS = ["easy", "medium", "hard"];
  var STATS_KEY = "randolf:gomoku:stats:v1";
  var BUCKETS = [];
  DIFFS.forEach(function (d) {
    BUCKETS.push(d + ":black");
    BUCKETS.push(d + ":white");
  });

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  /* --- DOM -------------------------------------------------------- */

  var setupEl = document.querySelector("[data-gm-setup]");
  var gameEl = document.querySelector("[data-gm-game]");
  var sideBtns = Array.prototype.slice.call(
    document.querySelectorAll("[data-gm-side]")
  );
  var diffBtns = Array.prototype.slice.call(
    document.querySelectorAll("[data-gm-difficulty]")
  );
  var startBtn = document.querySelector("[data-gm-start]");
  var undoBtn = document.querySelector("[data-gm-undo]");
  var newBtn = document.querySelector("[data-gm-new]");
  var settingsBtn = document.querySelector("[data-gm-settings]");
  var resultSettingsBtn = document.querySelector("[data-gm-result-settings]");
  var statsToggle = document.querySelector("[data-gm-stats-toggle]");
  var statsPanel = document.querySelector("[data-gm-stats-panel]");
  var statsGrid = document.querySelector("[data-gm-stats-grid]");
  var statsResetBtn = document.querySelector("[data-gm-stats-reset]");
  var soundBtn = document.querySelector("[data-gm-sound]");
  var turnEl = document.querySelector("[data-gm-turn]");
  var diffEl = document.querySelector("[data-gm-diff]");
  var movesEl = document.querySelector("[data-gm-moves]");
  var timeEl = document.querySelector("[data-gm-time]");
  var statusEl = document.querySelector("[data-gm-status]");
  var resultEl = document.querySelector("[data-gm-result]");
  var resultTitleEl = document.querySelector("[data-gm-result-title]");
  var resultMetaEl = document.querySelector("[data-gm-result-meta]");
  var playAgainBtn = document.querySelector("[data-gm-playagain]");

  /* --- statistics (localStorage, failure tolerant) ---------------- */

  var stats = readStats();
  var resetTimer = null;

  function emptyBucket() {
    return {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      currentWinStreak: 0,
      bestWinStreak: 0
    };
  }

  function count(value) {
    return typeof value === "number" && isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  }

  function sanitizeBucket(raw) {
    var out = emptyBucket();
    if (!raw || typeof raw !== "object") {
      return out;
    }
    out.gamesPlayed = count(raw.gamesPlayed);
    out.wins = Math.min(count(raw.wins), out.gamesPlayed);
    out.losses = Math.min(count(raw.losses), out.gamesPlayed - out.wins);
    out.currentWinStreak = count(raw.currentWinStreak);
    out.bestWinStreak = Math.max(
      count(raw.bestWinStreak),
      out.currentWinStreak
    );
    return out;
  }

  function readStats() {
    var out = {};
    BUCKETS.forEach(function (id) {
      out[id] = emptyBucket();
    });
    try {
      var raw = window.localStorage.getItem(STATS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          BUCKETS.forEach(function (id) {
            if (parsed[id]) {
              out[id] = sanitizeBucket(parsed[id]);
            }
          });
        }
      }
    } catch (err) {
      /* unavailable or corrupt — start fresh */
    }
    return out;
  }

  function writeStats() {
    try {
      window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (err) {
      /* storage unavailable — statistics simply won't persist */
    }
  }

  function bucketId(diff, color) {
    return diff + ":" + (color === BLACK ? "black" : "white");
  }

  function getBucket(diff, color) {
    return stats[bucketId(diff, color)];
  }

  function resetStats() {
    BUCKETS.forEach(function (id) {
      stats[id] = emptyBucket();
    });
    writeStats();
  }

  /* --- state ------------------------------------------------------ */

  var state = {
    board: new Array(SIZE * SIZE).fill(EMPTY),
    history: [],
    humanColor: BLACK,
    aiColor: WHITE,
    difficulty: "medium",
    selectedSide: BLACK,
    selectedDifficulty: "medium",
    status: "setup", // setup | playing | thinking | over
    result: null, // win | loss | draw
    winning: null,
    winProgress: 1,
    winAnim: null,
    placeAnim: null,
    lastMove: null,
    hover: null,
    generation: 0,
    elapsed: 0,
    startTime: 0,
    timerId: null
  };

  var worker = null;
  var workerFailed = false;
  var watchdog = null;
  var animating = false;
  var drawPending = false;

  /* --- helpers ---------------------------------------------------- */

  function formatTime(total) {
    var s = Math.max(0, Math.floor(total));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? "0" + m : String(m)) + ":" + (r < 10 ? "0" + r : String(r));
  }

  function setText(el, value) {
    if (el && el.textContent !== value) {
      el.textContent = value;
    }
  }

  function currentPlayer() {
    return state.history.length % 2 === 0 ? BLACK : WHITE;
  }

  function isHumanTurn() {
    return state.status === "playing" && currentPlayer() === state.humanColor;
  }

  function colorLabel(color) {
    return color === BLACK ? "Black" : "White";
  }

  function canUndo() {
    if (state.status !== "playing" && state.status !== "thinking") {
      return false;
    }
    for (var i = 0; i < state.history.length; i += 1) {
      if (state.history[i].player === state.humanColor) {
        return true;
      }
    }
    return false;
  }

  /* --- timer ------------------------------------------------------ */

  function startTimer() {
    stopTimer();
    state.elapsed = 0;
    state.startTime = Date.now();
    state.timerId = window.setInterval(function () {
      state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      setText(timeEl, formatTime(state.elapsed));
    }, 1000);
    setText(timeEl, formatTime(0));
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
      state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    }
  }

  /* --- AI worker -------------------------------------------------- */

  function createWorker() {
    if (worker) {
      try {
        worker.terminate();
      } catch (err) {
        /* ignore */
      }
      worker = null;
    }
    if (workerFailed || typeof window.Worker !== "function") {
      return;
    }
    try {
      worker = new Worker("../../assets/js/gomoku-ai-worker.js");
      worker.onmessage = function (e) {
        onAiMessage(e.data);
      };
      worker.onerror = function () {
        workerFailed = true;
        worker = null;
      };
    } catch (err) {
      worker = null;
      workerFailed = true;
    }
  }

  function requestAi() {
    if (state.status === "over") {
      return;
    }
    state.status = "thinking";
    updateHud();

    state.generation += 1;
    var token = state.generation;
    var budget =
      state.difficulty === "hard"
        ? 2200
        : state.difficulty === "medium"
        ? 900
        : 400;
    var payload = {
      board: state.board.slice(),
      player: state.aiColor,
      difficulty: state.difficulty,
      token: token,
      budget: budget
    };

    window.clearTimeout(watchdog);
    if (worker && !workerFailed) {
      worker.postMessage(payload);
      watchdog = window.setTimeout(function () {
        if (state.generation !== token || state.status !== "thinking") {
          return;
        }
        state.generation += 1;
        runFallback(payload.board, payload.player, state.generation);
      }, budget + 1800);
    } else {
      runFallback(payload.board, payload.player, token);
    }
  }

  function runFallback(board, player, token) {
    window.setTimeout(function () {
      var result = AI.chooseMove(board, player, state.difficulty, 700);
      onAiMessage({ token: token, move: result.move, info: result.info });
    }, 20);
  }

  function onAiMessage(data) {
    if (!data || data.token !== state.generation) {
      return; /* stale response from a previous board state */
    }
    if (state.status !== "thinking") {
      return;
    }
    window.clearTimeout(watchdog);

    var move = data.move;
    if (
      typeof move !== "number" ||
      move < 0 ||
      move >= SIZE * SIZE ||
      state.board[move] !== EMPTY
    ) {
      move = fallbackMove();
    }
    if (move == null) {
      return;
    }
    applyMove(move, state.aiColor);
    if (finishIfOver()) {
      return;
    }
    state.status = "playing";
    updateHud();
    requestDraw();
  }

  function fallbackMove() {
    var candidates = AI.generateCandidates(state.board, 2);
    return candidates.length ? candidates[0] : null;
  }

  /* --- moves ------------------------------------------------------ */

  function applyMove(ix, player) {
    state.board[ix] = player;
    state.history.push({
      r: Math.floor(ix / SIZE),
      c: ix % SIZE,
      player: player
    });
    state.lastMove = ix;
    state.hover = null;
    if (window.GameAudio) {
      window.GameAudio.gm.stone(
        player === state.humanColor ? "human" : "ai"
      );
    }
    if (!reducedMotion) {
      state.placeAnim = { ix: ix, start: performance.now() };
      ensureAnim();
    }
  }

  function humanMove(r, c) {
    if (!isHumanTurn()) {
      return;
    }
    var ix = IDX(r, c);
    if (state.board[ix] !== EMPTY) {
      return;
    }
    applyMove(ix, state.humanColor);
    if (finishIfOver()) {
      return;
    }
    requestAi();
    requestDraw();
  }

  function finishIfOver() {
    var last = state.history[state.history.length - 1];
    var line = AI.winningLine(state.board, last.r, last.c, last.player);
    if (line) {
      endGame(last.player === state.humanColor ? "win" : "loss", line);
      return true;
    }
    if (AI.isFull(state.board)) {
      endGame("draw", null);
      return true;
    }
    return false;
  }

  function endGame(result, line) {
    stopTimer();
    state.status = "over";
    state.result = result;
    if (window.GameAudio) {
      if (result === "win") {
        window.GameAudio.gm.win();
      } else if (result === "loss") {
        window.GameAudio.gm.loss();
      } else {
        window.GameAudio.gm.draw();
      }
    }
    state.winning = line;
    state.winProgress = reducedMotion ? 1 : 0;
    state.winAnim = reducedMotion ? null : { start: performance.now() };
    state.hover = null;
    ensureAnim();
    recordResult(result);
    updateHud();
    showResult(result);
    requestDraw();
  }

  /* --- undo ------------------------------------------------------- */

  function popMove() {
    var m = state.history.pop();
    state.board[IDX(m.r, m.c)] = EMPTY;
    state.lastMove = state.history.length
      ? IDX(
          state.history[state.history.length - 1].r,
          state.history[state.history.length - 1].c
        )
      : null;
  }

  function undo() {
    if (!canUndo()) {
      return;
    }
    state.generation += 1;
    window.clearTimeout(watchdog);
    createWorker();

    if (
      state.history.length &&
      state.history[state.history.length - 1].player === state.aiColor
    ) {
      popMove();
    }
    if (
      state.history.length &&
      state.history[state.history.length - 1].player === state.humanColor
    ) {
      popMove();
    }

    state.status = "playing";
    state.result = null;
    state.winning = null;
    state.winProgress = 1;
    state.winAnim = null;
    state.placeAnim = null;
    hideResult();
    updateHud();
    requestDraw();

    if (currentPlayer() === state.aiColor) {
      requestAi();
    }
  }

  /* --- game lifecycle --------------------------------------------- */

  function resetBoard() {
    state.board = new Array(SIZE * SIZE).fill(EMPTY);
    state.history = [];
    state.lastMove = null;
    state.winning = null;
    state.winProgress = 1;
    state.winAnim = null;
    state.placeAnim = null;
    state.hover = null;
    state.result = null;
  }

  function startGame() {
    state.humanColor = state.selectedSide;
    state.aiColor = state.humanColor === BLACK ? WHITE : BLACK;
    state.difficulty = state.selectedDifficulty;

    if (setupEl) {
      setupEl.hidden = true;
    }
    if (gameEl) {
      gameEl.hidden = false;
    }
    newGame();
  }

  function newGame() {
    state.generation += 1;
    window.clearTimeout(watchdog);
    createWorker();
    resetBoard();
    hideResult();
    state.status = "playing";
    startTimer();
    updateHud();
    requestAnimationFrame(function () {
      requestDraw();
    });
    if (state.aiColor === BLACK) {
      requestAi();
    }
  }

  function changeSettings() {
    state.generation += 1;
    window.clearTimeout(watchdog);
    createWorker();
    stopTimer();
    resetBoard();
    state.status = "setup";
    hideResult();
    if (gameEl) {
      gameEl.hidden = true;
    }
    if (setupEl) {
      setupEl.hidden = false;
    }
    updateSetupUi();
  }

  /* --- statistics recording --------------------------------------- */

  function recordResult(result) {
    var bucket = getBucket(state.difficulty, state.humanColor);
    bucket.gamesPlayed += 1;
    if (result === "win") {
      bucket.wins += 1;
      bucket.currentWinStreak += 1;
      if (bucket.currentWinStreak > bucket.bestWinStreak) {
        bucket.bestWinStreak = bucket.currentWinStreak;
      }
    } else {
      if (result === "loss") {
        bucket.losses += 1;
      }
      bucket.currentWinStreak = 0;
    }
    writeStats();
    renderStats();
  }

  /* --- UI updates ------------------------------------------------- */

  function updateHud() {
    var turn = "\u2014";
    var status = "Ready";

    if (state.status === "over") {
      turn =
        state.result === "win"
          ? "You win"
          : state.result === "loss"
          ? "AI wins"
          : "Draw";
      status = "Finished";
    } else if (state.status === "thinking") {
      turn = "AI thinking\u2026";
      status = "Playing";
    } else if (state.status === "playing") {
      turn = isHumanTurn() ? "Your turn" : "AI turn";
      status = "Playing";
    }

    setText(turnEl, turn);
    setText(diffEl, DIFF_LABEL[state.difficulty]);
    setText(movesEl, String(state.history.length));
    setText(timeEl, formatTime(state.elapsed));
    setText(statusEl, status);
    if (turnEl) {
      turnEl.dataset.state =
        state.status === "over"
          ? state.result
          : state.status === "thinking"
          ? "thinking"
          : "playing";
    }
    if (undoBtn) {
      undoBtn.disabled = !canUndo();
    }
  }

  function updateSetupUi() {
    sideBtns.forEach(function (btn) {
      var on = btn.dataset.gmSide === (state.selectedSide === BLACK ? "black" : "white");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-selected", on);
    });
    diffBtns.forEach(function (btn) {
      var on = btn.dataset.gmDifficulty === state.selectedDifficulty;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function showResult(result) {
    if (!resultEl) {
      return;
    }
    resultEl.hidden = false;
    resultEl.dataset.result = result;
    if (resultTitleEl) {
      resultTitleEl.textContent =
        result === "win" ? "You win" : result === "loss" ? "AI wins" : "Draw";
    }
    if (resultMetaEl) {
      resultMetaEl.textContent =
        colorLabel(state.humanColor) +
        " \u00b7 " +
        DIFF_LABEL[state.difficulty] +
        " \u00b7 " +
        state.history.length +
        " moves \u00b7 " +
        formatTime(state.elapsed);
    }
    resultEl.classList.remove("is-shown");
    void resultEl.offsetWidth;
    resultEl.classList.add("is-shown");
  }

  function hideResult() {
    if (resultEl) {
      resultEl.hidden = true;
      resultEl.classList.remove("is-shown");
    }
  }

  function renderStats() {
    if (!statsGrid) {
      return;
    }
    var html = "";
    DIFFS.forEach(function (diff) {
      [BLACK, WHITE].forEach(function (color) {
        var b = getBucket(diff, color);
        var rate = b.gamesPlayed
          ? ((b.wins / b.gamesPlayed) * 100).toFixed(1) + "%"
          : "\u2014";
        html +=
          '<div class="gm-stats-block">' +
          '<p class="gm-stats-name mono">' +
          DIFF_LABEL[diff] +
          " \u00b7 " +
          colorLabel(color) +
          "</p>" +
          row("Games", b.gamesPlayed) +
          row("Wins", b.wins) +
          row("Losses", b.losses) +
          row("Win rate", rate) +
          row("Current streak", b.currentWinStreak) +
          row("Best streak", b.bestWinStreak) +
          "</div>";
      });
    });
    statsGrid.innerHTML = html;
  }

  function row(label, value) {
    return (
      '<div class="gm-stats-row"><span class="mono">' +
      label +
      '</span><span class="mono">' +
      value +
      "</span></div>"
    );
  }

  function setStatsOpen(open) {
    if (statsPanel) {
      statsPanel.hidden = !open;
    }
    if (statsToggle) {
      statsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function onResetStats() {
    if (!statsResetBtn) {
      return;
    }
    if (statsResetBtn.dataset.confirming === "1") {
      window.clearTimeout(resetTimer);
      resetTimer = null;
      statsResetBtn.dataset.confirming = "0";
      statsResetBtn.textContent = "Reset statistics";
      statsResetBtn.classList.remove("is-confirming");
      resetStats();
      renderStats();
      return;
    }
    statsResetBtn.dataset.confirming = "1";
    statsResetBtn.textContent = "Confirm reset";
    statsResetBtn.classList.add("is-confirming");
    resetTimer = window.setTimeout(function () {
      statsResetBtn.dataset.confirming = "0";
      statsResetBtn.textContent = "Reset statistics";
      statsResetBtn.classList.remove("is-confirming");
      resetTimer = null;
    }, 4000);
  }

  /* --- canvas rendering ------------------------------------------- */

  function px(c, margin, spacing) {
    return margin + c * spacing;
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var grain = (function () {
    var out = [];
    var seed = 20260916;
    for (var i = 0; i < 26; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out.push({
        y: (seed % 1000) / 1000,
        alpha: 0.015 + ((seed >> 10) % 40) / 2000,
        drift: (((seed >> 5) % 100) - 50) / 400
      });
    }
    return out;
  })();

  function geometry() {
    var size = canvas.clientWidth || canvas.width || 0;
    var margin = size * 0.055;
    var spacing = (size - margin * 2) / (SIZE - 1);
    return { size: size, margin: margin, spacing: spacing, stone: spacing * 0.42 };
  }

  function draw() {
    var g = geometry();
    if (!g.size) {
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    var backing = Math.round(g.size * dpr);
    if (canvas.width !== backing || canvas.height !== backing) {
      canvas.width = backing;
      canvas.height = backing;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.size, g.size);

    drawBoardSurface(g);

    var now = performance.now();
    for (var r = 0; r < SIZE; r += 1) {
      for (var c = 0; c < SIZE; c += 1) {
        var v = state.board[IDX(r, c)];
        if (!v) {
          continue;
        }
        var scale = 1;
        if (state.placeAnim && state.placeAnim.ix === IDX(r, c)) {
          var t = Math.min(1, (now - state.placeAnim.start) / 170);
          scale = 0.55 + 0.45 * (1 - Math.pow(1 - t, 3));
        }
        drawStone(px(c, g.margin, g.spacing), px(r, g.margin, g.spacing), v, g.stone, scale);
      }
    }

    if (state.winning) {
      drawWinning(g);
    }
    if (state.lastMove != null) {
      drawLastMove(g);
    }
    if (state.hover != null && isHumanTurn() && state.board[state.hover] === EMPTY) {
      var hr = Math.floor(state.hover / SIZE);
      var hc = state.hover % SIZE;
      ctx.globalAlpha = 0.4;
      drawStone(px(hc, g.margin, g.spacing), px(hr, g.margin, g.spacing), state.humanColor, g.stone, 1);
      ctx.globalAlpha = 1;
    }
  }

  function drawBoardSurface(g) {
    var size = g.size;
    var grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#ddc59d");
    grad.addColorStop(0.45, "#cfb083");
    grad.addColorStop(1, "#bc996a");
    roundRectPath(0, 0, size, size, Math.max(4, size * 0.014));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    roundRectPath(0, 0, size, size, Math.max(4, size * 0.014));
    ctx.clip();
    ctx.lineWidth = Math.max(1, size * 0.004);
    for (var i = 0; i < grain.length; i += 1) {
      var y = grain[i].y * size;
      ctx.strokeStyle = "rgba(120, 86, 46, " + grain[i].alpha + ")";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        size * 0.33,
        y + grain[i].drift * size,
        size * 0.66,
        y - grain[i].drift * size,
        size,
        y + grain[i].drift * size * 0.5
      );
      ctx.stroke();
    }
    var rg = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.18,
      size / 2,
      size / 2,
      size * 0.78
    );
    rg.addColorStop(0, "rgba(255, 250, 240, 0.06)");
    rg.addColorStop(1, "rgba(84, 56, 28, 0.2)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    ctx.strokeStyle = "rgba(92, 66, 40, 0.85)";
    ctx.lineWidth = Math.max(1, size * 0.005);
    roundRectPath(
      ctx.lineWidth / 2,
      ctx.lineWidth / 2,
      size - ctx.lineWidth,
      size - ctx.lineWidth,
      Math.max(4, size * 0.014)
    );
    ctx.stroke();

    ctx.strokeStyle = "rgba(70, 50, 30, 0.55)";
    ctx.lineWidth = Math.max(1, size * 0.0018);
    var k;
    for (k = 0; k < SIZE; k += 1) {
      var p = px(k, g.margin, g.spacing);
      ctx.beginPath();
      ctx.moveTo(px(0, g.margin, g.spacing), p);
      ctx.lineTo(px(SIZE - 1, g.margin, g.spacing), p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, px(0, g.margin, g.spacing));
      ctx.lineTo(p, px(SIZE - 1, g.margin, g.spacing));
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(60, 42, 25, 0.8)";
    for (k = 0; k < STAR_POINTS.length; k += 1) {
      var sr = STAR_POINTS[k][0];
      var sc = STAR_POINTS[k][1];
      ctx.beginPath();
      ctx.arc(
        px(sc, g.margin, g.spacing),
        px(sr, g.margin, g.spacing),
        Math.max(1.4, g.stone * 0.22),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  function drawStone(x, y, color, radius, scale) {
    var R = radius * (scale || 1);
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = R * 0.55;
    ctx.shadowOffsetY = R * 0.16;
    var grad = ctx.createRadialGradient(
      x - R * 0.34,
      y - R * 0.38,
      R * 0.08,
      x,
      y,
      R
    );
    if (color === BLACK) {
      grad.addColorStop(0, "#5b5b68");
      grad.addColorStop(0.45, "#1d1d25");
      grad.addColorStop(1, "#08080c");
    } else {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.58, "#f2eee5");
      grad.addColorStop(1, "#cec6b6");
    }
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.strokeStyle =
      color === BLACK ? "rgba(255, 255, 255, 0.12)" : "rgba(96, 84, 66, 0.55)";
    ctx.lineWidth = Math.max(1, R * 0.08);
    ctx.stroke();
  }

  function drawLastMove(g) {
    var r = Math.floor(state.lastMove / SIZE);
    var c = state.lastMove % SIZE;
    var x = px(c, g.margin, g.spacing);
    var y = px(r, g.margin, g.spacing);
    ctx.beginPath();
    ctx.arc(x, y, g.stone * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#c9f44d";
    ctx.fill();
    ctx.lineWidth = Math.max(1, g.stone * 0.09);
    ctx.strokeStyle = "rgba(20, 28, 8, 0.8)";
    ctx.stroke();
  }

  function drawWinning(g) {
    var line = state.winning;
    var progress = state.winProgress;
    var a = line[0];
    var b = line[line.length - 1];
    var ax = px(a % SIZE, g.margin, g.spacing);
    var ay = px(Math.floor(a / SIZE), g.margin, g.spacing);
    var bx = px(b % SIZE, g.margin, g.spacing);
    var by = px(Math.floor(b / SIZE), g.margin, g.spacing);

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(201, 244, 77, 0.75)";
    ctx.lineWidth = Math.max(2, g.stone * 0.26);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + (bx - ax) * progress, ay + (by - ay) * progress);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(201, 244, 77, 0.9)";
    ctx.lineWidth = Math.max(1.5, g.stone * 0.12);
    for (var i = 0; i < line.length; i += 1) {
      var x = px(line[i] % SIZE, g.margin, g.spacing);
      var y = px(Math.floor(line[i] / SIZE), g.margin, g.spacing);
      ctx.beginPath();
      ctx.arc(x, y, g.stone * 0.92, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function requestDraw() {
    if (drawPending) {
      return;
    }
    drawPending = true;
    requestAnimationFrame(function () {
      drawPending = false;
      draw();
    });
  }

  function ensureAnim() {
    if (animating) {
      return;
    }
    animating = true;
    function frame() {
      draw();
      var now = performance.now();
      var active = false;
      if (state.placeAnim) {
        if (now - state.placeAnim.start < 180) {
          active = true;
        } else {
          state.placeAnim = null;
        }
      }
      if (state.winAnim) {
        var t = (now - state.winAnim.start) / 520;
        state.winProgress = Math.min(1, t);
        if (t < 1) {
          active = true;
        } else {
          state.winAnim = null;
        }
      }
      if (active) {
        requestAnimationFrame(frame);
      } else {
        animating = false;
        draw();
      }
    }
    requestAnimationFrame(frame);
  }

  /* --- input ------------------------------------------------------ */

  function eventToCell(e) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) {
      return null;
    }
    var scale = canvas.clientWidth / rect.width;
    var x = (e.clientX - rect.left) * scale;
    var y = (e.clientY - rect.top) * scale;
    var g = geometry();
    var col = Math.round((x - g.margin) / g.spacing);
    var row = Math.round((y - g.margin) / g.spacing);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) {
      return null;
    }
    var slack = g.spacing * 0.6;
    var maxX = g.margin + (SIZE - 1) * g.spacing;
    if (
      x < g.margin - slack ||
      x > maxX + slack ||
      y < g.margin - slack ||
      y > maxX + slack
    ) {
      return null;
    }
    return { r: row, c: col };
  }

  canvas.addEventListener("click", function (e) {
    if (!isHumanTurn()) {
      if (window.GameAudio) {
        window.GameAudio.gm.invalid();
      }
      return;
    }
    var hit = eventToCell(e);
    if (!hit || state.board[IDX(hit.r, hit.c)] !== EMPTY) {
      if (hit && window.GameAudio) {
        window.GameAudio.gm.invalid();
      }
      return;
    }
    humanMove(hit.r, hit.c);
  });

  canvas.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") {
      return;
    }
    var hit = isHumanTurn() ? eventToCell(e) : null;
    var next = hit && state.board[IDX(hit.r, hit.c)] === EMPTY ? IDX(hit.r, hit.c) : null;
    if (next !== state.hover) {
      state.hover = next;
      requestDraw();
    }
  });

  canvas.addEventListener("pointerleave", function () {
    if (state.hover != null) {
      state.hover = null;
      requestDraw();
    }
  });

  /* --- controls --------------------------------------------------- */

  sideBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.selectedSide = btn.dataset.gmSide === "white" ? WHITE : BLACK;
      updateSetupUi();
    });
  });

  diffBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.selectedDifficulty = btn.dataset.gmDifficulty;
      updateSetupUi();
    });
  });

  if (startBtn) {
    startBtn.addEventListener("click", startGame);
  }
  if (newBtn) {
    newBtn.addEventListener("click", newGame);
  }
  if (settingsBtn) {
    settingsBtn.addEventListener("click", changeSettings);
  }
  if (resultSettingsBtn) {
    resultSettingsBtn.addEventListener("click", changeSettings);
  }
  if (undoBtn) {
    undoBtn.addEventListener("click", undo);
  }
  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", newGame);
  }
  if (statsToggle) {
    statsToggle.addEventListener("click", function () {
      setStatsOpen(statsToggle.getAttribute("aria-expanded") !== "true");
    });
  }
  if (statsResetBtn) {
    statsResetBtn.addEventListener("click", onResetStats);
  }

  /* --- sound toggle ------------------------------------------------- */

  function applySoundPref() {
    if (!soundBtn || !window.GameAudio) {
      return;
    }
    var on = window.GameAudio.isEnabled();
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.textContent = on ? "Sound" : "Sound off";
  }

  if (soundBtn && window.GameAudio) {
    soundBtn.addEventListener("click", function () {
      window.GameAudio.toggle();
      applySoundPref();
    });
    applySoundPref();
  }

  window.addEventListener("resize", requestDraw);
  if (typeof window.ResizeObserver === "function") {
    new window.ResizeObserver(requestDraw).observe(canvas);
  }

  /* --- init ------------------------------------------------------- */

  updateSetupUi();
  renderStats();
  setStatsOpen(false);
  createWorker();
})();
