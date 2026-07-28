"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type OverlayPortalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function OverlayPortal({ open, onClose, children }: OverlayPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      invoker?.focus();
    };
  }, [onClose, open]);

  if (!mounted || !open) return null;
  return createPortal(children, document.body);
}
