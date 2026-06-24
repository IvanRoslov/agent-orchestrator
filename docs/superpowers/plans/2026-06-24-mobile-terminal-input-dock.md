# Mobile Terminal Input Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard terminal usable on a tablet by adding a bottom input dock — an on-screen special-keys bar + a text input bar with a mic button — that sends raw bytes to the PTY via the existing `writeTerminal` path.

**Architecture:** All web-only (`packages/web`). The dock produces byte sequences and calls `useMux().writeTerminal(sessionId, bytes, projectId)` — the same path xterm and touch-scroll already use. Voice uses the Web Speech API (feature-detected) into the textarea; OS-keyboard dictation works for free because the input is a real `<textarea>`. xterm input is left intact (additive). Visibility = manual toggle ?? touch (`pointer: coarse`).

**Tech Stack:** Next.js 15 / React 19, TypeScript strict, Tailwind v4 (tokens via `var(--color-*)`), Vitest + @testing-library/react. Repo root: `/Users/ivanroslov/projects/agent-orchestrator`.

**Spec:** `docs/superpowers/specs/2026-06-24-mobile-terminal-input-dock-design.md`

**Deviation from spec (intentional):** the spec listed a new `hooks/useIsTouch.ts`. The existing `useMediaQuery(query)` (`packages/web/src/hooks/useMediaQuery.ts`) already accepts a raw query string, so touch detection uses `useMediaQuery("(pointer: coarse)")` — no new hook. One fewer file/test.

**Note:** this is web-only; it only appears in the running dashboard after a rebuild (`ao stop && ao start --rebuild --restore`).

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `packages/web/src/lib/terminal-keys.ts` | key → raw byte sequence map | New |
| `packages/web/src/lib/__tests__/terminal-keys.test.ts` | map test | New |
| `packages/web/src/hooks/useSpeechRecognition.ts` | Web Speech API wrapper (feature-detected) | New |
| `packages/web/src/hooks/__tests__/useSpeechRecognition.test.ts` | hook test | New |
| `packages/web/src/components/MobileTerminalInputDock.tsx` | the dock (key bar + input bar + mic) | New |
| `packages/web/src/components/__tests__/MobileTerminalInputDock.test.tsx` | dock test | New |
| `packages/web/src/components/SessionDetail.tsx` | own dock visibility state, render dock, pass toggle to header | Modify |
| `packages/web/src/components/SessionDetailHeader.tsx` | input-dock toggle button | Modify |

---

## Task 1: terminal-keys map

**Files:**
- Create: `packages/web/src/lib/terminal-keys.ts`
- Test: `packages/web/src/lib/__tests__/terminal-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/__tests__/terminal-keys.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TERMINAL_KEYS } from "../terminal-keys";

describe("TERMINAL_KEYS", () => {
  it("maps each special key to its raw PTY byte sequence", () => {
    expect(TERMINAL_KEYS.escape).toBe("\x1b");
    expect(TERMINAL_KEYS.enter).toBe("\r");
    expect(TERMINAL_KEYS.ctrlC).toBe("\x03");
    expect(TERMINAL_KEYS.tab).toBe("\t");
    expect(TERMINAL_KEYS.up).toBe("\x1b[A");
    expect(TERMINAL_KEYS.down).toBe("\x1b[B");
    expect(TERMINAL_KEYS.right).toBe("\x1b[C");
    expect(TERMINAL_KEYS.left).toBe("\x1b[D");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- terminal-keys`
Expected: FAIL — cannot resolve `../terminal-keys`.

- [ ] **Step 3: Implement**

Create `packages/web/src/lib/terminal-keys.ts`:

```typescript
/**
 * Raw byte sequences for terminal special keys, written straight to the PTY via
 * the Mux `writeTerminal` path (the same bytes xterm would emit). VT100/xterm
 * encodings: ESC = \x1b, CR = \r, Ctrl-C = \x03, Tab = \t, arrows = CSI A/B/C/D.
 */
export const TERMINAL_KEYS = {
  escape: "\x1b",
  enter: "\r",
  ctrlC: "\x03",
  tab: "\t",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
} as const;

export type TerminalKey = keyof typeof TERMINAL_KEYS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- terminal-keys`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/terminal-keys.ts packages/web/src/lib/__tests__/terminal-keys.test.ts
git commit -m "feat(web): terminal special-key byte map"
```

---

## Task 2: useSpeechRecognition hook

**Files:**
- Create: `packages/web/src/hooks/useSpeechRecognition.ts`
- Test: `packages/web/src/hooks/__tests__/useSpeechRecognition.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/hooks/__tests__/useSpeechRecognition.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSpeechRecognition } from "../useSpeechRecognition";

class FakeRecognition {
  interimResults = false;
  continuous = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSpeechRecognition", () => {
  it("reports unsupported when the API is absent", () => {
    vi.stubGlobal("isSecureContext", true);
    // no SpeechRecognition / webkitSpeechRecognition on window
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    expect(result.current.supported).toBe(false);
  });

  it("reports unsupported in an insecure context even if the API exists", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    expect(result.current.supported).toBe(false);
  });

  it("starts listening and streams transcripts when supported", () => {
    vi.stubGlobal("isSecureContext", true);
    const instances: FakeRecognition[] = [];
    class Tracked extends FakeRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", Tracked);
    const onTranscript = vi.fn();

    const { result } = renderHook(() => useSpeechRecognition(onTranscript));
    expect(result.current.supported).toBe(true);

    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(instances[0].start).toHaveBeenCalled();

    act(() => {
      instances[0].onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: "run the tests" }], { isFinal: true })],
      });
    });
    expect(onTranscript).toHaveBeenCalledWith("run the tests", true);

    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- useSpeechRecognition`
Expected: FAIL — cannot resolve `../useSpeechRecognition`.

- [ ] **Step 3: Implement**

Create `packages/web/src/hooks/useSpeechRecognition.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal shape of the Web Speech API (not in TS DOM lib). Only what we use.
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionLike {
  interimResults: boolean;
  continuous: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognition {
  /** True only when the API exists AND the page is a secure context. */
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Thin wrapper over the Web Speech API. `onTranscript(text, isFinal)` fires with
 * the (interim or final) transcript; the caller decides what to do (we fill a
 * textarea, never auto-send). No-ops gracefully when unsupported.
 */
export function useSpeechRecognition(
  onTranscript: (text: string, isFinal: boolean) => void,
): UseSpeechRecognition {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let text = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        text += result[0]?.transcript ?? "";
        if (result.isFinal) isFinal = true;
      }
      onTranscriptRef.current(text, isFinal);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, []);

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

  return { supported, listening, start, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- useSpeechRecognition`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors (no `any`; minimal interfaces satisfy strict mode).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/hooks/useSpeechRecognition.ts packages/web/src/hooks/__tests__/useSpeechRecognition.test.ts
git commit -m "feat(web): useSpeechRecognition hook (feature-detected, secure-context)"
```

---

## Task 3: MobileTerminalInputDock component

**Files:**
- Create: `packages/web/src/components/MobileTerminalInputDock.tsx`
- Test: `packages/web/src/components/__tests__/MobileTerminalInputDock.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/__tests__/MobileTerminalInputDock.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeTerminal = vi.fn();
vi.mock("@/providers/MuxProvider", () => ({
  useMux: () => ({ writeTerminal }),
}));

let speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => speech,
}));

import { MobileTerminalInputDock } from "../MobileTerminalInputDock";

beforeEach(() => {
  writeTerminal.mockReset();
  speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
});

function renderDock() {
  return render(<MobileTerminalInputDock sessionId="app-1" projectId="proj" />);
}

describe("MobileTerminalInputDock", () => {
  it("sends each special key as its byte sequence to the PTY", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Escape" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\x1b", "proj");
    fireEvent.click(screen.getByRole("button", { name: "Ctrl-C" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\x03", "proj");
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\x1b[A", "proj");
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\r", "proj");
  });

  it("sends typed text followed by Enter and clears the input", () => {
    renderDock();
    const input = screen.getByPlaceholderText("Message…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "npm test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "npm test\r", "proj");
    expect(input.value).toBe("");
  });

  it("does not send when the input is empty", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("shows the mic button only when speech is supported", () => {
    const { unmount } = renderDock();
    expect(screen.getByRole("button", { name: "Voice input" })).toBeInTheDocument();
    unmount();
    speech = { supported: false, listening: false, start: vi.fn(), stop: vi.fn() };
    renderDock();
    expect(screen.queryByRole("button", { name: "Voice input" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- MobileTerminalInputDock`
Expected: FAIL — cannot resolve `../MobileTerminalInputDock`.

- [ ] **Step 3: Implement**

Create `packages/web/src/components/MobileTerminalInputDock.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- MobileTerminalInputDock`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint the new file**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors. If lint later flags the Tailwind arbitrary `[transform:...]`/`aria-pressed:` variants, they are valid Tailwind v4 — keep them; the rule of record is "no `style=` attribute", which this file honors (the dynamic inset is set imperatively via `setProperty`).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/MobileTerminalInputDock.tsx packages/web/src/components/__tests__/MobileTerminalInputDock.test.tsx
git commit -m "feat(web): MobileTerminalInputDock (key bar + text/voice input)"
```

---

## Task 4: Wire the dock + toggle into SessionDetail / SessionDetailHeader

**Files:**
- Modify: `packages/web/src/components/SessionDetailHeader.tsx`
- Modify: `packages/web/src/components/SessionDetail.tsx`
- Test: extend `packages/web/src/components/__tests__/SessionDetail.desktop.test.tsx`

- [ ] **Step 1: Add the toggle button to SessionDetailHeader**

In `packages/web/src/components/SessionDetailHeader.tsx`, add two optional props to the
`SessionDetailHeaderProps` interface (near `isOrchestrator`):

```typescript
  /** Whether the mobile input dock is currently shown. */
  inputDockVisible?: boolean;
  /** Toggle the mobile input dock. When absent, the toggle button is hidden. */
  onToggleInputDock?: () => void;
```

Add them to the destructured params:

```typescript
  inputDockVisible = false,
  onToggleInputDock,
```

Then render a toggle button. Place it immediately before the Kill/Restore button block
(the `isRestorable ? (...) : ...` chain). Add:

```tsx
        {onToggleInputDock ? (
          <button
            type="button"
            className="dashboard-app-btn"
            aria-label="Toggle on-screen keyboard"
            aria-pressed={inputDockVisible}
            onClick={onToggleInputDock}
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
        ) : null}
```

- [ ] **Step 2: Manage dock state + render the dock in SessionDetail**

In `packages/web/src/components/SessionDetail.tsx`:

(a) Add imports near the other component imports:

```typescript
import { MobileTerminalInputDock } from "./MobileTerminalInputDock";
import { useMediaQuery, MOBILE_BREAKPOINT } from "@/hooks/useMediaQuery";
```

(`useMediaQuery`/`MOBILE_BREAKPOINT` is already imported — only add `MobileTerminalInputDock`
and, if not present, the `useMediaQuery` import. Do not duplicate imports.)

(b) Inside the component body (after `const isMobile = useMediaQuery(MOBILE_BREAKPOINT);`),
add touch detection + persisted toggle state:

```typescript
  const isTouch = useMediaQuery("(pointer: coarse)");
  const [dockOverride, setDockOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const stored = window.localStorage.getItem("ao:terminalInputDock");
    if (stored === "1") setDockOverride(true);
    else if (stored === "0") setDockOverride(false);
  }, []);
  const dockVisible = dockOverride ?? isTouch;
  const toggleInputDock = useCallback(() => {
    setDockOverride((prev) => {
      const next = !(prev ?? isTouch);
      window.localStorage.setItem("ao:terminalInputDock", next ? "1" : "0");
      return next;
    });
  }, [isTouch]);
```

(`useState`, `useEffect`, `useCallback` are already imported in this file.)

(c) Pass the toggle to the header (the `<SessionDetailHeader ... />` element):

```tsx
        inputDockVisible={dockVisible}
        onToggleInputDock={toggleInputDock}
```

(d) Render the dock at the bottom of the terminal column. Inside the
`session-workspace__main` div, immediately AFTER the terminal ternary block (after the
`)}` that closes `!showTerminal ? ... : terminalEnded ? ... : (<DirectTerminal .../>)`)
and BEFORE that div closes:

```tsx
          {showTerminal && !terminalEnded && dockVisible ? (
            <MobileTerminalInputDock sessionId={session.id} projectId={session.projectId} />
          ) : null}
```

- [ ] **Step 3: Write a test for the integration**

Add to `packages/web/src/components/__tests__/SessionDetail.desktop.test.tsx` (it already
imports `render`, `screen`, `within`, `makeSession`):

```typescript
  it("renders the input dock when forced on via the toggle", () => {
    render(
      <SessionDetail
        session={makeSession({ id: "app-1", projectId: "my-app", status: "working", activity: "active" })}
        projects={[{ id: "my-app", name: "My App", path: "/tmp/my-app" }]}
      />,
    );
    // Dock hidden by default on a non-touch (desktop) viewport.
    expect(screen.queryByLabelText("Terminal input")).not.toBeInTheDocument();
    // Toggle it on.
    fireEvent.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Toggle on-screen keyboard",
      }),
    );
    expect(screen.getByLabelText("Terminal input")).toBeInTheDocument();
  });
```

Ensure `fireEvent` is imported in that test file (add to the existing
`@testing-library/react` import if missing).

NOTE: this test relies on the real `MuxProvider`. If `SessionDetail` tests don't already
wrap in `MuxProvider`, mock it at the top of the test file:
`vi.mock("@/providers/MuxProvider", () => ({ useMux: () => ({ writeTerminal: vi.fn() }), useMuxOptional: () => undefined }));`
Check the file's existing mocks first and only add what's missing.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @aoagents/ao-web test -- SessionDetail.desktop`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/SessionDetail.tsx packages/web/src/components/SessionDetailHeader.tsx packages/web/src/components/__tests__/SessionDetail.desktop.test.tsx
git commit -m "feat(web): wire mobile input dock + toggle into SessionDetail"
```

---

## Task 5: Full verification

- [ ] **Step 1: Typecheck web**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors.

- [ ] **Step 2: Run the new + adjacent web tests**

Run: `pnpm --filter @aoagents/ao-web test -- terminal-keys useSpeechRecognition MobileTerminalInputDock SessionDetail`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 0 errors. Fix any unused imports / type-import issues introduced. (67 pre-existing warnings in unrelated files are expected.)

- [ ] **Step 4: Manual smoke (optional — requires a tablet or `pointer: coarse` emulation)**

After `ao stop && ao start --rebuild --restore`, open a session on a tablet (or Chrome
devtools touch emulation): the dock appears; tapping Esc/Ctrl-C/arrows/Enter drives the
TUI; typing + Send submits a line; the 🎤 button (HTTPS only) dictates into the textarea;
the keyboard toggle in the header shows/hides the dock.

- [ ] **Step 5: Final commit (if lint/typecheck required fixes)**

```bash
git add -A
git commit -m "chore(web): lint/typecheck fixes for input dock"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Key bar (Esc/Ctrl-C/Tab/arrows/Enter) → Task 1 (map) + Task 3 (buttons). ✅
- Input bar text → Enter on Send → Task 3 (`sendText` = text + `\r`, clear). ✅
- Mic button (Web Speech API, feature-detected, secure-context, transcribe→textarea, no auto-send) → Task 2 + Task 3. ✅
- OS-keyboard dictation free → real `<textarea>` with autocorrect/capitalize/spellcheck off (Task 3). ✅
- Raw bytes via existing `writeTerminal` → Task 3 (`useMux().writeTerminal`). ✅
- Visibility = touch (`pointer: coarse`) ?? manual toggle, persisted → Task 4. ✅
- Toggle button in terminal toolbar → Task 4 (SessionDetailHeader). ✅
- xterm additive (no `disableStdin`) → nothing touches xterm config. ✅
- visualViewport keeps dock above keyboard (progressive enhancement) → Task 3 (imperative CSS var). ✅
- Tailwind/dark/no-UI-libs/≥40px targets/≤400 lines → Task 3 styling. ✅
- Tests for map, hooks, component, toggle → Tasks 1–4. ✅
- useIsTouch replaced by `useMediaQuery("(pointer: coarse)")` (documented deviation). ✅

**Placeholder scan:** none — every code/test step is complete; commands have expected output.

**Type consistency:** `TERMINAL_KEYS`/`TerminalKey` used identically in Tasks 1 & 3;
`useSpeechRecognition(onTranscript)` signature matches its use; `MobileTerminalInputDock`
props `{ sessionId, projectId? }` match the render in Task 4; `writeTerminal(id, data,
projectId?)` matches `MuxContextValue` (`MuxProvider.tsx:17`).
