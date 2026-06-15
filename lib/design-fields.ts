export type Vec2 = [number, number];

export type InputKey =
  | "nodes"
  | "members"
  | "loadCases"
  | "loadCombinations"
  | "pointLoads"
  | "distLoads"
  | "fixity"
  | "pointSprings"
  | "uniformSprings"
  | "hinges";

export type InputSpec = {
  key: InputKey;
  label: string;
  columns: readonly string[];
};

export type Fields = Record<InputKey, string>;

export type LoadCase = [id: string, label: string];
export type LoadCombination = [combo: string, loadCase: string, factor: number];
export type PointLoadRow = [
  node: number,
  Fx: number,
  Fy: number,
  M: number,
  loadCase: string,
];
export type DistLoadRow = [
  member: number,
  wi: number,
  wj: number,
  loadCase: string,
];

export type ParsedDesignFields = {
  nodes: Vec2[];
  members: [number, number][];
  loadCases: LoadCase[];
  loadCombinations: LoadCombination[];
  fixity: [number, number, number, number][];
  pointLoads: PointLoadRow[];
  distLoads: DistLoadRow[];
  pointSprings: [number, number, number, number][];
  uniformSprings: [number, number][];
  hinges: [number, "i" | "j"][];
};

export const INPUTS: readonly InputSpec[] = [
  { key: "nodes", label: "NODES", columns: ["x", "y"] },
  { key: "members", label: "MEMBERS", columns: ["i", "j"] },
  { key: "loadCases", label: "LOAD CASES", columns: ["case", "label"] },
  {
    key: "loadCombinations",
    label: "LOAD COMBINATIONS",
    columns: ["combo", "case", "factor"],
  },
  {
    key: "pointLoads",
    label: "POINT LOADS",
    columns: ["node", "Fx", "Fy", "M", "case"],
  },
  {
    key: "distLoads",
    label: "DIST LOADS",
    columns: ["member", "w_i", "w_j", "case"],
  },
  { key: "fixity", label: "FIXITY", columns: ["node", "Rx", "Ry", "Mz"] },
  {
    key: "pointSprings",
    label: "POINT SPRINGS",
    columns: ["node", "Kx", "Ky", "Km"],
  },
  {
    key: "uniformSprings",
    label: "UNIFORM SPRINGS",
    columns: ["member", "k/in/ft"],
  },
  { key: "hinges", label: "HINGES", columns: ["member", "end"] },
];

export const DEFAULT_FIELDS: Fields = {
  nodes: "(0, 0)\n(15, 0)\n(31, 0)",
  members: "(0, 1)\n(1, 2)",
  loadCases: "(D, Dead)",
  loadCombinations: "(SERVICE, D, 1)",
  pointLoads: "(1, 0, -10, 0, D)",
  distLoads: "(0, -2.98, -2.98, D)\n(1, -3.50, -5.64, D)",
  fixity: "(0, 1, 1, 0)\n(2, 0, 1, 0)",
  pointSprings: "",
  uniformSprings: "",
  hinges: "",
};

export function parseRows(s: string): string[][] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l
        .replace(/^\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .map((x) => x.trim()),
    );
}

export function serializeRows(rows: string[][]): string {
  return rows.map((r) => `(${r.join(", ")})`).join("\n");
}

export function rowsToTSV(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

export function tsvToRows(s: string, cols: number): string[][] {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const cells = l.split("\t").map((c) => c.trim());
      while (cells.length < cols) cells.push("");
      return cells.slice(0, cols);
    });
}

export function parseFields(fields: Fields): ParsedDesignFields {
  const loadCases: LoadCase[] = parseRows(fields.loadCases).map((r) => [
    r[0]?.trim() || "D",
    r[1]?.trim() || r[0]?.trim() || "Dead",
  ]);
  const defaultCase = loadCases[0]?.[0] ?? "D";

  return {
    nodes: parseRows(fields.nodes).map(
      (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as Vec2,
    ),
    members: parseRows(fields.members).map(
      (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as [number, number],
    ),
    loadCases,
    loadCombinations: parseRows(fields.loadCombinations).map(
      (r) =>
        [
          r[0]?.trim() || "SERVICE",
          r[1]?.trim() || defaultCase,
          Number(r[2]) || 0,
        ] as LoadCombination,
    ),
    fixity: parseRows(fields.fixity).map(
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          Number(r[2]) || 0,
          Number(r[3]) || 0,
        ] as [number, number, number, number],
    ),
    pointLoads: parseRows(fields.pointLoads).map(
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          Number(r[2]) || 0,
          Number(r[3]) || 0,
          r[4]?.trim() || defaultCase,
        ] as PointLoadRow,
    ),
    distLoads: parseRows(fields.distLoads).map(
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          Number(r[2]) || 0,
          r[3]?.trim() || defaultCase,
        ] as DistLoadRow,
    ),
    pointSprings: parseRows(fields.pointSprings).map(
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          Number(r[2]) || 0,
          Number(r[3]) || 0,
        ] as [number, number, number, number],
    ),
    uniformSprings: parseRows(fields.uniformSprings).map(
      (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as [number, number],
    ),
    hinges: parseRows(fields.hinges).map(
      (r) => [Number(r[0]) || 0, r[1] === "j" ? "j" : "i"] as [number, "i" | "j"],
    ),
  };
}

export function fieldsFromDesign(d: Partial<Fields>): Fields {
  return {
    nodes: d.nodes ?? "",
    members: d.members ?? "",
    loadCases: d.loadCases ?? "",
    loadCombinations: d.loadCombinations ?? "",
    pointLoads: d.pointLoads ?? "",
    distLoads: d.distLoads ?? "",
    fixity: d.fixity ?? "",
    pointSprings: d.pointSprings ?? "",
    uniformSprings: d.uniformSprings ?? "",
    hinges: d.hinges ?? "",
  };
}
