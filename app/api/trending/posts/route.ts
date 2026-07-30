import { NextResponse } from "next/server";
import {
  listTrendingPosts,
  normalizeTrendingPostsLimit
} from "@/lib/search/repository";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseTrendingPostsLimit(request: Request): number {
  const searchParams = new URL(request.url).searchParams;
  for (const field of searchParams.keys()) {
    if (field !== "limit") {
      throw new TypeError(`此请求不接受 ${field} 查询参数。`);
    }
    if (searchParams.getAll(field).length > 1) {
      throw new TypeError(`${field} 查询参数最多只能提供一次。`);
    }
  }

  return normalizeTrendingPostsLimit(searchParams.get("limit"));
}

export async function GET(request: Request) {
  try {
    const limit = parseTrendingPostsLimit(request);
    const viewer = await getSessionUser(request);
    return NextResponse.json({
      posts: await listTrendingPosts(limit, viewer?.id ?? null)
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "暂时无法加载热度作品。" }, { status: 500 });
  }
}
