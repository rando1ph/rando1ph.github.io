/* ------------------------------------------------------------------
   Core Shift — input
   Keyboard, pointer and touch, normalised into four intents:

     onStep(dir)   one precise step or push
     onCell(index) a tap on a board cell (walk there, or pick a core)
     onCommand(c)  "undo" | "restart" | "levels" | "hint" | "escape"
     onAnyInput()  fired on any interaction, used to unlock audio

   No virtual D-pad, no vibration. Swipes emit exactly one step; a tap
   is handled by the game as walk-to or core-select.
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var SWIPE_MIN = 22; /* css px before a drag counts as a swipe */
  var TAP_SLOP = 12; /* css px of movement still treated as a tap */
  var TAP_MAX_MS = 700;

  var KEYS = {
    ArrowUp: 0,
    w: 0,
    W: 0,
    ArrowRight: 1,
    d: 1,
    D: 1,
    ArrowDown: 2,
    s: 2,
    S: 2,
    ArrowLeft: 3,
    a: 3,
    A: 3
  };

  function attach(canvas, handlers) {
    var h = handlers || {};
    var active = null;
    var swiped = false;
    var detachFns = [];

    /* --- keyboard ---------------------------------------------------- */

    function onKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var dir = KEYS[e.key];
      if (dir !== undefined) {
        e.preventDefault();
        if (h.onStep) h.onStep(dir);
        return;
      }
      var k = e.key;
      if (k === "z" || k === "Z") {
        e.preventDefault();
        if (h.onCommand) h.onCommand("undo");
      } else if (k === "r" || k === "R") {
        e.preventDefault();
        if (h.onCommand) h.onCommand("restart");
      } else if (k === "l" || k === "L") {
        e.preventDefault();
        if (h.onCommand) h.onCommand("levels");
      } else if (k === "h" || k === "H") {
        e.preventDefault();
        if (h.onCommand) h.onCommand("hint");
      } else if (k === "Escape") {
        if (h.onCommand) h.onCommand("escape");
      }
    }

    global.addEventListener("keydown", onKeyDown);
    detachFns.push(function () {
      global.removeEventListener("keydown", onKeyDown);
    });

    /* --- pointer ------------------------------------------------------ */

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
      swiped = false;
    }

    function onPointerMove(e) {
      if (!active || e.pointerId !== active.id || swiped) return;
      var dx = e.clientX - active.x;
      var dy = e.clientY - active.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SWIPE_MIN) return;
      swiped = true;
      var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      if (h.onStep) h.onStep(dir);
    }

    function onPointerUp(e) {
      if (!active || e.pointerId !== active.id) return;
      var wasSwiped = swiped;
      var start = active;
      active = null;
      swiped = false;
      if (wasSwiped) return;
      var dx = e.clientX - start.x;
      var dy = e.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_SLOP) return;
      if (Date.now() - start.t > TAP_MAX_MS) return;
      var index = h.cellFromPoint ? h.cellFromPoint(e.clientX, e.clientY) : -1;
      if (index >= 0 && h.onCell) h.onCell(index);
    }

    function onPointerCancel() {
      active = null;
      swiped = false;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("lostpointercapture", onPointerCancel);
    canvas.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });

    detachFns.push(function () {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("lostpointercapture", onPointerCancel);
    });

    return {
      detach: function () {
        detachFns.forEach(function (fn) {
          fn();
        });
        detachFns.length = 0;
      }
    };
  }

  global.CoreShiftInput = { attach: attach, SWIPE_MIN: SWIPE_MIN };
})(typeof window !== "undefined" ? window : globalThis);
