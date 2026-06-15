import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ReactionOut, SolveRequest, SolveResponse } from "../lib/api/types";
import { solveRequest } from "../lib/api/solve-request";

type Scenario = {
  name?: string;
  request: SolveRequest;
};

type Equilibrium = {
  sumFx: number;
  sumFy: number;
  sumM0: number;
};

const DEFAULT_DIR = "scenarios";

function main() {
  const args = process.argv.slice(2);
  const files = scenarioFiles(args);
  if (files.length === 0) {
    console.error(`No scenario JSON files found. Pass files or add fixtures to ${DEFAULT_DIR}/.`);
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const file of files) {
    const scenario = readScenario(file);
    const name = scenario.name ?? basename(file, ".json");
    const result = solveRequest(scenario.request);

    if (!result.ok) {
      failed++;
      console.log(`\n✗ ${name}`);
      console.log(`  error: ${result.error}`);
      console.log(`  ${result.message}`);
      continue;
    }

    printScenario(name, scenario.request, result);
  }

  if (failed > 0) process.exitCode = 1;
}

function scenarioFiles(args: string[]): string[] {
  if (args.length > 0) return args.map((arg) => resolve(arg));
  const dir = resolve(DEFAULT_DIR);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => join(dir, file));
}

function readScenario(file: string): Scenario {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!raw || typeof raw !== "object" || !("request" in raw)) {
    throw new Error(`${file} must be an object with a request field.`);
  }
  return raw as Scenario;
}

function printScenario(name: string, request: SolveRequest, response: SolveResponse) {
  const eq = equilibrium(request, response.reactions);
  console.log(`\n✓ ${name}`);
  console.log(
    `  residuals: ΣFx=${fmt(eq.sumFx)}  ΣFy=${fmt(eq.sumFy)}  ΣM0=${fmt(eq.sumM0)}`,
  );
  console.log(
    `  peaks: |V|=${fmt(response.peaks.V.value)} @ m${response.peaks.V.member} s=${fmt(response.peaks.V.sLocal)}  ` +
      `|M|=${fmt(response.peaks.M.value)} @ m${response.peaks.M.member} s=${fmt(response.peaks.M.sLocal)}`,
  );
  console.log(
    `         |θ|=${fmt(response.peaks.theta.value)}  |Δ|=${fmt(response.peaks.delta.value)}`,
  );
  console.log(
    `  reactions: ${response.reactions
      .map((r) => `n${r.node}(Rx=${fmt(r.Rx)}, Ry=${fmt(r.Ry)}, M=${fmt(r.M)})`)
      .join("  ")}`,
  );
}

function equilibrium(request: SolveRequest, reactions: ReactionOut[]): Equilibrium {
  const eq: Equilibrium = { sumFx: 0, sumFy: 0, sumM0: 0 };

  for (const load of request.pointLoads ?? []) {
    const [x, y] = request.nodes[load.node];
    addForce(eq, x, y, load.Fx, load.Fy);
    eq.sumM0 += load.M ?? 0;
  }

  for (const load of request.distLoads ?? []) {
    const member = request.members[load.member];
    const a = request.nodes[member.i];
    const b = request.nodes[member.j];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    const total = ((load.wi + load.wj) / 2) * L;
    const centroid = Math.abs(load.wi + load.wj) < 1e-12
      ? L / 2
      : (L * (load.wi + 2 * load.wj)) / (3 * (load.wi + load.wj));
    const t = L > 0 ? centroid / L : 0;
    addForce(eq, a[0] + dx * t, a[1] + dy * t, 0, total);
  }

  for (const reaction of reactions) {
    const [x, y] = request.nodes[reaction.node];
    addForce(eq, x, y, reaction.Rx, reaction.Ry);
    eq.sumM0 += reaction.M;
  }

  return eq;
}

function addForce(eq: Equilibrium, x: number, y: number, fx: number, fy: number) {
  eq.sumFx += fx;
  eq.sumFy += fy;
  eq.sumM0 += x * fy - y * fx;
}

function fmt(value: number): string {
  const cleaned = Math.abs(value) < 1e-9 ? 0 : value;
  return cleaned.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: Math.abs(cleaned) > 0 && Math.abs(cleaned) < 1 ? 3 : 0,
  });
}

main();
