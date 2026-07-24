import { headers } from "next/headers";
import { ChannelDirectory } from "@/components/channels/channel-directory";
import type { ChannelListItemDto } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

type ChannelPage = { channels: ChannelListItemDto[]; nextCursor: string | null };

async function fetchInitialChannels(): Promise<{ page: ChannelPage; error: string }> {
  const requestHeaders = await headers();
  const port = process.env.PORT ?? "3000";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/channels?limit=20`, {
      cache: "no-store",
      headers: { cookie: requestHeaders.get("cookie") ?? "" }
    });
    if (!response.ok) throw new Error("Channel directory request failed.");
    return { page: await response.json() as ChannelPage, error: "" };
  } catch {
    return {
      page: { channels: [], nextCursor: null },
      error: "频道目录暂时无法使用。"
    };
  }
}

export default async function ChannelsPage() {
  const initial = await fetchInitialChannels();
  return <ChannelDirectory initialPage={initial.page} initialError={initial.error} />;
}
