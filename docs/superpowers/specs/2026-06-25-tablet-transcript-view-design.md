# Tablet Transcript + Composer View — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Research:** [docs/superpowers/research/2026-06-25-tablet-session-view-v2.md](../research/2026-06-25-tablet-session-view-v2.md)

## Problem

The xterm.js terminal over a shared tmux PTY is too fragile on a tablet: it reflows/jumps,
breaks badly when the same session is open on desktop + tablet at once (clients fight over
the one PTY's size), traps you in tmux copy-mode on scroll, and Claude's TUI interactive
prompts sometimes hang with no clear way to answer. The v1 input dock helped only partially.

## Goal

A tablet-first session view that does NOT use xterm/PTY: render the agent conversation as a
scrollable transcript, send commands/messages through the agent pipeline, and turn
interactive prompts into an explicit choice card — fixing the fragility at its source.

## Non-goals (v1 / YAGNI)

- Non-Claude agents (transcript source is Claude Code's JSONL); other agents fall back to the
  raw terminal.
- Running arbitrary interactive TUIs (vim/htop) from this view — use the raw-terminal toggle.
- Token-by-token live streaming, and showing `thinking` blocks by default.

## Decisions (from brainstorm)

- **Routing:** Hybrid. On touch devices (`pointer: coarse`) a session opens in the transcript
  view by default, with a **Raw terminal** toggle to the existing xterm. On desktop, xterm
  stays default; the transcript view is reachable via the same toggle. (Reuse the v1 toggle
  pattern + localStorage override.)
- **Transcript content:** user/assistant text + **collapsible** tool calls (name + input) and
  their results. `thinking` hidden in v1.
- **Refresh:** client polls a transcript endpoint every ~4s.
- **Actions:** composer (text + voice) + Approve/Deny via a richer **prompt card** + Interrupt.
- **Claude-only v1.**

## Liveness

The transcript updates **incrementally**, not only at the end: Claude appends each assistant
message, `tool_use`, and `tool_result` to its JSONL as steps complete, so ~4s polling surfaces
them step-by-step. There is no token-level streaming (we deliberately avoid the live PTY). A
**status indicator** makes progress legible between entries, derived from existing activity
detection: `working` (active — optionally "Running <tool>…" from `.ao/activity.jsonl` trigger),
`waiting for you` (`waiting_input` → prompt card), `idle / done`.

## Architecture

Two read paths, both server-side where the dashboard runs:

1. **Transcript** — `GET /api/sessions/[id]/transcript` parses the Claude JSONL at
   `~/.claude/projects/<slug>/<uuid>.jsonl` (uuid from `session.metadata.claudeSessionUuid`;
   reuse the plugin's existing tail parser) into an ordered list of normalized entries. Returns
   `{ entries, status, prompt }` where `status` is the activity state and `prompt` (when
   `waiting_input`) is the parsed current prompt (see below). Client polls every 4s.
2. **Send / act** — composer messages, prompt answers, choice selections, and Interrupt are
   delivered through the agent pipeline (`sessionManager.send` / existing POST
   `/api/sessions/[id]/send`) which does tmux `send-keys` to the session — **no PTY client, no
   resize conflict**. The exact byte(s) for a numbered choice / custom answer / Interrupt (Esc)
   are an implementation spike (digit + Enter vs arrows + Enter vs literal text).

No second PTY is attached, so the desktop xterm and the tablet transcript can run at once
without fighting; there is no xterm on this view, so no copy-mode and no reflow.

## Components (web, isolated)

- `SessionTranscriptView.tsx` — container: status header + transcript list + prompt card +
  composer. Owns the 4s poll and the Raw-terminal toggle. Gated by touch ?? localStorage
  override (same pattern as the v1 dock).
- `TranscriptMessageList.tsx` — renders normalized entries: user / assistant text, collapsible
  tool-call (name+input) and tool-result blocks. Auto-scrolls to bottom unless the user
  scrolled up (native scroll).
- `PromptCard.tsx` — shown when `status = waiting_input`. Contains:
  1. the prompt question text;
  2. **option buttons** for the agent's actual choices (parsed numbered list);
  3. a **free-text "your answer"** row (custom response to this prompt);
  4. a **"Chat it" / Discuss** button — routes to the composer to talk it through instead of
     committing to an option;
  5. **Interrupt** (stop / Esc).
  Fallback when options can't be parsed: show the raw prompt text + a generic Approve/Deny +
  the free-text row.
- `TranscriptComposer.tsx` — textarea + 🎤 (reuse `useSpeechRecognition`) + Send → posts to the
  send API. (Distinct from the v1 PTY dock; this one uses the agent pipeline.)
- Server: `lib/claude-transcript.ts` — parse the JSONL into normalized entries (pure, testable);
  `lib/terminal-prompt.ts` — parse a `tmux capture-pane` snapshot into `{ question, options }`
  (pure, testable). The transcript route composes these.

## Data flow

```
poll 4s ── GET /api/sessions/[id]/transcript
             ├─ parse Claude JSONL  ──► entries[]
             ├─ read .ao/activity.jsonl ──► status (working/waiting_input/idle)
             └─ if waiting_input: tmux capture-pane (read-only) ──► prompt {question, options}
client renders: status badge + TranscriptMessageList + (PromptCard if prompt) + Composer

action (choice / answer / discuss / interrupt / compose)
   └─ POST /api/sessions/[id]/send  ──► sessionManager.send ──► tmux send-keys (no PTY client)
```

## Prompt parsing (the interactive crux)

When `status = waiting_input`, the server captures the session's current screen
(`tmux capture-pane -t <target> -p`, read-only — no resize) and `terminal-prompt.ts` extracts
the question and any numbered options. Claude's permission prompts are a small known set
(allow once / allow & don't ask / no — tell Claude what to do), so the parser targets that
shape first and degrades to "raw text + Approve/Deny + free answer" otherwise. Selecting an
option / submitting an answer / interrupting maps to keystrokes via the send pipeline; that
mapping is verified with a quick spike during implementation and centralized in one module.

## Constraints

Web-only. Tailwind v4 tokens (`var(--color-*)`), dark theme, no inline `style=`, no UI
libraries, ≥40px touch targets, ≤400 lines/component, vitest + @testing-library/react tests.

## Testing

- `claude-transcript.ts`: parses a sample JSONL into ordered normalized entries (user, assistant
  text, tool_use, tool_result); ignores `thinking`/`summary` noise.
- `terminal-prompt.ts`: parses a captured permission prompt into `{ question, options[] }`;
  returns null/fallback when no options are present.
- `SessionTranscriptView`: renders entries from a mocked transcript fetch; shows the status
  badge; polls.
- `PromptCard`: renders option buttons + free-text + Chat-it + Interrupt; clicking an option /
  submitting an answer / interrupt calls the send action with the expected payload; fallback
  renders Approve/Deny when no options.
- `TranscriptComposer`: text + Send posts the message; mic gated on speech support (reuse).
- Routing/toggle: transcript default on touch, raw-terminal toggle persists.

## Open risks

- **Choice→keystroke mapping** (the spike): what Claude's prompt accepts (digit vs arrow+Enter),
  and Interrupt = Esc. Centralize in one module; fall back to free-text answer if unreliable.
- **`tmux capture-pane` availability/parse**: read-only and safe, but prompt layouts vary;
  always provide the raw-text + free-answer fallback so the user is never stuck.
- **JSONL path resolution**: depends on the workspace-path slug + `claudeSessionUuid`; reuse the
  plugin's existing finder; if the file isn't found, show a clear empty state + the Raw-terminal
  toggle.
- **Deployment:** web-only; appears in the running dashboard only after `ao start --rebuild`.
