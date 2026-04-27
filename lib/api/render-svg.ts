// Pure server-side SVG generator. No React, no browser APIs. Mirrors the
// notebook palette used by the human-facing Diagrams component but is its
// own implementation so the API can return SVG strings without spinning up
// React on the server.

import type {
  MemberOut,
  ReactionOut,
  SolveResponse,
  SvgOut,
} from "./types";
import type { SolveRequest } from "./types";

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

const W = 880;
const PAD = 48;

type Plot = "fbd" | "V" | "M" | "theta" | "delta";

export function renderSvg(
  req: SolveRequest,
  res: Pick<SolveResponse, "members" | "reactions">,
): SvgOut {
  const xs = req.nodes.map((n) => n[0]);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const xspan = Math.max(xmax - xmin, 1);
  const X = (x: number) => PAD + ((x - xmin) / xspan) * (W - 2 * PAD);

  const fbd = renderFbd(req, res, X, xs);
  const V = renderCurve(res, X, "V", PALETTE.shear, "V(x)");
  const M = renderCurve(res, X, "M", PALETTE.moment, "M(x)", { sagBelow: true });
  const theta = renderCurve(res, X, "theta", PALETTE.theta, "θ(x)");
  const delta = renderCurve(res, X, "delta", PALETTE.delta, "Δ(x)");
  const all = renderAll(fbd, V, M, theta, delta, xs, X);

  return { fbd, V, M, theta, delta, all };
}

function svgWrap(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="background:${PALETTE.bg};font-family:ui-monospace,Menlo,monospace;display:block">${body}</svg>`;
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

function renderFbd(
  req: SolveRequest,
  res: Pick<SolveResponse, "reactions">,
  X: (x: number) => number,
  xs: number[],
): string {
  const H = 200;
  const yBeam = H * 0.55;
  const out: string[] = [];

  // distributed loads
  for (let k = 0; k < (req.distLoads ?? []).length; k++) {
    const dl = req.distLoads![k];
    const m = req.members[dl.member];
    if (!m) continue;
    const a = req.nodes[m.i];
    const b = req.nodes[m.j];
    const xa = X(a[0]);
    const xb = X(b[0]);
    const wMax = Math.max(Math.abs(dl.wi), Math.abs(dl.wj), 1e-6);
    const SCALE = Math.min(55, 30 * (1 + wMax / 6));
    const ha = (Math.abs(dl.wi) / wMax) * SCALE;
    const hb = (Math.abs(dl.wj) / wMax) * SCALE;
    const ya = yBeam - ha - 2;
    const yb = yBeam - hb - 2;
    out.push(
      `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${PALETTE.load}" stroke-width="1.4"/>`,
      `<line x1="${xa}" y1="${ya}" x2="${xa}" y2="${yBeam - 2}" stroke="${PALETTE.load}" stroke-width="1.2"/>`,
      `<line x1="${xb}" y1="${yb}" x2="${xb}" y2="${yBeam - 2}" stroke="${PALETTE.load}" stroke-width="1.2"/>`,
    );
    const N = Math.max(3, Math.round((xb - xa) / 24));
    for (let n = 1; n <= N - 1; n++) {
      const t = n / N;
      const xi = xa + t * (xb - xa);
      const yi = ya + t * (yb - ya);
      out.push(arrow(xi, yi, xi, yBeam - 3, PALETTE.load, 4));
    }
    const midX = (xa + xb) / 2;
    const midY = Math.min(ya, yb) - 6;
    const lbl =
      Math.abs(dl.wi - dl.wj) < 1e-9
        ? fmt(dl.wi)
        : `${fmt(dl.wi)} → ${fmt(dl.wj)}`;
    out.push(
      `<text x="${midX}" y="${midY}" fill="${PALETTE.load}" font-size="10" text-anchor="middle">${escapeText(lbl)}</text>`,
    );
  }

  // point loads
  for (const pl of req.pointLoads ?? []) {
    if (!req.nodes[pl.node]) continue;
    if (pl.Fx === 0 && pl.Fy === 0) continue;
    const cx = X(req.nodes[pl.node][0]);
    const cy = yBeam;
    const L = 40;
    if (pl.Fy !== 0) {
      const down = pl.Fy < 0;
      const tipY = down ? cy - 3 : cy + 3;
      const tailY = down ? tipY - L : tipY + L;
      out.push(arrow(cx, tailY, cx, tipY, PALETTE.load, 6));
      out.push(
        `<text x="${cx + 6}" y="${tailY + 10}" fill="${PALETTE.load}" font-size="10">${escapeText(fmt(Math.abs(pl.Fy)))}</text>`,
      );
    }
  }

  // beam
  for (const m of req.members) {
    const a = req.nodes[m.i];
    const b = req.nodes[m.j];
    out.push(
      `<line x1="${X(a[0])}" y1="${yBeam}" x2="${X(b[0])}" y2="${yBeam}" stroke="${PALETTE.beam}" stroke-width="2.5" stroke-linecap="round"/>`,
    );
  }

  // supports
  for (const sup of req.supports) {
    if (!req.nodes[sup.node]) continue;
    const cx = X(req.nodes[sup.node][0]);
    const cy = yBeam;
    if (sup.Rx && sup.Ry && sup.Rm) {
      out.push(
        `<rect x="${cx - 12}" y="${cy}" width="24" height="10" fill="${PALETTE.support}" fill-opacity="0.35" stroke="${PALETTE.support}"/>`,
      );
    } else if (sup.Rx && sup.Ry) {
      out.push(
        `<polygon points="${cx},${cy} ${cx - 10},${cy + 16} ${cx + 10},${cy + 16}" fill="${PALETTE.support}" stroke="${PALETTE.support}"/>`,
        `<line x1="${cx - 14}" y1="${cy + 16}" x2="${cx + 14}" y2="${cy + 16}" stroke="${PALETTE.support}" stroke-width="1.2"/>`,
      );
    } else if (sup.Ry) {
      out.push(
        `<circle cx="${cx}" cy="${cy + 8}" r="6" fill="${PALETTE.support}" stroke="${PALETTE.support}"/>`,
        `<line x1="${cx - 14}" y1="${cy + 16}" x2="${cx + 14}" y2="${cy + 16}" stroke="${PALETTE.support}" stroke-width="1.2"/>`,
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
    const cx = X(req.nodes[r.node][0]);
    const cy = yBeam + 30;
    const L = (Math.abs(r.Ry) / Rmax) * 36 + 4;
    if (Math.abs(r.Ry) > 1e-3) {
      out.push(arrow(cx, cy + L, cx, cy + 3, PALETTE.reaction, 6));
      out.push(
        `<text x="${cx}" y="${cy + L + 12}" fill="${PALETTE.reaction}" font-size="10" text-anchor="middle">${escapeText(fmt(r.Ry))}</text>`,
      );
    }
  }

  // node ticks
  for (const x of xs) {
    out.push(
      `<text x="${X(x)}" y="${H - 4}" fill="${PALETTE.dim}" font-size="9" text-anchor="middle">${escapeText(fmt(x))}</text>`,
    );
  }

  out.push(
    `<text x="${W - PAD}" y="${20}" fill="${PALETTE.fg}" font-size="10" text-anchor="end" letter-spacing="2">FBD</text>`,
  );

  return svgWrap(W, H, out.join(""));
}

function renderCurve(
  res: Pick<SolveResponse, "members">,
  X: (x: number) => number,
  field: "V" | "M" | "theta" | "delta",
  color: string,
  label: string,
  opts: { sagBelow?: boolean } = {},
): string {
  const H = 150;
  const yAxis = H / 2;
  const samples = res.members.flatMap((m) => m.samples);
  const max = Math.max(1e-12, ...samples.map((s) => Math.abs(s[field])));
  const sign = opts.sagBelow ? +1 : -1;
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
  const peak = samples.reduce(
    (a, b) => (Math.abs(b[field]) > Math.abs(a[field]) ? b : a),
    samples[0] ?? ({ x: 0, V: 0, M: 0, theta: 0, delta: 0, s: 0 } as never),
  );
  return svgWrap(
    W,
    H,
    `<line x1="${PAD}" y1="${yAxis}" x2="${W - PAD}" y2="${yAxis}" stroke="${PALETTE.dim}" stroke-width="0.8"/>` +
      (samples.length
        ? `<path d="${fillPath}" fill="${color}" fill-opacity="0.15"/><path d="${path}" fill="none" stroke="${color}" stroke-width="1.4"/>`
        : "") +
      `<text x="${W - PAD}" y="${14}" fill="${color}" font-size="10" text-anchor="end" letter-spacing="2">${escapeText(label)}</text>` +
      (samples.length
        ? `<text x="${X(peak.x)}" y="${(yOf(peak[field]) - 4).toFixed(1)}" fill="${color}" font-size="9" text-anchor="middle">${escapeText(fmt(peak[field]))}</text>`
        : ""),
  );
}

function renderAll(
  fbd: string,
  V: string,
  M: string,
  theta: string,
  delta: string,
  xs: number[],
  X: (x: number) => number,
): string {
  // strip outer <svg> wrappers from each panel and stack them in one big SVG
  const strip = (s: string): string =>
    s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const panels = [
    { svg: fbd, h: 200 },
    { svg: V, h: 150 },
    { svg: M, h: 150 },
    { svg: theta, h: 130 },
    { svg: delta, h: 130 },
  ];
  let y = 0;
  const parts: string[] = [];
  for (const p of panels) {
    parts.push(`<g transform="translate(0,${y})">${strip(p.svg)}</g>`);
    y += p.h + 8;
  }
  // x-axis labels at the very bottom
  const tickY = y + 10;
  for (const x of xs) {
    parts.push(
      `<text x="${X(x)}" y="${tickY}" fill="${PALETTE.dim}" font-size="9" text-anchor="middle">${escapeText(fmt(x))}</text>`,
    );
  }
  return svgWrap(W, y + 18, parts.join(""));
}

export type Plotted = Plot;
