'use client';

import { useRef, ReactNode, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useParallax } from '@/hooks/useParallax';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface ParallaxLayerProps {
  children: ReactNode;
  speed?: number;
  direction?: 'vertical' | 'horizontal' | 'both';
  className?: string;
  as?: 'div' | 'section' | 'article' | 'span';
}

export function ParallaxLayer({
  children,
  speed = 0.5,
  direction = 'vertical',
  className = '',
  as = 'div',
}: ParallaxLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.matchMedia('(max-width: 768px)').matches);
  }, []);

  const { y, x } = useParallax({
    target: ref,
    speed,
    direction,
  });

  // Skip parallax if user prefers reduced motion or on mobile
  if (prefersReducedMotion || isMobile) {
    const Component = as as any;
    return <Component className={className}>{children}</Component>;
  }

  return (
    <motion.div
      ref={ref}
      style={{ y, x }}
      className={`will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}
