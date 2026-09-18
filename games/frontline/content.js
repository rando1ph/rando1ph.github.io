// Pure encounter data and seeded generation. No rendering or browser dependencies.
export const W = 420,
  H = 760,
  LANES = [94, 210, 326];
export const WEAPONS = [
  {
    name: "PULSE",
    interval: 0.44,
    damage: 1,
    speed: 1040,
    spread: [0],
    color: "#64edff",
  },
  {
    name: "REPEATER",
    interval: 0.24,
    damage: 1.25,
    speed: 1420,
    spread: [0],
    color: "#9bffdc",
  },
  {
    name: "TRIDENT",
    interval: 0.42,
    damage: 1.15,
    speed: 1160,
    spread: [-0.1, 0, 0.1],
    color: "#ffdc86",
  },
];
export const ENEMIES = {
  grunt: { hp: 6, speed: 49, radius: 18, hurt: 2, points: 30 },
  runner: { hp: 4, speed: 92, radius: 14, hurt: 2, points: 40 },
  brute: { hp: 48, speed: 32, radius: 31, hurt: 4, points: 100 },
  elite: { hp: 75, speed: 40, radius: 26, hurt: 4, points: 180 },
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
// A lane may contain a pack or staggered layers, keeping wave composition data-driven.
const pack = (kind, min, max, offset = 0) => ({ kind, min, max, offset });
export const BLOCKS = {
  welcome: {
    lanes: ["squad", null, [pack("grunt", 1, 2)]],
    threatBudget: 1,
    rewardBudget: 3,
    tags: ["opening"],
  },
  choice: {
    lanes: ["squad", [pack("grunt", 2, 3)], "weapon"],
    threatBudget: 2,
    rewardBudget: 3,
    tags: ["choice"],
  },
  patrol: {
    lanes: [[pack("grunt", 2, 3)], "squad", [pack("grunt", 2, 3)]],
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
    lanes: [[pack("runner", 2, 3)], null, "squad"],
    threatBudget: 3,
    rewardBudget: 2,
    tags: ["fast"],
  },
  wall: {
    lanes: [[pack("brute", 1, 1)], "weapon", "squad"],
    threatBudget: 5,
    rewardBudget: 3,
    tags: ["heavy", "conflict"],
  },
  champion: {
    lanes: [[pack("elite", 1, 1), pack("grunt", 2, 3, 80)], "squad", "rapid"],
    threatBudget: 7,
    rewardBudget: 3,
    tags: ["elite", "conflict"],
  },
  risk: {
    lanes: [
      [pack("brute", 1, 1), pack("squad", 1, 1, 110)],
      null,
      [pack("grunt", 2, 3)],
    ],
    threatBudget: 6,
    rewardBudget: 4,
    tags: ["risk"],
  },
  amplify: {
    lanes: ["amplifier", [pack("grunt", 2, 3)], "squad"],
    threatBudget: 3,
    rewardBudget: 4,
    tags: ["panel", "conflict"],
  },
  investment: {
    lanes: ["amplifier", [pack("grunt", 3, 4)], "weapon"],
    threatBudget: 5,
    rewardBudget: 4,
    tags: ["panel", "conflict"],
  },
  crossfire: {
    lanes: [
      [pack("runner", 2, 3)],
      "amplifier",
      [pack("elite", 1, 1), pack("grunt", 2, 3, 90)],
    ],
    threatBudget: 9,
    rewardBudget: 4,
    tags: ["mixed", "conflict"],
  },
  swarm: {
    lanes: [[pack("grunt", 4, 5)], "squad", [pack("grunt", 3, 4)]],
    threatBudget: 8,
    rewardBudget: 3,
    tags: ["horde"],
  },
  stampede: {
    lanes: [[pack("runner", 3, 4)], "amplifier", [pack("grunt", 3, 4, 70)]],
    threatBudget: 10,
    rewardBudget: 5,
    tags: ["horde", "conflict"],
  },
  escort: {
    lanes: [
      [pack("brute", 1, 1, 100), pack("runner", 3, 4)],
      "weapon",
      [pack("grunt", 3, 4)],
    ],
    threatBudget: 11,
    rewardBudget: 2,
    tags: ["horde", "conflict"],
  },
  screen: {
    lanes: [
      [pack("grunt", 4, 5), pack("elite", 1, 1, 180)],
      "amplifier",
      [pack("grunt", 3, 4, 90)],
    ],
    threatBudget: 13,
    rewardBudget: 5,
    tags: ["horde", "elite", "conflict"],
  },
  split: {
    lanes: [
      [pack("runner", 3, 4), pack("grunt", 3, 4, 230)],
      "squad",
      [pack("brute", 1, 1), pack("runner", 2, 3, 190)],
    ],
    threatBudget: 14,
    rewardBudget: 3,
    tags: ["horde", "staggered"],
  },
  siege: {
    lanes: [
      [pack("elite", 1, 1, 150), pack("grunt", 4, 5)],
      "amplifier",
      [pack("elite", 1, 1, 200), pack("runner", 3, 4)],
    ],
    threatBudget: 17,
    rewardBudget: 5,
    tags: ["horde", "elite", "conflict"],
  },
  priority: {
    lanes: [
      "amplifier",
      [
        pack("brute", 1, 1, 150),
        pack("grunt", 4, 5),
        pack("runner", 2, 3, 190),
      ],
      "weapon",
    ],
    threatBudget: 12,
    rewardBudget: 5,
    tags: ["horde", "conflict"],
  },
  recovery: {
    lanes: ["squad", "squad", null],
    threatBudget: 0,
    rewardBudget: 4,
    tags: ["recovery"],
  },
};
// Preserve the ten sector identities; introduce V2 interactions progressively.
export const LEVELS = [
  {
    name: "First light",
    subtitle: "Build your squad. Break the first siege.",
    boss: "warden",
    duration: 68,
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
    subtitle: "Shoot amplifiers. Turn danger into recruits.",
    boss: "warden",
    duration: 70,
    pool: ["grunt"],
    skeleton: [
      "welcome",
      "amplify",
      "choice",
      "patrol",
      "supply",
      "amplify",
      "patrol",
      "amplify",
      "recovery",
    ],
  },
  {
    name: "Red rush",
    subtitle: "Break upgrade crates before the runners arrive.",
    boss: "warden",
    duration: 72,
    pool: ["grunt", "runner"],
    skeleton: [
      "welcome",
      "choice",
      "amplify",
      "rush",
      "supply",
      "investment",
      "rush",
      "patrol",
      "choice",
      "recovery",
    ],
  },
  {
    name: "Heavy weather",
    subtitle: "Your bullets cannot solve every lane.",
    boss: "warden",
    duration: 74,
    pool: ["grunt", "runner", "brute"],
    skeleton: [
      "welcome",
      "choice",
      "investment",
      "wall",
      "supply",
      "amplify",
      "rush",
      "investment",
      "wall",
      "patrol",
      "recovery",
    ],
  },
  {
    name: "Violet signal",
    subtitle: "The horde is coming. Pick your firing line.",
    boss: "warden",
    duration: 76,
    pool: ["grunt", "runner", "brute"],
    skeleton: [
      "welcome",
      "choice",
      "amplify",
      "patrol",
      "swarm",
      "supply",
      "investment",
      "escort",
      "amplify",
      "stampede",
      "recovery",
    ],
  },
  {
    name: "The fracture",
    subtitle: "Elites shelter behind the horde.",
    boss: "maw",
    duration: 78,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "amplify",
      "champion",
      "swarm",
      "supply",
      "investment",
      "screen",
      "crossfire",
      "escort",
      "recovery",
    ],
  },
  {
    name: "Narrow escape",
    subtitle: "Invest in panels while the road closes in.",
    boss: "warden",
    duration: 80,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "investment",
      "swarm",
      "priority",
      "supply",
      "crossfire",
      "screen",
      "amplify",
      "split",
      "recovery",
    ],
  },
  {
    name: "Nightfall",
    subtitle: "Staggered hordes. Elite screens. Keep a way out.",
    boss: "maw",
    duration: 82,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "amplify",
      "escort",
      "screen",
      "supply",
      "priority",
      "split",
      "crossfire",
      "siege",
      "recovery",
    ],
  },
  {
    name: "Last relay",
    subtitle: "Save your firepower for what matters most.",
    boss: "warden",
    duration: 84,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "investment",
      "swarm",
      "screen",
      "supply",
      "priority",
      "siege",
      "investment",
      "split",
      "screen",
      "recovery",
    ],
  },
  {
    name: "Daybreak",
    subtitle: "Grow. Hold. Break through the final horde.",
    boss: "maw",
    duration: 86,
    pool: ["grunt", "runner", "brute", "elite"],
    skeleton: [
      "welcome",
      "choice",
      "amplify",
      "escort",
      "screen",
      "supply",
      "priority",
      "siege",
      "investment",
      "split",
      "siege",
      "recovery",
    ],
  },
];
export function pacing(band = 0, phase = 0.5) {
  return {
    enemySpeed: 1 + Math.min(0.3, band * 0.035) + phase * 0.12,
    objectSpeed: 80 + Math.min(14, band * 1.8),
    interval: Math.max(3.5, 6.3 - band * 0.32),
    budget: Math.min(22, 3 + band * 3),
  };
}
export function encounter(
  key,
  seed,
  band = 0,
  pool = Object.keys(ENEMIES),
  options = {},
) {
  const rng = random(seed),
    block = BLOCKS[key],
    order = [0, 1, 2],
    items = [];
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pace = pacing(band, options.phase ?? 0.5);
  block.lanes.forEach((slot, i) => {
    if (!slot) return;
    const layers = Array.isArray(slot)
      ? slot
      : slot.split("+").map((kind, layer) => pack(kind, 1, 1, layer * 105));
    for (const layer of layers) {
      let kind = layer.kind;
      if (ENEMIES[kind] && !pool.includes(kind)) kind = pool[0];
      const enemy = !!ENEMIES[kind];
      const count =
        layer.min +
        Math.floor(rng() * (layer.max - layer.min + 1)) +
        (enemy && kind === "grunt" && block.tags.includes("horde")
          ? Math.min(2, Math.floor(band / 4))
          : 0);
      for (let n = 0; n < count; n++) {
        const x =
          LANES[order[i]] +
          (enemy ? ((n % 2) * 2 - 1) * 16 + (rng() - 0.5) * 8 : 0);
        const item = {
          kind,
          x,
          y: -35 - Math.floor(n / 2) * 53 - (layer.offset || 0),
          value:
            kind === "squad"
              ? key === "risk"
                ? 4
                : 2 + Math.floor(rng() * 2)
              : 1,
          scale: 1 + Math.min(0.5, band * 0.055) + rng() * 0.06,
          speedScale: pace.enemySpeed,
          speed: enemy ? undefined : pace.objectSpeed,
        };
        if (kind === "amplifier") {
          const variant = options.intro
            ? "mild"
            : ["mild", "deep", "positive"][Math.floor(rng() * 3)];
          item.value =
            variant === "positive"
              ? 2 + Math.floor(rng() * 2)
              : variant === "deep"
                ? -(10 + Math.floor(rng() * 5))
                : -(4 + Math.floor(rng() * 4));
          item.minValue = -16;
          item.maxValue =
            variant === "deep" ? 12 : variant === "positive" ? 6 : 8;
          item.variant = variant;
        }
        if (["weapon", "damage", "rapid"].includes(kind)) {
          item.crated = options.crates !== false;
          item.hp =
            (kind === "weapon" ? 14 : 10) +
            Math.floor(rng() * 5) +
            Math.min(8, Math.floor(band));
        }
        items.push(item);
      }
    }
  });
  return {
    key,
    items,
    threatBudget: block.threatBudget,
    rewardBudget: block.rewardBudget,
    tags: block.tags,
    band,
    pace,
  };
}
export function campaign(seed, level = 0) {
  const spec = LEVELS[level],
    rng = random(seed);
  // Build -> tighten -> recover -> surge. Nonuniform gaps replace V1's flat spacing.
  const weights = spec.skeleton.map((key, i) =>
    i < 2
      ? 1.35
      : key === "supply"
        ? 1.05
        : i > spec.skeleton.length * 0.6
          ? 0.78
          : 1,
  );
  const total = weights.slice(1).reduce((a, b) => a + b, 0),
    window = spec.duration - 17;
  let at = 1;
  return spec.skeleton.map((key, i) => {
    if (i) at += (weights[i] / total) * (window - 1);
    const phase = i / (spec.skeleton.length - 1),
      band = (level * 0.55 + phase * 1.5) * (i < 2 ? 0.25 : 1);
    return {
      at,
      ...encounter(key, rng() * 4294967296, band, spec.pool, {
        phase,
        crates: level >= 2,
        intro: level === 1,
      }),
    };
  });
}
export function endlessEncounter(seed, wave, time) {
  const rng = random(seed),
    band = Math.min(12, Math.floor(time / 32)),
    pace = pacing(band);
  const hordes = Object.keys(BLOCKS).filter(
    (k) =>
      BLOCKS[k].tags.includes("horde") && BLOCKS[k].threatBudget <= pace.budget,
  );
  const choices = Object.keys(BLOCKS).filter(
    (k) =>
      !BLOCKS[k].tags.includes("horde") &&
      !["welcome", "recovery", "supply"].includes(k) &&
      BLOCKS[k].threatBudget <= pace.budget,
  );
  let key;
  if (wave === 0) key = "welcome";
  else if (wave === 1) key = "choice";
  else if (wave % 5 === 4) key = "recovery";
  else if (
    hordes.length &&
    (wave % 5 === 3 || rng() < Math.min(0.65, 0.22 + band * 0.055))
  )
    key = hordes[Math.floor(rng() * hordes.length)];
  else key = choices[Math.floor(rng() * choices.length)];
  return {
    ...encounter(key, rng() * 4294967296, band),
    band,
    budget: pace.budget,
  };
}
