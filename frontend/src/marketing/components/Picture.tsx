// Low-level responsive <img> for a marketing image key. Emits srcSet (sm/lg),
// intrinsic width/height (avoids layout shift), and lazy/async decoding.

import type { ImgKey } from "../data/images";
import { IMG } from "../data/images";

interface PictureProps {
  img: ImgKey;
  className?: string;
  sizes?: string;
  priority?: boolean; // above-the-fold hero: load eagerly
}

export default function Picture({
  img,
  className,
  sizes = "(max-width: 768px) 90vw, 480px",
  priority,
}: PictureProps) {
  const i = IMG[img];
  return (
    <img
      src={i.src}
      srcSet={`${i.srcSm} 520w, ${i.src} 1000w`}
      sizes={sizes}
      alt={i.alt}
      width={i.w}
      height={i.h}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}
