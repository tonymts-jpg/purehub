import Link from "next/link";
import { ArrowRight, BadgeCheck, Camera, CheckCircle2, ClipboardList, CreditCard, FileText, ShieldCheck, Sparkles, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";

const requirements = [
  ["成年人身份", "申请人需年满 18 岁，并承诺作品中所有出镜人物均为成年人。", ShieldCheck],
  ["原创或授权内容", "上传内容需要来自本人创作、合作授权或可合法使用的素材。", FileText],
  ["清晰的创作方向", "建议准备频道定位、代表作品、会员权益和更新频率。", Camera],
  ["合规收款资料", "正式上线后需要完成基础资料、收款账户和必要的税务/KYC 流程。", CreditCard]
];

const steps = [
  ["提交申请", "填写昵称、频道方向、作品样本和联系方式。"],
  ["平台审核", "检查年龄合规、内容边界、版权来源和频道质量。"],
  ["设置主页", "完善头像、封面、简介、标签、会员方案和作品权限。"],
  ["发布作品", "上传公开预览与会员内容，设置免费、会员或单次购买。"],
  ["开始运营", "通过数据面板查看订阅、收入、转化率和粉丝互动。"]
];

const benefits = ["粉丝订阅收入", "单次购买作品", "作品收藏库曝光", "博主数据面板", "粉丝通知触达", "模拟钱包与提现流程"];

export default function BecomeCreatorPage() {
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <PageHeader title="成为博主" subtitle="了解在 PureHub 开设博主主页的要求、流程和运营方式。" action={<Link href="/dashboard/posts/new" className="brand-gradient flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white"><UserPlus size={17}/>体验发布作品</Link>}/>

    <section className="relative overflow-hidden rounded-[34px] bg-ink p-7 text-white shadow-2xl sm:p-10">
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-violet/35 blur-3xl"/>
      <div className="relative max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-[#ff8b82] backdrop-blur"><Sparkles size={14}/>博主入驻指南</span>
        <h2 className="mt-5 text-3xl font-black leading-tight sm:text-5xl">把作品、会员和收入放进同一个创作空间</h2>
        <p className="mt-4 max-w-2xl leading-7 text-white/65">PureHub Demo 目前不会收集真实证件或支付资料；这个页面用于展示正式版的博主入驻路径，方便投资人和合作方理解完整业务流程。</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/dashboard" className="rounded-full bg-white px-5 py-3 text-sm font-black text-ink">查看博主工作台</Link>
          <Link href="/trending/creators" className="flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-bold">查看热度博主<ArrowRight size={16}/></Link>
        </div>
      </div>
    </section>

    <section className="mt-8">
      <h2 className="mb-4 text-2xl font-black">入驻要求</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {requirements.map(([title,text,Icon])=><div key={title as string} className="glass rounded-[28px] p-6">
          <Icon className="mb-5 text-violet"/>
          <h3 className="font-black">{title as string}</h3>
          <p className="mt-2 text-sm leading-6 muted">{text as string}</p>
        </div>)}
      </div>
    </section>

    <section className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
      <div className="glass rounded-[30px] p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-2xl font-black"><ClipboardList className="text-coral"/>申请流程</h2>
        <div className="mt-6 space-y-4">
          {steps.map(([title,text],index)=><div key={title} className="flex gap-4 rounded-3xl bg-black/[.025] p-4 dark:bg-white/[.04]">
            <span className="brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-black text-white">0{index+1}</span>
            <div><h3 className="font-black">{title}</h3><p className="mt-1 text-sm leading-6 muted">{text}</p></div>
          </div>)}
        </div>
      </div>

      <aside className="glass rounded-[30px] p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-2xl font-black"><BadgeCheck className="text-violet"/>博主权益</h2>
        <div className="mt-6 space-y-3">
          {benefits.map(item=><p key={item} className="flex items-center gap-3 text-sm font-bold"><CheckCircle2 size={17} className="text-emerald-500"/>{item}</p>)}
        </div>
        <div className="mt-7 rounded-3xl bg-black/[.035] p-5 dark:bg-white/[.05]">
          <p className="text-sm font-black">Demo 说明</p>
          <p className="mt-2 text-xs leading-6 muted">当前版本只演示流程，不进行真实身份验证、收款绑定、KYC、支付或提现。</p>
        </div>
      </aside>
    </section>
  </div>
}
