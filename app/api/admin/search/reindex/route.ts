import { NextResponse } from "next/server";
import {
  isChannelAdminRole,
  requireAdmin
} from "@/lib/admin-auth";
import {
  readChannelJson,
  requireEmptyChannelMutation,
  requireEmptyChannelQuery
} from "@/lib/channels/http";
import { enforceSameOrigin } from "@/lib/session";
import { requestSearchReindex } from "@/lib/search/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const auth = await requireAdmin(request, "channels", "write");
  if (!auth.ok) return auth.response;
  if (!isChannelAdminRole(auth.admin.role)) {
    return NextResponse.json({ error: "Admin role cannot reindex search." }, { status: 403 });
  }
  try {
    requireEmptyChannelQuery(new URL(request.url).searchParams);
    requireEmptyChannelMutation(await readChannelJson(request, true));
    const result = await requestSearchReindex(auth.admin);
    return NextResponse.json(result, { status: result.enqueued ? 202 : 200 });
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Search reindex could not be scheduled." }, { status: 500 });
  }
}
