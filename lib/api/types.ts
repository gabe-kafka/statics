// Wire types for the public /api/v1/solve endpoint. Kept separate from the
// solver's internal SolveInput so the public contract can evolve without
// dragging the solver along.

export type SolveRequest = {
  nodes: [number, number][];
  members: { i: number; j: number; E: number; I: number; A: number }[];
  supports: { node: number; Rx: boolean; Ry: boolean; Rm: boolean }[];
  pointLoads?: { node: number; Fx: number; Fy: number; M?: number }[];
  distLoads?: { member: number; wi: number; wj: number }[];
  hinges?: { node: number; memberSide?: "i" | "j" }[];
  samplesPerMember?: number;
  include?: ("data" | "svg")[];
};

export type ApiErrorCode =
  | "invalid_input"
  | "degenerate_member"
  | "non_positive_section"
  | "insufficient_supports"
  | "no_horizontal_restraint"
  | "no_vertical_restraint"
  | "disconnected_substructure"
  | "singular_system";

export type ApiError = {
  ok: false;
  error: ApiErrorCode;
  message: string;
  details?: unknown;
};

export type ApiWarning = {
  code: "near_singular";
  message: string;
  details?: unknown;
};

export type ReactionOut = {
  node: number;
  Rx: number;
  Ry: number;
  M: number;
};

export type EndForcesOut = {
  Ni: number;
  Vi: number;
  Mi: number;
  Nj: number;
  Vj: number;
  Mj: number;
};

export type SampleOut = {
  s: number;
  x: number;
  V: number;
  M: number;
  theta: number;
  delta: number;
};

export type MemberOut = {
  i: number;
  j: number;
  L: number;
  endForces: EndForcesOut;
  samples: SampleOut[];
};

export type PeakOut = {
  value: number;
  x: number;
  member: number;
  sLocal: number;
};

export type SvgOut = {
  fbd: string;
  V: string;
  M: string;
  theta: string;
  delta: string;
  all: string;
};

export type SolveResponse = {
  ok: true;
  reactions: ReactionOut[];
  members: MemberOut[];
  peaks: { V: PeakOut; M: PeakOut; theta: PeakOut; delta: PeakOut };
  svg?: SvgOut;
  warnings?: ApiWarning[];
};
