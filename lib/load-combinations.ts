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
