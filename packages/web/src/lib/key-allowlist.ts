// Allowlist of tmux send-keys tokens the transcript view may send. Digits 0-9
// select a numbered prompt option; the rest are navigation/submit/interrupt keys.
// Kept in lib (not the route file) because Next.js App Router route modules may
// only export route handlers — a non-handler export breaks `next build`.
const ALLOWED = new Set([
  "Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "C-c",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

/** Validate the requested key tokens against the allowlist. Returns null if invalid. */
export function validateKeyTokens(tokens: unknown): string[] | null {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 8) return null;
  if (!tokens.every((t) => typeof t === "string" && ALLOWED.has(t))) return null;
  return tokens as string[];
}
