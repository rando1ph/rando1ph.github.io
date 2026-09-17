/* ------------------------------------------------------------------
   Minesweeper — randolf.dev
   Plain browser game. No dependencies.

   Structure:
     - state          : single source of truth for one game
     - board helpers  : mine placement, neighbours, flood reveal
     - actions        : reveal, flag, chord
     - input          : mouse (left/right) + touch (tap / long press)
     - view           : DOM grid + HUD rendering
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var DIFFICULTIES = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 }
  };

  var STATUS_LABEL = {
    ready: "Ready",
    playing: "Playing",
    won: "Cleared",
    lost: "Game over"
  };

  var LONG_PRESS_MS = 450;
  var MOVE_CANCEL_PX = 10;
  var STATS_KEY = "randolf:minesweeper:stats:v1";
  var LEGACY_BEST_KEY = "randolf:minesweeper:best:v1";
  var DIFF_KEYS = ["beginner", "intermediate", "expert"];
  var DIFF_LABEL = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    expert: "Expert"
  };

  var boardEl = document.querySelector("[data-ms-board]");
  if (!boardEl) {
    return;
  }

  var msEl = document.querySelector(".ms");
  var minesEl = document.querySelector("[data-ms-mines]");
  var timerEl = document.querySelector("[data-ms-timer]");
  var lastEl = document.querySelector("[data-ms-last]");
  var bestEl = document.querySelector("[data-ms-best]");
  var winsEl = document.querySelector("[data-ms-wins]");
  var streakEl = document.querySelector("[data-ms-streak]");
  var statusEl = document.querySelector("[data-ms-status]");
  var restartBtn = document.querySelector("[data-ms-restart]");
  var diffBtns = Array.prototype.slice.call(
    document.querySelectorAll("[data-ms-difficulty]")
  );
  var resultEl = document.querySelector("[data-ms-result]");
  var resultTitleEl = document.querySelector("[data-ms-result-title]");
  var resultTimeEl = document.querySelector("[data-ms-result-time]");
  var resultBestRow = document.querySelector("[data-ms-result-best-row]");
  var resultBestEl = document.querySelector("[data-ms-result-best]");
  var resultNewEl = document.querySelector("[data-ms-result-new]");
  var playAgainBtn = document.querySelector("[data-ms-playagain]");
  var statsToggle = document.querySelector("[data-ms-stats-toggle]");
  var statsPanel = document.querySelector("[data-ms-stats-panel]");
  var statsGrid = document.querySelector("[data-ms-stats-grid]");
  var statsResetBtn = document.querySelector("[data-ms-stats-reset]");
  var soundBtn = document.querySelector("[data-ms-sound]");

  var state = null;
  var cellEls = [];
  var press = null;
  var touchContextGuard = 0;
  var shakeTimer = null;
  var resetTimer = null;

  /* --- Local statistics (localStorage, failure tolerant) ---------- */

  function emptyStats() {
    return {
      bestTime: null,
      lastGame: null,
      gamesPlayed: 0,
      wins: 0,
      currentWinStreak: 0,
      bestWinStreak: 0
    };
  }

  function toCount(value) {
    return typeof value === "number" && isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  }

  function sanitizeStats(raw) {
    var out = emptyStats();
    if (!raw || typeof raw !== "object") {
      return out;
    }
    if (
      typeof raw.bestTime === "number" &&
      isFinite(raw.bestTime) &&
      raw.bestTime >= 0
    ) {
      out.bestTime = Math.floor(raw.bestTime);
    }
    if (
      raw.lastGame &&
      typeof raw.lastGame === "object" &&
      (raw.lastGame.result === "won" || raw.lastGame.result === "lost") &&
      typeof raw.lastGame.time === "number" &&
      isFinite(raw.lastGame.time)
    ) {
      out.lastGame = {
        time: Math.max(0, Math.floor(raw.lastGame.time)),
        result: raw.lastGame.result,
        at: toCount(raw.lastGame.at)
      };
    }
    out.gamesPlayed = toCount(raw.gamesPlayed);
    out.wins = Math.min(toCount(raw.wins), out.gamesPlayed);
    out.currentWinStreak = toCount(raw.currentWinStreak);
    out.bestWinStreak = Math.max(
      toCount(raw.bestWinStreak),
      out.currentWinStreak
    );
    return out;
  }

  function readStats() {
    var out = {};
    DIFF_KEYS.forEach(function (key) {
      out[key] = emptyStats();
    });

    try {
      var raw = window.localStorage.getItem(STATS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          DIFF_KEYS.forEach(function (key) {
            if (parsed[key]) {
              out[key] = sanitizeStats(parsed[key]);
            }
          });
        }
      }
    } catch (err) {
      /* storage unavailable or corrupt — start fresh */
    }

    /* Migrate the pre-stats best-time key so existing records survive. */
    try {
      var legacyRaw = window.localStorage.getItem(LEGACY_BEST_KEY);
      if (legacyRaw) {
        var legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy === "object") {
          DIFF_KEYS.forEach(function (key) {
            var time = legacy[key];
            if (
              typeof time === "number" &&
              isFinite(time) &&
              time >= 0 &&
              out[key].bestTime == null
            ) {
              out[key].bestTime = Math.floor(time);
            }
          });
        }
      }
    } catch (err) {
      /* ignore legacy data problems */
    }

    return out;
  }

  function writeStats() {
    try {
      window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (err) {
      /* storage unavailable — statistics simply won't persist */
    }
    /* Keep the legacy best map in sync for backward compatibility. */
    try {
      var bestMap = {};
      DIFF_KEYS.forEach(function (key) {
        if (stats[key] && stats[key].bestTime != null) {
          bestMap[key] = stats[key].bestTime;
        }
      });
      window.localStorage.setItem(LEGACY_BEST_KEY, JSON.stringify(bestMap));
    } catch (err) {
      /* ignore */
    }
  }

  var stats = readStats();

  function currentStats() {
    return (state && stats[state.difficulty]) || emptyStats();
  }

  function recordGame(result, seconds) {
    var entry = stats[state.difficulty];
    if (!entry) {
      return false;
    }
    var time = Math.max(0, Math.floor(seconds));
    entry.gamesPlayed += 1;
    entry.lastGame = { time: time, result: result, at: Date.now() };

    if (result !== "won") {
      entry.currentWinStreak = 0;
      writeStats();
      return false;
    }

    entry.wins += 1;
    entry.currentWinStreak += 1;
    if (entry.currentWinStreak > entry.bestWinStreak) {
      entry.bestWinStreak = entry.currentWinStreak;
    }
    var isNewBest = entry.bestTime == null || time < entry.bestTime;
    if (isNewBest) {
      entry.bestTime = time;
    }
    writeStats();
    return isNewBest;
  }

  function resetStats() {
    DIFF_KEYS.forEach(function (key) {
      stats[key] = emptyStats();
    });
    writeStats();
  }

  /* --- Small helpers --------------------------------------------- */

  function formatTime(totalSeconds) {
    if (totalSeconds == null) {
      return "—";
    }
    var seconds = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? "0" + m : String(m)) + ":" + (s < 10 ? "0" + s : String(s));
  }

  function inBounds(r, c) {
    return r >= 0 && r < state.rows && c >= 0 && c < state.cols;
  }

  function eachNeighbour(r, c, fn) {
    for (var dr = -1; dr <= 1; dr += 1) {
      for (var dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) {
          continue;
        }
        var nr = r + dr;
        var nc = c + dc;
        if (inBounds(nr, nc)) {
          fn(nr, nc);
        }
      }
    }
  }

  function isPlayable() {
    return state && (state.status === "ready" || state.status === "playing");
  }

  /* --- Game setup ------------------------------------------------- */

  function newGame(diffKey) {
    var cfg = DIFFICULTIES[diffKey];
    if (!cfg) {
      return;
    }

    stopTimer();

    state = {
      difficulty: diffKey,
      rows: cfg.rows,
      cols: cfg.cols,
      mineCount: cfg.mines,
      board: [],
      status: "ready",
      started: false,
      flags: 0,
      revealed: 0,
      seconds: 0,
      timerId: null,
      exploded: null
    };

    for (var r = 0; r < state.rows; r += 1) {
      var row = [];
      for (var c = 0; c < state.cols; c += 1) {
        row.push({
          mine: false,
          revealed: false,
          flagged: false,
          questioned: false,
          adjacent: 0
        });
      }
      state.board.push(row);
    }

    if (msEl) {
      msEl.dataset.diff = diffKey;
    }

    hideResult();
    clearBoardState();
    buildBoardEl();
    updateHud();
    setStatus("ready");
  }

  function clearBoardState() {
    if (shakeTimer) {
      window.clearTimeout(shakeTimer);
      shakeTimer = null;
    }
    boardEl.classList.remove("is-won", "is-lost", "is-shaking", "is-entering");
  }

  function placeMines(safeR, safeC) {
    var forbidden = {};
    forbidden[safeR + ":" + safeC] = true;
    eachNeighbour(safeR, safeC, function (r, c) {
      forbidden[r + ":" + c] = true;
    });

    var candidates = [];
    for (var r = 0; r < state.rows; r += 1) {
      for (var c = 0; c < state.cols; c += 1) {
        if (!forbidden[r + ":" + c]) {
          candidates.push([r, c]);
        }
      }
    }

    for (var k = candidates.length - 1; k > 0; k -= 1) {
      var j = Math.floor(Math.random() * (k + 1));
      var tmp = candidates[k];
      candidates[k] = candidates[j];
      candidates[j] = tmp;
    }

    var minesToPlace = Math.min(state.mineCount, candidates.length);
    for (var m = 0; m < minesToPlace; m += 1) {
      state.board[candidates[m][0]][candidates[m][1]].mine = true;
    }
    state.mineCount = minesToPlace;

    for (var rr = 0; rr < state.rows; rr += 1) {
      for (var cc = 0; cc < state.cols; cc += 1) {
        if (state.board[rr][cc].mine) {
          continue;
        }
        var count = 0;
        eachNeighbour(rr, cc, function (nr, nc) {
          if (state.board[nr][nc].mine) {
            count += 1;
          }
        });
        state.board[rr][cc].adjacent = count;
      }
    }
  }

  /* --- Actions ---------------------------------------------------- */

  function revealCell(r, c) {
    if (!isPlayable()) {
      return;
    }
    var cell = state.board[r][c];
    if (cell.revealed || cell.flagged) {
      return;
    }

    if (!state.started) {
      state.started = true;
      placeMines(r, c);
      state.status = "playing";
      setStatus("playing");
      startTimer();
    }

    if (cell.mine) {
      lose(r, c);
      return;
    }

    floodReveal(r, c);
    if (window.GameAudio) {
      window.GameAudio.ms.reveal();
    }
    checkWin();
  }

  function floodReveal(r, c) {
    var stack = [[r, c]];
    while (stack.length) {
      var point = stack.pop();
      var cr = point[0];
      var cc = point[1];
      var cell = state.board[cr][cc];
      if (cell.revealed || cell.flagged || cell.mine) {
        continue;
      }
      cell.revealed = true;
      state.revealed += 1;
      renderCell(cr, cc);

      if (cell.adjacent === 0) {
        eachNeighbour(cr, cc, function (nr, nc) {
          var next = state.board[nr][nc];
          if (!next.revealed && !next.flagged) {
            stack.push([nr, nc]);
          }
        });
      }
    }
  }

  /* Classic three-state mark cycle: unmarked → flag → question → unmarked.
     Only flagged cells count toward MINES LEFT and chord. */
  function cycleMark(r, c) {
    if (!isPlayable()) {
      return;
    }
    var cell = state.board[r][c];
    if (cell.revealed) {
      return;
    }

    var wasFlagged = cell.flagged;
    var wasQuestioned = cell.questioned;

    if (!cell.flagged && !cell.questioned) {
      cell.flagged = true;
      cell.questioned = false;
    } else if (cell.flagged) {
      cell.flagged = false;
      cell.questioned = true;
    } else {
      cell.flagged = false;
      cell.questioned = false;
    }

    if (cell.flagged) {
      if (window.GameAudio) {
        window.GameAudio.ms.flag();
      }
    } else if (cell.questioned) {
      if (window.GameAudio) {
        window.GameAudio.ms.question();
      }
    }

    state.flags += (cell.flagged ? 1 : 0) - (wasFlagged ? 1 : 0);
    renderCell(r, c);

    if (wasQuestioned && !cell.questioned) {
      playMarkOut(r, c);
      if (window.GameAudio) {
        window.GameAudio.ms.markOut();
      }
    }

    updateMinesDisplay();
  }

  /* Brief fade for question → unmarked (the glyph class is already gone). */
  function playMarkOut(r, c) {
    var el = cellEls[r][c];
    if (!el) {
      return;
    }
    el.classList.add("is-questioned", "is-mark-out");
    window.setTimeout(function () {
      el.classList.remove("is-questioned", "is-mark-out");
    }, 150);
  }

  function chord(r, c) {
    var cell = state.board[r][c];
    if (!cell.revealed || cell.adjacent === 0) {
      return;
    }

    var flags = 0;
    eachNeighbour(r, c, function (nr, nc) {
      if (state.board[nr][nc].flagged) {
        flags += 1;
      }
    });
    if (flags !== cell.adjacent) {
      return;
    }

    var lost = false;
    eachNeighbour(r, c, function (nr, nc) {
      if (lost) {
        return;
      }
      var next = state.board[nr][nc];
      if (next.flagged || next.revealed) {
        return;
      }
      if (next.mine) {
        lost = true;
        lose(nr, nc);
        return;
      }
      floodReveal(nr, nc);
    });

    if (!lost) {
      if (window.GameAudio) {
        window.GameAudio.ms.reveal();
      }
      checkWin();
    }
  }

  function checkWin() {
    if (state.revealed === state.rows * state.cols - state.mineCount) {
      win();
    }
  }

  function win() {
    stopTimer();
    state.status = "won";

    for (var r = 0; r < state.rows; r += 1) {
      for (var c = 0; c < state.cols; c += 1) {
        var cell = state.board[r][c];
        if (cell.mine && !cell.flagged) {
          cell.flagged = true;
          cell.questioned = false;
          state.flags += 1;
        }
      }
    }

    renderAll();
    setStatus("won");

    if (window.GameAudio) {
      window.GameAudio.ms.win();
    }
    var isNewBest = recordGame("won", state.seconds);
    updateHud();
    applyWinAnimation();
    showResult("won", state.seconds, isNewBest);
  }

  function lose(r, c) {
    stopTimer();
    state.status = "lost";
    state.exploded = [r, c];
    state.board[r][c].revealed = true;

    for (var rr = 0; rr < state.rows; rr += 1) {
      for (var cc = 0; cc < state.cols; cc += 1) {
        var cell = state.board[rr][cc];
        if (cell.mine && !cell.flagged) {
          cell.revealed = true;
        }
      }
    }

    renderAll();
    setStatus("lost");
    if (window.GameAudio) {
      window.GameAudio.ms.mine();
    }
    recordGame("lost", state.seconds);
    updateHud();
    applyLoseAnimation(r, c);
    showResult("lost", state.seconds, false);
  }

  /* --- Timer ------------------------------------------------------ */

  function startTimer() {
    stopTimer();
    state.timerId = window.setInterval(function () {
      state.seconds += 1;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (state && state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  /* --- View ------------------------------------------------------- */

  function buildBoardEl() {
    boardEl.style.setProperty("--cols", state.cols);
    boardEl.textContent = "";
    cellEls = [];

    var frag = document.createDocumentFragment();
    for (var r = 0; r < state.rows; r += 1) {
      var rowEls = [];
      for (var c = 0; c < state.cols; c += 1) {
        var el = document.createElement("div");
        el.className = "ms-cell";
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.style.setProperty("--ms-i", String(r * state.cols + c));
        frag.appendChild(el);
        rowEls.push(el);
      }
      cellEls.push(rowEls);
    }
    boardEl.appendChild(frag);
    renderAll();

    boardEl.classList.remove("is-entering");
    void boardEl.offsetWidth;
    boardEl.classList.add("is-entering");
  }

  function renderAll() {
    for (var r = 0; r < state.rows; r += 1) {
      for (var c = 0; c < state.cols; c += 1) {
        renderCell(r, c);
      }
    }
  }

  function renderCell(r, c) {
    var cell = state.board[r][c];
    var el = cellEls[r][c];
    if (!el) {
      return;
    }
    el.className = "ms-cell";
    el.textContent = "";

    var mark;
    var label;

    if (cell.revealed) {
      el.classList.add("is-revealed");
      if (cell.mine) {
        el.classList.add("is-mine");
        mark = "mine";
        label = "Mine";
      } else if (cell.adjacent > 0) {
        el.classList.add("n" + cell.adjacent);
        el.textContent = String(cell.adjacent);
        mark = "n" + cell.adjacent;
        label = cell.adjacent + " adjacent";
      } else {
        mark = "empty";
        label = "Empty";
      }
    } else if (cell.flagged) {
      if (state.status === "lost" && !cell.mine) {
        el.classList.add("is-wrong");
        mark = "wrong";
        label = "Wrong flag";
      } else {
        el.classList.add("is-flagged");
        mark = "flag";
        label = "Flagged";
      }
    } else if (cell.questioned) {
      el.classList.add("is-questioned");
      mark = "question";
      label = "Question marked";
    } else {
      mark = "hidden";
      label = "Hidden";
    }

    if (
      state.exploded &&
      state.exploded[0] === r &&
      state.exploded[1] === c
    ) {
      el.classList.add("is-exploded");
      label = "Mine, triggered";
    }

    el.dataset.mark = mark;
    el.setAttribute("aria-label", label);
  }

  function updateHud() {
    if (!state) {
      return;
    }
    updateMinesDisplay();
    updateTimerDisplay();
    updateBestDisplay();
    updateStatsDisplays();
    updateDiffButtons();
  }

  function updateMinesDisplay() {
    if (minesEl && state) {
      minesEl.textContent = String(state.mineCount - state.flags);
    }
  }

  function updateTimerDisplay() {
    if (timerEl) {
      timerEl.textContent = formatTime(state ? state.seconds : 0);
    }
  }

  function updateBestDisplay() {
    if (!bestEl || !state) {
      return;
    }
    var best = currentStats().bestTime;
    bestEl.textContent = best == null ? "—" : formatTime(best);
  }

  function updateStatsDisplays() {
    if (!state) {
      return;
    }
    var entry = currentStats();

    if (lastEl) {
      if (entry.lastGame) {
        lastEl.textContent =
          formatTime(entry.lastGame.time) +
          " " +
          (entry.lastGame.result === "won" ? "WIN" : "LOSS");
        lastEl.dataset.result = entry.lastGame.result;
      } else {
        lastEl.textContent = "—";
        delete lastEl.dataset.result;
      }
    }

    if (winsEl) {
      winsEl.textContent = entry.wins + " / " + entry.gamesPlayed;
    }
    if (streakEl) {
      streakEl.textContent = String(entry.currentWinStreak);
    }

    renderStatsPanel();
  }

  function renderStatsPanel() {
    if (!statsGrid) {
      return;
    }
    var html = "";
    DIFF_KEYS.forEach(function (key) {
      var entry = stats[key];
      var rate = entry.gamesPlayed
        ? ((entry.wins / entry.gamesPlayed) * 100).toFixed(1) + "%"
        : "—";
      html +=
        '<div class="ms-stats-block">' +
        '<p class="ms-stats-name mono">' +
        DIFF_LABEL[key] +
        "</p>" +
        '<div class="ms-stats-row"><span class="mono">Games</span><span class="mono">' +
        entry.gamesPlayed +
        "</span></div>" +
        '<div class="ms-stats-row"><span class="mono">Wins</span><span class="mono">' +
        entry.wins +
        "</span></div>" +
        '<div class="ms-stats-row"><span class="mono">Win rate</span><span class="mono">' +
        rate +
        "</span></div>" +
        '<div class="ms-stats-row"><span class="mono">Best</span><span class="mono">' +
        (entry.bestTime == null ? "—" : formatTime(entry.bestTime)) +
        "</span></div>" +
        '<div class="ms-stats-row"><span class="mono">Best streak</span><span class="mono">' +
        entry.bestWinStreak +
        "</span></div>" +
        "</div>";
    });
    statsGrid.innerHTML = html;
  }

  function showResult(result, seconds, isNewBest) {
    if (!resultEl) {
      return;
    }
    resultEl.hidden = false;
    resultEl.dataset.result = result;
    if (resultTitleEl) {
      resultTitleEl.textContent = result === "won" ? "Cleared" : "Game over";
    }
    if (resultTimeEl) {
      resultTimeEl.textContent = formatTime(seconds);
    }
    if (resultBestRow) {
      resultBestRow.hidden = result !== "won";
    }
    if (resultBestEl) {
      var best = currentStats().bestTime;
      resultBestEl.textContent = best == null ? "—" : formatTime(best);
    }
    if (resultNewEl) {
      resultNewEl.hidden = !isNewBest;
    }
    resultEl.classList.remove("is-shown");
    void resultEl.offsetWidth;
    resultEl.classList.add("is-shown");
  }

  function hideResult() {
    if (!resultEl) {
      return;
    }
    resultEl.hidden = true;
    resultEl.classList.remove("is-shown");
  }

  function applyWinAnimation() {
    boardEl.classList.add("is-won");
  }

  function applyLoseAnimation(r, c) {
    boardEl.classList.add("is-lost", "is-shaking");
    if (shakeTimer) {
      window.clearTimeout(shakeTimer);
    }
    shakeTimer = window.setTimeout(function () {
      boardEl.classList.remove("is-shaking");
      shakeTimer = null;
    }, 320);

    for (var rr = 0; rr < state.rows; rr += 1) {
      for (var cc = 0; cc < state.cols; cc += 1) {
        if (!state.board[rr][cc].mine) {
          continue;
        }
        var el = cellEls[rr][cc];
        if (!el) {
          continue;
        }
        if (rr === r && cc === c) {
          el.style.animationDelay = "0ms";
          continue;
        }
        var distance = Math.max(Math.abs(rr - r), Math.abs(cc - c));
        el.style.animationDelay = Math.min(distance, 12) * 22 + 120 + "ms";
      }
    }
  }

  function setStatsOpen(open) {
    if (statsPanel) {
      statsPanel.hidden = !open;
    }
    if (statsToggle) {
      statsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function onResetStatsClick() {
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
      updateHud();
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

  function updateDiffButtons() {
    diffBtns.forEach(function (btn) {
      var on = state && btn.dataset.msDifficulty === state.difficulty;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setStatus(key) {
    if (statusEl) {
      statusEl.textContent = STATUS_LABEL[key] || key;
      statusEl.dataset.status = key;
    }
  }

  /* --- Input: mouse + touch --------------------------------------- */

  function cellFromEvent(e) {
    var target = e.target;
    if (!target || typeof target.closest !== "function") {
      return null;
    }
    var el = target.closest(".ms-cell");
    if (!el || !boardEl.contains(el)) {
      return null;
    }
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  }

  function clearPressTimer() {
    if (press && press.timer) {
      window.clearTimeout(press.timer);
      press.timer = null;
    }
  }

  function endPress() {
    clearPressTimer();
    press = null;
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) {
      return; /* right button is handled by contextmenu */
    }
    if (press) {
      return; /* ignore extra pointers (e.g. pinch) */
    }
    var hit = cellFromEvent(e);
    if (!hit) {
      return;
    }

    if ((e.pointerType || "mouse") !== "mouse") {
      /* Mobile browsers may fire contextmenu around a long press.
         Suppress flagging from that path; pointer logic owns touch. */
      touchContextGuard = Date.now() + 1200;
    }

    press = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || "mouse",
      r: hit.r,
      c: hit.c,
      startX: e.clientX,
      startY: e.clientY,
      longFired: false,
      cancelled: false,
      timer: null
    };

    if (press.pointerType !== "mouse") {
      press.timer = window.setTimeout(function () {
        if (!press) {
          return;
        }
        press.longFired = true;
        cycleMark(press.r, press.c);
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e) {
    if (!press || e.pointerId !== press.pointerId) {
      return;
    }
    var dx = e.clientX - press.startX;
    var dy = e.clientY - press.startY;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
      clearPressTimer();
      press.cancelled = true;
    }
  }

  function onPointerUp(e) {
    if (!press || e.pointerId !== press.pointerId) {
      return;
    }
    var p = press;
    endPress();

    if (p.cancelled || p.longFired) {
      return;
    }
    if (p.pointerType === "mouse" && e.button !== 0) {
      return;
    }

    if (state.board[p.r][p.c].revealed) {
      chord(p.r, p.c);
    } else {
      revealCell(p.r, p.c);
    }
  }

  function onPointerCancel(e) {
    if (press && e.pointerId === press.pointerId) {
      endPress();
    }
  }

  boardEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);

  boardEl.addEventListener("animationend", function (e) {
    if (e.animationName === "ms-board-in") {
      boardEl.classList.remove("is-entering");
    }
  });

  boardEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    /* Touch long press is handled by the pointer logic; ignore the
       context menu some mobile browsers fire alongside it. */
    if (press && press.pointerType !== "mouse") {
      return;
    }
    if (Date.now() < touchContextGuard) {
      return;
    }
    var hit = cellFromEvent(e);
    if (hit) {
      cycleMark(hit.r, hit.c);
    }
  });

  restartBtn.addEventListener("click", function () {
    if (state) {
      newGame(state.difficulty);
    }
  });

  diffBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      newGame(btn.dataset.msDifficulty);
    });
  });

  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", function () {
      if (state) {
        newGame(state.difficulty);
      }
    });
  }

  if (statsToggle) {
    statsToggle.addEventListener("click", function () {
      var open = statsToggle.getAttribute("aria-expanded") === "true";
      setStatsOpen(!open);
    });
  }

  if (statsResetBtn) {
    statsResetBtn.addEventListener("click", onResetStatsClick);
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

  setStatsOpen(false);
  newGame("beginner");
})();
