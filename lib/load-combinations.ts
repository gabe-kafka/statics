import type {
  DistLoadRow,
  LoadCase,
  LoadCombination,
  PointLoadRow,
} from "./design-fields";

export const ALL_LOADS_COMBINATION = "ALL";

export type CombinedLoads = {
  pointLoads: [number, number, number, number][];
  distLoads: [number, number, number][];
};

export type LoadCombinationKind = "service" | "strength";

export function combinationOptions(
  loadCombinations: LoadCombination[],
): string[] {
  const options = [ALL_LOADS_COMBINATION];
  for (const [combo] of loadCombinations) {
    const trimmed = combo.trim();
    if (!trimmed) continue;
    if (!options.some((option) => sameId(option, trimmed))) options.push(trimmed);
  }
  return options;
}

export function defaultCombinationId(loadCombinations: LoadCombination[]): string {
  return loadCombinations[0]?.[0]?.trim() || ALL_LOADS_COMBINATION;
}

export function hasCombination(
  loadCombinations: LoadCombination[],
  candidate: string,
): boolean {
  const normalized = candidate.trim();
  if (sameId(normalized, ALL_LOADS_COMBINATION)) return true;
  return loadCombinations.some(([combo]) => sameId(combo, normalized));
}

export function resolveCombinationId(
  loadCombinations: LoadCombination[],
  candidate: string,
): string {
  const normalized = candidate.trim();
  if (sameId(normalized, ALL_LOADS_COMBINATION)) return ALL_LOADS_COMBINATION;
  return (
    loadCombinations.find(([combo]) => sameId(combo, normalized))?.[0]?.trim() ??
    normalized
  );
}

export function combineLoads({
  pointLoads,
  distLoads,
  loadCases,
  loadCombinations,
  combinationId,
}: {
  pointLoads: PointLoadRow[];
  distLoads: DistLoadRow[];
  loadCases: LoadCase[];
  loadCombinations: LoadCombination[];
  combinationId: string;
}): CombinedLoads {
  const defaultCase = loadCases[0]?.[0] ?? "D";
  const factors = factorsForCombination(loadCombinations, combinationId);

  return combineLoadsWithFactors({
    pointLoads,
    distLoads,
    defaultCase,
    factors,
  });
}

export function combineLoadsForCase({
  pointLoads,
  distLoads,
  loadCases,
  loadCaseId,
}: {
  pointLoads: PointLoadRow[];
  distLoads: DistLoadRow[];
  loadCases: LoadCase[];
  loadCaseId: string;
}): CombinedLoads {
  const defaultCase = loadCases[0]?.[0] ?? "D";
  const factors = new Map([[normalizeId(loadCaseId || defaultCase), 1]]);
  return combineLoadsWithFactors({
    pointLoads,
    distLoads,
    defaultCase,
    factors,
  });
}

export function loadCaseOptions(loadCases: LoadCase[]): string[] {
  const options: string[] = [];
  for (const [loadCase] of loadCases) {
    const trimmed = loadCase.trim();
    if (trimmed && !options.some((option) => sameId(option, trimmed))) {
      options.push(trimmed);
    }
  }
  return options.length > 0 ? options : ["D"];
}

export function hasLoadCase(loadCases: LoadCase[], candidate: string): boolean {
  const normalized = candidate.trim();
  return loadCaseOptions(loadCases).some((loadCase) => sameId(loadCase, normalized));
}

export function resolveLoadCaseId(
  loadCases: LoadCase[],
  candidate: string,
): string {
  const normalized = candidate.trim();
  return (
    loadCaseOptions(loadCases).find((loadCase) => sameId(loadCase, normalized)) ??
    normalized
  );
}

export function classifyCombination(
  loadCombinations: LoadCombination[],
  combinationId: string,
): LoadCombinationKind {
  const normalized = normalizeId(combinationId);
  if (
    normalized.includes("strength") ||
    normalized.includes("lrfd") ||
    normalized.includes("ult")
  ) {
    return "strength";
  }
  if (
    normalized.includes("service") ||
    normalized.includes("serv") ||
    normalized.includes("asd")
  ) {
    return "service";
  }

  const rows = loadCombinations.filter(([combo]) => sameId(combo, combinationId));
  if (rows.length === 0) return "service";
  return rows.some(([, , factor]) => Math.abs(factor) > 1)
    ? "strength"
    : "service";
}

function combineLoadsWithFactors({
  pointLoads,
  distLoads,
  defaultCase,
  factors,
}: {
  pointLoads: PointLoadRow[];
  distLoads: DistLoadRow[];
  defaultCase: string;
  factors: Map<string, number> | null;
}): CombinedLoads {
  return {
    pointLoads: pointLoads
      .map(([node, fx, fy, moment, loadCase]) => {
        const factor = factorForCase(factors, loadCase || defaultCase);
        return [node, fx * factor, fy * factor, moment * factor] as [
          number,
          number,
          number,
          number,
        ];
      })
      .filter(([, fx, fy, moment]) => fx !== 0 || fy !== 0 || moment !== 0),
    distLoads: distLoads
      .map(([member, wi, wj, loadCase]) => {
        const factor = factorForCase(factors, loadCase || defaultCase);
        return [member, wi * factor, wj * factor] as [number, number, number];
      })
      .filter(([, wi, wj]) => wi !== 0 || wj !== 0),
  };
}

function factorsForCombination(
  loadCombinations: LoadCombination[],
  combinationId: string,
): Map<string, number> | null {
  if (sameId(combinationId, ALL_LOADS_COMBINATION)) return null;

  const factors = new Map<string, number>();
  for (const [combo, loadCase, factor] of loadCombinations) {
    if (!sameId(combo, combinationId)) continue;
    const key = normalizeId(loadCase);
    factors.set(key, (factors.get(key) ?? 0) + factor);
  }
  return factors.size > 0 ? factors : null;
}

function factorForCase(factors: Map<string, number> | null, loadCase: string): number {
  if (!factors) return 1;
  return factors.get(normalizeId(loadCase)) ?? 0;
}

function sameId(a: string, b: string): boolean {
  return normalizeId(a) === normalizeId(b);
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}
