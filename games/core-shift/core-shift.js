/* ------------------------------------------------------------------
   Core Shift — randolf.dev
   Sokoban-style puzzle: dock every Energy Core to restore ship power.

   Architecture:
     - engine.js   pure rules (authoritative logical state)
     - levels.js   level data
     - this file   rendering, input, audio, persistence

   Input model (documented per spec):
     logical state is authoritative; every input becomes a list of ops.
     Ops run one at a time from a queue; DOM transitions follow state.
     A new direct input REPLACES the pending queue (cancels remaining
     convenience steps) and starts after the in-flight op finishes.
     Undo/Restart clear the queue entirely.

   Sound: local Web Audio cues. The shared Games sound preference
   ("randolf:games:sound") is respected via window.GameAudio when the
   shared helper is present; no shared file was modified for this game.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var E = window.CSEngine;
  var SOLVER = window.CSSolver;
  var LEVELS = window.CS_LEVELS;

  var STORE_KEY = "randolf:core-shift:v1";
  var WALK_MS = 105;
  var PUSH_MS = 155;
  var SWIPE_PX = 24;
  var TAP_PX = 6;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     Storage
     ------------------------------------------------------------------ */

  function loadStore() {
    var empty = { v: 1, unlocked: 0, completed: {}, current: 0, snap: null };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return empty;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object" || data.v !== 1) return empty;
      var out = {
        v: 1,
        unlocked: clampInt(data.unlocked, 0, LEVELS.length - 1, 0),
        completed: {},
        current: clampInt(data.current, 0, LEVELS.length - 1, 0),
        snap: null
      };
      if (data.completed && typeof data.completed === "object") {
        for (var k in data.completed) {
          var idx = parseInt(k, 10);
          var rec = data.completed[k];
          if (idx >= 0 && idx < LEVELS.length && rec && typeof rec.p === "number" && typeof rec.m === "number") {
            out.completed[idx] = { p: rec.p, m: rec.m };
          }
        }
      }
      if (data.snap && typeof data.snap === "object") {
        out.snap = data.snap; /* validated against the level at restore time */
      }
      return out;
    } catch (e) {
      return empty;
    }
  }

  function clampInt(v, lo, hi, dflt) {
    v = parseInt(v, 10);
    if (isNaN(v) || v < lo || v > hi) return dflt;
    return v;
  }

  var store = loadStore();
  var saveTimer = null;

  function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (e) { /* storage unavailable — game still fully playable */ }
    }, 120);
  }

  /* ------------------------------------------------------------------
     Sound — local cues, shared preference
     ------------------------------------------------------------------ */

  var audio = (function () {
    var ctx = null;
    var master = null;
    var last = {};

    function prefOn() {
      if (window.GameAudio) return window.GameAudio.isEnabled();
      try {
        return window.localStorage.getItem("randolf:games:sound") !== "off";
      } catch (e) {
        return true;
      }
    }

    function ensure() {
      if (!prefOn()) return null;
      if (!ctx) {
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.42;
          master.connect(ctx.destination);
        } catch (e) {
          ctx = null;
          return null;
        }
      }
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      return ctx;
    }

    function tone(t0, f0, f1, dur, peak, type) {
      var c = ctx;
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(Math.max(20, f0), t0);
      if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.007);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function hiss(t0, dur, peak, f0, f1) {
      var c = ctx;
      var len = Math.floor(c.sampleRate * Math.max(dur, 0.1));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource();
      src.buffer = buf;
      var filt = c.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      filt.Q.value = 1;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    }

    function cue(key, gapMs, fn) {
      var now = Date.now();
      if (last[key] && now - last[key] < gapMs) return;
      last[key] = now;
      var c = ensure();
      if (!c) return;
      try {
        fn(c.currentTime + 0.005);
      } catch (e) { /* never break gameplay */ }
    }

    return {
      isEnabled: prefOn,
      setEnabled: function (on) {
        if (window.GameAudio) {
          window.GameAudio.setEnabled(on);
        } else {
          try {
            window.localStorage.setItem("randolf:games:sound", on ? "on" : "off");
          } catch (e) {}
        }
        if (on) ensure();
        else if (ctx) ctx.suspend().catch(function () {});
      },
      step: function () {
        cue("cs.step", 55, function (t) {
          hiss(t, 0.03, 0.05, 1500, 900);
          tone(t, 300, 240, 0.04, 0.035, "sine");
        });
      },
      push: function () {
        cue("cs.push", 70, function (t) {
          tone(t, 150, 88, 0.11, 0.14, "sine");
          hiss(t, 0.06, 0.06, 700, 320);
        });
      },
      dock: function () {
        cue("cs.dock", 90, function (t) {
          tone(t, 620, 880, 0.1, 0.1, "triangle");
          hiss(t, 0.02, 0.07, 3000, 2600);
          tone(t + 0.09, 990, 990, 0.14, 0.06, "sine");
        });
      },
      power: function () {
        cue("cs.power", 140, function (t) {
          tone(t, 440, 880, 0.28, 0.07, "sine");
          tone(t + 0.06, 660, 1320, 0.24, 0.045, "sine");
        });
      },
      undock: function () {
        cue("cs.undock", 90, function (t) {
          tone(t, 520, 290, 0.13, 0.08, "sine");
          hiss(t, 0.05, 0.04, 900, 500);
        });
      },
      blocked: function () {
        cue("cs.blocked", 120, function (t) {
          tone(t, 170, 120, 0.07, 0.07, "triangle");
        });
      },
      warn: function () {
        cue("cs.warn", 400, function (t) {
          tone(t, 330, 330, 0.09, 0.07, "square");
          tone(t + 0.16, 262, 262, 0.11, 0.06, "square");
        });
      },
      online: function () {
        cue("cs.online", 600, function (t) {
          tone(t, 523, 523, 0.5, 0.08, "sine");
          tone(t + 0.12, 784, 784, 0.45, 0.07, "sine");
          tone(t + 0.24, 1046, 1046, 0.5, 0.05, "sine");
        });
      },
      launch: function () {
        cue("cs.launch", 800, function (t) {
          hiss(t, 1.4, 0.16, 120, 900);
          tone(t, 65, 220, 1.3, 0.14, "sawtooth");
          tone(t + 0.9, 220, 440, 0.7, 0.07, "sine");
        });
      },
      ui: function () {
        cue("cs.ui", 60, function (t) {
          tone(t, 480, 380, 0.035, 0.04, "sine");
        });
      }
    };
  })();

  /* ------------------------------------------------------------------
     DOM handles
     ------------------------------------------------------------------ */

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var el = {
    stage: $("[data-cs-stage]"),
    ship: $("[data-cs-ship]"),
    clip: $("[data-cs-clip]"),
    board: $("[data-cs-board]"),
    grid: $("[data-cs-cells]"),
    actors: $("[data-cs-actors]"),
    hints: $("[data-cs-hints]"),
    lights: $("[data-cs-lights]"),
    ambient: $("[data-cs-ambient]"),
    stars: $("[data-cs-stars]"),
    online: $("[data-cs-online]"),
    engine: $("[data-cs-engine]"),
    overlay: $("[data-cs-overlay]"),
    power: $("[data-cs-power]"),
    moves: $("[data-cs-moves]"),
    pushes: $("[data-cs-pushes]"),
    undo: $("[data-cs-undo]"),
    restart: $("[data-cs-restart]"),
    levelsBtn: $("[data-cs-levels]"),
    sound: $("[data-cs-sound]"),
    levelNum: $("[data-cs-level-num]"),
    levelName: $("[data-cs-level-name]"),
    live: $("[data-cs-live]")
  };

  var panels = {
    result: $("[data-cs-panel=result]"),
    confirm: $("[data-cs-panel=confirm]"),
    levels: $("[data-cs-panel=levels]")
  };

  /* ------------------------------------------------------------------
     Game state
     ------------------------------------------------------------------ */

  var lv = null;          /* parsed level (static) */
  var dead = null;        /* {alive, dead} */
  var cur = null;         /* {player, cores} authoritative */
  var moves = 0;
  var pushes = 0;
  var hist = "";          /* lowercase=move, uppercase=push; chars u d l r */
  var levelIdx = 0;
  var facing = "down";
  var solvedFired = false;
  var celebrating = false;

  var cellEls = [];       /* idx -> cell element */
  var coreEls = [];       /* core index -> element */
  var robotEl = null;
  var robotFace = null;
  var dockCells = {};     /* dock idx -> cell element */
  var segByDock = [];     /* dock order -> segment element */
  var selectedCore = -1;  /* core index, -1 = none */
  var pushTargets = {};   /* cell idx -> {core, dir, steps} */

  var queue = [];
  var running = false;
  var pendingDirect = null;

  var PAR = [1, 4, 2, 4, 6, 6, 8, 8, 8, 11, 10, 18, 14, 11, 17, 16];

  /* ------------------------------------------------------------------
     Board construction
     ------------------------------------------------------------------ */

  function buildBoard() {
    el.grid.style.setProperty("--cols", lv.w);
    el.grid.style.setProperty("--rows", lv.h);
    el.grid.innerHTML = "";
    el.actors.innerHTML = "";
    el.hints.innerHTML = "";
    el.lights.innerHTML = "";
    cellEls = [];
    dockCells = {};

    var wallNF;
    for (var y = 0; y < lv.h; y += 1) {
      for (var x = 0; x < lv.w; x += 1) {
        var i = y * lv.w + x;
        var c = document.createElement("div");
        if (lv.walls[i]) {
          c.className = "cs-cell c-wall";
          var onRing = x === 0 || y === 0 || x === lv.w - 1 || y === lv.h - 1;
          if (onRing) c.classList.add("cs-edge");
          wallNF = (x * 7 + y * 13 + ((x * y) % 5)) % 5;
          if (wallNF === 0 && !onRing) c.classList.add("cs-rivet");
        } else {
          c.className = "cs-cell c-floor" + ((x + y) % 2 ? " cs-alt" : "");
          if (E.isDock(lv, i)) {
            var dock = document.createElement("div");
            dock.className = "cs-dock";
            c.appendChild(dock);
            dockCells[i] = c;
          }
        }
        el.grid.appendChild(c);
        cellEls.push(c);
      }
    }

    buildCores();
    buildRobot();
    buildLights();
  }

  function buildCores() {
    coreEls = [];
    for (var i = 0; i < cur.cores.length; i += 1) {
      var a = document.createElement("div");
      a.className = "cs-actor cs-core";
      a.innerHTML =
        '<div class="cs-inner"><div class="cs-core-gem"></div></div>';
      el.actors.appendChild(a);
      coreEls.push(a);
    }
  }

  function buildRobot() {
    robotEl = document.createElement("div");
    robotEl.className = "cs-actor cs-robot";
    robotEl.innerHTML =
      '<div class="cs-inner">' +
      '<svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">' +
      '<rect x="10" y="30" width="20" height="6" rx="3" fill="#2a2d33"/>' +
      '<rect x="8" y="8" width="24" height="24" rx="6" fill="#e8eaee"/>' +
      '<rect x="8" y="8" width="24" height="24" rx="6" fill="none" stroke="#b7bcc4" stroke-width="1"/>' +
      '<g data-cs-face>' +
      '<rect x="13" y="11" width="14" height="11" rx="3.4" fill="#101216"/>' +
      '<g class="cs-robot-eyes">' +
      '<circle cx="17.4" cy="16.5" r="1.9" fill="#59d8e6"/>' +
      '<circle cx="22.6" cy="16.5" r="1.9" fill="#59d8e6"/>' +
      "</g>" +
      "</g>" +
      '<circle cx="20" cy="26" r="1.6" fill="#59d8e6" opacity="0.85"/>' +
      '<rect x="12" y="4.5" width="16" height="3.5" rx="1.75" fill="#3a3e45"/>' +
      "</svg>" +
      "</div>";
    el.actors.appendChild(robotEl);
    robotFace = robotEl.querySelector("[data-cs-face]");
  }

  /* Perimeter light circuits: each dock owns one segment.
     Docks are grouped to their nearest edge, then spaced along it. */
  function buildLights() {
    segByDock = [];
    var edges = { top: [], right: [], bottom: [], left: [] };
    var cx = (lv.w - 1) / 2;
    var cy = (lv.h - 1) / 2;
    for (var d = 0; d < lv.docks.length; d += 1) {
      var i = lv.docks[d];
      var dx = (i % lv.w) - cx;
      var dy = Math.floor(i / lv.w) - cy;
      var edge =
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0 ? "right" : "left"
          : dy >= 0 ? "bottom" : "top";
      edges[edge].push(d);
    }

    Object.keys(edges).forEach(function (edge) {
      var list = edges[edge];
      if (!list.length) return;
      list.sort(function (a, b) {
        return dockCoord(lv.docks[a], edge) - dockCoord(lv.docks[b], edge);
      });
      var n = list.length;
      for (var k = 0; k < n; k += 1) {
        var start = (k + 0.08) / n;
        var len = 0.84 / n;
        var seg = document.createElement("div");
        seg.className = "cs-seg";
        positionSeg(seg, edge, start, len);
        el.lights.appendChild(seg);
        segByDock[list[k]] = seg;
      }
    });
  }

  function dockCoord(idx, edge) {
    if (edge === "top" || edge === "bottom") return idx % lv.w;
    return Math.floor(idx / lv.w);
  }

  function positionSeg(seg, edge, start, len) {
    var pct = function (v) { return (v * 100).toFixed(2) + "%"; };
    if (edge === "top") {
      seg.style.cssText += "top:0;left:" + pct(start) + ";width:" + pct(len) + ";height:4px;";
    } else if (edge === "bottom") {
      seg.style.cssText += "top:calc(100% - 4px);left:" + pct(start) + ";width:" + pct(len) + ";height:4px;";
    } else if (edge === "left") {
      seg.style.cssText += "left:0;top:" + pct(start) + ";height:" + pct(len) + ";width:4px;";
    } else {
      seg.style.cssText += "left:calc(100% - 4px);top:" + pct(start) + ";height:" + pct(len) + ";width:4px;";
    }
  }

  /* ------------------------------------------------------------------
     Rendering sync
     ------------------------------------------------------------------ */

  function posTransform(idx) {
    var x = idx % lv.w;
    var y = Math.floor(idx / lv.w);
    return "translate(" + x * 100 + "%, " + y * 100 + "%)";
  }

  function positionActors() {
    for (var i = 0; i < cur.cores.length; i += 1) {
      coreEls[i].style.transform = posTransform(cur.cores[i]);
      coreEls[i].classList.toggle("cs-docked", E.isDock(lv, cur.cores[i]));
    }
    robotEl.style.transform = posTransform(cur.player);
  }

  function setFacing(dir) {
    if (!dir) return;
    facing = dir;
    var angle = { right: 0, down: 90, left: 180, up: 270 }[dir] || 0;
    robotFace.setAttribute("transform", "rotate(" + angle + " 20 20)");
  }

  function updatePowerUI() {
    var powered = E.dockedCount(lv, cur);
    var total = lv.docks.length;
    el.power.textContent = powered + " / " + total;
    el.power.classList.toggle("cs-power-full", powered === total);
    el.moves.textContent = String(moves);
    el.pushes.textContent = String(pushes);

    for (var d = 0; d < lv.docks.length; d += 1) {
      var on = E.coreAt(lv, cur, lv.docks[d]) >= 0;
      dockCells[lv.docks[d]].classList.toggle("c-powered", on);
      if (segByDock[d]) segByDock[d].classList.toggle("cs-lit", on);
    }

    el.ambient.style.opacity = total ? (powered / total) * 0.9 : 0;
    el.ship.classList.toggle("cs-ship-full", powered === total);
  }

  function updateButtons() {
    el.undo.disabled = hist.length === 0 || celebrating;
  }

  function announce(text) {
    if (!el.live) return;
    el.live.textContent = "";
    window.setTimeout(function () {
      el.live.textContent = text;
    }, 30);
  }

  /* ------------------------------------------------------------------
     Ops / queue
     ------------------------------------------------------------------ */

  function opDuration(op) {
    if (reducedMotion) return 30;
    return op.t === "p" ? PUSH_MS : WALK_MS;
  }

  function executeOp(op) {
    var dir = op.d;
    setFacing(dir);
    var r = E.step(lv, cur, dir, dead);

    if (!r) {
      /* should not happen for validated ops; blocked key input lands here */
      soundBlocked();
      return;
    }

    if (op.t === "p") {
      moves += 1; /* a push is also a player grid step */
      pushes += 1;
      hist += dir.charAt(0).toUpperCase();
      audio.push();
    } else {
      moves += 1;
      hist += dir.charAt(0);
      audio.step();
    }

    positionActors();

    if (r.pushed) {
      leanRobot();
      if (r.docked) {
        audio.dock();
        flashDock(r.coreTo);
        var poweredAfter = E.dockedCount(lv, cur);
        announce("Core docked, " + poweredAfter + " of " + lv.docks.length);
        if (!reducedMotion) surgeSegment(r.coreTo);
        window.setTimeout(audio.power, 140);
      } else if (r.undocked) {
        audio.undock();
        announce("Core removed, " + E.dockedCount(lv, cur) + " of " + lv.docks.length);
      }
      if (r.deadLanding) {
        warnTrapped(r.coreIndex);
        announce("Warning: core trapped in a dead corner. Undo is available.");
      }
    }

    updatePowerUI();
    updateButtons();
    saveSnapshot();

    if (!E.isSolved(lv, cur)) solvedFired = false;
    if (E.isSolved(lv, cur) && !solvedFired) {
      solvedFired = true;
      queue.length = 0;
      window.setTimeout(beginVictory, reducedMotion ? 260 : 480);
    }
  }

  function runNext() {
    if (queue.length === 0) {
      running = false;
      if (pendingDirect) {
        var ops = pendingDirect;
        pendingDirect = null;
        submitOps(ops);
      }
      return;
    }
    running = true;
    var op = queue.shift();
    executeOp(op);
    window.setTimeout(runNext, opDuration(op));
  }

  /* Direct input replaces the queue; the in-flight op always completes. */
  function submitOps(ops) {
    if (celebrating || !ops.length) return;
    deselectCore();
    if (running) {
      pendingDirect = ops;
      queue.length = 0;
      return;
    }
    queue = ops.slice();
    runNext();
  }

  function cancelAuto() {
    queue.length = 0;
    pendingDirect = null;
  }

  /* ------------------------------------------------------------------
     Actions
     ------------------------------------------------------------------ */

  function tryMove(dir) {
    var n = E.neighbor(lv, cur.player, dir);
    if (n < 0) return false;
    var ci = E.coreAt(lv, cur, n);
    if (ci >= 0) {
      var beyond = E.neighbor(lv, n, dir);
      if (beyond < 0 || lv.walls[beyond] || E.coreAt(lv, cur, beyond) >= 0) {
        blockedBump(dir);
        return true; /* consumed, but nothing moves */
      }
      submitOps([{ t: "p", d: dir }]);
    } else if (lv.walls[n]) {
      blockedBump(dir);
      return true;
    } else {
      submitOps([{ t: "w", d: dir }]);
    }
    return true;
  }

  function doUndo() {
    if (!hist.length || celebrating) return;
    cancelAuto();
    deselectCore();
    var last = hist.charAt(hist.length - 1);
    var dir = CHAR_TO_DIR[last.toLowerCase()];
    var wasPush = last !== last.toLowerCase();
    if (!wasPush) {
      /* plain move: step back the way we came */
      cur.player = E.neighbor(lv, cur.player, opposite(dir));
      moves -= 1;
      setFacing(opposite(dir));
    } else {
      /* push reversal: core returns to the robot cell, robot steps back */
      var coreIdx = E.coreAt(lv, cur, E.neighbor(lv, cur.player, dir));
      cur.cores[coreIdx] = cur.player;
      cur.player = E.neighbor(lv, cur.player, opposite(dir));
      moves -= 1;
      pushes -= 1;
      setFacing(opposite(dir));
    }
    hist = hist.slice(0, -1);
    if (!E.isSolved(lv, cur)) solvedFired = false;
    positionActors();
    updatePowerUI();
    updateButtons();
    saveSnapshot();
    audio.ui();
  }

  function opposite(dir) {
    return { up: "down", down: "up", left: "right", right: "left" }[dir];
  }

  var CHAR_TO_DIR = { u: "up", d: "down", l: "left", r: "right" };

  function needsConfirm() {
    return pushes > 0 || moves > 2;
  }

  function doRestart(force) {
    cancelAuto();
    deselectCore();
    if (!force && needsConfirm() && !celebrating) {
      showPanel("confirm");
      return;
    }
    hideOverlay();
    solvedFired = false;
    celebrating = false;
    cur = E.initialState(lv);
    moves = 0;
    pushes = 0;
    hist = "";
    facing = "down";
    setFacing(facing);
    positionActors();
    updatePowerUI();
    updateButtons();
    saveSnapshot();
    audio.ui();
  }

  function loadLevel(idx, snap) {
    levelIdx = idx;
    store.current = idx;
    lv = E.parseLevel(LEVELS[idx]);
    dead = E.deadSquares(lv);
    solvedFired = false;
    celebrating = false;
    selectedCore = -1;
    pushTargets = {};
    cancelAuto();
    pendingDirect = null;

    cur = E.initialState(lv);
    moves = 0;
    pushes = 0;
    hist = "";
    facing = "down";

    if (snap && validSnap(snap)) {
      cur.player = snap.player;
      cur.cores = snap.cores.slice();
      moves = snap.moves;
      pushes = snap.pushes;
      hist = snap.hist;
      facing = snap.hist
        ? CHAR_TO_DIR[snap.hist.charAt(snap.hist.length - 1).toLowerCase()]
        : "down";
    }

    buildBoard();
    setFacing(facing);
    positionActors();
    updatePowerUI();
    updateButtons();
    hideOverlay();
    deselectCore();

    el.levelNum.textContent =
      pad(idx + 1) + " / " + pad(LEVELS.length);
    el.levelName.textContent = LEVELS[idx].name;
    persist();
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function validSnap(snap) {
    if (snap.li !== levelIdx) return false;
    if (!Array.isArray(snap.cores) || snap.cores.length !== lv.cores.length) return false;
    var n = lv.w * lv.h;
    if (!Number.isInteger(snap.player) || snap.player < 0 || snap.player >= n) return false;
    if (lv.walls[snap.player]) return false;
    for (var i = 0; i < snap.cores.length; i += 1) {
      var c = snap.cores[i];
      if (!Number.isInteger(c) || c < 0 || c >= n || lv.walls[c]) return false;
    }
    if (typeof snap.hist !== "string" || /[^udlrUDLR]/.test(snap.hist)) return false;
    if (snap.hist.length > 4000) return false;
    return (
      Number.isInteger(snap.moves) && snap.moves >= 0 &&
      Number.isInteger(snap.pushes) && snap.pushes >= 0
    );
  }

  function saveSnapshot() {
    store.snap = {
      li: levelIdx,
      player: cur.player,
      cores: cur.cores.slice(),
      moves: moves,
      pushes: pushes,
      hist: hist
    };
    persist();
  }

  function recordWin() {
    var rec = store.completed[levelIdx];
    var better =
      !rec || pushes < rec.p || (pushes === rec.p && moves < rec.m);
    if (better) store.completed[levelIdx] = { p: pushes, m: moves };
    if (levelIdx + 1 > store.unlocked && levelIdx + 1 < LEVELS.length) {
      store.unlocked = levelIdx + 1;
    }
    store.snap = null;
    persist();
  }

  /* ------------------------------------------------------------------
     Core selection / tap-to-walk / fast push
     ------------------------------------------------------------------ */

  function deselectCore() {
    selectedCore = -1;
    pushTargets = {};
    for (var i = 0; i < coreEls.length; i += 1) {
      coreEls[i].classList.remove("cs-selected");
    }
    el.hints.innerHTML = "";
  }

  function selectCore(ci) {
    deselectCore();
    selectedCore = ci;
    coreEls[ci].classList.add("cs-selected");
    pushTargets = {};

    for (var k = 0; k < 4; k += 1) {
      var dir = E.DIR_NAMES[k];
      var d = E.DIRS[dir];
      var core = cur.cores[ci];
      var stand = E.neighbor(lv, core, opposite(dir));
      var dest = E.neighbor(lv, core, dir);
      if (stand < 0 || dest < 0) continue;
      if (lv.walls[dest] || E.coreAt(lv, cur, dest) >= 0) continue;
      if (!E.reachability(lv, cur)[stand]) continue;

      pushTargets[dest] = { core: ci, dir: dir, steps: 1 };
      addHint(dest, false);

      /* fast-push: same straight line while every cell stays free */
      var far = dest;
      var steps = 1;
      for (;;) {
        var next = E.neighbor(lv, far, dir);
        if (next < 0 || lv.walls[next] || E.coreAt(lv, cur, next) >= 0) break;
        far = next;
        steps += 1;
        pushTargets[far] = { core: ci, dir: dir, steps: steps };
        addHint(far, true);
      }
    }
    audio.ui();
  }

  function addHint(idx, far) {
    var h = document.createElement("div");
    h.className = "cs-hint" + (far ? " cs-hint-far" : "");
    h.style.transform = posTransform(idx);
    el.hints.appendChild(h);
  }

  function tapCell(idx) {
    if (celebrating) return;

    /* push destination? (checked first; destinations never contain cores) */
    if (selectedCore >= 0 && pushTargets[idx]) {
      doPushTarget(pushTargets[idx]);
      return;
    }

    var ci = E.coreAt(lv, cur, idx);
    if (ci >= 0) {
      if (selectedCore === ci) deselectCore();
      else selectCore(ci);
      return;
    }

    if (lv.walls[idx]) return;

    var path = E.findPath(lv, cur, cur.player, idx);
    if (!path) {
      audio.blocked();
      return;
    }
    deselectCore();
    var ops = [];
    var prev = cur.player;
    for (var i = 0; i < path.length; i += 1) {
      ops.push({ t: "w", d: dirBetween(prev, path[i]) });
      prev = path[i];
    }
    submitOps(ops);
  }

  function dirBetween(fromIdx, toIdx) {
    var fx = fromIdx % lv.w;
    var fy = Math.floor(fromIdx / lv.w);
    var tx = toIdx % lv.w;
    var ty = Math.floor(toIdx / lv.w);
    if (tx > fx) return "right";
    if (tx < fx) return "left";
    if (ty > fy) return "down";
    return "up";
  }

  /* walk to the pushing side, then one or several straight pushes */
  function doPushTarget(target) {
    var core = cur.cores[target.core];
    var d = E.DIRS[target.dir];
    var stand = E.neighbor(lv, core, opposite(target.dir));
    var path = E.findPath(lv, cur, cur.player, stand);
    if (!path) return; /* board changed mid-selection: cancel cleanly */

    var ops = [];
    for (var i = 0; i < path.length; i += 1) {
      ops.push({ t: "w", d: dirBetween(i === 0 ? cur.player : path[i - 1], path[i]) });
    }
    var nPush = Math.max(1, target.steps || 1);
    for (var p = 0; p < nPush; p += 1) {
      ops.push({ t: "p", d: target.dir });
    }
    submitOps(ops);
  }

  /* ------------------------------------------------------------------
     Feedback visuals
     ------------------------------------------------------------------ */

  function leanRobot() {
    if (reducedMotion) return;
    var inner = robotEl.querySelector(".cs-inner");
    inner.classList.add("cs-lean");
    window.setTimeout(function () {
      inner.classList.remove("cs-lean");
    }, 110);
  }

  function blockedBump(dir) {
    audio.blocked();
    if (reducedMotion) return;
    var inner = robotEl.querySelector(".cs-inner");
    var d = E.DIRS[dir];
    inner.style.setProperty("--bump-x", d.dx);
    inner.style.setProperty("--bump-y", d.dy);
    inner.classList.remove("cs-bump");
    void inner.offsetWidth;
    inner.classList.add("cs-bump");
    inner.classList.add("cs-blink");
    window.setTimeout(function () {
      inner.classList.remove("cs-bump", "cs-blink");
    }, 340);
  }

  function soundBlocked() {
    audio.blocked();
  }

  function flashDock(idx) {
    var cell = dockCells[idx];
    if (!cell) return;
    cell.classList.remove("cs-dock-flash");
    void cell.offsetWidth;
    cell.classList.add("cs-dock-flash");
    window.setTimeout(function () {
      cell.classList.remove("cs-dock-flash");
    }, 700);
  }

  function surgeSegment(coreToIdx) {
    for (var d = 0; d < lv.docks.length; d += 1) {
      if (lv.docks[d] === coreToIdx && segByDock[d]) {
        var seg = segByDock[d];
        seg.classList.add("cs-surge");
        window.setTimeout(function () {
          seg.classList.remove("cs-surge");
        }, 750);
      }
    }
  }

  function warnTrapped(coreIndex) {
    var elCore = coreEls[coreIndex];
    if (!elCore) return;
    elCore.classList.add("cs-trapped");
    audio.warn();
    window.setTimeout(function () {
      elCore.classList.remove("cs-trapped");
    }, reducedMotion ? 600 : 1000);
  }

  /* ------------------------------------------------------------------
     Victory / launch sequence
     ------------------------------------------------------------------ */

  function beginVictory() {
    celebrating = true;
    cancelAuto();
    deselectCore();
    updateButtons();
    recordWin();

    /* 1. everything powers on */
    for (var d = 0; d < segByDock.length; d += 1) {
      if (segByDock[d]) {
        segByDock[d].classList.add("cs-lit");
        if (!reducedMotion) segByDock[d].classList.add("cs-surge");
      }
    }
    el.ambient.style.opacity = "1";
    el.ship.classList.add("cs-ship-full");
    el.power.textContent = lv.docks.length + " / " + lv.docks.length;
    el.power.classList.add("cs-power-full");
    announce("Level complete. Ship systems online.");
    audio.online();

    var t1 = reducedMotion ? 500 : 1100;
    var t2 = reducedMotion ? 900 : 2000;
    var t3 = reducedMotion ? 1300 : 3300;

    /* 2. SYSTEM ONLINE */
    window.setTimeout(function () {
      el.online.hidden = false;
      el.online.classList.add("cs-show");
    }, t1);

    /* 3. launch */
    window.setTimeout(function () {
      el.stage.classList.add("cs-launching");
      audio.launch();
      spawnStars();
    }, t2);

    /* 4. result panel */
    window.setTimeout(function () {
      el.stage.classList.remove("cs-launching");
      el.online.classList.remove("cs-show");
      el.online.hidden = true;
      showResult();
      celebrating = false;
    }, t3);
  }

  function spawnStars() {
    el.stars.innerHTML = "";
    var n = reducedMotion ? 24 : 64;
    for (var i = 0; i < n; i += 1) {
      var s = document.createElement("div");
      s.className = "cs-star";
      s.style.left = (Math.random() * 100).toFixed(1) + "%";
      s.style.top = (Math.random() * 100).toFixed(1) + "%";
      var dur = (0.55 + Math.random() * 0.7).toFixed(2);
      var delay = (Math.random() * 0.8).toFixed(2);
      s.style.animationDuration = dur + "s";
      s.style.animationDelay = delay + "s";
      var sz = 1 + Math.random() * 1.6;
      s.style.width = sz + "px";
      s.style.height = sz + "px";
      el.stars.appendChild(s);
    }
  }

  function showResult() {
    var par = PAR[levelIdx] != null ? PAR[levelIdx] : null;
    var last = levelIdx === LEVELS.length - 1;
    panels.result.querySelector("[data-cs-result-eyebrow]").textContent = last
      ? "Campaign complete"
      : "Circuit restored";
    panels.result.querySelector("[data-cs-result-note]").innerHTML =
      "Pushes " + pushes + (par != null ? " · Par " + par : "") +
      " · Moves " + moves;
    panels.result.querySelector("[data-cs-result-next]").hidden = last;
    panels.result.querySelector("[data-cs-result-levels]").hidden = !last;
    showPanel("result");
  }

  /* ------------------------------------------------------------------
     Overlay panels
     ------------------------------------------------------------------ */

  function showPanel(name) {
    el.overlay.hidden = false;
    for (var k in panels) panels[k].hidden = k !== name;
    if (name === "levels") buildLevelGrid();
    audio.ui();
  }

  function hideOverlay() {
    el.overlay.hidden = true;
    for (var k in panels) panels[k].hidden = true;
  }

  function overlayOpen() {
    return !el.overlay.hidden;
  }

  function buildLevelGrid() {
    var grid = panels.levels.querySelector("[data-cs-lv-grid]");
    grid.innerHTML = "";
    for (var i = 0; i < LEVELS.length; i += 1) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cs-lv-btn";
      var locked = i > store.unlocked;
      var done = store.completed[i];
      if (locked) {
        b.disabled = true;
        b.innerHTML =
          '<span class="cs-lv-num">' + pad(i + 1) + '</span><span class="cs-lock" aria-hidden="true"></span>';
        b.setAttribute("aria-label", "Level " + (i + 1) + " locked");
      } else {
        b.innerHTML =
          '<span class="cs-lv-num">' + pad(i + 1) + "</span>" +
          '<span class="cs-lv-best">' + (done ? "P" + done.p : "&nbsp;") + "</span>";
        b.setAttribute("aria-label", "Level " + (i + 1) + (done ? ", best " + done.p + " pushes" : ""));
        if (done) b.classList.add("cs-lv-done");
        if (i === levelIdx) b.classList.add("cs-lv-current");
        (function (li) {
          b.addEventListener("click", function () {
            hideOverlay();
            loadLevel(li, null);
          });
        })(i);
      }
      grid.appendChild(b);
    }
  }

  /* ------------------------------------------------------------------
     Pointer input: tap / swipe
     ------------------------------------------------------------------ */

  var pointer = null;

  el.clip.addEventListener("pointerdown", function (e) {
    if (overlayOpen()) return;
    pointer = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  });

  el.clip.addEventListener("pointerup", function (e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    var dx = e.clientX - pointer.x;
    var dy = e.clientY - pointer.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var dt = Date.now() - pointer.t;
    pointer = null;
    if (overlayOpen() || celebrating) return;

    if (dist >= SWIPE_PX) {
      var dir =
        Math.abs(dx) >= Math.abs(dy)
          ? dx > 0 ? "right" : "left"
          : dy > 0 ? "down" : "up";
      tryMove(dir);
      return;
    }
    if (dist <= TAP_PX && dt < 600) {
      var rect = el.board.getBoundingClientRect();
      if (!rect.width) return;
      var cx = Math.floor(((e.clientX - rect.left) / rect.width) * lv.w);
      var cy = Math.floor(((e.clientY - rect.top) / rect.height) * lv.h);
      if (cx < 0 || cy < 0 || cx >= lv.w || cy >= lv.h) return;
      tapCell(cy * lv.w + cx);
    }
    /* between TAP_PX and SWIPE_PX: ignored ghost zone */
  });

  el.clip.addEventListener("pointercancel", function () {
    pointer = null;
  });

  el.stage.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  /* ------------------------------------------------------------------
     Keyboard
     ------------------------------------------------------------------ */

  var KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right"
  };

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape") {
      if (overlayOpen()) hideOverlay();
      else deselectCore();
      return;
    }

    if (overlayOpen()) return;

    if (KEYMAP[e.key]) {
      e.preventDefault();
      tryMove(KEYMAP[e.key]);
      return;
    }
    if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      doRestart(false);
    }
  });

  /* ------------------------------------------------------------------
     Buttons
     ------------------------------------------------------------------ */

  el.undo.addEventListener("click", doUndo);
  el.restart.addEventListener("click", function () {
    doRestart(false);
  });
  el.levelsBtn.addEventListener("click", function () {
    showPanel("levels");
  });
  el.sound.addEventListener("click", function () {
    var next = !audio.isEnabled();
    audio.setEnabled(next);
    el.sound.setAttribute("aria-pressed", String(next));
    if (next) audio.ui();
  });

  panels.confirm.querySelector("[data-cs-confirm-cancel]").addEventListener("click", hideOverlay);
  panels.levels.querySelector("[data-cs-levels-close]").addEventListener("click", hideOverlay);
  panels.confirm.querySelector("[data-cs-confirm-ok]").addEventListener("click", function () {
    doRestart(true);
  });

  panels.result.querySelector("[data-cs-result-next]").addEventListener("click", function () {
    if (levelIdx + 1 < LEVELS.length) loadLevel(levelIdx + 1, null);
  });
  panels.result.querySelector("[data-cs-result-replay]").addEventListener("click", function () {
    doRestart(true);
  });
  panels.result.querySelector("[data-cs-result-levels]").addEventListener("click", function () {
    showPanel("levels");
  });
  panels.result.querySelector("[data-cs-result-x]").addEventListener("click", hideOverlay);

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function boot() {
    el.sound.setAttribute("aria-pressed", String(audio.isEnabled()));

    var start = clampInt(store.current, 0, Math.min(store.unlocked, LEVELS.length - 1), 0);
    var snap = null;
    if (
      store.snap &&
      store.snap.li === start &&
      !store.completed[start]
    ) {
      snap = store.snap; /* validated inside loadLevel */
    }
    loadLevel(start, snap);
  }

  boot();
})();
