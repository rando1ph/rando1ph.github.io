/* Core Shift — headless validation (run: node validate.js)
   Prints a per-level report and exits non-zero on failure. */

"use strict";

var E = require("./engine.js");
var S = require("./solver.js");
var LEVELS = require("./levels.js");

var failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error("  FAIL: " + msg);
  }
}

function draw(lv) {
  var out = [];
  for (var y = 0; y < lv.h; y += 1) {
    var row = "";
    for (var x = 0; x < lv.w; x += 1) {
      var i = y * lv.w + x;
      if (lv.walls[i]) row += "#";
      else if (E.coreAt(lv, { cores: lv.cores }, i) >= 0 && E.isDock(lv, i)) row += "*";
      else if (E.coreAt(lv, { cores: lv.cores }, i) >= 0) row += "$";
      else if (E.isDock(lv, i)) row += ".";
      else if (i === lv.player) row += "@";
      else row += "_";
    }
    out.push(row);
  }
  return out.join("\n");
}

/* border closure check: no floor cell may touch the array edge */
function enclosed(lv) {
  for (var x = 0; x < lv.w; x += 1) {
    if (!lv.walls[x] || !lv.walls[(lv.h - 1) * lv.w + x]) return false;
  }
  for (var y = 0; y < lv.h; y += 1) {
    if (!lv.walls[y * lv.w] || !lv.walls[y * lv.w + lv.w - 1]) return false;
  }
  return true;
}

console.log("Core Shift level validation");
console.log("===========================");

for (var n = 0; n < LEVELS.length; n += 1) {
  var def = LEVELS[n];
  console.log("\n[" + (n + 1) + "] " + def.name);
  var lv;
  try {
    lv = E.parseLevel(def);
  } catch (err) {
    failures += 1;
    console.error("  FAIL parse: " + err.message);
    continue;
  }
  console.log(draw(lv));

  var widths = def.grid.map(function (r) { return r.length; });
  var uniform = widths.every(function (w) { return w === widths[0]; });
  assert(uniform, "ragged rows: " + widths.join(","));
  assert(enclosed(lv), "level not enclosed by walls");

  var dead = E.deadSquares(lv);
  console.log(
    "  " + lv.w + "x" + lv.h +
    "  cores=" + lv.cores.length +
    "  deadSquares=" + dead.dead.length
  );

  var t0 = Date.now();
  var sol = S.solve(lv);
  var ms = Date.now() - t0;
  if (sol.solved) {
    console.log(
      "  solver: SOLVED  referencePushes=" + sol.pushes +
      "  nodes=" + sol.nodes + "  " + ms + "ms"
    );
  } else {
    failures += 1;
    console.error("  solver: UNSOLVABLE (" + sol.reason + ") nodes=" + sol.nodes);
  }
}

/* --- engine rule tests ------------------------------------------------ */

console.log("\nEngine rule tests");
console.log("-----------------");

function mkState(player, cores) {
  return { player: player, cores: cores };
}

/* wall collision + push rules on a synthetic 5x3 level */
var wallLv = E.parseLevel({
  name: "synthetic",
  grid: [
    "#####",
    "#@$._#".slice(0, 5),
    "#####"
  ]
});
/* rebuild cleanly: "@$._" inside 5 wide */
wallLv = E.parseLevel({
  name: "synthetic",
  grid: ["#####", "#@$._", "#####"]
});
console.log(draw(wallLv));
var st = mkState(6, [7]); /* player idx6 (1,1), core idx7 (2,1) */

var r = E.step(wallLv, mkState(6, [7]), "up");
assert(r === null, "step up into wall must be null");
r = E.step(wallLv, mkState(6, [7]), "left");
assert(r === null, "step left into wall must be null");
r = E.step(wallLv, mkState(6, [7]), "right");
assert(r && r.pushed === true && r.coreTo === 8, "push right must move core to idx8");
assert(r.docked === true, "core must dock at idx8");
var st2 = mkState(7, [8]);
assert(E.isSolved(wallLv, st2), "level must be solved with core on dock");
r = E.step(wallLv, st2, "right");
assert(r && r.pushed === true && r.undocked === true, "push off dock must report undocked");

/* push into second core is illegal; path around blocked cores */
var twoLv = E.parseLevel({
  name: "synthetic2",
  grid: ["######", "#@$$..", "######"]
});
var st3 = mkState(7, [8, 9]);
r = E.step(twoLv, st3, "right");
assert(r === null, "push into another core must be illegal");
var path2 = E.findPath(twoLv, st3, 7, 10);
assert(path2 === null, "tap-to-walk path must not route through a core");

/* undo reversibility: push, walk, manually invert, replay, compare */
var undoLv = E.parseLevel({
  name: "synthetic4",
  grid: ["####", "#._#", "#$_#", "#@_#", "####"]
});
var su = E.initialState(undoLv);
var startSnap = JSON.stringify({ p: su.player, c: su.cores });
var pushR = E.step(undoLv, su, "up");
assert(pushR && pushR.pushed && pushR.docked, "walking up must push core onto dock");
/* pushing again would shove the docked core into the wall: illegal */
assert(E.step(undoLv, su, "up") === null, "pushing docked core into wall must be illegal");
r = E.step(undoLv, su, "right");
assert(r && !r.pushed, "sideways step must be plain move");
var afterSteps = JSON.stringify({ p: su.player, c: su.cores });
/* undo plain move */
su.player = r.from;
/* undo push: core returns to its pre-push cell, robot to its pre-push cell */
su.cores[0] = pushR.coreFrom;
su.player = pushR.from;
assert(JSON.stringify({ p: su.player, c: su.cores }) === startSnap,
  "undo must restore the exact starting state");
r = E.step(undoLv, su, "up");
r = E.step(undoLv, su, "right");
assert(JSON.stringify({ p: su.player, c: su.cores }) === afterSteps,
  "replay after undo must reach the same state");

/* dead squares on synthetic corner level */
var deadLv = E.parseLevel({
  name: "deadtest",
  grid: ["####", "#@.#", "#$_#", "####"]
});
var dd = E.deadSquares(deadLv);
/* dock (2,1); core (1,2). Pull-BFS from dock: (2,1)<- (2,2)? needs (2,3) wall -> no;
   (1,1)? pull left from (2,1) needs (0,1) wall -> no; (1,2) pull up from... (1,2)->(2,2)? */
console.log("  dead squares (synthetic): " + dd.dead.join(","));
/* (1,2): can it reach dock (2,1)? push right -> (2,2), then up -> (2,1): robot (2,3) wall.
   push up: (1,1), then right: (2,1): robot (0,1) wall. So (1,2) is dead. */
assert(dd.dead.indexOf(5) >= 0 || dd.dead.indexOf(6) >= 0, "corner cells should be dead");
/* solver must reject a known impossible level: core frozen in corner */
var impLv = E.parseLevel({
  name: "impossible",
  grid: ["#####", "#$@.#", "#####"]
});
var imp = S.solve(impLv);
assert(!imp.solved, "solver must reject impossible level (core in corner)");

/* solver finds solution for every shipped level (again, counted) */
var solvedCount = 0;
for (var k = 0; k < LEVELS.length; k += 1) {
  var l = E.parseLevel(LEVELS[k]);
  if (S.solve(l).solved) solvedCount += 1;
}
assert(solvedCount === LEVELS.length, "all shipped levels must be solvable");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURES"));
process.exit(failures === 0 ? 0 : 1);
