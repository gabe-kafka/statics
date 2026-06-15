import test from "node:test";
import assert from "node:assert/strict";
import { solve } from "../../lib/solver";
import { solveRequest } from "../../lib/api/solve-request";
import { combineLoads } from "../../lib/load-combinations";
import { coerceAiDesignResult } from "../../lib/ai-design";
import { DEFAULT_FIELDS } from "../../lib/design-fields";
import { decryptSecret, encryptSecret } from "../../lib/secret-crypto";
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

test("API solve auto-splits members at inline nodes for point loads and moments", () => {
  const result = solveRequest({
    nodes: [
      [0, 0],
      [44, 0],
      [35.5, 0],
      [25, 0],
      [8.5, 0],
    ],
    members: [{ i: 0, j: 1, E: 29000, I: 100, A: 10 }],
    supports: [{ node: 0, Rx: true, Ry: false, Rm: false }],
    pointLoads: [{ node: 3, Fx: 0, Fy: 0, M: 5280 }],
    distLoads: [{ member: 0, wi: -0.75, wj: -0.75 }],
    uniformSprings: [{ member: 0, k: 5 }],
    samplesPerMember: 4,
    include: ["data"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.members.map((member) => [member.i, member.j]),
    [
      [0, 4],
      [4, 3],
      [3, 2],
      [2, 1],
    ],
  );
  assert.equal(result.members.length, 4);
  assert.ok(Number.isFinite(result.peaks.M.value));
});

test("AI design output coercion requires full design fields", () => {
  const result = coerceAiDesignResult({
    reply: "Created a 44 ft beam.",
    E: 29000,
    I: 100,
    fields: {
      ...DEFAULT_FIELDS,
      nodes: "(0, 0)\n(44, 0)",
      members: "(0, 1)",
    },
  });

  assert.equal(result.fields.nodes, "(0, 0)\n(44, 0)");
  assert.throws(() =>
    coerceAiDesignResult({
      reply: "bad",
      E: 29000,
      I: 100,
      fields: { nodes: "(0, 0)" },
    }),
  );
});

test("saved API key encryption does not reveal plaintext and is user-bound", () => {
  process.env.AI_API_KEY_ENCRYPTION_SECRET =
    "test encryption secret with at least thirty two chars";

  const encrypted = encryptSecret("sk-test-key", "user-a");
  assert.ok(!encrypted.includes("sk-test-key"));
  assert.equal(decryptSecret(encrypted, "user-a"), "sk-test-key");
  assert.throws(() => decryptSecret(encrypted, "user-b"));
});
