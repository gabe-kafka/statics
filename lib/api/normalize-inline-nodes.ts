import type { SolveRequest } from "./types";

type Segment = {
  originalMember: number;
  member: number;
  t0: number;
  t1: number;
};

type Cut = {
  node: number;
  t: number;
};

const GEOMETRY_TOLERANCE = 1e-7;
const PARAM_TOLERANCE = 1e-9;

export function normalizeInlineMemberNodes(req: SolveRequest): SolveRequest {
  if (!canNormalizeGeometry(req) || hasInvalidOriginalMemberRefs(req)) {
    return req;
  }

  const members: SolveRequest["members"] = [];
  const segmentsByOriginal = new Map<number, Segment[]>();

  req.members.forEach((member, originalMember) => {
    const cuts = inlineCuts(req.nodes, member.i, member.j);
    const segments: Segment[] = [];

    for (let c = 0; c < cuts.length - 1; c++) {
      const a = cuts[c];
      const b = cuts[c + 1];
      if (a.node === b.node || Math.abs(b.t - a.t) < PARAM_TOLERANCE) {
        continue;
      }

      const nextMember = members.length;
      members.push({
        i: a.node,
        j: b.node,
        E: member.E,
        I: member.I,
        A: member.A,
      });
      segments.push({
        originalMember,
        member: nextMember,
        t0: a.t,
        t1: b.t,
      });
    }

    segmentsByOriginal.set(originalMember, segments);
  });

  return {
    ...req,
    members,
    distLoads: remapDistributedLoads(req.distLoads, segmentsByOriginal),
    uniformSprings: remapUniformSprings(req.uniformSprings, segmentsByOriginal),
    hinges: remapHinges(req.hinges, segmentsByOriginal),
  };
}

function canNormalizeGeometry(req: SolveRequest): boolean {
  if (!req || typeof req !== "object") return false;
  if (!Array.isArray(req.nodes) || !Array.isArray(req.members)) return false;

  for (const node of req.nodes) {
    if (
      !Array.isArray(node) ||
      node.length !== 2 ||
      !Number.isFinite(node[0]) ||
      !Number.isFinite(node[1])
    ) {
      return false;
    }
  }

  for (const member of req.members) {
    if (
      !member ||
      typeof member !== "object" ||
      !Number.isInteger(member.i) ||
      !Number.isInteger(member.j) ||
      member.i < 0 ||
      member.j < 0 ||
      member.i >= req.nodes.length ||
      member.j >= req.nodes.length ||
      member.i === member.j ||
      !Number.isFinite(member.E) ||
      !Number.isFinite(member.I) ||
      !Number.isFinite(member.A)
    ) {
      return false;
    }
  }

  return true;
}

function hasInvalidOriginalMemberRefs(req: SolveRequest): boolean {
  const validMember = (member: unknown) =>
    Number.isInteger(member) &&
    (member as number) >= 0 &&
    (member as number) < req.members.length;

  for (const load of req.distLoads ?? []) {
    if (!validMember(load.member)) return true;
  }
  for (const spring of req.uniformSprings ?? []) {
    if (!validMember(spring.member)) return true;
  }
  for (const hinge of req.hinges ?? []) {
    if (hinge.member !== undefined && !validMember(hinge.member)) return true;
  }

  return false;
}

function inlineCuts(
  nodes: SolveRequest["nodes"],
  i: number,
  j: number,
): Cut[] {
  const a = nodes[i];
  const b = nodes[j];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const lengthSquared = length * length;
  const distanceTolerance = GEOMETRY_TOLERANCE * Math.max(1, length);
  const cuts: Cut[] = [
    { node: i, t: 0 },
    { node: j, t: 1 },
  ];

  nodes.forEach((p, node) => {
    if (node === i || node === j) return;
    const px = p[0] - a[0];
    const py = p[1] - a[1];
    const t = (px * dx + py * dy) / lengthSquared;
    if (t <= PARAM_TOLERANCE || t >= 1 - PARAM_TOLERANCE) return;

    const cross = px * dy - py * dx;
    const distance = Math.abs(cross) / length;
    if (distance <= distanceTolerance) {
      cuts.push({ node, t });
    }
  });

  return cuts
    .sort((left, right) => left.t - right.t)
    .filter((cut, index, sorted) => {
      if (index === 0) return true;
      const prev = sorted[index - 1];
      return Math.abs(cut.t - prev.t) > PARAM_TOLERANCE;
    });
}

function remapDistributedLoads(
  loads: SolveRequest["distLoads"],
  segmentsByOriginal: Map<number, Segment[]>,
): SolveRequest["distLoads"] {
  if (!loads) return undefined;
  const out: NonNullable<SolveRequest["distLoads"]> = [];

  for (const load of loads) {
    const segments = segmentsByOriginal.get(load.member);
    if (!segments) {
      out.push(load);
      continue;
    }

    for (const segment of segments) {
      out.push({
        member: segment.member,
        wi: interpolate(load.wi, load.wj, segment.t0),
        wj: interpolate(load.wi, load.wj, segment.t1),
      });
    }
  }

  return out;
}

function remapUniformSprings(
  springs: SolveRequest["uniformSprings"],
  segmentsByOriginal: Map<number, Segment[]>,
): SolveRequest["uniformSprings"] {
  if (!springs) return undefined;
  const out: NonNullable<SolveRequest["uniformSprings"]> = [];

  for (const spring of springs) {
    const segments = segmentsByOriginal.get(spring.member);
    if (!segments) {
      out.push(spring);
      continue;
    }

    for (const segment of segments) {
      out.push({
        member: segment.member,
        k: spring.k,
        compressionOnly: spring.compressionOnly,
      });
    }
  }

  return out;
}

function remapHinges(
  hinges: SolveRequest["hinges"],
  segmentsByOriginal: Map<number, Segment[]>,
): SolveRequest["hinges"] {
  if (!hinges) return undefined;
  const out: NonNullable<SolveRequest["hinges"]> = [];

  for (const hinge of hinges) {
    const end = hinge.end ?? hinge.memberSide;
    if (hinge.member === undefined || (end !== "i" && end !== "j")) {
      out.push(hinge);
      continue;
    }

    const segments = segmentsByOriginal.get(hinge.member);
    if (!segments || segments.length === 0) {
      out.push(hinge);
      continue;
    }

    const segment = end === "i" ? segments[0] : segments[segments.length - 1];
    out.push({ member: segment.member, end });
  }

  return out;
}

function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
