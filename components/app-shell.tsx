"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpen, Compass, Home, LayoutDashboard, LogIn, LogOut, Moon, PlusCircle, ShieldCheck, Sparkles, Sun, UserPlus, UserRound } from "lucide-react";
import { useDemoStore } from "@/lib/store";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

const nav = [
  {href:"/",label:"首页",icon:Home},{href:"/explore",label:"探索",icon:Compass},
  {href:"/library",label:"收藏库",icon:BookOpen},{href:"/notifications",label:"通知",icon:Bell},
  {href:"/become-creator",label:"成为博主",icon:UserPlus}
];

export function AppShell({children}:{children:React.ReactNode}) {
  const pathname=usePathname(); const {theme,toggleTheme,role,toast,clearToast}=useDemoStore();
  const {data:session}=authClient.useSession();
  useEffect(()=>{document.documentElement.classList.toggle("dark",theme==="dark")},[theme]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(clearToast,2400);return()=>clearTimeout(t)},[toast,clearToast]);
  const dashboard=pathname.startsWith("/dashboard");
  return <div className="min-h-screen">
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-64 border-r border-[var(--line)] bg-[var(--bg)]/90 px-5 py-7 backdrop-blur-xl lg:flex lg:flex-col">
      <Link href="/" className="mb-9 flex items-center gap-3 text-xl font-black tracking-tight">
        <span className="brand-gradient grid h-10 w-10 place-items-center rounded-2xl text-white"><Sparkles size={20}/></span>PureHub
      </Link>
      <nav className="space-y-1">
        {nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${pathname===href?"bg-ink text-white dark:bg-white dark:text-ink":"muted hover:bg-black/5 dark:hover:bg-white/5"}`}><Icon size={19}/>{label}</Link>)}
        <Link href="/admin" className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${pathname==="/admin"?"bg-ink text-white dark:bg-white dark:text-ink":"muted hover:bg-black/5 dark:hover:bg-white/5"}`}><ShieldCheck size={19}/>站务后台</Link>
      </nav>
      <div className="my-6 border-t border-[var(--line)]"/>
      <p className="mb-2 px-4 text-[11px] font-bold uppercase tracking-[.18em] muted">博主空间</p>
      <Link href="/dashboard" className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${dashboard?"bg-gradient-to-r from-coral to-violet text-white":"muted hover:bg-black/5 dark:hover:bg-white/5"}`}><LayoutDashboard size={19}/>博主工作台</Link>
      <Link href="/dashboard/posts/new" className="mt-2 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold muted hover:bg-black/5 dark:hover:bg-white/5"><PlusCircle size={19}/>发布作品</Link>
      <div className="mt-auto space-y-3">
        <button onClick={toggleTheme} className="glass flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold"><span className="flex items-center gap-3">{theme==="light"?<Moon size={18}/>:<Sun size={18}/>}外观模式</span><span className="muted">{theme==="light"?"浅色":"深色"}</span></button>
        {session?.user?<div className="glass flex items-center gap-3 rounded-2xl p-3"><Avatar text={session.user.name.slice(0,1).toUpperCase()} small/><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{session.user.name}</p><p className="truncate text-xs muted">{session.user.email}</p></div><button title="登出" aria-label="登出" onClick={()=>authClient.signOut().then(()=>window.location.assign("/"))} className="rounded-xl p-2 muted hover:bg-black/5"><LogOut size={17}/></button></div>:<Link href="/sign-in" className="brand-gradient flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white"><LogIn size={17}/>登入</Link>}
        <Link href="/demo" className="glass flex items-center gap-3 rounded-2xl p-3">
          <Avatar text={role==="creator"?"夕":"P"} small/>
          <div className="min-w-0"><p className="truncate text-sm font-bold">{role==="creator"?"林夕 Yuki":"Pure 粉丝"}</p><p className="text-xs muted">Demo 模式 · {role==="creator"?"博主":"粉丝"}</p></div>
        </Link>
      </div>
    </aside>
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/85 px-4 backdrop-blur-xl lg:hidden">
      <Link href="/" className="flex items-center gap-2 font-black"><span className="brand-gradient grid h-8 w-8 place-items-center rounded-xl text-white"><Sparkles size={16}/></span>PureHub</Link>
      <div className="flex items-center gap-2">
        <button onClick={toggleTheme} aria-label="切换主题" className="glass rounded-xl p-2">{theme==="light"?<Moon size={18}/>:<Sun size={18}/>}</button>
        {session?.user?<button title="登出" aria-label="登出" onClick={()=>authClient.signOut().then(()=>window.location.assign("/"))} className="glass rounded-xl p-2"><LogOut size={18}/></button>:<Link href="/sign-in" aria-label="登入" className="brand-gradient rounded-xl p-2 text-white"><LogIn size={18}/></Link>}
      </div>
    </header>
    <main className="pb-24 lg:ml-64 lg:pb-0">{children}</main>
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-[var(--line)] bg-[var(--bg)]/92 px-2 py-2 backdrop-blur-xl lg:hidden">
      {[nav[0],nav[1],nav[4],{href:"/dashboard",label:"工作台",icon:UserRound}].map(({href,label,icon:Icon})=><Link key={href} href={href} className={`flex min-w-16 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold ${pathname===href?"text-violet":"muted"}`}><Icon size={20}/>{label}</Link>)}
    </nav>
    {toast&&<div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-2xl dark:bg-white dark:text-ink">{toast}</div>}
  </div>
}

export function Avatar({text,small=false}:{text:string;small?:boolean}) {
  return <span className={`brand-gradient grid shrink-0 place-items-center rounded-full font-bold text-white shadow-lg ${small?"h-10 w-10 text-sm":"h-12 w-12"}`}>{text}</span>
}

export function PageHeader({title,subtitle,action}:{title:string;subtitle?:string;action?:React.ReactNode}) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>{subtitle&&<p className="mt-2 muted">{subtitle}</p>}</div>{action}</div>
}
