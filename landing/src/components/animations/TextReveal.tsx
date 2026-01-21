'use client';

import { useRef, ReactNode } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface TextRevealProps {
  children: string;
  className?: string;
  type?: 'word' | 'character' | 'line';
  stagger?: number;
  duration?: number;
  delay?: number;
  once?: boolean;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span';
}

export function TextReveal({
  children,
  className = '',
  type = 'word',
  stagger = 0.05,
  duration = 0.5,
  delay = 0,
  once = true,
  as = 'span',
}: TextRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once, margin: '-100px' });
  const prefersReducedMotion = useReducedMotion();

  const Component = as;

  // Split text based on type
  const splitText = () => {
    if (type === 'word') {
      return children.split(' ').map((word, i) => (
        <span key={i} className="inline-block">
          {word}
          {i < children.split(' ').length - 1 && '\u00A0'}
        </span>
      ));
    }
    if (type === 'character') {
      return children.split('').map((char, i) => (
        <span key={i} className="inline-block">
          {char === ' ' ? '\u00A0' : char}
        </span>
      ));
    }
    // Line type - just return as is, animation on container
    return children;
  };

  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: stagger,
        delayChildren: delay,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: {
      opacity: 0,
      y: 20,
      rotateX: -90,
    },
    visible: {
      opacity: 1,
      y: 0,
      rotateX: 0,
      transition: {
        duration,
        ease: [0.25, 0.4, 0.25, 1],
      },
    },
  };

  // Skip animation if user prefers reduced motion
  if (prefersReducedMotion) {
    return <Component className={className}>{children}</Component>;
  }

  if (type === 'line') {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 30 }}
        animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration, delay, ease: [0.25, 0.4, 0.25, 1] }}
      >
        <Component className={className}>{children}</Component>
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={ref}
      variants={containerVariants}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      className="overflow-hidden"
      style={{ perspective: 1000 }}
    >
      <Component className={className}>
        {(type === 'word' || type === 'character') &&
          (type === 'word'
            ? children.split(' ').map((word, i) => (
                <motion.span
                  key={i}
                  variants={itemVariants}
                  className="inline-block origin-bottom"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  {word}
                  {i < children.split(' ').length - 1 && '\u00A0'}
                </motion.span>
              ))
            : children.split('').map((char, i) => (
                <motion.span
                  key={i}
                  variants={itemVariants}
                  className="inline-block origin-bottom"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  {char === ' ' ? '\u00A0' : char}
                </motion.span>
              )))}
      </Component>
    </motion.div>
  );
}

// Gradient text that shifts based on scroll
interface GradientTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
}

export function GradientText({
  children,
  className = '',
  colors = ['var(--brand)', 'var(--brand-dark)', 'var(--brand-light)'],
}: GradientTextProps) {
  return (
    <span
      className={`bg-clip-text text-transparent bg-gradient-to-r animate-gradient-shift ${className}`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${colors.join(', ')})`,
        backgroundSize: '200% 100%',
      }}
    >
      {children}
    </span>
  );
}
