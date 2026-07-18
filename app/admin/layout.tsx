import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session?.user.id) redirect("/sign-in?callbackUrl=/admin");
  const account = await prisma.adminAccount.findFirst({ where: { userId: session.user.id, status: "active" }, select: { id: true } }).catch(() => null);
  if (!account) redirect("/");
  return children;
}
