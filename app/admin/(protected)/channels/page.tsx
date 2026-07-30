import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { AdminChannelOperations } from "@/components/channels/admin-channel-operations";
import { adminPermissions, canAdminAccess } from "@/lib/admin-auth";
import { auth } from "@/lib/auth";
import type { AdminRole } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminChannelsRoute({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const account = session?.user.id
    ? await prisma.adminAccount.findFirst({
        where: { userId: session.user.id, status: "active" },
        orderBy: { createdAt: "asc" },
        select: { role: true }
      }).catch(() => null)
    : null;
  const role = account?.role as AdminRole | undefined;
  if (!role || !canAdminAccess(role, "channels", "read")) redirect("/admin");

  const query = await searchParams;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="频道管理" subtitle="审核频道并管理生命周期、所有权、配额与策展作业。" />
      <AdminChannelOperations
        admin={{ role, permissions: adminPermissions(role) }}
        initialStatus={single(query.status) || "pending"}
      />
    </div>
  );
}

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}
