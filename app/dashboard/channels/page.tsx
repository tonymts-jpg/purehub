"use client";

import { PageHeader } from "@/components/app-shell";
import { ChannelManager } from "@/components/channels/channel-manager";
import { DashboardNav } from "@/components/dashboard-nav";

export default function DashboardChannelsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader
        title="频道管理"
        subtitle="管理审核状态、成员、策展规则与频道内容。"
      />
      <DashboardNav />
      <ChannelManager />
    </div>
  );
}
