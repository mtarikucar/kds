'use client';

import { useTransform, useSpring, MotionValue } from 'framer-motion';

interface UseSmoothTransformOptions {
  inputRange?: [number, number];
  outputRange: [number, number] | [string, string];
  stiffness?: number;
  damping?: number;
}

export function useSmoothTransform(
  value: MotionValue<number>,
  options: UseSmoothTransformOptions
): MotionValue<number> {
  const {
    inputRange = [0, 1],
    outputRange,
    stiffness = 100,
    damping = 30,
  } = options;

  const transformed = useTransform(value, inputRange, outputRange as [number, number]);

  const smoothed = useSpring(transformed, {
    stiffness,
    damping,
    restDelta: 0.001,
  });

  return smoothed;
}

// Utility for creating multiple transforms at once
export function useMultiTransform(
  value: MotionValue<number>,
  transforms: Record<string, { inputRange?: [number, number]; outputRange: [number, number] }>
): Record<string, MotionValue<number>> {
  const result: Record<string, MotionValue<number>> = {};

  for (const [key, config] of Object.entries(transforms)) {
    const inputRange = config.inputRange || [0, 1];
    result[key] = useTransform(value, inputRange, config.outputRange);
  }

  return result;
}
