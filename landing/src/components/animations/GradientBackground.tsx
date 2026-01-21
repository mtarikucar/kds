'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface GradientBackgroundProps {
  colors: string[];
  className?: string;
  direction?: 'to-b' | 'to-r' | 'to-br' | 'to-bl';
}

export function GradientBackground({
  colors,
  className = '',
  direction = 'to-b',
}: GradientBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // Interpolate between colors based on scroll
  const backgroundPosition = useTransform(
    scrollYProgress,
    [0, 1],
    ['0% 0%', '100% 100%']
  );

  const gradientDirections: Record<string, string> = {
    'to-b': '180deg',
    'to-r': '90deg',
    'to-br': '135deg',
    'to-bl': '225deg',
  };

  const gradient = `linear-gradient(${gradientDirections[direction]}, ${colors.join(', ')})`;

  if (prefersReducedMotion) {
    return (
      <div
        ref={ref}
        className={`absolute inset-0 ${className}`}
        style={{ background: gradient }}
      />
    );
  }

  return (
    <motion.div
      ref={ref}
      className={`absolute inset-0 ${className}`}
      style={{
        background: gradient,
        backgroundSize: '200% 200%',
        backgroundPosition,
      }}
    />
  );
}

// Animated mesh gradient
interface MeshGradientProps {
  className?: string;
}

export function MeshGradient({ className = '' }: MeshGradientProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <div
        className={`absolute inset-0 ${className}`}
        style={{
          background: `
            radial-gradient(at 40% 20%, var(--brand-light) 0px, transparent 50%),
            radial-gradient(at 80% 0%, var(--gradient-accent) 0px, transparent 50%),
            radial-gradient(at 0% 50%, var(--brand) 0px, transparent 50%),
            radial-gradient(at 80% 50%, var(--brand-dark) 0px, transparent 50%),
            radial-gradient(at 0% 100%, var(--brand-light) 0px, transparent 50%)
          `,
          opacity: 0.3,
        }}
      />
    );
  }

  return (
    <motion.div
      className={`absolute inset-0 ${className}`}
      animate={{
        backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        ease: 'linear',
      }}
      style={{
        background: `
          radial-gradient(at 40% 20%, var(--brand-light) 0px, transparent 50%),
          radial-gradient(at 80% 0%, var(--gradient-accent) 0px, transparent 50%),
          radial-gradient(at 0% 50%, var(--brand) 0px, transparent 50%),
          radial-gradient(at 80% 50%, var(--brand-dark) 0px, transparent 50%),
          radial-gradient(at 0% 100%, var(--brand-light) 0px, transparent 50%)
        `,
        backgroundSize: '200% 200%',
        opacity: 0.3,
      }}
    />
  );
}
