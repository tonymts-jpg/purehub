import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  AdminContentInputError,
  moderateAdminContent,
  parseAdminContentAction
} from "@/lib/admin-content-repository";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const auth = await requireAdmin(request, "content", "write");
  if (!auth.ok) return auth.response;

  try {
    const searchParams = new URL(request.url).searchParams;
    if ([...searchParams.keys()].length) {
      throw new AdminContentInputError("Unsupported admin content query parameter.");
    }
    const { id } = await params;
    const post = await moderateAdminContent(
      auth.admin,
      id,
      parseAdminContentAction(await request.json())
    );
    return NextResponse.json({ post });
  } catch (error) {
    if (error instanceof AdminContentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Content was not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unable to moderate content." }, { status: 500 });
  }
}
