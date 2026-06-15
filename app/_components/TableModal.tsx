"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { InputSpec } from "@/lib/design-fields";
import {
  defaultRowForInput,
  parseRows,
  rowsToTSV,
  serializeRows,
  tsvToRows,
} from "@/lib/design-fields";

export function TableModal({
  spec,
  value,
  loadCaseOptions = [],
  onChange,
  onClose,
}: {
  spec: InputSpec;
  value: string;
  loadCaseOptions?: string[];
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
    focusCell(gridRef.current, ri, ci);
  });

  const inSel = (ri: number, ci: number) => {
    if (!sel) return false;
    const [r1, r2] = [Math.min(sel.a[0], sel.b[0]), Math.max(sel.a[0], sel.b[0])];
    const [c1, c2] = [Math.min(sel.a[1], sel.b[1]), Math.max(sel.a[1], sel.b[1])];
    return ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2;
  };
  const cellStyle = (ri: number, ci: number) =>
    inSel(ri, ci)
      ? {
          backgroundColor:
            "color-mix(in srgb, var(--accent) 25%, var(--surface))",
        }
      : undefined;

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

  const addRows = (count: number) => {
    const newRows = Array.from({ length: count }, (_, i) =>
      defaultRowForModal(spec, rows.length + i, loadCaseOptions),
    );
    onChange(serializeRows([...rows, ...newRows]));
  };

  const addRow = () => {
    addRows(1);
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
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
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
      focusCell(gridRef.current, targetRi, ci);
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
      <div
        className="flex max-h-[85vh] flex-col border border-border bg-bg shadow-xl"
        style={{ width: modalWidth(spec) }}
      >
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
              gridTemplateColumns: gridTemplateColumns(spec),
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
                {spec.columns.map((_, ci) =>
                  isLoadCombinationCaseCell(spec, ci) ? (
                    <select
                      key={ci}
                      data-cell={`${ri}-${ci}`}
                      value={row[ci] ?? ""}
                      aria-label={`${spec.columns[ci]} row ${ri + 1}`}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      onKeyDown={(e) => onCellKeyDown(e, ri, ci)}
                      onMouseDown={() => onCellDown(ri, ci)}
                      onMouseEnter={(e) => onCellEnter(e, ri, ci)}
                      style={cellStyle(ri, ci)}
                      className="w-full min-w-0 bg-surface px-1 py-1 font-mono text-[11px] text-text focus:bg-bg focus:outline-1 focus:outline-accent"
                    >
                      {caseOptionsForCell(loadCaseOptions, row[ci] ?? "").map(
                        (option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ),
                      )}
                    </select>
                  ) : isFixityCheckboxCell(spec, ci) ? (
                    <label
                      key={ci}
                      className="flex min-h-[28px] items-center justify-center bg-surface focus-within:bg-bg focus-within:outline-1 focus-within:outline-accent"
                      onMouseDown={() => onCellDown(ri, ci)}
                      onMouseEnter={(e) => onCellEnter(e, ri, ci)}
                      style={cellStyle(ri, ci)}
                    >
                      <input
                        type="checkbox"
                        data-cell={`${ri}-${ci}`}
                        checked={isTruthyCell(row[ci] ?? "")}
                        aria-label={`${spec.columns[ci]} row ${ri + 1}`}
                        onChange={(e) =>
                          setCell(ri, ci, e.target.checked ? "1" : "0")
                        }
                        onPaste={(e) => onCellPaste(e, ri, ci)}
                        onKeyDown={(e) => onCellKeyDown(e, ri, ci)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </label>
                  ) : (
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
                      style={cellStyle(ri, ci)}
                      className="w-full min-w-0 bg-surface px-1.5 py-1 font-mono text-[11px] text-text focus:bg-bg focus:outline-1 focus:outline-accent"
                    />
                  ),
                )}
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
            {spec.key === "loadCombinations" && (
              <button
                type="button"
                onClick={() => addRows(5)}
                className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text"
              >
                +5 ROWS
              </button>
            )}
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

function isFixityCheckboxCell(spec: InputSpec, ci: number): boolean {
  return spec.key === "fixity" && ci >= 1 && ci <= 3;
}

function isLoadCombinationCaseCell(spec: InputSpec, ci: number): boolean {
  return spec.key === "loadCombinations" && ci === 1;
}

function isTruthyCell(value: string): boolean {
  const n = Number(value.trim());
  return Number.isFinite(n) && n !== 0;
}

function caseOptionsForCell(options: string[], value: string): string[] {
  const cleaned: string[] = [];
  for (const option of options) {
    const trimmed = option.trim();
    if (trimmed && !cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  const current = value.trim();
  if (!current) return ["", ...(cleaned.length > 0 ? cleaned : ["D", "L"])];
  if (current && !cleaned.some((option) => option === current)) {
    cleaned.unshift(current);
  }
  return cleaned.length > 0 ? cleaned : ["D", "L"];
}

function defaultRowForModal(
  spec: InputSpec,
  rowIndex: number,
  loadCaseOptions: string[],
): string[] {
  const row = defaultRowForInput(spec, rowIndex);
  if (spec.key !== "loadCombinations") return row;

  const cases = caseOptionsForCell(loadCaseOptions, "").filter(Boolean);
  if (cases.length === 0 || cases.includes(row[1])) return row;
  return [row[0], cases[rowIndex % cases.length], row[2]];
}

function focusCell(
  grid: HTMLDivElement | null,
  ri: number,
  ci: number,
): void {
  const el = grid?.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-cell="${ri}-${ci}"]`,
  );
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement && el.type !== "checkbox") el.select();
}

function modalWidth(spec: InputSpec): string {
  if (spec.key === "loadCombinations") return "min(620px, 95vw)";
  return "min(560px, 95vw)";
}

function gridTemplateColumns(spec: InputSpec): string {
  if (spec.key === "loadCombinations") {
    return "minmax(220px, 1fr) minmax(48px, 56px) minmax(54px, 64px) 20px";
  }
  return `repeat(${spec.columns.length}, minmax(60px, 1fr)) 20px`;
}
