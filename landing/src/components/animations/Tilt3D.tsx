'use client';

import { useRef, ReactNode, useState, useEffect } from 'react';
import { motion, useTransform } from 'framer-motion';
import { useMousePosition } from '@/hooks/useMousePosition';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface Tilt3DProps {
  children: ReactNode;
  maxRotation?: number;
  perspective?: number;
  scale?: number;
  className?: string;
  glare?: boolean;
}

export function Tilt3D({
  children,
  maxRotation = 15,
  perspective = 1000,
  scale = 1.02,
  className = '',
  glare = false,
}: Tilt3DProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.matchMedia('(max-width: 768px)').matches);
  }, []);

  const { x, y, isHovering } = useMousePosition(ref, {
    smoothing: 150,
    resetOnLeave: true,
  });

  // Transform mouse position to rotation
  const rotateX = useTransform(y, [-1, 1], [maxRotation, -maxRotation]);
  const rotateY = useTransform(x, [-1, 1], [-maxRotation, maxRotation]);

  // Glare effect position
  const glareX = useTransform(x, [-1, 1], ['0%', '100%']);
  const glareY = useTransform(y, [-1, 1], ['0%', '100%']);

  // Skip 3D effect if user prefers reduced motion or on mobile
  if (prefersReducedMotion || isMobile) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      style={{
        perspective,
        transformStyle: 'preserve-3d',
      }}
      className={className}
    >
      <motion.div
        style={{
          rotateX,
          rotateY,
          scale: isHovering ? scale : 1,
        }}
        transition={{
          scale: { duration: 0.2 },
        }}
        className="relative will-change-transform"
      >
        {children}

        {/* Glare overlay */}
        {glare && (
          <motion.div
            style={{
              background: `radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.3) 0%, transparent 60%)`,
              opacity: isHovering ? 1 : 0,
            }}
            className="pointer-events-none absolute inset-0 rounded-inherit transition-opacity duration-300"
          />
        )}
      </motion.div>
    </motion.div>
  );
}
