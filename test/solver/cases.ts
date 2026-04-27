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

export type SolverCase = {
  name: string;
  input: SolveInput;
  expect: {
    ok?: boolean;
    reactions?: ExpectedReaction[];
    samples?: ExpectedSample[];
    errorIncludes?: string;
  };
  tolerance?: number;
  notes?: string;
};

const EA = 29000 * 10;
const EI = 29000 * 100;

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
