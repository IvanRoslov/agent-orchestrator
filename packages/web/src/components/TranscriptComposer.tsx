"use client";

import { useCallback, useState } from "react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

export function TranscriptComposer({
  onSend,
  initialText = "",
}: {
  onSend: (text: string) => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
  }, [text, onSend]);

  // The hook fires with (transcript, isFinal); we fill the textarea on every interim result.
  const speech = useSpeechRecognition((transcript) => setText(transcript));

  return (
    <div className="flex items-end gap-1.5 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-2">
      {speech.supported ? (
        <button
          type="button"
          aria-label="Voice input"
          aria-pressed={speech.listening}
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          className={[
            "min-h-[40px] min-w-[40px] rounded border border-[var(--color-border-default)] px-2",
            speech.listening
              ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]"
              : "text-[var(--color-text-primary)] active:bg-[var(--color-bg-hover)]",
          ].join(" ")}
        >
          🎤
        </button>
      ) : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Message…"
        rows={1}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="min-h-[40px] flex-1 resize-none rounded border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-2 py-2 font-mono text-sm text-[var(--color-text-primary)]"
      />
      <button
        type="button"
        aria-label="Send"
        onClick={submit}
        className="min-h-[40px] rounded bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-text-inverse)] active:bg-[var(--color-accent-hover)]"
      >
        Send
      </button>
    </div>
  );
}
