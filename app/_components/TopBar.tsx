"use client";

import { useState } from "react";
import Image from "next/image";
import { signIn, signOut } from "next-auth/react";

export type DesignRow = { id: string; name: string; updatedAt: string };
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export function TopBar({
  name,
  onNameChange,
  busy,
  saveStatus,
  designId,
  signedIn,
  authStatus,
  email,
  aiApiKey,
  hasSavedAiApiKey,
  aiKeyBusy,
  designs,
  onAiApiKeyChange,
  onSaveAiApiKey,
  onDeleteSavedAiApiKey,
  onSave,
  onCopy,
  onNew,
  onLoad,
}: {
  name: string;
  onNameChange: (value: string) => void;
  busy: boolean;
  saveStatus: SaveStatus;
  designId: string | null;
  signedIn: boolean;
  authStatus: string;
  email: string;
  aiApiKey: string;
  hasSavedAiApiKey: boolean;
  aiKeyBusy: boolean;
  designs: DesignRow[];
  onAiApiKeyChange: (value: string) => void;
  onSaveAiApiKey: () => void;
  onDeleteSavedAiApiKey: () => void;
  onSave: () => void;
  onCopy: () => void;
  onNew: () => void;
  onLoad: (id: string) => void;
}) {
  const [aiKeyOpen, setAiKeyOpen] = useState(false);
  const needsAiKey =
    signedIn && !hasSavedAiApiKey && aiApiKey.trim().length === 0;
  const transientReady = aiApiKey.trim().length > 0;
  const aiKeyState = hasSavedAiApiKey
    ? "SAVED"
    : transientReady
      ? "READY"
      : "NEEDED";
  const saveStatusText = signedIn ? saveStatusLabel(saveStatus) : "";

  return (
    <div className="relative flex min-h-9 flex-wrap items-stretch border-b border-border text-[10px]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-r border-border px-3">
        <Image
          src="/logo.png"
          alt="GK"
          width={90}
          height={24}
          priority
          className="h-auto w-20 sm:w-[90px]"
        />
        <span className="font-medium uppercase tracking-[0.12em] text-muted">
          STATICS
        </span>
      </div>

      <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-2 px-3 py-1">
        <span className="shrink-0 uppercase tracking-[0.08em] text-muted">
          DESIGN
        </span>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="untitled"
          spellCheck={false}
          className="h-6 min-w-0 flex-1 basis-36 border border-border bg-surface px-2 font-mono text-[10px] text-text placeholder:text-dim focus:border-accent focus:outline-none sm:flex-none sm:basis-auto sm:w-48"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!signedIn || busy}
          title={!signedIn ? "sign in to save" : "save now"}
          className="h-6 shrink-0 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent disabled:opacity-40"
        >
          {busy ? "..." : designId ? "SAVE" : "SAVE NEW"}
        </button>
        {saveStatusText && (
          <span
            className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] ${saveStatusClass(saveStatus)}`}
          >
            {saveStatusText}
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          disabled={busy}
          title="copy current design as an unsaved duplicate"
          className="h-6 shrink-0 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent disabled:opacity-40"
        >
          COPY
        </button>
        {designId && (
          <button
            type="button"
            onClick={onNew}
            className="h-6 shrink-0 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
          >
            NEW
          </button>
        )}
        {signedIn && designs.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.selectedIndex = 0;
              onLoad(v);
            }}
            className="h-6 min-w-0 max-w-full border border-border bg-surface px-1 font-mono text-[10px] text-text focus:border-accent focus:outline-none"
          >
            <option value="">LOAD...</option>
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <a
        href="/docs"
        className="flex h-9 shrink-0 items-center border-l border-border px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:text-text"
      >
        API
      </a>

      <div className="flex min-h-9 min-w-0 max-w-full flex-wrap items-center gap-2 border-l border-border px-3 py-1">
        {authStatus === "loading" ? (
          <span className="uppercase text-dim">...</span>
        ) : signedIn ? (
          <>
            <div className="relative">
              <button
                type="button"
                onClick={() => setAiKeyOpen((open) => !open)}
                className={
                  needsAiKey
                    ? "h-6 border border-accent bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-accent"
                    : "h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text"
                }
                title="Open BYOK vault"
              >
                AI KEY{" "}
                <span className={hasSavedAiApiKey ? "text-green" : ""}>
                  {aiKeyState}
                </span>
              </button>
              {aiKeyOpen && (
                <div className="absolute right-0 top-8 z-50 w-80 border border-border bg-bg p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      BYOK VAULT
                    </span>
                    <button
                      type="button"
                      onClick={() => setAiKeyOpen(false)}
                      className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text"
                    >
                      CLOSE
                    </button>
                  </div>
                  <div className="mb-2 text-[9px] uppercase tracking-[0.08em] text-dim">
                    Encrypted at rest. Never shown again. Only this signed-in
                    account can use it.
                  </div>
                  <input
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => onAiApiKeyChange(e.target.value)}
                    placeholder={
                      hasSavedAiApiKey
                        ? "paste to replace saved OpenAI key"
                        : "OpenAI API key"
                    }
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="mb-2 h-7 w-full border border-border bg-surface px-2 font-mono text-[10px] text-text placeholder:text-dim focus:border-accent focus:outline-none"
                    title="OpenAI API key"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onSaveAiApiKey}
                      disabled={!aiApiKey.trim() || aiKeyBusy}
                      className="h-7 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text disabled:opacity-40"
                    >
                      {aiKeyBusy ? "SAVING" : "SAVE ENCRYPTED"}
                    </button>
                    {hasSavedAiApiKey && (
                      <button
                        type="button"
                        onClick={onDeleteSavedAiApiKey}
                        disabled={aiKeyBusy}
                        className="h-7 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:border-red hover:text-red disabled:opacity-40"
                      >
                        DELETE
                      </button>
                    )}
                    {hasSavedAiApiKey && !aiApiKey.trim() && (
                      <span className="ml-auto text-[9px] uppercase tracking-[0.08em] text-green">
                        SAVED
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <span className="min-w-0 max-w-52 truncate text-muted">{email}</span>
            <button
              type="button"
              onClick={() => {
                onAiApiKeyChange("");
                signOut();
              }}
              className="h-6 shrink-0 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
            >
              SIGN OUT
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => signIn("google")}
            className="h-6 shrink-0 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
          >
            SIGN IN
          </button>
        )}
      </div>
    </div>
  );
}

function saveStatusLabel(status: SaveStatus): string {
  if (status === "dirty") return "UNSAVED";
  if (status === "saving") return "SAVING";
  if (status === "saved") return "SAVED";
  if (status === "error") return "SAVE FAILED";
  return "";
}

function saveStatusClass(status: SaveStatus): string {
  if (status === "saved") return "text-green";
  if (status === "error") return "text-red";
  if (status === "saving") return "text-accent";
  return "text-dim";
}
