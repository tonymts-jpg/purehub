import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { BadgeCheck, LockKeyhole } from "lucide-react";
import { ChannelFeed } from "@/components/channels/channel-feed";
import { ChannelMembershipAction } from "@/components/channels/channel-membership-action";
import type { ChannelDetailDto, ChannelDetailResultDto } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

function isDetail(channel: ChannelDetailResultDto): channel is ChannelDetailDto {
  return "access" in channel;
}

async function fetchChannel(slug: string) {
  const requestHeaders = await headers();
  const port = process.env.PORT ?? "3000";
  return fetch(`http://127.0.0.1:${port}/api/channels/${encodeURIComponent(slug)}`, {
    cache: "no-store",
    headers: {
      cookie: requestHeaders.get("cookie") ?? ""
    }
  });
}

export default async function ChannelDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const response = await fetchChannel(slug);
  if (response.status === 404) notFound();
  if (!response.ok) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-8">
        <div role="alert" className="glass rounded-lg px-5 py-16">
          <h1 className="text-2xl font-black">频道暂时无法显示</h1>
          <p className="mt-2 text-sm muted">请稍后再试，或返回频道目录。</p>
        </div>
      </div>
    );
  }

  const { channel } = await response.json() as { channel: ChannelDetailResultDto };
  const detail = isDetail(channel) ? channel : null;
  const isPrivate = channel.visibility === "private";

  return (
    <div className="mx-auto min-w-0 max-w-6xl px-4 py-8 sm:px-8">
      <header data-testid="channel-header" className="glass min-w-0 overflow-hidden rounded-lg">
        <div className="relative aspect-[16/5] min-h-32 overflow-hidden bg-gradient-to-br from-[#332663] via-violet to-coral">
          <div className="mesh absolute inset-0" />
        </div>
        <div className="flex min-w-0 flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="break-words text-3xl font-black sm:text-4xl">{channel.name}</h1>
              {channel.kind === "official" && <BadgeCheck aria-label="官方频道" className="text-violet" />}
              {isPrivate && (
                <span className="flex items-center gap-1 rounded-lg bg-violet/10 px-2.5 py-1 text-xs font-black text-violet">
                  <LockKeyhole size={14} />
                  私人频道
                </span>
              )}
            </div>
            <p className="mt-3 max-w-3xl break-words leading-7 muted">{channel.description}</p>
            {detail && <p className="mt-3 text-sm muted">由 {detail.owner.name} 管理</p>}
          </div>
          {isPrivate && detail?.access.role === "owner" ? (
            <span className="rounded-lg border border-[var(--line)] px-4 py-3 text-sm font-black">
              频道所有者
            </span>
          ) : isPrivate && (
            <ChannelMembershipAction
              slug={channel.slug}
              initialState={detail?.access.role ? "member" : "available"}
            />
          )}
        </div>
      </header>

      <div className="mt-8">
        {detail ? (
          <ChannelFeed slug={detail.slug} initialPosts={detail.posts} initialCursor={detail.nextCursor} />
        ) : (
          <section className="glass rounded-lg px-5 py-16 text-center">
            <LockKeyhole className="mx-auto text-violet" />
            <h2 className="mt-4 text-xl font-black">申请通过后查看频道作品</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 muted">
              这里仅展示安全的频道简介，不公开作品、成员或管理信息。
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
