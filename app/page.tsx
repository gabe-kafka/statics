"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AiDesignChat } from "./_components/AiDesignChat";
import { Diagrams } from "./_components/Diagrams";
import { ExampleGallery } from "./_components/ExampleGallery";
import { TableModal } from "./_components/TableModal";
import {
  TopBar,
  type DesignRow,
  type SaveStatus,
} from "./_components/TopBar";
import {
  DEFAULT_FIELDS,
  INPUTS,
  authoringRowCount,
  fieldsFromDesign,
  parseFields,
  parseRows,
  type Fields,
  type InputKey,
} from "@/lib/design-fields";
import { GALLERY_EXAMPLES, type GalleryExample } from "@/lib/examples";

const AUTOSAVE_INTERVAL_MS = 10000;

export default function Home() {
  const { data: session, status } = useSession();
  const signedIn = !!session?.user;
  const email = session?.user?.email ?? "";
  const userKey =
    (session?.user as { id?: string } | undefined)?.id ?? email;

  const [designId, setDesignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Fields>(DEFAULT_FIELDS);
  const [list, setList] = useState<DesignRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [openKey, setOpenKey] = useState<InputKey | null>(null);
  const [E, setE] = useState(29000);
  const [I, setI] = useState(100);
  const [aiApiKeyState, setAiApiKeyState] = useState({ owner: "", value: "" });
  const [hasSavedAiApiKey, setHasSavedAiApiKey] = useState(false);
  const [aiKeyBusy, setAiKeyBusy] = useState(false);
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  const autoLoadedRef = useRef(false);
  const aiApiKey =
    signedIn && aiApiKeyState.owner === userKey ? aiApiKeyState.value : "";

  const {
    nodes,
    members,
    loadCases,
    loadCombinations,
    fixity,
    pointLoads,
    distLoads,
    pointSprings,
    uniformSprings,
    hinges,
  } = useMemo(() => parseFields(fields), [fields]);
  const loadCaseOptions = useMemo(() => {
    const ids = parseRows(fields.loadCases)
      .map((row) => row[0]?.trim())
      .filter((id): id is string => !!id);
    return ids.length > 0 ? ids : ["D", "L"];
  }, [fields.loadCases]);

  const fieldsRef = useRef(fields);
  const draftRef = useRef({ designId, name, fields });
  const savedSnapshotRef = useRef(designDraftSnapshot(name, fields));
  const saveInFlightRef = useRef(false);
  const historyRef = useRef<{ past: Fields[]; future: Fields[] }>({
    past: [],
    future: [],
  });
  const lastCommittedRef = useRef<Fields>(fields);
  const commitTimerRef = useRef<number | null>(null);
  const suppressHistoryRef = useRef(false);

  useEffect(() => {
    fieldsRef.current = fields;
    draftRef.current = { designId, name, fields };
  }, [designId, fields, name]);

  useEffect(() => {
    if (!signedIn) {
      savedSnapshotRef.current = designDraftSnapshot(name, fields);
      // Synchronizes UI save status with auth/session state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaveStatus("idle");
      return;
    }

    const latestSnapshot = designDraftSnapshot(name, fields);
    if (latestSnapshot === savedSnapshotRef.current) {
      // Synchronizes UI save status with the latest draft snapshot.
      setSaveStatus((current) =>
        current === "dirty" || current === "error" ? "saved" : current,
      );
      return;
    }

    // Synchronizes UI save status with local draft edits.
    setSaveStatus((current) => (current === "saving" ? current : "dirty"));
  }, [fields, name, signedIn]);

  const refreshList = useCallback(async () => {
    if (!signedIn) {
      setList([]);
      return;
    }
    const r = await fetch("/api/designs");
    if (r.ok) setList(await r.json());
  }, [signedIn]);

  const saveCurrentDesign = useCallback(
    async ({ manual = false }: { manual?: boolean } = {}) => {
      if (!signedIn || saveInFlightRef.current) return false;

      const draft = draftRef.current;
      const snapshot = designDraftSnapshot(draft.name, draft.fields);
      if (!manual && snapshot === savedSnapshotRef.current) return true;

      saveInFlightRef.current = true;
      if (manual) setBusy(true);
      setSaveStatus("saving");
      try {
        const r = await fetch("/api/designs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: draft.designId,
            name: normalizedDesignName(draft.name),
            ...draft.fields,
          }),
        });
        const d = (await r.json()) as { id?: string; error?: string };
        if (!r.ok || !d.id) {
          throw new Error(d.error ?? "save failed");
        }

        setDesignId(d.id);
        draftRef.current = { ...draftRef.current, designId: d.id };
        savedSnapshotRef.current = snapshot;
        const latest = draftRef.current;
        const latestSnapshot = designDraftSnapshot(latest.name, latest.fields);
        setSaveStatus(latestSnapshot === snapshot ? "saved" : "dirty");
        void refreshList();
        return true;
      } catch {
        setSaveStatus("error");
        return false;
      } finally {
        saveInFlightRef.current = false;
        if (manual) setBusy(false);
      }
    },
    [refreshList, signedIn],
  );

  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(() => {
      void saveCurrentDesign();
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [saveCurrentDesign, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void saveCurrentDesign();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [saveCurrentDesign, signedIn]);

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

  useEffect(() => {
    // Synchronizes saved designs from the authenticated API session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshList();
  }, [refreshList]);

  const refreshAiKeyStatus = useCallback(async () => {
    if (!signedIn) {
      setHasSavedAiApiKey(false);
      return;
    }
    const r = await fetch("/api/ai/key", { cache: "no-store" });
    if (r.ok) {
      const data = (await r.json()) as { hasKey?: boolean };
      setHasSavedAiApiKey(!!data.hasKey);
    }
  }, [signedIn]);

  useEffect(() => {
    // Synchronizes saved BYOK status without exposing the saved key.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAiKeyStatus();
  }, [refreshAiKeyStatus]);

  useEffect(() => {
    if (!signedIn) autoLoadedRef.current = false;
  }, [signedIn]);

  const setCurrentAiApiKey = useCallback(
    (value: string) => setAiApiKeyState({ owner: userKey, value }),
    [userKey],
  );

  const saveAiApiKey = useCallback(async () => {
    const apiKey = aiApiKey.trim();
    if (!signedIn || !apiKey || aiKeyBusy) return;
    setAiKeyBusy(true);
    try {
      const r = await fetch("/api/ai/key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey }),
      });
      const data = (await r.json()) as { hasKey?: boolean; message?: string };
      if (!r.ok) {
        window.alert(data.message ?? "Could not save AI API key.");
        return;
      }
      setHasSavedAiApiKey(!!data.hasKey);
      setCurrentAiApiKey("");
    } finally {
      setAiKeyBusy(false);
    }
  }, [aiApiKey, aiKeyBusy, setCurrentAiApiKey, signedIn]);

  const deleteSavedAiApiKey = useCallback(async () => {
    if (!signedIn || aiKeyBusy) return;
    setAiKeyBusy(true);
    try {
      const r = await fetch("/api/ai/key", { method: "DELETE" });
      const data = (await r.json()) as { hasKey?: boolean; message?: string };
      if (!r.ok) {
        window.alert(data.message ?? "Could not delete AI API key.");
        return;
      }
      setHasSavedAiApiKey(!!data.hasKey);
      setCurrentAiApiKey("");
    } finally {
      setAiKeyBusy(false);
    }
  }, [aiKeyBusy, setCurrentAiApiKey, signedIn]);

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

  function save() {
    void saveCurrentDesign({ manual: true });
  }

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const r = await fetch(`/api/designs/${id}`);
    if (!r.ok) return;
    const d = (await r.json()) as Fields & { id: string; name: string };
    const nextFields = fieldsFromDesign(d);
    setDesignId(d.id);
    setName(d.name);
    setFields(nextFields);
    savedSnapshotRef.current = designDraftSnapshot(d.name, nextFields);
    setSaveStatus("saved");
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
    const nextFields = DEFAULT_FIELDS;
    setDesignId(null);
    setName("");
    setFields(nextFields);
    setActiveExampleId(null);
    savedSnapshotRef.current = designDraftSnapshot("", nextFields);
    setSaveStatus("idle");
  }

  function copyDesign() {
    setDesignId(null);
    setName(copyName(name));
    setActiveExampleId(null);
    setSaveStatus(signedIn ? "dirty" : "idle");
  }

  function loadExample(example: GalleryExample) {
    setDesignId(null);
    setName(example.title);
    setFields(example.fields);
    setE(example.E);
    setI(example.I);
    setActiveExampleId(example.id);
    savedSnapshotRef.current = designDraftSnapshot(example.title, example.fields);
    setSaveStatus("idle");
  }

  return (
    <main className="relative flex flex-1 flex-col bg-bg">
      <TopBar
        name={name}
        onNameChange={setName}
        busy={busy}
        saveStatus={saveStatus}
        designId={designId}
        signedIn={signedIn}
        authStatus={status}
        email={email}
        aiApiKey={aiApiKey}
        hasSavedAiApiKey={hasSavedAiApiKey}
        aiKeyBusy={aiKeyBusy}
        designs={list}
        onAiApiKeyChange={setCurrentAiApiKey}
        onSaveAiApiKey={saveAiApiKey}
        onDeleteSavedAiApiKey={deleteSavedAiApiKey}
        onSave={save}
        onCopy={copyDesign}
        onNew={newDesign}
        onLoad={load}
      />

      <ExampleGallery
        examples={GALLERY_EXAMPLES}
        activeId={activeExampleId}
        onLoad={loadExample}
      />

      <AiDesignChat
        key={userKey || "signed-out"}
        signedIn={signedIn}
        authStatus={status}
        apiKey={aiApiKey}
        hasSavedApiKey={hasSavedAiApiKey}
        fields={fields}
        E={E}
        I={I}
        onApply={(proposal) => {
          setFields(proposal.fields);
          setE(proposal.E);
          setI(proposal.I);
          setActiveExampleId(null);
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 items-start justify-center overflow-auto p-4">
          <div className="w-full max-w-[920px]">
            <Diagrams
              nodes={nodes}
              members={members}
              loadCases={loadCases}
              loadCombinations={loadCombinations}
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
            const count = authoringRowCount(spec.key, fields[spec.key]);
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
          loadCaseOptions={loadCaseOptions}
          onChange={(v) => setFields((f) => ({ ...f, [openKey]: v }))}
          onClose={() => setOpenKey(null)}
        />
      )}
    </main>
  );
}

function copyName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed} copy` : "untitled copy";
}

function normalizedDesignName(name: string): string {
  return name.trim() || "untitled";
}

function designDraftSnapshot(name: string, fields: Fields): string {
  return JSON.stringify({
    name: normalizedDesignName(name),
    fields,
  });
}
