"use client";

import { cn } from "@/lib/cn";
import { formatAgeShort, type WorkerHealth } from "../lib/feature-sessions";

const STATE_LABEL: Record<string, string> = {
  active: "active",
  ready: "ready",
  idle: "idle",
  waiting_input: "waiting",
  blocked: "blocked",
  exited: "exited",
};

export function OrchestratorWorkersList({
  workers,
  onOpen,
}: {
  workers: WorkerHealth[];
  onOpen: (projectId: string, id: string) => void;
}) {
  if (workers.length === 0) {
    return <p className="inspector-empty">No workers spawned yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-[6px]">
      {workers.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            onClick={() => onOpen(w.projectId, w.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left",
              w.stale
                ? "border-[var(--color-accent-amber)]"
                : "border-[var(--color-border-default)]",
            )}
          >
            <span className="truncate text-sm font-medium">{w.task}</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {STATE_LABEL[w.activity ?? ""] ?? "unknown"}
            </span>
            <span className="text-xs text-[var(--color-text-muted)]"> · </span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {formatAgeShort(w.ageMs)}
            </span>
            {w.pr ? <span className="ml-auto text-xs">#{w.pr.number}</span> : null}
            {w.stale ? (
              <span className="text-xs text-[var(--color-status-attention)]">stalled</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

// NOTE: OrchestratorWorkersCard (the smart container) is intentionally NOT
// implemented here yet. See task-3-report.md — the brief's exact code calls
// `useSessionEvents()` with zero arguments, but the real hook signature
// (packages/web/src/hooks/useSessionEvents.ts) requires `initialSessions`
// and `attentionZones` as mandatory options, and there is no existing
// context/shortcut in this codebase that supplies them ambiently to a leaf
// component. This needs an architecture decision (prop-threading through
// SessionDetail -> SessionInspector -> SummaryView, plus a new Context for
// the per-project route) that is out of scope to guess at here. Reported
// BLOCKED per task instructions.
