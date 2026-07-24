import { NextResponse } from "next/server";
import type { SearchInput } from "@/lib/channels/types";
import { getSessionUser } from "@/lib/session";
import { searchEntities } from "@/lib/search/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEARCH_QUERY_FIELDS = new Set(["q", "type", "cursor", "limit"]);

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const unsupported = Array.from(searchParams.keys())
      .find((field) => !SEARCH_QUERY_FIELDS.has(field));
    if (unsupported) {
      throw new TypeError(`This request does not accept the ${unsupported} query parameter.`);
    }
    const duplicate = Array.from(SEARCH_QUERY_FIELDS)
      .find((field) => searchParams.getAll(field).length > 1);
    if (duplicate) {
      throw new TypeError(`This request accepts the ${duplicate} query parameter only once.`);
    }
    const query = searchParams.get("q");
    const type = searchParams.get("type");
    const cursor = searchParams.get("cursor");
    const limit = searchParams.get("limit");
    const input: SearchInput = {
      query: query ?? "",
      ...(type !== null ? { type: type as SearchInput["type"] } : {}),
      ...(cursor !== null ? { cursor } : {}),
      ...(limit !== null ? { limit: Number(limit) } : {})
    };
    const viewer = await getSessionUser(request);
    return NextResponse.json(await searchEntities(input, viewer?.id ?? null));
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Search is temporarily unavailable." }, { status: 500 });
  }
}
