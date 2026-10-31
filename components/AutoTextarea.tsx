"use client";

import { useCallback, useEffect, useRef, type TextareaHTMLAttributes } from "react";

/** Textarea that grows with its content, so nothing is ever cut off or needs inner scrolling. */
export function AutoTextarea({ value, onChange, className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, []);
  useEffect(() => {
    fit();
    // Re-fit once fonts/layout settle and on width changes (rotation, window resize).
    const t = window.setTimeout(fit, 120);
    window.addEventListener("resize", fit);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", fit); };
  }, [value, fit]);
  return <textarea ref={ref} className={`textarea ${className}`} value={value} onChange={onChange} {...rest} />;
}
