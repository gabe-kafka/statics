"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Fixity,
  Member,
  PointSpring,
  UniformSpring,
  Vec2,
} from "@/lib/solver";
import type {
  DistLoadRow,
  LoadCase,
  LoadCombination,
  PointLoadRow,
} from "@/lib/design-fields";
import {
  combineLoads,
  combinationOptions,
  defaultCombinationId,
  hasCombination,
  resolveCombinationId,
} from "@/lib/load-combinations";
import type {
  ReactionOut,
  SampleOut,
  SolveRequest,
  SolveResponse,
  ApiError,
} from "@/lib/api/types";

// Colors chosen to echo the conjugate-method notebook palette.
// Surface colors come from page-level CSS vars so the diagrams follow
// the active light/dark theme (driven by prefers-color-scheme in
// globals.css). Saturated accents are shared across both themes —
// they're vivid enough to read on either background.
const PALETTE = {
  bg: "var(--bg)",
  fg: "var(--text)",
  dim: "var(--dim)",
  beam: "#111111",
  load: "#dc2626",
  support: "#4aa3ff",
  reaction: "#a6ff5a",
  shear: "#ffd100",
  moment: "#a6ff5a",
  theta: "#4aa3ff",
  delta: "#ff7aa2",
};

type Props = {
  nodes: Vec2[];
  members: Member[];
  loadCases: LoadCase[];
  loadCombinations: LoadCombination[];
  pointLoads: PointLoadRow[];
  distLoads: DistLoadRow[];
  pointSprings: PointSpring[];
  uniformSprings: UniformSpring[];
  fixity: Fixity[];
  hinges: [number, "i" | "j"][];
  E: number;
  I: number;
  A: number;
  onChangeE: (v: number) => void;
  onChangeI: (v: number) => void;
};

type ApiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: SolveResponse }
  | { kind: "error"; message: string };

const SAMPLES_PER_MEMBER = 41;

export function Diagrams({
  nodes,
  members,
  loadCases,
  loadCombinations,
  pointLoads,
  distLoads,
  pointSprings,
  uniformSprings,
  fixity,
  hinges,
  E,
  I,
  A,
  onChangeE,
  onChangeI,
}: Props) {
  const [state, setState] = useState<ApiState>({ kind: "idle" });
  const [runId, setRunId] = useState(0);
  const [selectedCombinationId, setSelectedCombinationId] = useState(() =>
    defaultCombinationId(loadCombinations),
  );
  const reqIdRef = useRef(0);
  const comboOptions = useMemo(
    () => combinationOptions(loadCombinations),
    [loadCombinations],
  );
  const activeCombinationId = hasCombination(loadCombinations, selectedCombinationId)
    ? selectedCombinationId
    : defaultCombinationId(loadCombinations);
  const combinedLoads = useMemo(
    () =>
      combineLoads({
        pointLoads,
        distLoads,
        loadCases,
        loadCombinations,
        combinationId: activeCombinationId,
      }),
    [pointLoads, distLoads, loadCases, loadCombinations, activeCombinationId],
  );

  const runCombination = () => {
    const answer = window.prompt("which load comb do you want", activeCombinationId);
    if (answer === null) return;
    const next = answer.trim();
    if (!next) return;
    if (!hasCombination(loadCombinations, next)) {
      window.alert(`Unknown load combination. Available: ${comboOptions.join(", ")}`);
      return;
    }
    setSelectedCombinationId(resolveCombinationId(loadCombinations, next));
    setRunId((value) => value + 1);
  };

  useEffect(() => {
    const req: SolveRequest = {
      nodes: nodes.map((n) => [n[0], n[1]]),
      members: members.map(([i, j]) => ({ i, j, E, I, A })),
      supports: fixity.map(([node, rx, ry, rm]) => ({
        node,
        Rx: !!rx,
        Ry: !!ry,
        Rm: !!rm,
      })),
      pointLoads: combinedLoads.pointLoads
        .filter(([, fx, fy, moment = 0]) => fx !== 0 || fy !== 0 || moment !== 0)
        .map(([node, Fx, Fy, M = 0]) => ({ node, Fx, Fy, M })),
      distLoads: combinedLoads.distLoads.map(([member, wi, wj]) => ({
        member,
        wi,
        wj,
      })),
      pointSprings: pointSprings
        .filter(([, Kx, Ky, Km]) => Kx !== 0 || Ky !== 0 || Km !== 0)
        .map(([node, Kx, Ky, Km]) => ({ node, Kx, Ky, Km })),
      uniformSprings: uniformSprings
        .filter(([, k]) => k !== 0)
        .map(([member, k]) => ({ member, k })),
      hinges: hinges.map(([member, end]) => ({ member, end })),
      samplesPerMember: SAMPLES_PER_MEMBER,
      include: ["data"],
    };

    if (req.nodes.length === 0 || req.members.length === 0) {
      // Keeps stale solver output hidden when the current model is empty.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "idle" });
      return;
    }

    const id = ++reqIdRef.current;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setState({ kind: "loading" });
      try {
        const res = await fetch("/api/v1/solve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: ctl.signal,
        });
        const json = (await res.json()) as SolveResponse | ApiError;
        if (id !== reqIdRef.current) return;
        if (!json.ok) {
          setState({ kind: "error", message: formatApiError(json) });
          return;
        }
        setState({ kind: "ok", data: json });
      } catch (err) {
        if (id !== reqIdRef.current) return;
        if ((err as Error).name === "AbortError") return;
        setState({ kind: "error", message: (err as Error).message });
      }
    }, 250);

    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [
    nodes,
    members,
    combinedLoads,
    pointSprings,
    uniformSprings,
    fixity,
    hinges,
    E,
    I,
    A,
    runId,
  ]);

  const W = 880;
  const PAD = 48;
  const H_FBD = 180;
  const H_V = 150;
  const H_M = 150;
  const H_BREAK = 44;
  const H_T = 130;
  const H_D = 130;
  const GAP = 18;

  const stationEnds =
    state.kind === "ok"
      ? state.data.members.reduce<number[]>((acc, member) => {
          acc.push((acc[acc.length - 1] ?? 0) + member.L);
          return acc;
        }, [])
      : [];
  const totalStation = Math.max(stationEnds[stationEnds.length - 1] ?? 1, 1);
  const X = (s: number) => PAD + (s / totalStation) * (W - 2 * PAD);
  const frame = projectFrame(nodes, W, H_FBD, 28);

  type Sample = { station: number; x: number; y: number; v: number; m: number; t: number; d: number };
  const samples: Sample[] = [];
  const reactions: ReactionOut[] =
    state.kind === "ok" ? state.data.reactions : [];
  const reactionMasks = new Map<
    number,
    { Rx: boolean; Ry: boolean; M: boolean }
  >();
  const addReactionMask = (
    node: number,
    next: { Rx?: boolean; Ry?: boolean; M?: boolean },
  ) => {
    const mask = reactionMasks.get(node) ?? { Rx: false, Ry: false, M: false };
    reactionMasks.set(node, {
      Rx: mask.Rx || !!next.Rx,
      Ry: mask.Ry || !!next.Ry,
      M: mask.M || !!next.M,
    });
  };
  fixity.forEach(([node, rx, ry, rm]) => {
    addReactionMask(node, { Rx: !!rx, Ry: !!ry, M: !!rm });
  });
  pointSprings.forEach(([node, kx, ky, km]) => {
    addReactionMask(node, {
      Rx: kx !== 0,
      Ry: ky !== 0,
      M: km !== 0,
    });
  });
  const pointReactions = reactions
    .map((reaction) => {
      const mask = reactionMasks.get(reaction.node);
      if (!mask) return null;
      return {
        node: reaction.node,
        Rx: mask.Rx ? reaction.Rx : 0,
        Ry: mask.Ry ? reaction.Ry : 0,
        M: mask.M ? reaction.M : 0,
      };
    })
    .filter(
      (reaction): reaction is ReactionOut =>
        !!reaction &&
        Math.abs(reaction.Rx) + Math.abs(reaction.Ry) + Math.abs(reaction.M) >
          1e-6,
    );
  if (state.kind === "ok") {
    state.data.members.forEach((mr, idx) => {
      const station0 = idx === 0 ? 0 : stationEnds[idx - 1];
      mr.samples.forEach((s: SampleOut) => {
        samples.push({
          station: station0 + s.s,
          x: s.x,
          y: s.y,
          v: s.V,
          m: s.M,
          t: s.theta,
          d: s.delta,
        });
      });
    });
  }

  const vmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.v)));
  const mmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.m)));
  const tmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.t)));
  const dmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.d)));

  // Layout offsets — TOP svg (FBD + V + M)
  const H_TOP = H_FBD + GAP + H_V + GAP + H_M;
  const yV0 = H_FBD + GAP;
  const yVAxis = yV0 + H_V / 2;
  const yM0 = H_FBD + GAP + H_V + GAP;
  const yMAxis = yM0 + H_M / 2;

  // Layout offsets — BOTTOM svg (θ + Δ)
  const H_BOT = H_T + GAP + H_D;
  const yT0 = 0;
  const yTAxis = yT0 + H_T / 2;
  const yD0 = H_T + GAP;
  const yDAxis = yD0 + H_D / 2;

  // ─── FBD ───────────────────────────────────────────────────────────
  const fbdLoads: React.ReactElement[] = [];
  const fbdLoadLabels: React.ReactElement[] = [];

  // Distributed loads: render each as a top bar + downward arrows onto beam.
  combinedLoads.distLoads.forEach(([mIdx, wi, wj], k) => {
    const m = members[mIdx];
    if (!m) return;
    const a = nodes[m[0]];
    const b = nodes[m[1]];
    if (!a || !b) return;
    const xa = frame.X(a[0]);
    const xb = frame.X(b[0]);
    const yaBeam = frame.Y(a[1]);
    const ybBeam = frame.Y(b[1]);
    const wMax = Math.max(Math.abs(wi), Math.abs(wj), 1e-6);
    const SCALE = Math.min(55, 30 * (1 + wMax / 6));
    const ha = (Math.abs(wi) / wMax) * SCALE;
    const hb = (Math.abs(wj) / wMax) * SCALE;
    const y_a = yaBeam - ha - 2;
    const y_b = ybBeam - hb - 2;

    fbdLoads.push(
      <line
        key={`dl-top-${k}`}
        x1={xa}
        y1={y_a}
        x2={xb}
        y2={y_b}
        stroke={PALETTE.load}
        strokeWidth={1.4}
      />,
    );
    fbdLoads.push(
      <line
        key={`dl-L-${k}`}
        x1={xa}
        y1={y_a}
        x2={xa}
        y2={yaBeam - 2}
        stroke={PALETTE.load}
        strokeWidth={1.2}
      />,
    );
    fbdLoads.push(
      <line
        key={`dl-R-${k}`}
        x1={xb}
        y1={y_b}
        x2={xb}
        y2={ybBeam - 2}
        stroke={PALETTE.load}
        strokeWidth={1.2}
      />,
    );
    const N = Math.max(3, Math.round((xb - xa) / 24));
    for (let n = 1; n <= N - 1; n++) {
      const t = n / N;
      const xi = xa + t * (xb - xa);
      const yi_top = y_a + t * (y_b - y_a);
      fbdLoads.push(
        <Arrow
          key={`dl-a-${k}-${n}`}
          x1={xi}
          y1={yi_top}
          x2={xi}
          y2={yaBeam + t * (ybBeam - yaBeam) - 3}
          color={PALETTE.load}
          head={4}
        />,
      );
    }
    const midX = (xa + xb) / 2;
    const midY = Math.min(y_a, y_b) - 12;
    const label =
      Math.abs(wi - wj) < 1e-9
        ? `w=${fmt(Math.abs(wi))} klf`
        : `w=${fmt(Math.abs(wi))}->${fmt(Math.abs(wj))} klf`;
    fbdLoadLabels.push(
      <LoadLabel
        key={`dl-t-${k}`}
        x={midX}
        y={midY}
        text={label}
        anchor="middle"
      />,
    );
  });

  combinedLoads.pointLoads.forEach(([n, fx, fy, moment = 0], k) => {
    if (!nodes[n]) return;
    if (fx === 0 && fy === 0 && moment === 0) return;
    const cx = frame.X(nodes[n][0]);
    const cy = frame.Y(nodes[n][1]);
    const L = 40;
    if (fy !== 0) {
      const down = fy < 0;
      const tipY = down ? cy - 3 : cy + 3;
      const tailY = down ? tipY - L : tipY + L;
      fbdLoads.push(
        <Arrow
          key={`pl-${k}-y`}
          x1={cx}
          y1={tailY}
          x2={cx}
          y2={tipY}
          color={PALETTE.load}
          head={6}
        />,
      );
      fbdLoadLabels.push(
        <LoadLabel
          key={`pl-${k}-yt`}
          x={cx + 6}
          y={tailY + 10}
          text={`P=${fmt(Math.abs(fy))} k`}
          anchor="start"
        />,
      );
    }
    if (fx !== 0) {
      const right = fx > 0;
      const tipX = right ? cx + 3 : cx - 3;
      const tailX = right ? tipX - L : tipX + L;
      fbdLoads.push(
        <Arrow
          key={`pl-${k}-x`}
          x1={tailX}
          y1={cy}
          x2={tipX}
          y2={cy}
          color={PALETTE.load}
          head={6}
        />,
      );
      fbdLoadLabels.push(
        <LoadLabel
          key={`pl-${k}-xt`}
          x={tailX}
          y={cy - 8}
          text={`H=${fmt(Math.abs(fx))} k`}
          anchor={right ? "end" : "start"}
        />,
      );
    }
    if (moment !== 0) {
      fbdLoads.push(
        <MomentArrow
          key={`pl-${k}-m`}
          cx={cx}
          cy={cy - 16}
          r={14}
          positive={moment > 0}
          color={PALETTE.load}
        />,
      );
      fbdLoadLabels.push(
        <LoadLabel
          key={`pl-${k}-mt`}
          x={cx + 22}
          y={cy - 28}
          text={`M=${fmt(Math.abs(moment))} k-ft`}
          anchor="start"
        />,
      );
    }
  });

  const supports: React.ReactElement[] = [];
  fixity.forEach(([n, rx, ry, rm], k) => {
    if (!nodes[n]) return;
    const cx = frame.X(nodes[n][0]);
    const cy = frame.Y(nodes[n][1]);
    if (rx && ry && rm) {
      supports.push(
        <g key={`fx-${k}`} stroke={PALETTE.support} fill={PALETTE.support}>
          <rect x={cx - 12} y={cy} width={24} height={10} fillOpacity={0.35} />
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1={cx - 12 + i * 6}
              y1={cy + 10}
              x2={cx - 12 + i * 6 - 4}
              y2={cy + 16}
              strokeWidth={1.2}
            />
          ))}
        </g>,
      );
    } else if (rx && ry) {
      supports.push(
        <g key={`fx-${k}`}>
          <polygon
            points={`${cx},${cy} ${cx - 10},${cy + 16} ${cx + 10},${cy + 16}`}
            fill={PALETTE.support}
            stroke={PALETTE.support}
          />
          <line
            x1={cx - 14}
            y1={cy + 16}
            x2={cx + 14}
            y2={cy + 16}
            stroke={PALETTE.support}
            strokeWidth={1.2}
          />
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1={cx - 14 + i * 7}
              y1={cy + 16}
              x2={cx - 14 + i * 7 - 4}
              y2={cy + 22}
              stroke={PALETTE.support}
              strokeWidth={1.2}
            />
          ))}
        </g>,
      );
    } else if (ry) {
      supports.push(
        <g key={`fx-${k}`}>
          <circle
            cx={cx}
            cy={cy + 8}
            r={6}
            fill={PALETTE.support}
            stroke={PALETTE.support}
          />
          <line
            x1={cx - 14}
            y1={cy + 16}
            x2={cx + 14}
            y2={cy + 16}
            stroke={PALETTE.support}
            strokeWidth={1.2}
          />
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1={cx - 14 + i * 7}
              y1={cy + 16}
              x2={cx - 14 + i * 7 - 4}
              y2={cy + 22}
              stroke={PALETTE.support}
              strokeWidth={1.2}
            />
          ))}
        </g>,
      );
    }
  });

  const pointSpringEls: React.ReactElement[] = [];
  pointSprings.forEach(([n, kx, ky, km], k) => {
    if (!nodes[n]) return;
    if (kx === 0 && ky === 0 && km === 0) return;
    const cx = frame.X(nodes[n][0]);
    const cy = frame.Y(nodes[n][1]);
    if (kx !== 0) {
      const dir = cx < W / 2 ? 1 : -1;
      pointSpringEls.push(
        <LinearSpring
          key={`ps-${k}-kx`}
          x1={cx + dir * 4}
          y1={cy}
          x2={cx + dir * 34}
          y2={cy}
          color={PALETTE.support}
        />,
      );
    }
    if (ky !== 0) {
      pointSpringEls.push(
        <LinearSpring
          key={`ps-${k}-ky`}
          x1={cx}
          y1={cy + 4}
          x2={cx}
          y2={cy + 34}
          color={PALETTE.support}
        />,
      );
    }
    if (km !== 0) {
      pointSpringEls.push(
        <RotationalSpring
          key={`ps-${k}-km`}
          cx={cx}
          cy={cy}
          color={PALETTE.support}
        />,
      );
    }
  });

  const uniformSpringEls: React.ReactElement[] = [];
  uniformSprings.forEach(([mIdx, k], springIdx) => {
    if (k === 0) return;
    const member = members[mIdx];
    if (!member) return;
    const a = nodes[member[0]];
    const b = nodes[member[1]];
    if (!a || !b) return;
    uniformSpringEls.push(
      <UniformSpringFoundation
        key={`us-${springIdx}`}
        x1={frame.X(a[0])}
        y1={frame.Y(a[1])}
        x2={frame.X(b[0])}
        y2={frame.Y(b[1])}
        midX={W / 2}
        k={k}
        color={PALETTE.support}
      />,
    );
  });

  const reactionEls: React.ReactElement[] = [];
  const Rmax = Math.max(
    1,
    ...pointReactions.map((r) => Math.max(Math.abs(r.Rx), Math.abs(r.Ry))),
  );
  pointReactions.forEach((r, k) => {
    if (!nodes[r.node]) return;
    const cx = frame.X(nodes[r.node][0]);
    const cy = frame.Y(nodes[r.node][1]) + 30;
    const L = (Math.abs(r.Ry) / Rmax) * 36 + 4;
    if (Math.abs(r.Ry) > 1e-3) {
      reactionEls.push(
        <Arrow
          key={`rx-${k}`}
          x1={cx}
          y1={cy + L}
          x2={cx}
          y2={cy + 3}
          color={PALETTE.reaction}
          head={6}
        />,
      );
      reactionEls.push(
        <text
          key={`rx-t-${k}`}
          x={cx}
          y={cy + L + 12}
          fill={PALETTE.reaction}
          fontSize={10}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
        >
          {fmt(r.Ry)}
        </text>,
      );
    }
  });

  const nodeLabelEls = nodes.map(([x, y], idx) => (
    <NodeLabel
      key={`node-label-${idx}`}
      x={frame.X(x)}
      y={frame.Y(y)}
      label={`N${idx + 1}`}
    />
  ));

  // ─── V and M paths ─────────────────────────────────────────────────
  const vPath = samples
    .map((s, i) => {
      const x = X(s.station);
      const y = yVAxis - (s.v / vmax) * (H_V / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const vFill = samples.length
    ? `M ${X(samples[0].station).toFixed(1)} ${yVAxis} ${samples
        .map((s) => `L ${X(s.station).toFixed(1)} ${(yVAxis - (s.v / vmax) * (H_V / 2 - 12)).toFixed(1)}`)
        .join(" ")} L ${X(samples[samples.length - 1].station).toFixed(1)} ${yVAxis} Z`
    : "";

  const mPath = samples
    .map((s, i) => {
      const x = X(s.station);
      const y = yMAxis - (s.m / mmax) * (H_M / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const mFill = samples.length
    ? `M ${X(samples[0].station).toFixed(1)} ${yMAxis} ${samples
        .map((s) => `L ${X(s.station).toFixed(1)} ${(yMAxis - (s.m / mmax) * (H_M / 2 - 12)).toFixed(1)}`)
        .join(" ")} L ${X(samples[samples.length - 1].station).toFixed(1)} ${yMAxis} Z`
    : "";

  const vMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.v) > Math.abs(a.v) ? b : a),
    samples[0] ?? { station: 0, x: 0, y: 0, v: 0, m: 0, t: 0, d: 0 },
  );
  const mMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.m) > Math.abs(a.m) ? b : a),
    samples[0] ?? { station: 0, x: 0, y: 0, v: 0, m: 0, t: 0, d: 0 },
  );

  const tPath = samples
    .map((s, i) => {
      const x = X(s.station);
      const y = yTAxis - (s.t / tmax) * (H_T / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const tFill = samples.length
    ? `M ${X(samples[0].station).toFixed(1)} ${yTAxis} ${samples
        .map(
          (s) =>
            `L ${X(s.station).toFixed(1)} ${(yTAxis - (s.t / tmax) * (H_T / 2 - 12)).toFixed(1)}`,
        )
        .join(" ")} L ${X(samples[samples.length - 1].station).toFixed(1)} ${yTAxis} Z`
    : "";

  const dPath = samples
    .map((s, i) => {
      const x = X(s.station);
      const y = yDAxis - (s.d / dmax) * (H_D / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const dFill = samples.length
    ? `M ${X(samples[0].station).toFixed(1)} ${yDAxis} ${samples
        .map(
          (s) =>
            `L ${X(s.station).toFixed(1)} ${(yDAxis - (s.d / dmax) * (H_D / 2 - 12)).toFixed(1)}`,
        )
        .join(" ")} L ${X(samples[samples.length - 1].station).toFixed(1)} ${yDAxis} Z`
    : "";

  const tMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.t) > Math.abs(a.t) ? b : a),
    samples[0] ?? { station: 0, x: 0, y: 0, v: 0, m: 0, t: 0, d: 0 },
  );
  const dMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a),
    samples[0] ?? { station: 0, x: 0, y: 0, v: 0, m: 0, t: 0, d: 0 },
  );
  const equilibrium =
    state.kind === "ok"
      ? computeEquilibrium(
          nodes,
          members,
          combinedLoads.pointLoads,
          combinedLoads.distLoads,
          reactions,
        )
      : null;
  const peaks = state.kind === "ok" ? state.data.peaks : null;
  const hasUniformSpringReactions = uniformSprings.some(([, k]) => k !== 0);

  return (
    <div
      className="font-mono text-[10px]"
      style={{ background: PALETTE.bg, color: PALETTE.fg }}
    >
      <ApiStatusPill state={state} />
      {(equilibrium || peaks || pointReactions.length > 0) && (
        <CorrectnessPanel
          equilibrium={equilibrium}
          peaks={peaks}
          reactions={pointReactions}
          hasUniformSpringReactions={hasUniformSpringReactions}
        />
      )}
      <svg
        viewBox={`0 0 ${W} ${H_TOP}`}
        width="100%"
        style={{ display: "block" }}
      >
        <g>
          {uniformSpringEls}
          {members.map(([i, j], idx) => {
            if (!nodes[i] || !nodes[j]) return null;
            return (
              <line
                key={idx}
                x1={frame.X(nodes[i][0])}
                y1={frame.Y(nodes[i][1])}
                x2={frame.X(nodes[j][0])}
                y2={frame.Y(nodes[j][1])}
                stroke={PALETTE.beam}
                strokeWidth={1.4}
                strokeLinecap="round"
              />
            );
          })}
          {supports}
          {pointSpringEls}
          {fbdLoads}
          {reactionEls}
          {nodeLabelEls}
          {fbdLoadLabels}
          <SectionLabel
            x={W - PAD}
            y={16}
            text="FBD"
          />
        </g>

        <g>
          <line
            x1={PAD}
            y1={yVAxis}
            x2={W - PAD}
            y2={yVAxis}
            stroke={PALETTE.dim}
            strokeWidth={0.8}
          />
          {samples.length > 0 && (
            <>
              <path d={vFill} fill={PALETTE.shear} fillOpacity={0.15} />
              <path d={vPath} fill="none" stroke={PALETTE.shear} strokeWidth={1.4} />
            </>
          )}
          <SectionLabel
            x={W - PAD}
            y={yV0 + 12}
            text="V(s)"
            color={PALETTE.shear}
          />
          {samples.length > 0 && (
            <text
              x={X(vMaxSample.station)}
              y={yVAxis - (vMaxSample.v / vmax) * (H_V / 2 - 12) - 4}
              fontSize={9}
              fill={PALETTE.shear}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {fmt(vMaxSample.v)}
            </text>
          )}
        </g>

        <g>
          <line
            x1={PAD}
            y1={yMAxis}
            x2={W - PAD}
            y2={yMAxis}
            stroke={PALETTE.dim}
            strokeWidth={0.8}
          />
          {samples.length > 0 && (
            <>
              <path d={mFill} fill={PALETTE.moment} fillOpacity={0.15} />
              <path d={mPath} fill="none" stroke={PALETTE.moment} strokeWidth={1.4} />
            </>
          )}
          <SectionLabel
            x={W - PAD}
            y={yM0 + 12}
            text="M(s)"
            color={PALETTE.moment}
          />
          {samples.length > 0 && (
            <text
              x={X(mMaxSample.station)}
              y={yMAxis - (mMaxSample.m / mmax) * (H_M / 2 - 12) - 4}
              fontSize={9}
              fill={PALETTE.moment}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {fmt(mMaxSample.m)}
            </text>
          )}
        </g>

        {state.kind === "error" && (
          <text
            x={W / 2}
            y={H_TOP / 2}
            fill="#ff7676"
            fontSize={12}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
          >
            {state.message}
          </text>
        )}
      </svg>

      <div
        className="flex items-center gap-4 border-y px-6 font-mono text-[11px]"
        style={{
          borderColor: PALETTE.dim,
          height: H_BREAK,
          color: PALETTE.fg,
          background: "#0b0b0b",
        }}
      >
        <button
          type="button"
          onClick={runCombination}
          className="h-6 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{
            background: "#000",
            borderColor: PALETTE.dim,
            color: PALETTE.fg,
          }}
          title={`Current load combination: ${activeCombinationId}`}
        >
          RUN
        </button>
        <span style={{ color: PALETTE.dim }}>
          COMBO{" "}
          <span style={{ color: PALETTE.reaction }}>{activeCombinationId}</span>
        </span>
        <span style={{ color: PALETTE.dim }}>MATERIAL</span>
        <label className="flex items-center gap-2">
          <span>E</span>
          <input
            type="number"
            value={E}
            onChange={(e) => onChangeE(Number(e.target.value) || 0)}
            className="h-6 w-24 border px-2 font-mono text-[11px]"
            style={{
              background: "#000",
              borderColor: PALETTE.dim,
              color: PALETTE.fg,
            }}
          />
          <span style={{ color: PALETTE.dim }}>ksi</span>
        </label>
        <label className="flex items-center gap-2">
          <span>I</span>
          <input
            type="number"
            value={I}
            onChange={(e) => onChangeI(Number(e.target.value) || 0)}
            className="h-6 w-24 border px-2 font-mono text-[11px]"
            style={{
              background: "#000",
              borderColor: PALETTE.dim,
              color: PALETTE.fg,
            }}
          />
          <span style={{ color: PALETTE.dim }}>in⁴</span>
        </label>
        <span style={{ color: PALETTE.dim }} className="ml-auto">
          EI = {fmt(E * I)} k·in²
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H_BOT + 14}`}
        width="100%"
        style={{ display: "block" }}
      >
        <g>
          <line
            x1={PAD}
            y1={yTAxis}
            x2={W - PAD}
            y2={yTAxis}
            stroke={PALETTE.dim}
            strokeWidth={0.8}
          />
          {samples.length > 0 && (
            <>
              <path d={tFill} fill={PALETTE.theta} fillOpacity={0.15} />
              <path d={tPath} fill="none" stroke={PALETTE.theta} strokeWidth={1.4} />
            </>
          )}
          <SectionLabel x={W - PAD} y={yT0 + 12} text="θ(s)" color={PALETTE.theta} />
          {samples.length > 0 && (
            <text
              x={X(tMaxSample.station)}
              y={yTAxis - (tMaxSample.t / tmax) * (H_T / 2 - 12) - 4}
              fontSize={9}
              fill={PALETTE.theta}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {fmt(tMaxSample.t)}
            </text>
          )}
        </g>

        <g>
          <line
            x1={PAD}
            y1={yDAxis}
            x2={W - PAD}
            y2={yDAxis}
            stroke={PALETTE.dim}
            strokeWidth={0.8}
          />
          {samples.length > 0 && (
            <>
              <path d={dFill} fill={PALETTE.delta} fillOpacity={0.15} />
              <path d={dPath} fill="none" stroke={PALETTE.delta} strokeWidth={1.4} />
            </>
          )}
          <SectionLabel x={W - PAD} y={yD0 + 12} text="Δ(s)" color={PALETTE.delta} />
          {samples.length > 0 && (
            <text
              x={X(dMaxSample.station)}
              y={yDAxis - (dMaxSample.d / dmax) * (H_D / 2 - 12) - 4}
              fontSize={9}
              fill={PALETTE.delta}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {fmt(dMaxSample.d)}
            </text>
          )}
        </g>

        {[0, totalStation / 2, totalStation].map((station, i) => (
          <text
            key={`station-${i}`}
            x={X(station)}
            y={H_BOT + 12}
            fontSize={9}
            fill={PALETTE.dim}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
          >
            {fmt(station)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function CorrectnessPanel({
  equilibrium,
  peaks,
  reactions,
  hasUniformSpringReactions,
}: {
  equilibrium: Equilibrium | null;
  peaks: SolveResponse["peaks"] | null;
  reactions: ReactionOut[];
  hasUniformSpringReactions: boolean;
}) {
  return (
    <div
      className="grid grid-cols-[1.15fr_1.2fr_1fr] gap-px border-b text-[10px]"
      style={{ borderColor: PALETTE.dim, background: PALETTE.dim }}
    >
      <PanelGroup title="EQUILIBRIUM">
        <Metric
          label="ΣFx"
          value={equilibrium?.sumFx ?? 0}
          color={residualColor(equilibrium?.sumFx ?? 0)}
        />
        <Metric
          label="ΣFy"
          value={equilibrium?.sumFy ?? 0}
          color={residualColor(equilibrium?.sumFy ?? 0)}
        />
        <Metric
          label="ΣM0"
          value={equilibrium?.sumM ?? 0}
          color={residualColor(equilibrium?.sumM ?? 0)}
        />
      </PanelGroup>

      <PanelGroup title="PEAKS">
        <Metric label="V" value={peaks?.V.value ?? 0} color={PALETTE.shear} />
        <Metric label="M" value={peaks?.M.value ?? 0} color={PALETTE.moment} />
        <Metric label="θ" value={peaks?.theta.value ?? 0} color={PALETTE.theta} />
        <Metric label="Δ" value={peaks?.delta.value ?? 0} color={PALETTE.delta} />
      </PanelGroup>

      <PanelGroup title="REACTIONS">
        {reactions.length === 0 ? (
          <span style={{ color: PALETTE.dim }}>
            {hasUniformSpringReactions ? "see spring foundation" : "none"}
          </span>
        ) : (
          reactions.map((r) => (
            <span key={r.node} className="whitespace-nowrap">
              <span style={{ color: PALETTE.dim }}>N{r.node + 1}</span>{" "}
              <span style={{ color: PALETTE.reaction }}>
                Rx {fmt(r.Rx)} Ry {fmt(r.Ry)} M {fmt(r.M)}
              </span>
            </span>
          ))
        )}
      </PanelGroup>
    </div>
  );
}

function PanelGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 bg-surface px-4 py-2">
      <div
        className="mb-1 uppercase tracking-[0.12em]"
        style={{ color: PALETTE.dim }}
      >
        {title}
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span className="whitespace-nowrap">
      <span style={{ color: PALETTE.dim }}>{label}</span>{" "}
      <span style={{ color }}>{fmt(value)}</span>
    </span>
  );
}

type Equilibrium = {
  sumFx: number;
  sumFy: number;
  sumM: number;
};

function computeEquilibrium(
  nodes: Vec2[],
  members: Member[],
  pointLoads: [number, number, number, number][],
  distLoads: [number, number, number][],
  reactions: ReactionOut[],
): Equilibrium {
  let sumFx = 0;
  let sumFy = 0;
  let sumM = 0;

  for (const [node, fx, fy, moment = 0] of pointLoads) {
    const p = nodes[node];
    if (!p) continue;
    sumFx += fx;
    sumFy += fy;
    sumM += p[0] * fy - p[1] * fx + moment;
  }

  for (const [member, wi, wj] of distLoads) {
    const ij = members[member];
    if (!ij) continue;
    const a = nodes[ij[0]];
    const b = nodes[ij[1]];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    const fy = ((wi + wj) / 2) * L;
    const denom = wi + wj;
    const centroid =
      Math.abs(denom) < 1e-12 ? 0.5 : (wi + 2 * wj) / (3 * denom);
    const x = a[0] + dx * centroid;
    sumFy += fy;
    sumM += x * fy;
  }

  for (const r of reactions) {
    const p = nodes[r.node];
    if (!p) continue;
    sumFx += r.Rx;
    sumFy += r.Ry;
    sumM += p[0] * r.Ry - p[1] * r.Rx + r.M;
  }

  return {
    sumFx: cleanResidual(sumFx),
    sumFy: cleanResidual(sumFy),
    sumM: cleanResidual(sumM),
  };
}

function cleanResidual(n: number): number {
  return Math.abs(n) < 1e-8 ? 0 : n;
}

function residualColor(n: number): string {
  return Math.abs(n) < 1e-6 ? PALETTE.reaction : "#ff7676";
}

function formatApiError(error: ApiError): string {
  if (error.error === "disconnected_substructure") {
    const floatingNodes = nodesFromErrorDetails(error.details, "floatingNodes");
    if (floatingNodes.length > 0) {
      return `Nodes [${floatingNodes.map(formatNodeLabel).join(", ")}] are not connected to any support.`;
    }
  }
  return error.message || error.error;
}

function nodesFromErrorDetails(details: unknown, key: string): number[] {
  if (!details || typeof details !== "object") return [];
  const value = (details as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (node): node is number => Number.isInteger(node) && node >= 0,
  );
}

function formatNodeLabel(node: number): string {
  return `N${node + 1}`;
}

function projectFrame(
  nodes: Vec2[],
  width: number,
  height: number,
  pad: number,
): { X: (x: number) => number; Y: (y: number) => number } {
  const xs = nodes.map((n) => n[0]);
  const ys = nodes.map((n) => n[1]);
  const xmin = xs.length ? Math.min(...xs) : 0;
  const xmax = xs.length ? Math.max(...xs) : 1;
  const ymin = ys.length ? Math.min(...ys) : 0;
  const ymax = ys.length ? Math.max(...ys) : 1;
  const xspan = Math.max(xmax - xmin, 1);
  const yspan = Math.max(ymax - ymin, 1);
  const scale = Math.min((width - 2 * pad) / xspan, (height - 2 * pad) / yspan);
  const contentW = xspan * scale;
  const contentH = yspan * scale;
  const ox = (width - contentW) / 2;
  const oy = (height - contentH) / 2;
  return {
    X: (x: number) => ox + (x - xmin) * scale,
    Y: (y: number) => height - (oy + (y - ymin) * scale),
  };
}

function ApiStatusPill({ state }: { state: ApiState }) {
  let label: string;
  let color: string;
  switch (state.kind) {
    case "idle":
      label = "POST /api/v1/solve · idle";
      color = PALETTE.dim;
      break;
    case "loading":
      label = "POST /api/v1/solve · solving…";
      color = PALETTE.theta;
      break;
    case "ok":
      label = `POST /api/v1/solve · 200 · ${state.data.members.length} member${
        state.data.members.length === 1 ? "" : "s"
      }`;
      color = PALETTE.reaction;
      break;
    case "error":
      label = `POST /api/v1/solve · ${state.message}`;
      color = "#ff7676";
      break;
  }
  return (
    <div
      className="flex items-center gap-2 border-b px-6 font-mono text-[10px]"
      style={{
        borderColor: PALETTE.dim,
        height: 24,
        background: "#0b0b0b",
        color,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </div>
  );
}

function SectionLabel({
  x,
  y,
  text,
  color = "#fff",
}: {
  x: number;
  y: number;
  text: string;
  color?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={10}
      fill={color}
      textAnchor="end"
      letterSpacing={2}
      fontFamily="var(--font-mono)"
    >
      {text}
    </text>
  );
}

function NodeLabel({
  x,
  y,
  label,
}: {
  x: number;
  y: number;
  label: string;
}) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={2.6} fill={PALETTE.support} />
      <text
        x={x + 7}
        y={y - 8}
        fontSize={10}
        fill={PALETTE.support}
        stroke={PALETTE.bg}
        strokeWidth={3}
        paintOrder="stroke"
        fontFamily="var(--font-mono)"
      >
        {label}
      </text>
    </g>
  );
}

function LoadLabel({
  x,
  y,
  text,
  anchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
}) {
  const width = text.length * 6.2 + 10;
  const height = 16;
  const rectX =
    anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const textX =
    anchor === "middle" ? x : anchor === "end" ? x - 5 : x + 5;
  return (
    <g pointerEvents="none">
      <rect
        x={rectX}
        y={y - 12}
        width={width}
        height={height}
        fill="#fff"
        stroke={PALETTE.load}
        strokeOpacity={0.28}
      />
      <text
        x={textX}
        y={y}
        fontSize={10}
        fill={PALETTE.load}
        textAnchor={anchor}
        fontFamily="var(--font-mono)"
      >
        {text}
      </text>
    </g>
  );
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  color,
  head = 5,
  width = 1.2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  head?: number;
  width?: number;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const h1x = bx + nx * head * 0.5;
  const h1y = by + ny * head * 0.5;
  const h2x = bx - nx * head * 0.5;
  const h2y = by - ny * head * 0.5;
  return (
    <g stroke={color} fill={color} strokeWidth={width} strokeLinecap="round">
      <line x1={x1} y1={y1} x2={bx} y2={by} />
      <polygon points={`${x2},${y2} ${h1x},${h1y} ${h2x},${h2y}`} />
    </g>
  );
}

function MomentArrow({
  cx,
  cy,
  r,
  positive,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  positive: boolean;
  color: string;
}) {
  const startAngle = positive ? 130 : 50;
  const endAngle = positive ? -145 : 325;
  const start = polarPoint(cx, cy, r, startAngle);
  const end = polarPoint(cx, cy, r, endAngle);
  const sweep = positive ? 0 : 1;
  const tangent = ((endAngle + (positive ? -90 : 90)) * Math.PI) / 180;
  const head = 5;
  const hx1 = end.x - Math.cos(tangent) * head + Math.cos(tangent + Math.PI / 2) * head * 0.55;
  const hy1 = end.y - Math.sin(tangent) * head + Math.sin(tangent + Math.PI / 2) * head * 0.55;
  const hx2 = end.x - Math.cos(tangent) * head + Math.cos(tangent - Math.PI / 2) * head * 0.55;
  const hy2 = end.y - Math.sin(tangent) * head + Math.sin(tangent - Math.PI / 2) * head * 0.55;

  return (
    <g stroke={color} fill={color} strokeWidth={1.3} strokeLinecap="round">
      <path
        d={`M ${start.x} ${start.y} A ${r} ${r} 0 1 ${sweep} ${end.x} ${end.y}`}
        fill="none"
      />
      <polygon points={`${end.x},${end.y} ${hx1},${hy1} ${hx2},${hy2}`} />
    </g>
  );
}

function LinearSpring({
  x1,
  y1,
  x2,
  y2,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}) {
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const dx = Math.sign(x2 - x1) || 1;
  const dy = Math.sign(y2 - y1) || 1;

  return (
    <g
      stroke={color}
      fill="none"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={springPath(x1, y1, x2, y2)} />
      {horizontal ? (
        <>
          <line x1={x2} y1={y2} x2={x2 + dx * 6} y2={y2} />
          <line x1={x2 + dx * 6} y1={y2 - 11} x2={x2 + dx * 6} y2={y2 + 11} />
          {Array.from({ length: 4 }, (_, i) => (
            <line
              key={i}
              x1={x2 + dx * 6}
              y1={y2 - 9 + i * 6}
              x2={x2 + dx * 11}
              y2={y2 - 13 + i * 6}
            />
          ))}
        </>
      ) : (
        <>
          <line x1={x2} y1={y2} x2={x2} y2={y2 + dy * 6} />
          <line x1={x2 - 13} y1={y2 + dy * 6} x2={x2 + 13} y2={y2 + dy * 6} />
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1={x2 - 13 + i * 6.5}
              y1={y2 + dy * 6}
              x2={x2 - 17 + i * 6.5}
              y2={y2 + dy * 12}
            />
          ))}
        </>
      )}
    </g>
  );
}

function RotationalSpring({
  cx,
  cy,
  color,
}: {
  cx: number;
  cy: number;
  color: string;
}) {
  const springCy = cy - 22;
  return (
    <g
      stroke={color}
      fill="none"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1={cx} y1={cy - 4} x2={cx} y2={springCy + 12} />
      <path d={spiralPath(cx, springCy, 3, 13, 1.85)} />
      <line x1={cx + 14} y1={springCy} x2={cx + 22} y2={springCy} />
      <line x1={cx + 22} y1={springCy - 10} x2={cx + 22} y2={springCy + 10} />
      {Array.from({ length: 4 }, (_, i) => (
        <line
          key={i}
          x1={cx + 22}
          y1={springCy - 8 + i * 5.5}
          x2={cx + 27}
          y2={springCy - 12 + i * 5.5}
        />
      ))}
    </g>
  );
}

function UniformSpringFoundation({
  x1,
  y1,
  x2,
  y2,
  midX,
  k,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  k: number;
  color: string;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  let nx = -uy;
  let ny = ux;
  if (ny < -0.15) {
    nx *= -1;
    ny *= -1;
  } else if (Math.abs(ny) <= 0.15) {
    const dir = (x1 + x2) / 2 < midX ? 1 : -1;
    nx = dir;
    ny = 0;
  }

  const springCount = Math.max(3, Math.min(10, Math.round(len / 70)));
  const baseOffset = 34;
  const baseX1 = x1 + ux * 8 + nx * baseOffset;
  const baseY1 = y1 + uy * 8 + ny * baseOffset;
  const baseX2 = x2 - ux * 8 + nx * baseOffset;
  const baseY2 = y2 - uy * 8 + ny * baseOffset;
  const hatchCount = Math.max(4, Math.min(18, Math.round(len / 34)));
  const labelX = (x1 + x2) / 2 + nx * (baseOffset + 18);
  const labelY = (y1 + y2) / 2 + ny * (baseOffset + 18);

  return (
    <g
      stroke={color}
      fill="none"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {Array.from({ length: springCount }, (_, i) => {
        const t = (i + 1) / (springCount + 1);
        const sx = x1 + dx * t;
        const sy = y1 + dy * t;
        return (
          <path
            key={`spring-${i}`}
            d={springPath(
              sx + nx * 4,
              sy + ny * 4,
              sx + nx * (baseOffset - 2),
              sy + ny * (baseOffset - 2),
            )}
          />
        );
      })}
      <line x1={baseX1} y1={baseY1} x2={baseX2} y2={baseY2} />
      {Array.from({ length: hatchCount }, (_, i) => {
        const t = hatchCount === 1 ? 0.5 : i / (hatchCount - 1);
        const hx = baseX1 + (baseX2 - baseX1) * t;
        const hy = baseY1 + (baseY2 - baseY1) * t;
        return (
          <line
            key={`hatch-${i}`}
            x1={hx}
            y1={hy}
            x2={hx - ux * 5 + nx * 6}
            y2={hy - uy * 5 + ny * 6}
          />
        );
      })}
      <text
        x={labelX}
        y={labelY}
        fill={color}
        stroke="none"
        fontSize={9}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
      >
        k={fmt(k)}
      </text>
    </g>
  );
}

function springPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return "";
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const lead = Math.min(6, len / 4);
  const sx = x1 + ux * lead;
  const sy = y1 + uy * lead;
  const ex = x2 - ux * lead;
  const ey = y2 - uy * lead;
  const segments = 10;
  const amp = 4.5;
  const parts = [`M ${fmtSvg(x1)} ${fmtSvg(y1)}`, `L ${fmtSvg(sx)} ${fmtSvg(sy)}`];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const offset = (i % 2 === 0 ? -1 : 1) * amp;
    const px = sx + (ex - sx) * t + nx * offset;
    const py = sy + (ey - sy) * t + ny * offset;
    parts.push(`L ${fmtSvg(px)} ${fmtSvg(py)}`);
  }
  parts.push(`L ${fmtSvg(ex)} ${fmtSvg(ey)}`, `L ${fmtSvg(x2)} ${fmtSvg(y2)}`);
  return parts.join(" ");
}

function spiralPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  turns: number,
): string {
  const parts: string[] = [];
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const a = -Math.PI / 3 + t * turns * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    parts.push(`${i === 0 ? "M" : "L"} ${fmtSvg(x)} ${fmtSvg(y)}`);
  }
  return parts.join(" ");
}

function fmtSvg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: cx + Math.cos(angle) * r,
    y: cy - Math.sin(angle) * r,
  };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a < 0.1) return n.toFixed(3);
  if (a < 10) return n.toFixed(2);
  return n.toFixed(1);
}
