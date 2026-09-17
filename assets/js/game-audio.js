/* ------------------------------------------------------------------
   Game audio — randolf.dev (shared: Minesweeper / Gomoku / Reversi /
   Rope Tangle / 2048). Restrained Web Audio synthesis, no assets, no BGM.

   Design follows the existing Water Sort sound module's approach:
   lazy AudioContext, one master gain, short filtered envelopes.
   Water Sort itself keeps using its own module untouched.

   Preference: localStorage "randolf:games:sound" = "on" | "off"
   (shared across these four games; default on).
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var PREF_KEY = "randolf:games:sound";

  var ctx = null;
  var master = null;
  var noiseBuffer = null;
  var enabled = readPref();
  var activeVoices = 0;
  var lastPlayed = {};
  var recipes = {};
  var unlockBound = false;

  /* --- preference ------------------------------------------------- */

  function readPref() {
    try {
      var raw = global.localStorage.getItem(PREF_KEY);
      return raw !== "off"; /* default ON */
    } catch (e) {
      return true;
    }
  }

  function writePref() {
    try {
      global.localStorage.setItem(PREF_KEY, enabled ? "on" : "off");
    } catch (e) {
      /* storage unavailable — preference simply won't persist */
    }
  }

  /* --- context lifecycle ------------------------------------------ */

  function ensureCtx() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      return ctx;
    } catch (e) {
      ctx = null;
      return null;
    }
  }

  function bindUnlock() {
    if (unlockBound) return;
    unlockBound = true;
    function onGesture() {
      var c = ensureCtx();
      if (c && c.state === "suspended") {
        c.resume().catch(function () {});
      }
    }
    global.document.addEventListener("pointerdown", onGesture, {
      passive: true
    });
    global.document.addEventListener("keydown", onGesture, true);
  }

  /* --- primitives --------------------------------------------------- */

  function getNoise(c) {
    if (!noiseBuffer) {
      var len = Math.floor(c.sampleRate * 0.8);
      noiseBuffer = c.createBuffer(1, len, c.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i += 1) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.04 * white) / 1.04;
        data[i] = last * 3.2;
      }
    }
    return noiseBuffer;
  }

  /* Short pitched blip with exponential attack/decay. */
  function tone(c, dest, t0, freq, freqEnd, dur, peak, type) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (freqEnd && freqEnd !== freq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, freqEnd),
        t0 + dur
      );
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    trackVoice(c, osc);
    return osc;
  }

  /* Filtered noise burst, optionally sweeping its filter. */
  function noise(c, dest, t0, dur, peak, filterType, f0, f1, q) {
    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    src.loop = true;
    var filt = c.createBiquadFilter();
    filt.type = filterType || "bandpass";
    filt.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) {
      filt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    }
    filt.Q.value = q || 1;
    var gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(gain);
    gain.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    trackVoice(c, src);
    return src;
  }

  function trackVoice(c, src) {
    activeVoices += 1;
    src.onended = function () {
      activeVoices = Math.max(0, activeVoices - 1);
    };
  }

  /* Subtle deterministic-ish variation so repeats don't sound mechanical. */
  function vary(value, pct) {
    return value * (1 + (Math.random() * 2 - 1) * pct);
  }

  /* --- scheduling / safety ------------------------------------------ */

  function gate(key, minGapMs) {
    var now = Date.now();
    if (lastPlayed[key] && now - lastPlayed[key] < minGapMs) {
      return false;
    }
    lastPlayed[key] = now;
    return true;
  }

  function tooBusy() {
    return activeVoices > 24;
  }

  function play(key, minGapMs, recipe) {
    recipes[key] = recipe; /* registry for offline analysis of every cue */
    if (!enabled) return;
    if (!gate(key, minGapMs)) return;
    if (tooBusy()) return;
    var c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") {
      c.resume().catch(function () {});
    }
    try {
      recipe(c, master, c.currentTime + 0.005);
    } catch (e) {
      /* audio must never break gameplay */
    }
  }

  /* --- shared result cues ------------------------------------------- */

  /* Restrained three-note success figure, ~0.55s total. */
  function success(c, dest, t0) {
    var notes = [784, 988, 1318.5];
    for (var i = 0; i < notes.length; i += 1) {
      var t = t0 + i * 0.11;
      tone(c, dest, t, notes[i], notes[i], 0.34, 0.12, "triangle");
      tone(c, dest, t, notes[i] * 2, notes[i] * 2, 0.18, 0.035, "sine");
    }
    tone(c, dest, t0 + 0.3, 2637, 2637, 0.26, 0.04, "sine");
  }

  /* Low, understated resolution figure for losses / draws. */
  function resolveLow(c, dest, t0, soft) {
    var k = soft ? 0.7 : 1;
    tone(c, dest, t0, 311, 196, 0.38, 0.11 * k, "sine");
    tone(c, dest, t0 + 0.09, 233, 174.6, 0.32, 0.06 * k, "sine");
  }

  /* --- Minesweeper ---------------------------------------------------- */

  var MS = {
    /* one soft tap per user action, even when flood-fill opens many cells */
    reveal: function () {
      play("ms.reveal", 40, function (c, dest, t0) {
        noise(
          c,
          dest,
          t0,
          0.035,
          vary(0.09, 0.12),
          "bandpass",
          vary(1800, 0.06),
          1200,
          1.2
        );
        tone(c, dest, t0, vary(340, 0.04), 265, 0.045, 0.05, "sine");
      });
    },
    flag: function () {
      play("ms.flag", 45, function (c, dest, t0) {
        tone(c, dest, t0, vary(520, 0.03), 320, 0.05, 0.13, "triangle");
        noise(c, dest, t0, 0.02, 0.05, "bandpass", 2500, 2500, 2);
      });
    },
    question: function () {
      play("ms.question", 45, function (c, dest, t0) {
        tone(c, dest, t0, vary(840, 0.04), 660, 0.04, 0.075, "triangle");
      });
    },
    /* question → unmarked fade-out companion */
    markOut: function () {
      play("ms.markOut", 45, function (c, dest, t0) {
        tone(c, dest, t0, vary(460, 0.04), 580, 0.04, 0.05, "sine");
      });
    },
    mine: function () {
      play("ms.mine", 120, function (c, dest, t0) {
        tone(c, dest, t0, 140, 50, 0.26, 0.32, "sine");
        noise(c, dest, t0, 0.16, 0.13, "lowpass", 320, 120, 0.8);
        noise(c, dest, t0, 0.02, 0.07, "bandpass", 900, 900, 1.4);
      });
    },
    win: function () {
      play("ms.win", 300, success);
    }
  };

  /* --- Gomoku ----------------------------------------------------------- */

  var GM = {
    /* ceramic stone landing on a wooden board */
    stone: function (side) {
      play("gm.stone", 40, function (c, dest, t0) {
        var base = side === "ai" ? 178 : 168; /* tiny timbre difference */
        var f = vary(base, 0.03);
        tone(c, dest, t0, f, f * 0.62, 0.06, 0.165, "sine");
        noise(c, dest, t0, 0.018, 0.09, "bandpass", vary(2600, 0.05), 2000, 2.2);
      });
    },
    invalid: function () {
      play("gm.invalid", 130, function (c, dest, t0) {
        tone(c, dest, t0, 230, 182, 0.07, 0.09, "triangle");
        noise(c, dest, t0, 0.04, 0.045, "lowpass", 420, 300, 1);
      });
    },
    win: function () {
      play("gm.win", 300, success);
    },
    loss: function () {
      play("gm.loss", 300, function (c, dest, t0) {
        resolveLow(c, dest, t0, false);
      });
    },
    draw: function () {
      play("gm.draw", 300, function (c, dest, t0) {
        resolveLow(c, dest, t0, true);
      });
    }
  };

  /* --- Reversi ------------------------------------------------------------ */

  var RV = {
    place: function () {
      play("rv.place", 60, function (c, dest, t0) {
        noise(c, dest, t0, 0.025, 0.11, "bandpass", vary(1500, 0.05), 1100, 1.6);
        tone(c, dest, t0, vary(255, 0.04), 205, 0.05, 0.09, "sine");
      });
    },
    /* one grouped texture for the whole flip cascade, ≤ ~300ms.
       n = number of flipped discs, staggerMs = the visual stagger. */
    flips: function (n, staggerMs) {
      play("rv.flips", 120, function (c, dest, t0) {
        noise(c, dest, t0, 0.24, 0.34, "bandpass", 650, 1500, 1.4);
        var count = Math.min(Math.max(n || 1, 1), 5);
        var gap = Math.min(Math.max(staggerMs || 30, 25), 65) / 1000;
        for (var i = 0; i < count; i += 1) {
          var t = t0 + i * gap;
          if (t - t0 > 0.28) break;
          noise(c, dest, t, 0.014, vary(0.13, 0.2), "bandpass", 2100, 1800, 2.4);
        }
      });
    },
    pass: function () {
      play("rv.pass", 200, function (c, dest, t0) {
        tone(c, dest, t0, 523, 523, 0.09, 0.07, "sine");
        tone(c, dest, t0 + 0.09, 392, 392, 0.12, 0.05, "sine");
      });
    },
    win: function () {
      play("rv.win", 300, success);
    },
    loss: function () {
      play("rv.loss", 300, function (c, dest, t0) {
        resolveLow(c, dest, t0, false);
      });
    },
    draw: function () {
      play("rv.draw", 300, function (c, dest, t0) {
        resolveLow(c, dest, t0, true);
      });
    }
  };

  /* --- Rope Tangle ---------------------------------------------------------- */

  var RT = {
    /* soft tactile lift when an endpoint is picked up */
    pickup: function () {
      play("rt.pickup", 90, function (c, dest, t0) {
        tone(c, dest, t0, vary(290, 0.04), 430, 0.07, 0.08, "sine");
        noise(c, dest, t0, 0.02, 0.035, "bandpass", 1200, 1400, 1.6);
      });
    },
    /* socket snap — fires from the tween completion, i.e. exactly when
       the endpoint visually lands in the peg */
    snap: function () {
      play("rt.snap", 60, function (c, dest, t0) {
        tone(c, dest, t0, vary(190, 0.03), 112, 0.05, 0.21, "sine");
        noise(c, dest, t0, 0.016, 0.09, "bandpass", vary(3200, 0.06), 2600, 2.2);
        tone(c, dest, t0, 330, 210, 0.035, 0.07, "triangle");
      });
    },
    /* elastic rejection when a dragged end returns home */
    reject: function () {
      play("rt.reject", 130, function (c, dest, t0) {
        tone(c, dest, t0, 300, 208, 0.09, 0.08, "triangle");
        tone(c, dest, t0 + 0.05, vary(245, 0.05), 178, 0.08, 0.05, "sine");
      });
    },
    /* subtle release when the final crossing disappears */
    release: function () {
      play("rt.release", 300, function (c, dest, t0) {
        noise(c, dest, t0, 0.24, 0.055, "bandpass", 1400, 600, 1.2);
        tone(c, dest, t0, 587, 784, 0.28, 0.065, "sine");
      });
    },
    victory: function () {
      play("rt.victory", 300, success);
    }
  };

  /* --- Frontline: soft pulse weapons and distinct battlefield cues. --- */
  var FL = {
    shot: function (weapon) {
      play("fl.shot", 110, function (c, d, t) {
        tone(c, d, t, weapon === 2 ? 155 : 240, 95, 0.1, 0.055, "sine");
        noise(c, d, t, 0.065, 0.07, "lowpass", 1350, 380, 0.7);
      });
    },
    hit: function () {
      play("fl.hit", 110, function (c, d, t) {
        noise(c, d, t, 0.045, 0.065, "bandpass", 900, 500, 0.6);
      });
    },
    death: function () {
      play("fl.death", 140, function (c, d, t) {
        tone(c, d, t, 135, 55, 0.14, 0.075, "sine");
        noise(c, d, t, 0.09, 0.08, "lowpass", 650, 160, 0.7);
      });
    },
    pickup: function () {
      play("fl.pickup", 150, function (c, d, t) {
        tone(c, d, t, 660, 880, 0.16, 0.1, "sine");
        tone(c, d, t + 0.07, 990, 1320, 0.18, 0.07, "sine");
      });
    },
    growth: function () {
      play("fl.growth", 150, function (c, d, t) {
        [440, 660, 880].forEach(function (f, i) {
          tone(c, d, t + i * 0.07, f, f, 0.2, 0.085, "sine");
        });
      });
    },
    upgrade: function () {
      play("fl.upgrade", 180, function (c, d, t) {
        [330, 495, 660, 990].forEach(function (f, i) {
          tone(c, d, t + i * 0.06, f, f, 0.24, 0.085, "triangle");
        });
      });
    },
    damage: function () {
      play("fl.damage", 200, function (c, d, t) {
        tone(c, d, t, 170, 65, 0.24, 0.18, "sine");
        noise(c, d, t, 0.15, 0.14, "lowpass", 800, 130, 0.7);
      });
    },
    boss: function () {
      play("fl.boss", 500, function (c, d, t) {
        tone(c, d, t, 85, 60, 0.7, 0.18, "sine");
        tone(c, d, t + 0.15, 127, 85, 0.5, 0.1, "triangle");
      });
    },
    warning: function () {
      play("fl.warning", 500, function (c, d, t) {
        tone(c, d, t, 440, 440, 0.13, 0.07, "sine");
        tone(c, d, t + 0.23, 440, 440, 0.13, 0.07, "sine");
      });
    },
    impact: function () {
      play("fl.impact", 200, function (c, d, t) {
        tone(c, d, t, 100, 38, 0.3, 0.16, "sine");
        noise(c, d, t, 0.21, 0.14, "lowpass", 650, 80, 0.6);
      });
    },
    bossDeath: function () {
      play("fl.bossDeath", 400, function (c, d, t) {
        noise(c, d, t, 0.5, 0.2, "lowpass", 1300, 100, 0.7);
        tone(c, d, t, 160, 35, 0.5, 0.18, "sine");
      });
    },
    victory: function () {
      play("fl.victory", 300, success);
    },
    defeat: function () {
      play("fl.defeat", 300, function (c, d, t) {
        resolveLow(c, d, t, false);
      });
    },
  };

  /* --- 2048 ------------------------------------------------------------- */

  var G2 = {
    /* extremely subtle slide texture; one per swipe, never per tile */
    slide: function () {
      play("g2.slide", 70, function (c, d, t) {
        noise(c, d, t, 0.05, 0.026, "bandpass", vary(900, 0.08), 480, 0.9);
      });
    },
    /* one grouped pop per swipe — n merges stagger quietly behind the
       first, pitch follows the largest merged value */
    merge: function (n, maxValue) {
      play("g2.merge", 70, function (c, d, t) {
        var step = Math.min(Math.max(Math.log2(maxValue || 4) - 1, 1), 11);
        var f = 300 * Math.pow(2, step / 12);
        tone(c, d, t, f, f * 0.55, 0.09, 0.16, "triangle");
        tone(c, d, t, f * 2, f * 1.2, 0.06, 0.05, "sine");
        var extra = Math.min(Math.max((n || 1) - 1, 0), 3);
        for (var i = 1; i <= extra; i += 1) {
          var tt = t + i * 0.045;
          tone(c, d, tt, f * Math.pow(1.12, i), f * 0.6, 0.07, 0.085, "triangle");
        }
      });
    },
    win: function () {
      play("g2.win", 400, success);
    },
    over: function () {
      play("g2.over", 400, function (c, d, t) {
        resolveLow(c, d, t, false);
      });
    }
  };

  /* --- public API ------------------------------------------------------------ */

  var GameAudio = {
    isEnabled: function () {
      return enabled;
    },
    setEnabled: function (on) {
      enabled = !!on;
      writePref();
      if (ctx) {
        try {
          if (enabled) {
            ctx.resume().catch(function () {});
          } else {
            ctx.suspend().catch(function () {});
          }
        } catch (e) {}
      }
      return enabled;
    },
    toggle: function () {
      return GameAudio.setEnabled(!enabled);
    },
    /* test hook — renders a registered recipe through any AudioContext
       (e.g. OfflineAudioContext) without touching playback state */
    _render: function (name, c, dest, t0) {
      var recipe = recipes[name];
      if (recipe) {
        recipe(c, dest, t0);
      }
    },
    _recipeNames: function () {
      return Object.keys(recipes);
    },
    _voices: function () {
      return activeVoices;
    },
    fl: FL,
    ms: MS,
    gm: GM,
    rv: RV,
    rt: RT,
    g2048: G2
  };

  global.GameAudio = GameAudio;
})(typeof window !== "undefined" ? window : globalThis);
