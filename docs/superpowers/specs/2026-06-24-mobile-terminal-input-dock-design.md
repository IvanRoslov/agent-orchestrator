# Mobile Terminal Input Dock — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan
**Research:** [docs/superpowers/research/2026-06-24-tablet-terminal-input.md](../research/2026-06-24-tablet-terminal-input.md)

## Problem

With a Cloudflare tunnel / LAN access the AO dashboard already opens on a tablet, but
the xterm.js terminal is unusable on touch: you can't reliably bring up the keyboard,
can't position the cursor, and the special keys a TUI like Claude Code constantly needs
(Esc, Ctrl-C, arrows, Enter, Tab) aren't available on a glass keyboard. Voice input is
also wanted, ideally working natively in the dashboard.

## Goals

- Make a session's terminal usable on a tablet for driving Claude Code: send text, send
  the missing special keys, and use voice — without a physical keyboard.
- Reuse the existing input path (raw bytes to the PTY) and the existing ANSI-injection
  pattern; do not fight xterm's touch internals.

## Non-goals (v1 / YAGNI)

- A general sticky Ctrl modifier or customizable key set.
- Auto-send on voice; recognition-language picker.
- Using the `/api/sessions/[id]/send` agent pipeline (we use raw `writeTerminal` only).
- Replacing xterm input — the dock is **additive**; native xterm input stays for
  Bluetooth-keyboard users.

## How input works today (grounding)

All terminal input is raw bytes written to the PTY:
`xterm.onData(data)` (`useXtermTerminal.ts:376`) → `writeTerminal(sessionId, data, projectId)`
(`MuxProvider.tsx:338`) → WS `{ch:"terminal",type:"data",data}` → `pty.write(data)`
(`mux-websocket.ts:783`). The repo already injects ANSI sequences this way — touch-scroll
sends arrow keys and the tmux prefix (`terminal-touch-scroll.ts:152`). `writeTerminal` is
exposed via the Mux context (`useMux`/`useMuxOptional` from `@/providers/MuxProvider`).
`SessionDetail` renders `DirectTerminal` and (on `useMediaQuery(MOBILE_BREAKPOINT=767)`)
`MobileBottomNav`; there is no terminal input UI today.

## Architecture

A new **dock** rendered by `SessionDetail` at the bottom of the terminal pane (above
`MobileBottomNav`). It produces bytes and sends them through the existing
`writeTerminal(sessionId, bytes, projectId)` — the same path xterm and touch-scroll use.
Whether or not xterm itself is focused, the dock's bytes reach the PTY.

```
┌─ xterm terminal (display; native input still allowed) ───────┐
│  ...agent output...                                          │
├─ key bar:  [Esc][Ctrl-C][Tab]  [←][↑][↓][→]  [Enter] ───────┤
├─ input bar: [ 🎤 | <textarea> message… ]            [ Send ] │
└──────────────────────────────────────────────────────────────┘
            (translated up to sit above the soft keyboard)
```

## Components (small, isolated, testable)

1. **`lib/terminal-keys.ts`** — pure map of key → byte sequence:
   `Esc=\x1b`, `Enter=\r`, `Ctrl-C=\x03`, `Tab=\t`, `Up=\x1b[A`, `Down=\x1b[B`,
   `Right=\x1b[C`, `Left=\x1b[D`. The single source of truth for what each button emits.
2. **`hooks/useIsTouch.ts`** — `matchMedia("(pointer: coarse)")` → boolean (reactive).
3. **`hooks/useSpeechRecognition.ts`** — thin wrapper over
   `window.SpeechRecognition || window.webkitSpeechRecognition`. Returns
   `{ supported, listening, start(), stop() }` and streams interim+final transcript via a
   callback. `supported` is false when the API is missing OR the page is not a secure
   context (`window.isSecureContext`). Feature-detected; no throw when unsupported.
4. **`components/MobileTerminalInputDock.tsx`** — the dock. Props: `sessionId`,
   `projectId?`. Gets `writeTerminal` from the Mux context. Renders the key bar (from
   `terminal-keys`) and the input bar (textarea + mic + Send). Owns input text state and
   the `visualViewport` offset. Stays well under 400 lines; if it grows, split the key bar
   into a `TerminalKeyBar` subcomponent.
5. **`components/SessionDetail.tsx`** (modify) — render the dock when visible; add the
   toggle button.

## Data flow

- `sendBytes(bytes)` = `writeTerminal(sessionId, bytes, projectId)`.
- **Send button:** `sendBytes(text + "\r")` then clear the textarea. (Decision: text+Enter
  in one tap.)
- **Each key button:** `sendBytes(KEY_BYTES[key])`. `Enter` is also a standalone key
  (bare `\r`) for when you typed/dictated without submitting or need a plain Enter.
- **Mic button:** toggles `useSpeechRecognition`; interim+final transcripts are written
  into the textarea (not sent). The user reviews and taps Send. (Decision: transcribe →
  Send, no auto-send.)

## Visibility & toggle

- Default visible when `useIsTouch()` is true (covers iPad incl. landscape, which is wider
  than 767px). A manual toggle (keyboard icon in the terminal toolbar) overrides: it can
  force the dock on (desktop + tunnel) or off. Toggle state persisted in `localStorage`
  (per-user, not per-session). Effective visibility = `manualOverride ?? isTouch`.

## Voice (two layers)

- **OS keyboard dictation** — free: the input bar is a real `<textarea>` with
  `autoCorrect/autoCapitalize/spellCheck=off`, so tapping the iPad keyboard's mic dictates
  into it with zero code.
- **In-dock mic button** — `useSpeechRecognition`; visible only when `supported`. Live
  interim results fill the textarea; final result is left for the user to Send. Handles
  permission/`not-allowed`/`no-speech` errors quietly (optional toast). Requires a secure
  context — works over the CF tunnel; hidden on plain-HTTP LAN (where the OS-keyboard mic
  still works).

## Viewport handling

The dock is positioned at the bottom of the terminal pane and translated up by the soft
keyboard's height using `window.visualViewport` (`resize`/`scroll`) so it stays visible
while typing. Progressive enhancement: when `visualViewport` is unavailable, the dock
stays at the bottom.

## xterm changes

Additive only — `disableStdin` is NOT set; native xterm focus/typing remains as a fallback
for Bluetooth keyboards. The dock never needs xterm focus (bytes go via `writeTerminal`).

## Styling & constraints

Tailwind utility classes + `var(--color-*)` tokens, dark theme, no inline styles, no UI
libraries. Touch targets ≥40px. Key labels in the mono font. Reuse existing button token
classes where they fit. Each component ≤400 lines.

## Testing

- `terminal-keys`: asserts every key maps to the exact byte sequence.
- `useIsTouch`: mock `matchMedia` → true/false.
- `useSpeechRecognition`: mock `window.webkitSpeechRecognition` + `isSecureContext` →
  `supported` true/false; start/stop drives listening; transcript callback fires.
- `MobileTerminalInputDock`: clicking each key calls `writeTerminal` with the right bytes;
  typing + Send calls `writeTerminal(text + "\r")` and clears; the standalone Enter key
  sends `\r`; the mic button renders only when speech is supported.
- Toggle: visibility follows touch by default and flips with the toggle (persisted).

## File structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `packages/web/src/lib/terminal-keys.ts` | key→bytes map | New |
| `packages/web/src/lib/__tests__/terminal-keys.test.ts` | map test | New |
| `packages/web/src/hooks/useIsTouch.ts` | touch detection | New |
| `packages/web/src/hooks/__tests__/useIsTouch.test.ts` | hook test | New |
| `packages/web/src/hooks/useSpeechRecognition.ts` | speech wrapper | New |
| `packages/web/src/hooks/__tests__/useSpeechRecognition.test.ts` | hook test | New |
| `packages/web/src/components/MobileTerminalInputDock.tsx` | the dock | New |
| `packages/web/src/components/__tests__/MobileTerminalInputDock.test.tsx` | dock test | New |
| `packages/web/src/components/SessionDetail.tsx` | render dock + toggle | Modify |

## Open risks

- **iPad Safari Web Speech API is supported (14.5+) but flaky** (needs Siri enabled, sends
  audio to Apple, variable accuracy). Acceptable because OS-keyboard dictation is the
  reliable baseline and the mic button is a feature-detected enhancement.
- **`visualViewport` keyboard inset** varies across browsers; treat as progressive
  enhancement, never block input on it.
- **Deployment:** this is web; it only reaches the running dashboard after a rebuild
  (`ao stop && ao start --rebuild`).
