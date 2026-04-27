import test from "node:test";
import { solve } from "../../lib/solver";
import { solverCases } from "./cases";
import { assertCase } from "./helpers";

for (const testCase of solverCases) {
  test(testCase.name, () => {
    assertCase(solve(testCase.input), testCase);
  });
}
