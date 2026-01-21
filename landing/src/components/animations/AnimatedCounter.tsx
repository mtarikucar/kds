'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useInView, useSpring, useTransform } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

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
  const isInView = useInView(ref, { once, margin: '-100px' });
  const prefersReducedMotion = useReducedMotion();
  const [hasAnimated, setHasAnimated] = useState(false);

  const spring = useSpring(0, {
    duration: duration * 1000,
    bounce: 0,
  });

  const display = useTransform(spring, (current) => {
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
  });

  useEffect(() => {
    if (isInView && !hasAnimated) {
      const timeout = setTimeout(() => {
        spring.set(value);
        setHasAnimated(true);
      }, delay * 1000);

      return () => clearTimeout(timeout);
    }
  }, [isInView, hasAnimated, value, spring, delay]);

  // Skip animation if user prefers reduced motion
  if (prefersReducedMotion) {
    const formattedValue = (() => {
      switch (format) {
        case 'currency':
          return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
          }).format(value);
        case 'percentage':
          return `${value}%`;
        default:
          return new Intl.NumberFormat(locale).format(value);
      }
    })();

    return (
      <span ref={ref} className={className}>
        {prefix}{formattedValue}{suffix}
      </span>
    );
  }

  return (
    <span ref={ref} className={className}>
      {prefix}
      <motion.span>{display}</motion.span>
      {suffix}
    </span>
  );
}
