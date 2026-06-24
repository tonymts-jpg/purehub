import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Play, Sparkles } from "lucide-react";

export function Hero() {
  return <section className="relative mb-8 min-h-[390px] overflow-hidden rounded-[36px] bg-ink text-white shadow-2xl">
    <Image src="/purehub-hero.png" alt="PureHub 创作者社区主视觉" fill priority className="object-cover object-center"/>
    <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent"/>
    <div className="relative z-10 max-w-xl px-7 py-12 sm:px-12 sm:py-16">
      <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold backdrop-blur"><Sparkles size={14} className="text-coral"/>创作，不必独自发生</span>
      <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">让热爱成为<br/><span className="text-[#ff8b82]">持续的回响</span></h1>
      <p className="mt-5 max-w-md text-sm leading-7 text-white/75 sm:text-base">连接创作者与真正关心作品的人。分享过程、建立会员社区，也让每一次支持都有温度。</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/explore" className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-ink">开始探索<ArrowRight size={16}/></Link>
        <Link href="/demo" className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold backdrop-blur"><Play size={16} fill="currentColor"/>查看演示</Link>
      </div>
    </div>
  </section>
}
