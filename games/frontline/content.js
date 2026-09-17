// Pure encounter data and seeded generation. No rendering or browser dependencies.
export const W = 420,
  H = 760,
  LANES = [94, 210, 326];
export const WEAPONS = [
  {
    name: "PULSE",
    interval: 0.52,
    damage: 1,
    speed: 610,
    spread: [0],
    color: "#64edff",
  },
  {
    name: "REPEATER",
    interval: 0.29,
    damage: 1.25,
    speed: 730,
    spread: [0],
    color: "#9bffdc",
  },
  {
    name: "TRIDENT",
    interval: 0.43,
    damage: 1.15,
    speed: 650,
    spread: [-0.13, 0, 0.13],
    color: "#ffdc86",
  },
];
export const ENEMIES = {
  grunt: { hp: 6, speed: 37, radius: 18, hurt: 2, points: 30 },
  runner: { hp: 4, speed: 69, radius: 14, hurt: 2, points: 40 },
  brute: { hp: 48, speed: 26, radius: 31, hurt: 4, points: 100 },
  elite: { hp: 75, speed: 30, radius: 26, hurt: 4, points: 180 },
};
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const BLOCKS = {
  welcome: {
    lanes: ["squad", null, "grunt"],
    threatBudget: 1,
    rewardBudget: 3,
    tags: ["opening"],
  },
  choice: {
    lanes: ["squad", "grunt", "weapon"],
    threatBudget: 2,
    rewardBudget: 3,
    tags: ["choice"],
  },
  patrol: {
    lanes: ["grunt", "squad", "grunt"],
    threatBudget: 3,
    rewardBudget: 2,
    tags: ["pressure"],
  },
  supply: {
    lanes: ["damage", "squad", null],
    threatBudget: 0,
    rewardBudget: 3,
    tags: ["recovery"],
  },
  rush: {
    lanes: ["runner", null, "squad"],
    threatBudget: 3,
    rewardBudget: 2,
    tags: ["fast"],
  },
  wall: {
    lanes: ["brute", "weapon", null],
    threatBudget: 5,
    rewardBudget: 1,
    tags: ["heavy"],
  },
  champion: {
    lanes: ["elite", "squad", "rapid"],
    threatBudget: 7,
    rewardBudget: 3,
    tags: ["elite"],
  },
  risk: {
    lanes: ["brute+squad", null, "grunt"],
    threatBudget: 6,
    rewardBudget: 4,
    tags: ["risk"],
  },
  crossfire: {
    lanes: ["runner", "squad", "elite"],
    threatBudget: 9,
    rewardBudget: 3,
    tags: ["mixed"],
  },
  recovery: {
    lanes: ["squad", "weapon", "rapid"],
    threatBudget: 0,
    rewardBudget: 4,
    tags: ["recovery"],
  },
};
// Fixed pacing and introductions; lane order and bounded details vary by seed.
export const LEVELS = [
  {
    name: "First light",
    subtitle: "Recruit scouts. Learn to hold the road.",
    boss: "warden",
    duration: 78,
    pool: ["grunt"],
    skeleton: [
      "welcome",
      "choice",
      "patrol",
      "supply",
      "patrol",
      "choice",
      "patrol",
      "recovery",
    ],
  },
  {
    name: "Supply line",
    subtitle: "Choose between more scouts and better weapons.",
    boss: "warden",
    duration: 80,
    pool: ["grunt"],
    skeleton: [
      "welcome",
      "choice",
      "patrol",
      "choice",
      "risk",
      "supply",
      "choice",
      "patrol",
      "recovery",
    ],
  },
  {
    name: "Red rush",
    subtitle: "Runners close the gap. Watch the flanks.",
    boss: "warden",
    duration: 82,
    pool: ["grunt", "runner"],
    skeleton: [
      "welcome",
      "choice",
      "rush",
      "patrol",
      "rush",
      "supply",
      "rush",
      "choice",
      "patrol",
      "recovery",
    ],
  },
  {
    name: "Heavy weather",
    subtitle: "Brutes take a beating. Bring firepower.",
    boss: "warden",
    duration: 84,
    pool: ["grunt", "runner", "brute"],
    skeleton: [
      "welcome",
      "choice",
      "wall",
      "rush",
      "supply",
      "risk",
      "wall",
      "choice",
      "patrol",
      "recovery",
    ],
  },
  {
    name: "Violet signal",
    subtitle: "Elites launch shards. Keep moving.",
    boss: "warden",
    duration: 85,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "champion",
      "supply",
      "wall",
      "rush",
      "choice",
      "champion",
      "patrol",
      "recovery",
    ],
  },
  {
    name: "The fracture",
    subtitle: "Meet the Rift Maw. Two lanes can fall.",
    boss: "maw",
    duration: 86,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "wall",
      "rush",
      "supply",
      "champion",
      "risk",
      "choice",
      "crossfire",
      "recovery",
    ],
  },
  {
    name: "Narrow escape",
    subtitle: "A guarded cache is worth the risk.",
    boss: "warden",
    duration: 88,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "risk",
      "crossfire",
      "supply",
      "risk",
      "wall",
      "champion",
      "choice",
      "risk",
      "recovery",
    ],
  },
  {
    name: "Nightfall",
    subtitle: "Mixed patrols. No easy lane to hold.",
    boss: "maw",
    duration: 90,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "crossfire",
      "wall",
      "supply",
      "champion",
      "risk",
      "crossfire",
      "choice",
      "champion",
      "recovery",
    ],
  },
  {
    name: "Last relay",
    subtitle: "Build a squad that can survive the siege.",
    boss: "warden",
    duration: 92,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "champion",
      "crossfire",
      "supply",
      "risk",
      "crossfire",
      "wall",
      "choice",
      "champion",
      "crossfire",
      "recovery",
    ],
  },
  {
    name: "Daybreak",
    subtitle: "One final push. Bring everyone home.",
    boss: "maw",
    duration: 94,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "crossfire",
      "champion",
      "supply",
      "risk",
      "crossfire",
      "champion",
      "choice",
      "wall",
      "crossfire",
      "recovery",
    ],
  },
];
export function endlessEncounter(seed, wave, time) {
  const rng = random(seed),
    band = Math.min(12, Math.floor(time / 45));
  const budget = Math.min(12, 2 + band * 2);
  const eligible = Object.keys(BLOCKS).filter(
    (k) =>
      BLOCKS[k].threatBudget <= budget &&
      !["recovery", "supply", "welcome"].includes(k),
  );
  // Every fourth block is recovery. The first two are always learnable choices.
  const key =
    wave === 0
      ? "welcome"
      : wave === 1
        ? "choice"
        : wave % 4 === 3
          ? "recovery"
          : eligible[Math.floor(rng() * eligible.length)];
  const block = encounter(key, rng() * 4294967296, band);
  // Late bands add fast escorts to existing threat lanes, preserving a clear lane.
  if (band >= 4 && !block.tags.includes("recovery")) {
    const heavy = block.items.find(
      (p) => p.kind === "elite" || p.kind === "brute",
    );
    if (heavy)
      block.items.push({
        kind: "runner",
        x: heavy.x + 12,
        y: heavy.y - 75,
        value: 1,
        scale: 1 + band * 0.1,
      });
  }
  return { ...block, band, budget };
}

export function encounter(key, seed, band = 0, pool = Object.keys(ENEMIES)) {
  const rng = random(seed),
    block = BLOCKS[key];
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const items = [];
  block.lanes.forEach((slot, i) => {
    if (!slot) return;
    slot.split("+").forEach((raw, layer) => {
      let kind = raw;
      if (ENEMIES[kind] && !pool.includes(kind)) kind = pool[0];
      const enemy = !!ENEMIES[kind];
      const count =
        enemy && (kind === "grunt" || kind === "runner")
          ? 1 + Math.min(2, Math.floor(rng() * (1 + band * 0.4)))
          : 1;
      for (let n = 0; n < count; n++)
        items.push({
          kind,
          x: LANES[order[i]] + (enemy ? (rng() - 0.5) * 20 : 0),
          y: -30 - n * 43 - layer * 105,
          value:
            kind === "squad"
              ? key === "risk"
                ? 4
                : 2 + Math.floor(rng() * 2)
              : 1,
          scale: 1 + band * 0.11 + rng() * 0.08,
        });
    });
  });
  return {
    key,
    items,
    threatBudget: block.threatBudget,
    rewardBudget: block.rewardBudget,
    tags: block.tags,
  };
}
export function campaign(seed, level = 0) {
  const spec = LEVELS[level],
    rng = random(seed);
  return spec.skeleton.map((key, i) => ({
    at: 1 + (i * (spec.duration - 16)) / spec.skeleton.length,
    ...encounter(key, rng() * 4294967296, level * 0.6, spec.pool),
  }));
}
