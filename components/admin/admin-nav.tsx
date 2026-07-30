import Link from "next/link";
import type { AdminSection } from "@/lib/admin-auth";

export type AdminNavigationItem = {
  section: AdminSection;
  label: string;
  href: string;
};

export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
  { section: "overview", label: "概览", href: "/admin" },
  { section: "members", label: "会员管理", href: "/admin/members" },
  { section: "creators", label: "创作者管理", href: "/admin/creators" },
  { section: "content", label: "内容管理", href: "/admin/content" },
  { section: "channels", label: "频道管理", href: "/admin/channels" },
  { section: "finance", label: "订单与财务", href: "/admin/finance" },
  { section: "settings", label: "平台设置", href: "/admin/settings" },
  { section: "audit", label: "审计日志", href: "/admin/audit" }
];

export function adminNavigationForPermissions(permissions: readonly AdminSection[]) {
  const allowed = new Set<AdminSection>(permissions);
  return ADMIN_NAVIGATION.filter((item) => allowed.has(item.section));
}

export function AdminNav({ permissions, onNavigate }: {
  permissions: readonly AdminSection[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="管理后台导航" className="space-y-1">
      {adminNavigationForPermissions(permissions).map((item) => (
        <Link
          key={item.section}
          href={item.href}
          onClick={onNavigate}
          className="block rounded-xl px-3 py-2 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/10"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
