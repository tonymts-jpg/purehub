import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type SessionUser = {
  id: string;
  name: string;
  handle: string;
  email: string;
  avatar: string;
  role: string;
  creatorStatus: string;
  status: string;
};

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user.id) return null;
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, handle: true, email: true, avatar: true, role: true, creatorStatus: true, status: true }
    });
    return user?.status === "active" ? user : null;
  } catch {
    return null;
  }
}

export async function requireUser(request: Request) {
  const user = await getSessionUser(request);
  return user
    ? { ok: true as const, user }
    : { ok: false as const, response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
}

export async function requireCreator(request: Request) {
  const result = await requireUser(request);
  if (!result.ok) return result;
  if (result.user.role !== "creator" || result.user.creatorStatus !== "approved") {
    return { ok: false as const, response: NextResponse.json({ error: "Approved creator access is required." }, { status: 403 }) };
  }
  return result;
}

export function enforceSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const requestOrigin = new URL(request.url).origin;
  const allowed = new Set([requestOrigin, process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL].filter(Boolean));
  return allowed.has(origin)
    ? null
    : NextResponse.json({ error: "Cross-origin state change is not allowed." }, { status: 403 });
}
