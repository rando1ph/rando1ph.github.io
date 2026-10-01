#!/usr/bin/env node
/* ------------------------------------------------------------------
   Core Shift — engine tests (headless)

     node games/core-shift/tests.js

   No DOM, no canvas: this covers the rules, undo, the movement helpers,
   the persistence payload and the solver's interaction with the engine.
   Exits non-zero if anything fails.
   ------------------------------------------------------------------ */

"use strict";

var path = require("path");
var Engine = require(path.join(__dirname, "engine.js"));
var Solver = require(path.join(__dirname, "solver.js"));
var Levels = require(path.join(__dirname, "levels.js"));

/* ------------------------------------------------------------------
   Tiny harness
   ------------------------------------------------------------------ */

var tests = [];
var passed = 0;
var failed = 0;

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}

function eq(actual, expected, message) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((message || "not equal") + "\n    expected " + b + "\n    actual   " + a);
  }
}

function sameState(state, other, message) {
  assert(state.player === other.player, (message || "") + " player " + state.player + " != " + other.player);
  eq(state.boxes, other.boxes, (message || "") + " boxes");
  assert(state.moves === other.moves, (message || "") + " moves " + state.moves + " != " + other.moves);
  assert(state.pushes === other.pushes, (message || "") + " pushes " + state.pushes + " != " + other.pushes);
}

/* A tiny deterministic generator, so a failure is always reproducible. */
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------ */

/* robot on the left, one core, one dock, and one free cell beyond the dock
   so a solved level can be un-solved again by pushing further */
var OPEN = ["#######", "#     #", "#     #", "#@$ . #", "#######"];

function openLevel() {
  return Engine.parse(OPEN);
}

/* level 1 from the campaign: two cores, one of them already docked */
function campaignLevel(n) {
  var entry = Levels.LEVELS[n - 1];
  var parsed = Engine.parse(entry.rows);
  parsed.id = entry.id;
  return parsed;
}

/* ------------------------------------------------------------------
   Parsing
   ------------------------------------------------------------------ */

test("parse accepts a well-formed level", function () {
  var l = openLevel();
  eq(l.errors, [], "no errors");
  assert(l.w === 7 && l.h === 5, "size");
  assert(l.boxCount === 1, "one core");
  assert(l.goalCount === 1, "one dock");
  assert(l.player >= 0, "robot placed");
});

test("parse rejects two robots", function () {
  var l = Engine.parse(["#####", "#@ @#", "#$ .#", "#####"]);
  assert(
    l.errors.some(function (e) {
      return e.indexOf("exactly one robot") !== -1;
    }),
    "two robots reported: " + l.errors
  );
});

test("parse rejects a missing robot", function () {
  var l = Engine.parse(["#####", "#   #", "#$ .#", "#####"]);
  assert(
    l.errors.some(function (e) {
      return e.indexOf("no robot start") !== -1;
    }),
    "missing robot reported"
  );
});

test("parse rejects mismatched core and dock counts", function () {
  var l = Engine.parse(["#####", "#@  #", "#$$ .#", "#####"]);
  assert(
    l.errors.some(function (e) {
      return e.indexOf("cores (2) != docks (1)") !== -1;
    }),
    "mismatch reported: " + l.errors
  );
});

test("parse rejects illegal characters", function () {
  var l = Engine.parse(["#####", "#@ X#", "#$ .#", "#####"]);
  assert(
    l.errors.some(function (e) {
      return e.indexOf("illegal character") !== -1;
    }),
    "illegal character reported"
  );
});

test("parse seals the space outside the hull", function () {
  /* the blank margin around the hull must not become walkable deck */
  var l = Engine.parse([" #####  ", " #   #  ", " # @ #  ", " #$ .#  ", " #####  "]);
  eq(l.errors, [], "no errors");
  var open = 0;
  for (var i = 0; i < l.floor.length; i += 1) {
    if (!l.walls[i]) open += 1;
  }
  assert(open === 3 * 3, "only the 3x3 interior stays open, got " + open);
  assert(l.walls[0] === 1 && l.walls[l.w * l.h - 1] === 1, "corners sealed");
});

test("every shipped level parses cleanly", function () {
  Levels.LEVELS.forEach(function (entry, i) {
    var l = Engine.parse(entry.rows);
    eq(l.errors, [], "level " + (i + 1) + " (" + entry.source + ")");
    assert(l.boxCount === l.goalCount, "level " + (i + 1) + " cores match docks");
  });
});

/* ------------------------------------------------------------------
   Movement rules
   ------------------------------------------------------------------ */

test("a wall blocks the robot", function () {
  var l = Engine.parse(["#####", "#@  #", "#$ .#", "#####"]);
  var s = Engine.createState(l);
  var up = s.player - l.w;
  assert(!Engine.step(l, s, 0), "stepping into the wall is refused");
  assert(s.player === up + l.w, "robot did not move");
  assert(s.moves === 0, "no move counted");
});

test("a core cannot be pushed into a wall", function () {
  var l = Engine.parse(["#####", "#$@ #", "#  .#", "#####"]);
  var s = Engine.createState(l);
  assert(!Engine.step(l, s, 3), "pushing the core into the wall is refused");
  assert(s.moves === 0 && s.pushes === 0, "nothing counted");
});

test("a core cannot be pushed into another core", function () {
  var l = Engine.parse(["######", "#$$@ #", "#   .#", "######"]);
  var s = Engine.createState(l);
  assert(!Engine.step(l, s, 3), "refused");
  assert(s.pushes === 0, "nothing counted");
});

test("a push moves the core and counts once as both move and push", function () {
  var l = openLevel();
  var s = Engine.createState(l);
  var box = s.boxes[0];
  var r = Engine.step(l, s, 1); /* right */
  assert(r && r.pushed, "push reported");
  assert(r.boxFrom === box && r.boxTo === box + 1, "core moved one cell right");
  assert(s.boxes[0] === box + 1, "state agrees");
  assert(s.moves === 1 && s.pushes === 1, "counts");
});

test("cores are pushed, never pulled", function () {
  var l = openLevel();
  var s = Engine.createState(l);
  var box = s.boxes[0];
  Engine.step(l, s, 1); /* push it right */
  assert(s.player === box, "robot took the core's old cell");
  Engine.step(l, s, 3); /* walk back left, away from the core */
  assert(s.boxes[0] === box + 1, "the core stayed put");
  assert(s.pushes === 1, "no extra push counted");
});

test("a docked core can be pushed back off its dock", function () {
  var l = campaignLevel(1);
  var s = Engine.createState(l);
  assert(Engine.dockedCount(l, s) === 1, "level 1 starts with one core docked");

  /* the docked core sits against the left hull, so it only moves vertically:
     the robot has to go round and stand underneath it */
  var below = l.player + l.w - 1;
  var walk = Engine.pathTo(l, s, below);
  assert(walk, "the robot can reach the cell below the docked core");
  for (var i = 0; i < walk.length; i += 1) Engine.step(l, s, walk[i]);
  var r = Engine.step(l, s, 0); /* push it up, out of the dock */
  assert(r && r.pushed, "the docked core was pushed off");
  assert(Engine.dockedCount(l, s) === 0, "power went back down");
});

test("isSolved follows the docks, not the pushes", function () {
  var l = openLevel();
  var s = Engine.createState(l);
  assert(!Engine.isSolved(l, s), "not solved at the start");
  Engine.step(l, s, 1);
  Engine.step(l, s, 1);
  assert(Engine.isSolved(l, s), "the core seated in its dock solves the level");
  Engine.step(l, s, 1); /* push it straight back out */
  assert(!Engine.isSolved(l, s), "and it is no longer solved");
});

/* ------------------------------------------------------------------
   Undo
   ------------------------------------------------------------------ */

test("undo restores a walk exactly", function () {
  var l = campaignLevel(3);
  var s = Engine.createState(l);
  var before = Engine.cloneState(s);
  assert(Engine.step(l, s, 1), "step");
  Engine.undo(l, s);
  sameState(s, before, "after undo");
  assert(s.history.length === 0, "history emptied");
});

test("undo restores a push exactly, core included", function () {
  var l = openLevel();
  var s = Engine.createState(l);
  var before = Engine.cloneState(s);
  Engine.step(l, s, 1);
  assert(s.pushes === 1, "pushed");
  Engine.undo(l, s);
  sameState(s, before, "after undoing a push");
  assert(s.pushes === 0, "push count rolled back");
});

test("undo returns null at the start of a level", function () {
  var l = openLevel();
  var s = Engine.createState(l);
  assert(Engine.undo(l, s) === null, "nothing to undo");
});

test("undo survives long interleaved step/undo sequences", function () {
  var l = campaignLevel(13);
  var s = Engine.createState(l);
  var random = rng(20260921);
  var reference = Engine.createState(l);

  for (var i = 0; i < 4000; i += 1) {
    if (random() < 0.28) {
      Engine.undo(l, s);
    } else {
      Engine.step(l, s, Math.floor(random() * 4));
    }
    /* the incremental state must always equal a fresh replay of its history */
    reference = Engine.createState(l);
    for (var h = 0; h < s.history.length; h += 1) {
      var code = s.history[h];
      Engine.step(l, reference, code & 3);
    }
    sameState(s, reference, "after " + (i + 1) + " operations");
  }
});

/* ------------------------------------------------------------------
   Movement helpers
   ------------------------------------------------------------------ */

test("reachable treats cores as walls", function () {
  var l = Engine.parse(["#####", "# @ #", "#$ .#", "#####"]);
  var s = Engine.createState(l);
  var region = Engine.reachable(l, s);
  assert(region[s.player] === 1, "the robot's own cell");
  assert(region[s.boxes[0]] === 0, "the core's cell is not walkable");
  var dock = -1;
  for (var i = 0; i < l.goals.length; i += 1) if (l.goals[i]) dock = i;
  assert(region[dock] === 1, "the dock is reachable around the core");
});

test("pathTo returns a walkable shortest path", function () {
  var l = campaignLevel(2);
  var s = Engine.createState(l);
  var target = -1;
  for (var i = 0; i < l.floor.length; i += 1) {
    if (l.floor[i] && Engine.boxAt(s, i) === -1 && i !== s.player) target = i;
  }
  var path = Engine.pathTo(l, s, target);
  assert(path && path.length, "path found");
  var at = s.player;
  for (var k = 0; k < path.length; k += 1) {
    var r = Engine.step(l, s, path[k]);
    assert(r, "every step of the path is legal (step " + k + ")");
  }
  assert(s.player === target, "the path lands on the target");
  assert(path.length === 0 || at !== target, "non-trivial");
});

test("pathTo returns an empty path for the current cell and null when walled off", function () {
  var l = Engine.parse(["#####", "#@  #", "#$ .#", "#####"]);
  var s = Engine.createState(l);
  eq(Engine.pathTo(l, s, s.player), [], "same cell");
  var blocked = Engine.parse(["#######", "#@ #  #", "#$ # .#", "#######"]);
  var s2 = Engine.createState(blocked);
  assert(Engine.pathTo(blocked, s2, blocked.w * 2 + 5) === null, "unreachable cell");
});

test("every pushOption really works when the robot executes it", function () {
  var l = campaignLevel(3);
  var s = Engine.createState(l);
  var box = s.boxes[0];
  var options = Engine.pushOptions(l, s, box);
  assert(options.length > 0, "the level offers at least one push");

  options.forEach(function (o) {
    assert(!l.walls[o.to], "the destination is not a wall");
    assert(Engine.boxAt(s, o.to) === -1, "the destination is not another core");
    assert(Engine.boxAt(s, o.from) === -1, "the standing cell is free");
    assert(o.to === box + Engine.DIRS[o.dir].dx + Engine.DIRS[o.dir].dy * l.w, "destination geometry");

    var trial = Engine.cloneState(s);
    var walk = Engine.pathTo(l, trial, o.from);
    assert(walk, "the robot can reach the standing cell");
    walk.forEach(function (d) {
      Engine.step(l, trial, d);
    });
    var r = Engine.step(l, trial, o.dir);
    assert(r && r.pushed, "the push executes");
    assert(Engine.boxAt(trial, o.to) !== -1, "the core lands exactly where the option promised");
  });
});

test("pushOptions is empty for a core the robot cannot touch", function () {
  /* the core is boxed in on all four sides */
  var l = Engine.parse(["#######", "#@    #", "# ### #", "# #$# #", "# ### #", "#     #", "#######"]);
  var s = Engine.createState(l);
  eq(Engine.pushOptions(l, s, s.boxes[0]), [], "no legal push exists");
});

/* ------------------------------------------------------------------
   Persistence payload
   ------------------------------------------------------------------ */

test("state serialization round-trips", function () {
  var l = campaignLevel(9);
  var s = Engine.createState(l);
  Engine.step(l, s, 1);
  Engine.step(l, s, 2);
  var restored = Engine.deserializeState(l, Engine.serializeState(s));
  assert(restored, "restored");
  sameState(restored, s, "round trip");
  eq(restored.history, s.history, "history survives");
});

test("deserialization rejects junk instead of rendering a corrupt board", function () {
  var l = campaignLevel(4);
  assert(Engine.deserializeState(l, null) === null, "null");
  assert(Engine.deserializeState(l, {}) === null, "empty object");
  assert(Engine.deserializeState(l, { p: 0, b: [1, 2, 3, 4], h: [] }) === null, "wrong core count");
  assert(Engine.deserializeState(l, { p: -5, b: l.boxes.slice(), h: [] }) === null, "bad robot cell");
  assert(
    Engine.deserializeState(l, { p: l.player, b: l.boxes.slice(), h: [99] }) === null,
    "out-of-range history code"
  );
  var wall = -1;
  for (var i = 0; i < l.walls.length; i += 1) {
    if (l.walls[i]) {
      wall = i;
      break;
    }
  }
  assert(
    Engine.deserializeState(l, { p: wall, b: l.boxes.slice(), h: [] }) === null,
    "robot inside a wall"
  );
});

test("a deserialized state can be undone further", function () {
  var l = openLevel();
  var s = Engine.createState(l);
  Engine.step(l, s, 1);
  Engine.step(l, s, 1);
  Engine.step(l, s, 1);
  assert(s.history.length === 3, "three steps recorded");
  var restored = Engine.deserializeState(l, Engine.serializeState(s));
  Engine.undo(l, restored);
  Engine.undo(l, restored);
  Engine.undo(l, restored);
  sameState(restored, Engine.createState(l), "undoing the restored history returns to the start");
});

/* ------------------------------------------------------------------
   Solver
   ------------------------------------------------------------------ */

test("the solver proves a solution and the engine reproduces it", function () {
  var l = campaignLevel(1);
  var result = Solver.solve(l, { limit: 200000, solution: true });
  assert(result.solvable, "solvable");
  assert(result.minPushes === 8, "level 1 needs exactly 8 pushes, got " + result.minPushes);
  var replay = Solver.replay(l, result.solution);
  assert(replay.ok, "replay reaches a win: " + replay.reason);
  assert(replay.pushes === result.minPushes, "replay used the same push count");
});

test("the solver reports a genuinely unsolvable level as unsolvable", function () {
  /* one core wedged in a corner with no dock anywhere near it */
  var l = Engine.parse(["#####", "#.  #", "#  @#", "#  $#", "#####"]);
  var result = Solver.solve(l, { limit: 20000 });
  assert(!result.solvable, "no solution claimed");
  assert(result.minPushes === -1, "no push count");
});

test("dead squares: docks are live, sealed corners are not", function () {
  var l = Engine.parse(["######", "#@   #", "# $  #", "#  . #", "#   $#", "######"]);
  var dead = Solver.deadSquares(l);
  var dock = -1;
  for (var i = 0; i < l.goals.length; i += 1) if (l.goals[i]) dock = i;
  assert(dead[dock] === 0, "a dock is never dead");
  assert(dead[l.w + 1] === 1, "the corner cell is dead — nothing can push a core out of it");
  assert(dead[3 * l.w + 2] === 0, "deck with no wall against it is live");
});

test("the solver never prunes a real solution", function () {
  /* every shipped level solved with the deadlock table active must replay */
  Levels.LEVELS.forEach(function (entry, i) {
    var l = Engine.parse(entry.rows);
    var result = Solver.solve(l, { limit: 2000000, solution: true });
    assert(result.solvable, "level " + (i + 1) + " solvable");
    var replay = Solver.replay(l, result.solution);
    assert(replay.ok, "level " + (i + 1) + " replays: " + replay.reason);
  });
});

/* ------------------------------------------------------------------
   Run
   ------------------------------------------------------------------ */

tests.forEach(function (t) {
  try {
    t.fn();
    passed += 1;
    console.log("  ok   " + t.name);
  } catch (e) {
    failed += 1;
    console.log("  FAIL " + t.name);
    console.log("       " + String(e.message).split("\n").join("\n       "));
  }
});

console.log("");
console.log(passed + " passed, " + failed + " failed, " + tests.length + " total");
if (failed) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");
process.exit(0);
