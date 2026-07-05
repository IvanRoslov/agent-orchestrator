"use client";

import { useEffect, useRef, useState } from "react";
import { CI_STATUS } from "@aoagents/ao-core/types";
import { cn } from "@/lib/cn";
import { type DashboardSession, type DashboardPR, isPRMergeReady } from "@/lib/types";
import type { ProjectInfo } from "@/lib/project-name";
import { DashboardNotificationButton } from "./DashboardNotificationButton";
import { SessionDetailPRCard } from "./SessionDetailPRCard";
import { askAgentToFix } from "./session-detail-agent-actions";
import { StatusBadge } from "./StatusBadge";
import { buildGitHubBranchUrl } from "./session-detail-utils";
import { projectDashboardPath } from "@/lib/routes";
import { GitBranchIcon, OrchestratorZonePills } from "./SessionDetailHeader.parts";
import { TerminalDockToggleButton } from "./TerminalDockToggleButton";
import { TranscriptToggleButton } from "./TranscriptToggleButton";
import { SessionLifecycleActionButtons } from "./SessionLifecycleActionButtons";

export interface OrchestratorZones {
  merge: number;
  respond: number;
  review: number;
  pending: number;
  working: number;
  done: number;
}

interface SessionDetailHeaderProps {
  session: DashboardSession;
  isOrchestrator: boolean;
  /** Feature orchestrators are killable (disposable per-feature), unlike the
   *  project's permanent orchestrator. */
  isFeatureOrchestrator?: boolean;
  isMobile: boolean;
  terminalEnded: boolean;
  isRestorable: boolean;
  headline: string;
  projects: ProjectInfo[];
  orchestratorHref: string | null;
  orchestratorZones?: OrchestratorZones;
  selectedPRIndex: number;
  onSelectPR: (index: number) => void;
  onToggleSidebar: () => void;
  onRestore: () => void;
  onKill: () => void;
  /** Whether the mobile input dock is currently shown. */
  inputDockVisible?: boolean;
  /** Toggle the mobile input dock. When absent, the toggle button is hidden. */
  onToggleInputDock?: () => void;
  transcriptVisible?: boolean;
  onToggleTranscript?: () => void;
  workersCollapsed?: boolean;
  onToggleWorkers?: () => void;
}

export function SessionDetailHeader({
  session,
  isOrchestrator,
  isFeatureOrchestrator = false,
  isMobile,
  terminalEnded,
  isRestorable,
  headline,
  projects,
  orchestratorHref,
  orchestratorZones,
  selectedPRIndex,
  onSelectPR,
  onToggleSidebar,
  onRestore,
  onKill,
  inputDockVisible = false,
  onToggleInputDock,
  transcriptVisible = false,
  onToggleTranscript,
  workersCollapsed = false,
  onToggleWorkers,
}: SessionDetailHeaderProps) {
  const prs = session.prs ?? [];
  const safeSelectedPRIndex = Math.min(selectedPRIndex, Math.max(0, prs.length - 1));
  const pr = prs[safeSelectedPRIndex] ?? session.pr;
  const allGreen = pr ? isPRMergeReady(pr) : false;
  const [prPopoverOpen, setPrPopoverOpen] = useState(false);
  const prPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prPopoverOpen) return;
    const handler = (event: MouseEvent) => {
      if (prPopoverRef.current && !prPopoverRef.current.contains(event.target as Node)) {
        setPrPopoverOpen(false);
      }
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPrPopoverOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [prPopoverOpen]);

  const headerProjectLabel =
    projects.find((project) => project.id === session.projectId)?.name ?? session.projectId;

  return (
    <header className="dashboard-app-header session-topbar">
      {/* Mobile-only drawer toggle. On desktop the sidebar carries its own
          collapse/expand affordance, so the topbar doesn't duplicate it. */}
      {isMobile && projects.length > 0 ? (
        <button
          type="button"
          className="dashboard-app-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      ) : null}

      {/* ‹ Kanban back button → the project board. Workers get a plain "Kanban"
          back; orchestrators keep their dedicated "Open Kanban"/fleet button
          further along the row. */}
      {!isOrchestrator ? (
        <a
          className="session-board-btn"
          href={projectDashboardPath(session.projectId)}
          title="Back to Kanban"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="topbar-btn-label">Kanban</span>
        </a>
      ) : null}

      {!isOrchestrator ? <span className="session-topbar__vdiv" aria-hidden="true" /> : null}

      {isOrchestrator ? (
        <div className="topbar-project-pills-group">
          <div className="topbar-project-line">
            <span className="dashboard-app-header__project">{headerProjectLabel}</span>
            <span className="topbar-identity-sep" aria-hidden="true">
              ·
            </span>
            <span className="session-detail-mode-badge session-detail-mode-badge--neutral">
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="12" cy="5" r="2" fill="currentColor" stroke="none" />
                <path d="M12 7v4M12 11H6M12 11h6M6 11v3M12 11v3M18 11v3" />
                <circle cx="6" cy="17" r="2" />
                <circle cx="12" cy="17" r="2" />
                <circle cx="18" cy="17" r="2" />
              </svg>
              Orchestrator
            </span>
          </div>
          <div className="topbar-session-pills">
            <StatusBadge session={session} variant="pill" />
            {orchestratorZones ? <OrchestratorZonePills zones={orchestratorZones} /> : null}
          </div>
        </div>
      ) : (
        <>
          {/* Session identity — TITLE first, BRANCH to its right (mono + git icon). */}
          <div className="session-topbar__id">
            <span className="session-topbar__title" title={headline}>
              {headline}
            </span>
            {session.branch ? (
              pr ? (
                <a
                  href={buildGitHubBranchUrl(pr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="session-topbar__branch session-topbar__branch--link"
                  title={session.branch}
                >
                  <span className="session-topbar__branch-icon">
                    <GitBranchIcon />
                  </span>
                  {session.branch}
                </a>
              ) : (
                <span className="session-topbar__branch" title={session.branch}>
                  <span className="session-topbar__branch-icon">
                    <GitBranchIcon />
                  </span>
                  {session.branch}
                </span>
              )
            ) : null}
          </div>
          <StatusBadge session={session} variant="pill" />
          <span className="dashboard-app-header__session-id topbar-mobile-only">{session.id}</span>
        </>
      )}

      <div className="dashboard-app-header__spacer" />
      <div className="dashboard-app-header__actions">
        <DashboardNotificationButton />
        {isFeatureOrchestrator && onToggleWorkers ? (
          <button
            type="button"
            className={cn("dashboard-app-btn", !workersCollapsed && "topbar-pr-btn--open")}
            onClick={onToggleWorkers}
            aria-pressed={!workersCollapsed}
            aria-label="Toggle workers panel"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
            <span className="topbar-btn-label">Workers</span>
          </button>
        ) : null}
        {!isOrchestrator && pr ? (
          <div className="topbar-pr-btn-wrap" ref={prPopoverRef}>
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "dashboard-app-btn topbar-pr-btn",
                prPopoverOpen && "topbar-pr-btn--open",
              )}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
                event.preventDefault();
                setPrPopoverOpen((value) => !value);
              }}
              aria-expanded={prPopoverOpen}
              aria-label={`PR #${pr.number}`}
            >
              <span
                className={cn(
                  "topbar-pr-dot",
                  allGreen
                    ? "topbar-pr-dot--green"
                    : pr.ciStatus === CI_STATUS.FAILING || pr.reviewDecision === "changes_requested"
                      ? "topbar-pr-dot--red"
                      : "topbar-pr-dot--amber",
                )}
              />
              PR #{pr.number}
              <svg
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d={prPopoverOpen ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
              </svg>
            </a>

            {prPopoverOpen && (
              <div className="topbar-pr-popover">
                {prs.length > 1 && (
                  <div className="flex gap-0.5 px-3 pt-2 pb-1.5 border-b border-[var(--color-border-subtle)]">
                    {prs.map((p, i) => (
                      <button
                        key={p.url}
                        type="button"
                        onClick={() => onSelectPR(i)}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs",
                          safeSelectedPRIndex === i
                            ? "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]"
                            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
                        )}
                      >
                        <span
                          className={cn(
                            "topbar-pr-dot",
                            isPRMergeReady(p)
                              ? "topbar-pr-dot--green"
                              : p.ciStatus === CI_STATUS.FAILING ||
                                  p.reviewDecision === "changes_requested"
                                ? "topbar-pr-dot--red"
                                : "topbar-pr-dot--amber",
                          )}
                        />
                        PR #{p.number}
                      </button>
                    ))}
                  </div>
                )}
                <SessionDetailPRCard
                  pr={pr as DashboardPR}
                  metadata={session.metadata}
                  lifecyclePrReason={session.lifecycle?.prReason ?? undefined}
                  onAskAgentToFix={(comment, onSuccess, onError) =>
                    askAgentToFix(session.id, comment, onSuccess, onError)
                  }
                />
              </div>
            )}
          </div>
        ) : null}
        <TerminalDockToggleButton visible={inputDockVisible} onToggle={onToggleInputDock} />
        <TranscriptToggleButton visible={transcriptVisible} onToggle={onToggleTranscript} />
        <SessionLifecycleActionButtons
          isOrchestrator={isOrchestrator}
          isRestorable={isRestorable}
          isFeatureOrchestrator={isFeatureOrchestrator}
          terminalEnded={terminalEnded}
          onRestore={onRestore}
          onKill={onKill}
        />

        {orchestratorHref ? (
          <a
            href={orchestratorHref}
            className="dashboard-app-btn dashboard-app-btn--primary topbar-desktop-only"
            aria-label="Orchestrator"
          >
            <svg
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="5" r="2" fill="currentColor" stroke="none" />
              <path d="M12 7v4M12 11H6M12 11h6M6 11v3M12 11v3M18 11v3" />
              <circle cx="6" cy="17" r="2" />
              <circle cx="12" cy="17" r="2" />
              <circle cx="18" cy="17" r="2" />
            </svg>
            <span className="topbar-btn-label">Orchestrator</span>
          </a>
        ) : null}
        {isOrchestrator ? (
          <a
            href={projectDashboardPath(session.projectId)}
            className="dashboard-app-btn dashboard-app-btn--amber"
            aria-label="Open Kanban"
          >
            <svg
              className="topbar-action-icon"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="4" y="4" width="4" height="16" rx="1.2" />
              <rect x="10" y="4" width="4" height="16" rx="1.2" />
              <rect x="16" y="4" width="4" height="16" rx="1.2" />
            </svg>
            <span className="topbar-btn-label">Open Kanban</span>
          </a>
        ) : null}
      </div>
    </header>
  );
}
