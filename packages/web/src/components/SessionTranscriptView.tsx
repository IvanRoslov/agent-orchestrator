"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptResponse, TranscriptStatus } from "@/lib/transcript-types";
import { TranscriptMessageList } from "./TranscriptMessageList";
import { TranscriptComposer } from "./TranscriptComposer";
import { TranscriptKeyPad } from "./TranscriptKeyPad";

const POLL_MS = 4000;

const STATUS_LABEL: Record<TranscriptStatus, string> = {
  working: "Working",
  waiting_input: "Waiting for you",
  blocked: "Blocked",
  idle: "Idle",
};

export function SessionTranscriptView({
  sessionId,
  projectId: _projectId,
}: {
  sessionId: string;
  projectId?: string;
}) {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as TranscriptResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transcript");
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [data?.entries.length]);

  const post = useCallback(
    async (path: string, body: unknown) => {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      void refresh();
    },
    [sessionId, refresh],
  );

  // Send route expects { message: text } — confirmed from route.ts body?.message field
  const sendMessage = useCallback((text: string) => void post("send", { message: text }), [post]);
  const sendKeys = useCallback((keys: string[]) => void post("keys", { keys }), [post]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
        <span>{data ? STATUS_LABEL[data.status] : "Loading…"}</span>
        {data?.trigger ? (
          <span className="text-[var(--color-text-muted)]">· {data.trigger}</span>
        ) : null}
        {error ? (
          <span className="text-[var(--color-status-error)]">· {error}</span>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto">
        <TranscriptMessageList entries={data?.entries ?? []} />
        <div ref={bottomRef} />
      </div>
      <TranscriptKeyPad onKeys={sendKeys} />
      <TranscriptComposer onSend={sendMessage} />
    </div>
  );
}
