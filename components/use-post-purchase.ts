"use client";

import { useState } from "react";
import { useDemoStore } from "@/lib/store";
import type { Post } from "@/lib/types";
import { safeCallbackPath } from "@/lib/safe-callback";

type UsePostPurchaseInput = {
  postId: string;
  price: number;
  authenticated: boolean;
  callbackUrl: string;
  source: string;
  onPurchased?(post: Post): void;
};

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
}

export function usePostPurchase({
  postId,
  price,
  authenticated,
  callbackUrl,
  source,
  onPurchased
}: UsePostPurchaseInput) {
  const unlockDemoPost = useDemoStore((state) => state.unlock);
  const showToast = useDemoStore((state) => state.showToast);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessOverridePostId, setAccessOverridePostId] = useState<string | null>(null);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  const confirmPurchase = async () => {
    if (processing) return;
    if (!authenticated) {
      window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(safeCallbackPath(callbackUrl))}`);
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const orderResponse = await fetch("/api/payments/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "post_unlock", itemId: postId })
      });
      if (!orderResponse.ok) throw new Error(await responseError(orderResponse, "无法建立订单。"));
      const { order } = await orderResponse.json() as { order?: { id?: string } };
      if (!order?.id) throw new Error("订单响应无效。");

      const intentResponse = await fetch("/api/payments/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id, provider: "card" })
      });
      if (!intentResponse.ok) throw new Error(await responseError(intentResponse, "无法建立支付请求。"));
      const { intent } = await intentResponse.json() as { intent?: { id?: string } };
      if (!intent?.id) throw new Error("支付响应无效。");

      const confirmResponse = await fetch(`/api/payments/intents/${intent.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source })
      });
      if (!confirmResponse.ok) throw new Error(await responseError(confirmResponse, "支付确认失败。"));

      const postResponse = await fetch(`/api/posts/${postId}`, { cache: "no-store" });
      if (!postResponse.ok) throw new Error(await responseError(postResponse, "无法刷新作品权限。"));
      const { post } = await postResponse.json() as { post?: Post };
      if (!post || post.id !== postId || post.hasAccess !== true) {
        throw new Error("支付已确认，但作品权限尚未生效，请稍后重试。");
      }

      setAccessOverridePostId(postId);
      onPurchased?.(post);
      return true;
    } catch (purchaseError) {
      if (demoMode) {
        unlockDemoPost(postId, price);
        setAccessOverridePostId(postId);
        showToast("Server payment unavailable, using local demo unlock.");
        return true;
      }
      setError(purchaseError instanceof Error ? purchaseError.message : "支付暂时不可用，请稍后重试。");
      return false;
    } finally {
      setProcessing(false);
    }
  };

  return {
    accessOverride: accessOverridePostId === postId ? true : null,
    processing,
    error,
    confirmPurchase
  };
}
