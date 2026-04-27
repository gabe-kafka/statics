"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { OsnapTypes, Tool } from "./StatusBar";

export type Vec2 = [number, number];
type View = { tx: number; ty: number; scale: number };
type SnapKind = "endpoint" | "midpoint" | "nearest" | "grid";
type SnapHit = { p: Vec2; kind: SnapKind } | null;

const GRID_STEP = 1;
const GRID_MAJOR = 5;
const SNAP_PX = 10;

export function Canvas({
  nodes,
  members,
  fixity,
  pointLoads,
  hinges,
  tool,
  ortho,
  osnap,
  osnapTypes,
  onAddNode,
  onAddMember,
  onToggleHinge,
  onCursorChange,
}: {
  nodes: Vec2[];
  members: [number, number][];
  fixity: [number, number, number, number][];
  pointLoads: [number, number, number][];
  hinges: number[];
  tool: Tool;
  ortho: boolean;
  osnap: boolean;
  osnapTypes: OsnapTypes;
  onAddNode: (p: Vec2) => number;
  onAddMember: (ij: [number, number]) => void;
  onToggleHinge: (nodeIdx: number) => void;
  onCursorChange: (w: Vec2 | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ tx: 0, ty: 0, scale: 30 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [initialized, setInitialized] = useState(false);

  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snap, setSnap] = useState<SnapHit>(null);
  const [anchor, setAnchor] = useState<{ i: number; p: Vec2 } | null>(null);

  const panRef = useRef<{ ox: number; oy: number; tx: number; ty: number } | null>(
    null,
  );
  const spaceRef = useRef(false);

  useEffect(() => {
    if (!svgRef.current) return;
    const el = svgRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (initialized || size.w === 0 || size.h === 0) return;
    if (nodes.length === 0) {
      setView({ tx: size.w / 2, ty: size.h / 2, scale: 30 });
    } else {
      const xs = nodes.map((n) => n[0]);
      const ys = nodes.map((n) => n[1]);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs);
      const minY = Math.min(...ys),
        maxY = Math.max(...ys);
      const dx = Math.max(maxX - minX, 1);
      const dy = Math.max(maxY - minY, 1);
      const pad = 60;
      const sx = (size.w - pad * 2) / dx;
      const sy = (size.h - pad * 2) / dy;
      const scale = Math.max(4, Math.min(sx, sy, 200));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setView({
        tx: size.w / 2 - cx * scale,
        ty: size.h / 2 + cy * scale,
        scale,
      });
    }
    setInitialized(true);
  }, [initialized, size, nodes]);

  const toWorld = useCallback(
    (px: number, py: number): Vec2 => [
      (px - view.tx) / view.scale,
      -(py - view.ty) / view.scale,
    ],
    [view],
  );
  const toScreen = useCallback(
    (w: Vec2): Vec2 => [
      w[0] * view.scale + view.tx,
      -w[1] * view.scale + view.ty,
    ],
    [view],
  );

  const clientToSvg = (e: ReactPointerEvent): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const applyOrtho = useCallback(
    (p: Vec2): Vec2 => {
      if (!ortho || !anchor) return p;
      const dx = Math.abs(p[0] - anchor.p[0]);
      const dy = Math.abs(p[1] - anchor.p[1]);
      return dx >= dy ? [p[0], anchor.p[1]] : [anchor.p[0], p[1]];
    },
    [ortho, anchor],
  );

  const computeSnap = useCallback(
    (screenP: Vec2, worldP: Vec2): SnapHit => {
      if (!osnap) return null;
      type Cand = { s: Vec2; d2: number; kind: SnapKind };
      const cands: Cand[] = [];
      const tryPoint = (w: Vec2, kind: SnapKind) => {
        const [sx, sy] = toScreen(w);
        const dx = sx - screenP[0];
        const dy = sy - screenP[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < SNAP_PX * SNAP_PX) cands.push({ s: w, d2, kind });
      };
      if (osnapTypes.endpoint) {
        for (const n of nodes) tryPoint(n, "endpoint");
      }
      if (osnapTypes.midpoint) {
        for (const [i, j] of members) {
          if (!nodes[i] || !nodes[j]) continue;
          tryPoint(
            [(nodes[i][0] + nodes[j][0]) / 2, (nodes[i][1] + nodes[j][1]) / 2],
            "midpoint",
          );
        }
      }
      if (osnapTypes.nearest) {
        for (const [i, j] of members) {
          const a = nodes[i],
            b = nodes[j];
          if (!a || !b) continue;
          const vx = b[0] - a[0];
          const vy = b[1] - a[1];
          const L2 = vx * vx + vy * vy;
          if (L2 === 0) continue;
          const t = Math.max(
            0,
            Math.min(1, ((worldP[0] - a[0]) * vx + (worldP[1] - a[1]) * vy) / L2),
          );
          tryPoint([a[0] + t * vx, a[1] + t * vy], "nearest");
        }
      }
      if (cands.length === 0) return null;
      const best = cands.reduce((a, b) => (b.d2 < a.d2 ? b : a));
      return { p: best.s, kind: best.kind };
    },
    [osnap, osnapTypes, nodes, members, toScreen],
  );

  const resolveTarget = useCallback(
    (e: ReactPointerEvent): { p: Vec2; snap: SnapHit } => {
      const [px, py] = clientToSvg(e);
      const raw = toWorld(px, py);
      const s = computeSnap([px, py], raw);
      const base = s ? s.p : raw;
      const withOrtho = applyOrtho(base);
      return { p: withOrtho, snap: s };
    },
    [toWorld, computeSnap, applyOrtho],
  );

  const findExistingNode = useCallback(
    (p: Vec2): number | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (Math.abs(nodes[i][0] - p[0]) < 1e-6 && Math.abs(nodes[i][1] - p[1]) < 1e-6)
          return i;
      }
      return null;
    },
    [nodes],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!svgRef.current) return;
    if (e.button === 1 || spaceRef.current || e.button === 2) {
      const [px, py] = clientToSvg(e);
      panRef.current = { ox: px, oy: py, tx: view.tx, ty: view.ty };
      svgRef.current.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const { p } = resolveTarget(e);

    if (tool === "node") {
      onAddNode(p);
    } else if (tool === "member") {
      if (!anchor) {
        const existing = findExistingNode(p);
        const i = existing ?? onAddNode(p);
        setAnchor({ i, p });
      } else {
        const existing = findExistingNode(p);
        const j = existing ?? onAddNode(p);
        if (j !== anchor.i) onAddMember([anchor.i, j]);
        setAnchor(null);
      }
    } else if (tool === "hinge") {
      const existing = findExistingNode(p);
      const idx = existing ?? onAddNode(p);
      onToggleHinge(idx);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const [px, py] = clientToSvg(e);
    if (panRef.current) {
      setView((v) => ({
        ...v,
        tx: panRef.current!.tx + (px - panRef.current!.ox),
        ty: panRef.current!.ty + (py - panRef.current!.oy),
      }));
      return;
    }
    const raw = toWorld(px, py);
    const s = computeSnap([px, py], raw);
    const base = s ? s.p : raw;
    const withOrtho = applyOrtho(base);
    setSnap(s);
    setCursor(withOrtho);
    onCursorChange(withOrtho);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (panRef.current && svgRef.current) {
      svgRef.current.releasePointerCapture(e.pointerId);
      panRef.current = null;
    }
  };

  const onPointerLeave = () => {
    setCursor(null);
    setSnap(null);
    onCursorChange(null);
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        const newScale = Math.max(1, Math.min(500, v.scale * factor));
        const wx = (px - v.tx) / v.scale;
        const wy = (py - v.ty) / v.scale;
        setView({
          scale: newScale,
          tx: px - wx * newScale,
          ty: py - wy * newScale,
        });
      } else {
        setView({ scale: v.scale, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKD = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = true;
        if (svgRef.current) svgRef.current.style.cursor = "grab";
      }
      if (e.key === "Escape") setAnchor(null);
    };
    const onKU = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        if (svgRef.current) svgRef.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", onKD);
    window.addEventListener("keyup", onKU);
    return () => {
      window.removeEventListener("keydown", onKD);
      window.removeEventListener("keyup", onKU);
    };
  }, []);

  const gridLines = useMemo(() => {
    if (size.w === 0) return null;
    const [minX, maxY] = toWorld(0, 0);
    const [maxX, minY] = toWorld(size.w, size.h);
    const step = view.scale < 12 ? GRID_MAJOR : GRID_STEP;
    const x0 = Math.floor(minX / step) * step;
    const y0 = Math.floor(minY / step) * step;
    const verticals: number[] = [];
    const horizontals: number[] = [];
    for (let x = x0; x <= maxX; x += step) verticals.push(x);
    for (let y = y0; y <= maxY; y += step) horizontals.push(y);
    return { verticals, horizontals };
  }, [size, view, toWorld]);

  const rubber = anchor && cursor ? (
    <line
      x1={toScreen(anchor.p)[0]}
      y1={toScreen(anchor.p)[1]}
      x2={toScreen(cursor)[0]}
      y2={toScreen(cursor)[1]}
      stroke="var(--accent)"
      strokeWidth={1}
      strokeDasharray="4 3"
    />
  ) : null;

  const showCursor = cursor && tool !== "select";

  return (
    <svg
      ref={svgRef}
      className="h-full w-full"
      style={{
        background: "var(--bg)",
        cursor: panRef.current || spaceRef.current ? "grab" : tool === "select" ? "default" : "crosshair",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* grid */}
      {gridLines && (
        <g stroke="var(--border)" strokeWidth={0.5}>
          {gridLines.verticals.map((x) => {
            const sx = x * view.scale + view.tx;
            const isMajor = Math.abs(x % GRID_MAJOR) < 1e-9;
            return (
              <line
                key={`v${x}`}
                x1={sx}
                y1={0}
                x2={sx}
                y2={size.h}
                opacity={isMajor ? 0.6 : 0.25}
              />
            );
          })}
          {gridLines.horizontals.map((y) => {
            const sy = -y * view.scale + view.ty;
            const isMajor = Math.abs(y % GRID_MAJOR) < 1e-9;
            return (
              <line
                key={`h${y}`}
                x1={0}
                y1={sy}
                x2={size.w}
                y2={sy}
                opacity={isMajor ? 0.6 : 0.25}
              />
            );
          })}
        </g>
      )}

      {/* axes */}
      <g stroke="var(--muted)" strokeWidth={1} opacity={0.7}>
        <line x1={0} y1={view.ty} x2={size.w} y2={view.ty} />
        <line x1={view.tx} y1={0} x2={view.tx} y2={size.h} />
      </g>

      {/* members */}
      <g stroke="var(--text)" strokeWidth={2} strokeLinecap="round">
        {members.map(([i, j], idx) => {
          if (!nodes[i] || !nodes[j]) return null;
          const [x1, y1] = toScreen(nodes[i]);
          const [x2, y2] = toScreen(nodes[j]);
          return <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>

      {/* fixity markers */}
      <g stroke="var(--accent)" fill="var(--accent)" strokeWidth={1.2}>
        {fixity.map(([ni, rx, ry, rm], idx) => {
          if (!nodes[ni]) return null;
          const [sx, sy] = toScreen(nodes[ni]);
          if (rx && ry && rm) {
            return (
              <g key={idx}>
                <rect x={sx - 6} y={sy - 6} width={12} height={12} fill="none" />
                <line x1={sx - 8} y1={sy + 6} x2={sx + 8} y2={sy + 6} />
              </g>
            );
          }
          if (rx && ry) {
            return (
              <g key={idx}>
                <polygon
                  points={`${sx},${sy} ${sx - 7},${sy + 10} ${sx + 7},${sy + 10}`}
                  fill="none"
                />
                <line x1={sx - 10} y1={sy + 12} x2={sx + 10} y2={sy + 12} />
              </g>
            );
          }
          if (ry) {
            return (
              <g key={idx}>
                <circle cx={sx} cy={sy + 6} r={4} fill="none" />
                <line x1={sx - 8} y1={sy + 12} x2={sx + 8} y2={sy + 12} />
              </g>
            );
          }
          return <circle key={idx} cx={sx} cy={sy} r={4} fill="none" />;
        })}
      </g>

      {/* nodes */}
      <g>
        {nodes.map((n, i) => {
          const [sx, sy] = toScreen(n);
          const isHinged = hinges.includes(i);
          if (isHinged) {
            return (
              <circle
                key={i}
                cx={sx}
                cy={sy}
                r={4.5}
                fill="var(--bg)"
                stroke="var(--text)"
                strokeWidth={1.5}
              />
            );
          }
          return (
            <circle key={i} cx={sx} cy={sy} r={3.5} fill="var(--text)" />
          );
        })}
      </g>

      {/* point loads */}
      <g stroke="var(--red)" fill="var(--red)" strokeWidth={1.4}>
        {pointLoads.map(([ni, fx, fy], idx) => {
          if (!nodes[ni] || (fx === 0 && fy === 0)) return null;
          const [sx, sy] = toScreen(nodes[ni]);
          const mag = Math.hypot(fx, fy);
          const L = 36;
          const ux = -fx / mag;
          const uy = fy / mag;
          const tx = sx + ux * L;
          const ty = sy + uy * L;
          const ang = Math.atan2(sy - ty, sx - tx);
          const hLen = 8;
          const hAng = 0.5;
          return (
            <g key={idx}>
              <line x1={tx} y1={ty} x2={sx} y2={sy} />
              <line
                x1={sx}
                y1={sy}
                x2={sx - hLen * Math.cos(ang - hAng)}
                y2={sy - hLen * Math.sin(ang - hAng)}
              />
              <line
                x1={sx}
                y1={sy}
                x2={sx - hLen * Math.cos(ang + hAng)}
                y2={sy - hLen * Math.sin(ang + hAng)}
              />
            </g>
          );
        })}
      </g>

      {rubber}

      {/* crosshair */}
      {showCursor && cursor && (
        <g stroke="var(--accent)" strokeWidth={1} opacity={0.5}>
          <line x1={0} y1={toScreen(cursor)[1]} x2={size.w} y2={toScreen(cursor)[1]} />
          <line x1={toScreen(cursor)[0]} y1={0} x2={toScreen(cursor)[0]} y2={size.h} />
        </g>
      )}

      {/* snap marker */}
      {snap && <SnapMarker p={toScreen(snap.p)} kind={snap.kind} />}
    </svg>
  );
}

function SnapMarker({ p, kind }: { p: Vec2; kind: SnapKind }) {
  const [sx, sy] = p;
  const s = 6;
  if (kind === "endpoint") {
    return (
      <rect
        x={sx - s}
        y={sy - s}
        width={s * 2}
        height={s * 2}
        fill="none"
        stroke="var(--amber)"
        strokeWidth={1.5}
      />
    );
  }
  if (kind === "midpoint") {
    return (
      <polygon
        points={`${sx},${sy - s} ${sx + s},${sy + s} ${sx - s},${sy + s}`}
        fill="none"
        stroke="var(--amber)"
        strokeWidth={1.5}
      />
    );
  }
  return (
    <path
      d={`M ${sx - s} ${sy - s} L ${sx + s} ${sy + s} M ${sx + s} ${sy - s} L ${sx - s} ${sy + s}`}
      stroke="var(--amber)"
      strokeWidth={1.5}
      fill="none"
    />
  );
}
