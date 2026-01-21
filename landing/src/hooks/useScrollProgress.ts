'use client';

import { useScroll, useSpring, MotionValue } from 'framer-motion';
import { RefObject } from 'react';

interface UseScrollProgressOptions {
  target?: RefObject<HTMLElement | null>;
  offset?: [string, string];
  smooth?: number;
}

interface UseScrollProgressReturn {
  scrollProgress: MotionValue<number>;
  scrollYProgress: MotionValue<number>;
}

export function useScrollProgress(
  options: UseScrollProgressOptions = {}
): UseScrollProgressReturn {
  const {
    target,
    offset = ['start end', 'end start'],
    smooth = 0.1,
  } = options;

  const { scrollYProgress } = useScroll({
    target: target as RefObject<HTMLElement> | undefined,
    offset: offset as any,
  });

  // Apply spring smoothing for buttery animations
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return {
    scrollProgress: smooth > 0 ? smoothProgress : scrollYProgress,
    scrollYProgress,
  };
}
