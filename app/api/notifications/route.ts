import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listNotifications } from "@/lib/social-repository";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  const url = new URL(request.url);
  return NextResponse.json(await listNotifications(session.user.id, url.searchParams.get("cursor") ?? undefined, url.searchParams.get("unreadOnly") === "true"));
}
