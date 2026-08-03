import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_FINANCE_TABS, FinancePage, type AdminFinanceTab } from "@/components/admin/finance-page";
import { canAdminAccess } from "@/lib/admin-auth";
import { auth } from "@/lib/auth";
import type { AdminRole } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminFinanceRoute({ searchParams }: { searchParams: SearchParams }) {
  const role = await currentAdminRole();
  if (!role || !canAdminAccess(role, "finance", "read")) redirect("/admin");
  const query = await searchParams;
  return <FinancePage initialTab={financeTab(single(query.tab))} initialStatus={single(query.status)} canWrite={canAdminAccess(role, "finance", "write")} />;
}

async function currentAdminRole() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const account = session?.user.id ? await prisma.adminAccount.findFirst({
    where: { userId: session.user.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { role: true }
  }).catch(() => null) : null;
  return account?.role as AdminRole | undefined;
}

function financeTab(value: string): AdminFinanceTab {
  return ADMIN_FINANCE_TABS.includes(value as AdminFinanceTab) ? value as AdminFinanceTab : "orders";
}

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}
