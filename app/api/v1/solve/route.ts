import { NextResponse } from "next/server";
import { solve as solveFrame, type Solution } from "@/lib/solver";
import type {
  ApiError,
  MemberOut,
  PeakOut,
  SampleOut,
  SolveRequest,
  SolveResponse,
} from "@/lib/api/types";
import { validate } from "@/lib/api/validate";
import { renderSvg } from "@/lib/api/render-svg";

// Accepts any localhost / 127.0.0.1 dev origin (any port) plus the prod
// host. Add additional production origins here as needed.
const ALLOWED_HOSTS = new Set<string>(["statics.kafkadesign.io"]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = isAllowedOrigin(origin) ? origin! : "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));
  let body: SolveRequest;
  try {
    body = (await req.json()) as SolveRequest;
  } catch {
    return jsonError(
      { ok: false, error: "invalid_input", message: "Body must be valid JSON." },
      400,
      cors,
    );
  }

  const v = validate(body);
  if (v) {
    const status = v.error === "invalid_input" || v.error === "degenerate_member" || v.error === "non_positive_section" ? 400 : 422;
    return jsonError(v, status, cors);
  }

  // Adapt public schema → internal solver shape (the existing solver was
  // built first and uses tuples).
  const samplesPerMember = clampSamples(body.samplesPerMember ?? 40);
  const include = new Set(body.include ?? ["data"]);

  // For now the solver supports a single global EA / EI. Use the first
  // member's properties as the global value; warn if other members differ.
  // (Per-member section properties are flagged for v1.1.)
  const m0 = body.members[0];
  const allSame = body.members.every(
    (m) => m.E === m0.E && m.I === m0.I && m.A === m0.A,
  );

  let raw: Solution;
  try {
    raw = solveFrame({
      nodes: body.nodes.map((n) => [n[0], n[1]] as [number, number]),
      members: body.members.map((m) => [m.i, m.j] as [number, number]),
      pointLoads: (body.pointLoads ?? []).map(
        (p) => [p.node, p.Fx, p.Fy] as [number, number, number],
      ),
      distLoads: (body.distLoads ?? []).map(
        (d) => [d.member, d.wi, d.wj] as [number, number, number],
      ),
      fixity: body.supports.map(
        (s) => [s.node, s.Rx ? 1 : 0, s.Ry ? 1 : 0, s.Rm ? 1 : 0] as [
          number,
          number,
          number,
          number,
        ],
      ),
      EA: m0.E * m0.A,
      EI: m0.E * m0.I,
    });
  } catch (e) {
    return jsonError(
      {
        ok: false,
        error: "singular_system",
        message:
          (e as Error)?.message ??
          "Solver threw an unexpected exception while assembling or solving the stiffness system.",
      },
      422,
      cors,
    );
  }

  if (!raw.ok) {
    return jsonError(
      {
        ok: false,
        error: "singular_system",
        message:
          raw.error ??
          "Stiffness matrix is singular — structure is unstable or under-constrained.",
      },
      422,
      cors,
    );
  }

  // Sample each member at samplesPerMember+1 points and build the output.
  const memberOut: MemberOut[] = raw.members.map((mr, idx) => {
    const [i, j] = [body.members[idx].i, body.members[idx].j];
    const xi = body.nodes[i][0];
    const xj = body.nodes[j][0];
    const samples: SampleOut[] = [];
    for (let k = 0; k <= samplesPerMember; k++) {
      const s = (k / samplesPerMember) * mr.L;
      const x = xi + ((xj - xi) * k) / samplesPerMember;
      samples.push({
        s,
        x,
        V: mr.V(s),
        M: mr.M(s),
        theta: mr.theta(s),
        delta: mr.delta(s),
      });
    }
    return {
      i,
      j,
      L: mr.L,
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

  const peaks = computePeaks(memberOut);

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
    peaks,
  };

  if (include.has("svg")) {
    response.svg = renderSvg(body, { members: memberOut, reactions });
  }

  if (!allSame) {
    response.warnings = [
      ...(response.warnings ?? []),
      {
        code: "near_singular",
        message:
          "Per-member section properties were provided but the current solver applies the first member's E·I globally. Results assume uniform section.",
        details: { firstMember: { E: m0.E, I: m0.I, A: m0.A } },
      },
    ];
  }

  return new NextResponse(JSON.stringify(response), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function clampSamples(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 40;
  return Math.min(Math.max(2, Math.floor(n)), 500);
}

function computePeaks(
  members: MemberOut[],
): SolveResponse["peaks"] {
  const empty: PeakOut = { value: 0, x: 0, member: 0, sLocal: 0 };
  const result = { V: empty, M: empty, theta: empty, delta: empty };
  for (let m = 0; m < members.length; m++) {
    for (const s of members[m].samples) {
      for (const k of ["V", "M", "theta", "delta"] as const) {
        const cur = result[k];
        if (Math.abs(s[k]) > Math.abs(cur.value))
          result[k] = { value: s[k], x: s.x, member: m, sLocal: s.s };
      }
    }
  }
  return result;
}

function jsonError(err: ApiError, status: number, cors: Record<string, string>) {
  return new NextResponse(JSON.stringify(err), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
