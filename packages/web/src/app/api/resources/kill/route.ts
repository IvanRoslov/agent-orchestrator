import { type NextRequest, NextResponse } from "next/server";
import { TERMINAL_STATUSES, type SessionStatus } from "@aoagents/ao-core";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import { killTmuxSession } from "@/lib/tmux-sessions";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as { tmuxSession?: unknown } | null;
    const err = validateIdentifier(body?.tmuxSession, "tmuxSession");
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const name = body!.tmuxSession as string;

    const { sessionManager } = await getServices();
    const session = await sessionManager.get(name);

    if (session && !TERMINAL_STATUSES.has(session.status as SessionStatus)) {
      await sessionManager.kill(session.id);
      return NextResponse.json({ killed: true, path: "lifecycle" });
    }

    await killTmuxSession(name);
    return NextResponse.json({ killed: true, path: "tmux" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to kill session" },
      { status: 500 },
    );
  }
}
