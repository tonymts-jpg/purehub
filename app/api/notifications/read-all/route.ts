import { NextResponse } from "next/server";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  const result = await prisma.notification.updateMany({ where: { recipientUserId: session.user.id, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ updated: result.count });
}
