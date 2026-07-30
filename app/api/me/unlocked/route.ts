import { NextResponse } from "next/server";
import { accountRouteError } from "@/lib/account/http";
import {
  accountListInput,
  assertNoAccountIdentityOverrideHeaders,
  listUnlockedPosts
} from "@/lib/account/repository";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertNoAccountIdentityOverrideHeaders(request);
  } catch (error) {
    return accountRouteError(error);
  }
  const session = await requireUser(request);
  if (!session.ok) return session.response;

  try {
    return NextResponse.json(
      await listUnlockedPosts(session.user.id, accountListInput(request))
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
