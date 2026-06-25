import type { MemberOut, ReactionOut } from "./api/types";

type Vec2 = [number, number];

export type LateralMemberSideReaction = {
  node: number;
  side: "left" | "center" | "right";
  Rx: number;
};

const DEFAULT_TOLERANCE = 1e-3;

export function lateralMemberSideReactions({
  nodes,
  members,
  rxSupportNodes,
  reactions,
  tolerance = DEFAULT_TOLERANCE,
}: {
  nodes: Vec2[];
  members: MemberOut[];
  rxSupportNodes: Iterable<number>;
  reactions: ReactionOut[];
  tolerance?: number;
}): LateralMemberSideReaction[] {
  const restrained = new Set(rxSupportNodes);
  if (restrained.size === 0) return [];

  const netRxByNode = new Map(
    reactions.map((reaction) => [reaction.node, reaction.Rx]),
  );
  const byNodeSide = new Map<string, LateralMemberSideReaction>();

  const add = (
    node: number,
    otherNode: number,
    member: MemberOut,
    axial: number,
    shear: number,
  ) => {
    if (!restrained.has(node)) return;
    if (!nodes[node] || !nodes[otherNode]) return;
    const rx = member.c * axial - member.s * shear;
    if (!Number.isFinite(rx) || Math.abs(rx) <= tolerance) return;
    const side = memberSide(nodes[node], nodes[otherNode], tolerance);
    const key = `${node}:${side}`;
    const previous = byNodeSide.get(key);
    if (previous) previous.Rx += rx;
    else byNodeSide.set(key, { node, side, Rx: rx });
  };

  members.forEach((member) => {
    add(member.i, member.j, member, member.endForces.Ni, member.endForces.Vi);
    add(member.j, member.i, member, member.endForces.Nj, member.endForces.Vj);
  });

  const byNode = new Map<number, LateralMemberSideReaction[]>();
  for (const reaction of byNodeSide.values()) {
    if (Math.abs(reaction.Rx) <= tolerance) continue;
    const list = byNode.get(reaction.node) ?? [];
    list.push(reaction);
    byNode.set(reaction.node, list);
  }

  const out: LateralMemberSideReaction[] = [];
  for (const [node, sideReactions] of byNode.entries()) {
    const netRx = netRxByNode.get(node) ?? 0;
    if (Math.abs(netRx) > tolerance) continue;
    if (sideReactions.length < 2) continue;
    const hasPositive = sideReactions.some(
      (reaction) => reaction.Rx > tolerance,
    );
    const hasNegative = sideReactions.some(
      (reaction) => reaction.Rx < -tolerance,
    );
    if (!hasPositive || !hasNegative) continue;
    out.push(...sideReactions.sort(compareSideReactions));
  }
  return out;
}

function memberSide(
  node: Vec2,
  otherNode: Vec2,
  tolerance: number,
): LateralMemberSideReaction["side"] {
  const dx = otherNode[0] - node[0];
  if (dx < -tolerance) return "left";
  if (dx > tolerance) return "right";
  return "center";
}

function compareSideReactions(
  a: LateralMemberSideReaction,
  b: LateralMemberSideReaction,
): number {
  return sideOrder(a.side) - sideOrder(b.side);
}

function sideOrder(side: LateralMemberSideReaction["side"]): number {
  if (side === "left") return 0;
  if (side === "center") return 1;
  return 2;
}
