/* ------------------------------------------------------------------
   Water Sort — randolf.dev  (V2: Classic + Challenge + Hint + Sound)
   Plain browser game. No dependencies.

   Structure:
     - solver module : shared production rules + A* / BFS / greedy
     - state         : classic + three challenge tracks
     - persistence   : localStorage v2, migrated from v1
     - rendering     : SVG bottles, clipped liquid layers
     - animation     : lift / travel / tilt / stream / liquid transition
     - hint          : worker-solved next move on the CURRENT state
     - sound         : Web Audio synthesis (WSSound)
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var SOLVER = window.WSSolver;
  var LEVELS = window.WSLevels.LEVELS;
  var CAPACITY = SOLVER.CAPACITY;

  var STORE_KEY = "randolf:water-sort:v2";
  var LEGACY_KEY = "randolf:water-sort:v1";

  var COLORS = [
    { name: "red", light: "#f2837c", base: "#e2564d" },
    { name: "blue", light: "#7b9af0", base: "#3f6fe0" },
    { name: "amber", light: "#f4c869", base: "#e6a632" },
    { name: "green", light: "#6fc98a", base: "#3aa85f" },
    { name: "purple", light: "#b48ae8", base: "#8a5cd6" },
    { name: "cyan", light: "#63ccc6", base: "#2fa8a2" },
    { name: "orange", light: "#f29460", base: "#dd6a2e" },
    { name: "pink", light: "#ec86b4", base: "#d5548f" },
    { name: "brown", light: "#b39274", base: "#8f6b4a" },
    { name: "olive", light: "#bcc668", base: "#97a23a" },
    { name: "magenta", light: "#d873c4", base: "#b8389c" },
    { name: "steel", light: "#93aec9", base: "#64809f" }
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
  var HINT_CACHE_MAX = 10;

  var boardEl = document.querySelector("[data-ws-board]");
  if (!boardEl) {
    return;
  }

  var wsEl = document.querySelector(".ws");
  var levelEl = document.querySelector("[data-ws-level]");
  var levelLabelEl = document.querySelector("[data-ws-level-label]");
  var movesEl = document.querySelector("[data-ws-moves]");
  var undoBtn = document.querySelector("[data-ws-undo]");
  var restartBtn = document.querySelector("[data-ws-restart]");
  var levelsToggleBtn = document.querySelector("[data-ws-levels-toggle]");
  var levelsPanel = document.querySelector("[data-ws-levels-panel]");
  var levelsGrid = document.querySelector("[data-ws-levels-grid]");
  var hintBtn = document.querySelector("[data-ws-hint]");
  var hintPanel = document.querySelector("[data-ws-hint-panel]");
  var hintResultEl = document.querySelector("[data-ws-hint-result]");
  var hintConfirmBtn = document.querySelector("[data-ws-hint-confirm]");
  var hintCancelBtn = document.querySelector("[data-ws-hint-cancel]");
  var soundBtn = document.querySelector("[data-ws-sound]");
  var hintEl = document.querySelector("[data-ws-hint-tip]");
  var resultEl = document.querySelector("[data-ws-result]");
  var resultTitleEl = document.querySelector("[data-ws-result-title]");
  var resultMetaEl = document.querySelector("[data-ws-result-meta]");
  var resultOptimalEl = document.querySelector("[data-ws-result-optimal]");
  var nextBtn = document.querySelector("[data-ws-next]");
  var replayBtn = document.querySelector("[data-ws-replay]");
  var statusEl = document.querySelector("[data-ws-status]");
  var genEl = document.querySelector("[data-ws-gen]");
  var modeBtns = Array.prototype.slice.call(document.querySelectorAll("[data-ws-mode]"));
  var diffBtns = Array.prototype.slice.call(document.querySelectorAll("[data-ws-difficulty]"));

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- storage ------------------------------------------------------- */

  var store = {
    v: 2,
    mode: "classic",
    difficulty: "easy",
    classic: { level: 0, unlocked: 0, completed: [], bottles: null, moves: 0 },
    challenge: {
      easy: emptyTrack(),
      medium: emptyTrack(),
      hard: emptyTrack()
    },
    settings: { sound: true }
  };

  function emptyTrack() {
    return { completed: 0, puzzle: null };
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

  function loadStorage() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.v === 2) {
          store.mode = d.mode === "challenge" ? "challenge" : "classic";
          store.difficulty = ["easy", "medium", "hard"].indexOf(d.difficulty) >= 0 ? d.difficulty : "easy";
          if (d.classic) {
            store.classic = sanitizeClassic(d.classic);
          }
          if (d.challenge) {
            ["easy", "medium", "hard"].forEach(function (diff) {
              var t = d.challenge[diff];
              if (t && typeof t.completed === "number") {
                store.challenge[diff] = sanitizeTrack(t);
              }
            });
          }
          if (d.settings && typeof d.settings.sound === "boolean") {
            store.settings.sound = d.settings.sound;
          }
          return;
        }
      }
      var legacyRaw = window.localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        var v1 = JSON.parse(legacyRaw);
        if (v1 && v1.v === 1) {
          store.classic = sanitizeClassic(v1);
        }
      }
    } catch (e) { /* corrupt or unavailable — fresh start */ }
  }

  function sanitizeClassic(c) {
    var out = { level: 0, unlocked: 0, completed: [], bottles: null, moves: 0 };
    var level = c.level | 0;
    if (level >= 0 && level < LEVELS.length) out.level = level;
    var unlocked = c.unlocked | 0;
    if (unlocked >= 0 && unlocked < LEVELS.length) out.unlocked = unlocked;
    if (Array.isArray(c.completed)) {
      out.completed = c.completed.filter(function (n) {
        return typeof n === "number" && n >= 0 && n < LEVELS.length;
      });
    }
    var bottles = validSavedBottles(c.bottles, out.level);
    if (bottles) {
      out.bottles = bottles;
      out.moves = c.moves | 0;
    }
    return out;
  }

  function sanitizeTrack(t) {
    var out = { completed: Math.max(0, t.completed | 0), puzzle: null };
    var p = t.puzzle;
    if (p && typeof p.seed === "string" && typeof p.number === "number" &&
        Array.isArray(p.def) && p.def.length > 2 && typeof p.gen === "number") {
      var stateOk = !Array.isArray(p.state) || p.state.every(function (b) {
        return Array.isArray(b) && b.length <= CAPACITY;
      });
      if (stateOk) {
        out.puzzle = {
          seed: p.seed,
          number: p.number,
          gen: p.gen,
          def: p.def,
          state: Array.isArray(p.state) ? p.state : null,
          moves: p.moves | 0,
          optimal: typeof p.optimal === "number" ? p.optimal : null
        };
      }
    }
    return out;
  }

  function persist() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage unavailable — game continues */ }
  }

  /* --- game state ------------------------------------------------------ */

  function freshTrackState(def, puzzle) {
    return {
      initial: SOLVER.cloneBottles(def),
      bottles: SOLVER.cloneBottles(def),
      moves: 0,
      history: [],
      selected: -1,
      solved: false,
      locked: false,
      number: puzzle ? puzzle.number : 0,
      seed: puzzle ? puzzle.seed : "",
      optimal: puzzle ? puzzle.optimal : null
    };
  }

  function freshClassicState(levelIndex) {
    return {
      initial: SOLVER.cloneBottles(LEVELS[levelIndex]),
      bottles: SOLVER.cloneBottles(LEVELS[levelIndex]),
      moves: 0,
      history: [],
      selected: -1,
      solved: false,
      locked: false,
      level: levelIndex,
      unlocked: 0,
      completed: []
    };
  }

  var classic = freshClassicState(0);
  var tracks = {
    easy: null,
    medium: null,
    hard: null
  };

  function cur() {
    return store.mode === "challenge" ? tracks[store.difficulty] : classic;
  }

  function curLabel() {
    if (store.mode === "challenge") {
      return { kind: "challenge", num: tracks[store.difficulty] ? tracks[store.difficulty].number : 0 };
    }
    return { kind: "classic", num: classic.level + 1 };
  }

  var els = [];
  var overlay = null;
  var worker = null;
  var jobId = 0;
  var pendingHint = null;
  var hintCache = new Map();
  var pendingGenerate = null;
  var activeAnim = null;
  var activeTimers = [];
  var restartArmed = false;
  var restartTimer = null;
  var hintPulseTimer = null;

  /* --- helpers ----------------------------------------------------------- */

  function announce(msg) {
    if (statusEl) {
      statusEl.textContent = msg;
    }
  }

  function updateHud() {
    var c = cur();
    if (!c) {
      if (store.mode === "challenge") {
        var t = store.challenge[store.difficulty];
        levelEl.textContent = String(t.completed + 1).padStart(3, "0");
        if (levelLabelEl) levelLabelEl.textContent = "Challenge";
      }
      return;
    }
    var label = curLabel();
    if (label.kind === "challenge") {
      levelEl.textContent = String(label.num).padStart(3, "0");
      if (levelLabelEl) levelLabelEl.textContent = "Challenge";
    } else {
      levelEl.textContent = String(label.num).padStart(2, "0");
      if (levelLabelEl) levelLabelEl.textContent = "Level";
    }
    movesEl.textContent = String(c.moves);
    hintEl.hidden = !(store.mode === "classic" && classic.level === 0 && classic.moves === 0);
  }

  function updateUndoBtn() {
    var c = cur();
    var busy = !c || c.locked || c.solved || !c.history.length;
    undoBtn.disabled = busy;
  }

  function updateHintBtn() {
    var c = cur();
    hintBtn.disabled = !c || c.locked || c.solved || !!pendingHint;
  }

  function syncModeUI() {
    modeBtns.forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-ws-mode") === store.mode ? "true" : "false");
    });
    diffBtns.forEach(function (b) {
      var on = store.mode === "challenge" && b.getAttribute("data-ws-difficulty") === store.difficulty;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelector(".ws-diff").hidden = store.mode !== "challenge";
    levelsToggleBtn.hidden = store.mode !== "classic";
  }

  /* --- persistence sync ---------------------------------------------------- */

  function saveActiveToStore() {
    var c = cur();
    if (store.mode === "classic") {
      store.classic.level = classic.level;
      store.classic.unlocked = classic.unlocked;
      store.classic.completed = classic.completed;
      store.classic.bottles = classic.bottles;
      store.classic.moves = classic.moves;
    } else {
      var t = store.challenge[store.difficulty];
      var track = tracks[store.difficulty];
      if (track) {
        t.puzzle = {
          seed: track.seed,
          number: track.number,
          gen: 1,
          def: track.initial,
          state: track.bottles,
          moves: track.moves,
          optimal: track.optimal
        };
      }
    }
    store.settings.sound = window.WSSound.isEnabled();
  }

  function persistAll() {
    saveActiveToStore();
    persist();
  }

  /* --- rendering ------------------------------------------------------------ */

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
    var b = cur().bottles[i];
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
    var c = cur();
    setLiquid(i, c.bottles[i], c.bottles[i].length, false);
    rec.btn.classList.toggle("is-done", SOLVER.isDone(c.bottles[i]));
    rec.btn.setAttribute("aria-label", bottleLabel(i));
  }

  function renderAll() {
    for (var i = 0; i < els.length; i += 1) {
      renderBottle(i);
    }
  }

  function setSelection(i, silent) {
    var c = cur();
    if (c.selected >= 0 && els[c.selected]) {
      els[c.selected].btn.classList.remove("is-selected");
      els[c.selected].btn.setAttribute("aria-pressed", "false");
    }
    c.selected = i;
    if (i >= 0) {
      els[i].btn.classList.add("is-selected");
      els[i].btn.setAttribute("aria-pressed", "true");
      if (!silent) {
        announce("Bottle " + (i + 1) + " selected");
        window.WSSound.select();
      }
    } else if (!silent) {
      window.WSSound.deselect();
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

    var n = cur().initial.length;
    var rowCount = n <= 5 ? 1 : n <= 10 ? 2 : 3;
    var perRow = Math.ceil(n / rowCount);
    var rows = [];
    var row = document.createElement("div");
    row.className = "ws-row";
    for (var i = 0; i < n; i += 1) {
      if (i > 0 && i % perRow === 0) {
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

    boardEl.classList.remove("is-won");
    resultEl.hidden = true;
    clearHint();

    boardEl.addEventListener("click", onBoardClick);
  }

  function buildLevelsGrid() {
    levelsGrid.innerHTML = "";
    for (var i = 0; i < LEVELS.length; i += 1) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-level-btn";
      btn.textContent = String(i + 1).padStart(2, "0");
      if (classic.completed.indexOf(i) >= 0) btn.classList.add("is-done");
      if (i === classic.level) btn.setAttribute("aria-current", "true");
      if (i > classic.unlocked) btn.disabled = true;
      btn.setAttribute("aria-label", "Level " + (i + 1) + (i > classic.unlocked ? ", locked" : ""));
      btn.addEventListener("click", onLevelBtn(i));
      levelsGrid.appendChild(btn);
    }
  }

  /* --- input ------------------------------------------------------------------ */

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
    window.WSSound.invalid();
  }

  function onBottleTap(i) {
    var c = cur();
    if (!c || c.locked || c.solved || pendingGenerate) return;

    if (c.selected === -1) {
      if (!c.bottles[i].length) {
        reject(i);
        return;
      }
      setSelection(i);
      return;
    }

    if (i === c.selected) {
      setSelection(-1);
      return;
    }

    if (SOLVER.canPour(c.bottles[c.selected], c.bottles[i])) {
      doPour(c.selected, i);
      return;
    }

    if (c.bottles[i].length) {
      setSelection(i);
      return;
    }

    reject(i);
  }

  /* --- pour + animation ---------------------------------------------------------- */

  function doPour(si, di) {
    var c = cur();
    var amt = SOLVER.getPourAmount(c.bottles[si], c.bottles[di]);
    if (!amt) {
      reject(di);
      return;
    }

    var pre = {
      srcUnits: c.bottles[si].slice(),
      srcCount: c.bottles[si].length,
      dstCount: c.bottles[di].length,
      color: SOLVER.getTopColor(c.bottles[si])
    };

    c.history.push({ bottles: SOLVER.cloneBottles(c.bottles), moves: c.moves });
    SOLVER.applyPour(c.bottles, si, di);
    c.moves += 1;
    updateHud();
    setSelection(-1, true);
    updateUndoBtn();
    clearHint();
    stateLockedChanged();
    announce("Poured " + amt + " " + COLORS[pre.color].name + " into bottle " + (di + 1));

    if (reduceMotion) {
      renderAll();
      persistAll();
      afterPour();
      return;
    }

    setLiquid(si, pre.srcUnits, pre.srcCount, false);
    setLiquid(di, c.bottles[di], pre.dstCount, false);
    runPourAnimation(si, di, pre, amt);
  }

  function stateLockedChanged() {
    var c = cur();
    if (c) c.locked = true;
    updateUndoBtn();
    updateHintBtn();
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
    rec.liqClip.style.transform = clipTransform(cur().bottles[si].length);
    els[di].liqClip.style.transform = clipTransform(cur().bottles[di].length);

    var docX = window.pageXOffset || window.scrollX || 0;
    var docY = window.pageYOffset || window.scrollY || 0;
    var lipX = mouthScreenX + dir * 5.17 * s1;
    var lipY = mouthScreenY + 9.7 * s1;
    var endY = r2.top + docY + (surfaceY(cur().bottles[di].length) / VB_H) * r2.height;
    var height = Math.max(4, endY - (lipY + docY));

    var stream = document.createElement("div");
    stream.className = "ws-stream";
    stream.style.left = (lipX + docX - 2.25) + "px";
    stream.style.top = (lipY + docY - 1) + "px";
    stream.style.height = height + "px";
    stream.style.background = "linear-gradient(180deg, " + COLORS[pre.color].light + ", " + COLORS[pre.color].base + ")";
    overlay.appendChild(stream);

    window.WSSound.pour(amt);
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
    persistAll();
    afterPour();
  }

  function afterPour() {
    var c = cur();
    c.locked = false;
    if (SOLVER.isSolved(c.bottles)) {
      victory();
    }
    updateUndoBtn();
    updateHintBtn();
  }

  /* --- victory ---------------------------------------------------------------- */

  function victory() {
    var c = cur();
    c.solved = true;
    setSelection(-1, true);
    boardEl.classList.add("is-won");
    window.WSSound.victory();

    if (store.mode === "classic") {
      if (classic.completed.indexOf(classic.level) < 0) {
        classic.completed.push(classic.level);
      }
      classic.unlocked = Math.max(classic.unlocked, Math.min(classic.level + 1, LEVELS.length - 1));
      buildLevelsGrid();
    } else {
      var t = store.challenge[store.difficulty];
      t.completed = Math.max(t.completed, c.number);
    }
    persistAll();
    updateUndoBtn();
    updateHintBtn();
    announce(store.mode === "classic" ? "Level complete in " + c.moves + " moves" : "Puzzle complete in " + c.moves + " moves");

    window.setTimeout(function () {
      if (store.mode === "classic") {
        var last = classic.level === LEVELS.length - 1;
        resultTitleEl.textContent = last ? "All levels complete" : "Level complete";
        resultMetaEl.textContent = "Moves " + c.moves;
        resultOptimalEl.hidden = true;
        nextBtn.textContent = "Next level";
        nextBtn.hidden = last;
      } else {
        resultTitleEl.textContent = "Puzzle complete";
        resultMetaEl.textContent = "Moves " + c.moves;
        if (c.optimal != null) {
          resultOptimalEl.textContent = "Optimal " + c.optimal;
          resultOptimalEl.hidden = false;
        } else {
          resultOptimalEl.hidden = true;
        }
        nextBtn.textContent = "Next puzzle";
        nextBtn.hidden = false;
      }
      resultEl.hidden = false;
    }, 1000);
  }

  /* --- controls ------------------------------------------------------------------ */

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
    var c = cur();
    if (!c) return;
    clearRestartArm();
    c.bottles = SOLVER.cloneBottles(c.initial);
    c.moves = 0;
    c.history = [];
    c.solved = false;
    c.locked = false;
    setSelection(-1, true);
    clearHint();
    boardEl.classList.remove("is-won");
    resultEl.hidden = true;
    renderAll();
    updateHud();
    updateUndoBtn();
    updateHintBtn();
    persistAll();
    announce(store.mode === "classic" ? "Level restarted" : "Puzzle restarted");
  }

  function onUndo() {
    var c = cur();
    if (!c || c.locked || c.solved || !c.history.length) return;
    var prev = c.history.pop();
    c.bottles = prev.bottles;
    c.moves = prev.moves;
    setSelection(-1, true);
    clearHint();
    renderAll();
    updateHud();
    updateUndoBtn();
    persistAll();
    announce("Move undone");
  }

  function onRestart() {
    var c = cur();
    if (!c || c.locked) return;
    if (c.moves > 0 && !restartArmed) {
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
      if (classic.locked || index > classic.unlocked) return;
      loadClassic(index);
    };
  }

  function loadClassic(index) {
    clearRestartArm();
    var unlocked = classic.unlocked;
    var completed = classic.completed;
    classic = freshClassicState(index);
    classic.unlocked = unlocked;
    classic.completed = completed;
    boardEl.classList.remove("is-won");
    resultEl.hidden = true;
    levelsPanel.hidden = true;
    levelsToggleBtn.setAttribute("aria-expanded", "false");
    buildBoard();
    buildLevelsGrid();
    renderAll();
    updateHud();
    updateUndoBtn();
    updateHintBtn();
    persistAll();
    announce("Level " + (index + 1) + " loaded");
  }

  /* --- modes ----------------------------------------------------------------------- */

  function setMode(mode) {
    if (mode === store.mode) return;
    if (cur() && cur().locked) return;
    clearRestartArm();
    store.mode = mode;
    pendingGenerate = null;
    hintPanel.hidden = true;
    resultEl.hidden = true;
    levelsPanel.hidden = true;
    genEl.hidden = true;
    boardEl.hidden = false;
    syncModeUI();
    loadActive();
    persistAll();
  }

  function setDifficulty(diff) {
    if (diff === store.difficulty) return;
    if (store.mode !== "challenge") return;
    if (cur() && cur().locked) return;
    clearRestartArm();
    store.difficulty = diff;
    pendingGenerate = null;
    hintPanel.hidden = true;
    resultEl.hidden = true;
    genEl.hidden = true;
    boardEl.hidden = false;
    syncModeUI();
    loadActive();
    persistAll();
  }

  function loadActive() {
    clearHint();
    if (store.mode === "classic") {
      classic = store.classic.bottles
        ? restoreClassic()
        : freshClassicState(store.classic.level);
      buildBoard();
      buildLevelsGrid();
      renderAll();
      updateHud();
      updateUndoBtn();
      updateHintBtn();
      return;
    }
    loadChallenge();
  }

  function restoreClassic() {
    var c = freshClassicState(store.classic.level);
    c.bottles = SOLVER.cloneBottles(store.classic.bottles);
    c.moves = store.classic.moves;
    c.unlocked = store.classic.unlocked;
    c.completed = store.classic.completed.slice();
    return c;
  }

  /* --- challenge generation via worker ---------------------------------------------- */

  function ensureWorker() {
    if (worker) return worker;
    try {
      worker = new Worker("../../assets/js/water-sort-worker.js");
    } catch (e) {
      worker = null;
    }
    if (worker) {
      worker.onmessage = onWorkerMessage;
      worker.onerror = function () { worker = null; onWorkerDead(); };
    }
    return worker;
  }

  function onWorkerDead() {
    if (pendingHint) {
      finishHint({ status: "failed" });
    }
    if (pendingGenerate) {
      var pg = pendingGenerate;
      pendingGenerate = null;
      genEl.hidden = true;
      boardEl.hidden = false;
      announce("Puzzle generation unavailable");
      loadChallengeFallback(pg.difficulty);
    }
  }

  function workerSend(msg) {
    var w = ensureWorker();
    if (!w) return Promise.reject(new Error("no-worker"));
    return new Promise(function (resolve) {
      workerJobs[msg.id] = resolve;
      w.postMessage(msg);
    });
  }

  var workerJobs = {};

  function onWorkerMessage(e) {
    var msg = e.data;
    if (!msg || typeof msg.id !== "number") return;
    var resolve = workerJobs[msg.id];
    if (resolve) {
      delete workerJobs[msg.id];
      resolve(msg);
    }
  }

  function seedFor(difficulty, number) {
    return "ws2-" + difficulty + "-" + number;
  }

  function loadChallenge() {
    clearHint();
    var t = store.challenge[store.difficulty];
    if (t.puzzle && t.puzzle.def) {
      var p = t.puzzle;
      tracks[store.difficulty] = {
        initial: SOLVER.cloneBottles(p.def),
        bottles: SOLVER.cloneBottles(p.state && p.state.length === p.def.length ? p.state : p.def),
        moves: p.state ? p.moves : 0,
        history: [],
        selected: -1,
        solved: false,
        locked: false,
        number: p.number,
        seed: p.seed,
        optimal: p.optimal
      };
      buildBoard();
      renderAll();
      updateHud();
      updateUndoBtn();
      updateHintBtn();
      return;
    }
    generateChallenge(t.completed + 1);
  }

  function generateChallenge(number) {
    pendingGenerate = { difficulty: store.difficulty, number: number };
    clearHint();
    boardEl.innerHTML = "";
    els = [];
    boardEl.hidden = true;
    genEl.hidden = false;
    genEl.textContent = "CALCULATING…";
    updateHud();
    updateUndoBtn();
    updateHintBtn();

    var diff = store.difficulty;
    workerSend({
      id: ++jobId,
      type: "generate",
      difficulty: diff,
      seed: seedFor(diff, number),
      number: number
    }).then(function (res) {
      if (pendingGenerate && pendingGenerate.difficulty === diff) {
        pendingGenerate = null;
      } else {
        return;
      }
      genEl.hidden = true;
      boardEl.hidden = false;
      if (!res.ok || !res.def) {
        announce("Puzzle generation failed");
        loadChallengeFallback(diff);
        return;
      }
      store.challenge[diff].puzzle = {
        seed: res.seed,
        number: res.number,
        gen: res.gen,
        def: res.def,
        state: null,
        moves: 0,
        optimal: res.metrics ? res.metrics.optimalDepth : null
      };
      tracks[diff] = freshTrackState(res.def, store.challenge[diff].puzzle);
      buildBoard();
      renderAll();
      updateHud();
      updateUndoBtn();
      updateHintBtn();
      persistAll();
      announce("Challenge " + res.number + " ready");
    }).catch(function () {
      if (pendingGenerate) {
        pendingGenerate = null;
        genEl.hidden = true;
        boardEl.hidden = false;
        loadChallengeFallback(diff);
      }
    });
  }

  function loadChallengeFallback(difficulty) {
    var def = fallbackDef(difficulty);
    store.challenge[difficulty].puzzle = {
      seed: seedFor(difficulty, store.challenge[difficulty].completed + 1),
      number: store.challenge[difficulty].completed + 1,
      gen: 1,
      def: def,
      state: null,
      moves: 0,
      optimal: null
    };
    tracks[difficulty] = freshTrackState(def, store.challenge[difficulty].puzzle);
    buildBoard();
    renderAll();
    updateHud();
    updateUndoBtn();
    updateHintBtn();
    persistAll();
  }

  function fallbackDef(difficulty) {
    var counts = { easy: 4, medium: 6, hard: 8 };
    var n = counts[difficulty] || 4;
    var rng = Math.random;
    var colors = [];
    for (var i = 0; i < n; i += 1) colors.push(i);
    var units = [];
    colors.forEach(function (c) {
      for (var u = 0; u < 4; u += 1) units.push(c);
    });
    for (var k = units.length - 1; k > 0; k -= 1) {
      var j2 = Math.floor(rng() * (k + 1));
      var tmp = units[k]; units[k] = units[j2]; units[j2] = tmp;
    }
    var bottles = [];
    for (var b = 0; b < n; b += 1) bottles.push(units.slice(b * 4, b * 4 + 4));
    bottles.push([], []);
    return bottles;
  }

  function nextChallenge() {
    var diff = store.difficulty;
    var t = store.challenge[diff];
    t.puzzle = null;
    store.challenge[diff] = t;
    if (store.mode !== "challenge" || cur().locked) return;
    generateChallenge(t.completed + 1);
  }

  /* --- hint ----------------------------------------------------------------------------- */

  function stateKeyOfCur() {
    var c = cur();
    return SOLVER.stateKey(c.bottles);
  }

  function hintContext() {
    return store.mode === "challenge" ? store.difficulty : "classic";
  }

  function clearHint() {
    if (hintPulseTimer) {
      window.clearTimeout(hintPulseTimer);
      hintPulseTimer = null;
    }
    hintResultEl.hidden = true;
    hintResultEl.textContent = "";
    els.forEach(function (rec) {
      rec.btn.classList.remove("is-hint-src", "is-hint-dst");
    });
  }

  function showHintPanel() {
    var c = cur();
    if (!c || c.locked || c.solved || pendingHint || pendingGenerate) return;
    hintPanel.hidden = false;
    hintConfirmBtn.focus();
  }

  function requestHint() {
    var c = cur();
    hintPanel.hidden = true;
    if (!c || c.locked || c.solved || pendingHint || pendingGenerate) return;

    var key = stateKeyOfCur() + "::" + hintContext();
    var cached = hintCache.get(key);
    if (cached) {
      showHintResult(cached);
      return;
    }

    var context = hintContext();
    var snapKey = SOLVER.stateKey(c.bottles);
    var job = { id: ++jobId, stateKey: snapKey, moves: c.moves };
    pendingHint = job;
    updateHintBtn();
    hintResultEl.hidden = false;
    hintResultEl.textContent = "CALCULATING…";
    announce("Calculating hint");

    workerSend({ id: job.id, type: "hint", state: SOLVER.cloneBottles(c.bottles), context: context })
      .then(function (res) {
        var stillCurrent = cur() &&
          !pendingGenerate &&
          SOLVER.stateKey(cur().bottles) === snapKey &&
          cur().moves === job.moves &&
          pendingHint === job;
        var wasPending = pendingHint;
        pendingHint = null;
        updateHintBtn();
        if (!stillCurrent) return;
        var out = {
          status: res.status,
          proven: !!res.proven,
          move: res.move,
          nodes: res.nodes,
          ms: res.ms
        };
        hintCache.set(key, out);
        while (hintCache.size > HINT_CACHE_MAX) {
          hintCache.delete(hintCache.keys().next().value);
        }
        showHintResult(out);
      })
      .catch(function () {
        if (pendingHint === job) {
          pendingHint = null;
          updateHintBtn();
          finishHint({ status: "failed" });
        }
      });
  }

  function finishHint(out) {
    hintResultEl.hidden = false;
    if (out.status === "failed") {
      hintResultEl.textContent = "NO HINT AVAILABLE";
      announce("No hint available");
      return;
    }
    if (out.status === "unsolvable") {
      hintResultEl.textContent = out.proven ? "NO SOLUTION FROM HERE — TRY UNDO OR RESTART" : "NO HINT AVAILABLE";
      announce(out.proven ? "No solution from this position. Try undo or restart." : "No hint available");
      return;
    }
    var mv = out.move;
    if (!mv) {
      hintResultEl.textContent = "NO HINT AVAILABLE";
      return;
    }
    var color = SOLVER.getTopColor(cur().bottles[mv.i]);
    var text = "POUR " + COLORS[color].name.toUpperCase() + " — BOTTLE " + (mv.i + 1) + " → BOTTLE " + (mv.j + 1);
    hintResultEl.textContent = text;
    announce("Hint: pour bottle " + (mv.i + 1) + " into bottle " + (mv.j + 1) + ", " + COLORS[color].name);
    window.WSSound.hint();

    if (els[mv.i] && els[mv.j]) {
      els[mv.i].btn.classList.add("is-hint-src");
      if (reduceMotion) {
        els[mv.j].btn.classList.add("is-hint-dst");
      } else {
        hintPulseTimer = window.setTimeout(function () {
          els[mv.j].btn.classList.add("is-hint-dst");
        }, 700);
      }
    }
  }

  function showHintResult(out) {
    finishHint(out);
  }

  /* --- sound toggle ----------------------------------------------------------------------- */

  function applySoundPref() {
    window.WSSound.setEnabled(store.settings.sound);
    soundBtn.setAttribute("aria-pressed", store.settings.sound ? "true" : "false");
    soundBtn.textContent = store.settings.sound ? "Sound" : "Sound off";
  }

  function toggleSound() {
    store.settings.sound = !store.settings.sound;
    applySoundPref();
    persistAll();
  }

  /* --- init ---------------------------------------------------------------------------------- */

  function init() {
    overlay = document.createElement("div");
    overlay.className = "ws-overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);

    loadStorage();
    window.WSSound.setEnabled(store.settings.sound);

    undoBtn.addEventListener("click", onUndo);
    restartBtn.addEventListener("click", onRestart);
    hintBtn.addEventListener("click", showHintPanel);
    hintConfirmBtn.addEventListener("click", requestHint);
    hintCancelBtn.addEventListener("click", function () {
      hintPanel.hidden = true;
      hintBtn.focus();
    });
    soundBtn.addEventListener("click", function () {
      window.WSSound.unlock();
      toggleSound();
    });
    nextBtn.addEventListener("click", function () {
      if (store.mode === "classic") {
        if (classic.level < LEVELS.length - 1) loadClassic(classic.level + 1);
      } else {
        nextChallenge();
      }
    });
    replayBtn.addEventListener("click", doRestart);
    levelsToggleBtn.addEventListener("click", function () {
      var open = levelsPanel.hidden;
      levelsPanel.hidden = !open;
      levelsToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    modeBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        window.WSSound.unlock();
        setMode(b.getAttribute("data-ws-mode"));
      });
    });
    diffBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        window.WSSound.unlock();
        setDifficulty(b.getAttribute("data-ws-difficulty"));
      });
    });
    document.addEventListener("pointerdown", function () {
      window.WSSound.unlock();
    }, { passive: true });

    window.addEventListener("resize", function () {
      if (activeAnim || activeTimers.length) {
        cleanupPour();
      }
    });

    syncModeUI();
    applySoundPref();
    loadActive();
  }

  init();
})();
