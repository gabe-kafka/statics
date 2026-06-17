import { solve as solveFrame, type Solution } from "../solver";
import type {
  ApiError,
  MemberOut,
  PeakOut,
  SampleOut,
  SolveRequest,
  SolveResponse,
} from "./types";
import { normalizeInlineMemberNodes } from "./normalize-inline-nodes";
import { renderSvg } from "./render-svg";
import { validate } from "./validate";

export function solveRequest(body: SolveRequest): SolveResponse | ApiError {
  const normalizedBody = normalizeInlineMemberNodes(body);
  const v = validate(normalizedBody);
  if (v) return v;

  const samplesPerMember = clampSamples(normalizedBody.samplesPerMember ?? 40);
  const include = new Set(normalizedBody.include ?? ["data"]);

  let raw: Solution;
  try {
    raw = solveFrame({
      nodes: normalizedBody.nodes.map((n) => [n[0], n[1]] as [number, number]),
      members: normalizedBody.members.map((m) => [m.i, m.j] as [number, number]),
      pointLoads: (normalizedBody.pointLoads ?? []).map(
        (p) => [p.node, p.Fx, p.Fy, p.M ?? 0] as [number, number, number, number],
      ),
      distLoads: (normalizedBody.distLoads ?? []).map(
        (d) => [d.member, d.wi, d.wj] as [number, number, number],
      ),
      pointSprings: (normalizedBody.pointSprings ?? []).map(
        (s) =>
          [s.node, s.Kx, s.Ky, s.Km] as [number, number, number, number],
      ),
      uniformSprings: (normalizedBody.uniformSprings ?? []).map(
        (s) => [s.member, s.k, !!s.compressionOnly] as [
          number,
          number,
          boolean,
        ],
      ),
      fixity: normalizedBody.supports.map(
        (s) =>
          [s.node, s.Rx ? 1 : 0, s.Ry ? 1 : 0, s.Rm ? 1 : 0] as [
            number,
            number,
            number,
            number,
          ],
      ),
      memberProps: normalizedBody.members.map((m) => ({
        EA: m.E * m.A,
        EI: m.E * m.I,
      })),
      releases: normalizeHinges(normalizedBody),
    });
  } catch (e) {
    return {
      ok: false,
      error: "singular_system",
      message:
        (e as Error)?.message ??
        "Solver threw an unexpected exception while assembling or solving the stiffness system.",
    };
  }

  if (!raw.ok) {
    return {
      ok: false,
      error: "singular_system",
      message:
        raw.error ??
        "Stiffness matrix is singular — structure is unstable or under-constrained.",
    };
  }

  const uniformSpringLinearKByMember = new Map<number, number>();
  const uniformSpringCompressionKByMember = new Map<number, number>();
  for (const spring of normalizedBody.uniformSprings ?? []) {
    const map = spring.compressionOnly
      ? uniformSpringCompressionKByMember
      : uniformSpringLinearKByMember;
    map.set(spring.member, (map.get(spring.member) ?? 0) + spring.k);
  }

  const memberOut: MemberOut[] = raw.members.map((mr, idx) => {
    const [i, j] = [normalizedBody.members[idx].i, normalizedBody.members[idx].j];
    const xi = normalizedBody.nodes[i][0];
    const yi = normalizedBody.nodes[i][1];
    const xj = normalizedBody.nodes[j][0];
    const yj = normalizedBody.nodes[j][1];
    const samples: SampleOut[] = [];
    const linearSpringK = uniformSpringLinearKByMember.get(idx) ?? 0;
    const compressionSpringK = uniformSpringCompressionKByMember.get(idx) ?? 0;
    for (let k = 0; k <= samplesPerMember; k++) {
      const s = (k / samplesPerMember) * mr.L;
      const x = xi + ((xj - xi) * k) / samplesPerMember;
      const y = yi + ((yj - yi) * k) / samplesPerMember;
      const delta = mr.delta(s);
      const springReaction =
        -linearSpringK * delta + Math.max(0, -compressionSpringK * delta);
      samples.push({
        s,
        x,
        y,
        R: springReaction,
        V: mr.V(s),
        M: mr.M(s),
        theta: mr.theta(s),
        delta,
      });
    }
    return {
      i,
      j,
      L: mr.L,
      c: mr.c,
      s: mr.s,
      endForces: {
        Ni: mr.Ni,
        Vi: mr.Vi,
        Mi: mr.Mi,
        Nj: mr.Nj,
        Vj: mr.Vj,
        Mj: mr.Mj,
      },
      samples,
    };
  });

  const reactions = raw.reactions.map((r) => ({
    node: r.node,
    Rx: r.Rx,
    Ry: r.Ry,
    M: r.M,
  }));

  const response: SolveResponse = {
    ok: true,
    reactions,
    members: memberOut,
    peaks: computePeaks(memberOut),
  };

  if (include.has("svg")) {
    response.svg = renderSvg(normalizedBody, { members: memberOut, reactions });
  }

  return response;
}

function normalizeHinges(body: SolveRequest): [number, "i" | "j"][] {
  const out: [number, "i" | "j"][] = [];
  const seen = new Set<string>();
  for (const hinge of body.hinges ?? []) {
    const member = hinge.member ?? memberAtNode(body, hinge.node, hinge.memberSide);
    const end = hinge.end ?? hinge.memberSide;
    if (member === undefined || end === undefined) continue;
    const key = `${member}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([member, end]);
  }
  return out;
}

function memberAtNode(
  body: SolveRequest,
  node: number | undefined,
  side: "i" | "j" | undefined,
): number | undefined {
  if (node === undefined || side === undefined) return undefined;
  return body.members.findIndex((member) => member[side] === node);
}

function clampSamples(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 40;
  return Math.min(Math.max(2, Math.floor(n)), 500);
}

function computePeaks(members: MemberOut[]): SolveResponse["peaks"] {
  const empty: PeakOut = { value: 0, x: 0, y: 0, member: 0, sLocal: 0 };
  const result = { V: empty, M: empty, theta: empty, delta: empty };
  for (let m = 0; m < members.length; m++) {
    for (const s of members[m].samples) {
      for (const k of ["V", "M", "theta", "delta"] as const) {
        const cur = result[k];
        if (Math.abs(s[k]) > Math.abs(cur.value))
          result[k] = { value: s[k], x: s.x, y: s.y, member: m, sLocal: s.s };
      }
    }
  }
  return result;
}
