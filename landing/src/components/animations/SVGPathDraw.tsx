'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useInView, MotionValue, useTransform } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface SVGPathDrawProps {
  d: string;
  className?: string;
  stroke?: string;
  strokeWidth?: number;
  duration?: number;
  delay?: number;
  once?: boolean;
  scrollProgress?: MotionValue<number>;
}

export function SVGPathDraw({
  d,
  className = '',
  stroke = 'var(--brand)',
  strokeWidth = 2,
  duration = 1.5,
  delay = 0,
  once = true,
  scrollProgress,
}: SVGPathDrawProps) {
  const ref = useRef<SVGPathElement>(null);
  const containerRef = useRef<SVGSVGElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const isInView = useInView(containerRef, { once, margin: '-100px' });
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (ref.current) {
      setPathLength(ref.current.getTotalLength());
    }
  }, [d]);

  // If scroll-controlled
  const scrollStrokeDashoffset = scrollProgress
    ? useTransform(scrollProgress, [0, 1], [pathLength, 0])
    : undefined;

  if (prefersReducedMotion) {
    return (
      <svg ref={containerRef} className={className}>
        <path d={d} stroke={stroke} strokeWidth={strokeWidth} fill="none" />
      </svg>
    );
  }

  // Scroll-controlled version
  if (scrollProgress && scrollStrokeDashoffset) {
    return (
      <svg ref={containerRef} className={className}>
        <motion.path
          ref={ref}
          d={d}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={pathLength}
          style={{ strokeDashoffset: scrollStrokeDashoffset }}
        />
      </svg>
    );
  }

  // Viewport-triggered version
  return (
    <svg ref={containerRef} className={className}>
      <motion.path
        ref={ref}
        d={d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
        initial={{ strokeDasharray: pathLength, strokeDashoffset: pathLength }}
        animate={
          isInView
            ? { strokeDashoffset: 0 }
            : { strokeDashoffset: pathLength }
        }
        transition={{
          duration,
          delay,
          ease: 'easeInOut',
        }}
      />
    </svg>
  );
}

// Multiple paths with staggered animation
interface SVGPathGroupProps {
  paths: { d: string; stroke?: string; strokeWidth?: number }[];
  className?: string;
  stagger?: number;
  duration?: number;
  once?: boolean;
}

export function SVGPathGroup({
  paths,
  className = '',
  stagger = 0.2,
  duration = 1.5,
  once = true,
}: SVGPathGroupProps) {
  const ref = useRef<SVGSVGElement>(null);
  const isInView = useInView(ref, { once, margin: '-100px' });
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <svg ref={ref} className={className}>
        {paths.map((path, index) => (
          <path
            key={index}
            d={path.d}
            stroke={path.stroke || 'var(--brand)'}
            strokeWidth={path.strokeWidth || 2}
            fill="none"
          />
        ))}
      </svg>
    );
  }

  return (
    <svg ref={ref} className={className}>
      {paths.map((path, index) => (
        <PathWithLength
          key={index}
          d={path.d}
          stroke={path.stroke || 'var(--brand)'}
          strokeWidth={path.strokeWidth || 2}
          isInView={isInView}
          duration={duration}
          delay={index * stagger}
        />
      ))}
    </svg>
  );
}

function PathWithLength({
  d,
  stroke,
  strokeWidth,
  isInView,
  duration,
  delay,
}: {
  d: string;
  stroke: string;
  strokeWidth: number;
  isInView: boolean;
  duration: number;
  delay: number;
}) {
  const ref = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);

  useEffect(() => {
    if (ref.current) {
      setPathLength(ref.current.getTotalLength());
    }
  }, [d]);

  return (
    <motion.path
      ref={ref}
      d={d}
      stroke={stroke}
      strokeWidth={strokeWidth}
      fill="none"
      initial={{ strokeDasharray: pathLength, strokeDashoffset: pathLength }}
      animate={
        isInView ? { strokeDashoffset: 0 } : { strokeDashoffset: pathLength }
      }
      transition={{
        duration,
        delay,
        ease: 'easeInOut',
      }}
    />
  );
}
