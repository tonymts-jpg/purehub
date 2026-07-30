import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  AdminContentInputError,
  listAdminContent,
  parseAdminContentListInput
} from "@/lib/admin-content-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "content", "read");
  if (!auth.ok) return auth.response;

  try {
    const content = await listAdminContent(
      parseAdminContentListInput(new URL(request.url).searchParams)
    );
    return NextResponse.json(content);
  } catch (error) {
    if (error instanceof AdminContentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to load admin content." }, { status: 500 });
  }
}
