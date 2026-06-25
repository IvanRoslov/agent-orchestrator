"use client";

import { useEffect, useState } from "react";

// A persistent, always-mounted control bar for driving the agent's TUI from the
// transcript view. Unlike an auto-detected prompt card, this never unmounts, so
// taps always land — it reliably drives ANY prompt (numbered choices, yes/no,
// and multi-select checkboxes via Space to toggle + Enter to confirm).

type Key = { token: string; label: string; ariaLabel: string; wide?: boolean };

const NAV_KEYS: Key[] = [
  { token: "Up", label: "↑", ariaLabel: "Up" },
  { token: "Down", label: "↓", ariaLabel: "Down" },
  { token: "Left", label: "←", ariaLabel: "Left" },
  { token: "Right", label: "→", ariaLabel: "Right" },
  { token: "Space", label: "␣ Space", ariaLabel: "Space", wide: true },
  { token: "Enter", label: "⏎ Enter", ariaLabel: "Enter", wide: true },
  { token: "Escape", label: "Esc", ariaLabel: "Escape" },
  { token: "C-c", label: "Ctrl-C", ariaLabel: "Ctrl-C", wide: true },
];

const DIGITS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => ({
  token: d,
  label: d,
  ariaLabel: `Digit ${d}`,
}));

const KEY_CLASS =
  "min-h-[40px] min-w-[40px] rounded border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 text-sm text-[var(--color-text-primary)] active:bg-[var(--color-bg-hover)]";

export function TranscriptKeyPad({ onKeys }: { onKeys: (keys: string[]) => void }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (window.localStorage.getItem("ao:transcriptKeys") === "0") setOpen(false);
  }, []);
  const toggle = () => {
    setOpen((v) => {
      window.localStorage.setItem("ao:transcriptKeys", v ? "0" : "1");
      return !v;
    });
  };

  return (
    <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Toggle keys"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)]"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>Keys</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {DIGITS.map((k) => (
              <button
                key={k.token}
                type="button"
                aria-label={k.ariaLabel}
                onClick={() => onKeys([k.token])}
                className={KEY_CLASS}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {NAV_KEYS.map((k) => (
              <button
                key={k.token}
                type="button"
                aria-label={k.ariaLabel}
                onClick={() => onKeys([k.token])}
                className={KEY_CLASS + (k.wide ? " px-3" : "")}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
