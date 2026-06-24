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
