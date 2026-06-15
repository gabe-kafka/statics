"use client";

import Image from "next/image";
import { signIn, signOut } from "next-auth/react";

export type DesignRow = { id: string; name: string; updatedAt: string };

export function TopBar({
  name,
  onNameChange,
  busy,
  designId,
  signedIn,
  authStatus,
  email,
  designs,
  onSave,
  onNew,
  onLoad,
}: {
  name: string;
  onNameChange: (value: string) => void;
  busy: boolean;
  designId: string | null;
  signedIn: boolean;
  authStatus: string;
  email: string;
  designs: DesignRow[];
  onSave: () => void;
  onNew: () => void;
  onLoad: (id: string) => void;
}) {
  return (
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
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="untitled"
          spellCheck={false}
          className="h-6 w-48 border border-border bg-surface px-2 font-mono text-[10px] text-text placeholder:text-dim focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!signedIn || !name.trim() || busy}
          title={!signedIn ? "sign in to save" : undefined}
          className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent disabled:opacity-40"
        >
          {busy ? "..." : designId ? "SAVE" : "SAVE NEW"}
        </button>
        {designId && (
          <button
            type="button"
            onClick={onNew}
            className="h-6 border border-border bg-surface px-2 font-mono text-[10px] uppercase tracking-[0.08em] hover:border-accent"
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
            className="h-6 border border-border bg-surface px-1 font-mono text-[10px] text-text focus:border-accent focus:outline-none"
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
        className="flex items-center border-l border-border px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:text-text"
      >
        API
      </a>

      <div className="flex items-center gap-2 border-l border-border px-3">
        {authStatus === "loading" ? (
          <span className="uppercase text-dim">...</span>
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
  );
}
