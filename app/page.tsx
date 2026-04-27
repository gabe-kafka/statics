"use client";

import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { Diagrams } from "./_components/Diagrams";

type Vec2 = [number, number];

type InputKey =
  | "nodes"
  | "members"
  | "pointLoads"
  | "distLoads"
  | "fixity"
  | "hinges";

type InputSpec = {
  key: InputKey;
  label: string;
  columns: readonly string[];
};

const INPUTS: readonly InputSpec[] = [
  { key: "nodes", label: "NODES", columns: ["x", "y"] },
  { key: "members", label: "MEMBERS", columns: ["i", "j"] },
  { key: "pointLoads", label: "POINT LOADS", columns: ["node", "Fx", "Fy"] },
  { key: "distLoads", label: "DIST LOADS", columns: ["member", "w_i", "w_j"] },
  { key: "fixity", label: "FIXITY", columns: ["node", "Rx", "Ry", "Rm"] },
  { key: "hinges", label: "HINGES", columns: ["node"] },
];

type Fields = Record<InputKey, string>;

function parseRows(s: string): string[][] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l
        .replace(/^\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .map((x) => x.trim()),
    );
}

function serializeRows(rows: string[][]): string {
  return rows.map((r) => `(${r.join(", ")})`).join("\n");
}

function rowsToTSV(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

function tsvToRows(s: string, cols: number): string[][] {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const cells = l.split("\t").map((c) => c.trim());
      while (cells.length < cols) cells.push("");
      return cells.slice(0, cols);
    });
}

const DEFAULTS: Fields = {
  nodes: "(0, 0)\n(15, 0)\n(31, 0)",
  members: "(0, 1)\n(1, 2)",
  pointLoads: "(1, 0, -10)",
  distLoads: "(0, -2.98, -2.98)\n(1, -3.50, -5.64)\n(2, 0, -4.00)",
  fixity: "(0, 1, 1, 0)\n(2, 0, 1, 0)",
  hinges: "",
};

type DesignRow = { id: string; name: string; updatedAt: string };

export default function Home() {
  const { data: session, status } = useSession();
  const signedIn = !!session?.user;
  const email = session?.user?.email ?? "";

  const [designId, setDesignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Fields>(DEFAULTS);
  const [list, setList] = useState<DesignRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<InputKey | null>(null);
  const [E, setE] = useState(29000);
  const [I, setI] = useState(100);
  const autoLoadedRef = useRef(false);

  const nodes = useMemo<Vec2[]>(
    () =>
      parseRows(fields.nodes).map(
        (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as Vec2,
      ),
    [fields.nodes],
  );
  const members = useMemo<[number, number][]>(
    () =>
      parseRows(fields.members).map(
        (r) => [Number(r[0]) || 0, Number(r[1]) || 0] as [number, number],
      ),
    [fields.members],
  );
  const fixityData = useMemo<[number, number, number, number][]>(
    () =>
      parseRows(fields.fixity).map(
        (r) =>
          [
            Number(r[0]) || 0,
            Number(r[1]) || 0,
            Number(r[2]) || 0,
            Number(r[3]) || 0,
          ] as [number, number, number, number],
      ),
    [fields.fixity],
  );
  const pointLoadsData = useMemo<[number, number, number][]>(
    () =>
      parseRows(fields.pointLoads).map(
        (r) =>
          [Number(r[0]) || 0, Number(r[1]) || 0, Number(r[2]) || 0] as [
            number,
            number,
            number,
          ],
      ),
    [fields.pointLoads],
  );
  const distLoadsData = useMemo<[number, number, number][]>(
    () =>
      parseRows(fields.distLoads).map(
        (r) =>
          [Number(r[0]) || 0, Number(r[1]) || 0, Number(r[2]) || 0] as [
            number,
            number,
            number,
          ],
      ),
    [fields.distLoads],
  );

  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const historyRef = useRef<{ past: Fields[]; future: Fields[] }>({
    past: [],
    future: [],
  });
  const lastCommittedRef = useRef<Fields>(fields);
  const commitTimerRef = useRef<number | null>(null);
  const suppressHistoryRef = useRef(false);

  const flushPending = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      if (lastCommittedRef.current !== fieldsRef.current) {
        historyRef.current.past.push(lastCommittedRef.current);
        historyRef.current.future = [];
        lastCommittedRef.current = fieldsRef.current;
      }
    }
  }, []);

  useEffect(() => {
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      lastCommittedRef.current = fields;
      return;
    }
    if (fields === lastCommittedRef.current) return;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }
    const prev = lastCommittedRef.current;
    commitTimerRef.current = window.setTimeout(() => {
      historyRef.current.past.push(prev);
      historyRef.current.future = [];
      lastCommittedRef.current = fieldsRef.current;
      commitTimerRef.current = null;
    }, 400);
  }, [fields]);

  const undo = useCallback(() => {
    flushPending();
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past.pop()!;
    h.future.push(fieldsRef.current);
    lastCommittedRef.current = prev;
    suppressHistoryRef.current = true;
    setFields(prev);
  }, [flushPending]);

  const redo = useCallback(() => {
    flushPending();
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future.pop()!;
    h.past.push(fieldsRef.current);
    lastCommittedRef.current = next;
    suppressHistoryRef.current = true;
    setFields(next);
  }, [flushPending]);


  const refreshList = useCallback(async () => {
    if (!signedIn) {
      setList([]);
      return;
    }
    const r = await fetch("/api/designs");
    if (r.ok) setList(await r.json());
  }, [signedIn]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!signedIn) autoLoadedRef.current = false;
  }, [signedIn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y" && !e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  async function save() {
    if (!signedIn || !name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/designs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: designId, name, ...fields }),
      });
      if (r.ok) {
        const d = (await r.json()) as { id: string };
        setDesignId(d.id);
        await refreshList();
      }
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const r = await fetch(`/api/designs/${id}`);
    if (!r.ok) return;
    const d = (await r.json()) as Fields & { id: string; name: string };
    setDesignId(d.id);
    setName(d.name);
    setFields({
      nodes: d.nodes ?? "",
      members: d.members ?? "",
      pointLoads: d.pointLoads ?? "",
      distLoads: d.distLoads ?? "",
      fixity: d.fixity ?? "",
      hinges: d.hinges ?? "",
    });
  }, []);

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!signedIn || list.length === 0) return;
    autoLoadedRef.current = true;
    load(list[0].id);
  }, [signedIn, list, load]);

  function newDesign() {
    setDesignId(null);
    setName("");
    setFields(DEFAULTS);
  }

  return (
    <main className="relative flex flex-1 flex-col bg-bg">
      {/* Top status bar */}
      <div className="flex h-9 items-stretch border-b border-border text-[10px]">
        <div className="flex items-center gap-2 border-r border-border px-3">
          <Image src="/logo.png" alt="GK" width={90} height={24} priority />
          <span className="font-medium uppercase tracking-[0.12em] text-muted">
            STATICS
          </span>
        </div>

        <div className="flex flex-1 items-center gap-2 px-3">
          <span className="uppercase tracking-[0.08em] text-muted">DESIGN</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="untitled"
            spellCheck={false}
            className="h-6 w-48 border border-border bg-surface px-2 font-mono text-[10px] text-text placeholder:text-dim focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={save}
            disabled={!signedIn || !name.trim() || busy}
            title={!signedIn ? "sign in to save" : undefined}
            className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent disabled:opacity-40"
          >
            {busy ? "…" : designId ? "SAVE" : "SAVE NEW"}
          </button>
          {designId && (
            <button
              type="button"
              onClick={newDesign}
              className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
            >
              NEW
            </button>
          )}
          {signedIn && list.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.selectedIndex = 0;
                load(v);
              }}
              className="h-6 border border-border bg-surface px-1 font-mono text-[10px] text-text focus:border-accent focus:outline-none"
            >
              <option value="">LOAD…</option>
              {list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <a
          href="/docs"
          className="flex items-center border-l border-border px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:text-text"
        >
          API
        </a>

        <div className="flex items-center gap-2 border-l border-border px-3">
          {status === "loading" ? (
            <span className="uppercase text-dim">…</span>
          ) : signedIn ? (
            <>
              <span className="text-muted">{email}</span>
              <button
                type="button"
                onClick={() => signOut()}
                className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
              >
                SIGN OUT
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => signIn("google")}
              className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
            >
              SIGN IN
            </button>
          )}
        </div>
      </div>

      {/* Body: diagrams + right sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 items-start justify-center overflow-auto p-4">
          <div className="w-full max-w-[920px]">
            <Diagrams
              nodes={nodes}
              members={members}
              pointLoads={pointLoadsData}
              distLoads={distLoadsData}
              fixity={fixityData}
              E={E}
              I={I}
              A={10}
              onChangeE={setE}
              onChangeI={setI}
            />
          </div>
        </div>

        <aside className="flex w-44 flex-col overflow-y-auto border-l border-border">
          {INPUTS.map((spec) => {
            const count = parseRows(fields[spec.key]).length;
            return (
              <button
                key={spec.key}
                type="button"
                onClick={() => setOpenKey(spec.key)}
                className="flex items-center justify-between border-b border-border px-2 py-1.5 text-left hover:bg-surface"
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  {spec.label}
                </span>
                <span className="font-mono text-[10px] text-dim">{count}</span>
              </button>
            );
          })}
        </aside>
      </div>

      {openKey && (
        <TableModal
          spec={INPUTS.find((i) => i.key === openKey)!}
          value={fields[openKey]}
          onChange={(v) =>
            setFields((f) => ({ ...f, [openKey]: v }))
          }
          onClose={() => setOpenKey(null)}
        />
      )}
    </main>
  );
}

function TableModal({
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
        ? Array.from({ length: cols }, (_, j) => (j === ci ? v : r[j] ?? ""))
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
        const sub = rows.slice(r1, r2 + 1).map((r) => r.slice(c1, c2 + 1));
        text = rowsToTSV(sub);
        label = "COPIED RANGE";
      } else {
        text = rowsToTSV(rows);
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
      onChange(serializeRows(tsvToRows(text, cols)));
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
        if (targetCi < cols) next[targetRi][targetCi] = grid[r][c].trim();
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
              {rows.length} × {cols}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="h-6 w-6 border border-border bg-surface font-mono text-[12px] text-muted hover:border-accent hover:text-text"
              title="close (esc)"
            >
              ×
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
                    value={row[ci] ?? ""}
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
                  ×
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
