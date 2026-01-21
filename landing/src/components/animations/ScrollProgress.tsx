'use client';

import { motion, useScroll, useSpring } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface ScrollProgressProps {
  className?: string;
  color?: string;
  height?: number;
  position?: 'top' | 'bottom';
}

export function ScrollProgress({
  className = '',
  color = 'var(--brand)',
  height = 3,
  position = 'top',
}: ScrollProgressProps) {
  const { scrollYProgress } = useScroll();
  const prefersReducedMotion = useReducedMotion();

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  if (prefersReducedMotion) {
    return null;
  }

  return (
    <motion.div
      style={{
        scaleX,
        transformOrigin: 'left',
        backgroundColor: color,
        height,
      }}
      className={`fixed left-0 right-0 z-50 ${position === 'top' ? 'top-0' : 'bottom-0'} ${className}`}
    />
  );
}

// Section progress indicator (dots)
interface SectionProgressProps {
  total: number;
  current: number;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

export function SectionProgress({
  total,
  current,
  className = '',
  orientation = 'vertical',
}: SectionProgressProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className={`flex ${orientation === 'vertical' ? 'flex-col' : 'flex-row'} gap-2 ${className}`}
    >
      {Array.from({ length: total }).map((_, index) => (
        <motion.div
          key={index}
          initial={false}
          animate={{
            scale: current === index ? 1.2 : 1,
            backgroundColor: current === index ? 'var(--brand)' : 'rgba(255,255,255,0.3)',
          }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3 }}
          className="w-2 h-2 rounded-full"
        />
      ))}
    </div>
  );
}
