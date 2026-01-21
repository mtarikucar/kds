'use client';

import { useState, useEffect, useCallback, RefObject } from 'react';
import { useSpring, useMotionValue, MotionValue } from 'framer-motion';

interface UseMousePositionOptions {
  smoothing?: number; // spring stiffness (higher = faster response)
  resetOnLeave?: boolean;
}

interface UseMousePositionReturn {
  x: MotionValue<number>; // -1 to 1
  y: MotionValue<number>; // -1 to 1
  isHovering: boolean;
}

export function useMousePosition(
  ref: RefObject<HTMLElement | null>,
  options: UseMousePositionOptions = {}
): UseMousePositionReturn {
  const { smoothing = 150, resetOnLeave = true } = options;
  const [isHovering, setIsHovering] = useState(false);

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const springConfig = {
    stiffness: smoothing,
    damping: 20,
    restDelta: 0.001,
  };

  const x = useSpring(rawX, springConfig);
  const y = useSpring(rawY, springConfig);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Normalize to -1 to 1
      const normalizedX = (event.clientX - centerX) / (rect.width / 2);
      const normalizedY = (event.clientY - centerY) / (rect.height / 2);

      // Clamp values
      rawX.set(Math.max(-1, Math.min(1, normalizedX)));
      rawY.set(Math.max(-1, Math.min(1, normalizedY)));
    },
    [ref, rawX, rawY]
  );

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    if (resetOnLeave) {
      rawX.set(0);
      rawY.set(0);
    }
  }, [resetOnLeave, rawX, rawY]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('mousemove', handleMouseMove);
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      element.removeEventListener('mousemove', handleMouseMove);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [ref, handleMouseMove, handleMouseEnter, handleMouseLeave]);

  return { x, y, isHovering };
}
