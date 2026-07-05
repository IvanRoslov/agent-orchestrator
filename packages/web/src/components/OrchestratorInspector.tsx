"use client";

import { useRouter } from "next/navigation";
import { useResizable } from "@/hooks/useResizable";
import { projectSessionPath } from "@/lib/routes";
import type { DashboardSession } from "../lib/types";
import { OrchestratorWorkersList, useFeatureWorkers } from "./OrchestratorWorkersCard";

export function OrchestratorInspector({
  session,
  onCollapse,
}: {
  session: DashboardSession;
  onCollapse: () => void;
}) {
  const router = useRouter();
  const workers = useFeatureWorkers(session);
  const { onPointerDown, onDoubleClick } = useResizable({
    cssVar: "--ao-inspector-w",
    storageKey: "ao-inspector-w",
    defaultWidth: 344,
    min: 280,
    max: 560,
    edge: "left",
  });

  return (
    <aside className="session-inspector" aria-label="Workers inspector">
      <div
        className="resize-handle resize-handle--left"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
      />
      <div className="inspector-section__head">
        <span>Workers ({workers.length})</span>
        <button
          type="button"
          className="inspector-section__link"
          onClick={onCollapse}
          aria-label="Collapse workers panel"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="session-inspector__body">
        <OrchestratorWorkersList
          workers={workers}
          onOpen={(projectId, id) => router.push(projectSessionPath(projectId, id))}
        />
      </div>
    </aside>
  );
}
