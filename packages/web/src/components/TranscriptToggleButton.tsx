interface TranscriptToggleButtonProps {
  visible: boolean;
  onToggle?: () => void;
}

/**
 * Header button that switches between the transcript view and the live terminal.
 * Renders nothing when no toggle handler is provided.
 */
export function TranscriptToggleButton({ visible, onToggle }: TranscriptToggleButtonProps) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      className="dashboard-app-btn"
      aria-label="Toggle transcript view"
      aria-pressed={visible}
      onClick={onToggle}
    >
      {visible ? "Terminal" : "Transcript"}
    </button>
  );
}
