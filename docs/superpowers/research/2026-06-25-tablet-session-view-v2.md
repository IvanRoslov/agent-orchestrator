# Research: Tablet session view v2 — fixing terminal fragility

**Date:** 2026-06-25
**Status:** Research / options (no implementation)
**Follows:** [2026-06-24-tablet-terminal-input.md](2026-06-24-tablet-terminal-input.md) (the input dock — partial help)

## Pains (reported)

1. The xterm terminal is fragile — it constantly jumps/reflows.
2. Opening the same session on desktop AND tablet at once breaks badly.
3. Claude's TUI sometimes enters interactive mode; arrow keys work sometimes, then everything stops responding.
4. Scrolling breaks the view, and you can't get back to the input line.

## Root causes (from codebase research)

- **Shared PTY, no per-client size (the desktop+tablet breakage).** One tmux/node-pty per session is shared by all browser clients; every client's `resize` calls `pty.resize(cols,rows)` on the *same* PTY (`mux-websocket.ts:793`, `MuxProvider.tsx:378`). Two clients of different sizes fight; the TUI redraws at the wrong width. (tmux default resizes the window to the *smallest* client — confirmed externally.)
- **Copy-mode scroll trap.** Touch scroll in the alternate buffer enters tmux copy-mode (`sendData(prefix + "[")`) and only ever sends arrow keys — there's no auto-exit, so you're stuck until you send `q`/Esc (`terminal-touch-scroll.ts:154`). That's why you can't return to the input line.
- **TUI interactivity over a raw PTY** is inherently brittle on touch (focus, key events, alternate-screen redraws) — xterm.js mobile is a known weak spot.

## Key enabling findings

- **The full Claude conversation is on disk as JSONL** at `~/.claude/projects/<slug>/<uuid>.jsonl` (uuid in `session.metadata.claudeSessionUuid`). It's a `parentUuid`-linked chain of typed records; `message.content` holds blocks: `text`, `thinking`, `tool_use {name,input}`, `tool_result`, plus `usage`. AO already parses its tail (`agent-claude-code/src/index.ts:708`). Prior art renders this exact format as **mobile-friendly chat** (claude-code-log, claude-code-transcripts, claude-JSONL-browser). → A clean, scrollable transcript is very buildable.
- **Interactive state is already detected, hook-based.** Claude hooks write `{workspace}/.ao/activity.jsonl`; `checkActivityLogState()` (`core/activity-log.ts:137`) returns `waiting_input`/`blocked` with a `trigger` (the tool requesting permission). → A non-terminal view can show "agent is waiting for approval (Bash)" and offer Approve/Deny.
- **Sending doesn't need xterm.** `sessionManager.send()` (POST `/api/sessions/[id]/send`) injects into the agent's input queue, waits for readiness, works with no PTY client attached. → A composer can send prompts and approve/deny keystrokes reliably.

## Options

### Option A — Harden the live xterm terminal
Keep the PTY terminal; reduce fragility: set tmux `window-size latest` + `aggressive-resize on`; track per-client size and don't let a background client shrink the active one; auto-exit copy-mode after touch scroll (send `q`) and add a visible "live"/"scrolled" indicator; pin a sane size on tablet.
- **Pros:** one code path; full interactivity (vim, etc.).
- **Cons:** still a raw TUI over touch — interactive mode, focus, and redraws stay brittle; multi-client never fully clean; lots of fiddly edge-cases. Improves but doesn't solve.

### Option B — Tablet "transcript + composer" view (radical; recommended to pursue)
A tablet-specific session screen that does NOT use xterm/PTY:
1. **Transcript** — render the Claude JSONL as a scrollable chat (user / assistant text / tool calls + results / thinking optional). Native scroll, no copy-mode, no reflow. Auto-refresh (poll the JSONL or reuse the SSE/mux cadence).
2. **Composer** — a text/voice input that sends via `sessionManager.send()` (the dock's key bar isn't needed here since there's no live TUI to drive char-by-char).
3. **Interactive mode** — when `activity.jsonl` shows `waiting_input`, surface the prompt (with the `trigger` tool name) and show **Approve / Deny / custom reply** buttons that `send` the right response. No more silent hangs.
- **Pros:** sidesteps every root cause — no shared-PTY resize fight (it never attaches a PTY client), no copy-mode, no xterm touch bugs; readable on a tablet; desktop xterm and tablet transcript can run at once without conflict (different read paths). Matches the user's "full output as text + send command + handle interactive" idea.
- **Cons:** not a real terminal — can't run arbitrary interactive TUIs (vim/htop) from it; approve/deny needs reliable mapping of prompt→keystroke; transcript is Claude-Code-specific (other agents need their own source or a fallback).

### Option C — Hybrid (B primary on tablet, A as fallback)
Default tablet sessions to the transcript+composer view; keep a "raw terminal" toggle for when you truly need the live TUI. Optionally apply the cheap tmux `window-size latest` tweak so the raw terminal is less awful when used.

## Recommendation

Pursue **Option B** as the tablet session view, structured so it can become the default on touch, with the raw terminal still reachable (Hybrid C). It removes the fragility at the source rather than patching xterm. The tmux `window-size latest`/`aggressive-resize` tweak is a cheap, independent win worth taking regardless (helps anyone using the live terminal multi-client).

Interactive mode is the crux: the transcript view turns "silent hang in the TUI" into an explicit Approve/Deny affordance driven by the already-existing `waiting_input` detection — arguably better than the terminal even on desktop.

## Open questions for the brainstorm

1. **Scope of the transcript view:** read-only transcript + composer + approve/deny only? Or also a few quick keys (Esc/Enter) for edge cases?
2. **Interactive handling:** how to map Approve/Deny to what Claude expects — send a literal reply via `sessionManager.send` (e.g. "yes"/"no"), or send the raw selection keystroke? What does Claude's permission prompt accept? (Needs a small spike.)
3. **Refresh model:** poll the JSONL on an interval, or piggyback the existing mux/SSE session stream? How live must the transcript feel?
4. **Default vs toggle:** make the transcript view the default on touch (Hybrid), or a separate route/tab the user opts into?
5. **Non-Claude agents:** Claude-only v1 (fallback to terminal for others), or design the transcript source as pluggable now?
6. **Composer reuse:** reuse the v1 input dock's textarea + voice + Send, dropping the key bar; or a fresh composer?

## Sources
- tmux multi-client window sizing — https://mutelight.org/practical-tmux , https://github.com/freddieventura/tmux-resize-window-n-largest
- Claude Code JSONL format + viewers — https://github.com/daaain/claude-code-log , https://github.com/simonw/claude-code-transcripts , https://github.com/withLinda/claude-JSONL-browser , https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b
