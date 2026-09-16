/* ------------------------------------------------------------------
   Reversi / Othello — randolf.dev
   Standard 8x8, player vs AI. Plain browser JS, no dependencies.

   Layers:
     rules / AI   -> assets/js/reversi-ai.js (shared with the worker)
     game state   -> this file (board, turn, passes, result)
     AI           -> Web Worker with a synchronous fallback
     rendering    -> CSS grid of 64 cells + 3D disc flips
     UI           -> setup, HUD, result panel, local statistics
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var AI = window.ReversiAI;
  var boardEl = document.querySelector("[data-rv-board]");
  if (!AI || !boardEl) {
    return;
  }

  var SIZE = AI.SIZE;
  var EMPTY = AI.EMPTY;
  var BLACK = AI.BLACK;
  var WHITE = AI.WHITE;
  var COLS = "ABCDEFGH";

  var DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };
  var DIFFS = ["easy", "medium", "hard"];
  var STATS_KEY = "randolf:reversi:stats:v1";
  var BUCKETS = [];
  DIFFS.forEach(function (d) {
    BUCKETS.push(d + ":black");
    BUCKETS.push(d + ":white");
  });

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  /* --- DOM -------------------------------------------------------- */

  var setupEl = document.querySelector("[data-rv-setup]");
  var gameEl = document.querySelector("[data-rv-game]");
  var sideBtns = Array.prototype.slice.call(
    document.querySelectorAll("[data-rv-side]")
  );
  var diffBtns = Array.prototype.slice.call(
    document.querySelectorAll("[data-rv-difficulty]")
  );
  var startBtn = document.querySelector("[data-rv-start]");
  var undoBtn = document.querySelector("[data-rv-undo]");
  var newBtn = document.querySelector("[data-rv-new]");
  var settingsBtn = document.querySelector("[data-rv-settings]");
  var resultSettingsBtn = document.querySelector("[data-rv-result-settings]");
  var statsToggle = document.querySelector("[data-rv-stats-toggle]");
  var statsPanel = document.querySelector("[data-rv-stats-panel]");
  var statsGrid = document.querySelector("[data-rv-stats-grid]");
  var statsResetBtn = document.querySelector("[data-rv-stats-reset]");
  var blackEl = document.querySelector("[data-rv-black]");
  var whiteEl = document.querySelector("[data-rv-white]");
  var youBlackEl = document.querySelector("[data-rv-you-black]");
  var youWhiteEl = document.querySelector("[data-rv-you-white]");
  var scoreBlackBox = document.querySelector(".rv-score--black");
  var scoreWhiteBox = document.querySelector(".rv-score--white");
  var turnEl = document.querySelector("[data-rv-turn]");
  var diffEl = document.querySelector("[data-rv-diff]");
  var movesEl = document.querySelector("[data-rv-moves]");
  var timeEl = document.querySelector("[data-rv-time]");
  var statusEl = document.querySelector("[data-rv-status]");
  var noticeEl = document.querySelector("[data-rv-notice]");
  var resultEl = document.querySelector("[data-rv-result]");
  var resultTitleEl = document.querySelector("[data-rv-result-title]");
  var resultCountsEl = document.querySelector("[data-rv-result-counts]");
  var resultMetaEl = document.querySelector("[data-rv-result-meta]");
  var playAgainBtn = document.querySelector("[data-rv-playagain]");

  var cellEls = [];
  var discEls = [];

  /* --- statistics ------------------------------------------------- */

  var stats = readStats();
  var resetTimer = null;

  function emptyBucket() {
    return {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
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
    out.draws = Math.min(
      count(raw.draws),
      out.gamesPlayed - out.wins - out.losses
    );
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
    board: AI.initialBoard(),
    current: BLACK,
    humanColor: BLACK,
    aiColor: WHITE,
    difficulty: "medium",
    selectedSide: BLACK,
    selectedDifficulty: "medium",
    status: "setup",
    result: null,
    lastMove: null,
    moveCount: 0,
    legalSet: [],
    decisionStack: [],
    animating: false,
    animId: 0,
    generation: 0,
    elapsed: 0,
    startTime: 0,
    timerId: null
  };

  var worker = null;
  var workerFailed = false;
  var watchdog = null;
  var noticeTimer = null;

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

  function colorLabel(color) {
    return color === BLACK ? "Black" : "White";
  }

  function coord(index) {
    return COLS.charAt(index % SIZE) + (Math.floor(index / SIZE) + 1);
  }

  function canUndo() {
    return (
      (state.status === "playing" || state.status === "thinking") &&
      !state.animating &&
      state.decisionStack.length > 0
    );
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
      worker = new Worker("../../assets/js/reversi-ai-worker.js");
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
    if (state.status !== "thinking") {
      return;
    }
    state.generation += 1;
    var token = state.generation;
    var budget =
      state.difficulty === "hard"
        ? 2000
        : state.difficulty === "medium"
        ? 800
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
      var result = AI.chooseMove(board, player, state.difficulty, 600);
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
    var legal =
      typeof move === "number" &&
      move >= 0 &&
      state.board[move] === EMPTY &&
      !!AI.flipsFor(state.board, move, state.aiColor);

    if (!legal) {
      var moves = AI.legalMoves(state.board, state.aiColor);
      if (!moves.length) {
        advanceTurn(state.aiColor);
        return;
      }
      move = moves[0];
    }
    doMove(move, state.aiColor);
  }

  /* --- moves ------------------------------------------------------ */

  function doMove(index, player) {
    var flips = AI.flipsFor(state.board, index, player) || [];
    var before = state.board.slice();
    AI.applyMove(state.board, index, player);
    state.moveCount += 1;
    state.lastMove = index;
    state.legalSet = [];
    hideNotice();

    var animId = (state.animId += 1);

    function after() {
      if (animId !== state.animId) {
        return; /* the game was reset / undone mid-animation */
      }
      state.animating = false;
      advanceTurn(player);
    }

    if (reducedMotion) {
      render();
      after();
      return;
    }

    state.animating = true;
    renderSnapshot(before);
    placeDisc(index, player, animId);
    flipDiscs(flips, player, animId, function () {
      if (animId !== state.animId) {
        return;
      }
      render();
      after();
    });
  }

  function advanceTurn(mover) {
    var nt = AI.nextTurn(state.board, mover);
    if (nt.over) {
      endGame();
      return;
    }
    state.current = nt.current;
    if (nt.pass) {
      showNotice(nt.passed);
    }
    if (state.current === state.humanColor) {
      state.status = "playing";
      state.legalSet = AI.legalMoves(state.board, state.humanColor);
      updateHud();
      render();
    } else {
      state.status = "thinking";
      updateHud();
      render();
      requestAi();
    }
  }

  function humanMove(index) {
    if (
      state.status !== "playing" ||
      state.current !== state.humanColor ||
      state.animating
    ) {
      return;
    }
    if (state.legalSet.indexOf(index) === -1) {
      return;
    }
    state.decisionStack.push(snapshot());
    doMove(index, state.humanColor);
  }

  function snapshot() {
    return {
      board: state.board.slice(),
      current: state.current,
      lastMove: state.lastMove,
      moveCount: state.moveCount
    };
  }

  function restore(snap) {
    state.board = snap.board.slice();
    state.current = snap.current;
    state.lastMove = snap.lastMove;
    state.moveCount = snap.moveCount;
    state.status = "playing";
    state.result = null;
    state.animating = false;
    state.animId += 1;
    state.legalSet = AI.legalMoves(state.board, state.humanColor);
    hideNotice();
    hideResult();
  }

  function undo() {
    if (!canUndo()) {
      return;
    }
    state.generation += 1;
    window.clearTimeout(watchdog);
    createWorker();
    restore(state.decisionStack.pop());
    updateHud();
    render();
  }

  /* --- lifecycle -------------------------------------------------- */

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
    state.board = AI.initialBoard();
    state.current = BLACK;
    state.lastMove = null;
    state.moveCount = 0;
    state.legalSet = [];
    state.decisionStack = [];
    state.result = null;
    state.animating = false;
    state.animId += 1;
    hideResult();
    hideNotice();
    startTimer();

    if (state.aiColor === BLACK) {
      state.status = "thinking";
      updateHud();
      render();
      requestAi();
    } else {
      state.status = "playing";
      state.legalSet = AI.legalMoves(state.board, state.humanColor);
      updateHud();
      render();
    }
  }

  function changeSettings() {
    state.generation += 1;
    window.clearTimeout(watchdog);
    createWorker();
    stopTimer();
    state.status = "setup";
    state.result = null;
    state.decisionStack = [];
    state.animating = false;
    state.animId += 1;
    hideResult();
    hideNotice();
    if (gameEl) {
      gameEl.hidden = true;
    }
    if (setupEl) {
      setupEl.hidden = false;
    }
    updateSetupUi();
  }

  function endGame() {
    stopTimer();
    state.status = "over";
    state.legalSet = [];
    var c = AI.discCount(state.board);
    state.result =
      c.black === c.white
        ? "draw"
        : (state.humanColor === BLACK ? c.black > c.white : c.white > c.black)
        ? "win"
        : "loss";
    recordResult(state.result);
    updateHud();
    render();
    showResult(state.result, c);
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
    } else if (result === "loss") {
      bucket.losses += 1;
      bucket.currentWinStreak = 0;
    } else {
      bucket.draws += 1;
      bucket.currentWinStreak = 0;
    }
    writeStats();
    renderStats();
  }

  /* --- UI updates ------------------------------------------------- */

  function updateHud() {
    var c = AI.discCount(state.board);
    setText(blackEl, String(c.black));
    setText(whiteEl, String(c.white));
    setText(youBlackEl, state.humanColor === BLACK ? "· You" : "· AI");
    setText(youWhiteEl, state.humanColor === WHITE ? "· You" : "· AI");
    boardEl.dataset.you = state.humanColor === BLACK ? "black" : "white";
    if (scoreBlackBox) {
      scoreBlackBox.classList.toggle("rv-score--you", state.humanColor === BLACK);
    }
    if (scoreWhiteBox) {
      scoreWhiteBox.classList.toggle("rv-score--you", state.humanColor === WHITE);
    }

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
      turn = state.current === state.humanColor ? "Your turn" : "AI turn";
      status = "Playing";
    }

    setText(turnEl, turn);
    if (turnEl) {
      turnEl.dataset.state =
        state.status === "over"
          ? state.result
          : state.status === "thinking"
          ? "thinking"
          : "playing";
    }
    setText(diffEl, DIFF_LABEL[state.difficulty]);
    setText(movesEl, String(state.moveCount));
    setText(timeEl, formatTime(state.elapsed));
    setText(statusEl, status);
    if (undoBtn) {
      undoBtn.disabled = !canUndo();
    }
  }

  function updateSetupUi() {
    sideBtns.forEach(function (btn) {
      var on =
        btn.dataset.rvSide === (state.selectedSide === BLACK ? "black" : "white");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-selected", on);
    });
    diffBtns.forEach(function (btn) {
      var on = btn.dataset.rvDifficulty === state.selectedDifficulty;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function showNotice(passed) {
    if (!noticeEl) {
      return;
    }
    noticeEl.hidden = false;
    noticeEl.textContent =
      "No legal move — " +
      (passed === state.humanColor ? "your turn passed" : "AI turn passed");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(hideNotice, 2400);
  }

  function hideNotice() {
    if (noticeEl) {
      noticeEl.hidden = true;
    }
    window.clearTimeout(noticeTimer);
  }

  function showResult(result, c) {
    if (!resultEl) {
      return;
    }
    resultEl.hidden = false;
    resultEl.dataset.result = result;
    if (resultTitleEl) {
      resultTitleEl.textContent =
        result === "win" ? "You win" : result === "loss" ? "AI wins" : "Draw";
    }
    if (resultCountsEl) {
      resultCountsEl.textContent = "Black " + c.black + " · White " + c.white;
    }
    if (resultMetaEl) {
      resultMetaEl.textContent =
        DIFF_LABEL[state.difficulty] +
        " · " +
        colorLabel(state.humanColor) +
        " · " +
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

  function row(label, value) {
    return (
      '<div class="rv-stats-row"><span class="mono">' +
      label +
      '</span><span class="mono">' +
      value +
      "</span></div>"
    );
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
          '<div class="rv-stats-block">' +
          '<p class="rv-stats-name mono">' +
          DIFF_LABEL[diff] +
          " \u00b7 " +
          colorLabel(color) +
          "</p>" +
          row("Games", b.gamesPlayed) +
          row("Wins", b.wins) +
          row("Losses", b.losses) +
          row("Draws", b.draws) +
          row("Win rate", rate) +
          row("Best streak", b.bestWinStreak) +
          "</div>";
      });
    });
    statsGrid.innerHTML = html;
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

  /* --- board rendering -------------------------------------------- */

  function buildBoard() {
    boardEl.textContent = "";
    cellEls = [];
    discEls = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < SIZE * SIZE; i += 1) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "rv-cell is-empty";
      cell.dataset.rvCell = String(i);
      cell.setAttribute("tabindex", "-1");
      var disc = document.createElement("span");
      disc.className = "rv-disc rv-disc--hidden";
      disc.setAttribute("aria-hidden", "true");
      cell.appendChild(disc);
      frag.appendChild(cell);
      cellEls.push(cell);
      discEls.push(disc);
    }
    boardEl.appendChild(frag);
  }

  function labelFor(index, value, legal) {
    var at = coord(index);
    if (value === BLACK) {
      return "Black disc at " + at;
    }
    if (value === WHITE) {
      return "White disc at " + at;
    }
    if (legal) {
      return "Legal move at " + at;
    }
    return "Empty at " + at;
  }

  function paintCell(index, value, legal) {
    var cell = cellEls[index];
    var disc = discEls[index];
    var occupied = value !== EMPTY;
    disc.classList.remove("is-flipping", "is-placing", "no-transition");
    cell.classList.toggle("is-empty", !occupied);
    cell.classList.toggle("is-occupied", occupied);
    disc.classList.toggle("rv-disc--hidden", !occupied);
    disc.classList.toggle("rv-disc--black", value === BLACK);
    disc.classList.toggle("rv-disc--white", value === WHITE);
    cell.classList.toggle("is-legal", !!legal);
    cell.setAttribute("tabindex", legal ? "0" : "-1");
    cell.setAttribute("aria-label", labelFor(index, value, legal));
    cell.classList.toggle(
      "is-last",
      state.lastMove === index && occupied && !legal
    );
  }

  function render() {
    for (var i = 0; i < SIZE * SIZE; i += 1) {
      var value = state.board[i];
      var legal =
        !state.animating &&
        state.status === "playing" &&
        state.current === state.humanColor &&
        value === EMPTY &&
        state.legalSet.indexOf(i) !== -1;
      paintCell(i, value, legal);
    }
  }

  function renderSnapshot(snapshotBoard) {
    for (var i = 0; i < SIZE * SIZE; i += 1) {
      paintCell(i, snapshotBoard[i], false);
    }
  }

  function placeDisc(index, player, animId) {
    var disc = discEls[index];
    disc.classList.remove("rv-disc--hidden", "rv-disc--black", "rv-disc--white");
    disc.classList.add(player === BLACK ? "rv-disc--black" : "rv-disc--white");
    disc.classList.add("is-placing");
    window.setTimeout(function () {
      if (animId !== state.animId) {
        return;
      }
      disc.classList.remove("is-placing");
    }, 170);
  }

  function flipDiscs(flips, player, animId, done) {
    if (!flips.length) {
      done();
      return;
    }
    var flipMs = 220;
    var stagger = Math.min(45, Math.floor(350 / flips.length));
    var last = 0;

    flips.forEach(function (index, k) {
      var disc = discEls[index];
      var start = k * stagger;
      last = Math.max(last, start + flipMs);

      window.setTimeout(function () {
        if (animId !== state.animId) {
          return;
        }
        disc.classList.add("is-flipping");
      }, start);
      window.setTimeout(function () {
        if (animId !== state.animId) {
          return;
        }
        disc.classList.remove("rv-disc--black", "rv-disc--white");
        disc.classList.add(player === BLACK ? "rv-disc--black" : "rv-disc--white");
      }, start + Math.floor(flipMs / 2));
      window.setTimeout(function () {
        if (animId !== state.animId) {
          return;
        }
        disc.classList.add("no-transition");
        disc.classList.remove("is-flipping");
        void disc.offsetWidth;
        disc.classList.remove("no-transition");
      }, start + flipMs);
    });

    window.setTimeout(done, last + 20);
  }

  /* --- input ------------------------------------------------------ */

  boardEl.addEventListener("click", function (e) {
    var cell = e.target.closest ? e.target.closest("[data-rv-cell]") : null;
    if (!cell || !boardEl.contains(cell)) {
      return;
    }
    humanMove(Number(cell.dataset.rvCell));
  });

  boardEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  /* --- controls --------------------------------------------------- */

  sideBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.selectedSide = btn.dataset.rvSide === "white" ? WHITE : BLACK;
      updateSetupUi();
    });
  });

  diffBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.selectedDifficulty = btn.dataset.rvDifficulty;
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

  /* --- init ------------------------------------------------------- */

  buildBoard();
  updateSetupUi();
  renderStats();
  setStatsOpen(false);
  createWorker();
  render();
})();
