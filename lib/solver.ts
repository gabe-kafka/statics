// 2D frame direct-stiffness solver.
// Each node has 3 DOFs: [u (x-translation), v (y-translation), theta (z-rotation)].
// Member local axes: x̂ along i→j, ŷ = 90° CCW from x̂.
// Distributed load w given along GLOBAL −y (gravity). Linear along the member.

export type Vec2 = [number, number];
export type Member = [number, number];
export type PointLoad = [node: number, Fx: number, Fy: number, M?: number];
export type DistLoad = [member: number, wi: number, wj: number];
export type Fixity = [node: number, Rx: number, Ry: number, Rm: number];
export type PointSpring = [node: number, Kx: number, Ky: number, Km: number];
export type UniformSpring = [member: number, k: number];
export type MemberEndRelease = [member: number, end: "i" | "j"];

export type SolveInput = {
  nodes: Vec2[];
  members: Member[];
  pointLoads: PointLoad[];
  distLoads: DistLoad[];
  fixity: Fixity[];
  pointSprings?: PointSpring[];
  uniformSprings?: UniformSpring[];
  EA?: number;
  EI?: number;
  memberProps?: { EA: number; EI: number }[];
  releases?: MemberEndRelease[];
};

export type MemberResult = {
  L: number;
  c: number;
  s: number;
  Ni: number;
  Vi: number;
  Mi: number;
  Nj: number;
  Vj: number;
  Mj: number;
  wi: number;
  wj: number;
  V: (s: number) => number;
  M: (s: number) => number;
  /** Rotation θ(s) along the member, radians (sagging-positive convention). */
  theta: (s: number) => number;
  /** Transverse deflection Δ(s) in local +y (for horizontal beams: global +y). */
  delta: (s: number) => number;
};

export type Solution = {
  ok: boolean;
  error?: string;
  reactions: { node: number; Rx: number; Ry: number; M: number }[];
  members: MemberResult[];
  /** Length of each member along x (world) for plotting if all members are horizontal. */
  xCoords: number[];
};

function frame2dLocalK(EA: number, EI: number, L: number): number[][] {
  const L2 = L * L,
    L3 = L * L * L;
  const a = EA / L;
  const b = (12 * EI) / L3;
  const c = (6 * EI) / L2;
  const d = (4 * EI) / L;
  const e = (2 * EI) / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
}

function uniformTransverseSpringLocalK(k: number, L: number): number[][] {
  const L2 = L * L;
  const f = (k * L) / 420;
  const v = [
    [156, 22 * L, 54, -13 * L],
    [22 * L, 4 * L2, 13 * L, -3 * L2],
    [54, 13 * L, 156, -22 * L],
    [-13 * L, -3 * L2, -22 * L, 4 * L2],
  ];
  const out = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const dofs = [1, 2, 4, 5];
  for (let r = 0; r < dofs.length; r++)
    for (let c = 0; c < dofs.length; c++)
      out[dofs[r]][dofs[c]] = f * v[r][c];
  return out;
}

function rotation6(c: number, s: number): number[][] {
  // Transforms global → local. Local = T * Global.
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length,
    n = B[0].length,
    p = B.length;
  const R = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let k = 0; k < p; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) R[i][j] += aik * B[k][j];
    }
  return R;
}

function matT(A: number[][]): number[][] {
  const m = A.length,
    n = A[0].length;
  const R = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) R[j][i] = A[i][j];
  return R;
}

function matVec(A: number[][], x: number[]): number[] {
  const m = A.length,
    n = x.length;
  const R = new Array(m).fill(0);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) R[i] += A[i][j] * x[j];
  return R;
}

function condenseReleasedRotations(
  kLocal: number[][],
  feLocal: number[],
  released: number[],
): { kLocal: number[][]; feLocal: number[] } {
  if (released.length === 0) return { kLocal, feLocal };

  const kept = [0, 1, 2, 3, 4, 5].filter((idx) => !released.includes(idx));
  const Kaa = kept.map((r) => kept.map((c) => kLocal[r][c]));
  const Kar = kept.map((r) => released.map((c) => kLocal[r][c]));
  const Kra = released.map((r) => kept.map((c) => kLocal[r][c]));
  const Krr = released.map((r) => released.map((c) => kLocal[r][c]));
  const fa = kept.map((idx) => feLocal[idx]);
  const fr = released.map((idx) => feLocal[idx]);

  const invKrrKraCols = transposeSolve(Krr, Kra);
  const invKrrFr =
    gaussSolve(
      Krr.map((row) => row.slice()),
      fr,
    ) ?? new Array(released.length).fill(0);
  const condensedKaa = subtract(Kaa, matMul(Kar, invKrrKraCols));
  const condensedFa = subtractVec(fa, matVec(Kar, invKrrFr));

  const outK = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const outF = new Array(6).fill(0);
  for (let r = 0; r < kept.length; r++) {
    outF[kept[r]] = condensedFa[r];
    for (let c = 0; c < kept.length; c++)
      outK[kept[r]][kept[c]] = condensedKaa[r][c];
  }
  return { kLocal: outK, feLocal: outF };
}

function transposeSolve(A: number[][], B: number[][]): number[][] {
  if (B.length === 0) return [];
  const rows = A.length;
  const cols = B[0]?.length ?? 0;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let col = 0; col < cols; col++) {
    const rhs = B.map((row) => row[col]);
    const sol = gaussSolve(A.map((row) => row.slice()), rhs);
    if (!sol) continue;
    for (let row = 0; row < rows; row++) out[row][col] = sol[row];
  }
  return out;
}

function subtract(A: number[][], B: number[][]): number[][] {
  return A.map((row, r) => row.map((value, c) => value - B[r][c]));
}

function add(A: number[][], B: number[][]): number[][] {
  return A.map((row, r) => row.map((value, c) => value + B[r][c]));
}

function subtractVec(a: number[], b: number[]): number[] {
  return a.map((value, idx) => value - b[idx]);
}

// Solve A x = b via Gauss elimination with partial pivoting.
function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M: number[][] = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    let best = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > best) {
        best = Math.abs(M[i][k]);
        pivot = i;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== k) [M[k], M[pivot]] = [M[pivot], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      if (f === 0) continue;
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// Equivalent nodal loads (in member local frame) for a linearly varying
// distributed load of intensity q_i at s=0 and q_j at s=L applied in +local-y.
// Sign convention: a positive q gives positive (+y) nodal forces, so if the
// applied load is downward (q<0), the equivalent nodal loads are downward too.
// Returned as [N_i, V_i, M_i, N_j, V_j, M_j] in local DOF order.
function equivNodalLocal(qi: number, qj: number, L: number): number[] {
  // Superposition: uniform (qi) + triangular 0→(qj − qi).
  const u = qi;
  const t = qj - qi;
  // Uniform w=u:
  const Vu = (u * L) / 2; // force at each end in local +y
  const Mu = (u * L * L) / 12; // moment magnitude at end i (sign below)
  // Triangular 0→t at j end:
  const Vti = (3 * t * L) / 20;
  const Vtj = (7 * t * L) / 20;
  const Mti = (t * L * L) / 30;
  const Mtj = (t * L * L) / 20;
  const Vi = Vu + Vti;
  const Vj = Vu + Vtj;
  // Moment convention: CCW positive about +z. For positive +y load,
  // FEM at i is +M (load tends to rotate end i CCW if fixed), at j it's −M.
  const Mi = Mu + Mti;
  const Mj = -(Mu + Mtj);
  return [0, Vi, Mi, 0, Vj, Mj];
}

export function solve(inp: SolveInput): Solution {
  const EA = inp.EA ?? 29000 * 10;
  const EI = inp.EI ?? 29000 * 100;
  const N = inp.nodes.length;
  const ndof = 3 * N;

  const K: number[][] = Array.from({ length: ndof }, () => new Array(ndof).fill(0));
  const F: number[] = new Array(ndof).fill(0);

  // Member precompute
  type MPre = {
    i: number;
    j: number;
    L: number;
    c: number;
    s: number;
    T: number[][];
    kLocal: number[][];
    springKLocal: number[][];
    feLocal: number[]; // fixed-end forces in local
    released: number[];
    qi: number; // local-y load at i
    qj: number; // local-y load at j
    EI: number;
  };
  const mpre: MPre[] = [];
  const releasesByMember = new Map<number, number[]>();
  for (const [member, end] of inp.releases ?? []) {
    const idx = end === "i" ? 2 : 5;
    const prev = releasesByMember.get(member) ?? [];
    if (!prev.includes(idx)) prev.push(idx);
    releasesByMember.set(member, prev);
  }

  // Sum dist loads by member index
  const distByMember = new Map<number, [number, number]>();
  for (const [m, wi, wj] of inp.distLoads) {
    const prev = distByMember.get(m) ?? [0, 0];
    distByMember.set(m, [prev[0] + wi, prev[1] + wj]);
  }

  const springByMember = new Map<number, number>();
  for (const [m, k] of inp.uniformSprings ?? []) {
    springByMember.set(m, (springByMember.get(m) ?? 0) + k);
  }

  for (let mIdx = 0; mIdx < inp.members.length; mIdx++) {
    const [i, j] = inp.members[mIdx];
    if (!inp.nodes[i] || !inp.nodes[j]) continue;
    const dx = inp.nodes[j][0] - inp.nodes[i][0];
    const dy = inp.nodes[j][1] - inp.nodes[i][1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-12) continue;
    const c = dx / L;
    const s = dy / L;
    const T = rotation6(c, s);
    const mEA = inp.memberProps?.[mIdx]?.EA ?? EA;
    const mEI = inp.memberProps?.[mIdx]?.EI ?? EI;
    const springKLocal = uniformTransverseSpringLocalK(
      springByMember.get(mIdx) ?? 0,
      L,
    );
    let kLocal = add(frame2dLocalK(mEA, mEI, L), springKLocal);

    // Distributed load (given along global -y); project to member-local y.
    // Global load density at any s along member is (0, -w_global(s)). Local y
    // axis = (-s, c) (90° CCW from x̂=(c,s)), so local-y component = (-w) * c.
    const dload = distByMember.get(mIdx) ?? [0, 0];
    const wiG = dload[0]; // user passes negative for downward (global -y)
    const wjG = dload[1];
    const qi = wiG * c; // project global (0, wG) onto local +y axis (-s, c)
    const qj = wjG * c;
    const feL = equivNodalLocal(qi, qj, L);
    const released = releasesByMember.get(mIdx) ?? [];
    const condensed = condenseReleasedRotations(kLocal, feL, released);
    kLocal = condensed.kLocal;
    // global K contribution
    const kG = matMul(matT(T), matMul(kLocal, T));
    const dof = [3 * i, 3 * i + 1, 3 * i + 2, 3 * j, 3 * j + 1, 3 * j + 2];
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++) K[dof[a]][dof[b]] += kG[a][b];
    // feL is already the equivalent nodal load in local → add directly after
    // rotating to global.
    const feG = matVec(matT(T), condensed.feLocal);
    for (let a = 0; a < 6; a++) F[dof[a]] += feG[a];

    mpre.push({
      i,
      j,
      L,
      c,
      s,
      T,
      kLocal,
      springKLocal,
      feLocal: condensed.feLocal,
      released,
      qi,
      qj,
      EI: mEI,
    });
  }

  // Point loads
  for (const [n, fx, fy, mz = 0] of inp.pointLoads) {
    if (!inp.nodes[n]) continue;
    F[3 * n] += fx;
    F[3 * n + 1] += fy;
    F[3 * n + 2] += mz;
  }

  for (const [n, kx, ky, km] of inp.pointSprings ?? []) {
    if (!inp.nodes[n]) continue;
    K[3 * n][3 * n] += kx;
    K[3 * n + 1][3 * n + 1] += ky;
    K[3 * n + 2][3 * n + 2] += km;
  }

  // Boundary conditions: constrained DOFs
  const constrained = new Array(ndof).fill(false);
  for (const [n, rx, ry, rm] of inp.fixity) {
    if (!inp.nodes[n]) continue;
    if (rx) constrained[3 * n] = true;
    if (ry) constrained[3 * n + 1] = true;
    if (rm) constrained[3 * n + 2] = true;
  }

  // Partition
  const inactive = new Array(ndof).fill(false);
  for (let d = 0; d < ndof; d++) {
    if (constrained[d]) continue;
    const rowIsZero = K[d].every((value) => Math.abs(value) < 1e-12);
    if (rowIsZero && Math.abs(F[d]) < 1e-12) inactive[d] = true;
  }
  const free: number[] = [];
  const fixed: number[] = [];
  for (let d = 0; d < ndof; d++) {
    if (constrained[d]) fixed.push(d);
    else if (!inactive[d]) free.push(d);
  }

  if (free.length === 0) {
    return {
      ok: false,
      error: "No free DOFs",
      reactions: [],
      members: [],
      xCoords: [],
    };
  }

  // Build K_ff and F_f
  const Kff = free.map((r) => free.map((cc) => K[r][cc]));
  const Ff = free.map((r) => F[r]);
  const uf = gaussSolve(Kff, Ff);
  if (!uf) {
    return {
      ok: false,
      error: "Singular system (unstable / under-constrained)",
      reactions: [],
      members: [],
      xCoords: [],
    };
  }

  const u = new Array(ndof).fill(0);
  free.forEach((dof, idx) => (u[dof] = uf[idx]));

  // Reactions at constrained DOFs: R = K_full * u - F_applied (on fixed DOFs)
  const KxU = matVec(K, u);
  const reactionsByNode = new Map<number, { Rx: number; Ry: number; M: number }>();
  const addReaction = (node: number, rx: number, ry: number, moment: number) => {
    const r = reactionsByNode.get(node) ?? { Rx: 0, Ry: 0, M: 0 };
    r.Rx += rx;
    r.Ry += ry;
    r.M += moment;
    reactionsByNode.set(node, r);
  };
  for (const d of fixed) {
    const n = Math.floor(d / 3);
    const comp = d % 3;
    const val = KxU[d] - F[d];
    if (comp === 0) addReaction(n, val, 0, 0);
    else if (comp === 1) addReaction(n, 0, val, 0);
    else addReaction(n, 0, 0, val);
  }
  for (const [n, kx, ky, km] of inp.pointSprings ?? []) {
    if (!inp.nodes[n]) continue;
    const rx = -kx * u[3 * n];
    const ry = -ky * u[3 * n + 1];
    const moment = -km * u[3 * n + 2];
    if (Math.abs(rx) + Math.abs(ry) + Math.abs(moment) > 1e-12)
      addReaction(n, rx, ry, moment);
  }
  for (const m of mpre) {
    const hasSpring = m.springKLocal.some((row) => row.some((v) => v !== 0));
    if (!hasSpring) continue;
    const dof = [
      3 * m.i,
      3 * m.i + 1,
      3 * m.i + 2,
      3 * m.j,
      3 * m.j + 1,
      3 * m.j + 2,
    ];
    const uG = dof.map((d) => u[d]);
    const uL = matVec(m.T, uG);
    const rLocal = matVec(m.springKLocal, uL).map((v) => -v);
    const rGlobal = matVec(matT(m.T), rLocal);
    addReaction(m.i, rGlobal[0], rGlobal[1], rGlobal[2]);
    addReaction(m.j, rGlobal[3], rGlobal[4], rGlobal[5]);
  }
  const reactions = [...reactionsByNode.entries()].map(([node, v]) => ({
    node,
    ...v,
  }));

  // Member internal forces (local): k_local * (T * u_member) + feLocal
  const members: MemberResult[] = [];
  for (const m of mpre) {
    const dof = [
      3 * m.i,
      3 * m.i + 1,
      3 * m.i + 2,
      3 * m.j,
      3 * m.j + 1,
      3 * m.j + 2,
    ];
    const uG = dof.map((d) => u[d]);
    const uL = matVec(m.T, uG);
    const kU = matVec(m.kLocal, uL);
    const fInt = kU.map((v, k) => v - m.feLocal[k]);
    for (const released of m.released) fInt[released] = 0;
    const Ni = fInt[0];
    const Vi_end = fInt[1];
    const Mi_end = fInt[2];
    const Nj = fInt[3];
    const Vj_end = fInt[4];
    const Mj_end = fInt[5];

    const { L, qi, qj, EI: memberEI } = m;
    const intQ = (s: number) =>
      qi * s + ((qj - qi) * s * s) / (2 * L);
    const intIntQ = (s: number) =>
      (qi * s * s) / 2 + ((qj - qi) * s * s * s) / (6 * L);
    const V = (s: number): number => Vi_end + intQ(s);
    // Internal bending moment at section s (sagging-positive convention),
    // derived from the left-segment FBD:
    //   ΣM about cut: Mi_end − s·Vi_end − intIntQ(s) + M(s) = 0
    // Note the sign on Mi_end: it's the moment ON the member at end i in
    // the FEA local frame (CCW+), but the internal bending moment we want
    // expresses the moment that the right segment applies to the left
    // segment's right face — which is opposite. Without the sign flip,
    // M(s) on members downstream of a non-zero Mi_end gives wrong values
    // (e.g. simply-supported beam reports M=−1800 at the roller instead
    // of 0).
    const M = (s: number): number => -Mi_end + Vi_end * s + intIntQ(s);

    // Local end displacements/rotations from the solved system.
    const vi = uL[1];
    const ti = uL[2];
    const vj = uL[4];
    const tj = uL[5];

    // Hermite cubic interpolation of the beam shape from end DOFs.
    const hermiteV = (s: number): number => {
      const x = s / L;
      const N1 = 1 - 3 * x * x + 2 * x * x * x;
      const N2 = s - 2 * s * s / L + (s * s * s) / (L * L);
      const N3 = 3 * x * x - 2 * x * x * x;
      const N4 = -(s * s) / L + (s * s * s) / (L * L);
      return N1 * vi + N2 * ti + N3 * vj + N4 * tj;
    };
    const hermiteTheta = (s: number): number => {
      const dN1 = -6 * s / (L * L) + 6 * s * s / (L * L * L);
      const dN2 = 1 - 4 * s / L + 3 * s * s / (L * L);
      const dN3 = 6 * s / (L * L) - 6 * s * s / (L * L * L);
      const dN4 = -2 * s / L + 3 * s * s / (L * L);
      return dN1 * vi + dN2 * ti + dN3 * vj + dN4 * tj;
    };
    // Particular deflection/rotation from distributed load with zero end
    // conditions. Split into uniform (qi) + triangular (qj − qi) components.
    const deltaP = (s: number): number => {
      const uPart = (qi * s * s * (L - s) * (L - s)) / (24 * memberEI);
      const tPart =
        ((qj - qi) * (Math.pow(s, 5) / L - 3 * L * s * s * s + 2 * L * L * s * s)) /
        (120 * memberEI);
      return uPart + tPart;
    };
    const thetaP = (s: number): number => {
      const uPart = (qi * s * (L - s) * (L - 2 * s)) / (12 * memberEI);
      const tPart =
        ((qj - qi) * (5 * Math.pow(s, 4) / L - 9 * L * s * s + 4 * L * L * s)) /
        (120 * memberEI);
      return uPart + tPart;
    };
    const theta = (s: number): number => hermiteTheta(s) + thetaP(s);
    const delta = (s: number): number => hermiteV(s) + deltaP(s);

    members.push({
      L,
      c: m.c,
      s: m.s,
      Ni,
      Vi: Vi_end,
      Mi: Mi_end,
      Nj,
      Vj: Vj_end,
      Mj: Mj_end,
      wi: qi,
      wj: qj,
      V,
      M,
      theta,
      delta,
    });
  }

  const xCoords = inp.nodes.map((n) => n[0]);
  return { ok: true, reactions, members, xCoords };
}
