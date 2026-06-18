import test from "node:test";
import assert from "node:assert/strict";
import { solve } from "../../lib/solver";
import { solveRequest } from "../../lib/api/solve-request";
import {
  classifyCombination,
  combineLoads,
  combineLoadsForCase,
} from "../../lib/load-combinations";
import { coerceAiDesignResult } from "../../lib/ai-design";
import {
  DEFAULT_FIELDS,
  authoringRowCount,
  fieldsFromDesign,
  groupLoadCombinationRows,
  parseFields,
  type LoadCombination,
} from "../../lib/design-fields";
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
    [1, 0, -12, 6, "D"],
    [2, 4.800000000000001, -6.4, 0, "L"],
  ]);
  assert.deepEqual(combined.distLoads, [
    [0, -2.4, -2.4, "D"],
    [1, -1.6, -4.800000000000001, "L"],
  ]);
});

test("load cases isolate matching load rows without combination factors", () => {
  const combined = combineLoadsForCase({
    loadCases: [
      ["D", "Dead"],
      ["L", "Live"],
    ],
    loadCaseId: "L",
    pointLoads: [
      [1, 0, -10, 5, "D"],
      [2, 3, -4, 0, "L"],
    ],
    distLoads: [
      [0, -2, -2, "D"],
      [1, -1, -3, "L"],
    ],
  });

  assert.deepEqual(combined.pointLoads, [[2, 3, -4, 0, "L"]]);
  assert.deepEqual(combined.distLoads, [[1, -1, -3, "L"]]);
});

test("formula-style load combination names define their own case factors", () => {
  const combined = combineLoads({
    loadCases: [
      ["D", "Dead"],
      ["L", "Live"],
      ["EQ", "Earthquake"],
    ],
    loadCombinations: [
      ["1.0D+0.525EQ+0.75L", "D", 1],
      ["1.0D+0.525EQ+0.75L", "L", 0.525],
      ["1.0D+0.525EQ+0.75L", "D", 0.75],
    ],
    combinationId: "1.0D+0.525EQ+0.75L",
    pointLoads: [
      [2, 0, -425, 0, "D"],
      [2, 0, -256, 0, "L"],
      [4, 0, -100, 0, "EQ"],
    ],
    distLoads: [],
  });

  assert.deepEqual(combined.pointLoads, [
    [2, 0, -425, 0, "D"],
    [2, 0, -192, 0, "L"],
    [4, 0, -52.5, 0, "EQ"],
  ]);
});

test("wide load combination rows parse as repeated case factor slots", () => {
  const parsed = parseFields({
    ...DEFAULT_FIELDS,
    loadCombinations:
      "(1.0D+0.525EQ+0.75L, D, 1, EQ, 0.525, L, 0.75)",
  });

  assert.deepEqual(parsed.loadCombinations, [
    ["1.0D+0.525EQ+0.75L", "D", 1],
    ["1.0D+0.525EQ+0.75L", "EQ", 0.525],
    ["1.0D+0.525EQ+0.75L", "L", 0.75],
  ]);
});

test("legacy load combination rows group into one wide authoring row", () => {
  assert.deepEqual(
    groupLoadCombinationRows([
      ["SERVICE", "D", "1"],
      ["SERVICE", "L", "1"],
      ["1.2D+1.6L", "D", "1.2"],
      ["1.2D+1.6L", "L", "1.6"],
    ]),
    [
      ["SERVICE", "D", "1", "L", "1"],
      ["1.2D+1.6L", "D", "1.2", "L", "1.6"],
    ],
  );
});

test("load combination authoring count reports combos instead of factor rows", () => {
  const value =
    "(SERVICE, D, 1)\n" +
    "(SERVICE, L, 1)\n" +
    "(1.2D+1.6L, D, 1.2)\n" +
    "(1.2D+1.6L, L, 1.6)";

  assert.equal(authoringRowCount("loadCombinations", value), 2);
  assert.equal(authoringRowCount("pointLoads", "(1, -10, D)\n(2, -5, L)"), 2);
});

test("load combinations classify service and strength envelopes", () => {
  const combinations: LoadCombination[] = [
    ["SERVICE", "D", 1],
    ["SERVICE", "L", 1],
    ["1.2D+1.6L", "D", 1.2],
    ["1.2D+1.6L", "L", 1.6],
  ];

  assert.equal(classifyCombination(combinations, "SERVICE"), "service");
  assert.equal(classifyCombination(combinations, "1.2D+1.6L"), "strength");
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

test("uniform spring authoring supports compression-only checkbox", () => {
  const parsed = parseFields({
    ...DEFAULT_FIELDS,
    uniformSprings: "(0, 5, 1)",
  });

  assert.deepEqual(parsed.uniformSprings, [[0, 5, true]]);
});

test("compression-only uniform spring releases when member lifts off", () => {
  const baseInput = {
    nodes: [
      [0, 0],
      [120, 0],
    ] as [number, number][],
    members: [[0, 1] as [number, number]],
    fixity: [[0, 1, 1, 1] as [number, number, number, number]],
    pointLoads: [[1, 0, 10] as [number, number, number]],
    distLoads: [],
  };

  const withoutSpring = solve({ ...baseInput, uniformSprings: [] });
  const compressionOnly = solve({
    ...baseInput,
    uniformSprings: [[0, 5, true]],
  });
  const linear = solve({
    ...baseInput,
    uniformSprings: [[0, 5, false]],
  });

  assert.equal(withoutSpring.ok, true);
  assert.equal(compressionOnly.ok, true);
  assert.equal(linear.ok, true);
  if (!withoutSpring.ok || !compressionOnly.ok || !linear.ok) return;

  const freeTip = withoutSpring.members[0].delta(120);
  const compressionTip = compressionOnly.members[0].delta(120);
  const linearTip = linear.members[0].delta(120);

  assert.ok(freeTip > 0);
  assert.ok(Math.abs(compressionTip - freeTip) < 1e-8);
  assert.ok(linearTip < freeTip);
});

test("uniform spring reaction contributes to API shear recovery", () => {
  const result = solveRequest({
    nodes: [
      [0, 0],
      [120, 0],
    ],
    members: [{ i: 0, j: 1, E: 29000, I: 100, A: 10 }],
    supports: [{ node: 0, Rx: true, Ry: true, Rm: true }],
    pointLoads: [{ node: 1, Fx: 0, Fy: -10 }],
    uniformSprings: [{ member: 0, k: 5, compressionOnly: true }],
    samplesPerMember: 12,
    include: ["data"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const samples = result.members[0].samples;
  const maxReaction = Math.max(...samples.map((sample) => sample.R));
  assert.ok(maxReaction > 0);
  assert.ok(samples[6].V > samples[0].V);
});

test("authoring load tables combine vertical, axial, and moment point loads", () => {
  const parsed = parseFields({
    ...DEFAULT_FIELDS,
    pointLoads: "(1, -10, D)",
    axialLoads: "(2, 4, L)",
    pointMoments: "(3, 25, EQ)",
  });

  assert.deepEqual(parsed.pointLoads, [
    [1, 0, -10, 0, "D"],
    [2, 4, 0, 0, "L"],
    [3, 0, 0, 25, "EQ"],
  ]);
});

test("legacy combined point load rows split into the new authoring tables", () => {
  const fields = fieldsFromDesign({
    ...DEFAULT_FIELDS,
    pointLoads: "(1, 5, -10, 25, D)\n(2, 0, -4, 0, L)",
    axialLoads: "",
    pointMoments: "",
  });

  assert.equal(fields.pointLoads, "(1, -10, D)\n(2, -4, L)");
  assert.equal(fields.axialLoads, "(1, 5, D)");
  assert.equal(fields.pointMoments, "(1, 25, D)");
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
