"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMux } from "@/providers/MuxProvider";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { TERMINAL_KEYS, type TerminalKey } from "@/lib/terminal-keys";

interface MobileTerminalInputDockProps {
  sessionId: string;
  projectId?: string;
}

const KEY_BUTTONS: Array<{ key: TerminalKey; label: string; glyph: string }> = [
  { key: "escape", label: "Escape", glyph: "Esc" },
  { key: "ctrlC", label: "Ctrl-C", glyph: "^C" },
  { key: "tab", label: "Tab", glyph: "Tab" },
  { key: "left", label: "Left", glyph: "←" },
  { key: "up", label: "Up", glyph: "↑" },
  { key: "down", label: "Down", glyph: "↓" },
  { key: "right", label: "Right", glyph: "→" },
  { key: "enter", label: "Enter", glyph: "⏎" },
];

/**
 * Bottom input dock for driving a terminal session on touch devices: a row of
 * special keys plus a text/voice input bar. Everything is delivered as raw bytes
 * via the existing Mux writeTerminal path. Additive — xterm input is untouched.
 */
export function MobileTerminalInputDock({ sessionId, projectId }: MobileTerminalInputDockProps) {
  const { writeTerminal } = useMux();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const sendBytes = useCallback(
    (bytes: string) => writeTerminal(sessionId, bytes, projectId),
    [writeTerminal, sessionId, projectId],
  );

  const sendText = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    sendBytes(value + TERMINAL_KEYS.enter);
    setText("");
  }, [text, sendBytes]);

  const speech = useSpeechRecognition((transcript) => setText(transcript));

  // Keep the dock above the soft keyboard (progressive enhancement; imperative
  // CSS var, not a JSX inline style).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = dockRef.current;
    if (!vv || !el) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty("--kb-inset", `${inset}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div
      ref={dockRef}
      className="flex flex-col gap-1.5 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-2 [transform:translateY(calc(-1*var(--kb-inset,0px)))]"
      aria-label="Terminal input"
    >
      <div className="flex flex-wrap gap-1.5">
        {KEY_BUTTONS.map(({ key, label, glyph }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            onClick={() => sendBytes(TERMINAL_KEYS[key])}
            className="min-h-[40px] min-w-[40px] rounded border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-2 font-mono text-xs text-[var(--color-text-primary)] active:bg-[var(--color-bg-hover)]"
          >
            {glyph}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        {speech.supported ? (
          <button
            type="button"
            aria-label="Voice input"
            aria-pressed={speech.listening}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            className="min-h-[40px] min-w-[40px] rounded border border-[var(--color-border-default)] px-2 text-[var(--color-text-primary)] active:bg-[var(--color-bg-hover)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-[var(--color-text-inverse)]"
          >
            🎤
          </button>
        ) : null}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText();
            }
          }}
          placeholder="Message…"
          rows={1}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          className="min-h-[40px] flex-1 resize-none rounded border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-2 py-2 font-mono text-sm text-[var(--color-text-primary)]"
        />
        <button
          type="button"
          aria-label="Send"
          onClick={sendText}
          className="min-h-[40px] rounded bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-text-inverse)] active:bg-[var(--color-accent-hover)]"
        >
          Send
        </button>
      </div>
    </div>
  );
}
