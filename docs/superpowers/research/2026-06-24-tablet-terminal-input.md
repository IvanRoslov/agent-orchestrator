# Research: Making the AO dashboard terminal usable on a tablet

**Date:** 2026-06-24
**Status:** Research / options (no implementation)
**Problem:** With CF tunnel + LAN access the dashboard already works on a tablet, but the
xterm.js terminal is unusable on touch: you can't reliably bring up the keyboard,
can't position the cursor, and special keys (Esc, Ctrl-C, arrows, Enter) aren't
available — which a TUI like Claude Code constantly needs.

## How the AO terminal works today (grounding)

- Input path: `xterm.onData(data)` → `writeTerminal(sessionId, data)` (MuxProvider) →
  WS `{ch:"terminal",type:"data",data}` → `mux-websocket.ts` → `pty.write(data)`.
  So **all input is just raw bytes written to the PTY** (`useXtermTerminal.ts:376`,
  `MuxProvider.tsx:338`, `mux-websocket.ts:783`).
- The codebase **already injects ANSI control sequences** through this same path:
  touch-scroll sends arrow keys (`\x1b[A`/`\x1b[B`) and the tmux prefix to drive
  copy-mode (`terminal-touch-scroll.ts:152`). So a custom input layer is proven-feasible.
- A **separate, non-terminal send path** exists: `POST /api/sessions/[id]/send` →
  `sessionManager.send()` (agent send pipeline with idle-wait), used by `ao send`.
- Mobile scaffolding exists: `useMediaQuery(MOBILE_BREAKPOINT=767)`, `MobileBottomNav`
  (nav only — **no terminal input UI today**). Touch scroll works; typing does not.
- Constraints: Tailwind only, dark theme, no UI libs, ≤400 lines/component, tests
  required (CLAUDE.md / DESIGN.md).

## What the ecosystem does (external research)

- **xterm.js mobile typing is a known, unsolved-by-default problem.** Long-standing
  issues: focusing the hidden `xterm-helper-textarea` on touch is unreliable, and
  predictive/autocorrect keyboards corrupt input; iOS smart-keyboard arrow keys don't
  fire key events ([#1101](https://github.com/xtermjs/xterm.js/issues/1101),
  [#2403](https://github.com/xtermjs/xterm.js/issues/2403),
  [discussion #5227](https://github.com/xtermjs/xterm.js/discussions/5227)). Partial
  hacks: switch the helper textarea to `<input type="password">` to defeat predictive
  text; toggle `disabled` on `.xterm-helper-textarea` to control the soft keyboard;
  Chrome's [VirtualKeyboard API](https://developer.chrome.com/docs/web-platform/virtual-keyboard/)
  for layout. None of these give you the missing keys.
- **The universal pattern for TUIs on touch is an on-screen special-keys toolbar.**
  Every serious mobile terminal ships one because "glass keyboards do not give you
  ESC, CTRL, ALT, or arrow keys for free": Termux extra-keys
  ([docs](https://mobile-coding-hub.github.io/termux/customisation/extra_keys/)),
  Blink Shell, and notably **Cosyra's "Claude Code on phone" guide** which states a
  toolbar exposing ESC/CTRL/ALT/arrows makes "short AI coding loops and terminal
  navigation fine on the glass keyboard"
  ([cosyra](https://cosyra.com/guides/tui-apps-on-phone.html)).
- **Cursor positioning is not a terminal feature.** You navigate with arrow keys, not
  tap-to-position — so the toolbar's arrows are the answer, not a click-to-move-cursor.

## Options

### Option A — Patch xterm's own touch input
Focus `.xterm-helper-textarea` on tap; swap it to `type="password"` to stop predictive
corruption; disable autocorrect.
- **Pros:** smallest change; keeps a single input surface.
- **Cons:** fragile across iOS/Android; fights xterm internals (`allowProposedApi`,
  WebGL); **still no Esc/Ctrl/arrows** → insufficient for Claude Code. Not enough alone.

### Option B — Mobile terminal input dock (RECOMMENDED)
Keep xterm as a **read-only display** on touch; add a docked input layer:
1. **Input bar** — a normal `<textarea>` (native keyboard works perfectly; set
   `autocorrect/autocapitalize/spellcheck=off`, `inputmode`). On "send", write its text
   to the PTY via the existing `writeTerminal` path (optionally followed by Enter).
   Tapping it opens the soft keyboard natively — no xterm focus hacks.
2. **Special-keys toolbar** — Esc `\x1b`, Enter `\r`, Ctrl-C `\x03`, Tab `\t`,
   ↑↓←→ `\x1b[A/B/C/D`, plus a sticky **Ctrl** modifier. Each injects bytes via
   `writeTerminal` — the exact mechanism touch-scroll already uses.
3. Handle keyboard overlap with `visualViewport`/VirtualKeyboard API so the dock stays
   above the soft keyboard.
- **Pros:** robust (sidesteps every xterm touch bug); reuses the raw-PTY path + the
  proven ANSI-injection pattern; gives the missing keys; matches the industry pattern
  (Termux/Blink/Cosyra); works for Claude Code (Esc to interrupt, arrows, Enter, Ctrl-C).
- **Cons:** new mobile UI (a dock component + tests); two input affordances instead of
  one. Input bar is line-oriented, not char-by-char live editing (fine for prompts;
  the key toolbar covers interactive control).

### Option C — Chat-style composer via `/api/sessions/[id]/send`
A message box that posts to the existing send API (agent pipeline).
- **Pros:** simplest; great for "send the agent a prompt"; reuses tested infra.
- **Cons:** goes through the agent send pipeline, **not raw keystrokes** — can't drive
  the TUI in real time (no Esc/Ctrl-C/arrows). Good as a *complement*, not a replacement.

## Recommendation

**Option B**, optionally folding in C as one button. Rationale: AO's input is already
"raw bytes to the PTY," and the repo already injects ANSI sequences that way, so an
input bar + special-keys toolbar map directly onto existing infrastructure and avoid
fighting xterm's touch input. It's the same pattern every mobile TUI client converges
on, and it's exactly what Claude Code needs (interrupt, navigate, confirm).

Suggested scope for a first cut (gated on `useMediaQuery(MOBILE_BREAKPOINT)` or a
manual toggle): read-only xterm on touch + a `MobileTerminalInputDock` component
(textarea "send" + key bar with Esc/Enter/Ctrl-C/Tab/arrows/Ctrl) delivering via
`writeTerminal`, with `visualViewport` handling. Tests for the byte mappings.

## Open questions for the design phase

1. Show the dock only on touch/narrow viewports, or always (with a toggle), so it works
   on a desktop with a tunnel too?
2. Input-bar send semantics: send text **then Enter** (one tap) vs. send text and keep
   Enter as a separate key (lets you compose multi-line / control when to submit)?
3. Which keys in the bar v1 (Esc, Enter, Ctrl-C, Tab, ↑↓←→, Ctrl) and is a Ctrl
   modifier worth it vs. a fixed Ctrl-C button?
4. Keep the xterm fully read-only on touch, or still allow its native focus as a
   fallback for users with a Bluetooth keyboard?

## Sources

- xterm.js mobile support — https://github.com/xtermjs/xterm.js/issues/1101
- xterm.js predictive keyboard — https://github.com/xtermjs/xterm.js/issues/2403
- xterm.js selection/focus discussion — https://github.com/xtermjs/xterm.js/discussions/5227
- Chrome VirtualKeyboard API — https://developer.chrome.com/docs/web-platform/virtual-keyboard/
- Termux extra-keys — https://mobile-coding-hub.github.io/termux/customisation/extra_keys/
- Cosyra "TUI apps (Claude Code) on phone" — https://cosyra.com/guides/tui-apps-on-phone.html
