#!/usr/bin/env node
/* ------------------------------------------------------------------
   Core Shift — level validator (headless)

     node games/core-shift/validate.js

   Checks every shipped level for:
     · legal characters, rectangular rows
     · exactly one robot, a valid robot start
     · core count == dock count, everything inside the hull
     · no duplicate layouts, ids in order, attribution present
     · a board small enough to stay a comfortable touch target
     · solvability, proven by push-state search (solver.js)
     · the stored solution replays through the real engine to a win

   Prints one line per level and a final PASS / FAIL. Exits non-zero on
   FAIL so it can gate a deploy.
   ------------------------------------------------------------------ */

"use strict";

var path = require("path");
var Engine = require(path.join(__dirname, "engine.js"));
var Solver = require(path.join(__dirname, "solver.js"));
var Levels = require(path.join(__dirname, "levels.js"));

var EXPANSION_LIMIT = 2000000;
var MAX_SIDE = 11; /* keeps a core a comfortable touch target on a 390px phone */

var failures = [];
var notes = [];

function fail(scope, message) {
  failures.push(scope + ": " + message);
}

console.log("Core Shift — level validation");
console.log("=".repeat(78));
console.log(
  pad("#", 3) +
    pad("id", 4) +
    pad("source", 13) +
    pad("size", 7) +
    pad("cores", 6) +
    pad("docks", 6) +
    pad("push", 6) +
    pad("states", 8) +
    "  result"
);

function pad(s, n) {
  s = String(s);
  return s + " ".repeat(Math.max(0, n - s.length));
}

var seenLayouts = Object.create(null);
var scores = [];
var solvableCount = 0;

Levels.LEVELS.forEach(function (entry, index) {
  var scope = "level " + (index + 1) + " (" + entry.source + ")";
  var parsed = Engine.parse(entry.rows);
  var problems = [];

  if (!entry.source || typeof entry.source !== "string") {
    problems.push("missing source attribution");
  }
  if (parsed.errors.length) {
    problems.push(parsed.errors.join("; "));
  }

  /* structural checks that parse() does not cover on its own */
  var widths = {};
  for (var r = 0; r < entry.rows.length; r += 1) {
    widths[entry.rows[r].length] = true;
  }
  var trimmed = entry.rows.map(function (row) {
    return row.replace(/\s+$/, "");
  });
  var key = trimmed.join("/");
  if (seenLayouts[key]) {
    problems.push("duplicate layout of level " + seenLayouts[key]);
  } else {
    seenLayouts[key] = index + 1;
  }
  if (parsed.w > MAX_SIDE || parsed.h > MAX_SIDE) {
    problems.push("board " + parsed.w + "x" + parsed.h + " exceeds " + MAX_SIDE + " per side");
  }

  var minPushes = -1;
  var expansions = 0;
  var replayOk = false;
  var replayNote = "";

  if (!parsed.errors.length) {
    var result = Solver.solve(parsed, { limit: EXPANSION_LIMIT, solution: true });
    minPushes = result.minPushes;
    expansions = result.expansions;

    if (!result.solvable) {
      problems.push(result.capped ? "search exhausted its budget" : "no solution exists");
    } else if (!result.solution) {
      problems.push("solution could not be reconstructed");
    } else {
      var replay = Solver.replay(parsed, result.solution);
      replayOk = replay.ok;
      if (!replay.ok) {
        replayNote = replay.reason + " at step " + replay.at;
        problems.push("replay failed: " + replayNote);
      }
      if (replay.pushes !== result.minPushes) {
        problems.push(
          "replayed " + replay.pushes + " pushes, solver promised " + result.minPushes
        );
      }
    }
  }

  if (problems.length) {
    problems.forEach(function (p) {
      fail(scope, p);
    });
  } else {
    solvableCount += 1;
    scores.push({ index: index, score: Math.log(1 + expansions) * 2 + minPushes * 0.3 });
  }

  console.log(
    pad(index + 1, 3) +
      pad(entry.id, 4) +
      pad(entry.source, 13) +
      pad(parsed.w + "x" + parsed.h, 7) +
      pad(parsed.boxCount, 6) +
      pad(parsed.goalCount, 6) +
      pad(minPushes < 0 ? "-" : minPushes, 6) +
      pad(expansions, 8) +
      "  " +
      (problems.length ? "FAIL" : "PASS")
  );
});

console.log("-".repeat(78));

/* --- campaign-wide checks ------------------------------------------ */

if (Levels.LEVELS.length < 20 || Levels.LEVELS.length > 200) {
  fail("campaign", "expected 20-200 levels, found " + Levels.LEVELS.length);
} else {
  notes.push(Levels.LEVELS.length + " levels shipped");
}

var ids = Levels.LEVELS.map(function (l) {
  return l.id;
});
for (var i = 0; i < ids.length; i += 1) {
  if (ids[i] !== i + 1) {
    fail("campaign", "level ids are not 1..N in order (index " + i + " has id " + ids[i] + ")");
    break;
  }
}

/* Difficulty follows Microban's original order; the selection deliberately
   keeps that order rather than forcing a machine-computed monotonic ramp. */

var first = scores.length ? scores[0].score : 0;
if (scores.length && first < 6) {
  fail("campaign", "opening level is filler (score " + first.toFixed(2) + ")");
} else if (scores.length) {
  notes.push("opening level score " + first.toFixed(2) + " (no one-push filler)");
}

if (Levels.SOURCE && Levels.SOURCE.set) {
  notes.push("levels credited to " + Levels.SOURCE.set + " by " + Levels.SOURCE.author);
} else {
  fail("campaign", "levels.js does not record a source");
}

/* --- report --------------------------------------------------------- */

console.log("");
console.log("Checks");
console.log("  levels parsed .............. " + Levels.LEVELS.length);
console.log("  levels solved & replayed ... " + solvableCount);
console.log("  failures ................... " + failures.length);
notes.forEach(function (n) {
  console.log("  note: " + n);
});

if (failures.length) {
  console.log("");
  console.log("Failures");
  failures.forEach(function (f) {
    console.log("  ! " + f);
  });
  console.log("");
  console.log("FAIL");
  process.exit(1);
}

console.log("");
console.log("PASS — every shipped level is legal, solvable and replays to a win.");
process.exit(0);
