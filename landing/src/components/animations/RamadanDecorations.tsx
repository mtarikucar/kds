'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/* Crescent Moon SVG */
export function CrescentMoon({ className = '', size = 60 }: { className?: string; size?: number }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      animate={prefersReducedMotion ? {} : { y: [0, -12, 0], rotate: [0, 5, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <defs>
          <linearGradient id="moonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD700" />
            <stop offset="100%" stopColor="#D4A017" />
          </linearGradient>
        </defs>
        <path
          d="M50 5C30 5 15 22 15 45C15 68 30 85 50 85C35 75 30 60 30 45C30 30 35 15 50 5Z"
          fill="url(#moonGradient)"
          opacity="0.9"
        />
        {/* Small star next to crescent */}
        <polygon
          points="70,25 72,31 78,31 73,35 75,41 70,37 65,41 67,35 62,31 68,31"
          fill="#FFD700"
          opacity="0.8"
        />
      </svg>
    </motion.div>
  );
}

/* Lantern (Fanous) SVG */
export function Lantern({ className = '', size = 80 }: { className?: string; size?: number }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className={`${className} origin-top`}
      animate={prefersReducedMotion ? {} : { rotate: [-5, 5, -5] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg width={size} height={size * 1.4} viewBox="0 0 60 84" fill="none">
        <defs>
          <linearGradient id="lanternBody" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4A017" />
            <stop offset="100%" stopColor="#B8860B" />
          </linearGradient>
          <radialGradient id="lanternGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD700" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Hanging chain */}
        <line x1="30" y1="0" x2="30" y2="14" stroke="#D4A017" strokeWidth="2" />
        {/* Top cap */}
        <path d="M22 14 L38 14 L36 18 L24 18 Z" fill="url(#lanternBody)" />
        {/* Main body */}
        <path
          d="M20 18 Q15 40 20 62 L40 62 Q45 40 40 18 Z"
          fill="url(#lanternBody)"
          opacity="0.85"
        />
        {/* Inner glow */}
        <ellipse cx="30" cy="40" rx="12" ry="20" fill="url(#lanternGlow)" />
        {/* Glass panels */}
        <line x1="30" y1="18" x2="30" y2="62" stroke="#FFD700" strokeWidth="0.5" opacity="0.4" />
        <line x1="20" y1="40" x2="40" y2="40" stroke="#FFD700" strokeWidth="0.5" opacity="0.4" />
        {/* Bottom */}
        <path d="M20 62 L24 68 L36 68 L40 62 Z" fill="url(#lanternBody)" />
        {/* Bottom tip */}
        <path d="M28 68 L30 76 L32 68 Z" fill="#D4A017" />
      </svg>
    </motion.div>
  );
}

/* Decorative Star */
export function Star({ className = '', size = 20, delay = 0 }: { className?: string; size?: number; delay?: number }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      animate={prefersReducedMotion ? {} : {
        opacity: [1, 0.3, 1],
        scale: [1, 0.8, 1],
      }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <polygon
          points="12,2 14.5,9 22,9.5 16.5,14 18,22 12,17.5 6,22 7.5,14 2,9.5 9.5,9"
          fill="#FFD700"
          opacity="0.8"
        />
      </svg>
    </motion.div>
  );
}

/* Composite decoration set for sections */
export function RamadanDecorSet({ variant = 'hero' }: { variant?: 'hero' | 'pricing' | 'cta' }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {variant === 'hero' && (
        <>
          <CrescentMoon className="absolute top-20 right-[10%] opacity-60" size={70} />
          <Lantern className="absolute top-0 left-[15%] opacity-40" size={50} />
          <Lantern className="absolute top-0 right-[25%] opacity-30" size={40} />
          <Star className="absolute top-32 left-[30%] opacity-50" size={16} delay={0} />
          <Star className="absolute top-48 right-[20%] opacity-40" size={12} delay={0.5} />
          <Star className="absolute bottom-40 left-[20%] opacity-30" size={14} delay={1} />
          <Star className="absolute top-60 left-[50%] opacity-35" size={10} delay={1.5} />
          <Star className="absolute bottom-60 right-[15%] opacity-25" size={18} delay={0.7} />
        </>
      )}
      {variant === 'pricing' && (
        <>
          <CrescentMoon className="absolute -top-4 left-[5%] opacity-30" size={50} />
          <Lantern className="absolute top-0 right-[8%] opacity-25" size={45} />
          <Star className="absolute top-20 right-[30%] opacity-30" size={14} delay={0.3} />
          <Star className="absolute bottom-20 left-[10%] opacity-25" size={12} delay={0.8} />
          <Star className="absolute top-40 left-[40%] opacity-20" size={10} delay={1.2} />
        </>
      )}
      {variant === 'cta' && (
        <>
          <CrescentMoon className="absolute top-10 right-[8%] opacity-40" size={55} />
          <Lantern className="absolute top-0 left-[10%] opacity-30" size={45} />
          <Star className="absolute top-16 left-[35%] opacity-40" size={14} delay={0} />
          <Star className="absolute bottom-20 right-[25%] opacity-30" size={12} delay={0.6} />
          <Star className="absolute top-40 right-[45%] opacity-25" size={10} delay={1.1} />
        </>
      )}
    </div>
  );
}
