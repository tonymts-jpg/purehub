"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { DashboardNav } from "@/components/dashboard-nav";
import { useDemoStore } from "@/lib/store";
import { CONTENT_CATEGORIES } from "@/lib/categories";
import type { ContentType, SaleMode } from "@/lib/platform-config";

type PriceTier = { id: string; price: number; currency: string; contentType: ContentType; saleMode: SaleMode };

const schema = z.object({
  title: z.string().min(3, "请输入至少 3 个字"),
  excerpt: z.string().min(8, "请输入至少 8 个字"),
  content: z.string().min(20, "正文至少 20 个字"),
  category: z.enum(CONTENT_CATEGORIES),
  contentType: z.enum(["photo_short", "long_video"]),
  saleMode: z.enum(["single_plus_subscription", "subscription_only", "long_video_single"]),
  price: z.number().int().nonnegative().default(0)
});

type FormInput = z.input<typeof schema>;

const visibilityForSaleMode = (saleMode: SaleMode) => saleMode === "subscription_only" ? "members" : "purchase";

export default function NewPostPage() {
  const router = useRouter();
  const createPost = useDemoStore((state) => state.createPost);
  const [preview, setPreview] = useState(false);
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [mediaAssetIds, setMediaAssetIds] = useState<string[]>([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { category: "Cosplay", contentType: "photo_short", saleMode: "subscription_only", price: 0 }
  });
  const values = watch();
  const priced = values.saleMode !== "subscription_only";

  useEffect(() => {
    if (values.contentType === "photo_short" && values.saleMode === "long_video_single") {
      setValue("saleMode", "single_plus_subscription");
      return;
    }
    const controller = new AbortController();
    fetch(`/api/pricing/tiers?levelId=level-2&contentType=${values.contentType}&saleMode=${values.saleMode}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then((body: { tiers: PriceTier[] }) => {
        setTiers(body.tiers);
        if (body.tiers.length && !body.tiers.some((tier) => tier.price === Number(values.price ?? 0))) {
          setValue("price", body.tiers[0].price);
        }
      })
      .catch(() => setTiers([]));
    return () => controller.abort();
  }, [setValue, values.contentType, values.price, values.saleMode]);

  const priceOptions = useMemo(() => tiers.filter((tier) => priced || tier.price === 0), [priced, tiers]);

  async function uploadMedia(files: FileList | null) {
    if (!files?.length) return;
    setUploadStatus("正在安全上传媒体...");
    try {
      const ids: string[] = [];
      const visibility = visibilityForSaleMode(values.saleMode);
      for (const file of Array.from(files).slice(0, 20)) {
        const kind = file.type.startsWith("video/") ? "video" : "image";
        const presign = await fetch("/api/uploads/presign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind, visibility }) });
        if (!presign.ok) throw new Error("无法建立上传任务。");
        const prepared = await presign.json();
        if (!String(prepared.uploadUrl).startsWith("mock://")) {
          const stored = await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.headers, body: file });
          if (!stored.ok) throw new Error("媒体上传失败。");
        }
        const completed = await fetch("/api/uploads/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: prepared.assetId }) });
        if (!completed.ok) throw new Error("无法完成上传任务。");
        ids.push(prepared.assetId);
      }
      for (let attempt = 0; attempt < 35; attempt += 1) {
        const response = await fetch(`/api/uploads/complete?ids=${ids.join(",")}`);
        const body = await response.json();
        if (body.assets.some((asset: { status: string }) => asset.status === "failed")) throw new Error("媒体处理失败，请重新上传。");
        if (body.assets.length === ids.length && body.assets.every((asset: { status: string }) => asset.status === "ready")) break;
        if (attempt === 34) throw new Error("媒体仍在处理中，请稍后重试。");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setMediaAssetIds(ids);
      setUploadStatus(`${ids.length} 个媒体文件已完成处理。`);
    } catch (error) {
      setMediaAssetIds([]);
      setUploadStatus(error instanceof Error ? error.message : "媒体上传失败。");
    }
  }

  return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <PageHeader title="发布新作品" subtitle="上传私有媒体、等待安全处理，然后按订阅或单品规则发布。"/>
    <DashboardNav/>
    <form onSubmit={handleSubmit(async (data) => {
      setApiError(null);
      const visibility = visibilityForSaleMode(data.saleMode);
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, visibility, price: priced ? data.price : undefined, mediaAssetIds })
      });

      if (!response.ok) {
        createPost({ title: data.title, excerpt: data.excerpt, content: data.content, category: data.category, visibility });
        setApiError("API 暂时不可用，已保留为本地 Demo 作品。");
      }
      router.push("/dashboard/posts");
    })} className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="glass space-y-5 rounded-[30px] p-6 sm:p-8">
        <Field label="作品标题" error={errors.title?.message}><input {...register("title")} placeholder="给作品一个让人记住的名字" className="w-full bg-transparent text-2xl font-black outline-none"/></Field>
        <Field label="简短介绍" error={errors.excerpt?.message}><textarea {...register("excerpt")} rows={3} placeholder="这件作品想分享什么？" className="w-full resize-none rounded-2xl bg-black/[.035] p-4 outline-none dark:bg-white/[.04]"/></Field>
        <Field label="正文内容" error={errors.content?.message}><textarea {...register("content")} rows={10} placeholder="写下创作过程、灵感和想对支持者说的话..." className="w-full resize-none rounded-2xl bg-black/[.035] p-4 leading-7 outline-none dark:bg-white/[.04]"/></Field>
        <Field label="私有媒体"><input type="file" multiple accept="image/*,video/*" onChange={(event) => void uploadMedia(event.target.files)} className="w-full rounded-md border border-[var(--line)] p-3 text-sm"/>{uploadStatus && <span className="mt-2 block text-xs muted">{uploadStatus}</span>}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="分类"><select {...register("category")} className="w-full rounded-2xl border border-[var(--line)] bg-transparent p-3">{CONTENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></Field>
          <Field label="作品类型"><select {...register("contentType")} className="w-full rounded-2xl border border-[var(--line)] bg-transparent p-3"><option value="photo_short">照片 / 短视频</option><option value="long_video">长视频</option></select></Field>
          <Field label="售卖方式"><select {...register("saleMode")} className="w-full rounded-2xl border border-[var(--line)] bg-transparent p-3"><option value="subscription_only">粉丝订阅</option><option value="single_plus_subscription">单个作品 + 粉丝订阅</option>{values.contentType === "long_video" && <option value="long_video_single">长视频作品</option>}</select></Field>
          <Field label="价格档位" error={errors.price?.message}>
            <select {...register("price", { valueAsNumber: true })} disabled={!priced} className="w-full rounded-2xl border border-[var(--line)] bg-transparent p-3 disabled:opacity-50">
              {!priced && <option value={0}>订阅解锁</option>}
              {priceOptions.map((tier) => <option key={tier.id} value={tier.price}>¥{tier.price}</option>)}
            </select>
          </Field>
        </div>
        {apiError && <p className="rounded-2xl bg-coral/10 p-3 text-sm font-bold text-coral">{apiError}</p>}
      </div>
      <aside className="space-y-5">
        <div className="glass rounded-[30px] p-5"><p className="mb-3 text-sm font-black">封面预览</p><button type="button" onClick={() => setPreview(true)} className="cover-1 mesh relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl text-white"><ImagePlus/><span className="absolute bottom-3 text-xs font-bold">使用 Demo 品牌封面</span></button></div>
        <div className="glass rounded-[30px] p-5"><div className="flex items-center gap-2"><Sparkles size={17} className="text-coral"/><p className="font-black">发布检查</p></div><ul className="mt-4 space-y-2 text-sm muted"><li>✓ 标题清晰易懂</li><li>✓ 售卖方式符合内容类型</li><li>✓ 价格来自站务档位</li></ul></div>
        <button disabled={isSubmitting} className="brand-gradient w-full rounded-full py-4 font-black text-white disabled:opacity-50">发布作品</button>
      </aside>
    </form>
    {preview && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setPreview(false)}><div className="cover-1 mesh aspect-[16/10] w-full max-w-3xl rounded-[30px] p-8 text-white"><p className="text-sm font-bold">封面预览</p><h2 className="mt-24 max-w-xl text-4xl font-black">{values.title || "你的作品标题"}</h2><p className="mt-3 max-w-lg text-white/75">{values.excerpt || "作品介绍将显示在这里。"}</p></div></div>}
  </div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold muted">{label}</span>{children}{error && <span className="mt-1 block text-xs text-coral">{error}</span>}</label>;
}

