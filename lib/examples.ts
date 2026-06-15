import type { SolveRequest } from "@/lib/api/types";
import type { Fields } from "@/lib/design-fields";
import { parseFields } from "@/lib/design-fields";

export type GalleryExample = {
  id: string;
  title: string;
  description: string;
  fields: Fields;
  E: number;
  I: number;
  A: number;
  known: string[];
};

const DEFAULT_E = 29000;
const DEFAULT_I = 100;
const DEFAULT_A = 10;

function fields(input: Fields): Fields {
  return input;
}

export const GALLERY_EXAMPLES: readonly GalleryExample[] = [
  {
    id: "simple-center-point",
    title: "Simply Supported Center Load",
    description: "Two 5 ft spans with a 10 kip center point load.",
    E: DEFAULT_E,
    I: DEFAULT_I,
    A: DEFAULT_A,
    fields: fields({
      nodes: "(0, 0)\n(5, 0)\n(10, 0)",
      members: "(0, 1)\n(1, 2)",
      pointLoads: "(1, 0, -10)",
      distLoads: "",
      fixity: "(0, 1, 1, 0)\n(2, 0, 1, 0)",
      hinges: "",
    }),
    known: ["RAy = 5", "RBy = 5", "Mmax = 25"],
  },
  {
    id: "partial-uniform",
    title: "Partial Uniform Load",
    description: "Uniform load on only the left 4 ft of a 10 ft beam.",
    E: DEFAULT_E,
    I: DEFAULT_I,
    A: DEFAULT_A,
    fields: fields({
      nodes: "(0, 0)\n(4, 0)\n(10, 0)",
      members: "(0, 1)\n(1, 2)",
      pointLoads: "",
      distLoads: "(0, -2, -2)",
      fixity: "(0, 1, 1, 0)\n(2, 0, 1, 0)",
      hinges: "",
    }),
    known: ["RAy = 6.4", "RBy = 1.6", "M at 4 ft = 9.6"],
  },
  {
    id: "uneven-adjacent-uniform",
    title: "Uneven Adjacent Uniform Loads",
    description: "Two equal spans with 2 kip/ft on the left and 5 kip/ft on the right.",
    E: DEFAULT_E,
    I: DEFAULT_I,
    A: DEFAULT_A,
    fields: fields({
      nodes: "(0, 0)\n(10, 0)\n(20, 0)",
      members: "(0, 1)\n(1, 2)",
      pointLoads: "",
      distLoads: "(0, -2, -2)\n(1, -5, -5)",
      fixity: "(0, 1, 1, 0)\n(2, 0, 1, 0)",
      hinges: "",
    }),
    known: ["RAy = 27.5", "RBy = 42.5", "M at 10 ft = 175"],
  },
  {
    id: "cantilever-end-point",
    title: "Cantilever End Load",
    description: "Fixed-left 10 ft cantilever with a 10 kip tip load.",
    E: DEFAULT_E,
    I: DEFAULT_I,
    A: DEFAULT_A,
    fields: fields({
      nodes: "(0, 0)\n(10, 0)",
      members: "(0, 1)",
      pointLoads: "(1, 0, -10)",
      distLoads: "",
      fixity: "(0, 1, 1, 1)",
      hinges: "",
    }),
    known: ["RAy = 10", "MA = 100", "M at fixed end = -100"],
  },
  {
    id: "two-span-continuous",
    title: "Two-Span Continuous Beam",
    description: "Three supports, two equal spans, and uniform loading across both spans.",
    E: DEFAULT_E,
    I: DEFAULT_I,
    A: DEFAULT_A,
    fields: fields({
      nodes: "(0, 0)\n(10, 0)\n(20, 0)",
      members: "(0, 1)\n(1, 2)",
      pointLoads: "",
      distLoads: "(0, -2, -2)\n(1, -2, -2)",
      fixity: "(0, 1, 1, 0)\n(1, 0, 1, 0)\n(2, 0, 1, 0)",
      hinges: "",
    }),
    known: ["RAy = 7.5", "RBy = 25", "RCy = 7.5", "M over middle support = -25"],
  },
];

export function solveRequestFromFields(
  designFields: Fields,
  E: number,
  I: number,
  A: number,
  include: SolveRequest["include"] = ["data", "svg"],
): SolveRequest {
  const { nodes, members, fixity, pointLoads, distLoads } =
    parseFields(designFields);

  return {
    nodes: nodes.map((n) => [n[0], n[1]]),
    members: members.map(([i, j]) => ({ i, j, E, I, A })),
    supports: fixity.map(([node, rx, ry, rm]) => ({
      node,
      Rx: !!rx,
      Ry: !!ry,
      Rm: !!rm,
    })),
    pointLoads: pointLoads
      .filter(([, fx, fy]) => fx !== 0 || fy !== 0)
      .map(([node, Fx, Fy]) => ({ node, Fx, Fy })),
    distLoads: distLoads.map(([member, wi, wj]) => ({ member, wi, wj })),
    samplesPerMember: 41,
    include,
  };
}

export function examplePayload(example: GalleryExample): SolveRequest {
  return solveRequestFromFields(example.fields, example.E, example.I, example.A);
}
