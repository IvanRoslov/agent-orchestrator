interface TerminalDockToggleButtonProps {
  visible: boolean;
  onToggle?: () => void;
}

/**
 * Header button that shows/hides the mobile terminal input dock. Renders nothing
 * when no toggle handler is provided.
 */
export function TerminalDockToggleButton({ visible, onToggle }: TerminalDockToggleButtonProps) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      className="dashboard-app-btn"
      aria-label="Toggle on-screen keyboard"
      aria-pressed={visible}
      onClick={onToggle}
    >
      <svg
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
      </svg>
    </button>
  );
}
