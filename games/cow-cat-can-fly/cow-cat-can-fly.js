/* ------------------------------------------------------------------
   Cow Cat Can Fly 奶牛猫会飞 — randolf.dev
   ------------------------------------------------------------------
   Original one-tap flyer. Vanilla JS + Canvas 2D, zero dependencies.

   Studied (MIT) before building — concepts only, no art/assets copied:
   - CrappyBird (c) 2014 Varun Pant ......... state machine, velocity model
   - flappy-bird (c) 2026 pyforgedev ........ dt clamp, bounded gap delta,
                                              score-once flag, restart guard
   - flappybird (c) 2020 Shu Ding ........... touch input handling
   See THIRD_PARTY_NOTICES.txt in this folder.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  /* ================================================================
     Pure core (no DOM) — also exported for headless tests
     ================================================================ */

  var W = 360;
  var H = 640;
  var GROUND_H = 56;
  var GROUND_Y = H - GROUND_H;
  var OBST_W = 56;

  var CAT_X = 92;
  var CAT_HIT_W = 24;   /* fits the round head; ears + cheek edges forgiven */
  var CAT_HIT_H = 22;

  var GRAVITY = 1450;      /* px/s^2 */
  var FLAP_VY = -460;      /* px/s   */
  var MAX_FALL = 620;      /* px/s — terminal velocity via linear drag */
  var DRAG_K = GRAVITY / MAX_FALL; /* 1/s — a = g - k·v */
  var CEIL_Y = 14;

  var DT_CLAMP = 0.05;  /* s — max simulated step after tab switch */
  var RESTART_GUARD = 0.55; /* s before game-over input is accepted */
  var FIRST_PIPE_DELAY = 120; /* logical px beyond right edge */

  var TOP_MARGIN = 34;
  var BOT_MARGIN = 26;

  /* Difficulty curve — smooth, capped. score -> params */
  function diffAt(score) {
    var s = Math.max(0, Math.min(score, 45));
    var t = s / 45;
    var e = t * t * (3 - 2 * t); /* smoothstep */
    return {
      speed: 132 + 68 * e,        /* 132 -> 200 px/s   */
      gap: 168 - 46 * e,          /* 168 -> 122 px     */
      spacing: 224 - 44 * e,      /* 224 -> 180 px     */
      maxDelta: 150 - 30 * e      /* 150 -> 120 px     */
    };
  }

  /* Bounded vertical shift between consecutive gap centers.
     Never returns an impossible sequence; result stays inside
     [minC, maxC] and within maxDelta of prevCenter. */
  function nextGapCenter(prevCenter, d, rng) {
    rng = rng || Math.random;
    var half = d.gap / 2;
    var minC = TOP_MARGIN + half;
    var maxC = GROUND_Y - BOT_MARGIN - half;
    if (maxC < minC) { maxC = minC; }
    var shift = (rng() * 2 - 1) * d.maxDelta;
    var c = prevCenter + shift;
    if (c < minC) { c = minC; }
    if (c > maxC) { c = maxC; }
    return c;
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return !(ax > bx + bw || ax + aw < bx || ay > by + bh || ay + ah < by);
  }

  /* Cat hitbox rect from cat center-y */
  function catRect(cy) {
    return {
      x: CAT_X - CAT_HIT_W / 2,
      y: cy - CAT_HIT_H / 2 + 1,
      w: CAT_HIT_W,
      h: CAT_HIT_H
    };
  }

  var CORE = {
    W: W, H: H, GROUND_H: GROUND_H, GROUND_Y: GROUND_Y, OBST_W: OBST_W,
    CAT_X: CAT_X, GRAVITY: GRAVITY, FLAP_VY: FLAP_VY, MAX_FALL: MAX_FALL,
    DRAG_K: DRAG_K, DT_CLAMP: DT_CLAMP, RESTART_GUARD: RESTART_GUARD,
    TOP_MARGIN: TOP_MARGIN, BOT_MARGIN: BOT_MARGIN,
    diffAt: diffAt, nextGapCenter: nextGapCenter,
    aabb: aabb, catRect: catRect
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CORE;
    return;
  }

  /* ================================================================
     DOM
     ================================================================ */

  var doc = document;
  var canvas = doc.querySelector("[data-cc-canvas]");
  if (!canvas || !canvas.getContext) { return; }
  var stage = doc.querySelector("[data-cc-stage]");
  var block = doc.querySelector("[data-cc-block]");
  var pauseBtn = doc.querySelector("[data-cc-pause]");
  var soundBtn = doc.querySelector("[data-cc-sound]");
  var hintEl = doc.querySelector("[data-cc-hint]");
  var liveEl = doc.querySelector("[data-cc-live]");
  var ctx = canvas.getContext("2d");

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  var isTouch = false;
  try {
    isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  } catch (e) {}

  var DEBUG = /(?:^|[?&])debug(?:=1|&|$)/.test(window.location.search) ||
    (function () {
      try { return localStorage.getItem("randolf:cow-cat-can-fly:debug") === "1"; }
      catch (e) { return false; }
    })();

  /* ================================================================
     Persistence
     ================================================================ */

  var STORE_KEY = "randolf:cow-cat-can-fly:v1";

  function loadStore() {
    var out = { best: 0, runs: 0 };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) { return out; }
      var v = JSON.parse(raw);
      out.best = Math.max(0, parseInt(v && v.best, 10) || 0);
      out.runs = Math.max(0, parseInt(v && v.runs, 10) || 0);
    } catch (e) { /* malformed / unavailable — defaults */ }
    return out;
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* unavailable */ }
  }

  var store = loadStore();

  function announce(msg) {
    if (!liveEl) { return; }
    /* rewrite so repeated identical messages still announce */
    liveEl.textContent = "";
    window.setTimeout(function () { liveEl.textContent = msg; }, 30);
  }

  /* ================================================================
     Sound — Web Audio synthesis, follows the shared site helper's
     recipe style. Uses the site-wide preference key
     "randolf:games:sound" (kept self-contained to avoid touching the
     shared game-audio.js while other games are being developed).
     ================================================================ */

  var Sound = (function () {
    var PREF_KEY = "randolf:games:sound";
    var actx = null;
    var master = null;
    var noiseBuf = null;
    var enabled = true;
    var last = {};

    function readPref() {
      try { return window.localStorage.getItem(PREF_KEY) !== "off"; }
      catch (e) { return true; }
    }
    enabled = readPref();

    function ensure() {
      if (!enabled) { return null; }
      try {
        if (!actx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) { return null; }
          actx = new AC();
          master = actx.createGain();
          master.gain.value = 0.5;
          master.connect(actx.destination);
        }
        return actx;
      } catch (e) { actx = null; return null; }
    }

    function gate(key, ms) {
      var now = Date.now();
      if (last[key] && now - last[key] < ms) { return false; }
      last[key] = now;
      return true;
    }

    function tone(c, t0, f0, f1, dur, peak, type) {
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(Math.max(20, f0), t0);
      if (f1 && f1 !== f0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }

    function noise(c, t0, dur, peak, f0, f1, q) {
      if (!noiseBuf) {
        var len = Math.floor(c.sampleRate * 0.4);
        noiseBuf = c.createBuffer(1, len, c.sampleRate);
        var data = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i += 1) {
          data[i] = Math.random() * 2 - 1;
        }
      }
      var src = c.createBufferSource();
      src.buffer = noiseBuf;
      var filt = c.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) {
        filt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      }
      filt.Q.value = q || 1;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt); filt.connect(g); g.connect(master);
      src.start(t0); src.stop(t0 + dur + 0.03);
    }

    function play(key, minGap, recipe) {
      if (!enabled) { return; }
      if (!gate(key, minGap)) { return; }
      var c = ensure();
      if (!c) { return; }
      if (c.state === "suspended") { c.resume().catch(function () {}); }
      try { recipe(c, c.currentTime + 0.005); } catch (e) {}
    }

    var api = {
      isEnabled: function () { return enabled; },
      setEnabled: function (on) {
        enabled = !!on;
        try { window.localStorage.setItem(PREF_KEY, enabled ? "on" : "off"); }
        catch (e) {}
        if (actx) {
          try {
            if (enabled) { actx.resume().catch(function () {}); }
            else { actx.suspend().catch(function () {}); }
          } catch (e) {}
        }
        return enabled;
      },
      unlock: function () { ensure(); },
      boost: function () {
        play("cc.boost", 45, function (c, t) {
          noise(c, t, 0.055, 0.05, 1500, 850, 1.1);
          tone(c, t, 560, 830, 0.05, 0.04, "sine");
        });
      },
      score: function () {
        play("cc.score", 80, function (c, t) {
          tone(c, t, 988, 988, 0.07, 0.09, "sine");
          tone(c, t + 0.07, 1319, 1319, 0.09, 0.075, "sine");
        });
      },
      hit: function () {
        play("cc.hit", 150, function (c, t) {
          tone(c, t, 165, 55, 0.17, 0.22, "sine");
          noise(c, t, 0.12, 0.15, 700, 160, 0.8);
        });
      },
      over: function () {
        play("cc.over", 400, function (c, t) {
          tone(c, t, 311, 196, 0.32, 0.1, "sine");
          tone(c, t + 0.1, 233, 175, 0.3, 0.06, "sine");
        });
      },
      best: function () {
        play("cc.best", 500, function (c, t) {
          var notes = [523, 659, 784];
          for (var i = 0; i < notes.length; i += 1) {
            tone(c, t + i * 0.08, notes[i], notes[i], 0.14, 0.07, "triangle");
          }
        });
      }
    };
    return api;
  })();

  /* ================================================================
     Pixel sprites — authored grids rendered to offscreen canvases.
     Legend: K outline/black fur, F black fur patch, W white fur,
     D fur shade, G eye (site lime), P pink, A air pixel.
     ================================================================ */

  var PAL = {
    F: "#1c1c26",
    W: "#f5f5f0",
    D: "#d9d9d1",
    G: "#b9e34b",
    K: "#14141c",
    P: "#e78ba0",
    A: "rgba(245,245,240,0.5)"
  };

  var OUTLINE = "#50536a";

  /* 20 x 18 grids — a floating British Shorthair cow-cat HEAD.
     scale x2 -> 40x36 logical px, nearest-neighbour.
     BSH traits: very round broad face, chubby cheeks, small rounded
     ears, short muzzle, large wide-set round eyes. Cow pattern:
     big irregular black patch over the left forehead/eye side,
     smaller black patch on the right cheek, black left ear,
     black-tipped right ear, white muzzle, pink nose.
     A moonlit 1px outline is added automatically. */

  var SPR_GLIDE = [
    "....FF........FF....",
    "...FFFF......WWWW...",
    "...FFFFWWWWWWWWWW...",
    "..WFFFFWWWWWWWWWWW..",
    "..FFFFFWWWWWWWWWWW..",
    ".WFFFFFFWWWWWWWWWWW.",
    ".WFFFWWWWWWWWWWWWWW.",
    ".WFFFKKKWWWWKKKWWWW.",
    ".WFFFKWKWWWWKWKWWWW.",
    ".WFFFKKKWWWWKKKWWWW.",
    ".WFWWWWWWWWWWWWFFFW.",
    ".WWWWWWWWPPWWWWWFFW.",
    ".WWWWWWWKWWKWWWWWFW.",
    ".WDDWWWWWWWWWWWWDDW.",
    "..WWDDWWWWWWWWDDWW..",
    ".....WDDWWWWDDW.....",
    ".......DDDDDD.......",
    "...................."
  ];

  var SPR_FLAP = [
    "....................",
    "...FFFF......WWWW...",
    "...FFFFWWWWWWWWWW...",
    "..WFFFFWWWWWWWWWWW..",
    "..FFFFFWWWWWWWWWWW..",
    ".WFFFFFFWWWWWWWWWWW.",
    ".WFFFWWWWWWWWWWWWWW.",
    ".WFFFKKKWWWWKKKWWWW.",
    ".WFFFKWKWWWWKWKWWWW.",
    ".WFFFKKKWWWWKKKWWWW.",
    ".WFWWWWWWWWWWWWFFFW.",
    ".WWWWWWWWPPWWWWWFFW.",
    ".WWWWWWWKWWKWWWWWFW.",
    ".WDDWWWWWWWWWWWWDDW.",
    "..WWDDWWWWWWWWDDWW..",
    ".....WDDWWWWDDW.....",
    "......AA....AA......",
    "...................."
  ];

  var SPR_DIVE = [
    "....................",
    "...FFFF......WWWW...",
    "...FFFFWWWWWWWWWW...",
    "..WFFFFWWWWWWWWWWW..",
    "..FFFFFWWWWWWWWWWW..",
    ".WFFFFFFWWWWWWWWWWW.",
    ".WFFFWWWWWWWWWWWWWW.",
    ".WFFFKKKWWWWKKKWWWW.",
    ".WFFFKWKWWWWKWKWWWW.",
    ".WFFFKKKWWWWKKKWWWW.",
    ".WFWWWWWWWWWWWWFFFW.",
    ".WWWWWWWWPPWWWWWFFW.",
    ".WWWWWWWKWWKWWWWWFW.",
    ".WDDWWWWWWWWWWWWDDW.",
    "..WWDDWWWWWWWWDDWW..",
    ".....WDDWWWWDDW.....",
    ".......DDDDDD.......",
    "...................."
  ];

  function makeSprite(grid) {
    var h = grid.length;
    var w = grid[0].length;
    /* outline pass at 1px grid resolution */
    var solid = [];
    for (var y = 0; y < h; y += 1) {
      solid.push([]);
      for (var x = 0; x < w; x += 1) {
        solid[y][x] = grid[y].charAt(x) !== ".";
      }
    }
    var S = 2;
    var c = doc.createElement("canvas");
    c.width = w * S;
    c.height = h * S;
    var g = c.getContext("2d");
    for (y = 0; y < h; y += 1) {
      for (x = 0; x < w; x += 1) {
        var ch = grid[y].charAt(x);
        if (ch !== ".") {
          g.fillStyle = PAL[ch] || PAL.W;
          g.fillRect(x * S, y * S, S, S);
        } else if (
          (x > 0 && solid[y][x - 1]) ||
          (x < w - 1 && solid[y][x + 1]) ||
          (y > 0 && solid[y - 1][x]) ||
          (y < h - 1 && solid[y + 1][x])
        ) {
          g.fillStyle = OUTLINE;
          g.fillRect(x * S, y * S, S, S);
        }
      }
    }
    return c;
  }

  var SPRITES = {
    glide: makeSprite(SPR_GLIDE),
    flap: makeSprite(SPR_FLAP),
    dive: makeSprite(SPR_DIVE)
  };

  /* 3x5 pixel digit font */
  var DIGITS = [
    ["111", "101", "101", "101", "111"],
    ["010", "110", "010", "010", "111"],
    ["111", "001", "111", "100", "111"],
    ["111", "001", "111", "001", "111"],
    ["101", "101", "111", "001", "001"],
    ["111", "100", "111", "001", "111"],
    ["111", "100", "111", "101", "111"],
    ["111", "001", "010", "010", "010"],
    ["111", "101", "111", "101", "111"],
    ["111", "101", "111", "001", "111"]
  ];

  function pixelText(g, str, cx, y, s, color, shadow) {
    var dw = 4 * s; /* 3px glyph + 1px space */
    var total = str.length * dw - s;
    var x0 = Math.round(cx - total / 2);
    var x, y0, d, r, cN;
    function drawPass(ox, oy, col) {
      g.fillStyle = col;
      for (var i = 0; i < str.length; i += 1) {
        d = DIGITS[+str.charAt(i)];
        x = x0 + i * dw + ox;
        for (r = 0; r < 5; r += 1) {
          for (cN = 0; cN < 3; cN += 1) {
            if (d[r].charAt(cN) === "1") {
              g.fillRect(x + cN * s, y + oy + r * s, s, s);
            }
          }
        }
      }
    }
    if (shadow) { drawPass(s * 0.5, s * 0.5, "rgba(0,0,0,0.55)"); }
    drawPass(0, 0, color);
  }

  /* ================================================================
     Static scenery caches
     ================================================================ */

  var skyCanvas = null;

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSky() {
    skyCanvas = doc.createElement("canvas");
    skyCanvas.width = W;
    skyCanvas.height = H;
    var g = skyCanvas.getContext("2d");

    var grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0a0d18");
    grad.addColorStop(0.55, "#0e1526");
    grad.addColorStop(0.85, "#132033");
    grad.addColorStop(1, "#16283c");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    /* horizon haze */
    var haze = g.createLinearGradient(0, GROUND_Y - 150, 0, GROUND_Y);
    haze.addColorStop(0, "rgba(56,110,120,0)");
    haze.addColorStop(1, "rgba(56,110,120,0.16)");
    g.fillStyle = haze;
    g.fillRect(0, GROUND_Y - 150, W, 150);

    /* pixel moon, top right — full disc with crater pixels */
    var mx = 286, my = 76, R = 16;
    for (var y = -R; y <= R; y += 2) {
      for (var x = -R; x <= R; x += 2) {
        if (x * x + y * y <= R * R) {
          g.fillStyle = (x * x + y * y > (R - 4) * (R - 4)) ? "#aab6cc" : "#d9e1ee";
          g.fillRect(mx + x, my + y, 2, 2);
        }
      }
    }
    g.fillStyle = "#aab6cc";
    g.fillRect(mx - 8, my - 6, 8, 6);
    g.fillRect(mx + 2, my + 4, 6, 4);
    g.fillRect(mx - 2, my - 12, 6, 4);
  }

  /* procedural repeating skyline tiles */
  function makeSkylineTile(w, h, seed, opts) {
    var c = doc.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    var rng = mulberry(seed);
    var x = 0;
    g.fillStyle = opts.color;
    while (x < w) {
      var bw = Math.floor(26 + rng() * 40);
      var bh = Math.floor(opts.minH + rng() * (opts.maxH - opts.minH));
      var top = h - bh;
      g.fillRect(x, top, bw, bh);
      /* rooftop extras */
      if (opts.extras && rng() > 0.55) {
        var ex = x + 4 + rng() * (bw - 10);
        if (rng() > 0.5) {
          /* antenna */
          g.fillRect(ex, top - 8 - rng() * 8, 2, 8 + 8);
        } else {
          /* water tank */
          g.fillRect(ex, top - 7, 10, 7);
        }
      }
      /* lit windows */
      if (opts.windows) {
        var cols = Math.floor(bw / 12);
        var rows = Math.floor(bh / 16);
        for (var r = 0; r < rows; r += 1) {
          for (var cl = 0; cl < cols; cl += 1) {
            if (rng() < opts.litChance) {
              g.fillStyle = rng() > 0.7 ? opts.warm : opts.cold;
              g.globalAlpha = 0.35 + rng() * 0.3;
              g.fillRect(x + 4 + cl * 12, top + 5 + r * 16, 4, 5);
              g.globalAlpha = 1;
              g.fillStyle = opts.color;
            }
          }
        }
      }
      x += bw + Math.floor(3 + rng() * 8);
    }
    return c;
  }

  var FAR_TILE, NEAR_TILE, GROUND_TILE;

  function buildTiles() {
    FAR_TILE = makeSkylineTile(640, 190, 20260918, {
      color: "#111827", minH: 40, maxH: 120,
      windows: true, litChance: 0.1,
      cold: "#3d5a6b", warm: "#8a7a55", extras: true
    });
    NEAR_TILE = makeSkylineTile(560, 130, 7091261, {
      color: "#0c101b", minH: 30, maxH: 90,
      windows: true, litChance: 0.07,
      cold: "#33565f", warm: "#6f6248", extras: true
    });

    GROUND_TILE = doc.createElement("canvas");
    GROUND_TILE.width = 120;
    GROUND_TILE.height = GROUND_H;
    var g = GROUND_TILE.getContext("2d");
    g.fillStyle = "#101318";
    g.fillRect(0, 0, 120, GROUND_H);
    g.fillStyle = "#39415a";
    g.fillRect(0, 0, 120, 2);
    g.fillStyle = "rgba(201,244,77,0.3)";
    g.fillRect(0, 2, 120, 1);
    var rng = mulberry(555);
    for (var i = 0; i < 3; i += 1) {
      var dx = Math.floor(rng() * 100);
      g.fillStyle = "rgba(201,244,77,0.4)";
      g.fillRect(dx, 7, 7, 2);
    }
    g.fillStyle = "#171b26";
    for (var j = 0; j < 6; j += 1) {
      g.fillRect(Math.floor(rng() * 110), 14 + Math.floor(rng() * 34),
        6 + Math.floor(rng() * 14), 3);
    }
  }

  /* stars */
  var stars = [];
  function buildStars() {
    stars = [];
    var rng = mulberry(9182);
    for (var i = 0; i < 46; i += 1) {
      stars.push({
        x: rng() * W,
        y: rng() * (GROUND_Y - 130),
        s: rng() > 0.75 ? 2 : 1,
        a: 0.25 + rng() * 0.5,
        ph: rng() * Math.PI * 2,
        sp: 0.5 + rng() * 1.2
      });
    }
  }

  /* ================================================================
     Game state
     ================================================================ */

  var ST = { READY: 0, PLAYING: 1, DYING: 2, OVER: 3 };
  var state = ST.READY;
  var paused = false;

  var cat = { cy: 330, vy: 0, rot: 0, frame: "glide", animT: 0, flapT: 0 };
  var pipes = [];           /* {x, center, gap, scored, seed} */
  var score = 0;
  var newBest = false;
  var overT = 0;            /* time since game over */
  var dieT = 0;
  var elapsed = 0;          /* global clock for ambient animation */

  var shakeT = 0;
  var flashT = 0;
  var scorePulseT = 0;

  var viewScale = 1;

  function d() { return diffAt(score); }

  function resetRun() {
    pipes.length = 0;
    score = 0;
    newBest = false;
    cat.cy = 330;
    cat.vy = 0;
    cat.rot = 0;
    cat.frame = "glide";
    cat.flapT = 0;
    overT = 0;
    dieT = 0;
    shakeT = 0;
    flashT = 0;
    scorePulseT = 0;
  }

  function spawnPipesInitial() {
    /* first opening is placed near the cat's flight height — kind start */
    pipes.push({
      x: W + FIRST_PIPE_DELAY,
      center: 300 + (Math.random() * 2 - 1) * 40,
      gap: d().gap,
      scored: false,
      seed: Math.floor(Math.random() * 1e9)
    });
  }

  function flap() {
    cat.vy = FLAP_VY;
    cat.flapT = 0.16;
  }

  function startRun() {
    resetRun();
    state = ST.PLAYING;
    spawnPipesInitial();
    flap();
    Sound.boost();
    announce("Game started");
    setPauseUI(false);
  }

  function die() {
    if (state !== ST.PLAYING) { return; }
    state = ST.DYING;
    dieT = 0;
    cat.vy = -170;
    shakeT = reduceMotion ? 0 : 0.26;
    flashT = 0.1;
    Sound.hit();
  }

  function finishRun() {
    state = ST.OVER;
    overT = 0;
    store.runs += 1;
    if (score > store.best) {
      store.best = score;
      newBest = true;
    }
    saveStore();
    Sound.over();
    if (newBest) {
      Sound.best();
      announce("New best — " + score);
    } else {
      announce("Game over — score " + score + ", best " + store.best);
    }
  }

  /* ================================================================
     Update
     ================================================================ */

  function updateCat(dt) {
    /* Exact closed-form integration of a = g − k·v (linear drag,
       terminal velocity = g/k). Closed form keeps trajectories
       equivalent across 30/60/120/144 Hz refresh rates. */
    var e = Math.exp(-DRAG_K * dt);
    cat.cy += MAX_FALL * dt + (cat.vy - MAX_FALL) * (1 - e) / DRAG_K;
    cat.vy = MAX_FALL + (cat.vy - MAX_FALL) * e;

    /* rotation follows velocity */
    var target;
    if (cat.vy < 0) {
      target = -0.3;
    } else {
      target = Math.min(1.25, 0.05 + (cat.vy / MAX_FALL) * 1.2);
    }
    var rate = target < cat.rot ? 10 : 6.5;
    cat.rot += (target - cat.rot) * Math.min(1, dt * rate);

    /* animation frames */
    if (cat.flapT > 0) {
      cat.flapT -= dt;
      cat.frame = "flap";
    } else {
      cat.frame = cat.vy > 380 ? "dive" : "glide";
    }
  }

  function updatePlaying(dt) {
    updateCat(dt);

    /* ceiling — soft, non-lethal */
    if (cat.cy < CEIL_Y) {
      cat.cy = CEIL_Y;
      cat.vy = Math.max(cat.vy, 0);
    }

    var dd = d();

    /* pipes movement + spawn + score */
    var i, p;
    for (i = 0; i < pipes.length; i += 1) {
      p = pipes[i];
      p.x -= dd.speed * dt;
    }

    var lastP = pipes[pipes.length - 1];
    if (!lastP || lastP.x <= W - dd.spacing) {
      var center = nextGapCenter(lastP ? lastP.center : 300, dd, Math.random);
      pipes.push({
        x: lastP ? lastP.x + dd.spacing : W + FIRST_PIPE_DELAY,
        center: center,
        gap: dd.gap,
        scored: false,
        seed: Math.floor(Math.random() * 1e9)
      });
    }

    /* cull */
    if (pipes.length && pipes[0].x + OBST_W < -12) { pipes.shift(); }

    /* scoring + collision */
    var cr = catRect(cat.cy);
    for (i = 0; i < pipes.length; i += 1) {
      p = pipes[i];
      if (!p.scored && p.x + OBST_W < cr.x) {
        p.scored = true;
        score += 1;
        scorePulseT = 0.28;
        Sound.score();
        announce("Score " + score);
      }
      var gapTop = p.center - p.gap / 2;
      var gapBot = p.center + p.gap / 2;
      if (aabb(cr.x, cr.y, cr.w, cr.h, p.x, 0, OBST_W, gapTop) ||
          aabb(cr.x, cr.y, cr.w, cr.h, p.x, gapBot, OBST_W, GROUND_Y - gapBot)) {
        die();
        break;
      }
    }

    /* ground */
    if (state === ST.PLAYING && cat.cy + CAT_HIT_H / 2 >= GROUND_Y) {
      die();
    }
  }

  function updateDying(dt) {
    dieT += dt;
    updateCat(dt);
    if (cat.cy + CAT_HIT_H / 2 >= GROUND_Y) {
      cat.cy = GROUND_Y - CAT_HIT_H / 2;
      cat.vy = 0;
      if (dieT > 0.18) { finishRun(); }
    }
  }

  function update(dt) {
    elapsed += dt;
    if (shakeT > 0) { shakeT -= dt; }
    if (flashT > 0) { flashT -= dt; }
    if (scorePulseT > 0) { scorePulseT -= dt; }

    if (state === ST.READY) {
      groundScroll += 60 * dt;
      /* gentle float */
      cat.cy = 330 + Math.sin(elapsed * 2.1) * 7;
      cat.rot = Math.sin(elapsed * 2.1 + 0.6) * 0.06;
      cat.animT += dt;
      /* occasional idle flap */
      if (cat.flapT > 0) {
        cat.flapT -= dt;
        cat.frame = "flap";
      } else {
        cat.frame = "glide";
        if (cat.animT > 1.7) {
          cat.animT = 0;
          cat.flapT = 0.16;
        }
      }
    } else if (state === ST.PLAYING) {
      groundScroll += d().speed * dt;
      updatePlaying(dt);
    } else if (state === ST.DYING) {
      updateDying(dt);
    } else if (state === ST.OVER) {
      overT += dt;
    }
  }

  /* ================================================================
     Draw
     ================================================================ */

  function drawBackground(g) {
    g.drawImage(skyCanvas, 0, 0);

    /* stars */
    var i, s;
    g.fillStyle = "#cfe6ef";
    for (i = 0; i < stars.length; i += 1) {
      s = stars[i];
      var tw = reduceMotion ? 1 : (0.72 + 0.28 * Math.sin(elapsed * s.sp + s.ph));
      g.globalAlpha = s.a * tw;
      g.fillRect(Math.round(s.x), Math.round(s.y), s.s, s.s);
    }
    g.globalAlpha = 1;

    /* far skyline — 1x drift */
    drawTile(g, FAR_TILE, (elapsed * 14) % FAR_TILE.width, GROUND_Y - 190);
    /* near rooftops */
    drawTile(g, NEAR_TILE, (elapsed * 34) % NEAR_TILE.width, GROUND_Y - 130);
  }

  function drawTile(g, tile, offX, y) {
    var x = -offX;
    while (x < W) {
      g.drawImage(tile, Math.round(x), y);
      x += tile.width;
    }
  }

  function drawGround(g, scroll) {
    var off = Math.round(scroll % GROUND_TILE.width);
    for (var x = -off; x < W; x += GROUND_TILE.width) {
      g.drawImage(GROUND_TILE, x, GROUND_Y);
    }
  }

  function drawPipe(g, p) {
    var gapTop = Math.round(p.center - p.gap / 2);
    var gapBot = Math.round(p.center + p.gap / 2);
    var x = Math.round(p.x);
    var rng = mulberry(p.seed);

    /* window layout per pipe (deterministic) */
    var wins = [];
    var wi;
    for (wi = 0; wi < 6; wi += 1) { wins.push(rng()); }

    /* --- top tower --- */
    if (gapTop > 14) {
      drawTower(g, x, 0, gapTop, true, wins, 0);
    }
    /* --- bottom tower --- */
    if (GROUND_Y - gapBot > 14) {
      drawTower(g, x, gapBot, GROUND_Y - gapBot, false, wins, 3);
    }
  }

  /* body from y0 height hgt; capOnTop for bottom towers */
  function drawTower(g, x, y0, hgt, hangsFromTop, wins, winOff) {
    var bx = x + 5;
    var bw = OBST_W - 10;
    var capH = 18;
    var bodyY, bodyH, capY;

    if (hangsFromTop) {
      bodyY = y0;
      bodyH = hgt - capH;
      capY = y0 + hgt - capH;
    } else {
      capY = y0;
      bodyY = y0 + capH;
      bodyH = hgt - capH;
    }

    /* body */
    g.fillStyle = "#0b0e16";
    g.fillRect(bx - 1, bodyY - 1, bw + 2, bodyH + 2);
    g.fillStyle = "#20283a";
    g.fillRect(bx, bodyY, bw, bodyH);
    g.fillStyle = "#2a3450";
    g.fillRect(bx, bodyY, 3, bodyH);
    g.fillStyle = "#151b2a";
    g.fillRect(bx + bw - 5, bodyY, 5, bodyH);

    /* panel seams */
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (var yy = bodyY + 12; yy < bodyY + bodyH - 6; yy += 18) {
      g.fillRect(bx, yy, bw, 2);
    }

    /* windows down the full height (bounded count) */
    var rows = Math.min(7, Math.max(1, Math.floor(bodyH / 52)));
    for (var i = 0; i < rows * 2; i += 1) {
      var on = wins[(i + winOff) % 6] > 0.45;
      var wx = bx + 8 + (i % 2) * 22;
      var wy = bodyY + 22 + Math.floor(i / 2) * 52;
      if (wy + 6 < bodyY + bodyH - 8) {
        g.fillStyle = on ? "rgba(127,212,224,0.55)" : "#10141d";
        g.fillRect(wx, wy, 5, 6);
      }
    }

    /* cap block */
    g.fillStyle = "#0b0e16";
    g.fillRect(x - 1, capY - 1, OBST_W + 2, capH + 2);
    g.fillStyle = "#1b2233";
    g.fillRect(x, capY, OBST_W, capH);
    g.fillStyle = "#2a3450";
    g.fillRect(x, capY, OBST_W, 2);
    g.fillStyle = "#0e1220";
    for (var v = 0; v < 4; v += 1) {
      g.fillRect(x + 7 + v * 12, capY + 7, 6, 6);
    }

    /* lime gap-edge marker — the readable "safe opening" edge */
    g.fillStyle = "rgba(201,244,77,0.9)";
    if (hangsFromTop) {
      g.fillRect(x + 3, capY + capH - 3, OBST_W - 6, 2);
    } else {
      g.fillRect(x + 3, capY + 1, OBST_W - 6, 2);
    }
  }

  function drawCat(g) {
    var spr = SPRITES[cat.frame] || SPRITES.glide;
    var q = Math.round(cat.rot / (Math.PI / 12)) * (Math.PI / 12);
    g.save();
    g.translate(CAT_X, Math.round(cat.cy));
    g.rotate(q);
    /* tiny squash / stretch — boost stretch, brief hit squash */
    var sx = 1, sy = 1;
    if (cat.flapT > 0) { sx = 1.06; sy = 0.93; }
    if (state === ST.DYING && dieT < 0.25) { sx = 0.92; sy = 0.92; }
    if (!reduceMotion && (sx !== 1 || sy !== 1)) { g.scale(sx, sy); }
    g.drawImage(spr, -20, -18);
    g.restore();

    if (DEBUG) {
      var cr = catRect(cat.cy);
      g.strokeStyle = "#ff5f52";
      g.lineWidth = 1;
      g.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w, cr.h);
    }
  }

  function drawHUD(g) {
    if (state === ST.READY) { return; }
    var s = scorePulseT > 0 && !reduceMotion ? 5 : 4;
    pixelText(g, String(score), W / 2, 40, s, "#f5f5f0", true);
  }

  function drawReadyOverlay(g) {
    g.textAlign = "center";

    g.fillStyle = "rgba(0,0,0,0.45)";
    g.font = "700 34px " + "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    g.fillText("奶牛猫会飞", W / 2 + 2, 172);
    g.fillStyle = "#f5f5f0";
    g.fillText("奶牛猫会飞", W / 2, 170);

    g.font = "700 12px " + "ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = "#c9f44d";
    g.fillText("C O W   C A T   C A N   F L Y", W / 2, 196);

    g.font = "11px " + "ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = "rgba(111,111,122,0.95)";
    g.fillText("它真的会飞吗？", W / 2, 220);

    var blink = reduceMotion ? 0.85 : 0.55 + 0.45 * Math.sin(elapsed * 4.2);
    g.globalAlpha = blink;
    g.font = "700 13px " + "ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = "#f5f5f0";
    g.fillText(isTouch ? "TAP TO FLY" : "TAP / SPACE TO FLY", W / 2, 468);
    g.globalAlpha = 1;

    if (store.best > 0) {
      g.font = "11px " + "ui-monospace, Menlo, Consolas, monospace";
      g.fillStyle = "rgba(201,244,77,0.8)";
      g.fillText("BEST " + store.best, W / 2, 496);
    }

    g.textAlign = "left";
  }

  function drawOverOverlay(g) {
    g.fillStyle = "rgba(6,8,14,0.72)";
    g.fillRect(0, 0, W, H);

    var cw = 248, ch = 190;
    var cx = Math.round((W - cw) / 2);
    var cy = Math.round((H - ch) / 2) - 20;

    g.fillStyle = "#0b0e16";
    g.fillRect(cx - 2, cy - 2, cw + 4, ch + 4);
    g.fillStyle = "#10141f";
    g.fillRect(cx, cy, cw, ch);
    g.fillStyle = "#2c3450";
    g.fillRect(cx, cy, cw, 2);
    g.fillRect(cx, cy + ch - 2, cw, 2);
    g.fillRect(cx, cy, 2, ch);
    g.fillRect(cx + cw - 2, cy, 2, ch);

    g.textAlign = "center";
    g.font = "700 17px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.fillStyle = "#c9f44d";
    g.fillText("RUN OVER", W / 2, cy + 38);

    g.font = "10px ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = "#6f6f7a";
    g.textAlign = "left";
    g.fillText("SCORE", cx + 34, cy + 78);
    g.fillText("BEST", cx + 34, cy + 112);

    pixelText(g, String(score), cx + cw - 60, cy + 66, 3, "#f5f5f0", false);
    pixelText(g, String(store.best), cx + cw - 60, cy + 100, 3, newBest ? "#c9f44d" : "#f5f5f0", false);

    if (newBest) {
      var blinkB = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(elapsed * 5);
      g.globalAlpha = blinkB;
      g.textAlign = "center";
      g.font = "700 11px ui-monospace, Menlo, Consolas, monospace";
      g.fillStyle = "#c9f44d";
      g.fillText("NEW BEST", W / 2, cy + 136);
      g.globalAlpha = 1;
    }

    if (overT >= RESTART_GUARD) {
      var blinkR = reduceMotion ? 0.85 : 0.55 + 0.45 * Math.sin(elapsed * 4.2);
      g.globalAlpha = blinkR;
      g.textAlign = "center";
      g.font = "700 12px ui-monospace, Menlo, Consolas, monospace";
      g.fillStyle = "#f5f5f0";
      g.fillText(isTouch ? "TAP TO RETRY" : "TAP / SPACE TO RETRY", W / 2, cy + ch - 24);
      g.globalAlpha = 1;
    }
    g.textAlign = "left";
  }

  function drawPausedOverlay(g) {
    g.fillStyle = "rgba(6,8,14,0.66)";
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.font = "700 20px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.fillStyle = "#f5f5f0";
    g.fillText("PAUSED", W / 2, H / 2 - 8);
    g.font = "11px ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = "#6f6f7a";
    g.fillText(isTouch ? "TAP TO RESUME" : "TAP / P TO RESUME", W / 2, H / 2 + 18);
    g.textAlign = "left";
  }

  function draw() {
    var g = ctx;
    g.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    g.imageSmoothingEnabled = false;

    var ox = 0, oy = 0;
    if (shakeT > 0) {
      var k = shakeT / 0.26;
      ox = (Math.random() * 2 - 1) * 3 * k;
      oy = (Math.random() * 2 - 1) * 3 * k;
      g.translate(ox, oy);
    }

    drawBackground(g);

    var i;
    for (i = 0; i < pipes.length; i += 1) {
      drawPipe(g, pipes[i]);
    }

    var scrollSpeed = state === ST.PLAYING ? d().speed : (state === ST.DYING ? 0 : 60);
    drawGround(g, groundScroll);

    drawCat(g);
    g.setTransform(viewScale, 0, 0, viewScale, 0, 0);

    drawHUD(g);

    if (state === ST.READY) { drawReadyOverlay(g); }
    if (state === ST.OVER) { drawOverOverlay(g); }
    if (paused) { drawPausedOverlay(g); }

    if (flashT > 0) {
      g.fillStyle = "rgba(245,245,240," + (flashT / 0.1 * 0.22).toFixed(3) + ")";
      g.fillRect(0, 0, W, H);
    }

    if (DEBUG) {
      g.strokeStyle = "rgba(255,95,82,0.8)";
      for (i = 0; i < pipes.length; i += 1) {
        var p = pipes[i];
        var gt = p.center - p.gap / 2;
        var gb = p.center + p.gap / 2;
        g.strokeRect(p.x + 0.5, 0.5, OBST_W, gt);
        g.strokeRect(p.x + 0.5, gb + 0.5, OBST_W, GROUND_Y - gb);
      }
    }
  }

  var groundScroll = 0;

  /* ================================================================
     Loop
     ================================================================ */

  var lastT = null;

  function frame(t) {
    var dt = 0;
    if (lastT !== null) {
      dt = Math.min((t - lastT) / 1000, DT_CLAMP);
    }
    lastT = t;

    if (!paused) {
      update(dt);
    }
    draw();
    window.requestAnimationFrame(frame);
  }

  /* ================================================================
     Input
     ================================================================ */

  function primaryAction() {
    Sound.unlock();
    if (paused) {
      resumeGame();
      return;
    }
    if (state === ST.READY) {
      startRun();
      return;
    }
    if (state === ST.PLAYING) {
      flap();
      Sound.boost();
      return;
    }
    if (state === ST.OVER && overT >= RESTART_GUARD) {
      resetRun();
      state = ST.READY;
      announce("Ready — tap to fly");
    }
  }

  function pauseGame() {
    if (state !== ST.PLAYING || paused) { return; }
    paused = true;
    setPauseUI(true);
    announce("Paused");
  }

  function resumeGame() {
    if (!paused) { return; }
    paused = false;
    lastT = null; /* avoid a giant dt jump on resume */
    setPauseUI(false);
    announce("Resumed");
  }

  function setPauseUI(on) {
    if (!pauseBtn) { return; }
    pauseBtn.setAttribute("aria-pressed", on ? "true" : "false");
    pauseBtn.textContent = on ? "Resume" : "Pause";
  }

  if (stage) {
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) {
        return; /* chips handle themselves; never flap from a chip tap */
      }
      e.preventDefault();
      primaryAction();
    }, { passive: false });
    /* block iOS double-tap zoom / long-press menu inside the stage */
    stage.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
    stage.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    stage.tabIndex = 0;
  }

  doc.addEventListener("keydown", function (e) {
    if (e.target && e.target.closest &&
        e.target.closest("button, input, select, textarea, a")) {
      return; /* let focused controls behave normally */
    }
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      if (e.repeat) { return; }
      e.preventDefault();
      primaryAction();
    } else if (e.code === "KeyP" || e.code === "Escape") {
      if (paused) { resumeGame(); } else { pauseGame(); }
    }
  });

  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      if (paused) { resumeGame(); } else { pauseGame(); }
    });
  }

  if (soundBtn) {
    function syncSoundBtn() {
      soundBtn.setAttribute("aria-pressed", Sound.isEnabled() ? "true" : "false");
      soundBtn.textContent = "Sound";
    }
    syncSoundBtn();
    soundBtn.addEventListener("click", function () {
      Sound.setEnabled(!Sound.isEnabled());
      syncSoundBtn();
      if (Sound.isEnabled()) { Sound.score(); }
    });
  }

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) {
      if (state === ST.PLAYING && !paused) { pauseGame(); }
    }
  });

  window.addEventListener("blur", function () {
    if (state === ST.PLAYING && !paused) { pauseGame(); }
  });

  /* ================================================================
     Resize / DPR
     ================================================================ */

  function fit() {
    var rect = stage.getBoundingClientRect();
    if (rect.width < 2) { return; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var bw = Math.round(rect.width * dpr);
    var bh = Math.round(rect.height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    viewScale = bw / W;
  }

  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(stage);
  }
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);

  /* ================================================================
     Boot
     ================================================================ */

  if (hintEl) {
    hintEl.textContent = isTouch
      ? "Tap — fly · Pause button"
      : "Tap / Space / W — fly · P — pause";
  }

  buildSky();
  buildTiles();
  buildStars();
  fit();
  window.requestAnimationFrame(frame);

  /* test hooks (harmless in production) */
  window.__CC_TEST = CORE;
  window.__CC_SPRITES = SPRITES;
  window.__CC_STATE = function () {
    return {
      state: state, paused: paused, score: score, best: store.best,
      cat: { cy: cat.cy, vy: cat.vy },
      pipes: pipes.map(function (p) {
        return { x: p.x, center: p.center, gap: p.gap, scored: p.scored };
      })
    };
  };
})();
