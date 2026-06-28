import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Flame, Sparkles, TrendingUp } from "lucide-react";

export function Hero() {
  return <section className="relative mb-7 min-h-[195px] overflow-hidden rounded-[30px] bg-ink text-white shadow-2xl">
    <Image src="/purehub-hero.png" alt="PureHub 博主社区主视觉" fill priority className="object-cover object-center"/>
    <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent"/>
    <div className="relative z-10 max-w-xl px-6 py-7 sm:px-10 sm:py-9">
      <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur"><Sparkles size={13} className="text-coral"/>创作，不必独自发生</span>
      <h1 className="text-3xl font-black leading-[1.08] tracking-tight sm:text-5xl">让热爱成为<br/><span className="text-[#ff8b82]">持续的回响</span></h1>
      <p className="mt-3 max-w-md text-xs leading-6 text-white/75 sm:text-sm">连接博主与真正关心作品的人。分享过程、建立会员社区，也让每一次支持都有温度。</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/trending/posts" className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-ink"><Flame size={16}/>热度作品<ArrowRight size={16}/></Link>
        <Link href="/trending/creators" className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold backdrop-blur"><TrendingUp size={16}/>热度博主</Link>
      </div>
    </div>
  </section>
}
