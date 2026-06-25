export type Vec2 = [number, number];

export type InputKey =
  | "nodes"
  | "members"
  | "loadCases"
  | "loadCombinations"
  | "pointLoads"
  | "axialLoads"
  | "pointMoments"
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
export type TransversePointLoadRow = [
  node: number,
  Fy: number,
  loadCase: string,
];
export type AxialPointLoadRow = [node: number, Fx: number, loadCase: string];
export type PointMomentRow = [node: number, M: number, loadCase: string];
export type DistLoadRow = [
  member: number,
  wi: number,
  wj: number,
  loadCase: string,
  projected: boolean,
];
export type UniformSpringRow = [
  member: number,
  k: number,
  compressionOnly: boolean,
];

const DEFAULT_LOAD_CASE_ROWS = [
  ["D", "Dead"],
  ["L", "Live"],
];

const LOAD_COMBINATION_COLUMNS = [
  "combo",
  ...DEFAULT_LOAD_CASE_ROWS.map(([id]) => id),
];

const DEFAULT_LOAD_COMBINATION_ROWS = [
  ["SERVICE", "1", "1"],
  ["1.4D", "1.4", ""],
  ["1.2D+1.6L", "1.2", "1.6"],
  ["1.2D+1.0L", "1.2", "1"],
  ["0.9D", "0.9", ""],
  ["0.9D+1.0L", "0.9", "1"],
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
  uniformSprings: UniformSpringRow[];
  hinges: [number, "i" | "j"][];
};

export const INPUTS: readonly InputSpec[] = [
  { key: "nodes", label: "NODES", columns: ["x", "y"] },
  { key: "members", label: "MEMBERS", columns: ["i", "j"] },
  { key: "loadCases", label: "LOAD CASES", columns: ["case", "label"] },
  {
    key: "loadCombinations",
    label: "LOAD COMBINATIONS",
    columns: LOAD_COMBINATION_COLUMNS,
  },
  {
    key: "pointLoads",
    label: "POINT LOADS",
    columns: ["node", "Fy", "case"],
  },
  {
    key: "axialLoads",
    label: "AXIAL POINT LOADS",
    columns: ["node", "Fx", "case"],
  },
  {
    key: "pointMoments",
    label: "POINT MOMENTS",
    columns: ["node", "M", "case"],
  },
  {
    key: "distLoads",
    label: "DIST LOADS",
    columns: ["member", "w_i", "w_j", "case", "projected"],
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
    columns: ["member", "k/in/ft", "compression only"],
  },
  { key: "hinges", label: "HINGES", columns: ["member", "end"] },
];

export const DEFAULT_FIELDS: Fields = {
  nodes: "(0, 0)\n(15, 0)\n(31, 0)",
  members: "(0, 1)\n(1, 2)",
  loadCases: serializeRows(DEFAULT_LOAD_CASE_ROWS),
  loadCombinations: serializeRows(DEFAULT_LOAD_COMBINATION_ROWS),
  pointLoads: "(1, -10, D)",
  axialLoads: "",
  pointMoments: "",
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

export function defaultRowForInput(spec: InputSpec, rowIndex: number): string[] {
  if (spec.key === "loadCases") {
    return DEFAULT_LOAD_CASE_ROWS[rowIndex] ?? [`CASE ${rowIndex + 1}`, ""];
  }
  if (spec.key === "loadCombinations") {
    return (
      DEFAULT_LOAD_COMBINATION_ROWS[rowIndex] ?? [
        `COMBO ${rowIndex + 1}`,
        "1",
      ]
    );
  }
  if (
    spec.key === "pointLoads" ||
    spec.key === "axialLoads" ||
    spec.key === "pointMoments"
  )
    return ["0", "0", "D"];
  if (spec.key === "distLoads") return ["0", "0", "0", "D", "0"];
  return spec.columns.map(() => "0");
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

export function groupLoadCombinationRows(rows: string[][]): string[][] {
  const out: string[][] = [];
  const byCombo = new Map<string, string[]>();

  for (const row of rows) {
    const combo = row[0]?.trim() || "SERVICE";
    let grouped = byCombo.get(combo);
    if (!grouped) {
      grouped = [combo];
      byCombo.set(combo, grouped);
      out.push(grouped);
    }

    if (row.length <= 3) {
      const loadCase = row[1]?.trim() ?? "";
      const factor = row[2]?.trim() ?? "";
      if (loadCase || factor) grouped.push(loadCase, factor);
      continue;
    }

    for (let ci = 1; ci < row.length; ci += 2) {
      const loadCase = row[ci]?.trim() ?? "";
      const factor = row[ci + 1]?.trim() ?? "";
      if (loadCase || factor) grouped.push(loadCase, factor);
    }
  }

  return out;
}

export function loadCombinationCaseColumns(
  loadCaseOptions: readonly string[],
  rows: string[][] = [],
): string[] {
  const out: string[] = [];
  const add = (value: string | undefined) => {
    const id = value?.trim();
    if (!id) return;
    if (!out.some((existing) => sameLoadCaseId(existing, id))) out.push(id);
  };

  loadCaseOptions.forEach(add);

  for (const row of rows) {
    if (isLoadCombinationMatrixRow(row, out)) continue;
    for (let ci = 1; ci < row.length; ci += 2) add(row[ci]);
  }

  if (out.length === 0) DEFAULT_LOAD_CASE_ROWS.forEach(([id]) => add(id));
  return out;
}

export function loadCombinationFactorRows(
  rows: string[][],
  loadCaseOptions: readonly string[],
): string[][] {
  const cases = loadCombinationCaseColumns(loadCaseOptions, rows);
  const out: { combo: string; factors: Map<string, string> }[] = [];
  const byCombo = new Map<string, Map<string, string>>();

  for (const row of rows) {
    const combo = row[0]?.trim() || "SERVICE";
    let factors = byCombo.get(combo);
    if (!factors) {
      factors = new Map();
      byCombo.set(combo, factors);
      out.push({ combo, factors });
    }

    if (isLoadCombinationMatrixRow(row, cases)) {
      cases.forEach((loadCase, index) => {
        const factor = row[index + 1]?.trim() ?? "";
        if (factor) factors.set(normalizeLoadCaseId(loadCase), factor);
      });
      continue;
    }

    for (let ci = 1; ci < row.length; ci += 2) {
      const loadCase = row[ci]?.trim() ?? "";
      const factor = row[ci + 1]?.trim() ?? "";
      if (!loadCase && !factor) continue;
      factors.set(normalizeLoadCaseId(loadCase || cases[0] || "D"), factor);
    }
  }

  return out.map(({ combo, factors }) => [
    combo,
    ...cases.map((loadCase) => factors.get(normalizeLoadCaseId(loadCase)) ?? ""),
  ]);
}

export function authoringRowCount(key: InputKey, value: string): number {
  const rows = parseRows(value);
  if (key === "loadCombinations") {
    return loadCombinationFactorRows(rows, []).length;
  }
  return rows.length;
}

export function parseFields(fields: Fields): ParsedDesignFields {
  const loadCases: LoadCase[] = parseRows(fields.loadCases).map((r) => [
    r[0]?.trim() || "D",
    r[1]?.trim() || r[0]?.trim() || "Dead",
  ]);
  const defaultCase = loadCases[0]?.[0] ?? "D";
  const parsedPointLoads: PointLoadRow[] = [
    ...parseRows(fields.pointLoads).map((r) =>
      parsePointLoadAuthoringRow(r, defaultCase),
    ),
    ...parseRows(fields.axialLoads).map(
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          0,
          0,
          r[2]?.trim() || defaultCase,
        ] as PointLoadRow,
    ),
    ...parseRows(fields.pointMoments).map(
      (r) =>
        [
          Number(r[0]) || 0,
          0,
          0,
          Number(r[1]) || 0,
          r[2]?.trim() || defaultCase,
        ] as PointLoadRow,
    ),
  ];

  return {
    nodes: parseRows(fields.nodes).map(
      (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as Vec2,
    ),
    members: parseRows(fields.members).map(
      (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as [number, number],
    ),
    loadCases,
    loadCombinations: parseLoadCombinations(
      fields.loadCombinations,
      loadCases,
      defaultCase,
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
    pointLoads: parsedPointLoads,
    distLoads: parseRows(fields.distLoads).map(
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          Number(r[2]) || 0,
          r[3]?.trim() || defaultCase,
          isTruthyCell(r[4] ?? ""),
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
      (r) =>
        [
          Number(r[0]) || 0,
          Number(r[1]) || 0,
          isTruthyCell(r[2] ?? ""),
        ] as UniformSpringRow,
    ),
    hinges: parseRows(fields.hinges).map(
      (r) => [Number(r[0]) || 0, r[1] === "j" ? "j" : "i"] as [number, "i" | "j"],
    ),
  };
}

function parseLoadCombinations(
  value: string,
  loadCases: LoadCase[],
  defaultCase: string,
): LoadCombination[] {
  const out: LoadCombination[] = [];
  const rows = parseRows(value);
  const cases = loadCombinationCaseColumns(
    loadCases.map(([id]) => id),
    rows,
  );

  for (const row of loadCombinationFactorRows(rows, cases)) {
    const combo = row[0]?.trim() || "SERVICE";
    for (let ci = 1; ci < row.length; ci++) {
      const factor = row[ci]?.trim();
      if (!factor) continue;
      out.push([combo, cases[ci - 1] || defaultCase, Number(factor) || 0]);
    }
  }
  return out;
}

function isLoadCombinationMatrixRow(
  row: string[],
  loadCaseOptions: readonly string[],
): boolean {
  if (loadCaseOptions.length === 0 || row.length <= 1) return false;
  const secondCell = row[1]?.trim();
  if (!secondCell) return true;
  if (
    loadCaseOptions.some((loadCase) => sameLoadCaseId(loadCase, secondCell))
  ) {
    return false;
  }
  return isNumericCell(secondCell);
}

function sameLoadCaseId(a: string, b: string): boolean {
  return normalizeLoadCaseId(a) === normalizeLoadCaseId(b);
}

function normalizeLoadCaseId(id: string): string {
  return id.trim().toUpperCase();
}

function isNumericCell(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

export function fieldsFromDesign(d: Partial<Fields>): Fields {
  const pointLoadTables = splitPointLoadTables(d);
  return {
    nodes: d.nodes ?? "",
    members: d.members ?? "",
    loadCases: d.loadCases ?? "",
    loadCombinations: d.loadCombinations ?? "",
    pointLoads: pointLoadTables.pointLoads,
    axialLoads: pointLoadTables.axialLoads,
    pointMoments: pointLoadTables.pointMoments,
    distLoads: d.distLoads ?? "",
    fixity: d.fixity ?? "",
    pointSprings: d.pointSprings ?? "",
    uniformSprings: d.uniformSprings ?? "",
    hinges: d.hinges ?? "",
  };
}

function parsePointLoadAuthoringRow(
  r: string[],
  defaultCase: string,
): PointLoadRow {
  if (r.length >= 4) {
    return [
      Number(r[0]) || 0,
      Number(r[1]) || 0,
      Number(r[2]) || 0,
      Number(r[3]) || 0,
      r[4]?.trim() || defaultCase,
    ];
  }
  return [
    Number(r[0]) || 0,
    0,
    Number(r[1]) || 0,
    0,
    r[2]?.trim() || defaultCase,
  ];
}

function splitPointLoadTables(d: Partial<Fields>): {
  pointLoads: string;
  axialLoads: string;
  pointMoments: string;
} {
  const rows = parseRows(d.pointLoads ?? "");
  const hasLegacyCombinedRows = rows.some((row) => row.length >= 4);
  if (!hasLegacyCombinedRows) {
    return {
      pointLoads: d.pointLoads ?? "",
      axialLoads: d.axialLoads ?? "",
      pointMoments: d.pointMoments ?? "",
    };
  }

  const defaultCase = parseRows(d.loadCases ?? "")[0]?.[0]?.trim() || "D";
  const pointRows: string[][] = [];
  const axialRows: string[][] = parseRows(d.axialLoads ?? "");
  const momentRows: string[][] = parseRows(d.pointMoments ?? "");

  for (const row of rows) {
    if (row.length < 4) {
      pointRows.push(row);
      continue;
    }
    const node = row[0]?.trim() || "0";
    const fx = row[1]?.trim() || "0";
    const fy = row[2]?.trim() || "0";
    const moment = row[3]?.trim() || "0";
    const loadCase = row[4]?.trim() || defaultCase;
    if (isNonzeroCell(fy)) pointRows.push([node, fy, loadCase]);
    if (isNonzeroCell(fx)) axialRows.push([node, fx, loadCase]);
    if (isNonzeroCell(moment)) momentRows.push([node, moment, loadCase]);
  }

  return {
    pointLoads: serializeRows(pointRows),
    axialLoads: serializeRows(axialRows),
    pointMoments: serializeRows(momentRows),
  };
}

function isNonzeroCell(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

function isTruthyCell(value: string): boolean {
  const n = Number(value.trim());
  return Number.isFinite(n) && n !== 0;
}
