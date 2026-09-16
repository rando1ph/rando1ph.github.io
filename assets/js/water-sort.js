/* ------------------------------------------------------------------
   Water Sort — randolf.dev
   Plain browser game. No dependencies.

   Structure:
     - rules      : pure pour logic on bottle arrays (index 0 = bottom)
     - state      : level, bottles, selection, moves, history, locks
     - rendering  : SVG bottles, clipped liquid layers
     - animation  : lift / travel / tilt / stream / liquid transition
     - persistence: localStorage
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var LEVELS = window.WSLevels.LEVELS;
  var CAPACITY = window.WSLevels.CAPACITY;
  var isSolvedBottles = window.WSLevels.isSolved;

  var STORE_KEY = "randolf:water-sort:v1";

  var COLORS = [
    { name: "red", light: "#f2837c", base: "#e2564d" },
    { name: "blue", light: "#7b9af0", base: "#3f6fe0" },
    { name: "amber", light: "#f4c869", base: "#e6a632" },
    { name: "green", light: "#6fc98a", base: "#3aa85f" },
    { name: "purple", light: "#b48ae8", base: "#8a5cd6" },
    { name: "cyan", light: "#63ccc6", base: "#2fa8a2" },
    { name: "orange", light: "#f29460", base: "#dd6a2e" },
    { name: "pink", light: "#ec86b4", base: "#d5548f" }
  ];

  var VB_W = 60;
  var VB_H = 150;
  var MOUTH_Y = 6;
  var INT_TOP = 9;
  var INT_BOTTOM = 139.5;
  var UNIT_H = (INT_BOTTOM - INT_TOP) / CAPACITY;

  var OUTER_PATH = "M19 6 L19 26 C19 34 10 35 10 44 L10 124 A20 20 0 0 0 50 124 L50 44 C50 35 41 34 41 26 L41 6";
  var INNER_PATH = "M16.5 9 L16.5 27 C16.5 34 12.5 36 12.5 44 L12.5 122 A17.5 17.5 0 0 0 47.5 122 L47.5 44 C47.5 36 43.5 34 43.5 27 L43.5 9 Z";

  var POUR_DURATION = 720;
  var CLIP_TRANSITION_MS = 200;
  var TILT_DEG = 62;

  var boardEl = document.querySelector("[data-ws-board]");
  if (!boardEl) {
    return;
  }

  var wsEl = document.querySelector(".ws");
  var levelEl = document.querySelector("[data-ws-level]");
  var movesEl = document.querySelector("[data-ws-moves]");
  var undoBtn = document.querySelector("[data-ws-undo]");
  var restartBtn = document.querySelector("[data-ws-restart]");
  var levelsToggleBtn = document.querySelector("[data-ws-levels-toggle]");
  var levelsPanel = document.querySelector("[data-ws-levels-panel]");
  var levelsGrid = document.querySelector("[data-ws-levels-grid]");
  var hintEl = document.querySelector("[data-ws-hint]");
  var resultEl = document.querySelector("[data-ws-result]");
  var resultTitleEl = document.querySelector("[data-ws-result-title]");
  var resultMetaEl = document.querySelector("[data-ws-result-meta]");
  var nextBtn = document.querySelector("[data-ws-next]");
  var replayBtn = document.querySelector("[data-ws-replay]");
  var statusEl = document.querySelector("[data-ws-status]");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = {
    level: 0,
    bottles: [],
    initial: [],
    selected: -1,
    moves: 0,
    history: [],
    unlocked: 0,
    completed: [],
    solved: false,
    locked: false
  };

  var els = [];
  var overlay = null;
  var activeAnim = null;
  var activeTimers = [];
  var restartArmed = false;
  var restartTimer = null;

  /* --- rules ------------------------------------------------------ */

  function topColor(bottle) {
    return bottle[bottle.length - 1];
  }

  function topRun(bottle) {
    var col = topColor(bottle);
    var run = 1;
    while (run < bottle.length && bottle[bottle.length - 1 - run] === col) {
      run += 1;
    }
    return run;
  }

  function freeSpace(bottle) {
    return CAPACITY - bottle.length;
  }

  function canPour(src, dst) {
    if (!src.length || dst.length >= CAPACITY) return false;
    if (!dst.length) return true;
    return topColor(dst) === topColor(src);
  }

  function pourAmount(src, dst) {
    if (!canPour(src, dst)) return 0;
    return Math.min(topRun(src), freeSpace(dst));
  }

  function applyPour(bottles, si, di) {
    var amt = pourAmount(bottles[si], bottles[di]);
    for (var u = 0; u < amt; u += 1) {
      bottles[di].push(bottles[si].pop());
    }
    return amt;
  }

  function cloneBottles(bottles) {
    return bottles.map(function (b) { return b.slice(); });
  }

  function isDone(bottle) {
    return bottle.length === CAPACITY && topRun(bottle) === CAPACITY;
  }

  /* --- state helpers ---------------------------------------------- */

  function announce(msg) {
    if (statusEl) {
      statusEl.textContent = msg;
    }
  }

  function updateHud() {
    levelEl.textContent = String(state.level + 1).padStart(2, "0");
    movesEl.textContent = String(state.moves);
    hintEl.hidden = !(state.level === 0 && state.moves === 0);
  }

  function updateUndoBtn() {
    undoBtn.disabled = state.locked || state.solved || !state.history.length;
  }

  /* --- persistence ------------------------------------------------- */

  function persist() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1,
        level: state.level,
        unlocked: state.unlocked,
        completed: state.completed,
        bottles: state.bottles,
        moves: state.moves
      }));
    } catch (e) { /* storage unavailable — game continues */ }
  }

  function validSavedBottles(raw, levelIndex) {
    if (!Array.isArray(raw) || raw.length !== LEVELS[levelIndex].length) return null;
    var maxColor = window.WSLevels.colorCount(levelIndex);
    var counts = Object.create(null);
    var bottles = [];
    for (var i = 0; i < raw.length; i += 1) {
      var b = raw[i];
      if (!Array.isArray(b) || b.length > CAPACITY) return null;
      var copy = [];
      for (var u = 0; u < b.length; u += 1) {
        var c = b[u];
        if (typeof c !== "number" || c < 0 || c !== Math.floor(c) || c >= maxColor) return null;
        counts[c] = (counts[c] || 0) + 1;
        if (counts[c] > 4) return null;
        copy.push(c);
      }
      bottles.push(copy);
    }
    return bottles;
  }

  function loadSaved() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1) return null;
      var level = d.level | 0;
      if (!(level >= 0 && level < LEVELS.length)) return null;
      var unlocked = d.unlocked | 0;
      if (!(unlocked >= 0 && unlocked < LEVELS.length)) unlocked = 0;
      var completed = Array.isArray(d.completed)
        ? d.completed.filter(function (n) {
            return typeof n === "number" && n >= 0 && n < LEVELS.length;
          })
        : [];
      return {
        level: level,
        unlocked: unlocked,
        completed: completed,
        bottles: validSavedBottles(d.bottles, level),
        moves: d.moves | 0
      };
    } catch (e) {
      return null;
    }
  }

  /* --- rendering ---------------------------------------------------- */

  function surfaceY(count) {
    return INT_BOTTOM - count * UNIT_H;
  }

  function clipTransform(count) {
    return "translateY(" + (surfaceY(count) + 40).toFixed(2) + "px)";
  }

  function unitsHtml(units) {
    var out = "";
    for (var j = 0; j < units.length; j += 1) {
      var y = (INT_BOTTOM - (j + 1) * UNIT_H).toFixed(2);
      out += '<rect x="10" y="' + y + '" width="40" height="' +
        (UNIT_H + 0.6).toFixed(2) + '" fill="url(#ws-g-' + units[j] + ')"/>';
    }
    return out;
  }

  function bottleLabel(i) {
    var b = state.bottles[i];
    if (!b.length) return "Bottle " + (i + 1) + ": empty";
    var names = b.map(function (c) { return COLORS[c].name; });
    return "Bottle " + (i + 1) + ", bottom to top: " + names.join(", ");
  }

  function setLiquid(i, units, clipCount, animate) {
    var rec = els[i];
    rec.liquid.innerHTML = unitsHtml(units);
    var clip = rec.liqClip;
    if (!animate) {
      clip.style.transition = "none";
      clip.style.transform = clipTransform(clipCount);
      void clip.getBoundingClientRect();
      clip.style.transition = "";
    } else {
      clip.style.transform = clipTransform(clipCount);
    }
  }

  function renderBottle(i) {
    var rec = els[i];
    setLiquid(i, state.bottles[i], state.bottles[i].length, false);
    rec.btn.classList.toggle("is-done", isDone(state.bottles[i]));
    rec.btn.setAttribute("aria-label", bottleLabel(i));
  }

  function renderAll() {
    for (var i = 0; i < els.length; i += 1) {
      renderBottle(i);
    }
  }

  function setSelection(i) {
    if (state.selected >= 0 && els[state.selected]) {
      els[state.selected].btn.classList.remove("is-selected");
      els[state.selected].btn.setAttribute("aria-pressed", "false");
    }
    state.selected = i;
    if (i >= 0) {
      els[i].btn.classList.add("is-selected");
      els[i].btn.setAttribute("aria-pressed", "true");
      announce("Bottle " + (i + 1) + " selected");
    }
  }

  function defsHtml() {
    var out = "<defs>";
    for (var c = 0; c < COLORS.length; c += 1) {
      out += '<linearGradient id="ws-g-' + c + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + COLORS[c].light + '"/>' +
        '<stop offset="1" stop-color="' + COLORS[c].base + '"/>' +
        "</linearGradient>";
    }
    out += "</defs>";
    return out;
  }

  function bottleSvg(i) {
    return '<svg viewBox="0 0 60 150" aria-hidden="true" focusable="false">' +
      '<path class="ws-glass-fill" d="' + INNER_PATH + '"/>' +
      '<g clip-path="url(#ws-lc-' + i + ')"><g class="ws-liquid" clip-path="url(#ws-ic-' + i + ')"></g></g>' +
      '<g clip-path="url(#ws-ic-' + i + ')"><rect class="ws-shine" x="15" y="16" width="4" height="106" rx="2"/></g>' +
      '<path class="ws-glass" d="' + OUTER_PATH + '"/>' +
      "</svg>";
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    els = [];

    var n = LEVELS[state.level].length;
    var firstRow = n <= 5 ? n : Math.ceil(n / 2);
    var rows = [];
    var row = document.createElement("div");
    row.className = "ws-row";
    for (var i = 0; i < n; i += 1) {
      if (i === firstRow) {
        rows.push(row);
        row = document.createElement("div");
        row.className = "ws-row";
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-bottle";
      btn.setAttribute("data-ws-idx", String(i));
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Bottle " + (i + 1));
      btn.style.setProperty("--wi", i);
      btn.innerHTML = '<span class="ws-bottle-inner">' +
        '<svg width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
        '<clipPath id="ws-ic-' + i + '"><path d="' + INNER_PATH + '"/></clipPath>' +
        '<clipPath id="ws-lc-' + i + '"><rect class="ws-liq-clip" x="0" y="-40" width="60" height="280"/></clipPath>' +
        "</defs></svg>" +
        bottleSvg(i) +
        "</span>";
      row.appendChild(btn);
      els.push({
        btn: btn,
        inner: btn.querySelector(".ws-bottle-inner"),
        liquid: btn.querySelector(".ws-liquid"),
        liqClip: btn.querySelector(".ws-liq-clip")
      });
    }
    rows.push(row);
    rows.forEach(function (r) { boardEl.appendChild(r); });

    var defs = document.createElement("div");
    defs.className = "ws-defs";
    defs.setAttribute("aria-hidden", "true");
    defs.innerHTML = '<svg width="0" height="0" focusable="false">' + defsHtml() + "</svg>";
    boardEl.appendChild(defs);

    boardEl.addEventListener("click", onBoardClick);
  }

  function buildLevelsGrid() {
    levelsGrid.innerHTML = "";
    for (var i = 0; i < LEVELS.length; i += 1) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-level-btn";
      btn.textContent = String(i + 1).padStart(2, "0");
      if (state.completed.indexOf(i) >= 0) btn.classList.add("is-done");
      if (i === state.level) btn.setAttribute("aria-current", "true");
      if (i > state.unlocked) btn.disabled = true;
      btn.setAttribute("aria-label", "Level " + (i + 1) + (i > state.unlocked ? ", locked" : ""));
      btn.addEventListener("click", onLevelBtn(i));
      levelsGrid.appendChild(btn);
    }
  }

  /* --- input --------------------------------------------------------- */

  function onBoardClick(e) {
    var btn = e.target.closest(".ws-bottle");
    if (!btn) return;
    var i = parseInt(btn.getAttribute("data-ws-idx"), 10);
    if (!(i >= 0) || !els[i]) return;
    onBottleTap(i);
  }

  function reject(i) {
    var btn = els[i].btn;
    btn.classList.remove("is-reject");
    void btn.offsetWidth;
    btn.classList.add("is-reject");
    announce("Invalid move");
  }

  function onBottleTap(i) {
    if (state.locked || state.solved) return;

    if (state.selected === -1) {
      if (!state.bottles[i].length) {
        reject(i);
        return;
      }
      setSelection(i);
      return;
    }

    if (i === state.selected) {
      setSelection(-1);
      return;
    }

    if (canPour(state.bottles[state.selected], state.bottles[i])) {
      doPour(state.selected, i);
      return;
    }

    if (state.bottles[i].length) {
      setSelection(i);
      return;
    }

    reject(i);
  }

  /* --- pour + animation ----------------------------------------------- */

  function doPour(si, di) {
    var amt = pourAmount(state.bottles[si], state.bottles[di]);
    if (!amt) {
      reject(di);
      return;
    }

    var pre = {
      srcUnits: state.bottles[si].slice(),
      srcCount: state.bottles[si].length,
      dstCount: state.bottles[di].length,
      color: topColor(state.bottles[si])
    };

    state.history.push({ bottles: cloneBottles(state.bottles), moves: state.moves });
    applyPour(state.bottles, si, di);
    state.moves += 1;
    updateHud();
    setSelection(-1);
    updateUndoBtn();
    state.locked = true;
    undoBtn.disabled = true;
    announce("Poured " + amt + " " + COLORS[pre.color].name + " into bottle " + (di + 1));

    if (reduceMotion) {
      renderAll();
      persist();
      afterPour();
      return;
    }

    setLiquid(si, pre.srcUnits, pre.srcCount, false);
    setLiquid(di, state.bottles[di], pre.dstCount, false);
    runPourAnimation(si, di, pre, amt);
  }

  function runPourAnimation(si, di, pre, amt) {
    var srcInner = els[si].inner;
    var dstInner = els[di].inner;
    var srcBtn = els[si].btn;
    srcBtn.classList.add("is-animating");
    srcInner.classList.add("no-trans");

    var r1 = srcInner.getBoundingClientRect();
    var r2 = dstInner.getBoundingClientRect();

    var s1 = r1.height / VB_H;
    var mouthX = r1.left + r1.width / 2;
    var mouthY = r1.top + MOUTH_Y * s1;
    var dstMouthX = r2.left + r2.width / 2;
    var dstMouthY = r2.top + MOUTH_Y * (r2.height / VB_H);
    var dir = dstMouthX >= mouthX ? 1 : -1;
    var gap = Math.max(8, r1.height * 0.075);
    var tx = dstMouthX - mouthX;
    var ty = dstMouthY - gap - mouthY;
    var theta = dir * TILT_DEG;
    var lift = Math.max(10, r1.height * 0.09);

    var arrived = "translate(" + tx.toFixed(1) + "px, " + ty.toFixed(1) + "px) rotate(" + theta + "deg)";
    var keyframes = [
      { transform: "translate(0px, 0px) rotate(0deg)", offset: 0, easing: "ease-out" },
      { transform: "translate(0px, " + (-lift).toFixed(1) + "px) rotate(0deg)", offset: 0.16, easing: "ease-in-out" },
      { transform: arrived, offset: 0.4, easing: "linear" },
      { transform: arrived, offset: 0.66, easing: "ease-in" },
      { transform: "translate(" + tx.toFixed(1) + "px, " + ty.toFixed(1) + "px) rotate(0deg)", offset: 0.8, easing: "ease-in-out" },
      { transform: "translate(0px, 0px) rotate(0deg)", offset: 1 }
    ];

    var anim = srcInner.animate(keyframes, { duration: POUR_DURATION });
    activeAnim = anim;

    var t1 = window.setTimeout(function () {
      beginPourVisuals(si, di, pre, amt, r1, r2, mouthX + tx, mouthY + ty, s1, dir);
    }, POUR_DURATION * 0.4);
    var t2 = window.setTimeout(function () {
      endStream();
    }, POUR_DURATION * 0.66);
    var t3 = window.setTimeout(function () {
      cleanupPour();
    }, POUR_DURATION + 80);
    activeTimers = [t1, t2, t3];
  }

  function beginPourVisuals(si, di, pre, amt, r1, r2, mouthScreenX, mouthScreenY, s1, dir) {
    var rec = els[si];
    rec.liqClip.style.transform = clipTransform(state.bottles[si].length);
    els[di].liqClip.style.transform = clipTransform(state.bottles[di].length);

    var docX = window.pageXOffset || window.scrollX || 0;
    var docY = window.pageYOffset || window.scrollY || 0;
    var lipX = mouthScreenX + dir * 5.17 * s1;
    var lipY = mouthScreenY + 9.7 * s1;
    var endY = r2.top + docY + (surfaceY(state.bottles[di].length) / VB_H) * r2.height;
    var height = Math.max(4, endY - (lipY + docY));

    var stream = document.createElement("div");
    stream.className = "ws-stream";
    stream.style.left = (lipX + docX - 2.25) + "px";
    stream.style.top = (lipY + docY - 1) + "px";
    stream.style.height = height + "px";
    stream.style.background = "linear-gradient(180deg, " + COLORS[pre.color].light + ", " + COLORS[pre.color].base + ")";
    overlay.appendChild(stream);
  }

  function endStream() {
    if (!overlay) return;
    var stream = overlay.querySelector(".ws-stream");
    if (stream) {
      stream.classList.add("is-ending");
      window.setTimeout(function () {
        if (stream.parentNode) stream.parentNode.removeChild(stream);
      }, 140);
    }
  }

  function cleanupPour() {
    if (activeTimers.length) {
      activeTimers.forEach(function (t) { window.clearTimeout(t); });
      activeTimers = [];
    }
    if (activeAnim) {
      try { activeAnim.cancel(); } catch (e) { /* already finished */ }
      activeAnim = null;
    }
    endStream();
    for (var i = 0; i < els.length; i += 1) {
      els[i].btn.classList.remove("is-animating");
      els[i].inner.classList.remove("no-trans");
      els[i].inner.style.transform = "";
    }
    renderAll();
    persist();
    afterPour();
  }

  function afterPour() {
    state.locked = false;
    if (isSolvedBottles(state.bottles)) {
      victory();
    }
    updateUndoBtn();
  }

  /* --- victory --------------------------------------------------------- */

  function victory() {
    state.solved = true;
    setSelection(-1);
    boardEl.classList.add("is-won");
    if (state.completed.indexOf(state.level) < 0) {
      state.completed.push(state.level);
    }
    state.unlocked = Math.max(state.unlocked, Math.min(state.level + 1, LEVELS.length - 1));
    persist();
    buildLevelsGrid();
    updateUndoBtn();
    announce("Level complete in " + state.moves + " moves");

    window.setTimeout(function () {
      var last = state.level === LEVELS.length - 1;
      resultTitleEl.textContent = last ? "All levels complete" : "Level complete";
      resultMetaEl.textContent = "Moves " + state.moves;
      nextBtn.hidden = last;
      resultEl.hidden = false;
    }, 1000);
  }

  /* --- controls ---------------------------------------------------------- */

  function clearRestartArm() {
    restartArmed = false;
    restartBtn.textContent = "Restart";
    restartBtn.classList.remove("is-confirming");
    if (restartTimer) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function doRestart() {
    clearRestartArm();
    state.bottles = cloneBottles(state.initial);
    state.moves = 0;
    state.history = [];
    state.solved = false;
    state.locked = false;
    setSelection(-1);
    boardEl.classList.remove("is-won");
    resultEl.hidden = true;
    renderAll();
    updateHud();
    updateUndoBtn();
    persist();
    announce("Level restarted");
  }

  function loadLevel(index) {
    if (state.locked) return;
    clearRestartArm();
    state.level = index;
    state.initial = cloneBottles(LEVELS[index]);
    state.bottles = cloneBottles(LEVELS[index]);
    state.moves = 0;
    state.history = [];
    state.solved = false;
    state.locked = false;
    setSelection(-1);
    boardEl.classList.remove("is-won");
    resultEl.hidden = true;
    levelsPanel.hidden = true;
    levelsToggleBtn.setAttribute("aria-expanded", "false");
    buildBoard();
    buildLevelsGrid();
    renderAll();
    updateHud();
    updateUndoBtn();
    persist();
    announce("Level " + (index + 1) + " loaded");
  }

  function onUndo() {
    if (state.locked || state.solved || !state.history.length) return;
    var prev = state.history.pop();
    state.bottles = prev.bottles;
    state.moves = prev.moves;
    setSelection(-1);
    renderAll();
    updateHud();
    updateUndoBtn();
    persist();
    announce("Move undone");
  }

  function onRestart() {
    if (state.locked) return;
    if (state.moves > 0 && !restartArmed) {
      restartArmed = true;
      restartBtn.textContent = "Sure?";
      restartBtn.classList.add("is-confirming");
      restartTimer = window.setTimeout(clearRestartArm, 2500);
      return;
    }
    doRestart();
  }

  function onLevelBtn(index) {
    return function () {
      if (state.locked || index > state.unlocked) return;
      loadLevel(index);
    };
  }

  /* --- init --------------------------------------------------------------- */

  function init() {
    overlay = document.createElement("div");
    overlay.className = "ws-overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);

    var saved = loadSaved();
    if (saved) {
      state.level = saved.level;
      state.unlocked = saved.unlocked;
      state.completed = saved.completed;
      state.moves = saved.moves;
      state.initial = cloneBottles(LEVELS[state.level]);
      state.bottles = saved.bottles || cloneBottles(state.initial);
      if (!saved.bottles) state.moves = 0;
    } else {
      state.initial = cloneBottles(LEVELS[0]);
      state.bottles = cloneBottles(LEVELS[0]);
    }

    buildBoard();
    buildLevelsGrid();
    renderAll();
    updateHud();
    updateUndoBtn();

    undoBtn.addEventListener("click", onUndo);
    restartBtn.addEventListener("click", onRestart);
    nextBtn.addEventListener("click", function () {
      if (state.level < LEVELS.length - 1) loadLevel(state.level + 1);
    });
    replayBtn.addEventListener("click", doRestart);
    levelsToggleBtn.addEventListener("click", function () {
      var open = levelsPanel.hidden;
      levelsPanel.hidden = !open;
      levelsToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    window.addEventListener("resize", function () {
      if (activeAnim || activeTimers.length) {
        cleanupPour();
      }
    });
  }

  init();
})();
