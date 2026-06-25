"use client";

import { useState } from "react";
import type { TranscriptPrompt } from "@/lib/transcript-types";

// Option tap sends the 1-based index string followed by "Enter" (Claude Code's
// numbered-choice protocol: typing the digit then Enter selects the option).
export function PromptCard({
  prompt,
  onKeys,
  onAnswer,
  onDiscuss,
}: {
  prompt: TranscriptPrompt;
  onKeys: (keys: string[]) => void;
  onAnswer: (text: string) => void;
  onDiscuss: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const hasOptions = prompt.options.length > 0;

  return (
    <div className="m-3 flex flex-col gap-2 rounded-lg border border-[var(--color-status-attention)] bg-[var(--color-bg-elevated)] p-3">
      <div className="whitespace-pre-wrap break-words text-sm font-medium text-[var(--color-text-primary)]">
        {prompt.question}
      </div>

      {hasOptions ? (
        <div className="flex flex-col gap-1.5">
          {prompt.options.map((opt) => (
            <button
              key={opt.index}
              type="button"
              onClick={() => onKeys([String(opt.index), "Enter"])}
              className="min-h-[40px] rounded border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] active:bg-[var(--color-bg-hover)]"
            >
              {opt.index}. {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onKeys(["Enter"])}
            className="min-h-[40px] flex-1 rounded bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-text-inverse)]"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onKeys(["Escape"])}
            className="min-h-[40px] flex-1 rounded border border-[var(--color-border-default)] px-3 text-sm text-[var(--color-text-primary)]"
          >
            Deny
          </button>
        </div>
      )}

      {!hasOptions ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-inset)] p-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {prompt.raw}
        </pre>
      ) : null}

      <div className="flex items-end gap-1.5">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer…"
          rows={1}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-h-[40px] flex-1 resize-none rounded border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-2 text-sm text-[var(--color-text-primary)]"
        />
        <button
          type="button"
          aria-label="Send answer"
          onClick={() => {
            const v = answer.trim();
            if (!v) return;
            onAnswer(v);
            setAnswer("");
          }}
          className="min-h-[40px] rounded bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-text-inverse)]"
        >
          Send answer
        </button>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onDiscuss}
          className="min-h-[40px] flex-1 rounded border border-[var(--color-border-default)] px-3 text-sm text-[var(--color-text-primary)]"
        >
          Chat it
        </button>
        <button
          type="button"
          aria-label="Interrupt"
          onClick={() => onKeys(["Escape"])}
          className="min-h-[40px] rounded border border-[var(--color-status-error)] px-3 text-sm text-[var(--color-status-error)]"
        >
          Interrupt
        </button>
      </div>
    </div>
  );
}
