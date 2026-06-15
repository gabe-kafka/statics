"use client";

import type { GalleryExample } from "@/lib/examples";
import { examplePayload } from "@/lib/examples";

export function ExampleGallery({
  examples,
  activeId,
  onLoad,
}: {
  examples: readonly GalleryExample[];
  activeId: string | null;
  onLoad: (example: GalleryExample) => void;
}) {
  const selected = examples.find((example) => example.id === activeId) ?? null;
  const payloadExample = selected ?? examples[0];
  const payload = JSON.stringify(examplePayload(payloadExample), null, 2);

  return (
    <section className="border-b border-border bg-bg px-4 py-3 font-mono text-[10px]">
      <div className="mx-auto grid w-full max-w-[920px] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              EXAMPLES
            </h2>
            <span className="text-dim">{examples.length} known cases</span>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {examples.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() => onLoad(example)}
                className={`border px-2 py-2 text-left hover:border-accent ${
                  selected?.id === example.id
                    ? "border-accent bg-surface"
                    : "border-border bg-bg"
                }`}
              >
                <span className="block text-text">{example.title}</span>
                <span className="mt-1 block leading-4 text-muted">
                  {example.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 border border-border bg-surface">
          <div className="border-b border-border px-2 py-1.5 uppercase tracking-[0.08em] text-muted">
            {selected ? selected.title : "Payload Preview"}
          </div>
          <div className="grid gap-2 p-2">
            <div className="flex flex-wrap gap-1">
              {payloadExample.known.map((fact) => (
                <span
                  key={fact}
                  className="border border-border bg-bg px-1.5 py-1 text-dim"
                >
                  {fact}
                </span>
              ))}
            </div>
            <pre className="max-h-44 overflow-auto border border-border bg-bg p-2 text-[9px] leading-4 text-muted">
              {payload}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
