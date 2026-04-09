'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface ScrollFadeOptions {
  /** How quickly the element fades (0 to 1, where 0.5 means fully faded at 50% scroll) */
  fadeEnd?: number;
  /** Whether to also scale the element down */
  scale?: boolean;
  /** Whether to translate the element down as it fades */
  translateY?: boolean;
}

export function useScrollFade<T extends HTMLElement = HTMLElement>(
  options: ScrollFadeOptions = {}
) {
  const { fadeEnd = 0.5, scale = true, translateY = true } = options;
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const sectionHeight = rect.height;
      // How far the top of the section has scrolled past the top of viewport
      const scrolled = -rect.top;
      // Normalize to 0-1 based on fadeEnd
      const progress = Math.max(0, Math.min(1, scrolled / (sectionHeight * fadeEnd)));

      const opacity = 1 - progress;
      const transforms: string[] = [];

      if (scale) {
        const s = 1 - progress * 0.05;
        transforms.push(`scale(${s})`);
      }
      if (translateY) {
        const y = progress * 100;
        transforms.push(`translateY(${y}px)`);
      }

      setStyle({
        opacity,
        transform: transforms.length > 0 ? transforms.join(' ') : undefined,
        willChange: 'opacity, transform',
      });
    };

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    update(); // Initial calculation

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [fadeEnd, scale, translateY]);

  return { ref, style };
}
