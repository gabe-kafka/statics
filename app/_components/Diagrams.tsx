"use client";

import { useEffect, useRef, useState } from "react";
import type {
  DistLoad,
  Fixity,
  Member,
  PointLoad,
  Vec2,
} from "@/lib/solver";
import type {
  ReactionOut,
  SampleOut,
  SolveRequest,
  SolveResponse,
  ApiError,
} from "@/lib/api/types";

// Colors chosen to echo the conjugate-method notebook palette.
const PALETTE = {
  bg: "#000",
  fg: "#fff",
  dim: "#6a6a6a",
  beam: "#e63946",
  load: "#ffd100",
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
  pointLoads: PointLoad[];
  distLoads: DistLoad[];
  fixity: Fixity[];
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
  pointLoads,
  distLoads,
  fixity,
  E,
  I,
  A,
  onChangeE,
  onChangeI,
}: Props) {
  const [state, setState] = useState<ApiState>({ kind: "idle" });
  const reqIdRef = useRef(0);

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
      pointLoads: pointLoads
        .filter(([, fx, fy]) => fx !== 0 || fy !== 0)
        .map(([node, Fx, Fy]) => ({ node, Fx, Fy })),
      distLoads: distLoads.map(([member, wi, wj]) => ({ member, wi, wj })),
      samplesPerMember: SAMPLES_PER_MEMBER,
      include: ["data"],
    };

    if (req.nodes.length === 0 || req.members.length === 0) {
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
          setState({ kind: "error", message: json.message || json.error });
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
  }, [nodes, members, pointLoads, distLoads, fixity, E, I, A]);

  const W = 880;
  const PAD = 48;
  const H_FBD = 180;
  const H_V = 150;
  const H_M = 150;
  const H_BREAK = 44;
  const H_T = 130;
  const H_D = 130;
  const GAP = 18;

  const xs = nodes.map((n) => n[0]);
  const xmin = xs.length ? Math.min(...xs) : 0;
  const xmax = xs.length ? Math.max(...xs) : 1;
  const xspan = Math.max(xmax - xmin, 1);
  const X = (x: number) => PAD + ((x - xmin) / xspan) * (W - 2 * PAD);

  type Sample = { x: number; v: number; m: number; t: number; d: number };
  const samples: Sample[] = [];
  const reactions: ReactionOut[] =
    state.kind === "ok" ? state.data.reactions : [];
  if (state.kind === "ok") {
    state.data.members.forEach((mr, idx) => {
      const [i, j] = members[idx] ?? [0, 0];
      if (!nodes[i] || !nodes[j]) return;
      const xi = nodes[i][0];
      const xj = nodes[j][0];
      mr.samples.forEach((s: SampleOut) => {
        const t = mr.L > 0 ? s.s / mr.L : 0;
        const x = xi + (xj - xi) * t;
        samples.push({ x, v: s.V, m: s.M, t: s.theta, d: s.delta });
      });
    });
  }

  const vmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.v)));
  const mmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.m)));
  const tmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.t)));
  const dmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.d)));

  // Layout offsets — TOP svg (FBD + V + M)
  const H_TOP = H_FBD + GAP + H_V + GAP + H_M;
  const yFbd0 = 0;
  const yFbdBeam = yFbd0 + H_FBD * 0.55;
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

  // Distributed loads: render each as a top bar + downward arrows onto beam.
  distLoads.forEach(([mIdx, wi, wj], k) => {
    const m = members[mIdx];
    if (!m) return;
    const a = nodes[m[0]];
    const b = nodes[m[1]];
    if (!a || !b) return;
    const xa = X(a[0]);
    const xb = X(b[0]);
    const wMax = Math.max(Math.abs(wi), Math.abs(wj), 1e-6);
    const SCALE = Math.min(55, 30 * (1 + wMax / 6));
    const ha = (Math.abs(wi) / wMax) * SCALE;
    const hb = (Math.abs(wj) / wMax) * SCALE;
    const y_a = yFbdBeam - ha - 2;
    const y_b = yFbdBeam - hb - 2;

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
        y2={yFbdBeam - 2}
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
        y2={yFbdBeam - 2}
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
          y2={yFbdBeam - 3}
          color={PALETTE.load}
          head={4}
        />,
      );
    }
    const midX = (xa + xb) / 2;
    const midY = Math.min(y_a, y_b) - 6;
    const label =
      Math.abs(wi - wj) < 1e-9 ? `${fmt(wi)}` : `${fmt(wi)} → ${fmt(wj)}`;
    fbdLoads.push(
      <text
        key={`dl-t-${k}`}
        x={midX}
        y={midY}
        fill={PALETTE.load}
        fontSize={10}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
      >
        {label}
      </text>,
    );
  });

  pointLoads.forEach(([n, fx, fy], k) => {
    if (!nodes[n]) return;
    if (fx === 0 && fy === 0) return;
    const cx = X(nodes[n][0]);
    const cy = yFbdBeam;
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
      fbdLoads.push(
        <text
          key={`pl-${k}-yt`}
          x={cx + 6}
          y={tailY + 10}
          fill={PALETTE.load}
          fontSize={10}
          fontFamily="var(--font-mono)"
        >
          {fmt(Math.abs(fy))}
        </text>,
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
    }
  });

  const supports: React.ReactElement[] = [];
  fixity.forEach(([n, rx, ry, rm], k) => {
    if (!nodes[n]) return;
    const cx = X(nodes[n][0]);
    const cy = yFbdBeam;
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

  const reactionEls: React.ReactElement[] = [];
  const Rmax = Math.max(
    1,
    ...reactions.map((r) => Math.max(Math.abs(r.Rx), Math.abs(r.Ry))),
  );
  reactions.forEach((r, k) => {
    if (!nodes[r.node]) return;
    const cx = X(nodes[r.node][0]);
    const cy = yFbdBeam + 30;
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

  // ─── V and M paths ─────────────────────────────────────────────────
  const vPath = samples
    .map((s, i) => {
      const x = X(s.x);
      const y = yVAxis - (s.v / vmax) * (H_V / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const vFill = samples.length
    ? `M ${X(samples[0].x).toFixed(1)} ${yVAxis} ${samples
        .map((s) => `L ${X(s.x).toFixed(1)} ${(yVAxis - (s.v / vmax) * (H_V / 2 - 12)).toFixed(1)}`)
        .join(" ")} L ${X(samples[samples.length - 1].x).toFixed(1)} ${yVAxis} Z`
    : "";

  const mPath = samples
    .map((s, i) => {
      const x = X(s.x);
      const y = yMAxis + (s.m / mmax) * (H_M / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const mFill = samples.length
    ? `M ${X(samples[0].x).toFixed(1)} ${yMAxis} ${samples
        .map((s) => `L ${X(s.x).toFixed(1)} ${(yMAxis + (s.m / mmax) * (H_M / 2 - 12)).toFixed(1)}`)
        .join(" ")} L ${X(samples[samples.length - 1].x).toFixed(1)} ${yMAxis} Z`
    : "";

  const vMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.v) > Math.abs(a.v) ? b : a),
    samples[0] ?? { x: 0, v: 0, m: 0, t: 0, d: 0 },
  );
  const mMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.m) > Math.abs(a.m) ? b : a),
    samples[0] ?? { x: 0, v: 0, m: 0, t: 0, d: 0 },
  );

  const tPath = samples
    .map((s, i) => {
      const x = X(s.x);
      const y = yTAxis - (s.t / tmax) * (H_T / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const tFill = samples.length
    ? `M ${X(samples[0].x).toFixed(1)} ${yTAxis} ${samples
        .map(
          (s) =>
            `L ${X(s.x).toFixed(1)} ${(yTAxis - (s.t / tmax) * (H_T / 2 - 12)).toFixed(1)}`,
        )
        .join(" ")} L ${X(samples[samples.length - 1].x).toFixed(1)} ${yTAxis} Z`
    : "";

  const dPath = samples
    .map((s, i) => {
      const x = X(s.x);
      const y = yDAxis - (s.d / dmax) * (H_D / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const dFill = samples.length
    ? `M ${X(samples[0].x).toFixed(1)} ${yDAxis} ${samples
        .map(
          (s) =>
            `L ${X(s.x).toFixed(1)} ${(yDAxis - (s.d / dmax) * (H_D / 2 - 12)).toFixed(1)}`,
        )
        .join(" ")} L ${X(samples[samples.length - 1].x).toFixed(1)} ${yDAxis} Z`
    : "";

  const tMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.t) > Math.abs(a.t) ? b : a),
    samples[0] ?? { x: 0, v: 0, m: 0, t: 0, d: 0 },
  );
  const dMaxSample = samples.reduce(
    (a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a),
    samples[0] ?? { x: 0, v: 0, m: 0, t: 0, d: 0 },
  );

  return (
    <div
      className="font-mono text-[10px]"
      style={{ background: PALETTE.bg, color: PALETTE.fg }}
    >
      <ApiStatusPill state={state} />
      <svg
        viewBox={`0 0 ${W} ${H_TOP}`}
        width="100%"
        style={{ display: "block" }}
      >
        <g>
          {fbdLoads}
          {members.map(([i, j], idx) => {
            if (!nodes[i] || !nodes[j]) return null;
            return (
              <line
                key={idx}
                x1={X(nodes[i][0])}
                y1={yFbdBeam}
                x2={X(nodes[j][0])}
                y2={yFbdBeam}
                stroke={PALETTE.beam}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            );
          })}
          {supports}
          {reactionEls}
          <SectionLabel
            x={W - PAD}
            y={yFbdBeam - H_FBD / 2 + 10}
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
            text="V(x)"
            color={PALETTE.shear}
          />
          {samples.length > 0 && (
            <text
              x={X(vMaxSample.x)}
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
            text="M(x)"
            color={PALETTE.moment}
          />
          {samples.length > 0 && (
            <text
              x={X(mMaxSample.x)}
              y={yMAxis + (mMaxSample.m / mmax) * (H_M / 2 - 12) + 12}
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
          <SectionLabel x={W - PAD} y={yT0 + 12} text="θ(x)" color={PALETTE.theta} />
          {samples.length > 0 && (
            <text
              x={X(tMaxSample.x)}
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
          <SectionLabel x={W - PAD} y={yD0 + 12} text="Δ(x)" color={PALETTE.delta} />
          {samples.length > 0 && (
            <text
              x={X(dMaxSample.x)}
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

        {xs.map((x, i) => (
          <text
            key={`nx-${i}`}
            x={X(x)}
            y={H_BOT + 12}
            fontSize={9}
            fill={PALETTE.dim}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
          >
            {fmt(x)}
          </text>
        ))}
      </svg>
    </div>
  );
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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a < 0.1) return n.toFixed(3);
  if (a < 10) return n.toFixed(2);
  return n.toFixed(1);
}
