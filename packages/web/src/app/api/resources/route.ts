import { NextResponse, type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import { getResourceSnapshot } from "@/lib/resource-snapshot";

// Live per-request data — opt out of Next.js static route-handler caching.
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const { sessionManager } = await getServices();
    const sessions = await sessionManager.list();
    const snapshot = await getResourceSnapshot(sessions, Math.floor(Date.now() / 1000));
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to build resource snapshot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
