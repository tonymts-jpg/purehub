"use client";

import Image from "next/image";
import { Expand, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { MediaAsset } from "@/lib/types";
import { MediaViewer } from "./media-viewer";

type MediaGalleryProps = {
  media: MediaAsset[];
  unlocked: boolean;
  compact?: boolean;
  onLockedClick: () => void;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
};

export function MediaGallery({
  media,
  unlocked,
  compact = false,
  onLockedClick,
  activeIndex: controlledActiveIndex,
  onActiveIndexChange: onControlledActiveIndexChange
}: MediaGalleryProps) {
  const [expanded, setExpanded] = useState(false);
  const [internalActiveIndex, setInternalActiveIndex] = useState<number | null>(null);
  const activeIndex = controlledActiveIndex === undefined ? internalActiveIndex : controlledActiveIndex;
  const setActiveIndex = onControlledActiveIndexChange ?? setInternalActiveIndex;
  const visible = compact ? media.slice(0, 8) : media.slice(0, expanded ? 12 : 8);
  const accessibleMedia = unlocked ? media : media.slice(0, 2);

  const open = (index: number) => {
    if (!unlocked && index >= 2) {
      onLockedClick();
      return;
    }
    setActiveIndex(index);
  };

  return <>
    <div className={`grid ${compact ? "grid-cols-4 gap-1.5 p-2" : "grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"}`} data-testid={compact ? "post-card-gallery" : "post-detail-gallery"}>
      {visible.map((asset, index) => {
        const locked = !unlocked && index >= 2;
        const label = locked ? `解锁图片 ${index + 1}` : `查看图片 ${index + 1}`;
        return <button key={asset.id} type="button" onClick={() => open(index)} aria-label={label} className={`group relative aspect-[4/5] overflow-hidden ${compact ? "rounded-lg" : "rounded-2xl"} bg-black/5`}>
          {asset.kind === "video" ? <video src={asset.src} aria-label={asset.alt} preload="metadata" className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${locked ? "scale-110 blur-xl brightness-75" : ""}`} /> : <Image src={asset.src} alt={asset.alt} fill sizes={compact ? "(max-width: 768px) 22vw, 120px" : "(max-width: 768px) 45vw, 210px"} className={`object-cover transition duration-500 group-hover:scale-105 ${locked ? "scale-110 blur-xl brightness-75" : ""}`} />}
          {locked && <span className="absolute inset-0 grid place-items-center bg-black/15 text-white"><span className="grid h-8 w-8 place-items-center rounded-full bg-black/55 backdrop-blur"><LockKeyhole size={15} /></span></span>}
          {!locked && !compact && <span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><Expand size={14} /></span>}
        </button>;
      })}
    </div>

    {!compact && media.length > 8 && <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-4 w-full rounded-full border border-[var(--line)] py-3 text-sm font-bold">
      {expanded ? "收起图片" : "查看全部 12 张"}
    </button>}

    <MediaViewer media={accessibleMedia} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} />
  </>;
}
