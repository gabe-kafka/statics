"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import type { Fields } from "@/lib/design-fields";
import type { AiProvider } from "@/lib/ai-design";

type Proposal = {
  reply: string;
  fields: Fields;
  E: number;
  I: number;
};

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-6",
};

export function AiDesignChat({
  signedIn,
  authStatus,
  fields,
  E,
  I,
  onApply,
}: {
  signedIn: boolean;
  authStatus: string;
  fields: Fields;
  E: number;
  I: number;
  onApply: (proposal: Proposal) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const canSubmit = useMemo(
    () =>
      signedIn &&
      apiKey.trim().length > 0 &&
      prompt.trim().length > 0 &&
      !busy,
    [signedIn, apiKey, prompt, busy],
  );
  const authLoading = authStatus === "loading";
  const disabled = !signedIn || authLoading || busy;

  const chooseProvider = (next: AiProvider) => {
    setProvider(next);
    setModel(DEFAULT_MODELS[next]);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      const res = await fetch("/api/ai/design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          apiKey,
          prompt,
          fields,
          E,
          I,
        }),
      });
      const json = (await res.json()) as
        | ({ ok: true } & Proposal)
        | { ok: false; message: string };
      if (!json.ok) {
        setError(json.message);
        return;
      }
      setProposal({
        reply: json.reply,
        fields: json.fields,
        E: json.E,
        I: json.I,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-border bg-bg px-4 py-3 font-mono text-[10px]">
      <div className="mx-auto grid w-full max-w-[920px] gap-2 lg:grid-cols-[150px_1fr_140px]">
        <div className="flex items-center gap-2">
          <span className="font-medium uppercase tracking-[0.12em] text-muted">
            AI EDITOR
          </span>
          <span className="text-dim">
            {signedIn ? "BYOK" : "SIGN IN"}
          </span>
        </div>

        <div className="grid min-w-0 gap-2">
          <div className="grid gap-2 sm:grid-cols-[120px_minmax(120px,180px)_minmax(160px,1fr)]">
            <select
              value={provider}
              onChange={(e) => chooseProvider(e.target.value as AiProvider)}
              disabled={disabled}
              className="h-7 border border-border bg-surface px-2 text-text outline-none focus:border-accent"
              title="provider"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={disabled}
              className="h-7 border border-border bg-surface px-2 text-text outline-none focus:border-accent"
              spellCheck={false}
              title="model"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={disabled}
              className="h-7 border border-border bg-surface px-2 text-text outline-none focus:border-accent"
              placeholder="API key"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              title="API key"
            />
          </div>
          <div className="text-[9px] uppercase tracking-[0.08em] text-dim">
            Signed-in only. Key is sent through this server once and not saved.
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={disabled}
            className="min-h-16 resize-y border border-border bg-surface px-2 py-2 text-text outline-none focus:border-accent"
            placeholder="add a 44 ft beam with a 10 kip point load at midspan"
            spellCheck={false}
          />
        </div>

        <div className="grid gap-2">
          <button
            type="button"
            onClick={signedIn ? submit : () => signIn("google")}
            disabled={signedIn ? !canSubmit : authLoading}
            className="h-7 border border-border bg-surface px-2 uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text disabled:opacity-40"
          >
            {!signedIn ? "SIGN IN" : busy ? "THINKING" : "GENERATE"}
          </button>
          <button
            type="button"
            onClick={() => proposal && onApply(proposal)}
            disabled={!proposal || busy}
            className="h-7 border border-border bg-surface px-2 uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-text disabled:opacity-40"
          >
            APPLY
          </button>
        </div>

        {(error || proposal) && (
          <div className="lg:col-start-2 lg:col-end-4">
            {error ? (
              <div className="border border-red bg-surface px-2 py-1.5 text-red">
                {error}
              </div>
            ) : (
              <div className="border border-border bg-surface px-2 py-1.5 text-muted">
                {proposal?.reply}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
