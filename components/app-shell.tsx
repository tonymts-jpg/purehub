"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bookmark, Compass, Heart, History, Home, LayoutDashboard, LockKeyhole, LogIn, LogOut, Moon, PlusCircle, Radio, Search, ShoppingBag, Sparkles, Sun, UserPlus, UserRound, Users, WalletCards, type LucideIcon } from "lucide-react";
import { useDemoStore } from "@/lib/store";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { accountNav, canApplyAsCreator, creatorNav, isApprovedCreator, publicNav, type NavItem } from "@/components/account-nav";

const navigationIcons: Record<string, LucideIcon> = {
  "/": Home,
  "/explore": Compass,
  "/channels": Radio,
  "/search": Search,
  "/favorites": Bookmark,
  "/unlocked": LockKeyhole,
  "/likes": Heart,
  "/history": History,
  "/orders": ShoppingBag,
  "/following": Users,
  "/notifications": Bell,
  "/dashboard": LayoutDashboard,
  "/dashboard/posts": Bookmark,
  "/dashboard/posts/new": PlusCircle,
  "/dashboard/channels": Radio,
  "/dashboard/members": Users,
  "/dashboard/wallet": WalletCards,
  "/become-creator": UserPlus,
  "/me": UserRound
};

const becomeCreatorNav: NavItem = { href: "/become-creator", label: "成为博主" };
const mobileNav: NavItem[] = [publicNav[0], publicNav[1], publicNav[2], { href: "/me", label: "我的" }];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme, toast, clearToast } = useDemoStore();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const sessionUser = user ? { role: user.role ?? undefined, creatorStatus: user.creatorStatus ?? undefined, status: user.status ?? undefined } : null;
  const approvedCreator = isApprovedCreator(sessionUser);

  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, 2400);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  return <div data-testid="site-shell" className="min-h-screen">
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-64 border-r border-[var(--line)] bg-[var(--bg)]/90 px-5 py-7 backdrop-blur-xl lg:flex lg:flex-col">
      <Link href="/" className="mb-9 flex items-center gap-3 text-xl font-black tracking-tight">
        <span className="brand-gradient grid h-10 w-10 place-items-center rounded-2xl text-white"><Sparkles size={20} /></span>PureHub
      </Link>
      <nav aria-label="公共导航" className="space-y-1">
        <NavigationLinks items={[...publicNav, ...(canApplyAsCreator(sessionUser) ? [becomeCreatorNav] : [])]} pathname={pathname} />
      </nav>
      {user && <>
        <div className="my-6 border-t border-[var(--line)]" />
        <p id="account-navigation-heading" className="mb-2 px-4 text-[11px] font-bold uppercase tracking-[.18em] muted">账户</p>
        <nav aria-labelledby="account-navigation-heading" className="space-y-1"><NavigationLinks items={accountNav} pathname={pathname} /></nav>
      </>}
      {approvedCreator && <>
        <div className="my-6 border-t border-[var(--line)]" />
        <p id="creator-navigation-heading" className="mb-2 px-4 text-[11px] font-bold uppercase tracking-[.18em] muted">博主空间</p>
        <nav aria-labelledby="creator-navigation-heading" className="space-y-1"><NavigationLinks items={creatorNav} pathname={pathname} creator /></nav>
      </>}
      <div className="mt-auto space-y-3">
        <button onClick={toggleTheme} className="glass flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold"><span className="flex items-center gap-3">{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}外观模式</span><span className="muted">{theme === "light" ? "浅色" : "深色"}</span></button>
        {user ? <div className="glass flex items-center gap-3 rounded-2xl p-3"><Avatar text={user.name.slice(0, 1).toUpperCase()} small /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{user.name}</p><p className="truncate text-xs muted">{approvedCreator ? "博主" : "粉丝"}</p></div><button title="登出" aria-label="登出" onClick={() => authClient.signOut().then(() => window.location.assign("/"))} className="rounded-xl p-2 muted hover:bg-black/5"><LogOut size={17} /></button></div> : <Link href="/sign-in" className="brand-gradient flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white"><LogIn size={17} />登入</Link>}
      </div>
    </aside>
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/85 px-4 backdrop-blur-xl lg:hidden">
      <Link href="/" className="flex items-center gap-2 font-black"><span className="brand-gradient grid h-8 w-8 place-items-center rounded-xl text-white"><Sparkles size={16} /></span>PureHub</Link>
      <div className="flex items-center gap-2">
        <Link href="/search" aria-label="搜索" title="搜索" className="glass rounded-xl p-2"><Search size={18} /></Link>
        <button onClick={toggleTheme} aria-label="切换主题" className="glass rounded-xl p-2">{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
        {user ? <button title="登出" aria-label="登出" onClick={() => authClient.signOut().then(() => window.location.assign("/"))} className="glass rounded-xl p-2"><LogOut size={18} /></button> : <Link href="/sign-in" aria-label="登入" className="brand-gradient rounded-xl p-2 text-white"><LogIn size={18} /></Link>}
      </div>
    </header>
    <main className="pb-24 lg:ml-64 lg:pb-0">{children}</main>
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-[var(--line)] bg-[var(--bg)]/92 px-2 py-2 backdrop-blur-xl lg:hidden">
      {mobileNav.map((item) => {
        const Icon = navigationIcons[item.href];
        return <Link key={item.href} href={item.href} className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold ${pathname === item.href ? "text-violet" : "muted"}`}><Icon size={20} /><span className="max-w-full truncate">{item.label}</span></Link>;
      })}
    </nav>
    {toast && <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-2xl dark:bg-white dark:text-ink">{toast}</div>}
  </div>;
}

function NavigationLinks({ items, pathname, creator = false }: { items: NavItem[]; pathname: string; creator?: boolean }) {
  return items.map((item) => {
    const Icon = navigationIcons[item.href];
    const active = pathname === item.href;
    return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${active ? (creator ? "bg-gradient-to-r from-coral to-violet text-white" : "bg-ink text-white dark:bg-white dark:text-ink") : "muted hover:bg-black/5 dark:hover:bg-white/5"}`}><Icon size={19} />{item.label}</Link>;
  });
}

export function Avatar({ text, small = false }: { text: string; small?: boolean }) {
  return <span className={`brand-gradient grid shrink-0 place-items-center rounded-full font-bold text-white shadow-lg ${small ? "h-10 w-10 text-sm" : "h-12 w-12"}`}>{text}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>{subtitle && <p className="mt-2 muted">{subtitle}</p>}</div>{action}</div>;
}
