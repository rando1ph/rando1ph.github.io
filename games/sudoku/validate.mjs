/* ------------------------------------------------------------------
   Sudoku — development validator (randolf.dev)
   Node-only. Not loaded by the site.

   Run:  node validate.mjs [perDifficulty]
   Defaults to 100 puzzles per difficulty.

   Verifies solver behaviour and generator output:
   - every puzzle has exactly one solution
   - givens never conflict
   - the logical solver completes every accepted puzzle
   - the graded band equals the requested difficulty
   - the stored solution matches solve()
   - seeds are reproducible
   - the logical solver stalls (does not guess) on an advanced puzzle
   ------------------------------------------------------------------ */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const E = require(join(__dirname, "sudoku-engine.js"));
const { findAnswerErrors } = require(join(__dirname, "sudoku.js"));

const PER = Number(process.argv[2] || 100);

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("  ok   " + name);
  } else {
    failures += 1;
    console.log("  FAIL " + name + (detail ? " — " + detail : ""));
  }
}

const SOLVED =
  "534678912672195348198342567859761423426853791713924856" +
  "961537284287419635345286179";
const PUZZLE =
  "530070000600195000098000060800060003400803001700020006" +
  "060000280000419005000080079";

function toBoard(str) {
  return str.split("").map((c) => (c === "." || c === "0" ? 0 : Number(c)));
}

console.log("Sudoku engine validation\n========================\n");
console.log("Solver unit checks");

/* --- solved grid ---------------------------------------------------- */
const solved = toBoard(SOLVED);
check("valid solved grid recognised", E.isSolved(solved));
check("solved grid has one solution", E.countSolutions(solved, 2) === 1);
check("solve() returns same grid", E.boardsEqual(E.solve(solved), solved));

/* --- valid incomplete unique puzzle --------------------------------- */
const puzzle = toBoard(PUZZLE);
check("known puzzle valid (no conflicts)", E.findConflicts(puzzle) === null);
check("known puzzle unique", E.countSolutions(puzzle, 2) === 1);
check("known puzzle solve matches solution", E.boardsEqual(E.solve(puzzle), solved));

/* --- answer checking (independent of rule conflicts) ---------------- */
const given = puzzle.map(Boolean);
const entries = puzzle.slice();
const answerErrors = () => findAnswerErrors(entries, solved, given);
check("Check ignores empty editable cells", answerErrors().length === 0);
entries[0] = 1; /* Even a mismatched given must be excluded. */
check("Check ignores given clues", answerErrors().length === 0);
entries[0] = puzzle[0];
entries[2] = solved[2];
check("Check ignores correct player values", answerErrors().length === 0);
entries[2] = 1;
check("wrong-answer fixture is locally legal", E.findConflicts(entries) === null);
check("Check catches a wrong but locally legal value", JSON.stringify(answerErrors()) === "[2]");
entries[2] = 5;
check("conflicting-answer fixture has a rule conflict", !!E.findConflicts(entries)[2]);
check("Check catches a wrong conflicting value", JSON.stringify(answerErrors()) === "[2]");
entries[3] = 1;
entries[5] = 2;
entries[6] = solved[6];
const beforeCheck = JSON.stringify([entries, solved, given]);
check("Check reports all mistakes and only mistakes", JSON.stringify(answerErrors()) === "[2,3,5]");
check("Check leaves all input arrays unchanged", JSON.stringify([entries, solved, given]) === beforeCheck);

/* --- multiple solutions --------------------------------------------- */
const empty = E.emptyBoard();
check("empty board reports multiple solutions", E.countSolutions(empty, 2) === 2);

/* --- impossible / conflicting givens -------------------------------- */
const conflict = toBoard(
  "110000000000000000000000000000000000000000000000000000000000000000000000000000000"
);
check("conflicting givens make board invalid", E.countSolutions(conflict, 2) === 0);
check("findConflicts flags conflicting givens", E.findConflicts(conflict) !== null);
const impossible = solved.slice();
impossible[0] = impossible[1]; /* duplicate inside a box/row */
check("impossible board has zero solutions", E.countSolutions(impossible, 2) === 0);

/* --- candidates ----------------------------------------------------- */
const cands = E.getCandidates(empty);
check("empty board candidates all digits", cands.every((m) => m === 0x1ff));
const candsSolved = E.getCandidates(solved);
check("solved board candidates empty", candsSolved.every((m) => m === 0));

/* --- naked single --------------------------------------------------- */
const oneHole = solved.slice();
oneHole[40] = 0;
let step = new E.Solver(oneHole).nextStep();
check(
  "naked single detected",
  step && step.technique === "nakedSingle" && step.digit === solved[40],
  step && step.technique
);

/* --- hidden single -------------------------------------------------- */
const hiddenBoard = E.emptyBoard();
hiddenBoard[0] = 0;
hiddenBoard[1] = 0;
hiddenBoard[2] = 2;
hiddenBoard[3] = 3;
hiddenBoard[4] = 4;
hiddenBoard[5] = 5;
hiddenBoard[6] = 6;
hiddenBoard[7] = 7;
hiddenBoard[8] = 0;
hiddenBoard[28] = 9; /* r3c1 — removes 9 from column 1 */
hiddenBoard[27] = 8; /* r3c0 — removes 8 from column 0 */
hiddenBoard[26] = 9; /* r2c8 — removes 9 from column 8 */
step = new E.Solver(hiddenBoard).nextStep();
check(
  "hidden single detected",
  step && step.technique === "hiddenSingle" && step.digit === 9 && step.cell === 0,
  step && step.technique + " d" + (step && step.digit)
);

/* --- stalling on an advanced puzzle (no guessing) ------------------- */
const inkala = toBoard(
  "800000000003600000070090200050007000000045700000100030001000068008500010090000400"
);
check("advanced puzzle has a unique solution", E.countSolutions(inkala, 2) === 1);
const inkalaGrade = E.gradeBoard(inkala);
check(
  "advanced puzzle stalls instead of guessing",
  inkalaGrade.solved === false && inkalaGrade.band === null,
  "solved=" + inkalaGrade.solved + " reason=" + inkalaGrade.reason
);

/* --- reproducibility ------------------------------------------------ */
const g1 = E.generateFromSeed("easy", 12345);
const g2 = E.generateFromSeed("easy", 12345);
check(
  "same seed reproduces same puzzle",
  g1 && g2 && E.boardsEqual(g1.puzzle, g2.puzzle) && E.boardsEqual(g1.solution, g2.solution)
);

/* --- generation ----------------------------------------------------- */
function solveTimeBoard(fn) {
  const t = process.hrtime.bigint();
  const v = fn();
  return { v, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

const summary = {};
for (const diff of E.DIFFICULTIES) {
  console.log("\nGenerating " + PER + " " + diff + " puzzles");
  const stats = {
    clues: [],
    attempts: [],
    score: [],
    hardest: {},
    ms: [],
    count: 0
  };
  for (let i = 0; i < PER; i += 1) {
    const base = (Math.random() * 0xffffffff) >>> 0;
    const run = solveTimeBoard(() =>
      E.generateForDifficulty(diff, base, { maxAttempts: 2000, timeBudgetMs: 60000 })
    );
    if (!run.v.ok) {
      failures += 1;
      console.log("  FAIL generation " + i + " (" + run.v.reason + ")");
      continue;
    }
    const p = run.v.result;
    const unique = E.countSolutions(p.puzzle, 2) === 1;
    const noConflict = E.findConflicts(p.puzzle) === null;
    const solvedOk = E.boardsEqual(E.solve(p.puzzle), p.solution);
    const grade = E.gradeBoard(p.puzzle);
    const bandOk = grade.solved && grade.band === diff;
    const notSolved = !E.isFull(p.puzzle);
    if (!unique || !noConflict || !solvedOk || !bandOk || !notSolved) {
      failures += 1;
      console.log(
        "  FAIL " + i +
          " unique=" + unique + " noConflict=" + noConflict +
          " solveMatch=" + solvedOk + " band=" + grade.band +
          " solved=" + grade.solved + " notSolved=" + notSolved
      );
      continue;
    }
    stats.count += 1;
    stats.clues.push(p.clues);
    stats.attempts.push(p.attempts);
    stats.score.push(grade.score);
    stats.ms.push(run.ms / Math.max(p.attempts, 1));
    stats.hardest[grade.hardest] = (stats.hardest[grade.hardest] || 0) + 1;
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const min = (a) => (a.length ? Math.min(...a) : 0);
  const max = (a) => (a.length ? Math.max(...a) : 0);
  summary[diff] = stats;
  console.log("  accepted        " + stats.count + "/" + PER);
  console.log(
    "  clues  min/avg/max   " +
      min(stats.clues) + " / " + avg(stats.clues).toFixed(1) + " / " + max(stats.clues)
  );
  console.log(
    "  attempts min/avg/max " +
      min(stats.attempts) + " / " + avg(stats.attempts).toFixed(1) + " / " + max(stats.attempts)
  );
  console.log("  score avg            " + avg(stats.score).toFixed(1));
  console.log("  ms per attempt       " + avg(stats.ms).toFixed(1));
  console.log("  hardest techniques   " + JSON.stringify(stats.hardest));
}

/* --- consecutive stress: hard uniqueness/validity ------------------- */
console.log("\nStress: 25 consecutive hard puzzles");
let stressBad = 0;
let stressMaxAttempts = 0;
for (let i = 0; i < 25; i += 1) {
  const res = E.generateForDifficulty("hard", (Math.random() * 0xffffffff) >>> 0, {
    maxAttempts: 3000,
    timeBudgetMs: 30000
  });
  if (!res.ok) {
    stressBad += 1;
    continue;
  }
  stressMaxAttempts = Math.max(stressMaxAttempts, res.result.attempts);
  const g = E.gradeBoard(res.result.puzzle);
  if (
    E.countSolutions(res.result.puzzle, 2) !== 1 ||
    E.findConflicts(res.result.puzzle) !== null ||
    !g.solved ||
    g.band !== "hard"
  ) {
    stressBad += 1;
  }
}
check("25 consecutive hard puzzles valid", stressBad === 0, stressBad + " bad");
console.log("  worst attempts        " + stressMaxAttempts);

console.log("\n================================");
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
