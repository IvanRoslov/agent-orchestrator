"use client";

import { useState } from "react";
import { useResourceSnapshot } from "@/hooks/useResourceSnapshot";
import type { ResourceRow } from "@/lib/resource-types";

function fmt(n: number | null, digits = 0): string {
  return n === null ? "n/a" : n.toFixed(digits);
}

export function ResourcesView() {
  const { data, loading, error, refresh } = useResourceSnapshot();
  const [pending, setPending] = useState<ResourceRow | null>(null);
  const [killing, setKilling] = useState(false);

  async function confirmKill(): Promise<void> {
    if (!pending) return;
    setKilling(true);
    try {
      await fetch("/api/resources/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmuxSession: pending.tmuxSession }),
      });
      setPending(null);
      await refresh();
    } finally {
      setKilling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Resources</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border border-[var(--color-border-default)] px-3 py-1 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-[var(--color-status-error)]">{error}</p>}
      {data && !data.platformSupported && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Resource stats unavailable on Windows.
        </p>
      )}
      {data && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          captured at {new Date(data.capturedAt).toLocaleTimeString()} · {data.totals.sessionCount}{" "}
          sessions · {fmt(data.totals.rssMb)} MB · {data.totals.procCount} procs
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--color-text-secondary)]">
            <tr>
              <th className="py-1 pr-4">Session</th>
              <th className="py-1 pr-4">Status</th>
              <th className="py-1 pr-4">CPU%</th>
              <th className="py-1 pr-4">RAM (MB)</th>
              <th className="py-1 pr-4">Procs</th>
              <th className="py-1 pr-4">Top</th>
              <th className="py-1 pr-4">Age</th>
              <th className="py-1 pr-4" />
            </tr>
          </thead>
          <tbody>
            {data?.sessions.map((row) => (
              <tr
                key={row.tmuxSession}
                className="border-t border-[var(--color-border-default)] text-[var(--color-text-primary)]"
              >
                <td className="py-1 pr-4 font-mono">{row.tmuxSession}</td>
                <td className="py-1 pr-4">
                  {row.orphan ? (
                    <span className="rounded bg-[var(--color-accent-amber-dim)] px-2 py-0.5 text-xs text-[var(--color-accent-amber)]">
                      orphan
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-secondary)]">{row.aoStatus ?? "—"}</span>
                  )}
                </td>
                <td className="py-1 pr-4">{fmt(row.cpuPercent, 1)}</td>
                <td className="py-1 pr-4">{fmt(row.rssMb)}</td>
                <td className="py-1 pr-4">{row.procCount}</td>
                <td className="py-1 pr-4 font-mono text-xs">{row.topCommand}</td>
                <td className="py-1 pr-4">{row.ageMinutes}m</td>
                <td className="py-1 pr-4">
                  <button
                    type="button"
                    onClick={() => setPending(row)}
                    className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-xs text-[var(--color-status-error)] hover:bg-[var(--color-bg-hover)]"
                  >
                    Kill
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col gap-3 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
            <p className="text-sm text-[var(--color-text-primary)]">
              Kill <span className="font-mono">{pending.tmuxSession}</span>?
              {pending.orphan
                ? " This orphan will be killed directly via tmux."
                : " This tracked session will be killed via its lifecycle."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border border-[var(--color-border-default)] px-3 py-1 text-sm text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmKill()}
                disabled={killing}
                className="rounded bg-[var(--color-accent-red)] px-3 py-1 text-sm text-[var(--color-text-inverse)] disabled:opacity-50"
              >
                {killing ? "Killing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
