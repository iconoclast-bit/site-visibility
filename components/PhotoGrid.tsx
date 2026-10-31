"use client";

import { useCallback, useEffect, useState } from "react";

export interface GridPhoto { url: string; alt: string }

/** Thumbnail grid with a full-screen viewer (Esc / Close button / arrows). */
export function PhotoGrid({ photos }: { photos: GridPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const step = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close, step]);

  if (!photos.length) return null;
  return (
    <>
      <div className="pgrid">
        {photos.map((p, i) => (
          <button key={p.url} type="button" className="ph" data-testid="photo-thumb" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${photos.length}: ${p.alt}`}>
            <img src={p.url} alt={p.alt} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="viewer" role="dialog" aria-modal="true" aria-label="Photo viewer" data-testid="photo-viewer">
          <div className="viewer-top">
            <span>{open + 1} / {photos.length} · {photos[open].alt}</span>
            <button type="button" className="close" data-testid="photo-viewer-close" onClick={close}>Close ✕</button>
          </div>
          <div className="viewer-body" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            {photos.length > 1 && <button type="button" className="nav prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>}
            <img src={photos[open].url} alt={photos[open].alt} data-testid="photo-viewer-img" />
            {photos.length > 1 && <button type="button" className="nav next" aria-label="Next photo" onClick={() => step(1)}>›</button>}
          </div>
        </div>
      )}
    </>
  );
}
