import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PluginModule,
  type Runtime,
  type RuntimeCreateConfig,
  type RuntimeHandle,
  type RuntimeMetrics,
  type AttachInfo,
  shellEscape,
} from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);
const TMUX_COMMAND_TIMEOUT_MS = 5_000;

// sendMessage submit tuning — wait for the pasted text to land in the composer,
// then submit with a bounded Enter retry until the draft leaves the composer.
const PASTE_SETTLE_POLL_MS = 120;
const PASTE_SETTLE_MAX_POLLS = 8; // up to ~1s to see the paste render
const ENTER_SUBMIT_ATTEMPTS = 8; // retry Enter across a dropped-keystroke window
const ENTER_VERIFY_MS = 400;
const COMPOSER_TAIL_LINES = 8; // bottom-of-pane region where the input line lives
const INPUT_NEEDLE_LEN = 40; // chars of the message tail we track on the input line

export const manifest = {
  name: "tmux",
  slot: "runtime" as const,
  description: "Runtime plugin: tmux sessions",
  version: "0.1.0",
};

/** Only allow safe characters in session IDs */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function assertValidSessionId(id: string): void {
  if (!SAFE_SESSION_ID.test(id)) {
    throw new Error(`Invalid session ID "${id}": must match ${SAFE_SESSION_ID}`);
  }
}

/**
 * Shell snippet appended after the agent launch command so the tmux pane
 * (and therefore the tmux session) survives agent exit. Without this, the
 * pane closes when the agent process exits, the only window goes away, and
 * the whole tmux session dies — leaving the dashboard with a phantom
 * "runtime lost" state and the user with no way to do anything in that
 * workspace (issue #1756).
 *
 * `exec` replaces the wrapping sh/bash with the user's interactive shell,
 * so the lifecycle manager still detects agent termination via
 * `agent.isProcessRunning` and transitions the session correctly.
 */
const KEEP_ALIVE_SHELL = `exec "\${SHELL:-/bin/bash}" -i`;

function withKeepAliveShell(command: string): string {
  return `${command.replace(/\n+$/, "")}\n${KEEP_ALIVE_SHELL}`;
}

function writeLaunchScript(command: string): string {
  const scriptPath = join(tmpdir(), `ao-launch-${randomUUID()}.sh`);
  const content = `#!/usr/bin/env bash\nrm -- "$0" 2>/dev/null || true\n${withKeepAliveShell(command)}\n`;
  writeFileSync(scriptPath, content, { encoding: "utf-8", mode: 0o700 });
  return `bash ${shellEscape(scriptPath)}`;
}

/**
 * Exact-match tmux target. A bare `-t name` does PREFIX matching, so a command
 * aimed at session "app-8" silently resolves to "app-81" when the exact session
 * is absent — leaking has-session/kill-session/send onto the wrong session. The
 * `=` prefix forces an exact match. Session-target subcommands (has-session,
 * kill-session) accept `=name`; pane-target subcommands (send-keys, paste-buffer,
 * capture-pane) need the trailing `:` for `=` to resolve a pane.
 */
const exactSession = (name: string): string => `=${name}`;
const exactPane = (name: string): string => `=${name}:`;

/** Run a tmux command and return stdout */
async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: TMUX_COMMAND_TIMEOUT_MS,
  });
  return stdout.trimEnd();
}

export function create(): Runtime {
  return {
    name: "tmux",

    async create(config: RuntimeCreateConfig): Promise<RuntimeHandle> {
      assertValidSessionId(config.sessionId);
      const sessionName = config.sessionId;

      // Build environment flags: -e KEY=VALUE for each env var
      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(config.environment ?? {})) {
        envArgs.push("-e", `${key}=${value}`);
      }

      // Re-export PATH inside the launch script. macOS zsh runs path_helper
      // during shell startup which resets PATH, wiping entries set via tmux -e.
      // Including the export in the launched shell command avoids terminal
      // buffer issues with long PATH values (1000+ chars).
      const pathValue = config.environment?.["PATH"];
      let launchCommand = config.launchCommand;
      if (pathValue) {
        // Use printf with JSON-escaped value to avoid shell injection if
        // PATH contains single quotes or other shell metacharacters.
        launchCommand = `export PATH=$(printf '%s' ${JSON.stringify(pathValue)})\n${launchCommand}`;
      }

      // Start the launch command as the pane's initial command instead of
      // typing into a live shell. A dashboard attach can trigger terminal
      // device responses; if those race with tmux send-keys, they become
      // literal shell input and corrupt the launch path. The keep-alive
      // tail is appended in both code paths — see KEEP_ALIVE_SHELL.
      const shellCommand =
        launchCommand.length > 200
          ? writeLaunchScript(launchCommand)
          : withKeepAliveShell(launchCommand);

      await tmux(
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        config.workspacePath,
        ...envArgs,
        shellCommand,
      );

      // Hide the tmux status bar — sessions are embedded in the web terminal,
      // and the green bar at the bottom is visual noise (and racy with the
      // web layer's own set-option call, which only fires on WebSocket connect).
      // Kill the session if this fails so we don't leave an orphaned tmux process.
      try {
        await tmux("set-option", "-t", sessionName, "status", "off");
      } catch (err: unknown) {
        try {
          await tmux("kill-session", "-t", exactSession(sessionName));
        } catch {
          // Best-effort cleanup
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to configure or launch session "${sessionName}": ${msg}`, {
          cause: err,
        });
      }

      return {
        id: sessionName,
        runtimeName: "tmux",
        data: {
          createdAt: Date.now(),
          workspacePath: config.workspacePath,
        },
      };
    },

    async destroy(handle: RuntimeHandle): Promise<void> {
      try {
        await tmux("kill-session", "-t", exactSession(handle.id));
      } catch {
        // Session may already be dead — that's fine
      }
    },

    async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
      // Clear any partial input
      await tmux("send-keys", "-t", exactPane(handle.id), "C-u");

      // For long or multiline messages, use load-buffer + paste-buffer
      // Use randomUUID to avoid temp file collisions on concurrent sends
      if (message.includes("\n") || message.length > 200) {
        const bufferName = `ao-${randomUUID()}`;
        const tmpPath = join(tmpdir(), `ao-send-${randomUUID()}.txt`);
        writeFileSync(tmpPath, message, { encoding: "utf-8", mode: 0o600 });
        try {
          await tmux("load-buffer", "-b", bufferName, tmpPath);
          await tmux("paste-buffer", "-b", bufferName, "-t", exactPane(handle.id), "-d");
        } finally {
          // Clean up temp file and tmux buffer (in case paste-buffer failed
          // and the -d flag didn't delete it)
          try {
            unlinkSync(tmpPath);
          } catch {
            // ignore cleanup errors
          }
          try {
            await tmux("delete-buffer", "-b", bufferName);
          } catch {
            // Buffer may already be deleted by -d flag — that's fine
          }
        }
      } else {
        // Use -l (literal) so text like "Enter" or "Space" isn't interpreted
        // as tmux key names
        await tmux("send-keys", "-t", exactPane(handle.id), "-l", message);
      }

      // Submit the pasted text. A single Enter after a fixed delay races with
      // the agent TUI: while the pane is mid-render the keystroke arrives before
      // the composer is ready and is silently dropped, leaving the message as an
      // unsent draft the user must submit by hand. The race is timing-sensitive
      // (only reproduces on slower machines / under render load), so a bigger
      // fixed delay just moves the goalposts — instead we detect the outcome and
      // retry adaptively.
      //
      // Signal: while the message is an unsent draft it sits on the composer's
      // input line at the bottom of the pane. Once Enter is accepted (submitted
      // or queued) the composer clears, so the draft text leaves the bottom of
      // the pane. We watch a distinctive tail of the message there, NOT the
      // whole pane (spinners / token counters churn it constantly). We only ever
      // resend Enter — never re-paste — so at worst an undetected submit adds a
      // harmless stray Enter on an empty composer.
      const capture = async (): Promise<string> => {
        try {
          return await tmux("capture-pane", "-t", exactPane(handle.id), "-p");
        } catch {
          return "";
        }
      };

      // The tail of the last non-empty line is what renders on the input line.
      const lastLine = message
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      const needle = (lastLine ?? "").slice(-INPUT_NEEDLE_LEN).trim();
      const draftPresent = (pane: string): boolean => {
        if (!needle) return false; // nothing distinctive to track — can't detect
        const tail = pane.split("\n").slice(-COMPOSER_TAIL_LINES).join("\n");
        return tail.includes(needle);
      };

      // Wait until the paste has actually landed in the composer before we
      // submit (bounded). Watching for the draft to appear beats a blind delay.
      for (let i = 0; i < PASTE_SETTLE_MAX_POLLS; i++) {
        if (draftPresent(await capture())) break;
        await sleep(PASTE_SETTLE_POLL_MS);
      }

      // Submit, retrying Enter until the draft leaves the composer. If we have
      // no needle to track, fall back to a single Enter (legacy behavior).
      for (let attempt = 0; attempt < ENTER_SUBMIT_ATTEMPTS; attempt++) {
        await tmux("send-keys", "-t", exactPane(handle.id), "Enter");
        if (!needle) return;
        await sleep(ENTER_VERIFY_MS);
        if (!draftPresent(await capture())) return; // composer cleared → submitted
      }
    },

    async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
      try {
        return await tmux("capture-pane", "-t", exactPane(handle.id), "-p", "-S", `-${lines}`);
      } catch {
        return "";
      }
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      try {
        await tmux("has-session", "-t", exactSession(handle.id));
        return true;
      } catch {
        return false;
      }
    },

    async getMetrics(handle: RuntimeHandle): Promise<RuntimeMetrics> {
      const createdAt = (handle.data.createdAt as number) ?? Date.now();
      return {
        uptimeMs: Date.now() - createdAt,
      };
    },

    async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
      return {
        type: "tmux",
        target: handle.id,
        command: `tmux attach -t ${handle.id}`,
      };
    },

    async preflight(): Promise<void> {
      try {
        await execFileAsync("tmux", ["-V"], { timeout: TMUX_COMMAND_TIMEOUT_MS });
      } catch {
        const hint =
          process.platform === "darwin"
            ? "brew install tmux"
            : process.platform === "win32"
              ? "tmux is not available on Windows. Use WSL: wsl --install, then: sudo apt install tmux"
              : "sudo apt install tmux (Debian/Ubuntu) or sudo dnf install tmux (Fedora)";
        throw new Error(`tmux is not installed. Install it: ${hint}`);
      }
    },
  };
}

export default { manifest, create } satisfies PluginModule<Runtime>;
