# Tablet Transcript + Composer View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-xterm tablet session view that renders the Claude Code conversation from its JSONL as a scrollable transcript, surfaces interactive prompts as a choice card, and sends via the agent pipeline / tmux send-keys — fixing the fragile-terminal-on-tablet pains.

**Architecture:** Web-only (`packages/web`), Claude-only v1. Two read paths server-side: a transcript endpoint that parses Claude's JSONL (+ reads activity state, + captures the current prompt when waiting) and the existing send path plus a small new `keys` endpoint (tmux send-keys) for control/selection. The client polls the transcript every 4s and renders transcript + status + prompt card + composer. No PTY client is attached, so it never fights the desktop xterm's size and has no copy-mode.

**Tech Stack:** Next.js 15 / React 19, TypeScript strict, Tailwind v4 (`var(--color-*)`), Vitest + @testing-library/react. Reuse `@aoagents/ao-plugin-agent-claude-code` (`toClaudeProjectPath`, `resolveWorkspaceForClaude`), `@/hooks/useSpeechRecognition`, `packages/web/server/tmux-utils` (`findTmux`, `resolveTmuxSession`).

**Spec:** `docs/superpowers/specs/2026-06-25-tablet-transcript-view-design.md`

**Note:** web-only; appears in the running dashboard only after `ao start --rebuild`.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `packages/web/src/lib/claude-transcript.ts` | pure: parse Claude JSONL text → normalized `TranscriptEntry[]` | New |
| `packages/web/src/lib/__tests__/claude-transcript.test.ts` | parser tests | New |
| `packages/web/src/lib/terminal-prompt.ts` | pure: parse a tmux capture → `{ question, options }` \| null | New |
| `packages/web/src/lib/__tests__/terminal-prompt.test.ts` | prompt-parser tests | New |
| `packages/web/src/lib/transcript-service.ts` | server: resolve JSONL path (slug+uuid), read+parse, read activity, capture prompt → `buildTranscript(session, deps)` (deps injected) | New |
| `packages/web/src/lib/__tests__/transcript-service.test.ts` | service test (injected deps) | New |
| `packages/web/src/app/api/sessions/[id]/transcript/route.ts` | GET → `buildTranscript` | New |
| `packages/web/src/app/api/sessions/[id]/keys/route.ts` | POST → tmux send-keys (allowlisted tokens) | New |
| `packages/web/src/lib/__tests__/keys-route.test.ts` | keys validation test | New |
| `packages/web/src/lib/transcript-types.ts` | shared client/server types (`TranscriptEntry`, `TranscriptResponse`, `TranscriptPrompt`) | New |
| `packages/web/src/components/TranscriptMessageList.tsx` | render entries (message / collapsible tool_use / tool_result) | New |
| `packages/web/src/components/PromptCard.tsx` | options + free answer + Chat-it + Interrupt | New |
| `packages/web/src/components/TranscriptComposer.tsx` | textarea + voice + Send (/api/send) | New |
| `packages/web/src/components/SessionTranscriptView.tsx` | container: poll + status + list + prompt + composer | New |
| `packages/web/src/components/__tests__/*.test.tsx` | component tests (one per component) | New |
| `packages/web/src/components/SessionDetail.tsx` | transcript-vs-terminal toggle + render | Modify |
| `packages/web/src/components/SessionDetailHeader.tsx` | "Transcript / Terminal" toggle button | Modify |

---

## Task 1: Transcript types + JSONL parser

**Files:**
- Create: `packages/web/src/lib/transcript-types.ts`, `packages/web/src/lib/claude-transcript.ts`
- Test: `packages/web/src/lib/__tests__/claude-transcript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/__tests__/claude-transcript.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseTranscriptJsonl } from "../claude-transcript";

describe("parseTranscriptJsonl", () => {
  it("parses string-content user/assistant messages", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { role: "user", content: "fix the bug" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "Done!" } }),
    ].join("\n");
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "message", role: "user", text: "fix the bug" },
      { kind: "message", role: "assistant", text: "Done!" },
    ]);
  });

  it("parses assistant content blocks (text + tool_use) and tool_result", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running tests" },
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "2 passed", is_error: false }],
        },
      }),
    ].join("\n");
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "message", role: "assistant", text: "Running tests" },
      { kind: "tool_use", name: "Bash", input: '{"command":"npm test"}' },
      { kind: "tool_result", text: "2 passed", isError: false },
    ]);
  });

  it("skips thinking blocks, noise types, empty text, and malformed lines", () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } }),
      JSON.stringify({ type: "summary", summary: "session" }),
      JSON.stringify({ type: "permission-mode", mode: "auto" }),
      JSON.stringify({ type: "user", message: { role: "user", content: "" } }),
      "{ not json",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ok" } }),
    ].join("\n");
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "message", role: "assistant", text: "ok" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- claude-transcript`
Expected: FAIL (cannot resolve `../claude-transcript`).

- [ ] **Step 3: Implement types + parser**

Create `packages/web/src/lib/transcript-types.ts`:

```typescript
export type TranscriptEntry =
  | { kind: "message"; role: "user" | "assistant"; text: string }
  | { kind: "tool_use"; name: string; input: string }
  | { kind: "tool_result"; text: string; isError: boolean };

export type TranscriptStatus = "working" | "waiting_input" | "blocked" | "idle";

export interface TranscriptPromptOption {
  /** 1-based index as shown in the prompt. */
  index: number;
  label: string;
}

export interface TranscriptPrompt {
  question: string;
  options: TranscriptPromptOption[];
  /** Raw captured text, shown as a fallback when options is empty. */
  raw: string;
}

export interface TranscriptResponse {
  entries: TranscriptEntry[];
  status: TranscriptStatus;
  /** Tool name that triggered a waiting_input, when known. */
  trigger?: string;
  /** Present only when status is waiting_input/blocked and a prompt was captured. */
  prompt?: TranscriptPrompt;
}
```

Create `packages/web/src/lib/claude-transcript.ts`:

```typescript
import type { TranscriptEntry } from "./transcript-types";

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}
interface JsonlMessage {
  role?: string;
  content?: string | ContentBlock[];
}
interface JsonlLine {
  type?: string;
  message?: JsonlMessage;
}

function blockResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && typeof (c as ContentBlock).text === "string" ? (c as ContentBlock).text : ""))
      .join("");
  }
  return "";
}

/** Parse Claude Code session JSONL text into ordered, normalized transcript entries. */
export function parseTranscriptJsonl(jsonl: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: JsonlLine;
    try {
      parsed = JSON.parse(trimmed) as JsonlLine;
    } catch {
      continue;
    }
    if (parsed.type !== "user" && parsed.type !== "assistant") continue;
    const role = parsed.type;
    const content = parsed.message?.content;
    if (typeof content === "string") {
      if (content.trim()) entries.push({ kind: "message", role, text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        entries.push({ kind: "message", role, text: block.text });
      } else if (block.type === "tool_use") {
        entries.push({
          kind: "tool_use",
          name: typeof block.name === "string" ? block.name : "tool",
          input: JSON.stringify(block.input ?? {}),
        });
      } else if (block.type === "tool_result") {
        entries.push({
          kind: "tool_result",
          text: blockResultText(block.content),
          isError: block.is_error === true,
        });
      }
      // thinking and any other block types are intentionally skipped.
    }
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- claude-transcript`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @aoagents/ao-web typecheck` → no errors.
```bash
git add packages/web/src/lib/transcript-types.ts packages/web/src/lib/claude-transcript.ts packages/web/src/lib/__tests__/claude-transcript.test.ts
git commit -m "feat(web): Claude JSONL transcript parser + types"
```

---

## Task 2: Interactive prompt parser

**Files:**
- Create: `packages/web/src/lib/terminal-prompt.ts`
- Test: `packages/web/src/lib/__tests__/terminal-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/__tests__/terminal-prompt.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parsePrompt } from "../terminal-prompt";

describe("parsePrompt", () => {
  it("parses a numbered permission prompt with the question above the options", () => {
    const captured = [
      "  Bash command",
      "  npm run deploy",
      "",
      "Do you want to proceed?",
      "❯ 1. Yes",
      "  2. Yes, and don't ask again for npm commands",
      "  3. No, and tell Claude what to do differently (esc)",
      "",
    ].join("\n");
    const prompt = parsePrompt(captured);
    expect(prompt?.question).toBe("Do you want to proceed?");
    expect(prompt?.options).toEqual([
      { index: 1, label: "Yes" },
      { index: 2, label: "Yes, and don't ask again for npm commands" },
      { index: 3, label: "No, and tell Claude what to do differently (esc)" },
    ]);
    expect(prompt?.raw).toContain("Do you want to proceed?");
  });

  it("returns null with no numbered options (caller falls back to raw text)", () => {
    expect(parsePrompt("just some output\nno options here")).toBeNull();
    expect(parsePrompt("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- terminal-prompt`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/web/src/lib/terminal-prompt.ts`:

```typescript
import type { TranscriptPrompt, TranscriptPromptOption } from "./transcript-types";

// Matches lines like "❯ 1. Yes" / "  2. Yes, and don't ..." (optional cursor/box glyphs).
const OPTION_RE = /^[\s❯>›▶|]*?(\d+)[.)]\s+(.*\S)\s*$/;

/**
 * Parse a tmux capture-pane snapshot into a structured prompt. Returns null when
 * no numbered options are present (the caller then shows the raw text + a generic
 * Approve/Deny + free answer).
 */
export function parsePrompt(captured: string): TranscriptPrompt | null {
  const lines = captured.replace(/\r/g, "").split("\n");
  const options: TranscriptPromptOption[] = [];
  let firstOptionLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPTION_RE);
    if (m) {
      if (firstOptionLine === -1) firstOptionLine = i;
      options.push({ index: Number(m[1]), label: m[2].trim() });
    }
  }
  if (options.length === 0) return null;

  // Question = the nearest non-empty line above the first option.
  let question = "";
  for (let i = firstOptionLine - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t) {
      question = t;
      break;
    }
  }
  return { question: question || "The agent is waiting for your choice.", options, raw: captured.trim() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- terminal-prompt`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/terminal-prompt.ts packages/web/src/lib/__tests__/terminal-prompt.test.ts
git commit -m "feat(web): interactive prompt parser (tmux capture -> options)"
```

---

## Task 3: transcript-service (path resolution, read, status, capture)

**Files:**
- Create: `packages/web/src/lib/transcript-service.ts`
- Test: `packages/web/src/lib/__tests__/transcript-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/__tests__/transcript-service.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { buildTranscript } from "../transcript-service";

const baseSession = {
  id: "app-1",
  projectId: "proj",
  workspacePath: "/tmp/ws",
  metadata: { claudeSessionUuid: "uuid-1", tmuxName: "app-1" },
} as never;

function deps(over: Partial<Parameters<typeof buildTranscript>[1]> = {}) {
  return {
    readTranscriptText: vi.fn().mockResolvedValue(
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hi" } }),
    ),
    readActivity: vi.fn().mockResolvedValue({ state: "idle" as const, trigger: undefined }),
    capturePane: vi.fn().mockResolvedValue(""),
    ...over,
  };
}

describe("buildTranscript", () => {
  it("returns parsed entries and idle status", async () => {
    const res = await buildTranscript(baseSession, deps());
    expect(res.entries).toEqual([{ kind: "message", role: "assistant", text: "hi" }]);
    expect(res.status).toBe("idle");
    expect(res.prompt).toBeUndefined();
  });

  it("captures + parses the prompt when waiting_input", async () => {
    const res = await buildTranscript(
      baseSession,
      deps({
        readActivity: vi.fn().mockResolvedValue({ state: "waiting_input", trigger: "Bash" }),
        capturePane: vi.fn().mockResolvedValue("Proceed?\n❯ 1. Yes\n  2. No"),
      }),
    );
    expect(res.status).toBe("waiting_input");
    expect(res.trigger).toBe("Bash");
    expect(res.prompt?.options).toHaveLength(2);
  });

  it("does not capture the pane when not waiting", async () => {
    const d = deps();
    await buildTranscript(baseSession, d);
    expect(d.capturePane).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- transcript-service`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/web/src/lib/transcript-service.ts`:

```typescript
import type { Session } from "@aoagents/ao-core";
import { parseTranscriptJsonl } from "./claude-transcript";
import { parsePrompt } from "./terminal-prompt";
import type { TranscriptResponse, TranscriptStatus } from "./transcript-types";

export interface TranscriptDeps {
  /** Read the Claude JSONL text for this session (empty string if not found). */
  readTranscriptText: (session: Session) => Promise<string>;
  /** Read the actionable activity state (waiting_input/blocked) + trigger, if any. */
  readActivity: (
    session: Session,
  ) => Promise<{ state: TranscriptStatus; trigger?: string }>;
  /** Capture the session's current tmux pane (read-only). */
  capturePane: (session: Session) => Promise<string>;
}

/** Pure-ish composition of the transcript response from injected IO deps. */
export async function buildTranscript(
  session: Session,
  deps: TranscriptDeps,
): Promise<TranscriptResponse> {
  const [jsonl, activity] = await Promise.all([
    deps.readTranscriptText(session),
    deps.readActivity(session),
  ]);
  const entries = parseTranscriptJsonl(jsonl);
  const status = activity.state;
  const response: TranscriptResponse = { entries, status };
  if (activity.trigger) response.trigger = activity.trigger;
  if (status === "waiting_input" || status === "blocked") {
    const captured = await deps.capturePane(session);
    const prompt = parsePrompt(captured);
    if (prompt) response.prompt = prompt;
    else if (captured.trim())
      response.prompt = { question: "The agent is waiting for input.", options: [], raw: captured.trim() };
  }
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- transcript-service`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @aoagents/ao-web typecheck`.
```bash
git add packages/web/src/lib/transcript-service.ts packages/web/src/lib/__tests__/transcript-service.test.ts
git commit -m "feat(web): transcript-service composes entries+status+prompt"
```

---

## Task 4: GET transcript route (wire real IO deps)

**Files:**
- Create: `packages/web/src/app/api/sessions/[id]/transcript/route.ts`

- [ ] **Step 1: Implement the route**

Create `packages/web/src/app/api/sessions/[id]/transcript/route.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Session } from "@aoagents/ao-core";
import { toClaudeProjectPath, resolveWorkspaceForClaude } from "@aoagents/ao-plugin-agent-claude-code";
import { readLastActivityEntry, checkActivityLogState } from "@aoagents/ao-core";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import { buildTranscript, type TranscriptDeps } from "@/lib/transcript-service";
import { findTmux, resolveTmuxSession } from "@/../server/tmux-utils";
import type { TranscriptStatus } from "@/lib/transcript-types";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 262_144; // read the last 256KB of the transcript

async function resolveTranscriptFile(session: Session): Promise<string | null> {
  if (!session.workspacePath) return null;
  const slug = toClaudeProjectPath(await resolveWorkspaceForClaude(session.workspacePath));
  const dir = join(homedir(), ".claude", "projects", slug);
  const uuid = session.metadata?.["claudeSessionUuid"];
  if (uuid) {
    try {
      const p = join(dir, `${uuid}.jsonl`);
      await stat(p);
      return p;
    } catch {
      /* fall through to newest */
    }
  }
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    let newest: { path: string; mtime: number } | null = null;
    for (const f of files) {
      const p = join(dir, f);
      const s = await stat(p);
      if (!newest || s.mtimeMs > newest.mtime) newest = { path: p, mtime: s.mtimeMs };
    }
    return newest?.path ?? null;
  } catch {
    return null;
  }
}

const deps: TranscriptDeps = {
  readTranscriptText: async (session) => {
    const file = await resolveTranscriptFile(session);
    if (!file) return "";
    try {
      const buf = await readFile(file);
      return buf.length > MAX_BYTES ? buf.subarray(buf.length - MAX_BYTES).toString("utf8") : buf.toString("utf8");
    } catch {
      return "";
    }
  },
  readActivity: async (session) => {
    if (!session.workspacePath) return { state: "idle" };
    const entry = await readLastActivityEntry(session.workspacePath);
    const actionable = checkActivityLogState(entry);
    if (actionable) return { state: actionable.state as TranscriptStatus, trigger: entry?.trigger };
    return { state: "idle" };
  },
  capturePane: async (session) => {
    const tmuxPath = findTmux();
    if (!tmuxPath) return "";
    const target = session.runtimeHandle?.id ?? session.metadata?.["tmuxName"] ??
      resolveTmuxSession(session.id, tmuxPath, undefined, undefined, session.projectId) ?? session.id;
    try {
      const { stdout } = await execFileAsync(tmuxPath, ["capture-pane", "-t", target, "-p"]);
      return stdout;
    } catch {
      return "";
    }
  },
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) return NextResponse.json({ error: idErr }, { status: 400 });
  const { sessionManager } = await getServices();
  const session = await sessionManager.get(id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const transcript = await buildTranscript(session, deps);
  return NextResponse.json(transcript, { status: 200 });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors. If `readLastActivityEntry`/`checkActivityLogState` are not exported from `@aoagents/ao-core`, confirm against `packages/core/src/index.ts` and import from the correct path (they are part of the activity-log API). If the activity entry's field is named differently than `trigger`, read `packages/core/src/activity-log.ts` and use the correct field.
If the `@/../server/tmux-utils` path doesn't resolve, use a relative import to `packages/web/server/tmux-utils` that matches how other server files import it (check an existing import of `tmux-utils` from `src/`).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/sessions/[id]/transcript/route.ts
git commit -m "feat(web): GET /api/sessions/[id]/transcript"
```

---

## Task 5: keys endpoint (tmux send-keys for control/selection)

**Files:**
- Create: `packages/web/src/app/api/sessions/[id]/keys/route.ts`
- Test: `packages/web/src/lib/__tests__/keys-route.test.ts`

- [ ] **Step 1: Write the failing test (validation helper)**

Create `packages/web/src/lib/__tests__/keys-route.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateKeyTokens } from "../../app/api/sessions/[id]/keys/route";

describe("validateKeyTokens", () => {
  it("accepts allowlisted tokens", () => {
    expect(validateKeyTokens(["1", "Enter"])).toEqual(["1", "Enter"]);
    expect(validateKeyTokens(["Escape"])).toEqual(["Escape"]);
    expect(validateKeyTokens(["Up", "Enter"])).toEqual(["Up", "Enter"]);
    expect(validateKeyTokens(["C-c"])).toEqual(["C-c"]);
  });

  it("rejects anything not allowlisted", () => {
    expect(validateKeyTokens(["rm -rf /"])).toBeNull();
    expect(validateKeyTokens([])).toBeNull();
    expect(validateKeyTokens(["Enter", "ls"])).toBeNull();
    expect(validateKeyTokens("Enter" as unknown as string[])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- keys-route`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/web/src/app/api/sessions/[id]/keys/route.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import { findTmux, resolveTmuxSession } from "@/../server/tmux-utils";

const execFileAsync = promisify(execFile);

// Allowlist of tmux send-keys tokens this endpoint may send. Digits 0-9 select a
// numbered prompt option; the rest are navigation/submit/interrupt keys.
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

/** POST /api/sessions/:id/keys — send allowlisted control keys via tmux send-keys. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) return NextResponse.json({ error: idErr }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { keys?: unknown } | null;
  const keys = validateKeyTokens(body?.keys);
  if (!keys) return NextResponse.json({ error: "Invalid keys" }, { status: 400 });

  const { sessionManager } = await getServices();
  const session = await sessionManager.get(id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const tmuxPath = findTmux();
  if (!tmuxPath) return NextResponse.json({ error: "tmux not available" }, { status: 500 });
  const target = session.runtimeHandle?.id ?? session.metadata?.["tmuxName"] ??
    resolveTmuxSession(session.id, tmuxPath, undefined, undefined, session.projectId) ?? session.id;

  try {
    await execFileAsync(tmuxPath, ["send-keys", "-t", target, ...keys]);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "send-keys failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- keys-route` → PASS.
Run: `pnpm --filter @aoagents/ao-web typecheck`. (Fix the `tmux-utils` import path to match the codebase if needed, as in Task 4 Step 2.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/sessions/[id]/keys/route.ts packages/web/src/lib/__tests__/keys-route.test.ts
git commit -m "feat(web): POST /api/sessions/[id]/keys (allowlisted tmux send-keys)"
```

---

## Task 6: TranscriptMessageList component

**Files:**
- Create: `packages/web/src/components/TranscriptMessageList.tsx`
- Test: `packages/web/src/components/__tests__/TranscriptMessageList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/__tests__/TranscriptMessageList.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranscriptMessageList } from "../TranscriptMessageList";
import type { TranscriptEntry } from "@/lib/transcript-types";

const entries: TranscriptEntry[] = [
  { kind: "message", role: "user", text: "fix it" },
  { kind: "message", role: "assistant", text: "on it" },
  { kind: "tool_use", name: "Bash", input: '{"command":"npm test"}' },
  { kind: "tool_result", text: "2 passed", isError: false },
];

describe("TranscriptMessageList", () => {
  it("renders messages and a collapsed tool call that expands on click", () => {
    render(<TranscriptMessageList entries={entries} />);
    expect(screen.getByText("fix it")).toBeInTheDocument();
    expect(screen.getByText("on it")).toBeInTheDocument();
    // Tool call shows its name; input hidden until expanded.
    expect(screen.getByText(/Bash/)).toBeInTheDocument();
    expect(screen.queryByText(/npm test/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bash/ }));
    expect(screen.getByText(/npm test/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- TranscriptMessageList`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/web/src/components/TranscriptMessageList.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { TranscriptEntry } from "@/lib/transcript-types";

function ToolCall({ name, input }: { name: string; input: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-[var(--color-text-secondary)]"
        aria-expanded={open}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>{name}</span>
      </button>
      {open ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-2 pb-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {input}
        </pre>
      ) : null}
    </div>
  );
}

export function TranscriptMessageList({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {entries.map((entry, i) => {
        if (entry.kind === "message") {
          const isUser = entry.role === "user";
          return (
            <div
              key={i}
              className={cnRole(isUser)}
            >
              <div className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">
                {entry.text}
              </div>
            </div>
          );
        }
        if (entry.kind === "tool_use") {
          return <ToolCall key={i} name={entry.name} input={entry.input} />;
        }
        return (
          <pre
            key={i}
            className={
              "overflow-x-auto whitespace-pre-wrap break-words rounded border px-2 py-1.5 font-mono text-[11px] " +
              (entry.isError
                ? "border-[var(--color-status-error)] text-[var(--color-status-error)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]")
            }
          >
            {entry.text}
          </pre>
        );
      })}
    </div>
  );
}

function cnRole(isUser: boolean): string {
  return isUser
    ? "self-end max-w-[85%] rounded-lg bg-[var(--color-bg-elevated)] px-3 py-2"
    : "self-start max-w-[85%] rounded-lg bg-[var(--color-bg-surface)] px-3 py-2";
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- TranscriptMessageList` → PASS.
Run: `pnpm --filter @aoagents/ao-web typecheck`. (If `--color-bg-inset` / `--color-status-error` aren't in `globals.css`, grep the `@theme` block and substitute the closest existing token; report the substitution.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/TranscriptMessageList.tsx packages/web/src/components/__tests__/TranscriptMessageList.test.tsx
git commit -m "feat(web): TranscriptMessageList (messages + collapsible tool calls)"
```

---

## Task 7: PromptCard + TranscriptComposer components

**Files:**
- Create: `packages/web/src/components/PromptCard.tsx`, `packages/web/src/components/TranscriptComposer.tsx`
- Test: `packages/web/src/components/__tests__/PromptCard.test.tsx`, `packages/web/src/components/__tests__/TranscriptComposer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/__tests__/PromptCard.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptCard } from "../PromptCard";
import type { TranscriptPrompt } from "@/lib/transcript-types";

const prompt: TranscriptPrompt = {
  question: "Proceed?",
  options: [
    { index: 1, label: "Yes" },
    { index: 2, label: "No" },
  ],
  raw: "Proceed?\n1. Yes\n2. No",
};

describe("PromptCard", () => {
  it("sends the option index (+Enter) when an option is tapped", () => {
    const onKeys = vi.fn();
    render(<PromptCard prompt={prompt} onKeys={onKeys} onAnswer={vi.fn()} onDiscuss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "2. No" }));
    expect(onKeys).toHaveBeenCalledWith(["2", "Enter"]);
  });

  it("submits a free-text answer", () => {
    const onAnswer = vi.fn();
    render(<PromptCard prompt={prompt} onKeys={vi.fn()} onAnswer={onAnswer} onDiscuss={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Your answer…"), { target: { value: "do X" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(onAnswer).toHaveBeenCalledWith("do X");
  });

  it("interrupts with Escape and routes Discuss", () => {
    const onKeys = vi.fn();
    const onDiscuss = vi.fn();
    render(<PromptCard prompt={prompt} onKeys={onKeys} onAnswer={vi.fn()} onDiscuss={onDiscuss} />);
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(onKeys).toHaveBeenCalledWith(["Escape"]);
    fireEvent.click(screen.getByRole("button", { name: "Chat it" }));
    expect(onDiscuss).toHaveBeenCalled();
  });

  it("falls back to Approve/Deny when there are no options", () => {
    const onKeys = vi.fn();
    render(
      <PromptCard prompt={{ ...prompt, options: [] }} onKeys={onKeys} onAnswer={vi.fn()} onDiscuss={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onKeys).toHaveBeenCalledWith(["Enter"]);
  });
});
```

Create `packages/web/src/components/__tests__/TranscriptComposer.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
vi.mock("@/hooks/useSpeechRecognition", () => ({ useSpeechRecognition: () => speech }));

import { TranscriptComposer } from "../TranscriptComposer";

beforeEach(() => {
  speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
});

describe("TranscriptComposer", () => {
  it("sends typed text and clears", () => {
    const onSend = vi.fn();
    render(<TranscriptComposer onSend={onSend} />);
    const input = screen.getByPlaceholderText("Message…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "deploy please" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("deploy please");
    expect(input.value).toBe("");
  });

  it("does not send empty and shows mic only when supported", () => {
    const onSend = vi.fn();
    const { unmount } = render(<TranscriptComposer onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Voice input" })).toBeInTheDocument();
    unmount();
    speech = { supported: false, listening: false, start: vi.fn(), stop: vi.fn() };
    render(<TranscriptComposer onSend={onSend} />);
    expect(screen.queryByRole("button", { name: "Voice input" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aoagents/ao-web test -- PromptCard TranscriptComposer`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement TranscriptComposer**

Create `packages/web/src/components/TranscriptComposer.tsx`:

```tsx
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
  const speech = useSpeechRecognition((transcript) => setText(transcript));

  return (
    <div className="flex items-end gap-1.5 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-2">
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
```

- [ ] **Step 4: Implement PromptCard**

Create `packages/web/src/components/PromptCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { TranscriptPrompt } from "@/lib/transcript-types";

export function PromptCard({
  prompt,
  onKeys,
  onAnswer,
  onDiscuss,
}: {
  prompt: TranscriptPrompt;
  onKeys: (keys: string[]) => void;
  onAnswer: (text: string) => void;
  onDiscuss: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const hasOptions = prompt.options.length > 0;

  return (
    <div className="m-3 flex flex-col gap-2 rounded-lg border border-[var(--color-status-attention)] bg-[var(--color-bg-elevated)] p-3">
      <div className="whitespace-pre-wrap break-words text-sm font-medium text-[var(--color-text-primary)]">
        {prompt.question}
      </div>

      {hasOptions ? (
        <div className="flex flex-col gap-1.5">
          {prompt.options.map((opt) => (
            <button
              key={opt.index}
              type="button"
              onClick={() => onKeys([String(opt.index), "Enter"])}
              className="min-h-[40px] rounded border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] active:bg-[var(--color-bg-hover)]"
            >
              {opt.index}. {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onKeys(["Enter"])}
            className="min-h-[40px] flex-1 rounded bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-text-inverse)]"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onKeys(["Escape"])}
            className="min-h-[40px] flex-1 rounded border border-[var(--color-border-default)] px-3 text-sm text-[var(--color-text-primary)]"
          >
            Deny
          </button>
        </div>
      )}

      {!hasOptions ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-inset)] p-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
          {prompt.raw}
        </pre>
      ) : null}

      <div className="flex items-end gap-1.5">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer…"
          rows={1}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-h-[40px] flex-1 resize-none rounded border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-2 text-sm text-[var(--color-text-primary)]"
        />
        <button
          type="button"
          aria-label="Send answer"
          onClick={() => {
            const v = answer.trim();
            if (!v) return;
            onAnswer(v);
            setAnswer("");
          }}
          className="min-h-[40px] rounded bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-text-inverse)]"
        >
          Send answer
        </button>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onDiscuss}
          className="min-h-[40px] flex-1 rounded border border-[var(--color-border-default)] px-3 text-sm text-[var(--color-text-primary)]"
        >
          Chat it
        </button>
        <button
          type="button"
          aria-label="Interrupt"
          onClick={() => onKeys(["Escape"])}
          className="min-h-[40px] rounded border border-[var(--color-status-error)] px-3 text-sm text-[var(--color-status-error)]"
        >
          Interrupt
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- PromptCard TranscriptComposer` → PASS.
Run: `pnpm --filter @aoagents/ao-web typecheck`. (Substitute any missing `--color-*` token with the closest existing one, as before, and report it.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/PromptCard.tsx packages/web/src/components/TranscriptComposer.tsx packages/web/src/components/__tests__/PromptCard.test.tsx packages/web/src/components/__tests__/TranscriptComposer.test.tsx
git commit -m "feat(web): PromptCard + TranscriptComposer"
```

---

## Task 8: SessionTranscriptView container (poll + wire)

**Files:**
- Create: `packages/web/src/components/SessionTranscriptView.tsx`
- Test: `packages/web/src/components/__tests__/SessionTranscriptView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/__tests__/SessionTranscriptView.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({ supported: false, listening: false, start: vi.fn(), stop: vi.fn() }),
}));

import { SessionTranscriptView } from "../SessionTranscriptView";

const transcript = {
  entries: [{ kind: "message", role: "assistant", text: "hello from agent" }],
  status: "idle",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => transcript }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("SessionTranscriptView", () => {
  it("fetches and renders the transcript with a status badge", async () => {
    render(<SessionTranscriptView sessionId="app-1" projectId="proj" />);
    await waitFor(() => expect(screen.getByText("hello from agent")).toBeInTheDocument());
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- SessionTranscriptView`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/web/src/components/SessionTranscriptView.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptResponse } from "@/lib/transcript-types";
import { TranscriptMessageList } from "./TranscriptMessageList";
import { TranscriptComposer } from "./TranscriptComposer";
import { PromptCard } from "./PromptCard";

const POLL_MS = 4000;

const STATUS_LABEL: Record<TranscriptResponse["status"], string> = {
  working: "Working",
  waiting_input: "Waiting for you",
  blocked: "Blocked",
  idle: "Idle",
};

export function SessionTranscriptView({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId?: string;
}) {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as TranscriptResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transcript");
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.entries.length]);

  const post = useCallback(
    async (path: string, body: unknown) => {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      void refresh();
    },
    [sessionId, refresh],
  );

  const sendMessage = useCallback((text: string) => void post("send", { message: text }), [post]);
  const sendKeys = useCallback((keys: string[]) => void post("keys", { keys }), [post]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
        <span>{data ? STATUS_LABEL[data.status] : "Loading…"}</span>
        {data?.trigger ? <span className="text-[var(--color-text-muted)]">· {data.trigger}</span> : null}
        {error ? <span className="text-[var(--color-status-error)]">· {error}</span> : null}
      </div>
      <div className="flex-1 overflow-y-auto">
        <TranscriptMessageList entries={data?.entries ?? []} />
        <div ref={bottomRef} />
      </div>
      {data?.prompt ? (
        <PromptCard
          prompt={data.prompt}
          onKeys={sendKeys}
          onAnswer={sendMessage}
          onDiscuss={() => {
            /* focus stays on the composer below; Discuss is a no-op affordance in v1 */
          }}
        />
      ) : null}
      <TranscriptComposer onSend={sendMessage} />
    </div>
  );
}
```

(Reference `projectId` in a comment or pass-through if a later version needs it; it is accepted for API symmetry with DirectTerminal and to avoid a prop change when project scoping is added. To avoid an unused-var lint error, prefix it: rename the param to `_projectId` OR include it in a future fetch query. Use `_projectId` for now.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- SessionTranscriptView` → PASS.
Run: `pnpm --filter @aoagents/ao-web typecheck` → no errors (ensure no unused `projectId`).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/SessionTranscriptView.tsx packages/web/src/components/__tests__/SessionTranscriptView.test.tsx
git commit -m "feat(web): SessionTranscriptView (poll + status + list + prompt + composer)"
```

---

## Task 9: Integrate transcript toggle into SessionDetail

**Files:**
- Modify: `packages/web/src/components/SessionDetail.tsx`, `packages/web/src/components/SessionDetailHeader.tsx`
- Test: extend `packages/web/src/components/__tests__/SessionDetail.desktop.test.tsx`

- [ ] **Step 1: Add toggle props + button to SessionDetailHeader**

In `packages/web/src/components/SessionDetailHeader.tsx`, add to the props interface (near `inputDockVisible`):

```typescript
  /** Whether the transcript view is shown instead of the terminal. */
  transcriptVisible?: boolean;
  /** Toggle transcript vs terminal. Hidden when absent. */
  onToggleTranscript?: () => void;
```

Add to destructured params:

```typescript
  transcriptVisible = false,
  onToggleTranscript,
```

Render a toggle button in the actions row, right after the `TerminalDockToggleButton` usage:

```tsx
        {onToggleTranscript ? (
          <button
            type="button"
            className="dashboard-app-btn"
            aria-label="Toggle transcript view"
            aria-pressed={transcriptVisible}
            onClick={onToggleTranscript}
          >
            {transcriptVisible ? "Terminal" : "Transcript"}
          </button>
        ) : null}
```

- [ ] **Step 2: Wire SessionDetail**

In `packages/web/src/components/SessionDetail.tsx`:

(a) Add import:
```typescript
import { SessionTranscriptView } from "./SessionTranscriptView";
```

(b) After the existing `dockOverride`/`isTouch` block, add transcript visibility state (default = touch):
```typescript
  const [transcriptOverride, setTranscriptOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const stored = window.localStorage.getItem("ao:showTranscript");
    if (stored === "1") setTranscriptOverride(true);
    else if (stored === "0") setTranscriptOverride(false);
  }, []);
  const transcriptVisible = transcriptOverride ?? isTouch;
  const toggleTranscript = useCallback(() => {
    setTranscriptOverride((prev) => {
      const next = !(prev ?? isTouch);
      window.localStorage.setItem("ao:showTranscript", next ? "1" : "0");
      return next;
    });
  }, [isTouch]);
```

(c) Pass to the header element:
```tsx
        transcriptVisible={transcriptVisible}
        onToggleTranscript={toggleTranscript}
```

(d) In the terminal-area ternary, render the transcript when toggled on (it replaces the live terminal; still gated by `!terminalEnded`). Change the final branch from:
```tsx
          ) : (
            <DirectTerminal ... />
          )}
```
to:
```tsx
          ) : transcriptVisible ? (
            <SessionTranscriptView sessionId={session.id} projectId={session.projectId} />
          ) : (
            <DirectTerminal ... />
          )}
```
(Keep the existing `<DirectTerminal .../>` props unchanged.)

- [ ] **Step 3: Test**

Add to `packages/web/src/components/__tests__/SessionDetail.desktop.test.tsx` (it already mocks `@/providers/MuxProvider`; ensure `fetch` is stubbed since SessionTranscriptView fetches — add a `vi.stubGlobal("fetch", ...)` in this test only):

```typescript
  it("switches to the transcript view via the header toggle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [], status: "idle" }) }));
    render(
      <SessionDetail
        session={makeSession({ id: "app-1", projectId: "my-app", status: "working", activity: "active" })}
        projects={[{ id: "my-app", name: "My App", path: "/tmp/my-app" }]}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("banner")).getByRole("button", { name: "Toggle transcript view" }),
    );
    await screen.findByText("Idle");
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- SessionDetail.desktop` → all pass.
Run: `pnpm --filter @aoagents/ao-web typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/SessionDetail.tsx packages/web/src/components/SessionDetailHeader.tsx packages/web/src/components/__tests__/SessionDetail.desktop.test.tsx
git commit -m "feat(web): transcript/terminal toggle in SessionDetail"
```

---

## Task 10: Spike — verify the choice/interrupt keystroke mapping, then full verification

- [ ] **Step 1: Keystroke spike (manual, after a rebuild)**

After `ao stop && ao start --rebuild --restore`, open a Claude session that hits a permission prompt on a touch view. Confirm:
- Tapping option "N" sends `["N","Enter"]` and selects it. If Claude's prompt needs arrow navigation instead, change `PromptCard` option `onKeys` to `["Down"×(N-1), "Enter"]` or the correct mapping, and update the PromptCard test accordingly.
- Interrupt sends `["Escape"]` and stops the agent. If Claude needs double-Esc or `C-c`, adjust the Interrupt/Deny `onKeys` and the test.
Document the confirmed mapping in a one-line comment in `PromptCard.tsx`.

- [ ] **Step 2: Typecheck + full web test**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Run: `pnpm --filter @aoagents/ao-web test -- claude-transcript terminal-prompt transcript-service keys-route TranscriptMessageList PromptCard TranscriptComposer SessionTranscriptView SessionDetail`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 0 errors. Fix unused vars / type-import issues. (67 pre-existing warnings in unrelated files are expected.)

- [ ] **Step 4: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "chore(web): lint/typecheck + confirmed keystroke mapping for transcript view"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Non-xterm transcript from Claude JSONL → Task 1 (parser) + Task 3/4 (service + route). ✅
- Messages + collapsible tool calls; thinking hidden → Task 1 (skips thinking) + Task 6 (collapsible ToolCall). ✅
- Poll ~4s + status indicator (working/waiting/idle) → Task 8 (POLL_MS=4000, STATUS_LABEL, trigger). ✅
- Composer (text + voice via /api/send) → Task 7 (TranscriptComposer) + Task 8 (sendMessage → /send). ✅
- Prompt card: options + free answer + Chat-it + Interrupt; fallback Approve/Deny + raw → Task 7 (PromptCard). ✅
- Interactive crux: capture-pane → parse options → keys via send-keys (no PTY/resize) → Task 2 (parse) + Task 3/4 (capture) + Task 5 (keys endpoint) + Task 8 (sendKeys). ✅
- Control chars can't go via /api/send → dedicated keys endpoint → Task 5. ✅
- Routing: default on touch + toggle, localStorage → Task 9 (mirrors v1 dock pattern). ✅
- Claude-only v1; raw terminal fallback via toggle → Task 9. ✅
- Keystroke mapping spike with fallback → Task 10 Step 1. ✅
- Tailwind/dark/no UI libs/≥40px/≤400 lines/tests → throughout; token substitution noted where a `--color-*` may not exist. ✅

**Placeholder scan:** none — every step has complete code + exact commands. The "spike" (Task 10 Step 1) is a bounded verification with explicit fallbacks, not an unfinished implementation.

**Type consistency:** `TranscriptEntry`/`TranscriptResponse`/`TranscriptPrompt` defined once in `transcript-types.ts` and imported everywhere; `parseTranscriptJsonl`, `parsePrompt`, `buildTranscript(session, deps)`, `validateKeyTokens`, component props (`onKeys`/`onAnswer`/`onDiscuss`/`onSend`) match across tasks; endpoints `/api/sessions/[id]/transcript` (GET) and `/keys` (POST) and existing `/send` used consistently.

**Risks flagged in-plan:** tmux-utils import path may differ (Task 4/5 note); `--color-*` token names verify against globals.css (Task 6/7 note); activity-log field name `trigger` verify (Task 4 note); keystroke mapping spike (Task 10).
