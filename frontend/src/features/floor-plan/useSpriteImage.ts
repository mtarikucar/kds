import { useEffect, useState } from 'react';

// Module-level cache: dozens of Konva nodes share the same handful of sprite
// PNGs, so each URL is fetched exactly once per session. A failed load stays
// cached as its rejected promise (nodes keep the vector fallback) instead of
// re-requesting a missing asset per node.
const spriteCache = new Map<string, HTMLImageElement | Promise<HTMLImageElement>>();

function loadSprite(url: string): HTMLImageElement | Promise<HTMLImageElement> {
  const cached = spriteCache.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    image.onload = () => {
      spriteCache.set(url, image);
      resolve(image);
    };
    image.onerror = () => reject(new Error(`sprite failed to load: ${url}`));
  });
  pending.catch(() => {}); // consumers observe failure as a null return
  spriteCache.set(url, pending);
  return pending;
}

/** Shared sprite loader; returns null while loading, on error, or for a null url. */
export default function useSpriteImage(url: string | null): HTMLImageElement | null {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!url) return;
    const cached = loadSprite(url);
    if (cached instanceof HTMLImageElement) {
      // Resolved between render (which saw the pending promise) and this
      // effect — re-render once so the image is picked up.
      bump((n) => n + 1);
      return;
    }
    let cancelled = false;
    cached.then(
      () => {
        if (!cancelled) bump((n) => n + 1);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;
  const cached = spriteCache.get(url);
  return cached instanceof HTMLImageElement ? cached : null;
}
