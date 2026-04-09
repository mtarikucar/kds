'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  delay?: number;
  format?: 'number' | 'currency' | 'percentage';
  locale?: string;
  prefix?: string;
  suffix?: string;
  className?: string;
  once?: boolean;
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function formatValue(
  current: number,
  format: string,
  locale: string
): string {
  const rounded = Math.round(current);
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(rounded);
    case 'percentage':
      return `${rounded}%`;
    default:
      return new Intl.NumberFormat(locale).format(rounded);
  }
}

export function AnimatedCounter({
  value,
  duration = 2,
  delay = 0,
  format = 'number',
  locale = 'en-US',
  prefix = '',
  suffix = '',
  className = '',
  once = true,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [displayValue, setDisplayValue] = useState(0);
  const hasAnimated = useRef(false);
  const rafRef = useRef<number>(0);

  const animate = useCallback(() => {
    const startTime = performance.now();
    const durationMs = duration * 1000;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const easedProgress = easeOutExpo(progress);
      const current = easedProgress * value;

      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [value, duration]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setDisplayValue(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            if (once) observer.unobserve(el);

            if (delay > 0) {
              setTimeout(animate, delay * 1000);
            } else {
              animate();
            }
          }
        });
      },
      { threshold: 0.1, rootMargin: '-50px' }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [animate, delay, once, value]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatValue(displayValue, format, locale)}
      {suffix}
    </span>
  );
}
