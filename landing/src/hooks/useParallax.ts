'use client';

import { useScroll, useTransform, useSpring, MotionValue } from 'framer-motion';
import { RefObject } from 'react';

interface UseParallaxOptions {
  target?: RefObject<HTMLElement | null>;
  speed?: number; // multiplier: positive = slower (background), negative = faster (foreground)
  direction?: 'vertical' | 'horizontal' | 'both';
  range?: [number, number]; // output range in pixels
  offset?: [string, string];
}

interface UseParallaxReturn {
  y: MotionValue<number>;
  x: MotionValue<number>;
}

export function useParallax(options: UseParallaxOptions = {}): UseParallaxReturn {
  const {
    target,
    speed = 0.5,
    direction = 'vertical',
    range,
    offset = ['start end', 'end start'],
  } = options;

  const { scrollYProgress } = useScroll({
    target: target as RefObject<HTMLElement> | undefined,
    offset: offset as any,
  });

  // Calculate range based on speed if not provided
  const outputRange = range || [100 * speed, -100 * speed];

  const rawY = useTransform(scrollYProgress, [0, 1], outputRange);
  const rawX = useTransform(scrollYProgress, [0, 1], outputRange);

  // Apply spring for smooth parallax
  const springConfig = {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  };

  const y = useSpring(rawY, springConfig);
  const x = useSpring(rawX, springConfig);

  // Return based on direction
  const zeroValue = useTransform(scrollYProgress, [0, 1], [0, 0]);

  return {
    y: direction === 'horizontal' ? zeroValue : y,
    x: direction === 'vertical' ? zeroValue : x,
  };
}
