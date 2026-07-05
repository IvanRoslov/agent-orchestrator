"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { DashboardSession } from "../lib/types";
import { getPRChipColorClass, getPRStatusLabel } from "@/lib/pr-display";
import { formatRelativeTime } from "@/lib/format";
import { workerHealthList, type WorkerHealth } from "../lib/feature-sessions";

const POLL_MS = 5000;

/** activity → { colored dot class, human label }. Stale is an ADDITIVE marker
    (amber border + "stalled" pill), so status stays visible even when stale. */
function statusDisplay(activity: WorkerHealth["activity"]): { dot: string; label: string } {
  switch (activity) {
    case "active": return { dot: "bg-[var(--color-status-working)]", label: "active" };
    case "ready": return { dot: "bg-[var(--color-status-ready)]", label: "ready" };
    case "waiting_input": return { dot: "bg-[var(--color-status-respond)]", label: "waiting input" };
    case "blocked": return { dot: "bg-[var(--color-status-error)]", label: "blocked" };
    case "idle": return { dot: "bg-[var(--color-status-idle)]", label: "idle" };
    case "exited": return { dot: "bg-[var(--color-text-muted)]", label: "exited" };
    default: return { dot: "bg-[var(--color-text-tertiary)] opacity-40", label: "unknown" };
  }
}

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
    <ul className="flex flex-col gap-[8px]">
      {workers.map((w) => {
        const s = statusDisplay(w.activity);
        const lastMs = new Date(w.lastActivityAt).getTime();
        const exact = Number.isNaN(lastMs) ? "" : new Date(lastMs).toLocaleString();
        return (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onOpen(w.projectId, w.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left",
                w.stale
                  ? "border-[var(--color-accent-amber)]"
                  : "border-[var(--color-border-default)]",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
                <span className="truncate text-sm font-medium">{w.task}</span>
                {w.pr ? (
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none",
                      getPRChipColorClass(w.pr),
                    )}
                  >
                    #{w.pr.number}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span>{s.label}</span>
                {w.stale ? (
                  <span className="text-[var(--color-status-attention)]">stalled</span>
                ) : null}
                {Number.isNaN(lastMs) ? null : (
                  <span className="ml-auto" title={exact}>
                    {formatRelativeTime(lastMs)}
                  </span>
                )}
              </div>
              {w.branch ? (
                <span className="truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
                  {w.branch}
                </span>
              ) : null}
              {w.pr && getPRStatusLabel(w.pr) ? (
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  PR {getPRStatusLabel(w.pr)}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cross-project worker feed for a feature orchestrator. Workers live in the
 * LINKED projects, so poll the unscoped `/api/sessions` endpoint directly
 * (not the SSR-seeded useSessionEvents hook).
 */
export function useFeatureWorkers(session: DashboardSession): WorkerHealth[] {
  const slug = session.metadata["feature"] ?? "";
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  useEffect(() => {
    let cancelled = false;
    let inflight: AbortController | null = null;
    const load = async () => {
      inflight?.abort();
      const controller = new AbortController();
      inflight = controller;
      try {
        const res = await fetch("/api/sessions?fresh=true", { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { sessions?: DashboardSession[] };
        if (!cancelled) setSessions(body.sessions ?? []);
      } catch {
        /* transient fetch/abort — keep last good data */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      inflight?.abort();
      clearInterval(timer);
    };
  }, []);
  return workerHealthList(sessions, slug, Date.now());
}
