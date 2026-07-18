import { NextResponse } from "next/server";
import { enforceSameOrigin, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;
  const result = await prisma.notification.updateMany({ where: { id: (await params).id, recipientUserId: session.user.id }, data: { readAt: new Date() } });
  return result.count ? NextResponse.json({ read: true }) : NextResponse.json({ error: "Notification not found." }, { status: 404 });
}
