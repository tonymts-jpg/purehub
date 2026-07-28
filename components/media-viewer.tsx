"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OverlayPortal } from "./overlay-portal";
import type { MediaAsset } from "@/lib/types";

type MediaViewerProps = {
  media: MediaAsset[];
  activeIndex: number | null;
  onActiveIndexChange(index: number | null): void;
};

export function MediaViewer({ media, activeIndex, onActiveIndexChange }: MediaViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const asset = activeIndex === null ? null : media[activeIndex];
  const currentIndex = activeIndex ?? 0;

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    if (activeIndex === null || media.length < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onActiveIndexChange((activeIndex + media.length - 1) % media.length);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onActiveIndexChange((activeIndex + 1) % media.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, media.length, onActiveIndexChange]);

  const move = (direction: -1 | 1) => {
    if (activeIndex === null || media.length < 2) return;
    onActiveIndexChange((activeIndex + direction + media.length) % media.length);
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toggleFullscreen = async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      if (document.fullscreenElement === viewer) {
        await document.exitFullscreen?.();
      } else {
        await viewer.requestFullscreen?.();
      }
    } catch {
      // A rejected Fullscreen API request must not close the preview.
    }
  };

  return <OverlayPortal open={asset !== null} onClose={() => onActiveIndexChange(null)} initialFocusRef={closeButtonRef}>
    {asset && <div ref={dialogRef} onKeyDown={trapFocus} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/92 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="媒体预览">
      <button ref={closeButtonRef} type="button" onClick={() => onActiveIndexChange(null)} aria-label="关闭媒体预览" className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur"><X /></button>
      <button type="button" onClick={toggleFullscreen} aria-label="全屏预览" className="absolute right-16 top-4 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur"><Expand /></button>
      {media.length > 1 && <button type="button" onClick={() => move(-1)} aria-label="上一张" className="absolute left-3 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur sm:left-6"><ChevronLeft /></button>}
      <div ref={viewerRef} className="relative flex h-[88vh] w-[92vw] max-w-5xl items-center justify-center">
        {asset.kind === "video" ? <video src={asset.src} aria-label={asset.alt} controls autoPlay={false} preload="metadata" className="max-h-[88vh] max-w-[92vw]" /> : <Image src={asset.src} alt={asset.alt} fill priority className="object-contain" sizes="92vw" />}
      </div>
      {media.length > 1 && <button type="button" onClick={() => move(1)} aria-label="下一张" className="absolute right-3 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur sm:right-6"><ChevronRight /></button>}
      <span className="absolute bottom-4 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur">{currentIndex + 1} / {media.length}</span>
      {isFullscreen && <span className="sr-only">全屏预览已开启</span>}
    </div>}
  </OverlayPortal>;
}
