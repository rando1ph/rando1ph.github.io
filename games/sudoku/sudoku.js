/* ------------------------------------------------------------------
   Sudoku — randolf.dev
   UI, controls, persistence and worker orchestration.

   Board state lives entirely in `state`; the DOM is only a projection.
   Puzzle generation runs in sudoku-worker.js (with a synchronous
   fallback) and the next puzzle is pre-generated in the background.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  function findAnswerErrors(values, solution, given) {
    var errors = [];
    for (var i = 0; i < values.length; i += 1) {
      if (!given[i] && values[i] !== 0 && values[i] !== solution[i]) errors.push(i);
    }
    return errors;
  }

  /* Keep the answer comparison testable without loading the UI. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { findAnswerErrors: findAnswerErrors };
  }
  if (typeof window === "undefined") return;

  var E = window.SudokuEngine;
  var root = document.querySelector(".sd");
  if (!E || !root) return;

  var STORAGE_KEY = "randolf:sudoku:v1";
  var PREF_KEY = "randolf:sudoku:difficulty";
  var SAVE_VERSION = 1;
  var MAX_UNDO = 400;
  var DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

  /* ------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------ */

  var board = root.querySelector("[data-sd-board]");
  var overlay = root.querySelector("[data-sd-overlay]");
  var panels = {
    generating: root.querySelector('[data-sd-panel="generating"]'),
    confirm: root.querySelector('[data-sd-panel="confirm"]'),
    complete: root.querySelector('[data-sd-panel="complete"]')
  };
  var padHost = root.querySelector("[data-sd-pad]");
  var feedbackEl = root.querySelector("[data-sd-feedback]");
  var liveEl = root.querySelector("[data-sd-live]");
  var timerEl = root.querySelector("[data-sd-timer]");
  var hintsEl = root.querySelector("[data-sd-hints]");
  var notesBtn = root.querySelector("[data-sd-notes]");
  var eraseBtn = root.querySelector("[data-sd-erase]");
  var undoBtn = root.querySelector("[data-sd-undo]");
  var hintBtn = root.querySelector("[data-sd-hint]");
  var checkBtn = root.querySelector("[data-sd-check]");
  var restartBtn = root.querySelector("[data-sd-restart]");
  var newBtns = [
    root.querySelector("[data-sd-new-bar]"),
    root.querySelector("[data-sd-new]"),
    root.querySelector("[data-sd-replay]")
  ];
  var confirmTitle = root.querySelector("[data-sd-confirm-title]");
  var confirmNote = root.querySelector("[data-sd-confirm-note]");
  var confirmBtn = root.querySelector("[data-sd-confirm]");
  var cancelBtn = root.querySelector("[data-sd-cancel]");
  var generatingNote = root.querySelector("[data-sd-generating-note]");
  var completeDiff = root.querySelector("[data-sd-complete-diff]");
  var completeTime = root.querySelector("[data-sd-complete-time]");
  var completeHints = root.querySelector("[data-sd-complete-hints]");
  var diffBtns = Array.prototype.slice.call(root.querySelectorAll("[data-sd-diff]"));
  var soundBtn = root.querySelector("[data-sd-sound]");

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  var state = {
    difficulty: "easy",
    generatorVersion: E.GENERATOR_VERSION,
    seed: 0,
    puzzle: null,
    solution: null,
    values: null,
    notes: null,
    given: null,
    selected: null,
    notesMode: false,
    hintCount: 0,
    completed: false,
    hints: null,
    conflict: null,
    undoStack: [],
    generating: false,
    elapsedBase: 0,
    elapsedStart: 0
  };

  var cells = [];
  var noteNodes = [];
  var valNodes = [];
  var padKeys = {};
  var padCounts = {};
  var confirmAction = null;
  var prefetch = null;
  var worker = null;
  var workerBroken = false;
  var msgId = 0;
  var pendingMsgs = {};
  /* UI-only: never included in saves or Undo snapshots. */
  var checkErrors = [];
  var checkTimer = null;
  var CHECK_DURATION = 900; /* Matches 300ms × 3 CSS pulses. */

  function rowOf(i) {
    return E.rowOf(i);
  }
  function colOf(i) {
    return E.colOf(i);
  }
  function boxOf(i) {
    return E.boxOf(i);
  }
  function bit(d) {
    return 1 << (d - 1);
  }
  function formatTime(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = (total / 3600) | 0;
    var m = ((total % 3600) / 60) | 0;
    var s = total % 60;
    var mm = String(m).padStart(2, "0");
    var ss = String(s).padStart(2, "0");
    return h > 0 ? h + ":" + mm + ":" + ss : mm + ":" + ss;
  }
  function randomSeed() {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint32Array(1);
        window.crypto.getRandomValues(a);
        return a[0] >>> 0;
      }
    } catch (e) {
      /* fall through */
    }
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  /* ------------------------------------------------------------------
     Audio — routed through the shared helper when present
     ------------------------------------------------------------------ */

  function cue(name) {
    var ga = window.GameAudio;
    if (ga && ga.sd && typeof ga.sd[name] === "function") {
      ga.sd[name]();
    }
  }
  function syncSoundButton() {
    var ga = window.GameAudio;
    if (!ga) {
      soundBtn.hidden = true;
      return;
    }
    var on = ga.isEnabled();
    soundBtn.textContent = on ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /* ------------------------------------------------------------------
     Persistence
     ------------------------------------------------------------------ */

  function readRaw(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function writeRaw(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isIntBoard(arr, min, max) {
    if (!arr || arr.length !== 81) return false;
    for (var i = 0; i < 81; i += 1) {
      var v = arr[i];
      if (typeof v !== "number" || v < min || v > max || v !== (v | 0)) return false;
    }
    return true;
  }

  function validateSaved(data) {
    if (!data || typeof data !== "object") return false;
    if (data.v !== SAVE_VERSION) return false;
    if (E.DIFFICULTIES.indexOf(data.difficulty) === -1) return false;
    if (!isIntBoard(data.puzzle, 0, 9)) return false;
    if (!isIntBoard(data.solution, 1, 9)) return false;
    if (!isIntBoard(data.values, 0, 9)) return false;
    if (!isIntBoard(data.notes, 0, 511)) return false;
    if (!E.isSolved(data.solution)) return false;
    if (E.findConflicts(data.puzzle) !== null) return false;
    if (E.countSolutions(data.puzzle, 2) !== 1) return false;
    var solved = E.solve(data.puzzle);
    if (!solved || !E.boardsEqual(solved, data.solution)) return false;
    for (var i = 0; i < 81; i += 1) {
      var p = data.puzzle[i];
      if (p && data.values[i] !== p) return false;
      if (p && data.solution[i] !== p) return false;
      if (!p && data.values[i] && E.findConflicts(data.puzzle) !== null) return false;
    }
    return true;
  }

  function loadSaved() {
    var raw = readRaw(STORAGE_KEY);
    if (!raw) return null;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    return validateSaved(data) ? data : null;
  }

  function saveState() {
    if (state.generating || !state.puzzle) return;
    var payload = {
      v: SAVE_VERSION,
      generatorVersion: state.generatorVersion,
      difficulty: state.difficulty,
      seed: state.seed,
      puzzle: state.puzzle,
      solution: state.solution,
      values: state.values,
      notes: state.notes,
      elapsedMs: Math.round(elapsedMs()),
      hintCount: state.hintCount,
      completed: state.completed,
      selected: state.selected,
      notesMode: state.notesMode
    };
    writeRaw(STORAGE_KEY, JSON.stringify(payload));
  }

  function preferredDifficulty() {
    var d = readRaw(PREF_KEY);
    return E.DIFFICULTIES.indexOf(d) !== -1 ? d : "easy";
  }

  /* ------------------------------------------------------------------
     Timer
     ------------------------------------------------------------------ */

  function elapsedMs() {
    if (!state.puzzle) return 0;
    if (state.completed) return state.elapsedBase;
    return state.elapsedBase + (Date.now() - state.elapsedStart);
  }

  function renderTimer() {
    timerEl.textContent = formatTime(elapsedMs());
  }

  function resetTimer() {
    state.elapsedBase = 0;
    state.elapsedStart = Date.now();
    renderTimer();
  }

  /* ------------------------------------------------------------------
     Worker generation
     ------------------------------------------------------------------ */

  function ensureWorker() {
    if (worker || workerBroken || typeof window.Worker === "undefined") return worker;
    try {
      worker = new Worker("sudoku-worker.js");
      worker.onmessage = onWorkerMessage;
      worker.onerror = function () {
        workerBroken = true;
        worker = null;
        Object.keys(pendingMsgs).forEach(function (id) {
          var p = pendingMsgs[id];
          delete pendingMsgs[id];
          p.resolve(syncGenerate(p.difficulty, p.seed));
        });
      };
    } catch (e) {
      workerBroken = true;
      worker = null;
    }
    return worker;
  }

  function onWorkerMessage(e) {
    var d = e.data;
    if (!d || typeof d.id !== "number") return;
    var p = pendingMsgs[d.id];
    if (!p) return;
    delete pendingMsgs[d.id];
    p.resolve(d.ok ? d.payload : null);
  }

  function syncGenerate(difficulty, seed) {
    try {
      var res = E.generateForDifficulty(difficulty, seed, {
        maxAttempts: 600,
        timeBudgetMs: 6000
      });
      return res.ok ? res.result : null;
    } catch (e) {
      return null;
    }
  }

  function requestGeneration(difficulty, seed) {
    return new Promise(function (resolve) {
      var w = ensureWorker();
      if (!w) {
        setTimeout(function () {
          resolve(syncGenerate(difficulty, seed));
        }, 0);
        return;
      }
      var id = (msgId += 1);
      pendingMsgs[id] = { resolve: resolve, difficulty: difficulty, seed: seed };
      w.postMessage({ id: id, type: "generate", difficulty: difficulty, seed: seed });
    });
  }

  function startPrefetch(difficulty) {
    if (prefetch && prefetch.difficulty === difficulty) return;
    requestGeneration(difficulty, randomSeed()).then(function (res) {
      if (res && res.difficulty === difficulty) {
        prefetch = { difficulty: difficulty, result: res };
      }
    });
  }

  /* ------------------------------------------------------------------
     Overlay helpers
     ------------------------------------------------------------------ */

  function showPanel(name) {
    clearCheck();
    overlay.hidden = false;
    Object.keys(panels).forEach(function (k) {
      panels[k].hidden = k !== name;
    });
    setControlsDisabled(state.generating);
  }
  function hideOverlay() {
    overlay.hidden = true;
    setControlsDisabled(state.generating);
  }
  function setGenerating(on) {
    state.generating = on;
    if (on) {
      generatingNote.textContent = DIFF_LABEL[state.difficulty] + " — solving logic takes a moment";
      showPanel("generating");
    } else {
      hideOverlay();
    }
    setControlsDisabled(on);
  }
  function setControlsDisabled(on) {
    var gameplayDisabled = on || state.completed || !overlay.hidden;
    diffBtns.forEach(function (b) {
      b.disabled = on;
    });
    Object.keys(padKeys).forEach(function (d) {
      padKeys[d].disabled = gameplayDisabled;
    });
    [notesBtn, eraseBtn, hintBtn, checkBtn].forEach(function (b) {
      if (b) b.disabled = gameplayDisabled;
    });
    [restartBtn, newBtns[0]].forEach(function (b) {
      if (b) b.disabled = on;
    });
    undoBtn.disabled = gameplayDisabled || state.undoStack.length === 0;
  }
  function askConfirm(title, note, label, onConfirm) {
    confirmAction = onConfirm;
    confirmTitle.textContent = title;
    confirmNote.textContent = note;
    confirmBtn.textContent = label;
    showPanel("confirm");
  }

  /* ------------------------------------------------------------------
     Board construction
     ------------------------------------------------------------------ */

  (function buildBoard() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 81; i += 1) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "sd-cell";
      cell.dataset.idx = String(i);
      cell.style.setProperty("--sd-b", String(boxOf(i)));
      var val = document.createElement("span");
      val.className = "sd-val";
      cell.appendChild(val);
      var notes = document.createElement("span");
      notes.className = "sd-notes";
      var noteList = [];
      for (var d = 1; d <= 9; d += 1) {
        var n = document.createElement("i");
        n.textContent = String(d);
        n.hidden = true;
        notes.appendChild(n);
        noteList.push(n);
      }
      cell.appendChild(notes);
      frag.appendChild(cell);
      cells.push(cell);
      valNodes.push(val);
      noteNodes.push(noteList);
    }
    board.appendChild(frag);

    board.addEventListener("click", function (ev) {
      var cell = ev.target.closest(".sd-cell");
      if (!cell || !board.contains(cell)) return;
      selectCell(Number(cell.dataset.idx));
    });
  })();

  (function buildPad() {
    var frag = document.createDocumentFragment();
    for (var d = 1; d <= 9; d += 1) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sd-key";
      b.dataset.digit = String(d);
      b.innerHTML = '<span class="sd-key-num">' + d + '</span><span class="sd-key-count"></span>';
      frag.appendChild(b);
      padKeys[d] = b;
      padCounts[d] = b.querySelector(".sd-key-count");
    }
    padHost.appendChild(frag);
    padHost.addEventListener("click", function (ev) {
      var b = ev.target.closest(".sd-key");
      if (!b) return;
      inputDigit(Number(b.dataset.digit));
    });
  })();

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */

  function labelFor(i) {
    var base = "Row " + (rowOf(i) + 1) + " Column " + (colOf(i) + 1) + ", ";
    if (state.given[i]) return base + "given " + state.puzzle[i];
    if (state.values[i]) return base + "entered " + state.values[i];
    var note = state.notes[i];
    if (note) {
      var digits = [];
      for (var d = 1; d <= 9; d += 1) if (note & bit(d)) digits.push(d);
      return base + "notes " + digits.join(" ");
    }
    return base + "empty";
  }

  function sameUnit(a, b) {
    return (
      a !== b &&
      (rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b))
    );
  }

  function render() {
    var sel = state.selected;
    var selDigit = sel !== null ? state.values[sel] : 0;
    var hintSet = state.hints ? state.hints.cells : null;

    for (var i = 0; i < 81; i += 1) {
      var cell = cells[i];
      var v = state.values[i];
      cell.className = "sd-cell";
      if (state.given[i]) cell.classList.add("is-given");
      else if (v) cell.classList.add("is-entry");
      if (state.conflict && state.conflict[i]) cell.classList.add("is-conflict");
      if (checkErrors.indexOf(i) !== -1) cell.classList.add("is-check-error");
      if (hintSet && hintSet.indexOf(i) !== -1) cell.classList.add("is-hint");
      if (sel !== null) {
        if (i === sel) cell.classList.add("is-sel");
        else {
          if (sameUnit(i, sel)) cell.classList.add("is-peer");
          if (selDigit && v === selDigit) cell.classList.add("is-same");
        }
      }

      if (v) {
        valNodes[i].textContent = String(v);
        valNodes[i].hidden = false;
        cell.classList.add("has-value");
      } else {
        valNodes[i].textContent = "";
        valNodes[i].hidden = true;
        cell.classList.remove("has-value");
      }

      var note = state.notes[i];
      var noteList = noteNodes[i];
      for (var d = 1; d <= 9; d += 1) {
        noteList[d - 1].hidden = !(note & bit(d));
      }

      cell.setAttribute("aria-label", labelFor(i));
      if (state.given[i]) cell.setAttribute("aria-disabled", "true");
      else cell.removeAttribute("aria-disabled");
    }

    renderPad();
    hintsEl.textContent = String(state.hintCount);
    setControlsDisabled(state.generating);
  }

  function renderPad() {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 81; i += 1) if (state.values[i]) counts[state.values[i]] += 1;
    for (var d = 1; d <= 9; d += 1) {
      var remaining = 9 - counts[d];
      padCounts[d].textContent = remaining > 0 ? String(remaining) : "";
      padKeys[d].classList.toggle("is-done", remaining <= 0);
      padKeys[d].setAttribute("aria-label", "Enter " + d + (remaining <= 0 ? ", all placed" : ", " + remaining + " remaining"));
    }
  }

  function selectCell(i) {
    if (i < 0 || i > 80) return;
    if (state.selected === i) return;
    state.selected = i;
    state.hints = null;
    if (cells[i]) {
      try {
        cells[i].focus({ preventScroll: true });
      } catch (e) {
        cells[i].focus();
      }
    }
    render();
    saveState();
  }

  function moveSelection(dr, dc) {
    var i = state.selected;
    var r, c;
    if (i === null) {
      r = 0;
      c = 0;
    } else {
      r = rowOf(i);
      c = colOf(i);
    }
    r = Math.min(8, Math.max(0, r + dr));
    c = Math.min(8, Math.max(0, c + dc));
    selectCell(r * 9 + c);
  }

  function feedback(text, kind) {
    feedbackEl.textContent = text || "";
    feedbackEl.className = "sd-feedback mono" + (kind ? " is-" + kind : "");
  }
  function announce(text) {
    liveEl.textContent = text;
  }

  /* ------------------------------------------------------------------
     Editing
     ------------------------------------------------------------------ */

  function snapshot() {
    return {
      values: state.values.slice(),
      notes: state.notes.slice(),
      selected: state.selected
    };
  }
  function pushUndo() {
    state.undoStack.push(snapshot());
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  }
  function clearHint() {
    state.hints = null;
  }
  function recomputeConflict() {
    state.conflict = E.findConflicts(state.values);
  }

  function cleanupPeerNotes(i, d) {
    var peers = E.peersOf(i);
    for (var k = 0; k < peers.length; k += 1) {
      state.notes[peers[k]] &= ~bit(d);
    }
  }

  function commit() {
    clearCheck();
    clearHint();
    recomputeConflict();
    render();
    saveState();
    if (!state.completed && E.isSolved(state.values)) {
      complete();
    }
  }

  function inputDigit(d) {
    if (state.generating || state.completed) return;
    var i = state.selected;
    if (i === null) {
      feedback("Select a cell first.", "warn");
      return;
    }
    if (state.given[i]) {
      feedback("That is a given clue.", "warn");
      return;
    }

    if (state.notesMode) {
      pushUndo();
      if (state.values[i]) {
        state.values[i] = 0;
        state.notes[i] = bit(d);
      } else {
        state.notes[i] ^= bit(d);
      }
      saveState();
      cue("note");
      commit();
      return;
    }

    pushUndo();
    if (state.values[i] === d) {
      state.values[i] = 0;
      cue("erase");
    } else {
      state.values[i] = d;
      state.notes[i] = 0;
      cleanupPeerNotes(i, d);
      cue("place");
    }
    feedback("");
    commit();
  }

  function erase() {
    if (state.generating || state.completed) return;
    var i = state.selected;
    if (i === null) {
      feedback("Select a cell first.", "warn");
      return;
    }
    if (state.given[i]) {
      feedback("That is a given clue.", "warn");
      return;
    }
    if (!state.values[i] && !state.notes[i]) return;
    pushUndo();
    state.values[i] = 0;
    state.notes[i] = 0;
    cue("erase");
    feedback("");
    commit();
  }

  function undo() {
    if (state.generating || state.completed) return;
    if (!state.undoStack.length) return;
    clearCheck();
    var s = state.undoStack.pop();
    state.values = s.values;
    state.notes = s.notes;
    state.selected = s.selected;
    clearHint();
    recomputeConflict();
    cue("undo");
    render();
    saveState();
  }

  function toggleNotes() {
    state.notesMode = !state.notesMode;
    notesBtn.classList.toggle("is-active", state.notesMode);
    notesBtn.setAttribute("aria-pressed", state.notesMode ? "true" : "false");
    feedback(state.notesMode ? "Notes on — digits toggle pencil marks." : "Notes off.");
    saveState();
  }

  /* ------------------------------------------------------------------
     Check — compare existing entries, without changing gameplay state
     ------------------------------------------------------------------ */

  function clearCheck() {
    clearTimeout(checkTimer);
    checkTimer = null;
    checkErrors.forEach(function (i) {
      cells[i].classList.remove("is-check-error");
    });
    checkErrors = [];
  }

  function doCheck() {
    if (state.generating || state.completed || !state.solution || !overlay.hidden) return;
    clearCheck();
    checkErrors = findAnswerErrors(state.values, state.solution, state.given);
    if (checkErrors.length) {
      /* Flush removal so another Check restarts the CSS animation cleanly. */
      void board.offsetWidth;
      checkErrors.forEach(function (i) {
        cells[i].classList.add("is-check-error");
      });
      checkTimer = setTimeout(clearCheck, CHECK_DURATION);
    }
    var count = checkErrors.length;
    var text = count ? count + (count === 1 ? " mistake found." : " mistakes found.") :
      "No mistakes so far.";
    feedback(text, count ? "warn" : "");
    announce(text);
  }

  /* ------------------------------------------------------------------
     Hints
     ------------------------------------------------------------------ */

  function doHint() {
    if (state.generating || state.completed) return;
    var res = E.findHint(state.values);
    if (res.type === "complete") {
      feedback("The puzzle is already complete.");
      return;
    }
    if (res.type === "conflict") {
      state.conflict = res.conflicts;
      state.hints = null;
      feedback("Resolve the highlighted conflict before asking for a hint.", "warn");
      render();
      announce("Conflict on the board.");
      cue("error");
      return;
    }
    if (res.type === "unsolvable") {
      state.hints = null;
      state.conflict = E.findConflicts(state.values);
      feedback("These entries cannot lead to a solution. Undo a step and reconsider.", "warn");
      render();
      announce("Current entries cannot lead to a solution.");
      cue("error");
      return;
    }
    if (res.type === "stalled") {
      state.hints = null;
      feedback("No simple next step from here. Look elsewhere or undo a guess.", "note");
      render();
      announce("No simple next step available.");
      return;
    }

    var step = res.step;
    var marked = [];
    if (step.cells) {
      for (var k = 0; k < step.cells.length; k += 1) marked.push(step.cells[k]);
    }
    if (step.eliminations) {
      for (var e = 0; e < step.eliminations.length; e += 1) {
        if (marked.indexOf(step.eliminations[e][0]) === -1) marked.push(step.eliminations[e][0]);
      }
    }
    state.hints = { cells: marked, step: step };
    state.hintCount += 1;
    feedback(E.describeHint(step), "note");
    render();
    saveState();
    announce("Hint: " + E.describeHint(step));
    cue("hint");
  }

  /* ------------------------------------------------------------------
     Completion / restart / new puzzle
     ------------------------------------------------------------------ */

  function complete() {
    clearCheck();
    var total = elapsedMs();
    state.completed = true;
    state.elapsedBase = total;
    state.elapsedStart = Date.now();
    state.hints = null;
    state.selected = null;
    state.conflict = null;
    board.classList.add("is-complete");
    completeDiff.textContent = DIFF_LABEL[state.difficulty];
    completeTime.textContent = formatTime(total);
    completeHints.textContent = String(state.hintCount);
    render();
    showPanel("complete");
    saveState();
    cue("complete");
    announce("Puzzle complete in " + formatTime(total) + ", with " + state.hintCount + " hints.");
  }

  function hasProgress() {
    if (!state.puzzle) return false;
    for (var i = 0; i < 81; i += 1) {
      if (state.given[i]) continue;
      if (state.values[i] || state.notes[i]) return true;
    }
    return false;
  }

  function restart(force) {
    clearCheck();
    if (!force && hasProgress()) {
      askConfirm("Restart puzzle?", "Your entries and notes will be cleared.", "Restart", function () {
        restart(true);
      });
      return;
    }
    state.values = state.puzzle.slice();
    state.notes = new Array(81).fill(0);
    state.selected = null;
    state.hints = null;
    state.conflict = null;
    state.undoStack = [];
    state.completed = false;
    state.hintCount = 0;
    board.classList.remove("is-complete");
    resetTimer();
    hideOverlay();
    feedback("");
    render();
    saveState();
    announce("Puzzle restarted.");
  }

  function applyPuzzle(result) {
    clearCheck();
    state.difficulty = result.difficulty;
    state.generatorVersion = result.generatorVersion;
    state.seed = result.seed;
    state.puzzle = result.puzzle.slice();
    state.solution = result.solution.slice();
    state.values = state.puzzle.slice();
    state.notes = new Array(81).fill(0);
    state.given = state.puzzle.map(function (v) {
      return v !== 0;
    });
    state.selected = null;
    state.notesMode = false;
    state.hintCount = 0;
    state.completed = false;
    state.hints = null;
    state.conflict = null;
    state.undoStack = [];
    notesBtn.classList.remove("is-active");
    notesBtn.setAttribute("aria-pressed", "false");
    board.classList.remove("is-complete");
    resetTimer();
    hideOverlay();
    feedback("");
    updateDiffButtons();
    render();
    saveState();
    startPrefetch(state.difficulty);
  }

  function newPuzzle(difficulty) {
    difficulty = difficulty || state.difficulty;
    var previous = state.difficulty;
    state.difficulty = difficulty;
    updateDiffButtons();
    setGenerating(true);
    setControlsDisabled(true);

    if (prefetch && prefetch.difficulty === difficulty) {
      var ready = prefetch.result;
      prefetch = null;
      setTimeout(function () {
        setGenerating(false);
        applyPuzzle(ready);
        announce(DIFF_LABEL[difficulty] + " puzzle ready.");
      }, 0);
      return;
    }

    requestGeneration(difficulty, randomSeed()).then(function (res) {
      if (res) {
        setGenerating(false);
        applyPuzzle(res);
        announce(DIFF_LABEL[difficulty] + " puzzle ready.");
      } else {
        setGenerating(false);
        if (state.puzzle) {
          state.difficulty = previous;
          updateDiffButtons();
          render();
          feedback("Could not generate a puzzle just now — please try again.", "warn");
        } else {
          feedback("Could not generate a puzzle — please reload.", "warn");
        }
      }
    });
  }

  function requestNew() {
    if (state.completed) {
      newPuzzle(state.difficulty);
      return;
    }
    if (hasProgress()) {
      askConfirm("New puzzle?", "Your current entries will be lost.", "New puzzle", function () {
        newPuzzle(state.difficulty);
      });
      return;
    }
    newPuzzle(state.difficulty);
  }

  function updateDiffButtons() {
    diffBtns.forEach(function (b) {
      var on = b.dataset.sdDiff === state.difficulty;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function changeDifficulty(d) {
    if (E.DIFFICULTIES.indexOf(d) === -1) return;
    writeRaw(PREF_KEY, d);
    if (d === state.difficulty && !state.completed) {
      return;
    }
    if (hasProgress() && !state.completed) {
      askConfirm(
        "Switch to " + DIFF_LABEL[d] + "?",
        "A new " + DIFF_LABEL[d].toLowerCase() + " puzzle will be generated.",
        "Switch",
        function () {
          newPuzzle(d);
        }
      );
    } else {
      newPuzzle(d);
    }
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  diffBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      changeDifficulty(b.dataset.sdDiff);
    });
  });

  notesBtn.addEventListener("click", toggleNotes);
  eraseBtn.addEventListener("click", erase);
  undoBtn.addEventListener("click", undo);
  hintBtn.addEventListener("click", doHint);
  checkBtn.addEventListener("click", doCheck);
  restartBtn.addEventListener("click", function () {
    restart(false);
  });
  newBtns.forEach(function (b, idx) {
    if (!b) return;
    b.addEventListener("click", function () {
      if (idx === 2) restart(true); /* Replay */
      else requestNew();
    });
  });

  cancelBtn.addEventListener("click", function () {
    confirmAction = null;
    hideOverlay();
  });
  confirmBtn.addEventListener("click", function () {
    var fn = confirmAction;
    confirmAction = null;
    hideOverlay();
    if (fn) fn();
  });

  if (soundBtn && window.GameAudio) {
    soundBtn.addEventListener("click", function () {
      window.GameAudio.toggle();
      syncSoundButton();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var t = ev.target;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    ) {
      return;
    }
    if (!root.contains(document.activeElement) && state.selected === null) return;

    var key = ev.key;
    if (key >= "1" && key <= "9") {
      ev.preventDefault();
      inputDigit(Number(key));
      return;
    }
    if (key === "Backspace" || key === "Delete") {
      ev.preventDefault();
      erase();
      return;
    }
    if (key === "ArrowUp" || key === "w" || key === "W") {
      ev.preventDefault();
      moveSelection(-1, 0);
      return;
    }
    if (key === "ArrowDown" || key === "s" || key === "S") {
      ev.preventDefault();
      moveSelection(1, 0);
      return;
    }
    if (key === "ArrowLeft" || key === "a" || key === "A") {
      ev.preventDefault();
      moveSelection(0, -1);
      return;
    }
    if (key === "ArrowRight" || key === "d" || key === "D") {
      ev.preventDefault();
      moveSelection(0, 1);
      return;
    }
    if (key === "n" || key === "N") {
      ev.preventDefault();
      toggleNotes();
      return;
    }
    if (key === "z" || key === "Z") {
      ev.preventDefault();
      undo();
      return;
    }
    if (key === "h" || key === "H") {
      ev.preventDefault();
      doHint();
    }
  });

  window.addEventListener("pagehide", function () {
    clearCheck();
    saveState();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      clearCheck();
      saveState();
    }
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function boot() {
    state.difficulty = preferredDifficulty();
    updateDiffButtons();
    syncSoundButton();

    var saved = loadSaved();
    if (saved) {
      state.generatorVersion = saved.generatorVersion || E.GENERATOR_VERSION;
      state.seed = saved.seed >>> 0 || 0;
      /* Preserve an explicitly requested difficulty preference over a
         stale saved one only when the player has no progress. */
      state.difficulty = saved.difficulty;
      state.puzzle = saved.puzzle.slice();
      state.solution = saved.solution.slice();
      state.values = saved.values.slice();
      state.notes = saved.notes.map(function (n) {
        return n & 511;
      });
      state.given = state.puzzle.map(function (v) {
        return v !== 0;
      });
      state.selected =
        typeof saved.selected === "number" && saved.selected >= 0 && saved.selected <= 80
          ? saved.selected
          : null;
      state.notesMode = !!saved.notesMode;
      state.hintCount = saved.hintCount | 0;
      state.completed = !!saved.completed;
      state.elapsedBase = saved.elapsedMs | 0;
      state.elapsedStart = Date.now();
      state.undoStack = [];
      recomputeConflict();

      notesBtn.classList.toggle("is-active", state.notesMode);
      notesBtn.setAttribute("aria-pressed", state.notesMode ? "true" : "false");
      updateDiffButtons();
      render();
      renderTimer();
      hideOverlay();

      if (state.completed) {
        board.classList.add("is-complete");
        completeDiff.textContent = DIFF_LABEL[state.difficulty];
        completeTime.textContent = formatTime(state.elapsedBase);
        completeHints.textContent = String(state.hintCount);
        showPanel("complete");
      }
      startPrefetch(state.difficulty);
      return;
    }

    newPuzzle(state.difficulty);
  }

  setInterval(function () {
    if (state.puzzle && !state.completed) renderTimer();
  }, 500);

  setInterval(function () {
    if (state.puzzle && !state.completed && hasProgress()) saveState();
  }, 10000);

  boot();
})();
