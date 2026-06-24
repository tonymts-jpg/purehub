"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, LockKeyhole, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MediaAsset } from "@/lib/types";

export function MediaGallery({
  media,
  unlocked,
  compact=false,
  onLockedClick
}:{
  media:MediaAsset[];
  unlocked:boolean;
  compact?:boolean;
  onLockedClick:()=>void;
}) {
  const [expanded,setExpanded]=useState(false);
  const [active,setActive]=useState<number|null>(null);
  const visible=compact?media.slice(0,8):media.slice(0,expanded?12:8);

  useEffect(()=>{
    if(active===null)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape")setActive(null);
      if(event.key==="ArrowLeft")setActive(current=>current===null?null:(current+media.length-1)%media.length);
      if(event.key==="ArrowRight")setActive(current=>current===null?null:(current+1)%media.length);
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[active,media.length]);

  const open=(index:number)=>{
    if(!unlocked&&index>=2){onLockedClick();return;}
    setActive(index);
  };

  return <>
    <div className={`grid ${compact?"grid-cols-4 gap-1.5 p-2":"grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"}`} data-testid={compact?"post-card-gallery":"post-detail-gallery"}>
      {visible.map((asset,index)=>{
        const locked=!unlocked&&index>=2;
        return <button key={asset.id} type="button" onClick={()=>open(index)} aria-label={locked?`解锁图片 ${index+1}`:`查看图片 ${index+1}`} className={`group relative aspect-[4/5] overflow-hidden ${compact?"rounded-lg":"rounded-2xl"} bg-black/5`}>
          <Image src={asset.src} alt={asset.alt} fill sizes={compact?"(max-width: 768px) 22vw, 120px":"(max-width: 768px) 45vw, 210px"} className={`object-cover transition duration-500 group-hover:scale-105 ${locked?"scale-110 blur-xl brightness-75":""}`}/>
          {locked&&<span className="absolute inset-0 grid place-items-center bg-black/15 text-white"><span className="grid h-8 w-8 place-items-center rounded-full bg-black/55 backdrop-blur"><LockKeyhole size={15}/></span></span>}
          {!locked&&!compact&&<span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><Expand size={14}/></span>}
        </button>;
      })}
    </div>

    {!compact&&media.length>8&&<button type="button" onClick={()=>setExpanded(value=>!value)} className="mt-4 w-full rounded-full border border-[var(--line)] py-3 text-sm font-bold">
      {expanded?"收起图片":"查看全部 12 张"}
    </button>}

    {active!==null&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/92 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="图片预览">
      <button onClick={()=>setActive(null)} aria-label="关闭图片预览" className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur"><X/></button>
      <button onClick={()=>setActive((active+media.length-1)%media.length)} aria-label="上一张" className="absolute left-3 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur sm:left-6"><ChevronLeft/></button>
      <div className="relative h-[82vh] w-[82vw] max-w-5xl">
        <Image src={media[active].src} alt={media[active].alt} fill priority className="object-contain"/>
      </div>
      <button onClick={()=>setActive((active+1)%media.length)} aria-label="下一张" className="absolute right-3 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur sm:right-6"><ChevronRight/></button>
      <span className="absolute bottom-4 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur">{active+1} / {media.length}</span>
    </div>}
  </>;
}
