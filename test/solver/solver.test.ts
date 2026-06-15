import test from "node:test";
import assert from "node:assert/strict";
import { solve } from "../../lib/solver";
import { combineLoads } from "../../lib/load-combinations";
import { solverCases } from "./cases";
import { assertCase } from "./helpers";

for (const testCase of solverCases) {
  test(testCase.name, () => {
    assertCase(solve(testCase.input), testCase);
  });
}

test("load combinations scale load rows by case", () => {
  const combined = combineLoads({
    loadCases: [
      ["D", "Dead"],
      ["L", "Live"],
    ],
    loadCombinations: [
      ["LRFD", "D", 1.2],
      ["LRFD", "L", 1.6],
    ],
    combinationId: "LRFD",
    pointLoads: [
      [1, 0, -10, 5, "D"],
      [2, 3, -4, 0, "L"],
    ],
    distLoads: [
      [0, -2, -2, "D"],
      [1, -1, -3, "L"],
    ],
  });

  assert.deepEqual(combined.pointLoads, [
    [1, 0, -12, 6],
    [2, 4.800000000000001, -6.4, 0],
  ]);
  assert.deepEqual(combined.distLoads, [
    [0, -2.4, -2.4],
    [1, -1.6, -4.800000000000001],
  ]);
});
