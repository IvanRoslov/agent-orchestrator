import type { Session, SessionId } from "@aoagents/ao-core";

export const STALE_MS = 15 * 60_000;
export const RENUDGE_MS = 20 * 60_000;
export const TICK_MS = 5 * 60_000;

/** Workers of a feature orchestrator: sessions on a `feature/<slug>/*` branch. */
export function workersForOrchestrator(orchestrator: Session, all: Session[]): Session[] {
  const slug = orchestrator.metadata["feature"];
  if (!slug) return [];
  const prefix = `feature/${slug}/`;
  return all.filter(
    (s) => s.id !== orchestrator.id && (s.branch?.startsWith(prefix) ?? false),
  );
}

function ageMs(session: Session, now: number, realTs?: Date | null): number {
  return now - (realTs ?? session.lastActivityAt).getTime();
}

/** No movement past the threshold. Null activity = no data → never stale.
 *  `realTs` (the agent's real last-activity time) wins over `lastActivityAt`. */
export function isStale(
  session: Session,
  now: number,
  staleMs: number = STALE_MS,
  realTs?: Date | null,
): boolean {
  return session.activity !== null && ageMs(session, now, realTs) > staleMs;
}

function taskName(slug: string, worker: Session): string {
  const prefix = `feature/${slug}/`;
  if (worker.branch?.startsWith(prefix)) return worker.branch.slice(prefix.length);
  return worker.branch ?? worker.id;
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Human summary of all workers, stale ones first. */
export function buildSummary(
  orchestrator: Session,
  workers: Session[],
  now: number,
  staleMs: number = STALE_MS,
  tsMap?: Map<string, Date>,
): string {
  const slug = orchestrator.metadata["feature"] ?? "";
  const ordered = [...workers].sort(
    (a, b) =>
      Number(isStale(b, now, staleMs, tsMap?.get(b.id))) -
      Number(isStale(a, now, staleMs, tsMap?.get(a.id))),
  );
  const lines = ordered.map((w) => {
    const state = (w.activity ?? "unknown").toUpperCase();
    const age = formatAge(ageMs(w, now, tsMap?.get(w.id)));
    const pr = w.pr ? ` · PR #${w.pr.number}` : "";
    const flag = isStale(w, now, staleMs, tsMap?.get(w.id))
      ? " — no movement; may be done or stuck, check it."
      : " — ok.";
    return `- ${w.id} (task ${taskName(slug, w)}): ${state} ${age}${pr}${flag}`;
  });
  return [
    `[feature heartbeat] feature ${slug} — worker status (no human here, act autonomously):`,
    ...lines,
    `This may be expected. If a worker looks stuck: ao send <worker-id> "status?" or open its terminal. If all is fine, ignore this.`,
  ].join("\n");
}

/** Decide whether to nudge one orchestrator this tick. */
export function evaluateOrchestrator(
  orchestrator: Session,
  all: Session[],
  now: number,
  lastSentAt: number | undefined,
  staleMs: number = STALE_MS,
  renudgeMs: number = RENUDGE_MS,
  tsMap?: Map<string, Date>,
): { message: string } | null {
  if (!orchestrator.metadata["feature"]) return null;
  // Only nudge orchestrators with a live agent. A dead/stale orchestrator (tmux
  // gone, never archived) enriches to activity `null` or `exited` — sending to
  // it triggers a doomed restoreForDelivery. A live agent always reports a
  // concrete non-null state per the getActivityState contract.
  if (orchestrator.activity === null || orchestrator.activity === "exited") return null;
  if (orchestrator.activity === "active") return null; // busy — don't interrupt
  const workers = workersForOrchestrator(orchestrator, all);
  if (workers.length === 0) return null;
  if (!workers.some((w) => isStale(w, now, staleMs, tsMap?.get(w.id)))) return null;
  if (lastSentAt !== undefined && now - lastSentAt < renudgeMs) return null; // throttle
  return { message: buildSummary(orchestrator, workers, now, staleMs, tsMap) };
}

export interface HeartbeatDeps {
  list: () => Promise<Session[]>;
  send: (sessionId: SessionId, message: string) => Promise<void>;
  activityTimestamp?: (session: Session) => Promise<Date | null>;
  now?: () => number;
  intervalMs?: number;
  staleMs?: number;
  renudgeMs?: number;
  onError?: (err: unknown) => void;
}

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
const lastSent = new Map<string, number>();

/** Start the periodic heartbeat. Idempotent — no-op if already running. */
export function startFeatureHeartbeat(deps: HeartbeatDeps): boolean {
  if (timer) return false;
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? TICK_MS;
  const staleMs = deps.staleMs ?? STALE_MS;
  const renudgeMs = deps.renudgeMs ?? RENUDGE_MS;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = (async () => {
      try {
        const sessions = await deps.list();
        const t = now();
        const tsMap = new Map<string, Date>();
        if (deps.activityTimestamp) {
          const candidates = sessions.filter(
            (s) => (s.branch?.startsWith("feature/") ?? false) && s.activity !== "exited",
          );
          await Promise.all(
            candidates.map(async (s) => {
              try {
                const ts = await deps.activityTimestamp!(s);
                if (ts) tsMap.set(s.id, ts);
              } catch {
                /* best-effort */
              }
            }),
          );
        }
        for (const orch of sessions) {
          try {
            const decision = evaluateOrchestrator(
              orch, sessions, t, lastSent.get(orch.id), staleMs, renudgeMs, tsMap,
            );
            if (!decision) continue;
            await deps.send(orch.id, decision.message);
            lastSent.set(orch.id, t);
          } catch (err) {
            deps.onError?.(err);
          }
        }
      } catch (err) {
        deps.onError?.(err);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  };

  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return true;
}

/** Stop the heartbeat and await any in-flight tick. */
export async function stopFeatureHeartbeat(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      /* best-effort */
    }
  }
  lastSent.clear();
}
