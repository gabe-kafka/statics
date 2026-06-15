import assert from "node:assert/strict";
import type {
  ExpectedMemberDirection,
  ExpectedReaction,
  ExpectedSample,
  SolverCase,
} from "./cases";
import type { Solution } from "../../lib/solver";

export function assertCase(solution: Solution, testCase: SolverCase): void {
  const tolerance = testCase.tolerance ?? 1e-6;
  const expectedOk = testCase.expect.ok ?? true;
  assert.equal(solution.ok, expectedOk, testCase.name);

  if (!expectedOk) {
    if (testCase.expect.errorIncludes) {
      assert.match(solution.error ?? "", new RegExp(testCase.expect.errorIncludes));
    }
    return;
  }

  for (const reaction of testCase.expect.reactions ?? []) {
    assertReaction(solution, reaction, tolerance);
  }

  for (const sample of testCase.expect.samples ?? []) {
    assertSample(solution, sample, tolerance);
  }

  for (const direction of testCase.expect.memberDirections ?? []) {
    assertMemberDirection(solution, direction, tolerance);
  }
}

function assertReaction(
  solution: Solution,
  expected: ExpectedReaction,
  tolerance: number,
): void {
  const actual = solution.reactions.find((r) => r.node === expected.node);
  assert.ok(actual, `missing reaction at node ${expected.node}`);
  assertClose(actual.Rx, expected.Rx, tolerance, `node ${expected.node} Rx`);
  assertClose(actual.Ry, expected.Ry, tolerance, `node ${expected.node} Ry`);
  assertClose(actual.M, expected.M, tolerance, `node ${expected.node} M`);
}

function assertSample(
  solution: Solution,
  expected: ExpectedSample,
  tolerance: number,
): void {
  const member = solution.members[expected.member];
  assert.ok(member, `missing member ${expected.member}`);
  assertClose(member.V(expected.s), expected.V, tolerance, `member ${expected.member} V(${expected.s})`);
  assertClose(member.M(expected.s), expected.M, tolerance, `member ${expected.member} M(${expected.s})`);
  assertClose(
    member.theta(expected.s),
    expected.theta,
    tolerance,
    `member ${expected.member} theta(${expected.s})`,
  );
  assertClose(
    member.delta(expected.s),
    expected.delta,
    tolerance,
    `member ${expected.member} delta(${expected.s})`,
  );
}

function assertMemberDirection(
  solution: Solution,
  expected: ExpectedMemberDirection,
  tolerance: number,
): void {
  const member = solution.members[expected.member];
  assert.ok(member, `missing member ${expected.member}`);
  assertClose(member.c, expected.c, tolerance, `member ${expected.member} c`);
  assertClose(member.s, expected.s, tolerance, `member ${expected.member} s`);
}

function assertClose(
  actual: number,
  expected: number | undefined,
  tolerance: number,
  label: string,
): void {
  if (expected === undefined) return;
  const delta = Math.abs(actual - expected);
  assert.ok(
    delta <= tolerance,
    `${label}: expected ${expected}, got ${actual}, delta ${delta}`,
  );
}
