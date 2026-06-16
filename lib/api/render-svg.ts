// Pure server-side SVG generator. No React, no browser APIs. Mirrors the
// notebook palette used by the human-facing Diagrams component but is its
// own implementation so the API can return SVG strings without spinning up
// React on the server.

import type {
  SolveResponse,
  SvgOut,
} from "./types";
import type { SolveRequest } from "./types";

type Palette = {
  bg: string;
  fg: string;
  dim: string;
  beam: string;
  load: string;
  support: string;
  reaction: string;
  shear: string;
  moment: string;
  theta: string;
  delta: string;
};

const PALETTE_DARK: Palette = {
  bg: "#000",
  fg: "#fff",
  dim: "#6a6a6a",
  beam: "#e63946",
  load: "#ffd100",
  support: "#4aa3ff",
  reaction: "#a6ff5a",
  shear: "#3b82f6",
  moment: "#3b82f6",
  theta: "#4aa3ff",
  delta: "#ff7aa2",
};

// Light-mode palette: same hue identity but tuned for legibility on a
// white background — neon-yellow → amber, near-white-greens → forest
// green, etc. Background and foreground swap.
const PALETTE_LIGHT: Palette = {
  bg: "#ffffff",
  fg: "#1a1a1a",
  dim: "#6b6b6b",
  beam: "#dc2626",
  load: "#d97706",
  support: "#0057ff",
  reaction: "#16a34a",
  shear: "#0057ff",
  moment: "#0057ff",
  theta: "#0057ff",
  delta: "#be185d",
};

function paletteFor(theme: SolveRequest["theme"]): Palette {
  return theme === "light" ? PALETTE_LIGHT : PALETTE_DARK;
}

const W = 880;
const PAD = 48;
const LOAD_ARROW_MAX = 56;
const LOAD_ARROW_MIN = 8;

type Plot = "fbd" | "R" | "V" | "M" | "theta" | "delta";

const INCHES_PER_UNIT: Record<NonNullable<SolveRequest["lengthUnit"]>, number> = {
  in: 1,
  ft: 12,
  m: 39.3701,
};

export function renderSvg(
  req: SolveRequest,
  res: Pick<SolveResponse, "members" | "reactions">,
): SvgOut {
  const stationEnds = memberStationEnds(res.members);
  const totalStation = Math.max(stationEnds[stationEnds.length - 1] ?? 1, 1);
  const X = (s: number) => PAD + (s / totalStation) * (W - 2 * PAD);

  // The data payload stays in API-internal units (in / k·in). Display
  // labels on the SVGs are converted into the caller's preferred unit.
  // Default to "ft" — moments shown in k·in are unreadable in
  // structural practice; callers who actually want inches must opt in.
  const unit = req.lengthUnit ?? "ft";
  const lenScale = INCHES_PER_UNIT[unit];
  const ux = (xInches: number) => xInches / lenScale; // station-axis label
  // Dist-load intensities arrive in force-per-inch (build-request side
  // divides k/ft by 12 before sending). Multiply by lenScale to get
  // back to force-per-{user-unit} for the label.
  const uW = (wKipPerIn: number) => wKipPerIn * lenScale;

  const palette = paletteFor(req.theme);

  const fbd = renderFbd(req, res, ux, unit, uW, palette);
  const R = renderCurve(res, X, stationEnds, "R", palette.shear, "R(l)", palette, {
    unit: "klf",
  });
  const V = renderCurve(res, X, stationEnds, "V", palette.shear, "V(l)", palette, {
    unit: "k",
  });
  const M = renderCurve(res, X, stationEnds, "M", palette.moment, `M(l) [k·${unit}]`, palette, {
    unit: `k-${unit}`,
    valueScale: 1 / lenScale,
  });
  const theta = renderCurve(res, X, stationEnds, "theta", palette.theta, "θ(l)", palette, {
    unit: "rad",
  });
  const delta = renderCurve(res, X, stationEnds, "delta", palette.delta, "Δ(l)", palette, {
    unit: "in",
  });
  const all = renderAll(
    fbd,
    R,
    V,
    M,
    theta,
    delta,
    fbdGuidePoints(req.nodes),
    totalStation,
    X,
    ux,
    unit,
    palette,
  );

  return { fbd, R, V, M, theta, delta, all };
}

function memberStationEnds(members: Pick<SolveResponse, "members">["members"]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const member of members) {
    acc += member.L;
    out.push(acc);
  }
  return out;
}

function projectFrame(
  nodes: SolveRequest["nodes"],
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

function svgWrap(
  width: number,
  height: number,
  body: string,
  palette: Palette,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="background:${palette.bg};font-family:ui-monospace,Menlo,monospace;display:block">${body}</svg>`;
}

function fbdGuidePoints(nodes: SolveRequest["nodes"]): { x: number; y: number }[] {
  const frame = projectFrame(nodes, W, 220, PAD);
  return nodes.map(([x, y]) => ({ x: frame.X(x), y: frame.Y(y) }));
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a < 0.1) return n.toFixed(3);
  if (a < 10) return n.toFixed(2);
  return n.toFixed(1);
}

function scaledLoadArrowLength(value: number, max: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < 1e-9) return 0;
  const ratio = Math.min(1, magnitude / Math.max(max, 1e-9));
  return Math.max(LOAD_ARROW_MIN, ratio * LOAD_ARROW_MAX);
}

function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  head = 5,
  width = 1.2,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return "";
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
    `<g stroke="${color}" fill="${color}" stroke-width="${width}" stroke-linecap="round">` +
    `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}"/>` +
    `<polygon points="${x2},${y2} ${h1x},${h1y} ${h2x},${h2y}"/>` +
    `</g>`
  );
}

function momentArrow(
  cx: number,
  cy: number,
  r: number,
  positive: boolean,
  color: string,
): string {
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
    `<g stroke="${color}" fill="${color}" stroke-width="1.3" stroke-linecap="round">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"/>` +
    `<polygon points="${end.x},${end.y} ${hx1},${hy1} ${hx2},${hy2}"/>` +
    `</g>`
  );
}

function linearSpringSvg(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
): string {
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const dx = Math.sign(x2 - x1) || 1;
  const dy = Math.sign(y2 - y1) || 1;
  const parts = [
    `<path d="${springPath(x1, y1, x2, y2)}" fill="none"/>`,
  ];

  if (horizontal) {
    parts.push(
      `<line x1="${x2}" y1="${y2}" x2="${x2 + dx * 6}" y2="${y2}"/>`,
      `<line x1="${x2 + dx * 6}" y1="${y2 - 11}" x2="${x2 + dx * 6}" y2="${y2 + 11}"/>`,
    );
    for (let i = 0; i < 4; i++) {
      parts.push(
        `<line x1="${x2 + dx * 6}" y1="${y2 - 9 + i * 6}" x2="${x2 + dx * 11}" y2="${y2 - 13 + i * 6}"/>`,
      );
    }
  } else {
    parts.push(
      `<line x1="${x2}" y1="${y2}" x2="${x2}" y2="${y2 + dy * 6}"/>`,
      `<line x1="${x2 - 13}" y1="${y2 + dy * 6}" x2="${x2 + 13}" y2="${y2 + dy * 6}"/>`,
    );
    for (let i = 0; i < 5; i++) {
      parts.push(
        `<line x1="${x2 - 13 + i * 6.5}" y1="${y2 + dy * 6}" x2="${x2 - 17 + i * 6.5}" y2="${y2 + dy * 12}"/>`,
      );
    }
  }

  return `<g stroke="${color}" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</g>`;
}

function rotationalSpringSvg(cx: number, cy: number, color: string): string {
  const springCy = cy - 22;
  const parts = [
    `<line x1="${cx}" y1="${cy - 4}" x2="${cx}" y2="${springCy + 12}"/>`,
    `<path d="${spiralPath(cx, springCy, 3, 13, 1.85)}" fill="none"/>`,
    `<line x1="${cx + 14}" y1="${springCy}" x2="${cx + 22}" y2="${springCy}"/>`,
    `<line x1="${cx + 22}" y1="${springCy - 10}" x2="${cx + 22}" y2="${springCy + 10}"/>`,
  ];
  for (let i = 0; i < 4; i++) {
    parts.push(
      `<line x1="${cx + 22}" y1="${springCy - 8 + i * 5.5}" x2="${cx + 27}" y2="${springCy - 12 + i * 5.5}"/>`,
    );
  }
  return `<g stroke="${color}" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</g>`;
}

function uniformSpringFoundationSvg(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  k: number,
  color: string,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return "";
  const ux = dx / len;
  const uy = dy / len;
  let nx = -uy;
  let ny = ux;
  if (ny < -0.15) {
    nx *= -1;
    ny *= -1;
  } else if (Math.abs(ny) <= 0.15) {
    const dir = (x1 + x2) / 2 < W / 2 ? 1 : -1;
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
  const parts: string[] = [];

  for (let i = 0; i < springCount; i++) {
    const t = (i + 1) / (springCount + 1);
    const sx = x1 + dx * t;
    const sy = y1 + dy * t;
    parts.push(
      `<path d="${springPath(
        sx + nx * 4,
        sy + ny * 4,
        sx + nx * (baseOffset - 2),
        sy + ny * (baseOffset - 2),
      )}" fill="none"/>`,
    );
  }
  parts.push(
    `<line x1="${baseX1}" y1="${baseY1}" x2="${baseX2}" y2="${baseY2}"/>`,
  );
  for (let i = 0; i < hatchCount; i++) {
    const t = hatchCount === 1 ? 0.5 : i / (hatchCount - 1);
    const hx = baseX1 + (baseX2 - baseX1) * t;
    const hy = baseY1 + (baseY2 - baseY1) * t;
    parts.push(
      `<line x1="${hx}" y1="${hy}" x2="${hx - ux * 5 + nx * 6}" y2="${hy - uy * 5 + ny * 6}"/>`,
    );
  }
  parts.push(
    `<text x="${labelX}" y="${labelY}" fill="${color}" stroke="none" font-size="9" text-anchor="middle">k=${escapeText(fmt(k))}</text>`,
  );

  return `<g stroke="${color}" fill="none" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</g>`;
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

function renderFbd(
  req: SolveRequest,
  res: Pick<SolveResponse, "reactions">,
  ux: (xInches: number) => number,
  unitLbl: string,
  uW: (wKipPerIn: number) => number,
  palette: Palette,
): string {
  const H = 220;
  const frame = projectFrame(req.nodes, W, H, PAD);
  const out: string[] = [];

  // Distributed loads: callers (e.g. the structural-terminal builder)
  // fan a single user-load across every sub-member created by interior
  // splits, so a continuous load arrives here as N adjacent entries
  // with matching w at each shared node. Aggregate those runs back
  // into one rendered band so the FBD shows ONE label per real load
  // instead of N copies of the same number.
  type Bar = { x0: number; x1: number; w0: number; w1: number };
  const bars: Bar[] = [];
  for (const dl of req.distLoads ?? []) {
    const m = req.members[dl.member];
    if (!m) continue;
    const a = req.nodes[m.i];
    const b = req.nodes[m.j];
    if (!a || !b) continue;
    const x0 = a[0];
    const x1 = b[0];
    const last = bars[bars.length - 1];
    if (
      last &&
      Math.abs(last.x1 - x0) < 1e-6 &&
      Math.abs(last.w1 - dl.wi) < 1e-9
    ) {
      // Continuous with the previous run — extend it.
      last.x1 = x1;
      last.w1 = dl.wj;
    } else {
      bars.push({ x0, x1, w0: dl.wi, w1: dl.wj });
    }
  }

  const loadVisualMax = Math.max(
    1e-6,
    ...(req.pointLoads ?? []).flatMap((p) => [Math.abs(p.Fx), Math.abs(p.Fy)]),
    ...bars.flatMap((b) => [Math.abs(uW(b.w0)), Math.abs(uW(b.w1))]),
  );
  for (const bar of bars) {
    const xa = frame.X(bar.x0);
    const xb = frame.X(bar.x1);
    const yBase = frame.Y(req.nodes[0]?.[1] ?? 0);
    const ha = scaledLoadArrowLength(uW(bar.w0), loadVisualMax);
    const hb = scaledLoadArrowLength(uW(bar.w1), loadVisualMax);
    const ya = yBase - ha - 2;
    const yb = yBase - hb - 2;
    out.push(
      `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${palette.load}" stroke-width="1.4"/>`,
      `<line x1="${xa}" y1="${ya}" x2="${xa}" y2="${yBase - 2}" stroke="${palette.load}" stroke-width="1.2"/>`,
      `<line x1="${xb}" y1="${yb}" x2="${xb}" y2="${yBase - 2}" stroke="${palette.load}" stroke-width="1.2"/>`,
    );
    const N = Math.max(3, Math.round((xb - xa) / 24));
    for (let n = 1; n <= N - 1; n++) {
      const t = n / N;
      const xi = xa + t * (xb - xa);
      const yi = ya + t * (yb - ya);
      out.push(arrow(xi, yi, xi, yBase - 3, palette.load, 4));
    }
    const midX = (xa + xb) / 2;
    const midY = Math.min(ya, yb) - 6;
    const w0Disp = uW(bar.w0);
    const w1Disp = uW(bar.w1);
    const lbl =
      Math.abs(bar.w0 - bar.w1) < 1e-9
        ? `${fmt(w0Disp)} k/${unitLbl}`
        : `${fmt(w0Disp)} → ${fmt(w1Disp)} k/${unitLbl}`;
    out.push(
      `<text x="${midX}" y="${midY}" fill="${palette.load}" font-size="10" text-anchor="middle">${escapeText(lbl)}</text>`,
    );
  }

  // point loads
  for (const pl of req.pointLoads ?? []) {
    if (!req.nodes[pl.node]) continue;
    const moment = pl.M ?? 0;
    if (pl.Fx === 0 && pl.Fy === 0 && moment === 0) continue;
    const cx = frame.X(req.nodes[pl.node][0]);
    const cy = frame.Y(req.nodes[pl.node][1]);
    if (pl.Fy !== 0) {
      const L = scaledLoadArrowLength(pl.Fy, loadVisualMax);
      const down = pl.Fy < 0;
      const tipY = down ? cy - 3 : cy + 3;
      const tailY = down ? tipY - L : tipY + L;
      out.push(arrow(cx, tailY, cx, tipY, palette.load, 6));
      out.push(
        `<text x="${cx + 6}" y="${tailY + 10}" fill="${palette.load}" font-size="10">${escapeText(fmt(Math.abs(pl.Fy)))}</text>`,
      );
    }
    if (pl.Fx !== 0) {
      const L = scaledLoadArrowLength(pl.Fx, loadVisualMax);
      const right = pl.Fx > 0;
      const tipX = right ? cx + 3 : cx - 3;
      const tailX = right ? tipX - L : tipX + L;
      out.push(arrow(tailX, cy, tipX, cy, palette.load, 6));
      out.push(
        `<text x="${tailX}" y="${cy - 8}" fill="${palette.load}" font-size="10" text-anchor="${right ? "end" : "start"}">${escapeText(fmt(Math.abs(pl.Fx)))}</text>`,
      );
    }
    if (moment !== 0) {
      out.push(momentArrow(cx, cy, 15, moment > 0, palette.load));
      out.push(
        `<text x="${cx + 20}" y="${cy - 18}" fill="${palette.load}" font-size="10">${escapeText(fmt(Math.abs(moment)))}</text>`,
      );
    }
  }

  // uniform spring foundations
  for (const spring of req.uniformSprings ?? []) {
    if (spring.k === 0) continue;
    const member = req.members[spring.member];
    if (!member) continue;
    const a = req.nodes[member.i];
    const b = req.nodes[member.j];
    if (!a || !b) continue;
    out.push(
      uniformSpringFoundationSvg(
        frame.X(a[0]),
        frame.Y(a[1]),
        frame.X(b[0]),
        frame.Y(b[1]),
        spring.k,
        palette.support,
      ),
    );
  }

  // beam
  for (const m of req.members) {
    const a = req.nodes[m.i];
    const b = req.nodes[m.j];
    out.push(
      `<line x1="${frame.X(a[0])}" y1="${frame.Y(a[1])}" x2="${frame.X(b[0])}" y2="${frame.Y(b[1])}" stroke="${palette.beam}" stroke-width="2.5" stroke-linecap="round"/>`,
    );
  }

  // point springs
  for (const spring of req.pointSprings ?? []) {
    if (!req.nodes[spring.node]) continue;
    if (spring.Kx === 0 && spring.Ky === 0 && spring.Km === 0) continue;
    const cx = frame.X(req.nodes[spring.node][0]);
    const cy = frame.Y(req.nodes[spring.node][1]);
    if (spring.Kx !== 0) {
      const dir = cx < W / 2 ? 1 : -1;
      out.push(
        linearSpringSvg(
          cx + dir * 4,
          cy,
          cx + dir * 34,
          cy,
          palette.support,
        ),
      );
    }
    if (spring.Ky !== 0) {
      out.push(linearSpringSvg(cx, cy + 4, cx, cy + 34, palette.support));
    }
    if (spring.Km !== 0) {
      out.push(rotationalSpringSvg(cx, cy, palette.support));
    }
  }

  // supports
  for (const sup of req.supports) {
    if (!req.nodes[sup.node]) continue;
    const cx = frame.X(req.nodes[sup.node][0]);
    const cy = frame.Y(req.nodes[sup.node][1]);
    if (sup.Rx && sup.Ry && sup.Rm) {
      out.push(
        `<rect x="${cx - 12}" y="${cy}" width="24" height="10" fill="${palette.support}" fill-opacity="0.35" stroke="${palette.support}"/>`,
      );
    } else if (sup.Rx && sup.Ry) {
      out.push(
        `<polygon points="${cx},${cy} ${cx - 10},${cy + 16} ${cx + 10},${cy + 16}" fill="${palette.support}" stroke="${palette.support}"/>`,
        `<line x1="${cx - 14}" y1="${cy + 16}" x2="${cx + 14}" y2="${cy + 16}" stroke="${palette.support}" stroke-width="1.2"/>`,
      );
    } else if (sup.Ry) {
      out.push(
        `<circle cx="${cx}" cy="${cy + 8}" r="6" fill="${palette.support}" stroke="${palette.support}"/>`,
        `<line x1="${cx - 14}" y1="${cy + 16}" x2="${cx + 14}" y2="${cy + 16}" stroke="${palette.support}" stroke-width="1.2"/>`,
      );
    }
  }

  // reactions
  const Rmax = Math.max(
    1,
    ...res.reactions.map((r) => Math.max(Math.abs(r.Rx), Math.abs(r.Ry))),
  );
  for (const r of res.reactions) {
    if (!req.nodes[r.node]) continue;
    const cx = frame.X(req.nodes[r.node][0]);
    const cy = frame.Y(req.nodes[r.node][1]) + 30;
    const L = (Math.abs(r.Ry) / Rmax) * 36 + 4;
    if (Math.abs(r.Ry) > 1e-3) {
      out.push(arrow(cx, cy + L, cx, cy + 3, palette.reaction, 6));
      out.push(
        `<text x="${cx}" y="${cy + L + 12}" fill="${palette.reaction}" font-size="10" text-anchor="middle">${escapeText(fmt(r.Ry))}</text>`,
      );
    }
  }

  // node labels
  for (let i = 0; i < req.nodes.length; i++) {
    const [x, y] = req.nodes[i];
    const cx = frame.X(x);
    const cy = frame.Y(y);
    out.push(
      `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${palette.support}"/>`,
      `<text x="${cx + 7}" y="${cy - 8}" fill="${palette.support}" stroke="${palette.bg}" stroke-width="3" paint-order="stroke" font-size="10">${escapeText(`N${i + 1}`)}</text>`,
    );
  }

  // coordinate labels (converted to caller's display unit)
  for (const [x, y] of req.nodes) {
    out.push(
      `<text x="${frame.X(x)}" y="${frame.Y(y) + 26}" fill="${palette.dim}" font-size="9" text-anchor="middle">${escapeText(`${fmt(ux(x))},${fmt(ux(y))}`)}</text>`,
    );
  }

  out.push(
    `<text x="${W - PAD}" y="${20}" fill="${palette.fg}" font-size="10" text-anchor="end" letter-spacing="2">FBD</text>`,
  );

  return svgWrap(W, H, out.join(""), palette);
}

/**
 * Local maxes and mins on a sample series, plus non-trivial endpoints.
 * "Local extremum" = strict 3-point window peak/valley; equality on one
 * side is allowed so flat plateaus and step changes still expose a
 * corner. Values within `valTol` of zero are dropped so the y=0 sweep
 * between lobes doesn't get labeled. Adjacent picks within (xTol, valTol)
 * are deduped — usually the shared-node samples from two adjoining
 * members reading the same value at the same x.
 */
type ExtremumField = "R" | "V" | "M" | "theta" | "delta";
function findExtrema<F extends ExtremumField>(
  samples: { x: number; R: number; V: number; M: number; theta: number; delta: number }[],
  field: F,
): { x: number; R: number; V: number; M: number; theta: number; delta: number }[] {
  if (samples.length === 0) return [];
  const max = Math.max(1e-12, ...samples.map((s) => Math.abs(s[field])));
  const valTol = 0.03 * max;
  const xSpan =
    samples[samples.length - 1].x - samples[0].x || Math.max(1, samples[0].x);
  const xTol = Math.max(1e-9, 0.01 * xSpan);
  const out: typeof samples = [];
  const tryPush = (s: (typeof samples)[number]) => {
    if (Math.abs(s[field]) < valTol) return;
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.x - s.x) < xTol &&
      Math.abs(last[field] - s[field]) < valTol
    )
      return;
    out.push(s);
  };
  tryPush(samples[0]);
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1][field];
    const b = samples[i][field];
    const c = samples[i + 1][field];
    const isMax = b >= a && b >= c && (b > a || b > c);
    const isMin = b <= a && b <= c && (b < a || b < c);
    if (isMax || isMin) tryPush(samples[i]);
  }
  tryPush(samples[samples.length - 1]);
  return out;
}

function renderCurve(
  res: Pick<SolveResponse, "members">,
  X: (x: number) => number,
  stationEnds: number[],
  field: ExtremumField,
  color: string,
  label: string,
  palette: Palette,
  opts: { sagBelow?: boolean; valueScale?: number; unit?: string } = {},
): string {
  const H = 150;
  const yAxis = H / 2;
  const samples = res.members.flatMap((m, memberIdx) => {
    const start = memberIdx === 0 ? 0 : stationEnds[memberIdx - 1];
    return m.samples.map((sample) => ({ ...sample, x: start + sample.s }));
  });
  const max = Math.max(1e-12, ...samples.map((s) => Math.abs(s[field])));
  const sign = opts.sagBelow ? +1 : -1;
  const valueScale = opts.valueScale ?? 1;
  const yOf = (v: number) => yAxis + sign * (v / max) * (H / 2 - 12);
  const path = samples
    .map(
      (s, i) =>
        `${i === 0 ? "M" : "L"} ${X(s.x).toFixed(1)} ${yOf(s[field]).toFixed(1)}`,
    )
    .join(" ");
  const fillPath = samples.length
    ? `M ${X(samples[0].x).toFixed(1)} ${yAxis} ` +
      samples
        .map((s) => `L ${X(s.x).toFixed(1)} ${yOf(s[field]).toFixed(1)}`)
        .join(" ") +
      ` L ${X(samples[samples.length - 1].x).toFixed(1)} ${yAxis} Z`
    : "";
  const extrema = findExtrema(samples, field);
  const labels = extrema
    .map((e) => {
      const labelText = `${fmt(e[field] * valueScale)}${opts.unit ? ` ${opts.unit}` : ""}`;
      const labelY = yOf(e[field]) + (e[field] >= 0 ? -6 : 14);
      return graphValueLabel(X(e.x), labelY, labelText);
    })
    .join("");
  return svgWrap(
    W,
    H,
    `<line x1="${PAD}" y1="${yAxis}" x2="${W - PAD}" y2="${yAxis}" stroke="${palette.dim}" stroke-width="0.8"/>` +
      (samples.length
        ? `<path d="${fillPath}" fill="${color}" fill-opacity="0.15"/><path d="${path}" fill="none" stroke="${color}" stroke-width="1.4"/>`
        : "") +
      `<text x="${W - PAD}" y="${14}" fill="${color}" font-size="10" text-anchor="end" letter-spacing="2">${escapeText(label)}</text>` +
      labels,
    palette,
  );
}

function graphValueLabel(x: number, y: number, text: string): string {
  const width = text.length * 6.4 + 10;
  const height = 16;
  return (
    `<g>` +
    `<rect x="${(x - width / 2).toFixed(1)}" y="${(y - 12).toFixed(1)}" width="${width.toFixed(1)}" height="${height}" fill="#fff" stroke="#111" stroke-opacity="0.22"/>` +
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="#111" font-size="10" font-weight="700" text-anchor="middle">${escapeText(text)}</text>` +
    `</g>`
  );
}

function renderAll(
  fbd: string,
  R: string,
  V: string,
  M: string,
  theta: string,
  delta: string,
  guides: { x: number; y: number }[],
  totalStation: number,
  X: (x: number) => number,
  ux: (xInches: number) => number,
  unitLbl: string,
  palette: Palette,
): string {
  // strip outer <svg> wrappers from each panel and stack them in one big SVG
  const strip = (s: string): string =>
    s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const panels = [
    { svg: fbd, h: 220 },
    { svg: R, h: 150 },
    { svg: V, h: 150 },
    { svg: M, h: 150 },
    { svg: theta, h: 130 },
    { svg: delta, h: 130 },
  ];
  let y = 0;
  const parts: string[] = [];
  const graphBottom = panels.reduce((sum, panel) => sum + panel.h + 8, 0);
  for (const guide of guides) {
    parts.push(
      `<line x1="${guide.x.toFixed(1)}" y1="${guide.y.toFixed(1)}" x2="${guide.x.toFixed(1)}" y2="${graphBottom}" stroke="${palette.dim}" stroke-width="0.45" stroke-dasharray="3 5" stroke-opacity="0.45"/>`,
    );
  }
  for (const p of panels) {
    parts.push(`<g transform="translate(0,${y})">${strip(p.svg)}</g>`);
    y += p.h + 8;
  }
  // x-axis labels at the very bottom — converted to display unit.
  const tickY = y + 10;
  for (const x of [0, totalStation / 2, totalStation]) {
    parts.push(
      `<text x="${X(x)}" y="${tickY}" fill="${palette.dim}" font-size="9" text-anchor="middle">${escapeText(fmt(ux(x)))}</text>`,
    );
  }
  parts.push(
    `<text x="${W - PAD}" y="${tickY}" fill="${palette.dim}" font-size="9" text-anchor="end">l [${unitLbl}]</text>`,
  );
  return svgWrap(W, y + 18, parts.join(""), palette);
}

export type Plotted = Plot;
