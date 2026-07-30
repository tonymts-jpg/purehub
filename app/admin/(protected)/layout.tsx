import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { adminPermissions } from "@/lib/admin-auth";
import { auth } from "@/lib/auth";
import type { AdminRole } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session?.user.id) redirect("/admin/sign-in");

  const account = await prisma.adminAccount.findFirst({
    where: { userId: session.user.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { role: true }
  }).catch(() => null);

  if (!account) redirect("/admin/sign-in");

  const role = account.role as AdminRole;
  return (
    <AdminShell role={role} permissions={adminPermissions(role)}>
      {children}
    </AdminShell>
  );
}
