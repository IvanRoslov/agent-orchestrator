interface SessionLifecycleActionButtonsProps {
  isOrchestrator: boolean;
  isRestorable: boolean;
  isFeatureOrchestrator: boolean;
  terminalEnded: boolean;
  onRestore: () => void;
  onKill: () => void;
}

/**
 * Renders the Restore or Kill button for a session, or null when neither
 * applies (e.g. a permanent orchestrator whose terminal has already ended).
 */
export function SessionLifecycleActionButtons({
  isOrchestrator,
  isRestorable,
  isFeatureOrchestrator,
  terminalEnded,
  onRestore,
  onKill,
}: SessionLifecycleActionButtonsProps) {
  if (!isOrchestrator && isRestorable) {
    return (
      <button
        type="button"
        className="dashboard-app-btn dashboard-app-btn--restore"
        onClick={onRestore}
      >
        <svg
          className="topbar-action-icon"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M20 11a8 8 0 0 0-14.9-3.98" />
          <path d="M4 5v4h4" />
          <path d="M4 13a8 8 0 0 0 14.9 3.98" />
          <path d="M20 19v-4h-4" />
        </svg>
        <span className="topbar-btn-label">Restore</span>
      </button>
    );
  }

  if ((!isOrchestrator || isFeatureOrchestrator) && !terminalEnded) {
    return (
      <button
        type="button"
        className="dashboard-app-btn dashboard-app-btn--danger"
        onClick={onKill}
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M4 7h16" />
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
          <line x1="10" y1="11.5" x2="10" y2="17.5" />
          <line x1="14" y1="11.5" x2="14" y2="17.5" />
        </svg>
        <span className="topbar-btn-label">Kill</span>
      </button>
    );
  }

  return null;
}
