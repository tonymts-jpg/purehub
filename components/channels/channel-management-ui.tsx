"use client";

import { LoaderCircle } from "lucide-react";

export function ChannelStatus({ value }: { value: string }) {
  return <span className="inline-flex rounded-full bg-black/5 px-2 py-1 text-xs font-bold dark:bg-white/10">{value}</span>;
}

export function ChannelIconButton({
  label,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--line)] px-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function ChannelLoading({ children }: { children: React.ReactNode }) {
  return <p role="status" className="flex items-center gap-2 py-5 text-sm muted"><LoaderCircle className="animate-spin" size={18}/>{children}</p>;
}
