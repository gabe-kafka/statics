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
  /**
   * Unit used to label x-axis ticks and moment values in the rendered
   * SVGs. The numeric `data` payload is unaffected — sample values stay
   * in API-internal units (inches for length, k·in for moment). When
   * omitted, defaults to "ft".
   */
  lengthUnit?: "in" | "ft" | "m";
  /**
   * Color theme for the rendered SVGs. "light" = white bg + dark text,
   * "dark" = black bg + white text. The vivid accent colors (beam,
   * load, V, M, θ, Δ) are tuned per theme for legibility. Defaults to
   * "dark" when omitted, preserving the original look for any caller
   * that hasn't opted in.
   */
  theme?: "light" | "dark";
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
