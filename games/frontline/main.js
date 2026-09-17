import { Game, clamp } from "./engine.js";
import { Renderer } from "./render.js";
import { LEVELS, WEAPONS } from "./content.js";
const $ = (id) => document.getElementById(id);
const canvas = $("battlefield"),
  overlay = $("overlay"),
  renderer = new Renderer(canvas);
const KEY = "randolf:frontline:v1";
function freshSave() {
  return {
    version: 1,
    completed: [],
    seeds: {},
    best: { score: 0, distance: 0, bosses: 0 },
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.version !== 1) return freshSave();
    const completed = Array.isArray(s.completed)
      ? [
          ...new Set(
            s.completed.filter(
              (v) => Number.isInteger(v) && v >= 0 && v < LEVELS.length,
            ),
          ),
        ]
      : [];
    const seeds = {};
    for (let i = 0; i < LEVELS.length; i++)
      if (
        Number.isInteger(s.seeds?.[i]) &&
        s.seeds[i] >= 0 &&
        s.seeds[i] <= 0xffffffff
      )
        seeds[i] = s.seeds[i];
    const best = {};
    for (const k of ["score", "distance", "bosses"])
      best[k] = Number.isFinite(s.best?.[k])
        ? Math.max(0, Math.floor(s.best[k]))
        : 0;
    return { version: 1, completed, seeds, best };
  } catch {
    return freshSave();
  }
}
let save = load(),
  game,
  paused = true,
  screen = "menu",
  last = 0,
  accumulator = 0,
  pointer = null,
  held = new Set(),
  recorded = false;
function unlocked() {
  let n = 0;
  while (save.completed.includes(n) && n < LEVELS.length - 1) n++;
  return n;
}
let selected = unlocked();
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    $("notice").textContent =
      "Storage is unavailable. Progress will last for this visit.";
  }
}
function newSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
function seedFor(level) {
  if (!Number.isInteger(save.seeds[level])) {
    save.seeds[level] = newSeed();
    persist();
  }
  return save.seeds[level];
}
function cue(name, arg) {
  window.GameAudio?.fl[name]?.(arg);
}
function panel(html) {
  overlay.innerHTML = '<div class="panel">' + html + "</div>";
  overlay.hidden = false;
  $("pause").disabled = true;
}
function endRecord() {
  if (recorded) return;
  recorded = true;
  if (
    game.mode === "campaign" &&
    game.state === "won" &&
    !save.completed.includes(game.level)
  )
    save.completed.push(game.level);
  if (game.mode === "endless")
    for (const k of ["score", "distance", "bosses"])
      save.best[k] = Math.max(save.best[k], game[k]);
  persist();
}
function menu() {
  if (game?.mode === "endless" && game.time > 0) endRecord();
  paused = true;
  screen = "menu";
  held.clear();
  pointer = null;
  const spec = LEVELS[selected];
  panel(`<p class="eyebrow">THE FRACTURE ZONE</p><h2>FRONT<span>LINE</span></h2>
    <p class="sub">A few scouts. An advancing horde.<br>Make every lane count.</p>
    <div class="mission"><small>CAMPAIGN / SECTOR ${String(selected + 1).padStart(2, "0")} ${save.completed.includes(selected) ? "· CLEARED" : ""}</small><strong>${spec.name}</strong><p>${spec.subtitle}</p></div>
    <button class="primary" data-action="start">DEPLOY SQUAD →</button>
    <div class="menu-links"><button data-action="sectors">Choose sector · ${save.completed.length}/10</button>${save.completed.includes(selected) ? '<button data-action="fresh">New layout</button>' : ""}</div>
    <button class="secondary endless-button" data-action="endless">ENDLESS EXPEDITION <span>Best ${save.best.distance.toLocaleString()} m · ${save.best.score.toLocaleString()} pts</span></button>
    <p class="small-copy">DRAG TO STEER · SHOOTING IS AUTOMATIC<br>CROSS CRATES TO COLLECT · DODGE MARKED LANES</p>`);
  $("hint").textContent = "DRAG TO STEER · AUTO FIRE";
}
function sectors() {
  screen = "sectors";
  panel(
    `<p class="eyebrow">CAMPAIGN / ${save.completed.length} OF 10 SECURED</p><h2>The road home.</h2><p class="sub">Clear a sector to open the next.<br>Your battlefield stays the same until you clear it.</p><div class="level-grid">${LEVELS.map((l, i) => `<button data-level="${i}" ${i > unlocked() ? "disabled" : ""} class="${save.completed.includes(i) ? "done" : ""}" aria-label="Sector ${i + 1}: ${l.name}${i > unlocked() ? ", locked" : save.completed.includes(i) ? ", cleared" : ""}">${String(i + 1).padStart(2, "0")}${save.completed.includes(i) ? " ✓" : ""}</button>`).join("")}</div><button class="secondary" data-action="menu">Back to operations</button><p class="small-copy">CYAN / AVAILABLE &nbsp; LIME / SECURED<br>RESTART ALWAYS KEEPS YOUR CURRENT LAYOUT</p>`,
  );
}
function start(mode = "campaign", seed) {
  game = new Game({
    mode,
    level: mode === "campaign" ? selected : 0,
    seed: seed ?? (mode === "endless" ? newSeed() : seedFor(selected)),
    emit: cue,
  });
  paused = false;
  screen = "game";
  recorded = false;
  held.clear();
  pointer = null;
  accumulator = 0;
  overlay.hidden = true;
  $("pause").disabled = false;
  canvas.focus({ preventScroll: true });
  // A gesture starts audio, including when the first shot is scheduled later.
  cue("pickup");
  $("notice").textContent =
    "Squad deployed. Drag to steer; cross crates to collect.";
  hud();
}
function pause() {
  if (screen !== "game" || game.state !== "playing") return;
  paused = true;
  held.clear();
  pointer = null;
  screen = "paused";
  panel(
    `<p class="eyebrow">SQUAD ON STANDBY</p><h2>Take a breath.</h2><p class="sub">Your scouts will hold here.<br>Drag or use ← → / A D to steer.</p><button class="primary" data-action="resume">RESUME →</button><button class="secondary" data-action="restart">Restart · same battlefield</button><button class="secondary" data-action="menu">Back to operations</button>`,
  );
  overlay.querySelector("button")?.focus();
}
function resume() {
  paused = false;
  screen = "game";
  accumulator = 0;
  overlay.hidden = true;
  $("pause").disabled = false;
  canvas.focus({ preventScroll: true });
}
function result() {
  if (recorded) return;
  const endless = game.mode === "endless",
    win = game.state === "won",
    best = endless && game.distance > save.best.distance;
  endRecord();
  paused = true;
  screen = "result";
  held.clear();
  pointer = null;
  panel(`<p class="eyebrow">${win ? "SECTOR SECURED" : best ? "NEW DISTANCE RECORD" : "SIGNAL LOST"}</p><h2>${win ? "Road cleared." : "Hold on.<br>Try again."}</h2>
    <p class="sub">${win ? (game.level === 9 ? "Ten sectors secured. The road home is open." : "Your scouts live to see another sunrise.") : "Recruit early. Upgrade your weapon.<br>Keep clear of marked lanes."}</p>
    <div class="results"><div><strong>${game.score}</strong><span>SCORE</span></div><div><strong>${endless ? game.distance : game.kills}</strong><span>${endless ? "METERS" : "HOSTILES"}</span></div><div><strong>${endless ? game.bosses : game.squad}</strong><span>${endless ? "GUARDIANS" : "SCOUTS"}</span></div></div>
    ${win && game.level < 9 ? '<button class="primary" data-action="next">NEXT SECTOR →</button>' : endless ? '<button class="primary" data-action="endless">NEW EXPEDITION →</button>' : '<button class="primary" data-action="restart">DEPLOY AGAIN →</button>'}
    ${endless || (win && game.level < 9) ? '<button class="secondary" data-action="restart">Replay · same battlefield</button>' : ""}
    <button class="secondary" data-action="menu">Back to operations</button>`);
  $("notice").textContent = win ? "Sector secured." : "Squad lost.";
  overlay.querySelector("button")?.focus();
}
function hud() {
  if (!game) return;
  $("mode-label").textContent =
    game.mode === "endless"
      ? `WAVE ${game.wave}`
      : `SECTOR ${String(game.level + 1).padStart(2, "0")}`;
  $("squad-label").innerHTML = `${game.squad} <small>SCOUTS</small>`;
  $("distance-label").textContent =
    game.mode === "endless"
      ? `${game.distance} M · ${game.score} PTS`
      : LEVELS[game.level].name.toUpperCase();
  $("weapon-label").textContent =
    WEAPONS[game.weapon].name +
    (game.damage > 1 ? ` +${Math.round((game.damage - 1) * 100)}%` : "");
  $("progress").style.width =
    Math.min(
      100,
      game.mode === "campaign"
        ? (game.time / (LEVELS[game.level].duration - 6)) * 100
        : ((game.time % 75) / 75) * 100,
    ) + "%";
  if (screen === "game")
    $("hint").textContent =
      game.time < 12
        ? "CROSS CRATES TO RECRUIT & UPGRADE"
        : game.boss
          ? "DODGE THE MARKED LANE"
          : game.mode === "endless"
            ? `ENDLESS · ${game.bosses} GUARDIANS DOWN`
            : "KEEP YOUR SCOUTS ALIVE";
}
overlay.addEventListener("click", (e) => {
  const levelButton = e.target.closest("[data-level]");
  if (levelButton) {
    selected = Number(levelButton.dataset.level);
    menu();
    return;
  }
  const b = e.target.closest("[data-action]");
  if (!b) return;
  switch (b.dataset.action) {
    case "start":
      start();
      break;
    case "endless":
      start("endless");
      break;
    case "restart":
      start(game.mode, game.seed);
      break;
    case "resume":
      resume();
      break;
    case "menu":
      menu();
      break;
    case "sectors":
      sectors();
      break;
    case "next":
      selected = Math.min(9, game.level + 1);
      start();
      break;
    case "fresh":
      save.seeds[selected] = newSeed();
      persist();
      start();
      break;
  }
});
$("pause").addEventListener("click", pause);
function soundLabel() {
  const on = window.GameAudio?.isEnabled() ?? false;
  $("sound").textContent = "SOUND " + (on ? "ON" : "OFF");
  $("sound").setAttribute("aria-pressed", String(on));
}
$("sound").addEventListener("click", () => {
  window.GameAudio?.toggle();
  soundLabel();
  if (window.GameAudio?.isEnabled()) cue("pickup");
});
soundLabel();
canvas.addEventListener("pointerdown", (e) => {
  if (paused || pointer !== null) return;
  pointer = { id: e.pointerId, x: e.clientX, start: game.target };
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointer || pointer.id !== e.pointerId || paused) return;
  game.target = clamp(
    pointer.start +
      ((e.clientX - pointer.x) * 420) / canvas.getBoundingClientRect().width,
    60,
    360,
  );
});
function release(e) {
  if (pointer?.id === e.pointerId) pointer = null;
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("lostpointercapture", release);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (screen === "paused") resume();
    else pause();
    return;
  }
  if (
    e.target instanceof HTMLButtonElement ||
    e.target instanceof HTMLAnchorElement
  )
    return;
  if (
    screen === "game" &&
    ["ArrowLeft", "ArrowRight", "a", "d", "A", "D"].includes(e.key)
  ) {
    e.preventDefault();
    held.add(e.key.toLowerCase());
  }
  if (e.key === " ") {
    e.preventDefault();
    if (screen === "paused") resume();
    else pause();
  }
});
window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  held.clear();
  pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("resize", () => renderer.resize());
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (!paused) {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      game.step(
        1 / 60,
        (held.has("arrowright") || held.has("d") ? 1 : 0) -
          (held.has("arrowleft") || held.has("a") ? 1 : 0),
      );
      accumulator -= 1 / 60;
    }
    if (game.state !== "playing" && game.endTime > 0.7) result();
  }
  renderer.draw(game);
  if (Math.floor(now / 100) !== Math.floor((now - dt * 1000) / 100)) hud();
  requestAnimationFrame(loop);
}
// Frozen original scene behind operations, drawn with the actual game renderer.
game = new Game({ seed: seedFor(selected), level: selected });
game.squad = 8;
game.time = 20;
game.spawn({
  items: [
    { kind: "brute", x: 110, y: 275, scale: 1 },
    { kind: "grunt", x: 290, y: 365, scale: 1 },
    { kind: "runner", x: 185, y: 450, scale: 1 },
    { kind: "squad", x: 90, y: 465, value: 3 },
    { kind: "weapon", x: 326, y: 530, value: 1 },
  ],
});
menu();
requestAnimationFrame(loop);
// No production cheat UI. Explicit loopback-only hooks support repeatable QA.
if (
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("qa")
) {
  window.frontlineQA = {
    get game() {
      return game;
    },
    get save() {
      return save;
    },
    start,
    pause,
    resume,
    renderer,
    step(n = 1) {
      for (let i = 0; i < n; i++) game.step(1 / 60);
      renderer.draw(game);
      hud();
      if (game.state !== "playing") result();
    },
    freeze() {
      paused = true;
    },
    get screen() {
      return screen;
    },
  };
}
