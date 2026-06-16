import type { SolveRequest } from "@/lib/api/types";
import type { Fields } from "@/lib/design-fields";
import { fieldsFromDesign, parseFields } from "@/lib/design-fields";
import { combineLoads, defaultCombinationId } from "@/lib/load-combinations";

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

function fields(input: Partial<Fields>): Fields {
  return fieldsFromDesign(input);
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
      pointLoads: "(1, -10, D)",
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
      pointLoads: "(1, -10, D)",
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
  {
    id: "uniform-spring-foundation",
    title: "Uniform Spring Foundation",
    description: "44 ft beam supported by a 5 kip/in/ft transverse spring foundation.",
    E: DEFAULT_E,
    I: DEFAULT_I,
    A: DEFAULT_A,
    fields: fields({
      nodes: "(0, 0)\n(44, 0)",
      members: "(0, 1)",
      loadCases: "(D, Dead)\n(L, Live)",
      loadCombinations: "(SERVICE, D, 1)",
      pointLoads: "(1, -20, D)",
      distLoads: "(0, -0.75, -0.75, D)",
      fixity: "(0, 1, 0, 0)",
      uniformSprings: "(0, 5)",
      hinges: "",
    }),
    known: ["L = 44 ft", "k = 5 kip/in/ft", "Tip load = 20 kip", "w = 0.75 kip/ft"],
  },
];

export function solveRequestFromFields(
  designFields: Fields,
  E: number,
  I: number,
  A: number,
  include: SolveRequest["include"] = ["data", "svg"],
): SolveRequest {
  const parsed = parseFields(designFields);
  const {
    nodes,
    members,
    fixity,
    pointSprings,
    uniformSprings,
    loadCases,
    loadCombinations,
  } = parsed;
  const combinedLoads = combineLoads({
    pointLoads: parsed.pointLoads,
    distLoads: parsed.distLoads,
    loadCases,
    loadCombinations,
    combinationId: defaultCombinationId(loadCombinations),
  });

  return {
    nodes: nodes.map((n) => [n[0], n[1]]),
    members: members.map(([i, j]) => ({ i, j, E, I, A })),
    supports: fixity.map(([node, rx, ry, rm]) => ({
      node,
      Rx: !!rx,
      Ry: !!ry,
      Rm: !!rm,
    })),
    pointLoads: combinedLoads.pointLoads
      .filter(([, fx, fy, moment = 0]) => fx !== 0 || fy !== 0 || moment !== 0)
      .map(([node, Fx, Fy, M = 0]) => ({ node, Fx, Fy, M })),
    distLoads: combinedLoads.distLoads.map(([member, wi, wj]) => ({
      member,
      wi,
      wj,
    })),
    pointSprings: pointSprings
      .filter(([, Kx, Ky, Km]) => Kx !== 0 || Ky !== 0 || Km !== 0)
      .map(([node, Kx, Ky, Km]) => ({ node, Kx, Ky, Km })),
    uniformSprings: uniformSprings
      .filter(([, k]) => k !== 0)
      .map(([member, k]) => ({ member, k })),
    samplesPerMember: 41,
    include,
  };
}

export function examplePayload(example: GalleryExample): SolveRequest {
  return solveRequestFromFields(example.fields, example.E, example.I, example.A);
}
