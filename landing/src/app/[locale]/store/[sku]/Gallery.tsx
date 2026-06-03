'use client';

import { useEffect, useState } from 'react';

/**
 * v2.8.87 — minimal product gallery for the landing detail page.
 *
 * Thumbnail strip + a single large viewer. Clicking the main image
 * opens a click-to-close fullscreen overlay (no lightbox library —
 * v2.9.x will swap in Embla or Swiper if multi-image carts merit it).
 *
 * Reuses the broken-image fallback shape from ProductImage.tsx — a
 * missing file path collapses the slot quietly instead of showing the
 * browser's broken-image icon.
 */

interface Props {
  images: string[];
  alt: string;
}

export default function Gallery({ images, alt }: Props) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [brokenSet, setBrokenSet] = useState<Set<number>>(new Set());

  // Reset zoom state if the parent swaps the images list.
  useEffect(() => {
    setActive(0);
    setZoomed(false);
    setBrokenSet(new Set());
  }, [images.join('|')]);

  // Keyboard close.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  const usable = images.filter((_, i) => !brokenSet.has(i));
  if (usable.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
        Görsel yok
      </div>
    );
  }

  // Clamp active to the usable set.
  const realActive = Math.min(active, usable.length - 1);

  function markBroken(i: number) {
    setBrokenSet((s) => {
      const n = new Set(s);
      n.add(i);
      return n;
    });
  }

  return (
    <>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-white"
          aria-label="Resmi büyüt"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={usable[realActive]}
            alt={alt}
            className="aspect-[4/3] w-full object-cover"
            onError={() => markBroken(images.indexOf(usable[realActive]))}
          />
        </button>

        {usable.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {usable.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => setActive(i)}
                className={`shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                  i === realActive ? 'border-slate-900' : 'border-transparent hover:border-slate-300'
                }`}
                aria-label={`Görseli görüntüle ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className="h-16 w-20 object-cover"
                  onError={() => markBroken(images.indexOf(src))}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={usable[realActive]}
            alt={alt}
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
