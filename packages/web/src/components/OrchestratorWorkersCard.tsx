"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { DashboardSession } from "../lib/types";
import { projectSessionPath } from "../lib/routes";
import {
  workerHealthList,
  formatAgeShort,
  type WorkerHealth,
} from "../lib/feature-sessions";

const STATE_LABEL: Record<string, string> = {
  active: "active",
  ready: "ready",
  idle: "idle",
  waiting_input: "waiting",
  blocked: "blocked",
  exited: "exited",
};

const POLL_MS = 5000;

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

/**
 * Self-contained cross-project session feed. Workers live in the LINKED
 * projects, not this orchestrator's project, so we poll the unscoped
 * `/api/sessions` endpoint directly rather than depending on the SSR-seeded
 * `useSessionEvents` hook (which is not callable standalone deep in the tree).
 */
function useAllSessions(): DashboardSession[] {
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
  return sessions;
}

export function OrchestratorWorkersCard({ session }: { session: DashboardSession }) {
  const slug = session.metadata["feature"] ?? "";
  const sessions = useAllSessions();
  const router = useRouter();
  const workers = useMemo(
    () => workerHealthList(sessions, slug, Date.now()),
    [sessions, slug],
  );
  return (
    <OrchestratorWorkersList
      workers={workers}
      onOpen={(projectId, id) => router.push(projectSessionPath(projectId, id))}
    />
  );
}
