'use client';

import { useEffect, useRef } from 'react';

interface ScrollFadeOptions {
  /** How quickly the element fades (0 to 1, where 0.5 means fully faded at 50% scroll) */
  fadeEnd?: number;
  /** Whether to also scale the element down */
  scale?: boolean;
  /** Whether to translate the element down as it fades */
  translateY?: boolean;
}

/**
 * Scroll-linked fade/scale/translate for a hero-style section.
 *
 * PERFORMANCE: the fade is written STRAIGHT to the styled element's DOM
 * (content.style.*) inside a rAF, NOT through React state. The previous version
 * called setState on every scroll frame, which re-rendered the whole Hero
 * subtree (~60×/s while scrolling) — the dominant jank on mobile Safari. opacity
 * + transform are compositor-friendly, so direct writes stay off the layout/
 * paint path. Two refs: `sectionRef` is measured for progress, `contentRef` is
 * the node actually faded (kept separate so the fixed background doesn't fade).
 */
export function useScrollFade<T extends HTMLElement = HTMLDivElement>(
  options: ScrollFadeOptions = {}
) {
  const { fadeEnd = 0.5, scale = true, translateY = true } = options;
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<T>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const section = sectionRef.current;
    const content = contentRef.current;
    if (!section || !content) return;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (prefersReduced) return;

    // Promote the faded node to its own layer once so the per-frame transform
    // is a cheap composite rather than a repaint.
    content.style.willChange = 'opacity, transform';

    const update = () => {
      const rect = section.getBoundingClientRect();
      const sectionHeight = rect.height;
      // How far the top of the section has scrolled past the top of viewport.
      const scrolled = -rect.top;
      const progress = Math.max(
        0,
        Math.min(1, scrolled / (sectionHeight * fadeEnd))
      );

      const transforms: string[] = [];
      if (scale) transforms.push(`scale(${1 - progress * 0.05})`);
      if (translateY) transforms.push(`translateY(${progress * 100}px)`);

      // Direct DOM write — no setState, so the Hero subtree is never
      // re-rendered while scrolling.
      content.style.opacity = String(1 - progress);
      content.style.transform = transforms.join(' ');
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
      content.style.willChange = '';
    };
  }, [fadeEnd, scale, translateY]);

  return { sectionRef, contentRef };
}
