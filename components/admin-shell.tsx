"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="admin-shell" className="min-h-screen bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <span className="flex items-center gap-2 font-black"><ShieldCheck size={20} />PureHub Admin</span>
        <button
          type="button"
          aria-label="登出站务后台"
          onClick={() => authClient.signOut().then(() => window.location.assign("/sign-in"))}
          className="rounded-full border border-[var(--line)] p-2"
        >
          <LogOut size={18} />
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}
