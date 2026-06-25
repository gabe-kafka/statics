import type { SolveInput } from "../../lib/solver";

export type ExpectedReaction = {
  node: number;
  Rx?: number;
  Ry?: number;
  M?: number;
};

export type ExpectedSample = {
  member: number;
  s: number;
  V?: number;
  M?: number;
  theta?: number;
  delta?: number;
};

export type ExpectedMemberDirection = {
  member: number;
  c: number;
  s: number;
};

export type SolverCase = {
  name: string;
  input: SolveInput;
  expect: {
    ok?: boolean;
    reactions?: ExpectedReaction[];
    samples?: ExpectedSample[];
    memberDirections?: ExpectedMemberDirection[];
    errorIncludes?: string;
  };
  tolerance?: number;
  notes?: string;
};

const EA = 29000 * 10;
const EI = 29000 * 100;
const cantileverL = 10;
const cantileverP = 10;
const tipSpringKy = 100;
const tipSpringBeamKy = (3 * EI) / Math.pow(cantileverL, 3);
const tipSpringDelta = -cantileverP / (tipSpringKy + tipSpringBeamKy);
const tipSpringReaction = -tipSpringKy * tipSpringDelta;
const tipSpringFixedReaction = cantileverP - tipSpringReaction;
const tipSpringFixedMoment = cantileverP * cantileverL - tipSpringReaction * cantileverL;
const foundationK = 100;
const foundationF = (foundationK * cantileverL) / 420;
const foundationKvv =
  (12 * EI) / Math.pow(cantileverL, 3) + 156 * foundationF;
const foundationKvt =
  (-6 * EI) / Math.pow(cantileverL, 2) - 22 * cantileverL * foundationF;
const foundationKtt =
  (4 * EI) / cantileverL + 4 * cantileverL * cantileverL * foundationF;
const foundationDet = foundationKvv * foundationKtt - foundationKvt * foundationKvt;
const foundationTipDelta = (-cantileverP * foundationKtt) / foundationDet;

const base = (input: Omit<SolveInput, "EA" | "EI">): SolveInput => ({
  ...input,
  EA,
  EI,
});

export const solverCases: SolverCase[] = [
  {
    name: "simply supported beam with center point load",
    input: base({
      nodes: [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
      ],
      fixity: [
        [0, 1, 1, 0],
        [2, 0, 1, 0],
      ],
      pointLoads: [[1, 0, -10]],
      distLoads: [],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 5 },
        { node: 2, Ry: 5 },
      ],
      samples: [
        { member: 0, s: 5, V: 5, M: 25 },
        { member: 1, s: 0, V: -5, M: 25 },
      ],
    },
  },
  {
    name: "simply supported beam with off-center point load",
    input: base({
      nodes: [
        [0, 0],
        [3, 0],
        [10, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
      ],
      fixity: [
        [0, 1, 1, 0],
        [2, 0, 1, 0],
      ],
      pointLoads: [[1, 0, -10]],
      distLoads: [],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 7 },
        { node: 2, Ry: 3 },
      ],
      samples: [
        { member: 0, s: 3, M: 21 },
        { member: 1, s: 0, M: 21 },
      ],
    },
  },
  {
    name: "simply supported beam with full-span uniform load",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [
        [0, 1, 1, 0],
        [1, 0, 1, 0],
      ],
      pointLoads: [],
      distLoads: [[0, -2, -2]],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 10 },
        { node: 1, Ry: 10 },
      ],
      samples: [
        { member: 0, s: 0, V: 10, M: 0 },
        { member: 0, s: 5, V: 0, M: 25 },
        { member: 0, s: 10, V: -10, M: 0 },
      ],
    },
  },
  {
    name: "simply supported beam with partial uniform load",
    input: base({
      nodes: [
        [0, 0],
        [4, 0],
        [10, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
      ],
      fixity: [
        [0, 1, 1, 0],
        [2, 0, 1, 0],
      ],
      pointLoads: [],
      distLoads: [[0, -2, -2]],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 6.4 },
        { node: 2, Ry: 1.6 },
      ],
      samples: [
        { member: 0, s: 4, V: -1.6, M: 9.6 },
        { member: 1, s: 0, V: -1.6, M: 9.6 },
      ],
    },
  },
  {
    name: "simply supported beam with uneven uniform loads on adjacent spans",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
      ],
      fixity: [
        [0, 1, 1, 0],
        [2, 0, 1, 0],
      ],
      pointLoads: [],
      distLoads: [
        [0, -2, -2],
        [1, -5, -5],
      ],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 27.5 },
        { node: 2, Ry: 42.5 },
      ],
      samples: [
        { member: 0, s: 10, V: 7.5, M: 175 },
        { member: 1, s: 0, V: 7.5, M: 175 },
        { member: 1, s: 10, V: -42.5, M: 0 },
      ],
    },
  },
  {
    name: "simply supported beam with triangular load increasing to the right",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [
        [0, 1, 1, 0],
        [1, 0, 1, 0],
      ],
      pointLoads: [],
      distLoads: [[0, 0, -6]],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 10 },
        { node: 1, Ry: 20 },
      ],
      samples: [
        { member: 0, s: Math.sqrt(10 / 0.3), V: 0, M: 38.490017945975055 },
        { member: 0, s: 10, M: 0 },
      ],
    },
  },
  {
    name: "cantilever with end point load",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [[1, 0, -10]],
      distLoads: [],
    }),
    expect: {
      reactions: [{ node: 0, Ry: 10, M: 100 }],
      samples: [
        { member: 0, s: 0, V: 10, M: -100 },
        { member: 0, s: 10, V: 10, M: 0 },
      ],
    },
  },
  {
    name: "cantilever with end point moment",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [[1, 0, 0, 25]],
      distLoads: [],
    }),
    expect: {
      reactions: [{ node: 0, M: -25 }],
      samples: [
        { member: 0, s: 0, V: 0, M: 25 },
        { member: 0, s: 10, V: 0, M: 25 },
      ],
    },
  },
  {
    name: "cantilever with tip point spring",
    input: base({
      nodes: [
        [0, 0],
        [cantileverL, 0],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [[1, 0, -cantileverP]],
      distLoads: [],
      pointSprings: [[1, 0, tipSpringKy, 0]],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: tipSpringFixedReaction, M: tipSpringFixedMoment },
        { node: 1, Ry: tipSpringReaction },
      ],
      samples: [{ member: 0, s: cantileverL, delta: tipSpringDelta }],
    },
  },
  {
    name: "cantilever with uniform transverse spring foundation",
    input: base({
      nodes: [
        [0, 0],
        [cantileverL, 0],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [[1, 0, -cantileverP]],
      distLoads: [],
      uniformSprings: [[0, foundationK]],
    }),
    expect: {
      samples: [{ member: 0, s: cantileverL, delta: foundationTipDelta }],
    },
  },
  {
    name: "cantilever with full-span uniform load",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [],
      distLoads: [[0, -2, -2]],
    }),
    expect: {
      reactions: [{ node: 0, Ry: 20, M: 100 }],
      samples: [
        { member: 0, s: 0, V: 20, M: -100 },
        { member: 0, s: 10, V: 0, M: 0 },
      ],
    },
  },
  {
    name: "fixed-ended beam with full-span uniform load",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [
        [0, 1, 1, 1],
        [1, 0, 1, 1],
      ],
      pointLoads: [],
      distLoads: [[0, -2, -2]],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 10, M: 16.666666666666668 },
        { node: 1, Ry: 10, M: -16.666666666666668 },
      ],
      samples: [
        { member: 0, s: 0, M: -16.666666666666668 },
        { member: 0, s: 5, M: 8.333333333333334 },
        { member: 0, s: 10, M: -16.666666666666668 },
      ],
    },
  },
  {
    name: "fixed-pinned beam with j-end release and uniform load",
    input: {
      ...base({
        nodes: [
          [0, 0],
          [10, 0],
        ],
        members: [[0, 1]],
        fixity: [
          [0, 1, 1, 1],
          [1, 0, 1, 0],
        ],
        pointLoads: [],
        distLoads: [[0, -2, -2]],
      }),
      releases: [[0, "j"]],
    },
    expect: {
      reactions: [
        { node: 0, Ry: 12.5, M: 25 },
        { node: 1, Ry: 7.5 },
      ],
      samples: [
        { member: 0, s: 0, M: -25 },
        { member: 0, s: 10, M: 0 },
      ],
    },
  },
  {
    name: "fixed-ended beam with both end releases behaves simply supported",
    input: {
      ...base({
        nodes: [
          [0, 0],
          [10, 0],
        ],
        members: [[0, 1]],
        fixity: [
          [0, 1, 1, 1],
          [1, 0, 1, 1],
        ],
        pointLoads: [],
        distLoads: [[0, -2, -2]],
      }),
      releases: [
        [0, "i"],
        [0, "j"],
      ],
    },
    expect: {
      reactions: [
        { node: 0, Ry: 10, M: 0 },
        { node: 1, Ry: 10, M: 0 },
      ],
      samples: [
        { member: 0, s: 0, M: 0 },
        { member: 0, s: 5, M: 25 },
        { member: 0, s: 10, M: 0 },
      ],
    },
  },
  {
    name: "two-span continuous beam with uniform load",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
      ],
      fixity: [
        [0, 1, 1, 0],
        [1, 0, 1, 0],
        [2, 0, 1, 0],
      ],
      pointLoads: [],
      distLoads: [
        [0, -2, -2],
        [1, -2, -2],
      ],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 7.5 },
        { node: 1, Ry: 25 },
        { node: 2, Ry: 7.5 },
      ],
      samples: [
        { member: 0, s: 5, M: 12.5 },
        { member: 0, s: 10, M: -25 },
        { member: 1, s: 0, M: -25 },
        { member: 1, s: 5, M: 12.5 },
      ],
    },
  },
  {
    name: "two-span continuous beam honors per-member stiffness",
    input: {
      nodes: [
        [0, 0],
        [8, 0],
        [20, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
      ],
      fixity: [
        [0, 1, 1, 0],
        [1, 0, 1, 0],
        [2, 0, 1, 0],
      ],
      pointLoads: [],
      distLoads: [
        [0, -2, -2],
        [1, -3, -3],
      ],
      memberProps: [
        { EA, EI: EI * 4 },
        { EA, EI },
      ],
    },
    expect: {
      reactions: [
        { node: 0, Ry: 1.9285714285714288 },
        { node: 1, Ry: 36.11904761904762 },
        { node: 2, Ry: 13.952380952380953 },
      ],
      samples: [
        { member: 0, s: 4, M: -8.285714285714285 },
        { member: 0, s: 8, M: -48.57142857142857 },
        { member: 1, s: 0, M: -48.57142857142857 },
        { member: 1, s: 6, M: 29.714285714285708 },
      ],
    },
  },
  {
    name: "symmetric portal moment frame with center point load",
    input: base({
      nodes: [
        [0, 0],
        [0, 10],
        [5, 10],
        [10, 10],
        [10, 0],
      ],
      members: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ],
      fixity: [
        [0, 1, 1, 1],
        [4, 1, 1, 1],
      ],
      pointLoads: [[2, 0, -10]],
      distLoads: [],
    }),
    expect: {
      reactions: [
        { node: 0, Ry: 5 },
        { node: 4, Ry: 5 },
      ],
      memberDirections: [
        { member: 0, c: 0, s: 1 },
        { member: 1, c: 1, s: 0 },
        { member: 3, c: 0, s: -1 },
      ],
    },
  },
  {
    name: "axial member with end tension load",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [[1, 10, 0]],
      distLoads: [],
    }),
    expect: {
      reactions: [{ node: 0, Rx: -10 }],
    },
  },
  {
    name: "vertical member receives global gravity distributed load through axial projection",
    input: base({
      nodes: [
        [0, 0],
        [0, 10],
      ],
      members: [[0, 1]],
      fixity: [[0, 1, 1, 1]],
      pointLoads: [],
      distLoads: [[0, -2, -2]],
    }),
    expect: {
      reactions: [{ node: 0, Rx: 0, Ry: 20, M: 0 }],
    },
  },
  {
    name: "unstable beam with no horizontal restraint fails",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
      ],
      members: [[0, 1]],
      fixity: [
        [0, 0, 1, 0],
        [1, 0, 1, 0],
      ],
      pointLoads: [[1, 0, -10]],
      distLoads: [],
    }),
    expect: {
      ok: false,
      errorIncludes: "Singular system",
    },
  },
  {
    name: "disconnected unsupported substructure fails",
    input: base({
      nodes: [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      members: [
        [0, 1],
        [2, 3],
      ],
      fixity: [
        [0, 1, 1, 1],
        [1, 0, 1, 0],
      ],
      pointLoads: [[3, 0, -1]],
      distLoads: [],
    }),
    expect: {
      ok: false,
      errorIncludes: "Singular system",
    },
  },
];
