import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseAdminUserStatePatch, updateAdminUser } from "@/lib/admin-repository";
import { enforceSameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "members", "write");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const user = await updateAdminUser(
      auth.admin,
      id,
      parseAdminUserStatePatch(await request.json())
    );
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid admin member state.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid admin member state." }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to update member state." }, { status: 500 });
  }
}
