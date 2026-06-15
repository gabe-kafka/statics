"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Diagrams } from "./_components/Diagrams";
import { ExampleGallery } from "./_components/ExampleGallery";
import { TableModal } from "./_components/TableModal";
import { TopBar, type DesignRow } from "./_components/TopBar";
import {
  DEFAULT_FIELDS,
  INPUTS,
  fieldsFromDesign,
  parseFields,
  parseRows,
  type Fields,
  type InputKey,
} from "@/lib/design-fields";
import { GALLERY_EXAMPLES, type GalleryExample } from "@/lib/examples";

export default function Home() {
  const { data: session, status } = useSession();
  const signedIn = !!session?.user;
  const email = session?.user?.email ?? "";

  const [designId, setDesignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Fields>(DEFAULT_FIELDS);
  const [list, setList] = useState<DesignRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<InputKey | null>(null);
  const [E, setE] = useState(29000);
  const [I, setI] = useState(100);
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  const autoLoadedRef = useRef(false);

  const {
    nodes,
    members,
    fixity,
    pointLoads,
    distLoads,
    pointSprings,
    uniformSprings,
    hinges,
  } = useMemo(() => parseFields(fields), [fields]);

  const fieldsRef = useRef(fields);
  const historyRef = useRef<{ past: Fields[]; future: Fields[] }>({
    past: [],
    future: [],
  });
  const lastCommittedRef = useRef<Fields>(fields);
  const commitTimerRef = useRef<number | null>(null);
  const suppressHistoryRef = useRef(false);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

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
    // Synchronizes saved designs from the authenticated API session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setFields(fieldsFromDesign(d));
  }, []);

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!signedIn || list.length === 0) return;
    autoLoadedRef.current = true;
    // Auto-loads persisted user state after the design list arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(list[0].id);
  }, [signedIn, list, load]);

  function newDesign() {
    setDesignId(null);
    setName("");
    setFields(DEFAULT_FIELDS);
    setActiveExampleId(null);
  }

  function loadExample(example: GalleryExample) {
    setDesignId(null);
    setName(example.title);
    setFields(example.fields);
    setE(example.E);
    setI(example.I);
    setActiveExampleId(example.id);
  }

  return (
    <main className="relative flex flex-1 flex-col bg-bg">
      <TopBar
        name={name}
        onNameChange={setName}
        busy={busy}
        designId={designId}
        signedIn={signedIn}
        authStatus={status}
        email={email}
        designs={list}
        onSave={save}
        onNew={newDesign}
        onLoad={load}
      />

      <ExampleGallery
        examples={GALLERY_EXAMPLES}
        activeId={activeExampleId}
        onLoad={loadExample}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 items-start justify-center overflow-auto p-4">
          <div className="w-full max-w-[920px]">
            <Diagrams
              nodes={nodes}
              members={members}
              pointLoads={pointLoads}
              distLoads={distLoads}
              pointSprings={pointSprings}
              uniformSprings={uniformSprings}
              fixity={fixity}
              hinges={hinges}
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
          onChange={(v) => setFields((f) => ({ ...f, [openKey]: v }))}
          onClose={() => setOpenKey(null)}
        />
      )}
    </main>
  );
}
