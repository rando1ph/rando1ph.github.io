/* ------------------------------------------------------------------
   Rope Tangle — randolf.dev
   Plain browser game. No dependencies.

   Structure:
     - rules       : move legality via window.RopeTangleGen helpers
     - state       : campaign store, current puzzle, ropes, history
     - geometry    : quadratic rope curves, sampled polylines (shared
                     with intersection logic — visual == logical)
     - rendering   : layered SVG strokes + local crossing overlays
     - interaction : pointer drag with snap, tap fallback, keyboard
     - persistence : localStorage campaign store
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var Gen = window.RopeTangleGen;

  var STORE_KEY = "randolf:rope-tangle:v1";
  var DIFF_KEYS = ["easy", "medium", "hard"];
  var DIFF_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
  var LEVELS_PER = 10;

  var COLORS = [
    { name: "Blue", base: "#3f6fe0", edge: "#182a56", hi: "#a6c0f7" },
    { name: "Coral", base: "#e2564d", edge: "#5c1a15", hi: "rgba(245,162,155,0.8)" },
    { name: "Violet", base: "#8a5cd6", edge: "#2d1652", hi: "rgba(197,167,240,0.85)" },
    { name: "Cyan", base: "#2fa8a2", edge: "#0d3a37", hi: "rgba(140,224,218,0.8)" },
    { name: "Amber", base: "#e6a632", edge: "#5e3d07", hi: "rgba(247,214,141,0.85)" },
    { name: "Pink", base: "#d5548f", edge: "#52122c", hi: "rgba(241,166,200,0.8)" },
    { name: "Green", base: "#3aa85f", edge: "#0f3c20", hi: "rgba(150,219,169,0.8)" },
    { name: "Orange", base: "#dd6a2e", edge: "#512106", hi: "rgba(244,179,133,0.8)" }
  ];

  var SNAP = 9;
  var SAMPLES = 26;

  /* --- elements ------------------------------------------------------ */

  var sectionEl = document.querySelector(".rt");
  if (!sectionEl) return;

  var svg = document.querySelector("[data-rt-svg]");
  var ropesLayer = svg.querySelector("[data-rt-ropes]");
  var crossLayer = svg.querySelector("[data-rt-cross]");
  var pegsLayer = svg.querySelector("[data-rt-pegs]");
  var capsLayer = svg.querySelector("[data-rt-caps]");

  var levelEl = document.querySelector("[data-rt-level]");
  var movesEl = document.querySelector("[data-rt-moves]");
  var tanglesEl = document.querySelector("[data-rt-tangles]");
  var undoBtn = document.querySelector("[data-rt-undo]");
  var restartBtn = document.querySelector("[data-rt-restart]");
  var levelsToggleBtn = document.querySelector("[data-rt-levels-toggle]");
  var levelsPanel = document.querySelector("[data-rt-levels-panel]");
  var tabsEl = document.querySelector("[data-rt-tabs]");
  var gridEl = document.querySelector("[data-rt-levels-grid]");
  var resultEl = document.querySelector("[data-rt-result]");
  var resultMetaEl = document.querySelector("[data-rt-result-meta]");
  var nextBtn = document.querySelector("[data-rt-next]");
  var replayBtn = document.querySelector("[data-rt-replay]");
  var statusEl = document.querySelector("[data-rt-status]");
  var soundBtn = document.querySelector("[data-rt-sound]");

  function Snd() {
    return window.GameAudio && window.GameAudio.rt;
  }

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function (e) {
    reduceMotion = e.matches;
  });

  /* --- state ----------------------------------------------------------- */

  var state = {
    diff: "easy",
    slot: 0,
    puzzle: null,
    ropes: [],
    moves: 0,
    history: [],
    selected: null,
    drag: null,
    tweens: {},
    crossings: [],
    solved: false,
    locked: false,
    animating: false
  };

  var store = null;
  var ropeEls = [];
  var capEls = [];
  var pegEls = [];
  var ropePolys = [];
  var crossPool = [];
  var metrics = { pxPerUnit: 3.6, ropeW: 11, span: 5.5 };
  var restartArmed = false;
  var restartTimer = null;
  var pendingFrame = false;
  var lastPointer = { x: 0, y: 0 };

  /* --- persistence -------------------------------------------------------- */

  function defaultCampaign() {
    return {
      unlocked: 0,
      completed: [],
      current: 0,
      levels: {},
      progress: {}
    };
  }

  function defaultStore() {
    return {
      v: 1,
      campaigns: {
        easy: defaultCampaign(),
        medium: defaultCampaign(),
        hard: defaultCampaign()
      },
      lastDiff: "easy"
    };
  }

  function sanitizeInt(v, min, max, dflt) {
    v = typeof v === "number" && isFinite(v) ? Math.floor(v) : dflt;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }

  function loadStore() {
    var fresh = defaultStore();
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return fresh;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1 || !d.campaigns) return fresh;
      DIFF_KEYS.forEach(function (diff) {
        var c = d.campaigns[diff] || {};
        var camp = defaultCampaign();
        camp.unlocked = sanitizeInt(c.unlocked, 0, LEVELS_PER - 1, 0);
        camp.current = sanitizeInt(c.current, 0, LEVELS_PER - 1, 0);
        if (Array.isArray(c.completed)) {
          camp.completed = c.completed.filter(function (n) {
            return typeof n === "number" && n >= 0 && n < LEVELS_PER;
          });
        }
        if (c.levels && typeof c.levels === "object") camp.levels = c.levels;
        if (c.progress && typeof c.progress === "object") camp.progress = c.progress;
        fresh.campaigns[diff] = camp;
      });
      fresh.lastDiff = DIFF_KEYS.indexOf(d.lastDiff) >= 0 ? d.lastDiff : "easy";
      return fresh;
    } catch (e) {
      return fresh;
    }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage unavailable — game continues */ }
  }

  /* --- level management ----------------------------------------------------- */

  function buildAvoid(camp) {
    var sigs = [];
    Object.keys(camp.levels).forEach(function (k) {
      var def = camp.levels[k];
      var v = Gen.validatePuzzle(def);
      if (!v.ok) return;
      sigs.push(Gen.puzzleSignature(def.family, def.pegs, def.ropes, v.crossings));
    });
    return sigs;
  }

  function ensureLevel(diff, slot) {
    var camp = store.campaigns[diff];
    var def = camp.levels[slot];
    if (def) {
      var v = Gen.validatePuzzle(def);
      if (v.ok) return def;
      delete camp.levels[slot];
    }
    var res = Gen.generatePuzzle(diff, slot, { avoid: buildAvoid(camp) });
    if (!res) {
      res = Gen.generatePuzzle(diff, slot, { avoid: [], maxAttempts: 90 });
    }
    def = {
      seed: res.seed,
      family: res.family,
      pegs: res.pegs,
      ropes: res.ropes
    };
    camp.levels[slot] = def;
    saveStore();
    return def;
  }

  function validateProgress(prog, def) {
    if (!prog || !Array.isArray(prog.ropes)) return null;
    if (prog.ropes.length !== def.ropes.length) return null;
    var pegCount = def.pegs.length;
    var seen = {};
    for (var r = 0; r < prog.ropes.length; r += 1) {
      var pair = prog.ropes[r];
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      var a = pair[0];
      var b = pair[1];
      if (a !== Math.floor(a) || b !== Math.floor(b)) return null;
      if (a < 0 || b < 0 || a >= pegCount || b >= pegCount || a === b) return null;
      if (seen["p" + a] || seen["p" + b]) return null;
      seen["p" + a] = true;
      seen["p" + b] = true;
    }
    return { ropes: prog.ropes, moves: sanitizeInt(prog.moves, 0, 9999, 0) };
  }

  function openLevel(diff, slot) {
    if (state.drag || state.animating) return;
    clearRestartArm();
    state.diff = diff;
    state.slot = slot;
    store.lastDiff = diff;
    var camp = store.campaigns[diff];
    camp.current = slot;
    saveStore();

    var def = ensureLevel(diff, slot);
    state.puzzle = def;

    var prog = camp.completed.indexOf(slot) >= 0 ? null : validateProgress(camp.progress[slot], def);
    state.ropes = prog ? Gen.cloneState(prog.ropes) : Gen.cloneState(def.ropes);
    state.moves = prog ? prog.moves : 0;
    state.history = [];
    state.selected = null;
    state.drag = null;
    state.tweens = {};
    state.solved = false;
    state.locked = false;
    state.animating = false;

    resultEl.hidden = true;
    svg.classList.remove("is-won");
    updateMetrics();

    buildBoard();
    renderAllRopes();
    updateCaps();
    updatePegLabels();
    recomputeCrossings();
    updateHud();
    updateGrid();
    updateTabIndex();
    persistProgress();
    announce(DIFF_LABELS[diff] + " level " + (slot + 1) + " loaded");
  }

  function persistProgress() {
    var camp = store.campaigns[state.diff];
    if (state.solved) {
      delete camp.progress[state.slot];
    } else {
      camp.progress[state.slot] = { ropes: state.ropes, moves: state.moves };
    }
    saveStore();
  }

  /* --- metrics ---------------------------------------------------------------- */

  function updateMetrics() {
    var w = svg.clientWidth || 360;
    metrics.pxPerUnit = w / Gen.VB_W;
    var rw = w * 0.033;
    if (rw < 9) rw = 9;
    if (rw > 13) rw = 13;
    metrics.ropeW = rw;
    metrics.span = (rw + 9) / metrics.pxPerUnit;
    svg.style.setProperty("--rt-w", rw.toFixed(2) + "px");
  }

  /* --- coordinate helpers -------------------------------------------------------- */

  function clientToUnits(cx, cy) {
    var m = svg.getScreenCTM();
    if (!m) return { x: 50, y: 37 };
    var inv = m.inverse();
    var x = cx * inv.a + cy * inv.c + inv.e;
    var y = cx * inv.b + cy * inv.d + inv.f;
    return { x: x, y: y };
  }

  function pegPos(idx) {
    var p = state.puzzle.pegs[idx];
    return { x: p[0], y: p[1] };
  }

  function endpointPos(rope, end) {
    var tw = state.tweens[rope];
    if (tw && tw.end === end) return { x: tw.x, y: tw.y };
    if (
      state.drag &&
      state.drag.rope === rope &&
      state.drag.end === end &&
      state.drag.px != null
    ) {
      return { x: state.drag.px, y: state.drag.py };
    }
    return pegPos(state.ropes[rope][end]);
  }

  /* --- rules -------------------------------------------------------------- */

  function emptyPegs() {
    return Gen.getEmptyPegs(state.ropes, state.puzzle.pegs.length);
  }

  function isSolvedNow() {
    return Gen.countIntersections(ropePolys) === 0;
  }

  /* --- geometry + rendering -------------------------------------------------- */

  function pathFromGeometry(g) {
    return (
      "M" + g.ax.toFixed(2) + " " + g.ay.toFixed(2) +
      " Q" + g.cx.toFixed(2) + " " + g.cy.toFixed(2) +
      " " + g.bx.toFixed(2) + " " + g.by.toFixed(2)
    );
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function buildBoard() {
    ropesLayer.innerHTML = "";
    crossLayer.innerHTML = "";
    pegsLayer.innerHTML = "";
    capsLayer.innerHTML = "";
    ropeEls = [];
    capEls = [];
    pegEls = [];
    ropePolys = [];
    crossPool = [];

    var R = state.ropes.length;
    var P = state.puzzle.pegs.length;

    for (var i = 0; i < R; i += 1) {
      var g = svgEl("g", { class: "rt-rope" });
      g.style.setProperty("--ri", i);
      var passes = ["shadow", "edge", "body", "hi"];
      var paths = {};
      for (var p = 0; p < passes.length; p += 1) {
        var path = svgEl("path", {
          class: "rt-r-" + passes[p],
          "vector-effect": "non-scaling-stroke"
        });
        paths[passes[p]] = path;
        g.appendChild(path);
      }
      g.querySelector(".rt-r-edge").style.stroke = COLORS[i].edge;
      g.querySelector(".rt-r-body").style.stroke = COLORS[i].base;
      g.querySelector(".rt-r-hi").style.stroke = COLORS[i].hi;
      ropesLayer.appendChild(g);
      ropeEls.push({ g: g, paths: paths });
      ropePolys.push([]);
    }

    for (var pg = 0; pg < P; pg += 1) {
      var peg = svgEl("g", { class: "rt-peg", "data-peg": pg });
      peg.setAttribute("transform", "translate(" + state.puzzle.pegs[pg][0] + " " + state.puzzle.pegs[pg][1] + ")");
      peg.appendChild(svgEl("circle", { class: "rt-peg-hit", r: 7.5, "data-peg-hit": pg }));
      peg.appendChild(svgEl("circle", { class: "rt-peg-rim", r: 6 }));
      peg.appendChild(svgEl("circle", { class: "rt-peg-ring", r: 7.2 }));
      peg.appendChild(svgEl("circle", { class: "rt-peg-hole", r: 4.3 }));
      peg.appendChild(svgEl("circle", { class: "rt-peg-hole2", r: 3.1 }));
      peg.appendChild(svgEl("circle", { class: "rt-peg-target", r: 7.6 }));
      pegsLayer.appendChild(peg);
      pegEls.push({ g: peg, hit: peg.querySelector(".rt-peg-hit") });
    }

    for (var r2 = 0; r2 < R; r2 += 1) {
      for (var e = 0; e < 2; e += 1) {
        var cap = svgEl("g", {
          class: "rt-cap",
          "data-rope": r2,
          "data-end": e,
          tabindex: "0",
          role: "button"
        });
        cap.appendChild(svgEl("circle", { class: "rt-cap-hit", r: 8 }));
        cap.appendChild(svgEl("circle", { class: "rt-cap-ring", r: 5.6 }));
        cap.appendChild(svgEl("circle", { class: "rt-cap-base", r: 3.5 }));
        cap.appendChild(svgEl("circle", { class: "rt-cap-hi", cx: -1, cy: -1, r: 1.2 }));
        cap.querySelector(".rt-cap-base").style.fill = COLORS[r2].base;
        cap.querySelector(".rt-cap-hi").style.fill = "rgba(255,255,255,0.75)";
        capsLayer.appendChild(cap);
        capEls.push({ g: cap, rope: r2, end: e });
      }
    }
  }

  function updateRope(i) {
    var e0 = endpointPos(i, 0);
    var e1 = endpointPos(i, 1);
    var g = Gen.buildRopeGeometry(e0.x, e0.y, e1.x, e1.y, i);
    var d = pathFromGeometry(g);
    var rec = ropeEls[i];
    rec.paths.shadow.setAttribute("d", d);
    rec.paths.edge.setAttribute("d", d);
    rec.paths.body.setAttribute("d", d);
    rec.paths.hi.setAttribute("d", d);
    ropePolys[i] = Gen.sampleRopePath(g, SAMPLES);
  }

  function renderAllRopes() {
    for (var i = 0; i < state.ropes.length; i += 1) updateRope(i);
  }

  function updateCaps() {
    for (var k = 0; k < capEls.length; k += 1) {
      var c = capEls[k];
      var pos = endpointPos(c.rope, c.end);
      c.g.setAttribute("transform", "translate(" + pos.x.toFixed(2) + " " + pos.y.toFixed(2) + ")");
      var pegIdx = state.ropes[c.rope][c.end];
      c.g.setAttribute(
        "aria-label",
        COLORS[c.rope].name + " rope, " + (c.end === 0 ? "first" : "second") +
        " end, on peg " + (pegIdx + 1)
      );
    }
  }

  function updatePegLabels() {
    var occ = Gen.getOccupancy(state.ropes, state.puzzle.pegs.length);
    for (var p = 0; p < pegEls.length; p += 1) {
      pegEls[p].g.setAttribute(
        "aria-label",
        "Peg " + (p + 1) + (occ[p] ? ", occupied" : ", empty")
      );
    }
  }

  /* --- crossings -------------------------------------------------------------- */

  function overlaySubpath(poly, x, y, span) {
    var best = 0;
    var bd = Infinity;
    var i, dx, dy, d;
    for (i = 0; i < poly.length; i += 1) {
      dx = poly[i].x - x;
      dy = poly[i].y - y;
      d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    var pre = [];
    var post = [];
    var acc = 0;
    for (i = best; i > 0; i -= 1) {
      dx = poly[i].x - poly[i - 1].x;
      dy = poly[i].y - poly[i - 1].y;
      acc += Math.sqrt(dx * dx + dy * dy);
      if (acc > span) break;
      pre.push(i - 1);
    }
    acc = 0;
    for (i = best; i < poly.length - 1; i += 1) {
      dx = poly[i + 1].x - poly[i].x;
      dy = poly[i + 1].y - poly[i].y;
      acc += Math.sqrt(dx * dx + dy * dy);
      if (acc > span) break;
      post.push(i + 1);
    }
    pre.reverse();
    var idx = pre.concat([best], post);
    var parts = [];
    for (i = 0; i < idx.length; i += 1) {
      parts.push(
        (i ? "L" : "M") + poly[idx[i]].x.toFixed(2) + " " + poly[idx[i]].y.toFixed(2)
      );
    }
    return parts.join("");
  }

  function ensureCrossPool(n) {
    while (crossPool.length < n) {
      var g = svgEl("g", { class: "rt-x" });
      var paths = {};
      var passes = ["shadow", "edge", "body", "hi"];
      for (var p = 0; p < passes.length; p += 1) {
        var path = svgEl("path", {
          class: "rt-x-" + passes[p],
          "vector-effect": "non-scaling-stroke"
        });
        paths[passes[p]] = path;
        g.appendChild(path);
      }
      crossLayer.appendChild(g);
      crossPool.push({ g: g, paths: paths });
    }
  }

  function renderCrossings(clusters) {
    ensureCrossPool(clusters.length);
    for (var k = 0; k < crossPool.length; k += 1) {
      var rec = crossPool[k];
      if (k >= clusters.length) {
        rec.g.style.display = "none";
        continue;
      }
      var c = clusters[k];
      var over = c.i > c.j ? c.i : c.j;
      var d = overlaySubpath(ropePolys[over], c.x, c.y, metrics.span);
      rec.g.style.display = "";
      rec.g.style.opacity = 1;
      rec.paths.shadow.setAttribute("d", d);
      rec.paths.edge.setAttribute("d", d);
      rec.paths.body.setAttribute("d", d);
      rec.paths.hi.setAttribute("d", d);
      rec.paths.edge.style.stroke = COLORS[over].edge;
      rec.paths.body.style.stroke = COLORS[over].base;
      rec.paths.hi.style.stroke = COLORS[over].hi;
    }
  }

  function recomputeCrossings() {
    var clusters = ropePolys.length
      ? Gen.findRopeIntersections(ropePolys)
      : [];
    state.crossings = clusters;
    renderCrossings(clusters);
    if (tanglesEl) tanglesEl.textContent = String(clusters.length);
  }

  /* --- target highlighting ---------------------------------------------------------- */

  function showTargets(on) {
    var occ = Gen.getOccupancy(state.ropes, state.puzzle.pegs.length);
    for (var p = 0; p < pegEls.length; p += 1) {
      pegEls[p].g.classList.toggle("is-target", on && !occ[p]);
      if (!on || occ[p]) pegEls[p].g.classList.remove("is-near");
    }
  }

  function highlightNear(px, py) {
    var best = -1;
    var bd = SNAP * SNAP;
    var empties = emptyPegs();
    for (var q = 0; q < empties.length; q += 1) {
      var pos = pegPos(empties[q]);
      var dx = pos.x - px;
      var dy = pos.y - py;
      var d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = empties[q];
      }
    }
    for (var p = 0; p < pegEls.length; p += 1) {
      pegEls[p].g.classList.toggle("is-near", p === best);
    }
    return best;
  }

  function clearNear() {
    for (var p = 0; p < pegEls.length; p += 1) {
      pegEls[p].g.classList.remove("is-near");
    }
  }

  /* --- selection ----------------------------------------------------------------------- */

  function clearSelection() {
    if (state.selected) {
      var rec = capFor(state.selected.rope, state.selected.end);
      if (rec) rec.g.classList.remove("is-selected");
    }
    state.selected = null;
    showTargets(false);
    updateTabIndex();
  }

  function setSelection(rope, end) {
    clearSelection();
    state.selected = { rope: rope, end: end };
    var rec = capFor(rope, end);
    if (rec) rec.g.classList.add("is-selected");
    showTargets(true);
    updateTabIndex();
    announce(COLORS[rope].name + " rope end selected — choose an empty peg");
  }

  function capFor(rope, end) {
    for (var k = 0; k < capEls.length; k += 1) {
      if (capEls[k].rope === rope && capEls[k].end === end) return capEls[k];
    }
    return null;
  }

  function updateTabIndex() {
    var occ = Gen.getOccupancy(state.ropes, state.puzzle.pegs.length);
    for (var p = 0; p < pegEls.length; p += 1) {
      pegEls[p].g.setAttribute("tabindex", !occ[p] ? "0" : "-1");
    }
  }

  /* --- moves ------------------------------------------------------------------------------ */

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutBack(t) {
    var c = 1.35;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }

  function tweenRope(rope, end, from, to, dur, ease, done) {
    if (reduceMotion || dur <= 0) {
      done();
      return;
    }
    state.tweens[rope] = { end: end, x: from.x, y: from.y };
    var t0 = performance.now();
    function frame(now) {
      if (!state.tweens[rope]) return;
      var t = Math.min(1, (now - t0) / dur);
      var k = ease(t);
      state.tweens[rope].x = from.x + (to.x - from.x) * k;
      state.tweens[rope].y = from.y + (to.y - from.y) * k;
      updateRope(rope);
      updateCaps();
      recomputeCrossings();
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        delete state.tweens[rope];
        done();
      }
    }
    requestAnimationFrame(frame);
  }

  function commitMove(rope, end, pegIdx, fromPt) {
    if (state.locked || state.solved || state.animating) return;
    if (!Gen.canMoveEndpoint(state.ropes, rope, end, pegIdx)) return;

    state.history.push({ ropes: Gen.cloneState(state.ropes), moves: state.moves });
    var oldPeg = state.ropes[rope][end];
    state.ropes[rope][end] = pegIdx;
    state.moves += 1;
    clearSelection();
    clearNear();
    state.animating = true;
    updateUndoBtn();

    var from = fromPt || pegPos(oldPeg);
    var to = pegPos(pegIdx);
    var dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    var dur = Math.min(240, 90 + dist * 4);

    tweenRope(rope, end, from, to, dur, easeOutCubic, function () {
      state.animating = false;
      /* snap cue fires here — the exact moment the endpoint lands in the peg */
      var snd = Snd();
      if (snd) snd.snap();
      renderAllRopes();
      updateCaps();
      updatePegLabels();
      recomputeCrossings();
      updateHud();
      updateUndoBtn();
      persistProgress();
      announce(
        COLORS[rope].name + " rope moved to peg " + (pegIdx + 1) +
        ". Tangles " + state.crossings.length + "."
      );
      if (state.crossings.length === 0) {
        if (snd) snd.release();
        victory();
      }
    });
  }

  function animateReturn(rope, end, fromPt) {
    var to = pegPos(state.ropes[rope][end]);
    state.animating = true;
    var snd = Snd();
    if (snd) snd.reject();
    tweenRope(rope, end, fromPt, to, 200, easeOutBack, function () {
      state.animating = false;
      renderAllRopes();
      updateCaps();
      recomputeCrossings();
      updateUndoBtn();
    });
  }

  function onUndo() {
    if (state.locked || state.solved || state.animating || state.drag) return;
    if (!state.history.length) return;
    var prev = state.history.pop();
    state.ropes = prev.ropes;
    state.moves = prev.moves;
    clearSelection();
    renderAllRopes();
    updateCaps();
    updatePegLabels();
    updateTabIndex();
    recomputeCrossings();
    updateHud();
    updateUndoBtn();
    persistProgress();
    announce("Move undone. Tangles " + state.crossings.length + ".");
  }

  /* --- restart ---------------------------------------------------------------- */

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
    if (state.drag || state.animating) return;
    clearRestartArm();
    state.ropes = Gen.cloneState(state.puzzle.ropes);
    state.moves = 0;
    state.history = [];
    state.selected = null;
    state.tweens = {};
    state.solved = false;
    state.locked = false;
    resultEl.hidden = true;
    svg.classList.remove("is-won");
    renderAllRopes();
    updateCaps();
    updatePegLabels();
    updateTabIndex();
    recomputeCrossings();
    updateHud();
    persistProgress();
    announce("Level restarted");  }

  function onRestart() {
    if (state.drag || state.animating || state.locked) return;
    if (state.moves > 0 && !restartArmed) {
      restartArmed = true;
      restartBtn.textContent = "Sure?";
      restartBtn.classList.add("is-confirming");
      restartTimer = window.setTimeout(clearRestartArm, 2500);
      return;
    }
    doRestart();
  }

  /* --- victory --------------------------------------------------------------------- */

  function victory() {
    state.solved = true;
    state.locked = true;
    clearSelection();
    clearNear();
    svg.classList.add("is-won");

    var camp = store.campaigns[state.diff];
    if (camp.completed.indexOf(state.slot) < 0) camp.completed.push(state.slot);
    camp.unlocked = Math.max(camp.unlocked, Math.min(state.slot + 1, LEVELS_PER - 1));
    persistProgress();
    updateGrid();
    updateUndoBtn();
    announce("Untangled in " + state.moves + " moves");

    /* completion chime follows the softer release cue, not on top of it */
    var snd = Snd();
    if (snd) {
      window.setTimeout(function () {
        snd.victory();
      }, 280);
    }

    window.setTimeout(function () {
      var last = state.slot === LEVELS_PER - 1;
      resultMetaEl.textContent = "Moves " + state.moves;
      nextBtn.hidden = last;
      resultEl.hidden = false;
    }, reduceMotion ? 150 : 900);
  }

  /* --- HUD --------------------------------------------------------------------------- */

  function updateHud() {
    levelEl.textContent = String(state.slot + 1).padStart(2, "0");
    movesEl.textContent = String(state.moves);
    tanglesEl.textContent = String(state.crossings.length);
  }

  function updateUndoBtn() {
    undoBtn.disabled = state.locked || state.solved || state.animating || !state.history.length;
  }

  function announce(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function applySoundPref() {
    if (!soundBtn || !window.GameAudio) return;
    var on = window.GameAudio.isEnabled();
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.textContent = on ? "Sound" : "Sound off";
  }

  /* --- level grid ----------------------------------------------------------------------- */

  function updateTabs() {
    var btns = tabsEl.querySelectorAll("[data-diff]");
    btns.forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-diff") === state.diff ? "true" : "false");
    });
  }

  function updateGrid() {
    updateTabs();
    var camp = store.campaigns[state.diff];
    gridEl.innerHTML = "";
    for (var i = 0; i < LEVELS_PER; i += 1) {
      (function (idx) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rt-level-btn";
        btn.textContent = String(idx + 1).padStart(2, "0");
        if (camp.completed.indexOf(idx) >= 0) btn.classList.add("is-done");
        if (idx === state.slot) btn.setAttribute("aria-current", "true");
        if (idx > camp.unlocked) btn.disabled = true;
        btn.setAttribute(
          "aria-label",
          DIFF_LABELS[state.diff] + " level " + (idx + 1) + (idx > camp.unlocked ? ", locked" : "")
        );
        btn.addEventListener("click", function () {
          if (idx > camp.unlocked) return;
          openLevel(state.diff, idx);
          levelsPanel.hidden = true;
          levelsToggleBtn.setAttribute("aria-expanded", "false");
        });
        gridEl.appendChild(btn);
      })(i);
    }
  }

  /* --- pointer interaction ----------------------------------------------------------------- */

  function startDrag(rope, end, e) {
    var rec = capFor(rope, end);
    var snd = Snd();
    if (snd) snd.pickup();
    state.drag = {
      rope: rope,
      end: end,
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      px: null,
      py: null,
      empties: emptyPegs()
    };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch (err) { /* capture not available */ }
    if (rec) rec.g.classList.add("is-lifted");
    if (ropeEls[rope]) {
      ropeEls[rope].g.classList.add("is-active");
      ropesLayer.appendChild(ropeEls[rope].g);
    }
    clearSelection();
    showTargets(true);
    state.locked = false;
  }

  function scheduleDragUpdate(cx, cy) {
    lastPointer.x = cx;
    lastPointer.y = cy;
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(function () {
      pendingFrame = false;
      dragFrame();
    });
  }

  function dragFrame() {
    var d = state.drag;
    if (!d) return;
    var p = clientToUnits(lastPointer.x, lastPointer.y);
    if (p.x < 4) p.x = 4;
    if (p.x > 96) p.x = 96;
    if (p.y < 3) p.y = 3;
    if (p.y > 71) p.y = 71;
    var home = pegPos(state.ropes[d.rope][d.end]);
    if (!d.moved) {
      var dx = p.x - home.x;
      var dy = p.y - home.y;
      if (Math.sqrt(dx * dx + dy * dy) > 1.2) d.moved = true;
    }
    d.px = p.x;
    d.py = p.y;
    updateRope(d.rope);
    var rec = capFor(d.rope, d.end);
    if (rec) rec.g.setAttribute("transform", "translate(" + p.x.toFixed(2) + " " + p.y.toFixed(2) + ")");
    highlightNear(p.x, p.y);
    recomputeCrossings();
  }

  function endDrag(e) {
    var d = state.drag;
    if (!d) return;
    state.drag = null;
    var rec = capFor(d.rope, d.end);
    if (rec) rec.g.classList.remove("is-lifted");
    if (ropeEls[d.rope]) ropeEls[d.rope].g.classList.remove("is-active");
    showTargets(false);
    clearNear();

    if (!d.moved) {
      /* tap: toggle selection */
      if (state.selected && state.selected.rope === d.rope && state.selected.end === d.end) {
        clearSelection();
        announce("Selection cleared");
      } else {
        setSelection(d.rope, d.end);
      }
      return;
    }

    var p = clientToUnits(e.clientX, e.clientY);
    if (p.x < 4) p.x = 4;
    if (p.x > 96) p.x = 96;
    if (p.y < 3) p.y = 3;
    if (p.y > 71) p.y = 71;
    var best = -1;
    var bd = SNAP * SNAP;
    for (var q = 0; q < d.empties.length; q += 1) {
      var pos = pegPos(d.empties[q]);
      var dx = pos.x - p.x;
      var dy = pos.y - p.y;
      var dd = dx * dx + dy * dy;
      if (dd < bd) {
        bd = dd;
        best = d.empties[q];
      }
    }
    if (best >= 0) {
      commitMove(d.rope, d.end, best, { x: d.px == null ? p.x : d.px, y: d.py == null ? p.y : d.py });
    } else {
      animateReturn(d.rope, d.end, { x: d.px == null ? p.x : d.px, y: d.py == null ? p.y : d.py });
    }
  }

  function onPointerDown(e) {
    if (state.solved || state.locked || state.animating) return;
    if (state.drag) return;
    var capG = e.target.closest ? e.target.closest(".rt-cap") : null;
    if (capG) {
      e.preventDefault();
      startDrag(parseInt(capG.getAttribute("data-rope"), 10), parseInt(capG.getAttribute("data-end"), 10), e);
      return;
    }
    /* remember peg press for tap activation */
    var pegG = e.target.closest ? e.target.closest(".rt-peg") : null;
    if (pegG) {
      state.pendingPeg = parseInt(pegG.getAttribute("data-peg"), 10);
    }
  }

  function onPointerMove(e) {
    if (!state.drag) return;
    if (e.pointerId !== state.drag.pointerId) return;
    e.preventDefault();
    scheduleDragUpdate(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (state.drag) {
      if (e.pointerId !== state.drag.pointerId) return;
      e.preventDefault();
      endDrag(e);
      return;
    }
    if (state.pendingPeg != null) {
      var peg = state.pendingPeg;
      state.pendingPeg = null;
      onPegActivate(peg);
    }
  }

  function onPointerCancel(e) {
    if (state.drag && e.pointerId === state.drag.pointerId) {
      var d = state.drag;
      state.drag = null;
      var rec = capFor(d.rope, d.end);
      if (rec) rec.g.classList.remove("is-lifted");
      if (ropeEls[d.rope]) ropeEls[d.rope].g.classList.remove("is-active");
      showTargets(false);
      clearNear();
      if (d.moved && d.px != null) {
        animateReturn(d.rope, d.end, { x: d.px, y: d.py });
      }
    }
    state.pendingPeg = null;
  }

  function onPegActivate(pegIdx) {
    if (state.solved || state.locked || state.animating) return;
    if (!state.selected) return;
    if (!Gen.canMoveEndpoint(state.ropes, state.selected.rope, state.selected.end, pegIdx)) return;
    commitMove(state.selected.rope, state.selected.end, pegIdx, null);
  }

  /* --- keyboard --------------------------------------------------------------------------- */

  function onCapKeydown(e, rope, end) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (state.solved || state.locked || state.animating) return;
      if (state.selected && state.selected.rope === rope && state.selected.end === end) {
        clearSelection();
        announce("Selection cleared");
      } else {
        setSelection(rope, end);
      }
    }
  }

  function onPegKeydown(e, pegIdx) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPegActivate(pegIdx);
    } else if (e.key === "Escape") {
      clearSelection();
    }
  }

  /* --- init ---------------------------------------------------------------------------------- */

  function bindEvents() {
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerCancel);
    svg.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
    svg.addEventListener("dragstart", function (e) {
      e.preventDefault();
    });

    /* delegated keyboard + focus for caps and pegs (elements are rebuilt per level) */
    capsLayer.addEventListener("keydown", function (e) {
      var g = e.target.closest(".rt-cap");
      if (!g) return;
      onCapKeydown(e, parseInt(g.getAttribute("data-rope"), 10), parseInt(g.getAttribute("data-end"), 10));
    });
    capsLayer.addEventListener("focusin", function (e) {
      var g = e.target.closest(".rt-cap");
      if (g) g.classList.add("is-focus");
    });
    capsLayer.addEventListener("focusout", function (e) {
      var g = e.target.closest(".rt-cap");
      if (g) g.classList.remove("is-focus");
    });

    pegsLayer.addEventListener("keydown", function (e) {
      var g = e.target.closest(".rt-peg");
      if (!g) return;
      onPegKeydown(e, parseInt(g.getAttribute("data-peg"), 10));
    });
    pegsLayer.addEventListener("focusin", function (e) {
      var g = e.target.closest(".rt-peg");
      if (g) g.classList.add("is-focus");
    });
    pegsLayer.addEventListener("focusout", function (e) {
      var g = e.target.closest(".rt-peg");
      if (g) g.classList.remove("is-focus");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.selected) {
        clearSelection();
        announce("Selection cleared");
      }
    });

    undoBtn.addEventListener("click", onUndo);
    restartBtn.addEventListener("click", onRestart);
    nextBtn.addEventListener("click", function () {
      if (state.slot < LEVELS_PER - 1) openLevel(state.diff, state.slot + 1);
    });
    replayBtn.addEventListener("click", doRestart);
    levelsToggleBtn.addEventListener("click", function () {
      var open = levelsPanel.hidden;
      levelsPanel.hidden = !open;
      levelsToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    tabsEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-diff]");
      if (!btn) return;
      var diff = btn.getAttribute("data-diff");
      if (diff === state.diff) return;
      openLevel(diff, store.campaigns[diff].current);
      levelsPanel.hidden = true;
      levelsToggleBtn.setAttribute("aria-expanded", "false");
    });

    if (soundBtn && window.GameAudio) {
      soundBtn.addEventListener("click", function () {
        window.GameAudio.toggle();
        applySoundPref();
      });
    }

    window.addEventListener("resize", function () {
      updateMetrics();
      renderCrossings(state.crossings);
    });
  }

  function init() {
    store = loadStore();
    var diff = DIFF_KEYS.indexOf(store.lastDiff) >= 0 ? store.lastDiff : "easy";
    bindEvents();
    applySoundPref();
    openLevel(diff, store.campaigns[diff].current);
  }

  init();
})();
