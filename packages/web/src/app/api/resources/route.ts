import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import { getResourceSnapshot } from "@/lib/resource-snapshot";

export async function GET(_request: NextRequest): Promise<Response> {
  const { sessionManager } = await getServices();
  const sessions = await sessionManager.list();
  const snapshot = await getResourceSnapshot(sessions, Math.floor(Date.now() / 1000));
  return Response.json(snapshot);
}
