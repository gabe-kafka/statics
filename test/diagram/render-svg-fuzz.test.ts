import test from "node:test";
import assert from "node:assert/strict";
import { solveRequest } from "../../lib/api/solve-request";
import type { SolveRequest } from "../../lib/api/types";

test("FBD SVG renders member-end hinges as white circles double the node radius", () => {
  const request: SolveRequest = {
    nodes: [
      [0, 0],
      [10, 0],
    ],
    members: [{ i: 0, j: 1, E: 29000, I: 100, A: 10 }],
    supports: [
      { node: 0, Rx: true, Ry: true, Rm: false },
      { node: 1, Rx: false, Ry: true, Rm: false },
    ],
    distLoads: [{ member: 0, wi: -2, wj: -2 }],
    hinges: [{ member: 0, end: "i" }],
    samplesPerMember: 10,
    include: ["data", "svg"],
    theme: "light",
  };
  const result = solveRequest(request);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.svg?.fbd);
  assert.match(result.svg.fbd, /r="2\.6" fill="#0057ff"/);
  assert.match(
    result.svg.fbd,
    /r="5\.2" fill="#ffffff" stroke="#0057ff"/,
  );
});

test("FBD SVG renders signed Rx and Ry reactions without clipping", () => {
  const request = roofFrameRequest(11);
  const result = solveRequest(request);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.svg?.fbd);
  assert.match(result.svg.fbd, /Rx -?\d/);
  assert.match(result.svg.fbd, /Ry -?\d/);
  assert.ok(svgHeight(result.svg.fbd) > 220);
  assert.ok(
    reactionArrowShafts(result.svg.fbd).some(
      (shaft) => shaft.axis === "x" && shaft.length >= 10,
    ),
    "expected at least one non-collapsed horizontal reaction arrow shaft",
  );
  assertSvgCoordinatesInsideViewBox(result.svg.fbd, "roof frame FBD");
});

test("FBD SVG renders net support Rx only for repeated sawtooth bays", () => {
  const request: SolveRequest = {
    nodes: [
      [0, 0],
      [11, 6.5],
      [32, 0],
      [43, 6.5],
      [64, 0],
      [75, 6.5],
      [96, 0],
    ],
    members: [
      { i: 0, j: 1, E: 29000, I: 100, A: 10 },
      { i: 1, j: 2, E: 29000, I: 100, A: 10 },
      { i: 2, j: 3, E: 29000, I: 100, A: 10 },
      { i: 3, j: 4, E: 29000, I: 100, A: 10 },
      { i: 4, j: 5, E: 29000, I: 100, A: 10 },
      { i: 5, j: 6, E: 29000, I: 100, A: 10 },
    ],
    supports: [0, 2, 4, 6].map((node) => ({
      node,
      Rx: true,
      Ry: true,
      Rm: true,
    })),
    distLoads: Array.from({ length: 6 }, (_, member) => ({
      member,
      wi: -0.52,
      wj: -0.52,
      projected: true,
    })),
    hinges: [
      { member: 0, end: "j" },
      { member: 1, end: "i" },
      { member: 2, end: "j" },
      { member: 3, end: "i" },
      { member: 4, end: "j" },
      { member: 5, end: "i" },
    ],
    include: ["data", "svg"],
    theme: "light",
  };
  const result = solveRequest(request);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.svg?.fbd);
  assert.doesNotMatch(result.svg.fbd, /Rx[LR]/);
  assert.equal((result.svg.fbd.match(/>Rx\s+-?\d/g) ?? []).length, 2);
  assertSvgCoordinatesInsideViewBox(result.svg.fbd, "net Rx sawtooth FBD");
});

test("FBD SVG fuzz keeps generated drawing coordinates inside the viewBox", () => {
  for (let seed = 1; seed <= 96; seed++) {
    const request = roofFrameRequest(seed);
    const result = solveRequest(request);

    assert.equal(result.ok, true, `seed ${seed} should solve`);
    if (!result.ok) continue;
    assert.ok(result.svg?.fbd, `seed ${seed} should include an FBD SVG`);
    assertSvgCoordinatesInsideViewBox(result.svg.fbd, `seed ${seed}`);
  }
});

function roofFrameRequest(seed: number): SolveRequest {
  const rng = mulberry32(seed);
  const nodeCount = 3 + Math.floor(rng() * 5);
  const nodes: [number, number][] = [];
  let x = 0;

  for (let i = 0; i < nodeCount; i++) {
    if (i > 0) x += 55 + rng() * 65;
    const ridge = i % 2 === 1;
    const y = ridge ? 25 + rng() * 55 : rng() * 18;
    nodes.push([round(x), round(y)]);
  }

  const members = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    i,
    j: i + 1,
    E: 29000,
    I: 80 + rng() * 160,
    A: 8 + rng() * 10,
  }));
  const supports: SolveRequest["supports"] = [
    { node: 0, Rx: true, Ry: true, Rm: false },
    { node: nodeCount - 1, Rx: false, Ry: true, Rm: false },
  ];
  if (nodeCount > 4) {
    supports.push({
      node: Math.floor(nodeCount / 2),
      Rx: false,
      Ry: true,
      Rm: false,
    });
  }

  const pointLoads: NonNullable<SolveRequest["pointLoads"]> = [
    {
      node: Math.min(nodeCount - 1, Math.max(1, Math.floor(rng() * nodeCount))),
      Fx: round(-8 + rng() * 16),
      Fy: round(-6 - rng() * 22),
      M: rng() < 0.25 ? round((-1 + rng() * 2) * 360) : 0,
    },
  ];
  if (Math.abs(pointLoads[0].Fx) < 0.5) pointLoads[0].Fx = 4;

  const distLoads = members.map((_, member) => {
    const wi = -round(0.15 + rng() * 4.8);
    const wj = -round(0.15 + rng() * 4.8);
    return { member, wi, wj };
  });

  return {
    nodes,
    members,
    supports,
    pointLoads,
    distLoads,
    samplesPerMember: 10,
    include: ["data", "svg"],
    lengthUnit: "ft",
    theme: "light",
  };
}

function assertSvgCoordinatesInsideViewBox(svg: string, label: string): void {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(viewBox, `${label}: missing viewBox`);
  const width = Number(viewBox[1]);
  const height = Number(viewBox[2]);
  const tolerance = 0.75;

  for (const coordinate of svgCoordinates(svg)) {
    const limit = coordinate.axis === "x" ? width : height;
    assert.ok(
      coordinate.value >= -tolerance && coordinate.value <= limit + tolerance,
      `${label}: ${coordinate.axis}=${coordinate.value} outside 0..${limit} from ${coordinate.source}`,
    );
  }
}

function svgCoordinates(
  svg: string,
): { axis: "x" | "y"; value: number; source: string }[] {
  const out: { axis: "x" | "y"; value: number; source: string }[] = [];
  const number = "-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?";
  const attr = new RegExp(
    `\\b(x|x1|x2|cx|y|y1|y2|cy)="(${number})"`,
    "gi",
  );
  for (const match of svg.matchAll(attr)) {
    out.push({
      axis: match[1].includes("x") ? "x" : "y",
      value: Number(match[2]),
      source: match[0],
    });
  }

  for (const match of svg.matchAll(/\bpoints="([^"]+)"/g)) {
    const nums = match[1].match(new RegExp(number, "gi")) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      out.push({ axis: "x", value: Number(nums[i]), source: "points" });
      out.push({ axis: "y", value: Number(nums[i + 1]), source: "points" });
    }
  }

  for (const match of svg.matchAll(/\bd="([^"]+)"/g)) {
    const nums = match[1].match(new RegExp(number, "gi")) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      out.push({ axis: "x", value: Number(nums[i]), source: "path d" });
      out.push({ axis: "y", value: Number(nums[i + 1]), source: "path d" });
    }
  }

  return out;
}

function svgHeight(svg: string): number {
  const viewBox = svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/);
  assert.ok(viewBox, "missing viewBox");
  return Number(viewBox[1]);
}

function reactionArrowShafts(
  svg: string,
): { axis: "x" | "y"; length: number }[] {
  const out: { axis: "x" | "y"; length: number }[] = [];
  const number = "-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?";
  const reactionGroup = new RegExp(
    `<g stroke="#16a34a"[^>]*><line x1="(${number})" y1="(${number})" x2="(${number})" y2="(${number})"`,
    "gi",
  );

  for (const match of svg.matchAll(reactionGroup)) {
    const x1 = Number(match[1]);
    const y1 = Number(match[2]);
    const x2 = Number(match[3]);
    const y2 = Number(match[4]);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    out.push({
      axis: dx >= dy ? "x" : "y",
      length: Math.hypot(dx, dy),
    });
  }

  return out;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
