import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SettingsPage } from "@/components/admin/settings-page";
import { canAdminAccess, canAdminManageSettings } from "@/lib/admin-auth";
import { auth } from "@/lib/auth";
import type { AdminRole } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminSettingsRoute() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const account = session?.user.id ? await prisma.adminAccount.findFirst({
    where: { userId: session.user.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { role: true }
  }).catch(() => null) : null;
  const role = account?.role as AdminRole | undefined;
  if (!role || !canAdminAccess(role, "settings", "read")) redirect("/admin");

  return <SettingsPage capabilities={{
    finance: canAdminManageSettings(role, "finance"),
    operations: canAdminManageSettings(role, "operations")
  }} />;
}
