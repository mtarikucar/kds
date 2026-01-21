'use client';

import { useRef, ReactNode, useState, useEffect } from 'react';
import { motion, useScroll, useTransform, useMotionValueEvent } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface Panel {
  content: ReactNode;
  range: [number, number]; // [start, end] as 0-1 values
}

interface StickyScrollSectionProps {
  panels: Panel[];
  scrollLength?: string; // e.g., "300vh", "500vh"
  className?: string;
  stickyContent?: ReactNode;
  progressIndicator?: boolean;
}

export function StickyScrollSection({
  panels,
  scrollLength = '300vh',
  className = '',
  stickyContent,
  progressIndicator = true,
}: StickyScrollSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  // Track active panel based on scroll progress
  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    for (let i = panels.length - 1; i >= 0; i--) {
      if (latest >= panels[i].range[0]) {
        setActiveIndex(i);
        break;
      }
    }
  });

  if (prefersReducedMotion) {
    return (
      <div className={className}>
        {panels.map((panel, index) => (
          <div key={index} className="py-20">
            {panel.content}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ height: scrollLength }}
    >
      {/* Sticky container */}
      <div className="sticky top-0 h-screen overflow-hidden">
        <div className="relative h-full flex items-center">
          {/* Progress indicator */}
          {progressIndicator && (
            <div className="absolute left-8 top-1/2 -translate-y-1/2 z-20 hidden lg:flex flex-col gap-3">
              {panels.map((_, index) => (
                <motion.div
                  key={index}
                  initial={false}
                  animate={{
                    scale: activeIndex === index ? 1.5 : 1,
                    backgroundColor:
                      activeIndex === index
                        ? 'var(--brand)'
                        : 'rgba(255,255,255,0.2)',
                  }}
                  className="w-2 h-2 rounded-full transition-colors cursor-pointer"
                  onClick={() => {
                    if (containerRef.current) {
                      const scrollHeight = containerRef.current.offsetHeight;
                      const targetScroll = panels[index].range[0] * scrollHeight;
                      window.scrollTo({
                        top: containerRef.current.offsetTop + targetScroll,
                        behavior: 'smooth',
                      });
                    }
                  }}
                />
              ))}
            </div>
          )}

          {/* Static sticky content (if provided) */}
          {stickyContent && (
            <div className="absolute inset-0 z-0">{stickyContent}</div>
          )}

          {/* Panels with crossfade */}
          <div className="relative w-full h-full">
            {panels.map((panel, index) => (
              <PanelWrapper
                key={index}
                index={index}
                activeIndex={activeIndex}
                scrollYProgress={scrollYProgress}
                range={panel.range}
              >
                {panel.content}
              </PanelWrapper>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PanelWrapperProps {
  children: ReactNode;
  index: number;
  activeIndex: number;
  scrollYProgress: any;
  range: [number, number];
}

function PanelWrapper({
  children,
  index,
  activeIndex,
  scrollYProgress,
  range,
}: PanelWrapperProps) {
  const [start, end] = range;
  const fadeInStart = start;
  const fadeInEnd = start + (end - start) * 0.2;
  const fadeOutStart = end - (end - start) * 0.2;
  const fadeOutEnd = end;

  const opacity = useTransform(
    scrollYProgress,
    [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd],
    [0, 1, 1, 0]
  );

  const y = useTransform(
    scrollYProgress,
    [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd],
    [50, 0, 0, -50]
  );

  const scale = useTransform(
    scrollYProgress,
    [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd],
    [0.95, 1, 1, 0.95]
  );

  return (
    <motion.div
      style={{ opacity, y, scale }}
      className="absolute inset-0 flex items-center justify-center"
    >
      {children}
    </motion.div>
  );
}

// Alternative: Simple sticky section with scroll-triggered content
interface SimpleStickyProps {
  children: ReactNode;
  className?: string;
  height?: string;
}

export function SimpleSticky({
  children,
  className = '',
  height = '200vh',
}: SimpleStickyProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  return (
    <div ref={containerRef} className={`relative ${className}`} style={{ height }}>
      <div className="sticky top-0 h-screen overflow-hidden flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
