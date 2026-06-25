"use client";

import { useState } from "react";
import type { TranscriptEntry } from "@/lib/transcript-types";
import { Markdown } from "./Markdown";

function ToolCall({ name, input }: { name: string; input: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-[var(--color-text-secondary)]"
        aria-expanded={open}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>{name}</span>
      </button>
      {open ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-2 pb-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {input}
        </pre>
      ) : null}
    </div>
  );
}

export function TranscriptMessageList({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {entries.map((entry, i) => {
        if (entry.kind === "message") {
          const isUser = entry.role === "user";
          return (
            <div key={i} className={cnRole(isUser)}>
              {isUser ? (
                <div className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">
                  {entry.text}
                </div>
              ) : (
                <Markdown text={entry.text} />
              )}
            </div>
          );
        }
        if (entry.kind === "tool_use") {
          return <ToolCall key={i} name={entry.name} input={entry.input} />;
        }
        return (
          <pre
            key={i}
            className={
              "overflow-x-auto whitespace-pre-wrap break-words rounded border px-2 py-1.5 font-mono text-[11px] " +
              (entry.isError
                ? "border-[var(--color-status-error)] text-[var(--color-status-error)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]")
            }
          >
            {entry.text}
          </pre>
        );
      })}
    </div>
  );
}

function cnRole(isUser: boolean): string {
  return isUser
    ? "self-end max-w-[85%] rounded-lg bg-[var(--color-bg-elevated)] px-3 py-2"
    : "self-start max-w-[85%] rounded-lg bg-[var(--color-bg-surface)] px-3 py-2";
}
