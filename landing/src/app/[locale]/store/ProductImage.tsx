'use client';

import { useEffect, useState } from 'react';

/**
 * Renders a product image, but gracefully hides itself when the file
 * doesn't exist (404). Until every SKU has a real photo in
 * `landing/public/products/`, the card still has a `<img>` slot
 * referencing a missing file — without this fallback, the browser
 * shows the broken-image icon.
 *
 * Client-side because the server component (`store/page.tsx`) can't
 * attach an `onError` handler.
 *
 * Resets `broken` when `src` changes — defensive: today cards key on
 * `id` and remount on swap, but the explicit reset means we can hoist
 * this into a stable parent layout later without subtle state leaks.
 */
export default function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (broken) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="aspect-[4/3] w-full object-cover"
    />
  );
}
