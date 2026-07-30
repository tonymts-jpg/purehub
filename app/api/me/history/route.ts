import { NextResponse } from "next/server";
import { accountRouteError } from "@/lib/account/http";
import {
  assertNoAccountIdentityOverrideHeaders,
  listPostHistory,
  type AccountListInput
} from "@/lib/account/repository";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function historyListInput(request: Request): AccountListInput {
  const searchParams = new URL(request.url).searchParams;
  const allowed = new Set(["cursor", "limit"]);
  for (const field of searchParams.keys()) {
    if (!allowed.has(field)) {
      throw new TypeError(`This request does not accept the ${field} query parameter.`);
    }
    if (searchParams.getAll(field).length > 1) {
      throw new TypeError(`The ${field} query parameter may be provided at most once.`);
    }
  }

  const cursor = searchParams.get("cursor");
  if (cursor !== null && cursor.length === 0) {
    throw new TypeError("Account cursor is invalid.");
  }
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    throw new TypeError("Limit must be an integer between 1 and 50.");
  }
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  return {
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

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
      await listPostHistory(session.user.id, historyListInput(request))
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
