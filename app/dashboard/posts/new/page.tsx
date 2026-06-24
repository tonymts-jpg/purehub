"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { DashboardNav } from "@/components/dashboard-nav";
import { useDemoStore } from "@/lib/store";
import { CONTENT_CATEGORIES } from "@/lib/categories";

const schema=z.object({title:z.string().min(3,"请输入至少 3 个字"),excerpt:z.string().min(8,"请输入至少 8 个字"),content:z.string().min(20,"正文至少 20 个字"),category:z.enum(CONTENT_CATEGORIES),visibility:z.enum(["free","members","purchase"])});
type Form=z.infer<typeof schema>;
export default function NewPostPage(){
  const router=useRouter(); const createPost=useDemoStore(s=>s.createPost); const [preview,setPreview]=useState(false);
  const {register,handleSubmit,watch,formState:{errors,isSubmitting}}=useForm<Form>({resolver:zodResolver(schema),defaultValues:{category:"Cosplay",visibility:"free"}});
  const values=watch();
  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8"><PageHeader title="发布新作品" subtitle="分享完成品，也分享作品诞生之前的那些时刻。"/><DashboardNav/>
    <form onSubmit={handleSubmit(async data=>{createPost(data);router.push("/dashboard/posts")})} className="grid gap-6 lg:grid-cols-[1fr_300px]"><div className="glass space-y-5 rounded-[30px] p-6 sm:p-8"><Field label="作品标题" error={errors.title?.message}><input {...register("title")} placeholder="给作品一个让人记住的名字" className="w-full bg-transparent text-2xl font-black outline-none"/></Field><Field label="简短介绍" error={errors.excerpt?.message}><textarea {...register("excerpt")} rows={3} placeholder="这件作品想分享什么？" className="w-full resize-none rounded-2xl bg-black/[.035] p-4 outline-none dark:bg-white/[.04]"/></Field><Field label="正文内容" error={errors.content?.message}><textarea {...register("content")} rows={10} placeholder="写下创作过程、灵感和想对支持者说的话…" className="w-full resize-none rounded-2xl bg-black/[.035] p-4 leading-7 outline-none dark:bg-white/[.04]"/></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="分类"><select {...register("category")} className="w-full rounded-2xl border border-[var(--line)] bg-transparent p-3">{CONTENT_CATEGORIES.map(category=><option key={category}>{category}</option>)}</select></Field><Field label="谁可以看"><select {...register("visibility")} className="w-full rounded-2xl border border-[var(--line)] bg-transparent p-3"><option value="free">所有人</option><option value="members">会员限定</option><option value="purchase">单次购买</option></select></Field></div></div>
      <aside className="space-y-5"><div className="glass rounded-[30px] p-5"><p className="mb-3 text-sm font-black">封面预览</p><button type="button" onClick={()=>setPreview(true)} className="cover-1 mesh relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl text-white"><ImagePlus/><span className="absolute bottom-3 text-xs font-bold">使用 Demo 品牌封面</span></button></div><div className="glass rounded-[30px] p-5"><div className="flex items-center gap-2"><Sparkles size={17} className="text-coral"/><p className="font-black">发布检查</p></div><ul className="mt-4 space-y-2 text-sm muted"><li>✓ 标题清晰易懂</li><li>✓ 内容不包含敏感资料</li><li>✓ 权限设置符合预期</li></ul></div><button disabled={isSubmitting} className="brand-gradient w-full rounded-full py-4 font-black text-white disabled:opacity-50">发布作品</button></aside>
    </form>
    {preview&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={()=>setPreview(false)}><div className="cover-1 mesh aspect-[16/10] w-full max-w-3xl rounded-[30px] p-8 text-white"><p className="text-sm font-bold">封面预览</p><h2 className="mt-24 max-w-xl text-4xl font-black">{values.title||"你的作品标题"}</h2><p className="mt-3 max-w-lg text-white/75">{values.excerpt||"作品介绍将显示在这里。"}</p></div></div>}
  </div>;
}
function Field({label,error,children}:{label:string;error?:string;children:React.ReactNode}){return <label className="block"><span className="mb-2 block text-xs font-bold muted">{label}</span>{children}{error&&<span className="mt-1 block text-xs text-coral">{error}</span>}</label>}
