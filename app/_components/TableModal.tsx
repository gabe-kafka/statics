"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { InputSpec } from "@/lib/design-fields";
import {
  parseRows,
  rowsToTSV,
  serializeRows,
  tsvToRows,
} from "@/lib/design-fields";

export function TableModal({
  spec,
  value,
  onChange,
  onClose,
}: {
  spec: InputSpec;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const rows = parseRows(value);
  const cols = spec.columns.length;
  const displayRows = rows.map((row) =>
    Array.from({ length: cols }, (_, ci) =>
      toDisplayCell(spec, ci, row[ci] ?? ""),
    ),
  );
  const [status, setStatus] = useState<string>("");
  const [sel, setSel] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const anchorRef = useRef<[number, number] | null>(null);
  const pendingFocusRef = useRef<[number, number] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onUp = () => {
      anchorRef.current = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onClose]);

  useEffect(() => {
    if (!pendingFocusRef.current || !gridRef.current) return;
    const [ri, ci] = pendingFocusRef.current;
    pendingFocusRef.current = null;
    const el = gridRef.current.querySelector<HTMLInputElement>(
      `[data-cell="${ri}-${ci}"]`,
    );
    if (el) {
      el.focus();
      el.select();
    }
  });

  const inSel = (ri: number, ci: number) => {
    if (!sel) return false;
    const [r1, r2] = [Math.min(sel.a[0], sel.b[0]), Math.max(sel.a[0], sel.b[0])];
    const [c1, c2] = [Math.min(sel.a[1], sel.b[1]), Math.max(sel.a[1], sel.b[1])];
    return ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2;
  };

  const onCellDown = (ri: number, ci: number) => {
    anchorRef.current = [ri, ci];
    setSel(null);
  };

  const onCellEnter = (e: React.MouseEvent, ri: number, ci: number) => {
    if (!anchorRef.current) return;
    if (!(e.buttons & 1)) {
      anchorRef.current = null;
      return;
    }
    setSel({ a: anchorRef.current, b: [ri, ci] });
    window.getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
  };

  const setCell = (ri: number, ci: number, v: string) => {
    const next = rows.map((r, i) =>
      i === ri
        ? Array.from({ length: cols }, (_, j) =>
            j === ci ? fromDisplayCell(spec, ci, v) : r[j] ?? "",
          )
        : r,
    );
    onChange(serializeRows(next));
  };

  const addRow = () => {
    onChange(serializeRows([...rows, spec.columns.map(() => "0")]));
  };

  const delRow = (ri: number) => {
    onChange(serializeRows(rows.filter((_, i) => i !== ri)));
  };

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(""), 1500);
  };

  const copyTable = async () => {
    try {
      let text: string;
      let label: string;
      if (sel) {
        const [r1, r2] = [Math.min(sel.a[0], sel.b[0]), Math.max(sel.a[0], sel.b[0])];
        const [c1, c2] = [Math.min(sel.a[1], sel.b[1]), Math.max(sel.a[1], sel.b[1])];
        const sub = displayRows.slice(r1, r2 + 1).map((r) => r.slice(c1, c2 + 1));
        text = rowsToTSV(sub);
        label = "COPIED RANGE";
      } else {
        text = rowsToTSV(displayRows);
        label = "COPIED";
      }
      await navigator.clipboard.writeText(text);
      flash(label);
    } catch {
      flash("COPY FAILED");
    }
  };

  const onCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    ri: number,
    ci: number,
  ) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const targetRi = ri + 1;
    if (targetRi >= rows.length) {
      pendingFocusRef.current = [targetRi, ci];
      addRow();
    } else {
      const el = gridRef.current?.querySelector<HTMLInputElement>(
        `[data-cell="${targetRi}-${ci}"]`,
      );
      if (el) {
        el.focus();
        el.select();
      }
    }
  };

  const pasteReplace = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      onChange(serializeRows(rowsFromDisplay(spec, tsvToRows(text, cols))));
      flash("PASTED");
    } catch {
      flash("PASTE FAILED");
    }
  };

  const onCellPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    ri: number,
    ci: number,
  ) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const grid = text
      .replace(/\r\n?/g, "\n")
      .replace(/\n+$/, "")
      .split("\n")
      .map((l) => l.split("\t"));
    const next = rows.map((r) => r.slice());
    for (let r = 0; r < grid.length; r++) {
      const targetRi = ri + r;
      if (!next[targetRi]) next[targetRi] = spec.columns.map(() => "");
      for (let c = 0; c < grid[r].length; c++) {
        const targetCi = ci + c;
        if (targetCi < cols) {
          next[targetRi][targetCi] = fromDisplayCell(
            spec,
            targetCi,
            grid[r][c].trim(),
          );
        }
      }
      while (next[targetRi].length < cols) next[targetRi].push("");
    }
    onChange(serializeRows(next));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[min(560px,95vw)] flex-col border border-border bg-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text">
            {spec.label}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-dim">
              {rows.length} x {cols}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="h-6 w-6 border border-border bg-surface font-mono text-[12px] text-muted hover:border-accent hover:text-text"
              title="close (esc)"
            >
              x
            </button>
          </div>
        </div>

        <div className="overflow-auto p-3">
          <div
            ref={gridRef}
            className="grid gap-px bg-border select-none"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(60px, 1fr)) 20px`,
            }}
          >
            {spec.columns.map((c) => (
              <div
                key={c}
                className="bg-bg px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-dim"
              >
                {c}
              </div>
            ))}
            <div className="bg-bg" />
            {rows.map((row, ri) => (
              <Fragment key={ri}>
                {spec.columns.map((_, ci) => (
                  <input
                    key={ci}
                    data-cell={`${ri}-${ci}`}
                    value={toDisplayCell(spec, ci, row[ci] ?? "")}
                    spellCheck={false}
                    onChange={(e) => setCell(ri, ci, e.target.value)}
                    onPaste={(e) => onCellPaste(e, ri, ci)}
                    onKeyDown={(e) => onCellKeyDown(e, ri, ci)}
                    onMouseDown={() => onCellDown(ri, ci)}
                    onMouseEnter={(e) => onCellEnter(e, ri, ci)}
                    style={
                      inSel(ri, ci)
                        ? {
                            backgroundColor:
                              "color-mix(in srgb, var(--accent) 25%, var(--surface))",
                          }
                        : undefined
                    }
                    className="w-full min-w-0 bg-surface px-1.5 py-1 font-mono text-[11px] text-text focus:bg-bg focus:outline-1 focus:outline-accent"
                  />
                ))}
                <button
                  type="button"
                  onClick={() => delRow(ri)}
                  className="bg-surface font-mono text-[11px] text-dim hover:text-accent"
                  title="delete row"
                >
                  x
                </button>
              </Fragment>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
            {status}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addRow}
              className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text"
            >
              + ROW
            </button>
            <button
              type="button"
              onClick={copyTable}
              title="copy TSV to clipboard (excel)"
              className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text"
            >
              COPY
            </button>
            <button
              type="button"
              onClick={pasteReplace}
              title="replace with clipboard TSV (excel)"
              className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text"
            >
              PASTE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function rowsFromDisplay(spec: InputSpec, rows: string[][]): string[][] {
  return rows.map((row) =>
    row.map((cell, ci) => fromDisplayCell(spec, ci, cell)),
  );
}

function toDisplayCell(spec: InputSpec, ci: number, value: string): string {
  return shiftReferenceCell(spec, ci, value, 1);
}

function fromDisplayCell(spec: InputSpec, ci: number, value: string): string {
  return shiftReferenceCell(spec, ci, value, -1);
}

function shiftReferenceCell(
  spec: InputSpec,
  ci: number,
  value: string,
  delta: number,
): string {
  if (!isNodeReferenceCell(spec, ci)) return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return value;
  return String(n + delta);
}

function isNodeReferenceCell(spec: InputSpec, ci: number): boolean {
  if (spec.key === "members") return ci === 0 || ci === 1;
  if (
    spec.key === "pointLoads" ||
    spec.key === "fixity" ||
    spec.key === "pointSprings"
  )
    return ci === 0;
  return false;
}
