/* ------------------------------------------------------------------
   Core Shift — main
   Wires the pure engine to the canvas renderer, the DOM HUD and
   localStorage.

   State ownership, in one direction only:

     engine state  ->  authoritative logic
     dockedMask    ->  what the ship currently has powered, advanced only
                       when a move's animation lands, so the lights can
                       never run ahead of the cores
     anim          ->  purely visual interpolation between two cells

   Every input goes through one queue and one animation slot, so rapid
   input can never produce a ghost core, an overlap or a broken undo
   history: the logic advances at most one step ahead of the picture.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var Engine = window.CoreShiftEngine;
  var Levels = window.CoreShiftLevels;
  var RendererNS = window.CoreShiftRenderer;
  var Input = window.CoreShiftInput;
  var Storage = window.CoreShiftStorage;
  var Solver = window.CoreShiftSolver;
  var GameAudio = window.GameAudio;

  if (!Engine || !Levels || !RendererNS || !Input || !Storage) {
    if (window.console) window.console.error("Core Shift: a module failed to load");
    return;
  }

  /* ------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------ */

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var canvas = $("[data-cs-canvas]");
  var stage = $("[data-cs-stage]");
  var controls = $("[data-cs-controls]");
  var elLevel = $("[data-cs-level]");
  var elPower = $("[data-cs-power]");
  var elPowerFill = $("[data-cs-power-fill]");
  var elMoves = $("[data-cs-moves]");
  var elPushes = $("[data-cs-pushes]");
  var elBest = $("[data-cs-best]");
  var elSource = $("[data-cs-source]");
  var elLive = $("[data-cs-live]");
  var elHint = $("[data-cs-hint]");
  var elHintMsg = $("[data-cs-hint-msg]");
  var overlay = $("[data-cs-overlay]");
  var panelComplete = $("[data-cs-panel='complete']");
  var panelLevels = $("[data-cs-panel='levels']");
  var levelGrid = $("[data-cs-level-grid]");
  var btnUndo = $("[data-cs-undo]");
  var btnRestart = $("[data-cs-restart]");
  var btnLevels = $("[data-cs-levels]");
  var btnHint = $("[data-cs-hint-btn]");
  var btnSound = $("[data-cs-sound]");
  var btnNext = $("[data-cs-next]");
  var btnReplay = $("[data-cs-replay]");
  var btnCompleteLevels = $("[data-cs-complete-levels]");
  var btnLevelsClose = $("[data-cs-levels-close]");
  var elCompleteNote = $("[data-cs-complete-note]");

  if (!canvas || !stage) return;

  var renderer = new RendererNS.Renderer(canvas);
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  renderer.setReducedMotion(reduced.matches);

  /* ------------------------------------------------------------------
     Levels
     ------------------------------------------------------------------ */

  var levels = [];
  (function prepare() {
    for (var i = 0; i < Levels.LEVELS.length; i += 1) {
      var entry = Levels.LEVELS[i];
      var parsed = Engine.parse(entry.rows);
      if (parsed.errors.length) {
        if (window.console) {
          window.console.error(
            "Core Shift: level " + entry.id + " (" + entry.source + ") is malformed",
            parsed.errors
          );
        }
        continue;
      }
      parsed.id = entry.id;
      parsed.source = entry.source;
      levels.push(parsed);
    }
  })();

  if (!levels.length) {
    if (window.console) window.console.error("Core Shift: no usable levels");
    return;
  }

  var store = new Storage.Store(levels.length);

  /* ------------------------------------------------------------------
     Timing
     ------------------------------------------------------------------ */

  var WALK_MS = 100;
  var PUSH_MS = 150;
  var UNDO_MS = 90;
  var SEQUENCE_MS = 1500;
  var BLOCK_MS = 320;
  var QUEUE_MAX = 16;

  /**
   * Animation length for one step. When intents are already waiting, the
   * animation shortens so the picture catches up instead of the queue
   * dropping input: holding a direction key should never lose a move.
   */
  function stepDuration(base, backlog) {
    if (renderer.reduced) return 1;
    if (backlog >= 4) return Math.max(26, Math.round(base * 0.28));
    if (backlog >= 1) return Math.max(42, Math.round(base * 0.6));
    return base;
  }

  function motion(ms) {
    return renderer.reduced ? 1 : ms;
  }

  /* ------------------------------------------------------------------
     Game state
     ------------------------------------------------------------------ */

  var game = {
    index: 0,
    level: null,
    state: null,
    dockedMask: null,
    anim: null,
    queue: [],
    path: [],
    selected: null,
    options: [],
    facing: 1,
    phase: "play",
    sequence: null,
    blocked: null,
    power: 0,
    light: RendererNS.LIGHT_BASE,
    targetPower: 0,
    panel: null,
    lastDock: null,
    dirty: false
  };

  var bestShown = null;

  function levelIndex() {
    return game.index;
  }

  function totalCores() {
    return game.level.goalCount;
  }

  function dockedCount() {
    var n = 0;
    for (var i = 0; i < game.dockedMask.length; i += 1) n += game.dockedMask[i];
    return n;
  }

  function refreshDockedMask() {
    var l = game.level;
    var mask = game.dockedMask;
    var changed = [];
    var i;
    for (i = 0; i < mask.length; i += 1) {
      var next = 0;
      if (l.goals[i] && Engine.boxAt(game.state, i) !== -1) next = 1;
      if (mask[i] !== next) {
        mask[i] = next;
        if (next) changed.push(i);
      }
    }
    game.targetPower = totalCores() ? dockedCount() / totalCores() : 0;
    return changed;
  }

  /* ------------------------------------------------------------------
     Loading
     ------------------------------------------------------------------ */

  function loadLevel(index, options) {
    options = options || {};
    game.index = Math.max(0, Math.min(index, levels.length - 1));
    game.level = levels[game.index];
    store.setCurrentLevel(game.index);

    var resumed = options.fresh ? null : store.getResume(game.index, game.level);
    game.state = resumed || Engine.createState(game.level);

    game.dockedMask = new Uint8Array(game.level.w * game.level.h);
    game.anim = null;
    game.queue.length = 0;
    game.path.length = 0;
    game.selected = null;
    game.options = [];
    game.facing = 1;
    game.phase = "play";
    game.sequence = null;
    game.blocked = null;
    game.dirty = false;
    game.lastDock = null;

    refreshDockedMask();
    game.power = game.targetPower;
    game.light = RendererNS.LIGHT_BASE + (1 - RendererNS.LIGHT_BASE) * game.power;

    renderer.setLevel(game.level);
    layout();
    closePanel();
    syncLevelGrid();
    updateHud();
    announce(
      "Level " + game.level.id + " loaded. " +
        game.level.boxCount + " cores, " + game.level.goalCount + " docks."
    );
  }

  /* ------------------------------------------------------------------
     Moves
     ------------------------------------------------------------------ */

  function deselect() {
    game.selected = null;
    game.options = [];
  }

  function pushDirect(dir) {
    if (game.phase !== "play") return;
    game.path.length = 0;
    if (game.queue.length < QUEUE_MAX) game.queue.push(dir);
    deselect();
  }

  function beginStep(dir, now, backlog) {
    var l = game.level;
    var s = game.state;
    var prevPlayer = s.player;
    var r = Engine.step(l, s, dir);

    if (!r) {
      var d = Engine.DIRS[dir];
      game.blocked = {
        x: (prevPlayer % l.w) + 0.5 + d.dx * 0.34,
        y: Math.floor(prevPlayer / l.w) + 0.5 + d.dy * 0.34,
        t: 0
      };
      if (GameAudio && GameAudio.cs) GameAudio.cs.blocked();
      return false;
    }

    game.facing = dir;
    game.blocked = null;
    game.anim = {
      t0: now,
      dur: stepDuration(r.pushed ? PUSH_MS : WALK_MS, backlog || 0),
      playerFrom: prevPlayer,
      playerTo: s.player,
      boxFrom: r.boxFrom,
      boxTo: r.boxTo
    };
    updateHud();
    return true;
  }

  function beginUndo(now) {
    var l = game.level;
    var s = game.state;
    var oldPlayer = s.player;
    var u = Engine.undo(l, s);
    if (!u) return false;

    var dir = Engine.DIRS[u.dir];
    var boxFrom = -1;
    var boxTo = -1;
    if (u.pushed) {
      boxFrom = oldPlayer + dir.dx + dir.dy * l.w;
      boxTo = oldPlayer;
    }
    game.anim = {
      t0: now,
      dur: motion(UNDO_MS),
      playerFrom: oldPlayer,
      playerTo: s.player,
      boxFrom: boxFrom,
      boxTo: boxTo
    };
    deselect();
    updateHud();
    return true;
  }

  /** Snap any in-flight animation to its logical end state. */
  function settle(now) {
    if (!game.anim) return;
    game.anim = null;
    finishStep(now);
  }

  function finishStep(now) {
    var before = dockedCount();
    var changed = refreshDockedMask();
    game.anim = null;
    game.dirty = true;

    if (changed.length) {
      var after = dockedCount();
      if (after > before) {
        game.lastDock = changed[changed.length - 1];
        if (GameAudio && GameAudio.cs) GameAudio.cs.activate();
        announce("Core docked. " + after + " of " + totalCores() + " powered.");
      } else {
        if (GameAudio && GameAudio.cs) GameAudio.cs.undock();
        announce("Core released. " + after + " of " + totalCores() + " powered.");
      }
    }
    updateHud();

    if (game.phase === "play" && Engine.isSolved(game.level, game.state)) {
      startSequence(now);
    }
  }

  /**
   * Writing on every step would hammer localStorage during a fast burst,
   * so the board is only persisted once the queue has drained.
   */
  function persistIfIdle() {
    if (!game.dirty) return;
    if (game.anim || game.queue.length || game.path.length) return;
    game.dirty = false;
    persistResume();
  }

  function persistResume() {
    if (game.phase === "complete") return;
    store.setResume(game.index, game.state);
  }

  /* ------------------------------------------------------------------
     Completion
     ------------------------------------------------------------------ */

  function startSequence(now) {
    game.phase = "sequence";
    game.queue.length = 0;
    game.path.length = 0;
    deselect();
    game.sequence = { t0: now, dur: motion(SEQUENCE_MS) };
    if (!game.lastDock) {
      /* every core was already home (a replayed level) — pick a dock */
      for (var i = 0; i < game.level.goals.length; i += 1) {
        if (game.level.goals[i]) {
          game.lastDock = i;
          break;
        }
      }
    }
    if (GameAudio && GameAudio.cs) GameAudio.cs.complete();
    announce("All cores docked. Ship systems online.");
  }

  function finishSequence() {
    game.phase = "complete";
    game.sequence = null;
    var result = store.recordCompletion(game.index, game.state.moves, game.state.pushes);
    var last = game.index === levels.length - 1;
    if (btnNext) btnNext.hidden = last;
    if (elCompleteNote) {
      elCompleteNote.textContent = last
        ? "Campaign complete — every level restored."
        : "Next level unlocked.";
    }
    if (result.unlocked) {
      announce("Level " + levels[game.index + 1].id + " unlocked.");
    }
    updateHud();
    openPanel("complete");
    syncLevelGrid();
  }

  /* ------------------------------------------------------------------
     Input intents
     ------------------------------------------------------------------ */

  function inputLocked() {
    return game.phase !== "play" || game.panel !== null;
  }

  function onStep(dir) {
    if (inputLocked()) return;
    pushDirect(dir);
  }

  function onCell(index) {
    if (inputLocked()) return;
    var l = game.level;
    var s = game.state;

    /* tapping a shown push destination performs the push */
    if (game.selected !== null) {
      for (var i = 0; i < game.options.length; i += 1) {
        if (game.options[i].to === index) {
          executePush(game.options[i]);
          return;
        }
      }
      if (index === game.selected) {
        deselect();
        return;
      }
    }

    /* tapping a core selects it and reveals its legal pushes */
    if (Engine.boxAt(s, index) !== -1) {
      game.selected = index;
      game.options = Engine.pushOptions(l, s, index);
      if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
      if (!game.options.length) {
        announce("That core cannot be pushed from anywhere the robot can reach.");
      }
      return;
    }

    /* tapping deck walks the robot there */
    deselect();
    var path = Engine.pathTo(l, s, index);
    if (path && path.length) {
      game.queue.length = 0;
      game.path = path;
    }
  }

  function executePush(option) {
    var walk = Engine.pathTo(game.level, game.state, option.from);
    if (!walk) {
      if (GameAudio && GameAudio.cs) GameAudio.cs.blocked();
      return;
    }
    game.queue.length = 0;
    game.path = walk.concat([option.dir]);
    deselect();
  }

  /**
   * Hint: solve the current board and reveal the next push, or report that
   * the position is hopeless. The solver is push-optimal, so the revealed
   * push always keeps a solution within reach — it can never steer the
   * player into a dead end.
   */
  /* Direction words for the visible hint message */
  var DIR_WORD = ["up", "right", "down", "left"];

  function hintWarn(text) {
    if (elHintMsg) elHintMsg.classList.add("is-warn");
    showHintMsg(text);
  }

  function hint() {
    if (!Solver) {
      hintWarn("Hint unavailable — the solver failed to load.");
      return;
    }
    if (inputLocked()) return;
    if (elHintMsg) elHintMsg.classList.remove("is-warn");

    var res = Solver.solve(game.level, {
      start: { player: game.state.player, boxes: game.state.boxes },
      solution: true,
      limit: 500000
    });

    if (!res.solvable) {
      if (res.capped) {
        hintWarn("Hint unavailable for this position.");
      } else {
        hintWarn("No solution from here — undo to keep going.");
      }
      return;
    }
    if (!res.solution) {
      hintWarn("Hint unavailable for this position.");
      return;
    }

    /* replay the solution on a scratch state to find the first push */
    var probe = Engine.cloneState(game.state);
    var coreCell = -1;
    var pushDir = -1;
    for (var i = 0; i < res.solution.length; i += 1) {
      var r = Engine.step(game.level, probe, res.solution[i]);
      if (r && r.pushed) {
        coreCell = r.boxFrom;
        pushDir = r.dir;
        break;
      }
    }

    if (coreCell === -1) {
      hintWarn("Nothing left to push.");
      return;
    }

    /* reveal that core and only its recommended direction */
    var options = Engine.pushOptions(game.level, game.state, coreCell);
    var chosen = null;
    for (var k = 0; k < options.length; k += 1) {
      if (options[k].dir === pushDir) {
        chosen = options[k];
        break;
      }
    }
    if (!chosen) {
      hintWarn("Hint unavailable for this position.");
      return;
    }

    game.selected = coreCell;
    game.options = [chosen];
    if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
    showHintMsg("Hint: push the core " + (DIR_WORD[pushDir] || "") + ".");
  }

  function onCommand(cmd) {
    if (cmd === "escape") {
      if (game.panel) closePanel();
      else if (game.selected !== null) deselect();
      return;
    }
    if (cmd === "levels") {
      togglePanel("levels");
      return;
    }
    if (inputLocked()) {
      if (cmd === "restart" && game.phase === "complete") replayLevel();
      return;
    }
    if (cmd === "undo") {
      var now = performance.now();
      game.queue.length = 0;
      game.path.length = 0;
      settle(now);
      if (game.phase !== "play") return;
      if (!beginUndo(now)) {
        if (GameAudio && GameAudio.cs) GameAudio.cs.blocked();
      } else if (GameAudio && GameAudio.cs) {
        /* a core coming back out of its dock gets its own cue from
           finishStep; this is just the acknowledgment of the undo */
        GameAudio.cs.ui();
      }
      game.dirty = true;
      persistResume();
    } else if (cmd === "restart") {
      restartLevel();
    } else if (cmd === "hint") {
      hint();
    }
  }

  function restartLevel() {
    game.state = Engine.createState(game.level);
    game.anim = null;
    game.queue.length = 0;
    game.path.length = 0;
    deselect();
    game.blocked = null;
    game.phase = "play";
    game.sequence = null;
    refreshDockedMask();
    store.clearResume(game.index);
    if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
    updateHud();
    announce("Level " + game.level.id + " restarted.");
  }

  function replayLevel() {
    loadLevel(game.index, { fresh: true });
    if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
  }

  /* ------------------------------------------------------------------
     Panels
     ------------------------------------------------------------------ */

  function openPanel(name) {
    game.panel = name;
    if (!overlay) return;
    overlay.classList.add("is-shown");
    if (panelComplete) panelComplete.hidden = name !== "complete";
    if (panelLevels) panelLevels.hidden = name !== "levels";
    if (btnLevels) btnLevels.setAttribute("aria-expanded", name === "levels" ? "true" : "false");
    /* put focus on something useful inside the panel */
    var panel = name === "complete" ? panelComplete : panelLevels;
    if (!panel) return;
    var target =
      (name === "levels" && levelGrid && levelGrid.querySelector("[aria-current='true']")) ||
      panel.querySelector("button:not([hidden])");
    if (target) target.focus();
  }

  function closePanel() {
    game.panel = null;
    if (!overlay) return;
    overlay.classList.remove("is-shown");
    if (panelComplete) panelComplete.hidden = true;
    if (panelLevels) panelLevels.hidden = true;
    if (btnLevels) btnLevels.setAttribute("aria-expanded", "false");
  }

  function togglePanel(name) {
    if (game.panel === name) closePanel();
    else openPanel(name);
  }

  function syncLevelGrid() {
    if (!levelGrid) return;
    var buttons = levelGrid.querySelectorAll("button[data-cs-level-btn]");
    for (var i = 0; i < buttons.length; i += 1) {
      var b = buttons[i];
      var idx = Number(b.getAttribute("data-cs-level-btn"));
      var unlocked = store.isUnlocked(idx);
      var done = store.isComplete(idx);
      b.disabled = !unlocked;
      b.classList.toggle("is-done", done);
      b.setAttribute("aria-current", idx === game.index ? "true" : "false");
      var best = store.best(idx);
      b.setAttribute(
        "aria-label",
        "Level " + levels[idx].id + (done ? ", restored" : "") + (unlocked ? "" : ", locked") +
          (best && best.moves !== null ? ", best " + best.moves + " moves" : "")
      );
    }
  }

  function buildLevelGrid() {
    if (!levelGrid) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < levels.length; i += 1) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cs-level-btn";
      b.setAttribute("data-cs-level-btn", String(i));
      var num = document.createElement("span");
      num.className = "cs-level-num mono";
      num.textContent = String(levels[i].id);
      var tick = document.createElement("span");
      tick.className = "cs-level-tick";
      tick.setAttribute("aria-hidden", "true");
      b.appendChild(num);
      b.appendChild(tick);
      levelGrid.appendChild(b);
    }
    levelGrid.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-cs-level-btn]") : null;
      if (!btn || btn.disabled) return;
      var idx = Number(btn.getAttribute("data-cs-level-btn"));
      if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
      loadLevel(idx);
    });
  }

  /* ------------------------------------------------------------------
     HUD
     ------------------------------------------------------------------ */

  function announce(text) {
    if (elLive) elLive.textContent = text;
  }

  /* Visible feedback for the hint — the aria-live line is for screen
     readers only, so a sighted player needs a pill on the board too. */
  var hintMsgTimer = null;

  function showHintMsg(text) {
    announce(text);
    if (!elHintMsg) return;
    elHintMsg.textContent = text;
    elHintMsg.hidden = false;
    /* force reflow so a repeated identical message still re-shows */
    void elHintMsg.offsetWidth;
    elHintMsg.classList.add("is-shown");
    if (hintMsgTimer) window.clearTimeout(hintMsgTimer);
    hintMsgTimer = window.setTimeout(function () {
      elHintMsg.classList.remove("is-shown");
    }, 2600);
  }

  function updateHud() {
    if (elLevel) elLevel.textContent = game.level.id + " / " + levels.length;
    var d = dockedCount();
    if (elPower) elPower.textContent = d + " / " + totalCores();
    if (elPowerFill) {
      elPowerFill.style.transform = "scaleX(" + (totalCores() ? d / totalCores() : 0) + ")";
    }
    if (elMoves) elMoves.textContent = String(game.state.moves);
    if (elPushes) elPushes.textContent = String(game.state.pushes);
    if (btnUndo) btnUndo.disabled = game.state.history.length === 0 || game.phase !== "play";
    if (btnHint) btnHint.disabled = game.phase !== "play";

    var best = store.best(game.index);
    if (elBest) {
      if (best && (best.moves !== null || best.pushes !== null)) {
        var parts = [];
        if (best.moves !== null) parts.push(best.moves + " moves");
        if (best.pushes !== null) parts.push(best.pushes + " pushes");
        elBest.textContent = "Best " + parts.join(" · ");
      } else {
        elBest.textContent = "";
      }
    }
    if (elSource) elSource.textContent = Levels.SOURCE.set;
    if (elHint) {
      elHint.textContent =
        game.phase === "complete"
          ? "Level restored."
          : "Arrows / WASD to move · Z undo · R restart · tap deck to walk · tap a core to push";
    }
  }

  /* ------------------------------------------------------------------
     Layout
     ------------------------------------------------------------------ */

  function layout() {
    if (!game.level) return;
    var dpr = window.devicePixelRatio || 1;

    /* Size the stage so the board, HUD and controls fit the viewport. In
       short landscape the controls sit *beside* the board, so their height
       must not be subtracted from it. */
    var stageTop = stage.getBoundingClientRect().top + window.scrollY;
    var stageRect = stage.getBoundingClientRect();
    var controlsRect = controls ? controls.getBoundingClientRect() : null;
    var beside =
      controlsRect && controlsRect.left >= stageRect.right - 2 && controlsRect.width > 0;
    var controlsH = beside || !controlsRect ? 0 : controlsRect.height;
    var avail = window.innerHeight - stageTop - controlsH - 16;
    var h = Math.max(170, Math.round(avail));
    if (Math.abs((parseFloat(stage.style.height) || 0) - h) > 1) {
      stage.style.height = h + "px";
    }

    var rect = stage.getBoundingClientRect();
    renderer.fit(Math.max(120, rect.width), Math.max(120, h), dpr);
  }

  /* ------------------------------------------------------------------
     Frame
     ------------------------------------------------------------------ */

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function posX(index) {
    return (index % game.level.w) + 0.5;
  }

  function posY(index) {
    return Math.floor(index / game.level.w) + 0.5;
  }

  var lastFrame = 0;

  function frame(now) {
    var dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;

    /* 1. advance the animation slot */
    if (game.anim) {
      var p = (now - game.anim.t0) / game.anim.dur;
      if (p >= 1) finishStep(now);
    }

    /* 2. drain one queued intent per free animation slot */
    if (!game.anim && game.phase === "play") {
      var dir = null;
      var backlog = game.queue.length + game.path.length;
      if (game.queue.length) dir = game.queue.shift();
      else if (game.path.length) dir = game.path.shift();
      if (dir !== null) beginStep(dir, now, backlog);
    }

    /* 3. blocked marker decay */
    if (game.blocked) {
      game.blocked.t += dt / motion(BLOCK_MS);
      if (game.blocked.t >= 1) game.blocked = null;
    }

    /* 3b. save the board once the player has stopped moving */
    persistIfIdle();

    /* 4. power and illumination ease toward the docked truth */
    var targetLight = RendererNS.LIGHT_BASE + (1 - RendererNS.LIGHT_BASE) * game.targetPower;
    if (game.phase === "sequence" && game.sequence) {
      var st = Math.min(1, (now - game.sequence.t0) / game.sequence.dur);
      var ramp = easeOutCubic(Math.min(1, st / 0.7));
      game.targetPower = 1;
      game.power = lerp(game.power, 1, Math.min(1, dt / 90));
      game.light = lerp(game.light, 1, Math.min(1, dt / 110));
      if (ramp > 0.999) game.power = 1;
    } else {
      var k = Math.min(1, dt / 110);
      game.power = lerp(game.power, game.targetPower, k);
      game.light = lerp(game.light, targetLight, k);
    }

    /* 5. sequence timing */
    if (game.phase === "sequence" && game.sequence) {
      var t = (now - game.sequence.t0) / game.sequence.dur;
      if (t >= 1) {
        game.sequence = null;
        game.power = 1;
        game.light = 1;
        finishSequence();
      }
    }

    renderScene(now);
    requestAnimationFrame(frame);
  }

  function renderScene(now) {
    var l = game.level;
    var s = game.state;
    var a = game.anim;
    var playerX;
    var playerY;

    if (a) {
      var e = easeOutCubic(Math.max(0, Math.min(1, (now - a.t0) / a.dur)));
      playerX = lerp(posX(a.playerFrom), posX(a.playerTo), e);
      playerY = lerp(posY(a.playerFrom), posY(a.playerTo), e);
    } else {
      playerX = posX(s.player);
      playerY = posY(s.player);
    }

    var boxes = [];
    for (var i = 0; i < s.boxes.length; i += 1) {
      var cell = s.boxes[i];
      var bx = posX(cell);
      var by = posY(cell);
      if (a && a.boxTo === cell) {
        var e2 = easeOutCubic(Math.max(0, Math.min(1, (now - a.t0) / a.dur)));
        bx = lerp(posX(a.boxFrom), posX(a.boxTo), e2);
        by = lerp(posY(a.boxFrom), posY(a.boxTo), e2);
      }
      boxes.push({ x: bx, y: by, live: game.dockedMask[cell] === 1 });
    }

    /* the trail left by tap-to-walk */
    var trail = [];
    if (game.path.length && !a) {
      var walker = s.player;
      for (var k = 0; k < game.path.length && k < 48; k += 1) {
        var d = Engine.DIRS[game.path[k]];
        var wx = (walker % l.w) + d.dx;
        var wy = Math.floor(walker / l.w) + d.dy;
        if (wx < 0 || wy < 0 || wx >= l.w || wy >= l.h) break;
        walker = wy * l.w + wx;
        trail.push(walker);
      }
    }

    renderer.draw(
      {
        level: l,
        playerX: playerX,
        playerY: playerY,
        boxes: boxes,
        facing: game.facing,
        selected: game.selected,
        options: game.options,
        path: trail,
        dockedMask: game.dockedMask,
        power: game.power,
        light: game.light,
        blocked: game.blocked,
        sequence:
          game.sequence && game.lastDock !== null
            ? {
                t: Math.min(1, (now - game.sequence.t0) / game.sequence.dur),
                col: game.lastDock % l.w,
                row: Math.floor(game.lastDock / l.w)
              }
            : null
      },
      now
    );
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  Input.attach(canvas, {
    onStep: onStep,
    onCell: onCell,
    onCommand: onCommand,
    cellFromPoint: function (x, y) {
      return renderer.cellFromPoint(x, y);
    }
  });

  if (btnUndo) {
    btnUndo.addEventListener("click", function () {
      onCommand("undo");
    });
  }
  if (btnRestart) {
    btnRestart.addEventListener("click", function () {
      onCommand("restart");
    });
  }
  if (btnLevels) {
    btnLevels.addEventListener("click", function () {
      if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
      togglePanel("levels");
    });
  }
  if (btnHint) {
    btnHint.addEventListener("click", function () {
      onCommand("hint");
    });
  }
  if (btnNext) {
    btnNext.addEventListener("click", function () {
      if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
      loadLevel(game.index + 1, { fresh: true });
    });
  }
  if (btnReplay) {
    btnReplay.addEventListener("click", function () {
      replayLevel();
    });
  }
  if (btnCompleteLevels) {
    btnCompleteLevels.addEventListener("click", function () {
      if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
      openPanel("levels");
    });
  }
  if (btnLevelsClose) {
    btnLevelsClose.addEventListener("click", function () {
      if (GameAudio && GameAudio.cs) GameAudio.cs.ui();
      closePanel();
    });
  }
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && game.panel === "levels") closePanel();
    });
  }

  function syncSoundButton() {
    if (!btnSound || !GameAudio) return;
    var on = GameAudio.isEnabled();
    btnSound.setAttribute("aria-pressed", on ? "true" : "false");
    btnSound.textContent = on ? "Sound on" : "Sound off";
  }

  if (btnSound) {
    btnSound.addEventListener("click", function () {
      if (!GameAudio) return;
      GameAudio.setEnabled(!GameAudio.isEnabled());
      syncSoundButton();
      if (GameAudio.isEnabled() && GameAudio.cs) GameAudio.cs.ui();
    });
  }

  if (reduced && reduced.addEventListener) {
    reduced.addEventListener("change", function (e) {
      renderer.setReducedMotion(e.matches);
    });
  }

  window.addEventListener(
    "resize",
    function () {
      layout();
    },
    { passive: true }
  );
  window.addEventListener(
    "orientationchange",
    function () {
      setTimeout(layout, 120);
    },
    { passive: true }
  );
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () {
      layout();
    });
    ro.observe(stage);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) persistResume();
  });
  window.addEventListener("beforeunload", function () {
    persistResume();
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  buildLevelGrid();
  syncSoundButton();
  loadLevel(store.currentLevel(), { fresh: false });
  requestAnimationFrame(frame);
})();
