"use client";

import { LogOut, Menu, ShieldCheck } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { authClient } from "@/lib/auth-client";
import type { AdminSection } from "@/lib/admin-auth";
import type { AdminRole } from "@/lib/platform-config";

export function AdminShell({
  role,
  permissions,
  children
}: {
  role: AdminRole;
  permissions: readonly AdminSection[];
  children: React.ReactNode;
}) {
  function signOut() {
    void authClient.signOut().then(() => window.location.assign("/admin/sign-in"));
  }

  return (
    <div data-testid="admin-shell" className="min-h-screen bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2 font-black"><ShieldCheck size={20} />PureHub Admin</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-bold muted sm:inline">{role}</span>
          <button
            type="button"
            aria-label="退出管理后台"
            onClick={signOut}
            className="rounded-full border border-[var(--line)] p-2"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="md:grid md:min-h-[calc(100vh-73px)] md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--line)] p-4 md:block">
          <AdminNav permissions={permissions} />
        </aside>

        <div className="border-b border-[var(--line)] p-3 md:hidden">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-black">
              <Menu size={18} />
              管理导航
            </summary>
            <div className="mt-2 rounded-2xl border border-[var(--line)] p-2">
              <AdminNav permissions={permissions} />
            </div>
          </details>
        </div>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
