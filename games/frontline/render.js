import { W, H, WEAPONS, LANES, ENEMIES } from "./content.js";
import { formation } from "./engine.js";
const INK = "#101727";
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext("2d", { alpha: false });
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    this.scenery = document.createElement("canvas");
    this.scenery.width = W;
    this.scenery.height = 850;
    this.makeRoad();
    this.buildSprites();
  }
  resize() {
    const d = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = W * d;
    this.canvas.height = H * d;
    this.c.setTransform(d, 0, 0, d, 0, 0);
  }
  ellipse(x, y, rx, ry, fill, stroke = null, width = 2) {
    const c = this.c;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.stroke();
    }
  }
  path(points, fill, stroke = INK, width = 2) {
    const c = this.c;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.lineJoin = "round";
      c.stroke();
    }
  }
  box(x, y, w, h, r, fill, stroke = null, lw = 2) {
    const c = this.c;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }
  line(points, color, width = 2) {
    const c = this.c;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = "round";
    c.stroke();
  }
  text(s, x, y, size = 12, color = "#fff", align = "center", weight = 800) {
    const c = this.c;
    c.fillStyle = color;
    c.textAlign = align;
    c.font = `${weight} ${size}px system-ui,sans-serif`;
    c.fillText(s, x, y);
  }
  makeRoad() {
    const old = this.c;
    this.c = this.scenery.getContext("2d");
    const c = this.c;
    c.fillStyle = "#272e3c";
    c.fillRect(0, 0, W, 850);
    c.fillStyle = "#1b2432";
    c.fillRect(0, 0, 35, 850);
    c.fillRect(385, 0, 35, 850);
    for (let i = 0; i < 95; i++) {
      const x = (i * 137.7) % 420,
        y = (i * 89.3) % 850;
      this.path(
        [
          [x, y],
          [x + 15, y + 7],
          [x + 34, y + 5],
          [x + 42, y + 20],
          [x + 12, y + 17],
        ],
        i % 2 ? "#2a3240" : "#242b38",
        null,
      );
      if (i % 3 === 0)
        this.line(
          [
            [x, y],
            [x + 9, y + 10],
            [x + 7, y + 22],
            [x + 20, y + 26],
          ],
          "#1e2633",
          1.1,
        );
    }
    for (let y = 0; y < 850; y += 85) {
      [151, 269].forEach((x) => this.box(x, y, 2, 42, 1, "#6a748129"));
      [33, 383].forEach((x) => this.box(x, y, 4, 76, 0, "#88909b34"));
      for (const side of [0, 1]) {
        const x = side ? 396 : 15;
        this.path(
          [
            [x - 15, y + 6],
            [x + 7, y],
            [x + 17, y + 17],
            [x + 10, y + 36],
            [x - 17, y + 28],
          ],
          "#111c2b",
          null,
        );
        this.path(
          [
            [x - 13, y + 2],
            [x + 6, y - 4],
            [x + 14, y + 11],
            [x + 6, y + 25],
            [x - 17, y + 20],
          ],
          y % 170 ? "#394355" : "#434a58",
          "#192333",
          1.5,
        );
        this.line(
          [
            [x - 12, y + 3],
            [x + 4, y - 2],
            [x + 13, y + 11],
          ],
          "#606574",
          1,
        );
      }
    }
    this.c = old;
  }
  buildSprites() {
    // Bake original procedural shapes once; drawImage keeps large battles cheap.
    this.soldierSprites = [];
    this.monsterSprites = {};
    const old = this.c,
      d = Math.min(devicePixelRatio || 1, 2);
    const make = (size, draw) => {
      const tile = document.createElement("canvas");
      tile.width = tile.height = size * d;
      this.c = tile.getContext("2d");
      this.c.scale(d, d);
      draw(size / 2);
      return { tile, size };
    };
    for (let w = 0; w < 3; w++)
      for (let f = 0; f < 2; f++)
        this.soldierSprites[w * 2 + f] = make(84, (p) =>
          this.soldierArt(p, p, 0, !!f, w, 0),
        );
    for (const kind of [...Object.keys(ENEMIES), "warden", "maw"])
      for (let hit = 0; hit < 2; hit++) {
        const boss = kind === "warden" || kind === "maw",
          r = boss ? 62 : ENEMIES[kind].radius;
        this.monsterSprites[kind + hit] = make(boss ? 190 : 110, (p) =>
          this.monsterArt(
            { kind, x: p, y: p, radius: r, age: 0, phase: 0, hit },
            boss,
          ),
        );
      }
    this.c = old;
  }
  soldier(x, y, i, flash, weapon, time) {
    const { tile, size } = this.soldierSprites[weapon * 2 + (flash ? 1 : 0)];
    const bob = this.reduced ? 0 : Math.sin(time * 10 + i * 2) * 1.2;
    this.c.drawImage(tile, x - size / 2, y - size / 2 + bob, size, size);
  }
  monster(e, boss = false) {
    const { tile, size } = this.monsterSprites[e.kind + (e.hit > 0 ? 1 : 0)],
      c = this.c;
    c.save();
    c.translate(e.x, e.y);
    if (!this.reduced) c.rotate(Math.sin(e.age * 3 + (e.phase || 0)) * 0.035);
    c.drawImage(tile, -size / 2, -size / 2, size, size);
    if (e.kind === "elite" || e.kind === "brute") {
      const r = e.radius;
      this.box(-r, -r - 18, r * 2, 4, 2, "#111724");
      this.box(
        -r,
        -r - 18,
        r * 2 * Math.max(0, e.hp / e.maxHp),
        4,
        2,
        e.kind === "elite" ? "#ce84f3" : "#e37f93",
      );
    }
    c.restore();
  }
  soldierArt(x, y, i, flash, weapon, time) {
    const c = this.c;
    c.save();
    c.translate(x, y + Math.sin(time * 10 + i * 2) * 1.2);
    this.ellipse(1, 13, 13, 6, "#08132080");
    this.box(-8, 4, 6, 12, 3, "#245974", INK, 1.8);
    this.box(3, 4, 6, 12, 3, "#245974", INK, 1.8);
    this.box(-10, -7, 20, 17, 6, "#268fb2", INK, 2);
    this.ellipse(-11, 0, 4, 6, "#4ed4ed", INK, 1.7);
    this.ellipse(11, -1, 4, 6, "#4ed4ed", INK, 1.7);
    this.box(
      5,
      -24 + (flash ? 2 : 0),
      5,
      22,
      2,
      weapon === 2 ? "#aa9b69" : "#5b8799",
      INK,
      2,
    );
    this.line(
      [
        [7, -22],
        [7, -13],
      ],
      "#a1d3d9",
      1.4,
    );
    this.box(-7, 0, 13, 10, 3, "#283f53", INK, 1.5);
    this.line(
      [
        [-4, 3],
        [3, 3],
      ],
      "#607d8f",
      1.5,
    );
    this.ellipse(-1, -10, 12, 12, "#24b8e1", INK, 2.2);
    this.ellipse(-3, -13, 8, 6, "#55dff0");
    this.path(
      [
        [-11, -10],
        [-9, -4],
        [6, -2],
        [10, -8],
      ],
      "#15516d",
      null,
    );
    this.line(
      [
        [-8, -9],
        [-1, -7],
        [7, -8],
      ],
      "#9afbff",
      2,
    );
    if (flash) {
      this.path(
        [
          [7, -39],
          [9, -29],
          [15, -32],
          [11, -24],
          [15, -21],
          [7, -23],
          [0, -19],
          [3, -27],
          [-1, -31],
          [5, -29],
        ],
        weapon === 2 ? "#fff0b4" : "#c6fcff",
        null,
      );
    }
    c.restore();
  }
  monsterArt(e, boss = false) {
    const c = this.c;
    const r = e.radius;
    c.save();
    c.translate(e.x, e.y);
    c.rotate(Math.sin(e.age * 3 + e.phase || e.age) * 0.035);
    const runner = e.kind === "runner",
      brute = e.kind === "brute",
      elite = e.kind === "elite",
      maw = e.kind === "maw";
    const fill =
      e.hit > 0
        ? "#ffdfde"
        : elite
          ? "#693b82"
          : runner
            ? "#a84e69"
            : boss
              ? maw
                ? "#52365f"
                : "#653452"
              : "#773852";
    this.ellipse(0, r * 0.72, r * 1.03, r * 0.32, "#060d1b80");
    if (elite) {
      this.ellipse(0, 3, r + 8, r + 8, "#c45de512");
      this.line(
        [
          [-r - 7, 0],
          [-r - 3, -r],
          [0, -r - 9],
          [r + 3, -r],
          [r + 7, 0],
        ],
        "#db82ea",
        2,
      );
    }
    if (brute || boss) {
      for (const side of [-1, 1]) {
        this.ellipse(
          side * r * 0.85,
          r * 0.18,
          r * 0.38,
          r * 0.48,
          fill,
          INK,
          3,
        );
        this.path(
          [
            [side * r * 1.12, r * 0.12],
            [side * r * 0.87, r * 0.28],
            [side * r * 0.96, r * 0.52],
            [side * r * 1.25, r * 0.46],
          ],
          "#a24c68",
          INK,
          2,
        );
        this.path(
          [
            [side * r * 0.83, -r * 0.37],
            [side * r * 0.99, -r * 0.82],
            [side * r * 0.55, -r * 0.6],
          ],
          "#dc8a91",
          INK,
          2,
        );
      }
    } else {
      for (const side of [-1, 1])
        this.path(
          [
            [side * r * 0.7, 0],
            [side * r * 1.22, r * 0.3],
            [side * r * (runner ? 1.35 : 1.12), r * 0.7],
            [side * r * 0.75, r * 0.55],
          ],
          fill,
          INK,
          2,
        );
    }
    this.box(-r * 0.6, r * 0.44, r * 0.43, r * 0.44, 5, fill, INK, 2);
    this.box(r * 0.17, r * 0.44, r * 0.43, r * 0.44, 5, fill, INK, 2);
    if (runner)
      this.path(
        [
          [-r, 0],
          [-r * 0.55, -r * 0.82],
          [0, -r * 1.3],
          [r * 0.55, -r * 0.82],
          [r, 0],
          [r * 0.55, r * 0.5],
          [-r * 0.55, r * 0.5],
        ],
        fill,
        INK,
        2.3,
      );
    else
      this.ellipse(0, -r * 0.08, r * 0.86, r * 0.85, fill, INK, boss ? 3 : 2.5);
    this.ellipse(
      -r * 0.12,
      -r * 0.46,
      r * 0.52,
      r * 0.26,
      e.hit > 0 ? "#fff0dc" : boss ? "#864458" : "#974661",
    );
    if (maw) {
      for (const side of [-1, 1])
        this.path(
          [
            [side * r * 0.85, -r * 0.28],
            [side * r * 1.38, -r * 0.1],
            [side * r * 1.27, r * 0.55],
            [side * r * 0.84, r * 0.9],
            [side * r * 0.96, r * 0.38],
          ],
          "#aa759a",
          INK,
          2.5,
        );
      this.path(
        [
          [-r * 0.22, -r * 0.83],
          [-r * 0.38, -r * 1.15],
          [0, -r * 0.98],
          [r * 0.38, -r * 1.15],
          [r * 0.22, -r * 0.83],
        ],
        "#d991bd",
        INK,
        2,
      );
    }
    if (boss) {
      for (const s of [-1, 1])
        this.path(
          [
            [s * r * 0.57, -r * 0.6],
            [s * r * 0.9, -r * 0.91],
            [s * r * 0.83, -r * 1.32],
            [s * r * 0.49, -r * 0.95],
            [s * r * 0.35, -r * 0.76],
          ],
          maw ? "#ad81bb" : "#ada0a6",
          INK,
          3,
        );
      this.path(
        [
          [-r * 0.31, -r * 0.83],
          [0, -r * 1.1],
          [r * 0.27, -r * 0.82],
        ],
        "#d67583",
        INK,
        2,
      );
      this.path(
        [
          [-r * 0.43, r * 0.18],
          [-r * 0.25, r * 0.4],
          [-r * 0.09, r * 0.23],
          [r * 0.09, r * 0.4],
          [r * 0.27, r * 0.23],
          [r * 0.43, r * 0.08],
          [r * 0.3, r * 0.52],
          [-r * 0.3, r * 0.52],
        ],
        "#ff8b99",
        INK,
        2,
      );
    } else {
      for (let i = 0; i < 3; i++) {
        const xx = (i - 1) * r * 0.52;
        this.path(
          [
            [xx - r * 0.18, -r * 0.64],
            [xx - r * 0.04, -r * 1.08],
            [xx + r * 0.19, -r * 0.72],
          ],
          elite ? "#db9df3" : "#ce6480",
          INK,
          1.5,
        );
      }
      if (brute)
        this.path(
          [
            [-r * 0.28, r * 0.21],
            [-r * 0.15, r * 0.5],
            [0, r * 0.25],
            [r * 0.15, r * 0.5],
            [r * 0.29, r * 0.2],
          ],
          "#ffc1b2",
          null,
        );
      else
        this.line(
          [
            [-3, r * 0.3],
            [2, r * 0.34],
            [5, r * 0.28],
          ],
          "#ec98ab",
          1.3,
        );
    }
    if (maw) this.ellipse(0, -r * 0.4, r * 0.1, r * 0.16, "#f8b2e4");
    for (const s of [-1, 1]) {
      this.ellipse(s * r * 0.33, -r * 0.03, r * 0.19, r * 0.19, "#ff5b7025");
      if (boss || brute)
        this.path(
          [
            [s * r * 0.12, -r * 0.12],
            [s * r * 0.52, -r * 0.23],
            [s * r * 0.43, r * 0.04],
            [s * r * 0.22, r * 0.07],
          ],
          "#ffb080",
          null,
        );
      else
        this.ellipse(
          s * r * 0.31,
          -r * 0.03,
          r * 0.115,
          r * 0.15,
          elite ? "#f6b8ff" : "#ff919b",
        );
    }

    c.restore();
  }
  crate(p) {
    const c = this.c,
      x = p.x,
      y = p.y + Math.sin(p.age * 3) * 2,
      weapon = p.kind === "weapon",
      color = weapon ? "#ffc66b" : "#64dafa";
    c.save();
    c.translate(x, y);
    this.ellipse(0, 29, 38, 10, "#050e2255");
    const glow = c.createRadialGradient(0, 5, 8, 0, 5, 62);
    glow.addColorStop(0, weapon ? "#ffa92c33" : "#20b4ff33");
    glow.addColorStop(1, "#00000000");
    c.fillStyle = glow;
    c.fillRect(-62, -62, 124, 124);
    this.path(
      [
        [-33, -26],
        [-26, -35],
        [31, -35],
        [36, -27],
        [31, 26],
        [-33, 26],
      ],
      weapon ? "#a97837" : "#236487",
      INK,
      2.5,
    );
    this.box(-34, -27, 67, 55, 6, weapon ? "#6e512f" : "#174d77", color, 2.3);
    this.box(-28, -21, 55, 43, 3, weapon ? "#a57539" : "#256a9b", null);
    for (const s of [-1, 1]) {
      this.line(
        [
          [s * 22, -26],
          [s * 30, -26],
          [s * 32, -19],
        ],
        "#ddfaff",
        2.3,
      );
      this.line(
        [
          [s * 32, 17],
          [s * 32, 25],
          [s * 24, 25],
        ],
        color,
        2.3,
      );
    }
    if (weapon) {
      this.path(
        [
          [-20, -3],
          [13, -9],
          [24, -9],
          [25, -3],
          [10, 0],
          [3, 12],
          [-3, 10],
          [-2, 3],
          [-13, 5],
          [-17, 13],
          [-24, 10],
        ],
        "#2a2d31",
        "#ffd89a",
        1.7,
      );
      this.line(
        [
          [0, -44],
          [5, -49],
          [10, -44],
        ],
        "#ffdb8d",
        3,
      );
    } else if (p.kind === "squad") {
      this.text("+" + p.value, 0, 10, 29, "#f2fcff");
    } else {
      this.text(p.kind === "rapid" ? "»" : "↑", 0, 10, 30, "#e7fbff");
    }
    this.text(
      p.locked
        ? "GUARDED"
        : weapon
          ? "WEAPON"
          : p.kind === "squad"
            ? "SCOUTS"
            : p.kind === "rapid"
              ? "RATE"
              : "POWER",
      0,
      42,
      9,
      p.locked ? "#ffb0ae" : color,
    );
    if (p.locked) {
      this.box(-7, -43, 14, 11, 2, "#eaa19a", INK, 1);
      this.line(
        [
          [-4, -43],
          [-4, -49],
          [4, -49],
          [4, -43],
        ],
        "#eaa19a",
        2,
      );
    }
    c.restore();
  }
  draw(g) {
    const c = this.c;
    c.save();
    if (!this.reduced && g.shake)
      c.translate(
        Math.sin(g.time * 87) * g.shake * 0.6,
        Math.cos(g.time * 91) * g.shake * 0.4,
      );
    c.fillStyle = "#212938";
    c.fillRect(0, 0, W, H);
    const scroll = (g.time * 31) % 850;
    c.drawImage(this.scenery, 0, scroll - 850);
    c.drawImage(this.scenery, 0, scroll);
    // Repeating roadside beacons, rusted rails and abandoned utility cabinets.
    for (let side = 0; side < 2; side++)
      for (let i = 0; i < 4; i++) {
        const x = side ? 405 : 15,
          y = ((i * 240 + scroll * 1.1) % 960) - 100;
        this.box(x - 9, y, 18, 54, 2, "#141e2c", "#465365", 1.5);
        this.line(
          [
            [x - 8, y + 4],
            [x + 6, y + 4],
          ],
          "#657082",
          2,
        );
        this.box(x - 8, y + 19, 16, 5, 1, "#dcac69");
        this.ellipse(x, y + 22, 27, 24, "#ffbc4910");
        this.line(
          [
            [x, y + 62],
            [x, y + 161],
          ],
          "#0e1826",
          5,
        );
        for (let yy = y + 68; yy < y + 158; yy += 24)
          this.line(
            [
              [x - 8, yy + 6],
              [x + 8, yy - 6],
            ],
            "#3c4b5f",
            2,
          );
      }
    const fog = c.createLinearGradient(0, 0, 0, 310);
    fog.addColorStop(0, "#0d172cdd");
    fog.addColorStop(1, "#0d172c00");
    c.fillStyle = fog;
    c.fillRect(0, 0, W, 310);
    this.line(
      [
        [42, 641],
        [378, 641],
      ],
      "#71dafa18",
      1,
    );
    this.text("HOLD THE LINE", 210, 746, 9, "#6b819466");
    const boss = g.boss;
    if (boss?.attack)
      for (const x of boss.attack.lanes) {
        const a = boss.attack,
          active = a.t > 1.35;
        c.fillStyle = active ? "#ff847f66" : "#fa64721a";
        c.fillRect(x - 44, boss.y + 35, 88, H - boss.y - 35);
        this.line(
          [
            [x - 44, boss.y + 38],
            [x - 44, 730],
          ],
          active ? "#ffb899" : "#fa738499",
          2,
        );
        this.line(
          [
            [x + 44, boss.y + 38],
            [x + 44, 730],
          ],
          active ? "#ffb899" : "#fa738499",
          2,
        );
        this.text(
          active ? "IMPACT" : "MOVE",
          x,
          573,
          13,
          active ? "#fff0d5" : "#ffb3b9",
        );
        for (let y = 330; y < 580; y += 70)
          this.line(
            [
              [x - 10, y],
              [x, y + 9],
              [x + 10, y],
            ],
            "#ff8eaa88",
            2,
          );
      }
    for (const p of g.pickups) this.crate(p);
    for (const e of g.enemies) this.monster(e);
    if (boss) this.monster(boss, true);
    for (const b of g.bullets) {
      this.line(
        [
          [b.x, b.y + 15],
          [b.x, b.y],
        ],
        b.color + "20",
        7,
      );
      this.line(
        [
          [b.x, b.y + 10],
          [b.x, b.y],
        ],
        b.color,
        3,
      );
      this.line(
        [
          [b.x, b.y + 5],
          [b.x, b.y],
        ],
        "#eeffff",
        1,
      );
    }
    for (const h of g.hostile) {
      this.ellipse(h.x, h.y, h.r + 5, h.r + 5, "#ff528233");
      this.path(
        [
          [h.x, h.y - 10],
          [h.x + 6, h.y],
          [h.x, h.y + 10],
          [h.x - 6, h.y],
        ],
        "#ff879e",
        null,
      );
    }
    if (g.invulnerable <= 0 || Math.floor(g.time * 15) % 2 === 0)
      formation(g.squad).forEach((p, i) =>
        this.soldier(g.x + p.x, 649 + p.y, i, g.flash > 0, g.weapon, g.time),
      );
    // Small rally marker shows exactly where supply collection is measured.
    this.line(
      [
        [g.x - 6, 615],
        [g.x, 609],
        [g.x + 6, 615],
      ],
      "#b5edfb99",
      2,
    );
    for (const p of g.effects) {
      c.globalAlpha = Math.max(0, p.life / 0.5);
      this.box(p.x, p.y, p.size, p.size, 1, p.color);
    }
    c.globalAlpha = 1;
    for (const t of g.texts) {
      c.globalAlpha = Math.min(1, t.life * 2);
      this.text(t.text, t.x, t.y, 14, t.color);
    }
    c.globalAlpha = 1;
    if (boss) {
      this.box(76, 87, 268, 37, 8, "#101824e8");
      this.text(
        boss.y < 167
          ? "GUARDIAN APPROACHING"
          : boss.kind === "maw"
            ? "RIFT MAW"
            : "IRON WARDEN",
        210,
        101,
        10,
        "#ffb4c8",
      );
      this.box(88, 109, 244, 5, 2, "#392c42");
      this.box(
        88,
        109,
        244 * Math.max(0, boss.hp / boss.maxHp),
        5,
        2,
        "#f47b9a",
      );
    }
    c.restore();
  }
}
