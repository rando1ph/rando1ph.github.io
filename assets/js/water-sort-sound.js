/* ------------------------------------------------------------------
   Water Sort — sound (randolf.dev)
   Restrained Web Audio synthesis. No assets, no BGM, no throw paths.
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var ctx = null;
  var master = null;
  var noiseBuffer = null;
  var enabled = true;
  var unlocked = false;

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
      if (ctx.state === "suspended" && !unlocked) {
        ctx.resume().catch(function () {});
      }
      return ctx;
    } catch (e) {
      ctx = null;
      return null;
    }
  }

  function unlock() {
    unlocked = true;
    var c = ensureCtx();
    if (c && c.state === "suspended") {
      c.resume().catch(function () {});
    }
  }

  function getNoise(c) {
    if (!noiseBuffer) {
      var len = Math.floor(c.sampleRate * 0.6);
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

  function tone(c, freq, freqEnd, t0, dur, peak, type) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd && freqEnd !== freq) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playSelect() {
    var c = ensureCtx();
    if (!c) return;
    var t = c.currentTime;
    tone(c, 1650, 1150, t, 0.05, 0.16, "triangle");
  }

  function playInvalid() {
    var c = ensureCtx();
    if (!c) return;
    var t = c.currentTime;
    tone(c, 170, 120, t, 0.08, 0.22, "triangle");
  }

  function playDeselect() {
    var c = ensureCtx();
    if (!c) return;
    var t = c.currentTime;
    tone(c, 900, 700, t, 0.04, 0.08, "triangle");
  }

  function playPour(amount) {
    var c = ensureCtx();
    if (!c) return;
    var t = c.currentTime;
    var dur = 0.22 + Math.min(amount || 1, 4) * 0.05;

    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    src.loop = true;

    var band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(850, t);
    band.frequency.exponentialRampToValueAtTime(480, t + dur);
    band.Q.value = 1.6;

    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.38, t + 0.05);
    g.gain.setValueAtTime(0.38, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(band);
    band.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);

    tone(c, 340, 190, t, 0.09, 0.12, "sine");
  }

  function playVictory() {
    var c = ensureCtx();
    if (!c) return;
    var t = c.currentTime;
    var notes = [784, 988, 1175];
    for (var i = 0; i < notes.length; i += 1) {
      var t0 = t + i * 0.14;
      tone(c, notes[i], notes[i], t0, 0.5, 0.18, "triangle");
      tone(c, notes[i] * 2, notes[i] * 2, t0, 0.3, 0.05, "sine");
    }
    tone(c, 1568, 1568, t + 0.42, 0.6, 0.09, "sine");
  }

  function playHint() {
    var c = ensureCtx();
    if (!c) return;
    var t = c.currentTime;
    tone(c, 1040, 1040, t, 0.09, 0.11, "sine");
    tone(c, 1320, 1320, t + 0.1, 0.12, 0.11, "sine");
  }

  var WS_SOUND = {
    setEnabled: function (on) {
      enabled = !!on;
      if (!enabled && ctx) {
        try { ctx.suspend().catch(function () {}); } catch (e) {}
      } else if (enabled && ctx) {
        try { ctx.resume().catch(function () {}); } catch (e) {}
      }
    },
    isEnabled: function () { return enabled; },
    unlock: unlock,
    select: playSelect,
    deselect: playDeselect,
    invalid: playInvalid,
    pour: playPour,
    victory: playVictory,
    hint: playHint
  };

  global.WSSound = WS_SOUND;
})(typeof window !== "undefined" ? window : globalThis);
