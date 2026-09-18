export function pilot(g, style = "balanced") {
  const lanes = [94, 210, 326];
  if (g.boss?.attack) {
    g.target = lanes
      .filter((x) => !g.boss.attack.lanes.includes(x))
      .sort((a, b) => Math.abs(a - g.x) - Math.abs(b - g.x))[0];
    return;
  }
  if (style === "idle") {
    g.target = 210;
    return;
  }
  let candidates = lanes.map((x) => ({ x, score: -Math.abs(x - g.x) * 0.012 }));
  if (g.boss) candidates.push({ x: g.boss.x, score: 12 });
  for (const c of candidates) {
    for (const e of g.enemies)
      if (e.y > 55 && Math.abs(e.x - c.x) < 48) {
        c.score += (e.y / 760) * (style === "resources" ? 2 : 10);
        if (e.y > 570 && e.hp > g.squad * 1.2) c.score -= 32;
      }
    for (const p of g.pickups)
      if (!p.done && p.y > 60 && p.y < 700 && Math.abs(p.x - c.x) < 35) {
        const near = Math.max(0, 1 - Math.abs(520 - p.y) / 600);
        if (p.type === "panel") {
          if (p.value < 0 && p.y > 535) c.score -= 45;
          else
            c.score +=
              (style === "combat" ? 3 : 8) * near +
              (p.value > 0 && p.y > 430 ? 10 : 0);
        } else if (p.type === "crate") {
          if (p.y > 535 && p.hp > g.squad * 1.3) c.score -= 30;
          else c.score += near * (p.kind === "weapon" && g.weapon < 2 ? 19 : 5);
        } else
          c.score +=
            near *
            (p.kind === "weapon" && g.weapon < 2
              ? 25
              : p.kind === "squad"
                ? style === "combat"
                  ? 6
                  : 19
                : 7);
      }
  }
  g.target = candidates.sort((a, b) => b.score - a.score)[0].x;
}
