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
  combineLoadsForCase,
  classifyCombination,
  combinationOptions,
  defaultCombinationId,
  hasCombination,
  hasLoadCase,
  loadCaseOptions as loadCaseIdOptions,
  resolveCombinationId,
  resolveLoadCaseId,
  type CombinedLoads,
} from "@/lib/load-combinations";
import type {
  MemberOut,
  PeakOut,
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
  result: "var(--accent)",
  shear: "var(--accent)",
  moment: "var(--accent)",
  theta: "#4aa3ff",
  delta: "#ff7aa2",
};

const NODE_MARKER_RADIUS = 2.6;
const HINGE_MARKER_RADIUS = NODE_MARKER_RADIUS * 2;
const HINGE_MARKER_FILL = "#ffffff";

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
  staticsDesignId: string | null;
  staticsDesignName: string;
  onChangeE: (v: number) => void;
  onChangeI: (v: number) => void;
};

type ApiState =
  | { kind: "idle" }
  | { kind: "loading"; label: string; targetCount: number }
  | {
      kind: "ok";
      data: SolveResponse;
      label: string;
      isEnvelope: boolean;
      runs: AnalysisRun[];
    }
  | { kind: "error"; message: string };

const SAMPLES_PER_MEMBER = 41;
const LOAD_ARROW_MAX = 56;
const LOAD_ARROW_MIN = 8;
const CONCRETE_BEAM_URL =
  process.env.NEXT_PUBLIC_CONCRETE_BEAM_URL ??
  "https://concrete-beam.vercel.app";

type DiagramSample = {
  station: number;
  x: number;
  y: number;
  r: number;
  v: number;
  m: number;
  t: number;
  d: number;
};

type DiagramField = "r" | "v" | "m" | "t" | "d";

type LoadViewMode = "case" | "combo" | "envelope";

type LoadTarget = {
  kind: "case" | "combo";
  id: string;
  key: string;
  label: string;
};

type EnvelopeDefinition = {
  id: string;
  label: string;
  targetKeys: string[];
  builtin?: boolean;
};

type AnalysisRun = {
  target: LoadTarget;
  data: SolveResponse;
  combinedLoads: CombinedLoads;
};

type ConcreteDesignHandoff = {
  href: string;
  muPos: number;
  muNeg: number;
  vu: number;
  vMax: PeakValue;
  vMin: PeakValue;
  mMax: PeakValue;
  mMin: PeakValue;
};

type ConcreteDesignSource = {
  staticsDesignId: string | null;
  staticsDesignName: string;
};

type PeakValue = {
  value: number;
  member: number;
  station: number;
};

const EMPTY_LOADS: CombinedLoads = { pointLoads: [], distLoads: [] };
const EMPTY_ENVELOPE: EnvelopeDefinition = {
  id: "env:empty",
  label: "Empty envelope",
  targetKeys: [],
  builtin: true,
};
const CASE_PREFIX = "case:";
const COMBO_PREFIX = "combo:";
const CUSTOM_ENVELOPE_STORAGE_KEY = "statics.customEnvelopes.v1";

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
  staticsDesignId,
  staticsDesignName,
  onChangeE,
  onChangeI,
}: Props) {
  const [state, setState] = useState<ApiState>({ kind: "idle" });
  const [runId, setRunId] = useState(0);
  const [viewMode, setViewMode] = useState<LoadViewMode>("combo");
  const [selectedCaseId, setSelectedCaseId] = useState(() =>
    loadCaseIdOptions(loadCases)[0] ?? "D",
  );
  const [selectedCombinationId, setSelectedCombinationId] = useState(() =>
    defaultCombinationId(loadCombinations),
  );
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState("env:all");
  const [customEnvelopes, setCustomEnvelopes] = useState<EnvelopeDefinition[]>(
    [],
  );
  const [showConcreteDesignDialog, setShowConcreteDesignDialog] = useState(false);
  const reqIdRef = useRef(0);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CUSTOM_ENVELOPE_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as EnvelopeDefinition[];
      if (!Array.isArray(parsed)) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomEnvelopes(parsed.filter(isEnvelopeDefinition));
    } catch {
      // Ignore unreadable local drafts.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        CUSTOM_ENVELOPE_STORAGE_KEY,
        JSON.stringify(customEnvelopes),
      );
    } catch {
      // Ignore storage quota or private-mode failures.
    }
  }, [customEnvelopes]);
  const caseOptions = useMemo(() => loadCaseIdOptions(loadCases), [loadCases]);
  const comboOptions = useMemo(
    () => combinationOptions(loadCombinations),
    [loadCombinations],
  );
  const loadTargets = useMemo(
    () => buildLoadTargets(caseOptions, comboOptions),
    [caseOptions, comboOptions],
  );
  const envelopeOptions = useMemo(
    () =>
      buildEnvelopeOptions({
        caseOptions,
        comboOptions,
        loadCombinations,
        customEnvelopes,
      }),
    [caseOptions, comboOptions, loadCombinations, customEnvelopes],
  );
  const activeCaseId = hasLoadCase(loadCases, selectedCaseId)
    ? selectedCaseId
    : caseOptions[0] ?? "D";
  const activeCombinationId = hasCombination(loadCombinations, selectedCombinationId)
    ? selectedCombinationId
    : defaultCombinationId(loadCombinations);
  const activeEnvelope = useMemo(
    () =>
      envelopeOptions.find((envelope) => envelope.id === selectedEnvelopeId) ??
      envelopeOptions[0] ??
      EMPTY_ENVELOPE,
    [envelopeOptions, selectedEnvelopeId],
  );
  const activeTargets = useMemo(
    () =>
      targetsForView({
        viewMode,
        activeCaseId,
        activeCombinationId,
        activeEnvelope,
        loadTargets,
      }),
    [viewMode, activeCaseId, activeCombinationId, activeEnvelope, loadTargets],
  );
  const activeViewLabel = useMemo(
    () => labelForView(viewMode, activeCaseId, activeCombinationId, activeEnvelope),
    [viewMode, activeCaseId, activeCombinationId, activeEnvelope],
  );
  const displayLoads = useMemo(
    () =>
      activeTargets.length === 1
        ? combineLoadsForTarget({
            target: activeTargets[0],
            pointLoads,
            distLoads,
            loadCases,
            loadCombinations,
          })
        : EMPTY_LOADS,
    [activeTargets, pointLoads, distLoads, loadCases, loadCombinations],
  );

  const rerunAnalysis = () => {
    setRunId((value) => value + 1);
  };

  const createCustomEnvelope = () => {
    const name = window.prompt("Envelope name", "CUSTOM");
    if (name === null) return;
    const label = name.trim();
    if (!label) return;
    const defaultTargets = loadTargets
      .map((target) => `${target.kind}:${target.id}`)
      .join(", ");
    const answer = window.prompt(
      "Targets to envelope, comma-separated. Use D, L, SERVICE, or prefixes like case:D and combo:SERVICE.",
      defaultTargets,
    );
    if (answer === null) return;
    const parsed = parseEnvelopeTargetInput(answer, loadTargets);
    if (parsed.unknown.length > 0) {
      window.alert(`Unknown target(s): ${parsed.unknown.join(", ")}`);
      return;
    }
    if (parsed.targetKeys.length === 0) {
      window.alert("Envelope needs at least one load case or load combo.");
      return;
    }
    const envelope: EnvelopeDefinition = {
      id: `custom:${Date.now()}`,
      label,
      targetKeys: parsed.targetKeys,
    };
    setCustomEnvelopes((items) => [...items, envelope]);
    setSelectedEnvelopeId(envelope.id);
    setViewMode("envelope");
  };

  useEffect(() => {
    if (nodes.length === 0 || members.length === 0) {
      // Keeps stale solver output hidden when the current model is empty.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "idle" });
      return;
    }
    if (activeTargets.length === 0) {
      setState({ kind: "error", message: "No load cases or combinations selected." });
      return;
    }

    const id = ++reqIdRef.current;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setState({
        kind: "loading",
        label: activeViewLabel,
        targetCount: activeTargets.length,
      });
      try {
        const runs = await Promise.all(
          activeTargets.map(async (target) => {
            const targetLoads = combineLoadsForTarget({
              target,
              pointLoads,
              distLoads,
              loadCases,
              loadCombinations,
            });
            const res = await fetch("/api/v1/solve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                buildSolveRequest({
                  nodes,
                  members,
                  fixity,
                  pointSprings,
                  uniformSprings,
                  hinges,
                  E,
                  I,
                  A,
                  combinedLoads: targetLoads,
                }),
              ),
              signal: ctl.signal,
            });
            const json = (await res.json()) as SolveResponse | ApiError;
            if (!json.ok) {
              throw new Error(`${target.label}: ${formatApiError(json)}`);
            }
            return { target, data: json, combinedLoads: targetLoads };
          }),
        );
        if (id !== reqIdRef.current) return;
        setState({
          kind: "ok",
          data: runs.length === 1 ? runs[0].data : envelopeResponse(runs),
          label: activeViewLabel,
          isEnvelope: runs.length > 1,
          runs,
        });
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
    activeTargets,
    activeViewLabel,
    pointLoads,
    distLoads,
    loadCases,
    loadCombinations,
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
  const BASE_H_FBD = 180;
  const H_R = 130;
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

  const samples: DiagramSample[] = [];
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

  const loadVisualMax = Math.max(
    1e-6,
    ...displayLoads.pointLoads.flatMap(([, fx, fy]) => [
      Math.abs(fx),
      Math.abs(fy),
    ]),
    ...displayLoads.distLoads.flatMap(([, wi, wj]) => [
      Math.abs(wi),
      Math.abs(wj),
    ]),
  );
  const fbdInsets = fbdDiagramInsets({
    pad: PAD,
    pointLoads: displayLoads.pointLoads,
    distLoads: displayLoads.distLoads,
    reactions: pointReactions,
    fixity,
    pointSprings,
    uniformSprings,
  });
  const H_FBD = fbdPanelHeight(nodes, W, BASE_H_FBD, fbdInsets);
  const frame = projectFrameWithInsets(nodes, W, H_FBD, fbdInsets);

  if (state.kind === "ok") {
    state.data.members.forEach((mr, idx) => {
      const station0 = idx === 0 ? 0 : stationEnds[idx - 1];
      mr.samples.forEach((s: SampleOut) => {
        samples.push({
          station: station0 + s.s,
          x: s.x,
          y: s.y,
          r: s.R,
          v: s.V,
          m: s.M,
          t: s.theta,
          d: s.delta,
        });
      });
    });
  }

  const rmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.r)));
  const vmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.v)));
  const mmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.m)));
  const tmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.t)));
  const dmax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.d)));

  // Layout offsets — TOP svg (FBD + R + V + M)
  const H_TOP = H_FBD + GAP + H_R + GAP + H_V + GAP + H_M;
  const yR0 = H_FBD + GAP;
  const yRAxis = yR0 + H_R / 2;
  const yV0 = H_FBD + GAP + H_R + GAP;
  const yVAxis = yV0 + H_V / 2;
  const yM0 = H_FBD + GAP + H_R + GAP + H_V + GAP;
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
  displayLoads.distLoads.forEach(([mIdx, wi, wj], k) => {
    const m = members[mIdx];
    if (!m) return;
    const a = nodes[m[0]];
    const b = nodes[m[1]];
    if (!a || !b) return;
    const xa = frame.X(a[0]);
    const xb = frame.X(b[0]);
    const yaBeam = frame.Y(a[1]);
    const ybBeam = frame.Y(b[1]);
    const ha = scaledLoadArrowLength(wi, loadVisualMax);
    const hb = scaledLoadArrowLength(wj, loadVisualMax);
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

  displayLoads.pointLoads.forEach(([n, fx, fy, moment = 0, loadCase], k) => {
    if (!nodes[n]) return;
    if (fx === 0 && fy === 0 && moment === 0) return;
    const loadCasePrefix = formatLoadCasePrefix(loadCase);
    const cx = frame.X(nodes[n][0]);
    const cy = frame.Y(nodes[n][1]);
    if (fy !== 0) {
      const L = scaledLoadArrowLength(fy, loadVisualMax);
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
          text={`${loadCasePrefix}P=${fmt(Math.abs(fy))} k`}
          anchor="start"
        />,
      );
    }
    if (fx !== 0) {
      const L = scaledLoadArrowLength(fx, loadVisualMax);
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
          text={`${loadCasePrefix}H=${fmt(Math.abs(fx))} k`}
          anchor={right ? "end" : "start"}
        />,
      );
    }
    if (moment !== 0) {
      fbdLoads.push(
        <MomentArrow
          key={`pl-${k}-m`}
          cx={cx}
          cy={cy}
          r={14}
          positive={moment > 0}
          color={PALETTE.load}
        />,
      );
      fbdLoadLabels.push(
        <LoadLabel
          key={`pl-${k}-mt`}
          x={cx + 22}
          y={cy - 20}
          text={`${loadCasePrefix}M=${fmt(Math.abs(moment))} k-ft`}
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
    } else if (rx) {
      const dir = cx < W / 2 ? -1 : 1;
      const wallX = cx + dir * 16;
      supports.push(
        <g key={`fx-${k}`} stroke={PALETTE.support} fill="none">
          <line x1={cx} y1={cy} x2={wallX} y2={cy} strokeWidth={1.2} />
          <line x1={wallX} y1={cy - 14} x2={wallX} y2={cy + 14} strokeWidth={1.2} />
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1={wallX}
              y1={cy - 12 + i * 6}
              x2={wallX + dir * 6}
              y2={cy - 16 + i * 6}
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
  uniformSprings.forEach(([mIdx, k, compressionOnly], springIdx) => {
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
        compressionOnly={!!compressionOnly}
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
    const nodeY = frame.Y(nodes[r.node][1]);
    const rxY = nodeY + 24;
    const ryY = nodeY + 34;
    const Lx = (Math.abs(r.Rx) / Rmax) * 36 + 4;
    const Ly = (Math.abs(r.Ry) / Rmax) * 36 + 4;
    if (Math.abs(r.Rx) > 1e-3) {
      const tipX = r.Rx > 0 ? cx + 3 : cx - 3;
      const tailX = r.Rx > 0 ? tipX - Lx : tipX + Lx;
      reactionEls.push(
        <Arrow
          key={`rx-${k}`}
          x1={tailX}
          y1={rxY}
          x2={tipX}
          y2={rxY}
          color={PALETTE.reaction}
          head={6}
        />,
      );
      reactionEls.push(
        <text
          key={`rx-t-${k}`}
          x={(tailX + tipX) / 2}
          y={rxY - 8}
          fill={PALETTE.reaction}
          fontSize={10}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
        >
          Rx {fmt(r.Rx)}
        </text>,
      );
    }
    if (Math.abs(r.Ry) > 1e-3) {
      const nearY = ryY + 3;
      const farY = ryY + Ly;
      reactionEls.push(
        <Arrow
          key={`ry-${k}`}
          x1={cx}
          y1={r.Ry > 0 ? farY : nearY}
          x2={cx}
          y2={r.Ry > 0 ? nearY : farY}
          color={PALETTE.reaction}
          head={6}
        />,
      );
      reactionEls.push(
        <text
          key={`ry-t-${k}`}
          x={cx}
          y={farY + 14}
          fill={PALETTE.reaction}
          fontSize={10}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
        >
          Ry {fmt(r.Ry)}
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
  const hingeEls = hinges.map(([memberIdx, end], idx) => {
    const member = members[memberIdx];
    if (!member) return null;
    const nodeIdx = end === "i" ? member[0] : member[1];
    const node = nodes[nodeIdx];
    if (!node) return null;
    return (
      <circle
        key={`hinge-${idx}`}
        cx={frame.X(node[0])}
        cy={frame.Y(node[1])}
        r={HINGE_MARKER_RADIUS}
        fill={HINGE_MARKER_FILL}
        stroke={PALETTE.support}
        strokeWidth={1.4}
      />
    );
  });
  const topGuideEls = nodes.map(([x, y], idx) => {
    const guideX = frame.X(x);
    const guideY = frame.Y(y);
    return (
      <ProjectionGuide
        key={`top-guide-${idx}`}
        x={guideX}
        y1={guideY}
        y2={H_TOP}
      />
    );
  });
  const bottomGuideEls = nodes.map(([x], idx) => (
    <ProjectionGuide
      key={`bottom-guide-${idx}`}
      x={frame.X(x)}
      y1={0}
      y2={H_BOT + 14}
    />
  ));

  // ─── R, V and M paths ──────────────────────────────────────────────
  const rPath = samples
    .map((s, i) => {
      const x = X(s.station);
      const y = yRAxis - (s.r / rmax) * (H_R / 2 - 12);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const rFill = samples.length
    ? `M ${X(samples[0].station).toFixed(1)} ${yRAxis} ${samples
        .map((s) => `L ${X(s.station).toFixed(1)} ${(yRAxis - (s.r / rmax) * (H_R / 2 - 12)).toFixed(1)}`)
        .join(" ")} L ${X(samples[samples.length - 1].station).toFixed(1)} ${yRAxis} Z`
    : "";

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

  const concreteDesign = useMemo(
    () =>
      state.kind === "ok"
        ? buildConcreteDesignHandoff(state.runs, state.label, {
            staticsDesignId,
            staticsDesignName,
          })
        : null,
    [state, staticsDesignId, staticsDesignName],
  );

  const openConcreteDesign = () => {
    if (!concreteDesign) return;
    setShowConcreteDesignDialog(true);
  };

  const enterConcreteDesign = () => {
    if (!concreteDesign) return;
    setShowConcreteDesignDialog(false);
    window.open(concreteDesign.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="font-mono text-[10px]"
      style={{ background: PALETTE.bg, color: PALETTE.fg }}
    >
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b px-4 py-2 font-mono text-[10px] tabular-nums"
        style={{
          borderColor: "var(--border)",
          color: PALETTE.fg,
          background: "var(--surface)",
        }}
      >
        <span
          className="mr-1 uppercase tracking-[0.12em]"
          style={{ color: "var(--muted)" }}
        >
          VIEW
        </span>
        <div className="flex flex-wrap items-center gap-px">
          <LoadModeButton
            active={viewMode === "case"}
            label="CASE"
            onClick={() => setViewMode("case")}
          />
          <LoadModeButton
            active={viewMode === "combo"}
            label="COMBO"
            onClick={() => setViewMode("combo")}
          />
          <LoadModeButton
            active={viewMode === "envelope"}
            label="ENVELOPE"
            onClick={() => setViewMode("envelope")}
          />
        </div>
        {viewMode === "case" && (
          <select
            value={activeCaseId}
            onChange={(e) =>
              setSelectedCaseId(resolveLoadCaseId(loadCases, e.target.value))
            }
            className="h-7 min-w-24 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{
              background: "var(--bg)",
              borderColor: "var(--border)",
              color: PALETTE.fg,
            }}
          >
            {caseOptions.map((loadCase) => (
              <option key={loadCase} value={loadCase}>
                {loadCase}
              </option>
            ))}
          </select>
        )}
        {viewMode === "combo" && (
          <select
            value={activeCombinationId}
            onChange={(e) =>
              setSelectedCombinationId(
                resolveCombinationId(loadCombinations, e.target.value),
              )
            }
            className="h-7 min-w-36 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{
              background: "var(--bg)",
              borderColor: "var(--border)",
              color: PALETTE.fg,
            }}
          >
            {comboOptions.map((combo) => (
              <option key={combo} value={combo}>
                {combo}
              </option>
            ))}
          </select>
        )}
        {viewMode === "envelope" && (
          <>
            <select
              value={activeEnvelope.id}
              onChange={(e) => setSelectedEnvelopeId(e.target.value)}
              className="h-7 min-w-44 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: PALETTE.fg,
              }}
            >
              {envelopeOptions.map((envelope) => (
                <option key={envelope.id} value={envelope.id}>
                  {envelope.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={createCustomEnvelope}
              className="h-7 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: PALETTE.fg,
              }}
            >
              + CUSTOM
            </button>
          </>
        )}
        <span
          className="flex h-7 items-center gap-2 border px-2 text-[10px] uppercase tracking-[0.08em]"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface)",
            color: "var(--muted)",
          }}
        >
          ACTIVE
          <span className="tracking-[0.08em]" style={{ color: PALETTE.fg }}>
            {activeViewLabel}
          </span>
        </span>
        <button
          type="button"
          onClick={rerunAnalysis}
          className="ml-auto h-7 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{
            background: "var(--bg)",
            borderColor: "var(--border)",
            color: PALETTE.fg,
          }}
          title={`Run ${activeViewLabel}`}
        >
          RUN
        </button>
        <button
          type="button"
          onClick={openConcreteDesign}
          disabled={!concreteDesign}
          className="min-h-7 border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
          style={{
            background: "var(--bg)",
            borderColor: "var(--border)",
            color: concreteDesign ? PALETTE.fg : "var(--muted)",
          }}
          title={
            concreteDesign
              ? `Open simple concrete beam design: Mu+ ${fmt(concreteDesign.muPos)}, Mu- ${fmt(concreteDesign.muNeg)}, Vu ${fmt(concreteDesign.vu)}`
              : "Solve the model before launching concrete design."
          }
        >
          CLICK HERE TO DESIGN CONC BEAM BASED ON THESE VALUES
        </button>
      </div>
      {showConcreteDesignDialog && concreteDesign && (
        <ConcreteDesignDialog
          design={concreteDesign}
          onCancel={() => setShowConcreteDesignDialog(false)}
          onEnter={enterConcreteDesign}
        />
      )}
      <svg
        viewBox={`0 0 ${W} ${H_TOP}`}
        width="100%"
        style={{ display: "block" }}
      >
        <g>{topGuideEls}</g>
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
          {hingeEls}
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
            y1={yRAxis}
            x2={W - PAD}
            y2={yRAxis}
            stroke={PALETTE.dim}
            strokeWidth={0.8}
          />
          {samples.length > 0 && (
            <>
              <path d={rFill} fill={PALETTE.result} fillOpacity={0.15} />
              <path d={rPath} fill="none" stroke={PALETTE.result} strokeWidth={1.4} />
            </>
          )}
          <SectionLabel
            x={W - PAD}
            y={yR0 + 12}
            text="R(l)"
            color={PALETTE.result}
          />
          {samples.length > 0 && (
            <GraphValueLabels
              samples={samples}
              field="r"
              yAxis={yRAxis}
              height={H_R}
              max={rmax}
              X={X}
              unit="klf"
            />
          )}
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
            text="V(l)"
            color={PALETTE.shear}
          />
          {samples.length > 0 && (
            <GraphValueLabels
              samples={samples}
              field="v"
              yAxis={yVAxis}
              height={H_V}
              max={vmax}
              X={X}
              unit="k"
            />
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
            text="M(l)"
            color={PALETTE.moment}
          />
          {samples.length > 0 && (
            <GraphValueLabels
              samples={samples}
              field="m"
              yAxis={yMAxis}
              height={H_M}
              max={mmax}
              X={X}
              unit="k-ft"
            />
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
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y px-6 py-2 font-mono text-[11px] tabular-nums"
        style={{
          borderColor: "var(--border)",
          minHeight: H_BREAK,
          color: PALETTE.fg,
          background: "var(--surface)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="text-[10px] uppercase tracking-[0.12em]"
            style={{ color: "var(--muted)" }}
          >
            DEFLECTION MATERIAL
          </span>
          <label className="flex items-center gap-2">
            <span style={{ color: PALETTE.fg }}>E</span>
            <input
              type="number"
              value={E}
              onChange={(e) => onChangeE(Number(e.target.value) || 0)}
              className="h-8 w-28 border px-3 font-mono text-[11px]"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: PALETTE.fg,
              }}
            />
            <span style={{ color: "var(--muted)" }}>ksi</span>
          </label>
          <label className="flex items-center gap-2">
            <span style={{ color: PALETTE.fg }}>I</span>
            <input
              type="number"
              value={I}
              onChange={(e) => onChangeI(Number(e.target.value) || 0)}
              className="h-8 w-28 border px-3 font-mono text-[11px]"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: PALETTE.fg,
              }}
            />
            <span style={{ color: "var(--muted)" }}>in⁴</span>
          </label>
        </div>
        <span style={{ color: "var(--muted)" }} className="ml-auto text-[11px]">
          EI = {fmt(E * I)} k·in²
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H_BOT + 14}`}
        width="100%"
        style={{ display: "block" }}
      >
        <g>{bottomGuideEls}</g>
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
          <SectionLabel x={W - PAD} y={yT0 + 12} text="θ(l)" color={PALETTE.theta} />
          {samples.length > 0 && (
            <GraphValueLabels
              samples={samples}
              field="t"
              yAxis={yTAxis}
              height={H_T}
              max={tmax}
              X={X}
              unit="rad"
            />
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
          <SectionLabel x={W - PAD} y={yD0 + 12} text="Δ(l)" color={PALETTE.delta} />
          {samples.length > 0 && (
            <GraphValueLabels
              samples={samples}
              field="d"
              yAxis={yDAxis}
              height={H_D}
              max={dmax}
              X={X}
              unit="in"
            />
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

function buildConcreteDesignHandoff(
  runs: AnalysisRun[],
  analysisLabel: string,
  source: ConcreteDesignSource,
): ConcreteDesignHandoff {
  let vMax = emptyPeak();
  let vMin = emptyPeak();
  let mMax = emptyPeak();
  let mMin = emptyPeak();

  runs.forEach((run) => {
    run.data.members.forEach((member, memberIndex) => {
      member.samples.forEach((sample) => {
        if (sample.V > vMax.value) {
          vMax = { value: sample.V, member: memberIndex, station: sample.s };
        }
        if (sample.V < vMin.value) {
          vMin = { value: sample.V, member: memberIndex, station: sample.s };
        }
        if (sample.M > mMax.value) {
          mMax = { value: sample.M, member: memberIndex, station: sample.s };
        }
        if (sample.M < mMin.value) {
          mMin = { value: sample.M, member: memberIndex, station: sample.s };
        }
      });
    });
  });

  const muPos = Math.max(0, mMax.value);
  const muNeg = Math.max(0, -mMin.value);
  const vuPeak =
    Math.abs(vMin.value) > Math.abs(vMax.value) ? vMin : vMax;
  const vu = Math.max(Math.abs(vMax.value), Math.abs(vMin.value));

  const params = new URLSearchParams({
    source: "statics",
    mode: "simple",
    combo: analysisLabel,
    muPos: handoffNumber(muPos),
    muNeg: handoffNumber(muNeg),
    vu: handoffNumber(vu),
    vMax: handoffNumber(vMax.value),
    vMin: handoffNumber(vMin.value),
    mMax: handoffNumber(mMax.value),
    mMin: handoffNumber(mMin.value),
    vMaxMember: String(vMax.member + 1),
    vMinMember: String(vMin.member + 1),
    mMaxMember: String(mMax.member + 1),
    mMinMember: String(mMin.member + 1),
    vMaxStation: handoffNumber(vMax.station),
    vMinStation: handoffNumber(vMin.station),
    mMaxStation: handoffNumber(mMax.station),
    mMinStation: handoffNumber(mMin.station),
    muPosMember: String(mMax.member + 1),
    muNegMember: String(mMin.member + 1),
    vuMember: String(vuPeak.member + 1),
    muPosStation: handoffNumber(mMax.station),
    muNegStation: handoffNumber(mMin.station),
    vuStation: handoffNumber(vuPeak.station),
  });
  if (source.staticsDesignId) {
    params.set("staticsDesignId", source.staticsDesignId);
  }
  const staticsDesignName = source.staticsDesignName.trim();
  if (staticsDesignName) {
    params.set("staticsDesignName", staticsDesignName);
  }
  return {
    href: `${concreteBeamBaseUrl()}?${params.toString()}`,
    muPos,
    muNeg,
    vu,
    vMax,
    vMin,
    mMax,
    mMin,
  };
}

function emptyPeak(): PeakValue {
  return { value: 0, member: 0, station: 0 };
}

function ConcreteDesignDialog({
  design,
  onCancel,
  onEnter,
}: {
  design: ConcreteDesignHandoff;
  onCancel: () => void;
  onEnter: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concrete-design-title"
    >
      <div
        className="w-full max-w-[640px] border p-4 font-mono text-[11px]"
        style={{
          background: "var(--bg)",
          borderColor: "var(--border)",
          color: PALETTE.fg,
        }}
      >
        <div className="mb-4 flex items-baseline justify-between gap-4 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <h2
            id="concrete-design-title"
            className="text-[11px] uppercase tracking-[0.12em]"
            style={{ color: PALETTE.fg }}
          >
            CHECK SELECTED CONCRETE BEAM VALUES
          </h2>
          <span className="text-right uppercase tracking-[0.08em]" style={{ color: "var(--muted)" }}>
            PEAKS FROM CURRENT VIEW
          </span>
        </div>

        <div className="grid gap-px border text-[11px] tabular-nums" style={{ borderColor: "var(--border)", background: "var(--border)" }}>
          <ConcretePeakRow label="Vmax" peak={design.vMax} unit="k" />
          <ConcretePeakRow label="Vmin" peak={design.vMin} unit="k" />
          <ConcretePeakRow label="Mmax" peak={design.mMax} unit="k-ft" />
          <ConcretePeakRow label="Mmin" peak={design.mMin} unit="k-ft" />
        </div>

        <div className="mt-4 grid gap-px border text-[11px] tabular-nums" style={{ borderColor: "var(--border)", background: "var(--border)" }}>
          <ConcreteDemandRow label="Mu+" value={design.muPos} unit="k-ft" />
          <ConcreteDemandRow label="Mu-" value={design.muNeg} unit="k-ft" />
          <ConcreteDemandRow label="Vu" value={design.vu} unit="k" />
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 border px-3 font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{
              background: "var(--bg)",
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onEnter}
            className="h-8 border px-3 font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{
              background: "var(--subtle)",
              borderColor: PALETTE.fg,
              color: PALETTE.fg,
            }}
          >
            ENTER BEAM DESIGN
          </button>
        </div>
      </div>
    </div>
  );
}

function ConcretePeakRow({
  label,
  peak,
  unit,
}: {
  label: string;
  peak: PeakValue;
  unit: string;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr_160px] gap-3 bg-bg px-3 py-2">
      <span className="uppercase tracking-[0.08em]" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span style={{ color: PALETTE.fg }}>
        {fmt(peak.value)} {unit}
      </span>
      <span className="text-right" style={{ color: "var(--muted)" }}>
        M{peak.member + 1} l={fmt(peak.station)}
      </span>
    </div>
  );
}

function ConcreteDemandRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 bg-bg px-3 py-2">
      <span className="uppercase tracking-[0.08em]" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span style={{ color: PALETTE.fg }}>
        {fmt(value)} {unit}
      </span>
    </div>
  );
}

function buildLoadTargets(caseOptions: string[], comboOptions: string[]): LoadTarget[] {
  return [
    ...caseOptions.map((id) => loadTarget("case", id)),
    ...comboOptions.map((id) => loadTarget("combo", id)),
  ];
}

function buildEnvelopeOptions({
  caseOptions,
  comboOptions,
  loadCombinations,
  customEnvelopes,
}: {
  caseOptions: string[];
  comboOptions: string[];
  loadCombinations: LoadCombination[];
  customEnvelopes: EnvelopeDefinition[];
}): EnvelopeDefinition[] {
  const caseKeys = caseOptions.map((id) => loadTargetKey("case", id));
  const comboKeys = comboOptions.map((id) => loadTargetKey("combo", id));
  const serviceComboKeys = comboOptions
    .filter(
      (combo) =>
        combo !== "ALL" &&
        classifyCombination(loadCombinations, combo) === "service",
    )
    .map((id) => loadTargetKey("combo", id));
  const strengthComboKeys = comboOptions
    .filter(
      (combo) =>
        combo !== "ALL" &&
        classifyCombination(loadCombinations, combo) === "strength",
    )
    .map((id) => loadTargetKey("combo", id));

  const builtins: EnvelopeDefinition[] = [
    {
      id: "env:all",
      label: "ENVELOPE - ALL",
      targetKeys: uniqueStrings([...caseKeys, ...comboKeys]),
      builtin: true,
    },
    {
      id: "env:service",
      label: "ENVELOPE - SERVICE",
      targetKeys: uniqueStrings([
        ...caseKeys,
        ...(serviceComboKeys.length > 0 ? serviceComboKeys : []),
      ]),
      builtin: true,
    },
    {
      id: "env:strength",
      label: "ENVELOPE - STRENGTH",
      targetKeys: uniqueStrings(
        strengthComboKeys.length > 0
          ? strengthComboKeys
          : comboKeys.filter((key) => key !== loadTargetKey("combo", "ALL")),
      ),
      builtin: true,
    },
  ];

  return [...builtins, ...customEnvelopes.filter(isEnvelopeDefinition)];
}

function targetsForView({
  viewMode,
  activeCaseId,
  activeCombinationId,
  activeEnvelope,
  loadTargets,
}: {
  viewMode: LoadViewMode;
  activeCaseId: string;
  activeCombinationId: string;
  activeEnvelope: EnvelopeDefinition;
  loadTargets: LoadTarget[];
}): LoadTarget[] {
  if (viewMode === "case") return [loadTarget("case", activeCaseId)];
  if (viewMode === "combo") return [loadTarget("combo", activeCombinationId)];
  const byKey = new Map(loadTargets.map((target) => [target.key, target]));
  return activeEnvelope.targetKeys
    .map((key) => byKey.get(key))
    .filter((target): target is LoadTarget => !!target);
}

function labelForView(
  viewMode: LoadViewMode,
  activeCaseId: string,
  activeCombinationId: string,
  activeEnvelope: EnvelopeDefinition,
): string {
  if (viewMode === "case") return `CASE ${activeCaseId}`;
  if (viewMode === "combo") return `COMBO ${activeCombinationId}`;
  return activeEnvelope.label;
}

function combineLoadsForTarget({
  target,
  pointLoads,
  distLoads,
  loadCases,
  loadCombinations,
}: {
  target: LoadTarget;
  pointLoads: PointLoadRow[];
  distLoads: DistLoadRow[];
  loadCases: LoadCase[];
  loadCombinations: LoadCombination[];
}): CombinedLoads {
  if (target.kind === "case") {
    return combineLoadsForCase({
      pointLoads,
      distLoads,
      loadCases,
      loadCaseId: target.id,
    });
  }
  return combineLoads({
    pointLoads,
    distLoads,
    loadCases,
    loadCombinations,
    combinationId: target.id,
  });
}

function buildSolveRequest({
  nodes,
  members,
  fixity,
  pointSprings,
  uniformSprings,
  hinges,
  E,
  I,
  A,
  combinedLoads,
}: {
  nodes: Vec2[];
  members: Member[];
  fixity: Fixity[];
  pointSprings: PointSpring[];
  uniformSprings: UniformSpring[];
  hinges: [number, "i" | "j"][];
  E: number;
  I: number;
  A: number;
  combinedLoads: CombinedLoads;
}): SolveRequest {
  return {
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
      .map(([member, k, compressionOnly]) => ({
        member,
        k,
        compressionOnly: !!compressionOnly,
      })),
    hinges: hinges.map(([member, end]) => ({ member, end })),
    samplesPerMember: SAMPLES_PER_MEMBER,
    include: ["data"],
  };
}

function envelopeResponse(runs: AnalysisRun[]): SolveResponse {
  const base = runs[0].data;
  const members: MemberOut[] = base.members.map((member, memberIndex) => ({
    ...member,
    endForces: envelopeEndForces(runs, memberIndex),
    samples: member.samples.map((sample, sampleIndex) => ({
      ...sample,
      R: governingSampleValue(runs, memberIndex, sampleIndex, "R"),
      V: governingSampleValue(runs, memberIndex, sampleIndex, "V"),
      M: governingSampleValue(runs, memberIndex, sampleIndex, "M"),
      theta: governingSampleValue(runs, memberIndex, sampleIndex, "theta"),
      delta: governingSampleValue(runs, memberIndex, sampleIndex, "delta"),
    })),
  }));

  return {
    ok: true,
    reactions: envelopeReactions(runs),
    members,
    peaks: computeEnvelopePeaks(members),
    warnings: uniqueWarnings(runs),
  };
}

function envelopeEndForces(
  runs: AnalysisRun[],
  memberIndex: number,
): MemberOut["endForces"] {
  return {
    Ni: governingEndForceValue(runs, memberIndex, "Ni"),
    Vi: governingEndForceValue(runs, memberIndex, "Vi"),
    Mi: governingEndForceValue(runs, memberIndex, "Mi"),
    Nj: governingEndForceValue(runs, memberIndex, "Nj"),
    Vj: governingEndForceValue(runs, memberIndex, "Vj"),
    Mj: governingEndForceValue(runs, memberIndex, "Mj"),
  };
}

function envelopeReactions(runs: AnalysisRun[]): ReactionOut[] {
  const nodes = new Set<number>();
  runs.forEach((run) => run.data.reactions.forEach((r) => nodes.add(r.node)));
  return [...nodes]
    .sort((a, b) => a - b)
    .map((node) => ({
      node,
      Rx: governingReactionValue(runs, node, "Rx"),
      Ry: governingReactionValue(runs, node, "Ry"),
      M: governingReactionValue(runs, node, "M"),
    }));
}

function governingSampleValue(
  runs: AnalysisRun[],
  memberIndex: number,
  sampleIndex: number,
  field: keyof SampleOut,
): number {
  return governingValue(
    runs
      .map((run) => run.data.members[memberIndex]?.samples[sampleIndex]?.[field])
      .filter(isFiniteNumber),
  );
}

function governingEndForceValue(
  runs: AnalysisRun[],
  memberIndex: number,
  field: keyof MemberOut["endForces"],
): number {
  return governingValue(
    runs
      .map((run) => run.data.members[memberIndex]?.endForces[field])
      .filter(isFiniteNumber),
  );
}

function governingReactionValue(
  runs: AnalysisRun[],
  node: number,
  field: keyof Omit<ReactionOut, "node">,
): number {
  return governingValue(
    runs
      .map((run) => run.data.reactions.find((reaction) => reaction.node === node)?.[field])
      .filter(isFiniteNumber),
  );
}

function governingValue(values: number[]): number {
  let best = 0;
  for (const value of values) {
    if (Math.abs(value) > Math.abs(best)) best = value;
  }
  return best;
}

function computeEnvelopePeaks(members: MemberOut[]): SolveResponse["peaks"] {
  return {
    V: peakFromMembers(members, "V"),
    M: peakFromMembers(members, "M"),
    theta: peakFromMembers(members, "theta"),
    delta: peakFromMembers(members, "delta"),
  };
}

function peakFromMembers(
  members: MemberOut[],
  field: "V" | "M" | "theta" | "delta",
): PeakOut {
  let peak: PeakOut = { value: 0, x: 0, y: 0, member: 0, sLocal: 0 };
  members.forEach((member, memberIndex) => {
    member.samples.forEach((sample) => {
      const value = sample[field];
      if (Math.abs(value) > Math.abs(peak.value)) {
        peak = {
          value,
          x: sample.x,
          y: sample.y,
          member: memberIndex,
          sLocal: sample.s,
        };
      }
    });
  });
  return peak;
}

function uniqueWarnings(runs: AnalysisRun[]): SolveResponse["warnings"] {
  const seen = new Set<string>();
  const warnings = runs.flatMap((run) => run.data.warnings ?? []).filter((warning) => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return warnings.length > 0 ? warnings : undefined;
}

function loadTarget(kind: LoadTarget["kind"], id: string): LoadTarget {
  return {
    kind,
    id,
    key: loadTargetKey(kind, id),
    label: `${kind === "case" ? "CASE" : "COMBO"} ${id}`,
  };
}

function loadTargetKey(kind: LoadTarget["kind"], id: string): string {
  return `${kind === "case" ? CASE_PREFIX : COMBO_PREFIX}${normalizeLoadId(id)}`;
}

function parseEnvelopeTargetInput(
  input: string,
  targets: LoadTarget[],
): { targetKeys: string[]; unknown: string[] } {
  const byKey = new Map(targets.map((target) => [target.key, target]));
  const unknown: string[] = [];
  const targetKeys: string[] = [];
  const tokens = input
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const explicit = targetKeyFromToken(token);
    const target =
      (explicit ? byKey.get(explicit) : undefined) ??
      targets.find((candidate) => sameLoadId(candidate.id, token));
    if (!target) {
      unknown.push(token);
      continue;
    }
    if (!targetKeys.includes(target.key)) targetKeys.push(target.key);
  }

  return { targetKeys, unknown };
}

function targetKeyFromToken(token: string): string | null {
  const [prefix, ...rest] = token.split(":");
  const id = rest.join(":").trim();
  if (!id) return null;
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (normalizedPrefix === "case") return loadTargetKey("case", id);
  if (normalizedPrefix === "combo") return loadTargetKey("combo", id);
  return null;
}

function isEnvelopeDefinition(value: unknown): value is EnvelopeDefinition {
  if (!value || typeof value !== "object") return false;
  const envelope = value as EnvelopeDefinition;
  return (
    typeof envelope.id === "string" &&
    typeof envelope.label === "string" &&
    Array.isArray(envelope.targetKeys) &&
    envelope.targetKeys.every((key) => typeof key === "string")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function sameLoadId(a: string, b: string): boolean {
  return normalizeLoadId(a) === normalizeLoadId(b);
}

function normalizeLoadId(id: string): string {
  return id.trim().toLowerCase();
}

function concreteBeamBaseUrl(): string {
  if (typeof window === "undefined") return CONCRETE_BEAM_URL;
  const { hostname, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3001`;
  }
  return CONCRETE_BEAM_URL;
}

function handoffNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1000) / 1000);
}

function LoadModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 border px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{
        background: active ? "var(--subtle)" : "var(--bg)",
        borderColor: active ? PALETTE.fg : "var(--border)",
        color: PALETTE.fg,
        fontWeight: 400,
      }}
    >
      {label}
    </button>
  );
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

type DiagramInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function fbdDiagramInsets({
  pad,
  pointLoads,
  distLoads,
  reactions,
  fixity,
  pointSprings,
  uniformSprings,
}: {
  pad: number;
  pointLoads: CombinedLoads["pointLoads"];
  distLoads: CombinedLoads["distLoads"];
  reactions: ReactionOut[];
  fixity: Fixity[];
  pointSprings: PointSpring[];
  uniformSprings: UniformSpring[];
}): DiagramInsets {
  let topExtra = 24;
  let bottomExtra = fixity.some(([, rx, ry, rm]) => rx || ry || rm) ? 28 : 0;
  let sideExtra = 12;

  if (distLoads.some(([, wi, wj]) => wi !== 0 || wj !== 0)) {
    topExtra = Math.max(topExtra, LOAD_ARROW_MAX + 34);
  }
  if (pointLoads.some(([, , fy]) => fy < 0)) {
    topExtra = Math.max(topExtra, LOAD_ARROW_MAX + 22);
  }
  if (pointLoads.some(([, fx, , moment = 0]) => fx !== 0 || moment !== 0)) {
    topExtra = Math.max(topExtra, 38);
  }
  if (pointLoads.some(([, , fy]) => fy > 0)) {
    bottomExtra = Math.max(bottomExtra, LOAD_ARROW_MAX + 24);
  }
  if (reactions.some((reaction) => Math.abs(reaction.Ry) > 1e-3)) {
    bottomExtra = Math.max(bottomExtra, LOAD_ARROW_MAX + 72);
  }
  if (reactions.some((reaction) => Math.abs(reaction.Rx) > 1e-3)) {
    bottomExtra = Math.max(bottomExtra, 48);
    sideExtra = Math.max(sideExtra, LOAD_ARROW_MAX + 18);
  }
  if (pointSprings.some(([, kx]) => kx !== 0)) {
    sideExtra = Math.max(sideExtra, 54);
  }
  if (pointSprings.some(([, , ky]) => ky !== 0)) {
    bottomExtra = Math.max(bottomExtra, 56);
  }
  if (pointSprings.some(([, , , km]) => km !== 0)) {
    topExtra = Math.max(topExtra, 46);
    sideExtra = Math.max(sideExtra, 44);
  }
  if (uniformSprings.some(([, k]) => k !== 0)) {
    bottomExtra = Math.max(bottomExtra, 70);
    sideExtra = Math.max(sideExtra, 54);
  }

  return {
    top: pad + topExtra,
    right: pad + sideExtra,
    bottom: pad + bottomExtra,
    left: pad + sideExtra,
  };
}

function fbdPanelHeight(
  nodes: Vec2[],
  width: number,
  baseHeight: number,
  insets: DiagramInsets,
): number {
  const xs = nodes.map((node) => node[0]);
  const ys = nodes.map((node) => node[1]);
  const xmin = xs.length ? Math.min(...xs) : 0;
  const xmax = xs.length ? Math.max(...xs) : 1;
  const ymin = ys.length ? Math.min(...ys) : 0;
  const ymax = ys.length ? Math.max(...ys) : 0;
  const xspan = Math.max(xmax - xmin, 1);
  const yspan = Math.max(ymax - ymin, 0);
  const usableW = Math.max(width - insets.left - insets.right, 1);
  const projectedGeometryHeight = yspan * (usableW / xspan);
  return Math.ceil(
    Math.max(
      baseHeight,
      projectedGeometryHeight + insets.top + insets.bottom,
    ),
  );
}

function projectFrameWithInsets(
  nodes: Vec2[],
  width: number,
  height: number,
  insets: DiagramInsets,
): { X: (x: number) => number; Y: (y: number) => number } {
  const xs = nodes.map((n) => n[0]);
  const ys = nodes.map((n) => n[1]);
  const xmin = xs.length ? Math.min(...xs) : 0;
  const xmax = xs.length ? Math.max(...xs) : 1;
  const ymin = ys.length ? Math.min(...ys) : 0;
  const ymax = ys.length ? Math.max(...ys) : 1;
  const rawYspan = ymax - ymin;
  const xspan = Math.max(xmax - xmin, 1);
  const yspan = Math.max(rawYspan, 1);
  const usableW = Math.max(width - insets.left - insets.right, 1);
  const usableH = Math.max(height - insets.top - insets.bottom, 1);
  const scale = Math.min(usableW / xspan, usableH / yspan);
  const contentW = xspan * scale;
  const contentH = yspan * scale;
  const ox = insets.left + (usableW - contentW) / 2;
  const oy = insets.top + (usableH - contentH) / 2;
  const flatY = oy + contentH / 2;
  return {
    X: (x: number) => ox + (x - xmin) * scale,
    Y: (y: number) =>
      Math.abs(rawYspan) < 1e-9 ? flatY : oy + (ymax - y) * scale,
  };
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
      <circle cx={x} cy={y} r={NODE_MARKER_RADIUS} fill={PALETTE.support} />
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

function ProjectionGuide({
  x,
  y1,
  y2,
}: {
  x: number;
  y1: number;
  y2: number;
}) {
  return (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2}
      stroke={PALETTE.dim}
      strokeWidth={0.45}
      strokeDasharray="3 5"
      strokeOpacity={0.45}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function GraphValueLabels({
  samples,
  field,
  yAxis,
  height,
  max,
  X,
  unit,
}: {
  samples: DiagramSample[];
  field: DiagramField;
  yAxis: number;
  height: number;
  max: number;
  X: (station: number) => number;
  unit: string;
}) {
  return (
    <>
      {localPeakSamples(samples, field).map((sample, index) => {
        const value = sample[field];
        const x = X(sample.station);
        const yCurve = yAxis - (value / max) * (height / 2 - 12);
        const rawY = yCurve + (value >= 0 ? -6 : 14);
        const y = clamp(rawY, yAxis - height / 2 + 14, yAxis + height / 2 - 6);
        return (
          <GraphValueLabel
            key={`${field}-${index}-${sample.station}`}
            x={x}
            y={y}
            text={`${fmt(value)} ${unit}`}
          />
        );
      })}
    </>
  );
}

function localPeakSamples(
  samples: DiagramSample[],
  field: DiagramField,
): DiagramSample[] {
  if (samples.length === 0) return [];
  const max = Math.max(1e-12, ...samples.map((sample) => Math.abs(sample[field])));
  const valueTolerance = 0.03 * max;
  const stationSpan =
    samples[samples.length - 1].station - samples[0].station ||
    Math.max(1, samples[0].station);
  const stationTolerance = Math.max(1e-9, 0.01 * stationSpan);
  const out: DiagramSample[] = [];

  const push = (sample: DiagramSample) => {
    if (Math.abs(sample[field]) < valueTolerance) return;
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.station - sample.station) < stationTolerance &&
      Math.abs(last[field] - sample[field]) < valueTolerance
    ) {
      return;
    }
    out.push(sample);
  };

  push(samples[0]);
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1][field];
    const b = samples[i][field];
    const c = samples[i + 1][field];
    const isMax = b >= a && b >= c && (b > a || b > c);
    const isMin = b <= a && b <= c && (b < a || b < c);
    if (isMax || isMin) push(samples[i]);
  }
  push(samples[samples.length - 1]);

  return out;
}

function GraphValueLabel({
  x,
  y,
  text,
}: {
  x: number;
  y: number;
  text: string;
}) {
  const width = text.length * 6.4 + 10;
  const height = 16;
  return (
    <g pointerEvents="none">
      <rect
        x={x - width / 2}
        y={y - 12}
        width={width}
        height={height}
        fill="#fff"
        stroke="#111"
        strokeOpacity={0.22}
      />
      <text
        x={x}
        y={y}
        fontSize={10}
        fontWeight={700}
        fill="#111"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
      >
        {text}
      </text>
    </g>
  );
}

function formatLoadCasePrefix(loadCase: string | undefined): string {
  const trimmed = loadCase?.trim();
  return trimmed ? `${trimmed}: ` : "";
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

function scaledLoadArrowLength(value: number, max: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < 1e-9) return 0;
  const ratio = Math.min(1, magnitude / Math.max(max, 1e-9));
  return Math.max(LOAD_ARROW_MIN, ratio * LOAD_ARROW_MAX);
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
  const endAngle = positive ? 35 : 145;
  const end = polarPoint(cx, cy, r, endAngle);
  const angle = (endAngle * Math.PI) / 180;
  const tx = positive ? -Math.sin(angle) : Math.sin(angle);
  const ty = positive ? -Math.cos(angle) : Math.cos(angle);
  const nx = -ty;
  const ny = tx;
  const head = 5;
  const bx = end.x - tx * head;
  const by = end.y - ty * head;
  const hx1 = bx + nx * head * 0.55;
  const hy1 = by + ny * head * 0.55;
  const hx2 = bx - nx * head * 0.55;
  const hy2 = by - ny * head * 0.55;

  return (
    <g stroke={color} fill={color} strokeWidth={1.3} strokeLinecap="round">
      <circle cx={cx} cy={cy} r={r} fill="none" />
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
  compressionOnly,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  k: number;
  compressionOnly: boolean;
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
        {compressionOnly ? " C" : ""}
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
