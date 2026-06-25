import type { Member, Vec2 } from "./solver";
import type { CombinedLoads } from "./load-combinations";

export type LoadResultantAudit = {
  pointFx: number;
  pointFy: number;
  distributedFy: number;
  globalFx: number;
  globalFy: number;
  distributedLocalX: number;
  distributedLocalXPositive: number;
  distributedLocalXNegative: number;
  distributedLocalXAbs: number;
  distributedLocalY: number;
  distributedLocalYAbs: number;
};

export function loadResultantAudit({
  nodes,
  members,
  loads,
}: {
  nodes: Vec2[];
  members: Member[];
  loads: CombinedLoads;
}): LoadResultantAudit {
  const audit: LoadResultantAudit = {
    pointFx: 0,
    pointFy: 0,
    distributedFy: 0,
    globalFx: 0,
    globalFy: 0,
    distributedLocalX: 0,
    distributedLocalXPositive: 0,
    distributedLocalXNegative: 0,
    distributedLocalXAbs: 0,
    distributedLocalY: 0,
    distributedLocalYAbs: 0,
  };

  for (const [, fx, fy] of loads.pointLoads) {
    audit.pointFx += fx;
    audit.pointFy += fy;
  }

  for (const [memberIndex, wi, wj, , projected] of loads.distLoads) {
    const member = members[memberIndex];
    if (!member) continue;
    const a = nodes[member[0]];
    const b = nodes[member[1]];
    if (!a || !b) continue;

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) continue;

    const projectedScale = projected ? Math.abs(dx) / length : 1;
    const wiGlobal = wi * projectedScale;
    const wjGlobal = wj * projectedScale;
    const distributedFy = ((wiGlobal + wjGlobal) / 2) * length;
    const c = dx / length;
    const s = dy / length;
    const localX = distributedFy * s;
    const localY = distributedFy * c;

    audit.distributedFy += distributedFy;
    audit.distributedLocalX += localX;
    audit.distributedLocalXAbs += Math.abs(localX);
    audit.distributedLocalY += localY;
    audit.distributedLocalYAbs += Math.abs(localY);
    if (localX >= 0) audit.distributedLocalXPositive += localX;
    else audit.distributedLocalXNegative += localX;
  }

  audit.globalFx = audit.pointFx;
  audit.globalFy = audit.pointFy + audit.distributedFy;
  return audit;
}
