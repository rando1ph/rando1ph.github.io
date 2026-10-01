/* ------------------------------------------------------------------
   Core Shift — renderer
   Canvas 2D. Industrial spacecraft maintenance bay: a continuous deck,
   connected bulkheads, cores that read as heavy equipment, docks that
   read as embedded sockets, and cyan reserved for live power.

   The renderer is deliberately dumb. It holds no game state: main.js
   hands it a plain scene description each frame and it draws it.

   Grid alignment is exact by construction. The cell size is an integer
   number of *device* pixels, and every entity's centre is derived from
   one shared function, so a core, a dock and the robot standing on the
   same cell resolve to the same pixel.
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var C = {
    hull: "#0b0d10",
    deckTop: "#282f39",
    deckBottom: "#1d2229",
    seam: "rgba(236,240,246,0.05)",
    plateLight: "rgba(255,255,255,0.022)",
    plateDark: "rgba(0,0,0,0.07)",
    mark: "rgba(236,240,246,0.075)",
    wall: "#454e5b",
    wallDeep: "#242a33",
    wallEdgeLight: "rgba(255,255,255,0.34)",
    wallEdgeMid: "rgba(255,255,255,0.16)",
    wallEdgeDark: "rgba(0,0,0,0.66)",
    wallEdgeDarkMid: "rgba(0,0,0,0.44)",
    rivet: "rgba(255,255,255,0.12)",
    shadow: "rgba(0,0,0,0.66)",
    steel: "#4a525f",
    steelLight: "#6b7583",
    steelDark: "#171a1f",
    coreTop: "#414a57",
    coreBody: "#262c34",
    coreLip: "rgba(255,255,255,0.22)",
    amber: "#d2913a",
    amberDim: "rgba(210,145,58,0.30)",
    cyan: "#8fe6f2",
    cyanBright: "#dcf8ff",
    cyanDim: "rgba(143,230,242,0.22)",
    shell: "#d9dce1",
    shellShade: "#9aa0aa",
    face: "#131619",
    visor: "#7fdcea",
    outline: "rgba(5,7,10,0.55)"
  };

  var LIGHT_BASE = 0.46; /* how dark the bay is with every core offline */
  var DIM_MAX = 0.46;

  /* deterministic per-cell hash so deck detail never shimmers */
  function hash(x, y) {
    var n = x * 374761393 + y * 668265263;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.cell = 0;
    this.cols = 0;
    this.rows = 0;
    this.level = null;
    this.conduits = [];
    this.dockList = [];
    this.reduced = false;
    this.deckLayer = null;
    this.wallLayer = null;
    this.shellLayer = null;
  }

  Renderer.prototype.setReducedMotion = function (reduced) {
    this.reduced = !!reduced;
  };

  /* ------------------------------------------------------------------
     Layout
     ------------------------------------------------------------------ */

  /**
   * Fit the board into `maxW` x `maxH` CSS pixels. Returns the CSS size
   * the canvas occupies, so the caller can reserve the right space.
   */
  Renderer.prototype.fit = function (maxW, maxH, dpr) {
    if (!this.level) return { width: 0, height: 0 };
    var w = this.level.w;
    var h = this.level.h;
    var css = Math.min(maxW / w, maxH / h);
    var device = Math.max(12, Math.floor(css * dpr));
    if (device !== this.cell || this.dpr !== dpr) {
      this.cell = device;
      this.dpr = dpr;
      this.applySize();
      this.buildStaticLayers();
    }
    return { width: (this.cell * w) / this.dpr, height: (this.cell * h) / this.dpr };
  };

  Renderer.prototype.applySize = function () {
    var w = this.level.w * this.cell;
    var h = this.level.h * this.cell;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w / this.dpr + "px";
    this.canvas.style.height = h / this.dpr + "px";
  };

  Renderer.prototype.setLevel = function (level) {
    this.level = level;
    this.cols = level.w;
    this.rows = level.h;
    this.buildConduits();
    this.buildDocks();
    this.applySize();
    this.buildStaticLayers();
  };

  /** Device-pixel centre of a cell, from a position in cell units. */
  Renderer.prototype.px = function (units) {
    return Math.round(units * this.cell);
  };

  Renderer.prototype.cellX = function (col) {
    return this.px(col + 0.5);
  };

  Renderer.prototype.cellY = function (row) {
    return this.px(row + 0.5);
  };

  /* ------------------------------------------------------------------
     Level-derived decoration
     ------------------------------------------------------------------ */

  /** Is this cell part of the hull mass? Outside the level counts as solid. */
  Renderer.prototype.isWall = function (col, row) {
    var l = this.level;
    if (col < 0 || row < 0 || col >= l.w || row >= l.h) return true;
    return l.walls[row * l.w + col] === 1;
  };

  /**
   * Is this cell a wall we should put an outer edge on? Here the space
   * outside the level counts as open, so the level's own silhouette gets
   * a lit top edge instead of running off the canvas.
   */
  Renderer.prototype.hasEdge = function (col, row) {
    var l = this.level;
    if (col < 0 || row < 0 || col >= l.w || row >= l.h) return false;
    return l.walls[row * l.w + col] === 1;
  };

  /**
   * One conduit segment per wall face that looks onto the deck, ordered
   * around the chamber so power can spread along the hull as cores dock.
   */
  Renderer.prototype.buildConduits = function () {
    var l = this.level;
    var segs = [];
    var fx = 0;
    var fy = 0;
    var n = 0;
    var col, row;

    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (!l.floor[row * l.w + col]) continue;
        fx += col + 0.5;
        fy += row + 0.5;
        n += 1;
      }
    }
    var cx = n ? fx / n : l.w / 2;
    var cy = n ? fy / n : l.h / 2;

    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (!this.isWall(col, row)) continue;
        /* one segment per wall face that looks onto the deck; `side` says
           which edge of the cell the deck is on */
        if (!this.isWall(col, row - 1)) segs.push({ col: col, row: row, axis: "h", side: 1 });
        if (!this.isWall(col, row + 1)) segs.push({ col: col, row: row, axis: "h", side: -1 });
        if (!this.isWall(col - 1, row)) segs.push({ col: col, row: row, axis: "v", side: 1 });
        if (!this.isWall(col + 1, row)) segs.push({ col: col, row: row, axis: "v", side: -1 });
      }
    }

    segs.forEach(function (s) {
      s.angle = Math.atan2(s.row + 0.5 - cy, s.col + 0.5 - cx);
    });
    segs.sort(function (a, b) {
      return a.angle - b.angle;
    });
    segs.forEach(function (s, i) {
      s.index = i;
      s.junction = i % 5 === 2;
    });
    this.conduits = segs;
  };

  Renderer.prototype.buildDocks = function () {
    var l = this.level;
    var list = [];
    for (var i = 0; i < l.goals.length; i += 1) {
      if (l.goals[i]) list.push({ col: i % l.w, row: Math.floor(i / l.w) });
    }
    this.dockList = list;
  };

  /* ------------------------------------------------------------------
     Static layers (deck + bulkheads) — rebuilt only on resize / level
     ------------------------------------------------------------------ */

  Renderer.prototype.layer = function (w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };

  Renderer.prototype.buildStaticLayers = function () {
    var l = this.level;
    if (!l || !this.cell) return;
    var w = l.w * this.cell;
    var h = l.h * this.cell;
    this._hatch = null;
    this.deckLayer = this.layer(w, h);
    this.wallLayer = this.layer(w, h);
    this.shellLayer = this.layer(w, h);
    this.paintDeck(this.deckLayer.getContext("2d"), w, h);
    this.paintWalls(this.wallLayer.getContext("2d"), w, h);
    this.paintShell(this.shellLayer.getContext("2d"), w, h);
  };

  Renderer.prototype.paintDeck = function (ctx, w, h) {
    var l = this.level;
    var cell = this.cell;
    var col, row;

    ctx.fillStyle = C.deckBottom;
    ctx.fillRect(0, 0, w, h);

    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.deckTop);
    g.addColorStop(0.55, "#171b21");
    g.addColorStop(1, C.deckBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* large deck plates: four cells across, so the deck reads as a few
       big panels rather than one tile per logical cell */
    var plate = cell * 4;
    for (row = 0; row * plate < h; row += 1) {
      for (col = 0; col * plate < w; col += 1) {
        var x = col * plate;
        var y = row * plate;
        var pw = Math.min(plate, w - x);
        var ph = Math.min(plate, h - y);
        ctx.fillStyle = (col + row) % 2 === 0 ? C.plateLight : C.plateDark;
        ctx.fillRect(x, y, pw, ph);
      }
    }

    /* faint panel seams on the logical grid — a cue, not a checkerboard */
    ctx.strokeStyle = C.seam;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (col = 1; col < l.w; col += 1) {
      ctx.moveTo(col * cell + 0.5, 0);
      ctx.lineTo(col * cell + 0.5, h);
    }
    for (row = 1; row < l.h; row += 1) {
      ctx.moveTo(0, row * cell + 0.5);
      ctx.lineTo(w, row * cell + 0.5);
    }
    ctx.stroke();

    /* sparse registration marks + deck wear, deterministic */
    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (!l.floor[row * l.w + col]) continue;
        var r = hash(col, row);
        var cx = col * cell + cell / 2;
        var cy = row * cell + cell / 2;
        if ((col * 3 + row * 5) % 7 === 0 && r > 0.35) {
          ctx.strokeStyle = C.mark;
          ctx.lineWidth = 1;
          var m = Math.max(2, Math.round(cell * 0.075));
          ctx.beginPath();
          ctx.moveTo(Math.round(cx) - m + 0.5, Math.round(cy) + 0.5);
          ctx.lineTo(Math.round(cx) + m + 0.5, Math.round(cy) + 0.5);
          ctx.moveTo(Math.round(cx) + 0.5, Math.round(cy) - m + 0.5);
          ctx.lineTo(Math.round(cx) + 0.5, Math.round(cy) + m + 0.5);
          ctx.stroke();
        } else if (r > 0.86) {
          ctx.fillStyle = "rgba(0,0,0,0.10)";
          ctx.beginPath();
          ctx.arc(cx, cy + cell * 0.16, Math.max(1, cell * 0.05), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* soft overhead wash from the top of the chamber */
    var wash = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    wash.addColorStop(0, "rgba(190,214,232,0.045)");
    wash.addColorStop(1, "rgba(190,214,232,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h * 0.6);
  };

  Renderer.prototype.paintWalls = function (ctx, w, h) {
    var l = this.level;
    var cell = this.cell;
    var col, row;
    var i;

    /* 1. the mass itself: flat fill, no per-cell rounding, so neighbours
       merge into one continuous bulkhead rather than a tray of keys */
    ctx.fillStyle = C.wall;
    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (this.isWall(col, row)) ctx.fillRect(col * cell, row * cell, cell, cell);
      }
    }

    /* 2. depth + material, clipped to the mass by source-atop */
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,0.12)");
    g.addColorStop(0.35, "rgba(255,255,255,0.02)");
    g.addColorStop(1, "rgba(0,0,0,0.36)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = this.hatch(ctx);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    /* 3. contact shadow onto the deck below each wall face */
    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (!this.isWall(col, row) || this.isWall(col, row + 1)) continue;
        var sx = col * cell;
        var sy = (row + 1) * cell;
        var sh = ctx.createLinearGradient(0, sy, 0, sy + cell * 0.46);
        sh.addColorStop(0, C.shadow);
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(sx, sy, cell, cell * 0.46);
      }
    }

    /* 4. panel breaks inside long runs — weak, so the mass stays continuous */
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (!this.isWall(col, row)) continue;
        if (this.isWall(col - 1, row) && this.isWall(col + 1, row) && (col + row * 3) % 7 === 0) {
          ctx.moveTo(col * cell + 0.5, row * cell + 2);
          ctx.lineTo(col * cell + 0.5, (row + 1) * cell - 2);
        }
        if (this.isWall(col, row - 1) && this.isWall(col, row + 1) && (row + col * 3) % 7 === 0) {
          ctx.moveTo(col * cell + 2, row * cell + 0.5);
          ctx.lineTo((col + 1) * cell - 2, row * cell + 0.5);
        }
      }
    }
    ctx.stroke();

    /* 5. outer contour: light where the hull catches the overhead light,
       dark where it turns away. This is what makes the mass read as one
       raised structure instead of a flat field. */
    var bevel = Math.max(1, Math.round(cell * 0.10));
    var seamLine = Math.max(1, Math.round(cell * 0.03));
    for (row = 0; row < l.h; row += 1) {
      for (col = 0; col < l.w; col += 1) {
        if (!this.hasEdge(col, row)) continue;
        var x = col * cell;
        var y = row * cell;
        if (!this.hasEdge(col, row - 1)) {
          /* lit chamfer, then a seam: the panel face sits inside the lip */
          ctx.fillStyle = C.wallEdgeLight;
          ctx.fillRect(x, y, cell, bevel);
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.fillRect(x, y + bevel, cell, seamLine);
        }
        if (!this.hasEdge(col - 1, row)) {
          ctx.fillStyle = C.wallEdgeMid;
          ctx.fillRect(x, y, bevel, cell);
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(x + bevel, y, seamLine, cell);
        }
        if (!this.hasEdge(col, row + 1)) {
          ctx.fillStyle = C.wallEdgeDark;
          ctx.fillRect(x, y + cell - bevel, cell, bevel);
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(x, y + cell - bevel - seamLine, cell, seamLine);
        }
        if (!this.hasEdge(col + 1, row)) {
          ctx.fillStyle = C.wallEdgeDarkMid;
          ctx.fillRect(x + cell - bevel, y, bevel, cell);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fillRect(x + cell - bevel - seamLine, y, seamLine, cell);
        }
      }
    }

    /* 6. rivets set back from the contour, so they read as structure rather
       than trim on the light channel */
    var spacing = Math.max(8, Math.round(cell * 0.5));
    for (i = 0; i < this.conduits.length; i += 1) {
      var s = this.conduits[i];
      var x2 = s.col * cell;
      var y2 = s.row * cell;
      var inset = Math.max(3, Math.round(cell * 0.44));
      var px;
      var py;
      if (s.axis === "h") {
        py = s.side > 0 ? y2 + inset : y2 + cell - inset;
        for (px = x2 + spacing / 2; px < x2 + cell; px += spacing) {
          ctx.fillStyle = C.rivet;
          ctx.beginPath();
          ctx.arc(Math.round(px), Math.round(py), Math.max(1, cell * 0.026), 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        px = s.side > 0 ? x2 + inset : x2 + cell - inset;
        for (py = y2 + spacing / 2; py < y2 + cell; py += spacing) {
          ctx.fillStyle = C.rivet;
          ctx.beginPath();
          ctx.arc(Math.round(px), Math.round(py), Math.max(1, cell * 0.026), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };

  /** Machined-metal hatching, built once and reused as a fill pattern. */
  Renderer.prototype.hatch = function (ctx) {
    if (this._hatch) return this._hatch;
    var tile = this.layer(7, 7);
    var tctx = tile.getContext("2d");
    tctx.strokeStyle = "rgba(0,0,0,0.35)";
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(-1, 8);
    tctx.lineTo(8, -1);
    tctx.moveTo(6, 8);
    tctx.lineTo(8, 6);
    tctx.moveTo(-1, 1);
    tctx.lineTo(1, -1);
    tctx.stroke();
    this._hatch = ctx.createPattern(tile, "repeat");
    return this._hatch;
  };

  /** Unlit conduit channels — the groove is always there, the light is not. */
  Renderer.prototype.paintShell = function (ctx, w, h) {
    var cell = this.cell;
    var thickness = Math.max(2, Math.round(cell * 0.13));
    var inset = Math.max(1, Math.round(cell * 0.20));
    for (var i = 0; i < this.conduits.length; i += 1) {
      var s = this.conduits[i];
      var x = s.col * cell;
      var y = s.row * cell;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      if (s.axis === "h") {
        var cy = s.side > 0 ? y + inset : y + cell - inset - thickness;
        ctx.fillRect(x + 1, cy, cell - 2, thickness);
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(x + 1, cy, cell - 2, 1);
      } else {
        var cxx = s.side > 0 ? x + inset : x + cell - inset - thickness;
        ctx.fillRect(cxx, y + 1, thickness, cell - 2);
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(cxx, y + 1, 1, cell - 2);
      }
    }
  };

  /* ------------------------------------------------------------------
     Dynamic layers
     ------------------------------------------------------------------ */

  Renderer.prototype.drawConduits = function (ctx, power, pulse) {
    var cell = this.cell;
    var total = this.conduits.length;
    if (!total) return;
    var thickness = Math.max(2, Math.round(cell * 0.13));
    var inset = Math.max(1, Math.round(cell * 0.20));
    var lit = power * total;

    for (var i = 0; i < total; i += 1) {
      var s = this.conduits[i];
      var amount = Math.max(0, Math.min(1, lit - i));
      if (amount <= 0.001) continue;
      var x = s.col * cell;
      var y = s.row * cell;
      var cx;
      var cy;
      var cw;
      var ch;
      if (s.axis === "h") {
        cy = s.side > 0 ? y + inset : y + cell - inset - thickness;
        cx = x + 1;
        cw = cell - 2;
        ch = thickness;
      } else {
        cx = s.side > 0 ? x + inset : x + cell - inset - thickness;
        cy = y + 1;
        cw = thickness;
        ch = cell - 2;
      }

      var bloom = 0.30 + 0.5 * amount + pulse * 0.2 * amount;
      var grd = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
      grd.addColorStop(0, "rgba(143,230,242," + (0.30 * amount).toFixed(3) + ")");
      grd.addColorStop(0.5, "rgba(220,248,255," + (0.82 * amount).toFixed(3) + ")");
      grd.addColorStop(1, "rgba(143,230,242," + (0.34 * amount).toFixed(3) + ")");
      ctx.fillStyle = grd;
      ctx.fillRect(cx, cy, cw, ch);

      /* the light spills onto the deck a little, but never floods it: the
         channel should make the hull structure clearer, not hide it */
      ctx.save();
      ctx.globalAlpha = bloom * 0.11;
      var rg = ctx.createRadialGradient(
        cx + cw / 2,
        cy + ch / 2,
        0,
        cx + cw / 2,
        cy + ch / 2,
        cell * 0.42
      );
      rg.addColorStop(0, "rgba(143,230,242,0.85)");
      rg.addColorStop(1, "rgba(143,230,242,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(cx + cw / 2 - cell * 0.42, cy + ch / 2 - cell * 0.42, cell * 0.84, cell * 0.84);
      ctx.restore();

      if (s.junction) {
        ctx.fillStyle = "rgba(220,248,255," + (0.45 * amount).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(Math.round(cx + cw / 2), Math.round(cy + ch / 2), Math.max(1.3, cell * 0.042), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  Renderer.prototype.drawDocks = function (ctx, dockedMask) {
    var cell = this.cell;
    for (var i = 0; i < this.dockList.length; i += 1) {
      var d = this.dockList[i];
      var live = dockedMask[d.row * this.level.w + d.col] === 1;
      this.drawDock(ctx, this.cellX(d.col), this.cellY(d.row), cell, live, i);
    }
  };

  Renderer.prototype.drawDock = function (ctx, cx, cy, cell, live, seed) {
    var r = cell * 0.35;
    var inner = cell * 0.21;

    /* recessed well cut into the deck */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fill();
    ctx.restore();

    /* the well's own lip: dark where the deck turns in, lit on the far side */
    ctx.save();
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.12, Math.PI * 1.12);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 1.12, Math.PI * 2.12);
    ctx.stroke();
    ctx.restore();

    /* docking bracket: four embedded contacts on the diagonals */
    for (var k = 0; k < 4; k += 1) {
      var a = Math.PI / 4 + (k * Math.PI) / 2;
      var px = cx + Math.cos(a) * r * 0.72;
      var py = cy + Math.sin(a) * r * 0.72;
      var s = Math.max(2, cell * 0.085);
      ctx.fillStyle = live ? "rgba(190,240,250,0.6)" : C.steel;
      roundRect(ctx, Math.round(px - s / 2), Math.round(py - s / 2), Math.round(s), Math.round(s), 1);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* inner ring: the socket collar */
    ctx.lineWidth = Math.max(1, cell * 0.032);
    ctx.strokeStyle = live ? "rgba(143,230,242,0.9)" : "rgba(126,138,155,0.5)";
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.stroke();

    /* standby indicator — dim amber until the core lands */
    if (live) {
      var bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.38);
      bloom.addColorStop(0, "rgba(200,245,255,0.6)");
      bloom.addColorStop(1, "rgba(143,230,242,0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
    } else {
      var t = 0.55 + 0.45 * Math.sin(seed * 1.7 + this.clock * 0.0016);
      ctx.fillStyle = "rgba(226,158,64," + (0.28 + 0.26 * t).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, cell * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  Renderer.prototype.drawCore = function (ctx, cx, cy, cell, live, lifting) {
    var size = cell * 0.74;
    var half = size / 2;
    var x = Math.round(cx - half);
    var y = Math.round(cy - half) - (lifting || 0);

    /* grounded contact shadow */
    ctx.save();
    ctx.globalAlpha = 0.55;
    var sh = ctx.createRadialGradient(cx, cy + half * 0.92, 0, cx, cy + half * 0.92, half * 1.05);
    sh.addColorStop(0, "rgba(0,0,0,0.75)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(cx - half * 1.1, cy + half * 0.3, half * 2.2, half * 1.2);
    ctx.restore();

    /* casing */
    var radius = Math.max(2, cell * 0.10);
    var body = ctx.createLinearGradient(x, y, x, y + size);
    body.addColorStop(0, C.coreTop);
    body.addColorStop(0.5, C.coreBody);
    body.addColorStop(1, "#161a20");
    ctx.fillStyle = body;
    roundRect(ctx, x, y, Math.round(size), Math.round(size), radius);
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = Math.max(1, cell * 0.02);
    ctx.stroke();

    /* restrained bevel */
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.strokeStyle = C.coreLip;
    ctx.beginPath();
    ctx.moveTo(x + radius, y + ctx.lineWidth / 2);
    ctx.lineTo(x + size - radius, y + ctx.lineWidth / 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.moveTo(x + radius, y + size - ctx.lineWidth / 2);
    ctx.lineTo(x + size - radius, y + size - ctx.lineWidth / 2);
    ctx.stroke();

    /* casing seam + bolts: it should read as machined equipment */
    var seamY = Math.round(y + size * 0.5);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(x + Math.round(cell * 0.09), seamY, Math.round(size - cell * 0.18), Math.max(1, cell * 0.028));
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fillRect(x + Math.round(cell * 0.09), seamY + Math.max(1, cell * 0.028), Math.round(size - cell * 0.18), 1);

    var bolt = Math.max(1, cell * 0.032);
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.beginPath();
    ctx.arc(x + size * 0.16, seamY + cell * 0.11, bolt, 0, Math.PI * 2);
    ctx.arc(x + size * 0.84, seamY + cell * 0.11, bolt, 0, Math.PI * 2);
    ctx.fill();

    /* the one luminous detail: a narrow core window */
    var slotW = Math.max(3, cell * 0.16);
    var slotH = Math.max(4, cell * 0.30);
    var slotX = Math.round(cx - slotW / 2);
    var slotY = Math.round(cy - slotH / 2) - (lifting || 0);
    ctx.fillStyle = "#0d0f12";
    roundRect(ctx, slotX, slotY, Math.round(slotW), Math.round(slotH), slotW / 2);
    ctx.fill();

    var innerW = Math.max(1, slotW - Math.max(2, cell * 0.06));
    var innerH = Math.max(2, slotH - Math.max(2, cell * 0.08));
    var ix = Math.round(cx - innerW / 2);
    var iy = Math.round(cy - innerH / 2) - (lifting || 0);
    var slot = ctx.createLinearGradient(0, iy, 0, iy + innerH);
    if (live) {
      slot.addColorStop(0, C.cyanBright);
      slot.addColorStop(1, "#63c6d8");
    } else {
      slot.addColorStop(0, "rgba(210,145,58,0.62)");
      slot.addColorStop(1, "rgba(210,145,58,0.20)");
    }
    ctx.fillStyle = slot;
    roundRect(ctx, ix, iy, Math.round(innerW), Math.round(innerH), innerW / 2);
    ctx.fill();

    if (live) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
      glow.addColorStop(0, "rgba(143,230,242,0.7)");
      glow.addColorStop(1, "rgba(143,230,242,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - cell * 0.5, cy - cell * 0.5, cell, cell);
      ctx.restore();
    }
  };

  Renderer.prototype.drawPlayer = function (ctx, cx, cy, cell, facing) {
    var size = cell * 0.60;
    var half = size / 2;
    var x = Math.round(cx - half);
    var y = Math.round(cy - half);

    ctx.save();
    ctx.globalAlpha = 0.5;
    var sh = ctx.createRadialGradient(cx, cy + half * 0.95, 0, cx, cy + half * 0.95, half);
    sh.addColorStop(0, "rgba(0,0,0,0.7)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(cx - half, cy + half * 0.25, size, half);
    ctx.restore();

    /* shell */
    var radius = Math.max(2, cell * 0.10);
    var body = ctx.createLinearGradient(x, y, x + size, y + size);
    body.addColorStop(0, "#eef0f3");
    body.addColorStop(0.5, C.shell);
    body.addColorStop(1, C.shellShade);
    ctx.fillStyle = body;
    roundRect(ctx, x, y, Math.round(size), Math.round(size), radius);
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = Math.max(1, cell * 0.02);
    ctx.stroke();

    /* faceplate */
    var inset = Math.max(1, Math.round(cell * 0.07));
    var fp = size - inset * 2;
    ctx.fillStyle = C.face;
    roundRect(ctx, x + inset, y + inset, Math.round(fp), Math.round(fp * 0.52), Math.max(1, radius - 1));
    ctx.fill();

    /* visor */
    var vw = Math.max(3, fp * 0.5);
    ctx.fillStyle = C.visor;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(Math.round(cx - vw / 2), Math.round(y + inset + fp * 0.2), Math.round(vw), Math.max(1, cell * 0.045));
    ctx.globalAlpha = 1;

    /* status LED */
    ctx.fillStyle = "#a8f0fb";
    ctx.beginPath();
    ctx.arc(Math.round(x + size * 0.78), Math.round(y + size * 0.82), Math.max(1, cell * 0.035), 0, Math.PI * 2);
    ctx.fill();

    /* tread marks */
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fillRect(Math.round(x + size * 0.16), Math.round(y + size - inset), Math.round(size * 0.24), Math.max(1, cell * 0.03));
    ctx.fillRect(Math.round(x + size * 0.60), Math.round(y + size - inset), Math.round(size * 0.24), Math.max(1, cell * 0.03));

    /* facing nub, so the robot reads as directed */
    if (facing >= 0) {
      var dx = [0, 1, 0, -1][facing];
      var dy = [-1, 0, 1, 0][facing];
      var nx = cx + dx * (half + cell * 0.055);
      var ny = cy + dy * (half + cell * 0.055);
      ctx.fillStyle = "rgba(190,240,250,0.8)";
      ctx.beginPath();
      ctx.arc(Math.round(nx), Math.round(ny), Math.max(1, cell * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /** Selection brackets + legal push destinations. Cyan = information. */
  Renderer.prototype.drawSelection = function (ctx, boxCell, options, cell) {
    var cx = this.cellX(boxCell % this.level.w);
    var cy = this.cellY(Math.floor(boxCell / this.level.w));
    var r = cell * 0.44;
    var arm = Math.max(3, cell * 0.14);
    var pulse = 0.55 + 0.45 * Math.sin(this.clock * 0.004);

    ctx.save();
    ctx.strokeStyle = "rgba(143,230,242," + (0.35 + 0.35 * pulse).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, cell * 0.035);
    var corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ];
    for (var i = 0; i < corners.length; i += 1) {
      var sx = cx + corners[i][0] * r;
      var sy = cy + corners[i][1] * r;
      ctx.beginPath();
      ctx.moveTo(sx - corners[i][0] * arm, sy);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx, sy - corners[i][1] * arm);
      ctx.stroke();
    }
    ctx.restore();

    for (var k = 0; k < options.length; k += 1) {
      var o = options[k];
      var tx = this.cellX(o.to % this.level.w);
      var ty = this.cellY(Math.floor(o.to / this.level.w));

      /* the destination, with a chevron pointing the way */
      ctx.save();
      ctx.fillStyle = "rgba(143,230,242," + (0.10 + 0.10 * pulse).toFixed(3) + ")";
      roundRect(ctx, tx - cell * 0.3, ty - cell * 0.3, cell * 0.6, cell * 0.6, cell * 0.12);
      ctx.fill();
      ctx.strokeStyle = "rgba(200,245,255," + (0.5 + 0.35 * pulse).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1, cell * 0.035);
      var ax = [0, 1, 0, -1][o.dir];
      var ay = [-1, 0, 1, 0][o.dir];
      var len = cell * 0.15;
      ctx.beginPath();
      ctx.moveTo(tx - ax * len - ay * len, ty - ay * len - ax * len);
      ctx.lineTo(tx + ax * len * 0.5, ty + ay * len * 0.5);
      ctx.lineTo(tx - ax * len + ay * len, ty - ay * len + ax * len);
      ctx.stroke();
      ctx.restore();
    }
  };

  Renderer.prototype.drawPath = function (ctx, cells, cell) {
    ctx.save();
    ctx.fillStyle = "rgba(143,230,242,0.20)";
    for (var i = 0; i < cells.length; i += 1) {
      var cx = this.cellX(cells[i] % this.level.w);
      var cy = this.cellY(Math.floor(cells[i] / this.level.w));
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1.5, cell * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------
     Frame
     ------------------------------------------------------------------ */

  /**
   * scene = {
   *   level, playerX, playerY,          // positions in cell units
   *   boxes: [{x, y, live}],            // aligned with state.boxes
   *   facing, selected, options, path,
   *   power, light,                     // 0..1
   *   sequence: null | { t, col, row }, // completion sequence progress
   *   blocked: null | { x, y, t }       // a refused push, briefly
   * }
   */
  Renderer.prototype.draw = function (scene, now) {
    var ctx = this.ctx;
    var cell = this.cell;
    var l = this.level;
    if (!l) return;
    this.clock = now;
    this.facing = scene.facing;

    var w = this.canvas.width;
    var h = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.hull;
    ctx.fillRect(0, 0, w, h);

    ctx.drawImage(this.deckLayer, 0, 0);
    ctx.drawImage(this.wallLayer, 0, 0);
    ctx.drawImage(this.shellLayer, 0, 0);

    /* the bay is dark until the cores come online — this is what makes
       restoring power feel like something */
    var dim = (1 - scene.light) * DIM_MAX;
    if (dim > 0.004) {
      ctx.fillStyle = "rgba(5,7,10," + dim.toFixed(3) + ")";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(150,96,28," + (dim * 0.12).toFixed(3) + ")";
      ctx.fillRect(0, 0, w, h);
    }

    var pulse = 0.5 + 0.5 * Math.sin(now * 0.0022);
    this.drawConduits(ctx, scene.power, pulse);
    this.drawDocks(ctx, scene.dockedMask);

    if (scene.path && scene.path.length) this.drawPath(ctx, scene.path, cell);
    if (scene.selected !== null && scene.selected !== undefined) {
      this.drawSelection(ctx, scene.selected, scene.options || [], cell);
    }

    for (var i = 0; i < scene.boxes.length; i += 1) {
      var bx = scene.boxes[i];
      this.drawCore(
        ctx,
        this.px(bx.x),
        this.px(bx.y),
        cell,
        bx.live,
        bx.lift || 0
      );
    }

    this.drawPlayer(ctx, this.px(scene.playerX), this.px(scene.playerY), cell, scene.facing);

    if (scene.blocked) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - scene.blocked.t) * 0.6;
      ctx.strokeStyle = "rgba(210,145,58,0.8)";
      ctx.lineWidth = Math.max(1, cell * 0.04);
      ctx.beginPath();
      ctx.arc(this.px(scene.blocked.x), this.px(scene.blocked.y), cell * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (scene.sequence) this.drawSequence(ctx, scene, w, h);
  };

  /**
   * Final core docked: the socket engages, the hull completes its
   * circuit, the bay lights up, the ship departs. About 1.4s, and the
   * caller can skip it.
   */
  Renderer.prototype.drawSequence = function (ctx, scene, w, h) {
    var t = scene.sequence.t;
    var cell = this.cell;
    var cx = this.px(scene.sequence.col + 0.5);
    var cy = this.px(scene.sequence.row + 0.5);

    /* 1. the socket engages */
    if (t < 0.5) {
      var p = t / 0.5;
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.85;
      ctx.strokeStyle = "rgba(220,248,255,0.9)";
      ctx.lineWidth = Math.max(1, cell * 0.06 * (1 - p * 0.6));
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (0.35 + p * 1.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* 2. the completed circuit runs along the hull */
    if (t > 0.08 && t < 0.75) {
      var q = (t - 0.08) / 0.67;
      ctx.save();
      ctx.globalAlpha = Math.sin(Math.PI * q) * 0.5;
      ctx.fillStyle = "rgba(220,248,255,0.9)";
      for (var i = 0; i < this.conduits.length; i += 1) {
        var s = this.conduits[i];
        var pos = i / this.conduits.length;
        if (Math.abs(pos - q) > 0.06) continue;
        var x = s.col * cell;
        var y = s.row * cell;
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
      ctx.restore();
    }

    /* 3. bay illumination sweeps across the deck */
    if (t > 0.3 && t < 0.9) {
      var r = (t - 0.3) / 0.6;
      var band = w * 0.5;
      var x0 = -band + (w + band * 2) * r;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createLinearGradient(x0 - band / 2, 0, x0 + band / 2, 0);
      g.addColorStop(0, "rgba(143,230,242,0)");
      g.addColorStop(0.5, "rgba(190,240,250," + (0.16 * Math.sin(Math.PI * r)).toFixed(3) + ")");
      g.addColorStop(1, "rgba(143,230,242,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    /* 4. departure: the bay lifts and the hull edges flare */
    if (t > 0.62) {
      var s2 = (t - 0.62) / 0.38;
      ctx.save();
      ctx.globalAlpha = s2 * 0.5;
      var lg = ctx.createLinearGradient(0, h, 0, h * 0.55);
      lg.addColorStop(0, "rgba(190,240,250,0.55)");
      lg.addColorStop(1, "rgba(190,240,250,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  };

  Renderer.prototype.cellFromPoint = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var cellCss = this.cell / this.dpr;
    var col = Math.floor((clientX - rect.left) / cellCss);
    var row = Math.floor((clientY - rect.top) / cellCss);
    if (col < 0 || row < 0 || col >= this.level.w || row >= this.level.h) return -1;
    return row * this.level.w + col;
  };

  global.CoreShiftRenderer = {
    Renderer: Renderer,
    LIGHT_BASE: LIGHT_BASE
  };
})(typeof window !== "undefined" ? window : globalThis);
