import { NextResponse } from "next/server";
import { channelListInput, channelRouteError } from "@/lib/channels/http";
import { listChannels } from "@/lib/channels/repository";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    return NextResponse.json(await listChannels(
      channelListInput(request),
      user?.id ?? null,
      { publicOnly: true }
    ));
  } catch (error) {
    return channelRouteError(error);
  }
}
