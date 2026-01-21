'use client';

import { ReactNode } from 'react';
import { motion, Variants } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface FloatingElementProps {
  children?: ReactNode;
  className?: string;
  duration?: number;
  delay?: number;
  amplitude?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'diagonal';
  rotation?: number;
}

export function FloatingElement({
  children,
  className = '',
  duration = 6,
  delay = 0,
  amplitude = 20,
  direction = 'up',
  rotation = 0,
}: FloatingElementProps) {
  const prefersReducedMotion = useReducedMotion();

  const getAnimation = () => {
    switch (direction) {
      case 'up':
        return { y: [0, -amplitude, 0] };
      case 'down':
        return { y: [0, amplitude, 0] };
      case 'left':
        return { x: [0, -amplitude, 0] };
      case 'right':
        return { x: [0, amplitude, 0] };
      case 'diagonal':
        return { x: [0, amplitude * 0.5, 0], y: [0, -amplitude, 0] };
      default:
        return { y: [0, -amplitude, 0] };
    }
  };

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      animate={{
        ...getAnimation(),
        rotate: rotation ? [0, rotation, 0] : 0,
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={`will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}

// Gradient orb specifically for backgrounds
interface GradientOrbProps {
  className?: string;
  color?: string;
  size?: number;
  blur?: number;
  duration?: number;
  delay?: number;
}

export function GradientOrb({
  className = '',
  color = 'var(--brand)',
  size = 400,
  blur = 100,
  duration = 8,
  delay = 0,
}: GradientOrbProps) {
  // Static orbs for better performance - no animation
  return (
    <div
      className={`absolute rounded-full pointer-events-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: `blur(${blur}px)`,
        opacity: 0.3,
      }}
    />
  );
}
