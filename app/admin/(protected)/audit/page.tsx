import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuditPage } from "@/components/admin/audit-page";
import { canAdminAccess } from "@/lib/admin-auth";
import { auth } from "@/lib/auth";
import type { AdminRole } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAuditRoute({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const account = session?.user.id ? await prisma.adminAccount.findFirst({
    where: { userId: session.user.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { role: true }
  }).catch(() => null) : null;
  const role = account?.role as AdminRole | undefined;
  if (!role || !canAdminAccess(role, "audit", "read")) redirect("/admin");
  const query = await searchParams;
  return <AuditPage initialCursor={single(query.cursor)} />;
}

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}
