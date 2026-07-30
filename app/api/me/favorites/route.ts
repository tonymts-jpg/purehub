import { NextResponse } from "next/server";
import { accountRouteError, favoriteListInput } from "@/lib/account/http";
import { listFavoriteChannels, listFavoritePosts } from "@/lib/account/repository";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session.ok) return session.response;

  try {
    const { type, ...input } = favoriteListInput(request);
    return NextResponse.json(type === "posts"
      ? await listFavoritePosts(session.user.id, input)
      : await listFavoriteChannels(session.user.id, input));
  } catch (error) {
    return accountRouteError(error);
  }
}
