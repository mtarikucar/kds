'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';

interface CountdownTimerProps {
  targetDate: string;
  className?: string;
  variant?: 'light' | 'dark';
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateTimeLeft(targetDate: string): TimeLeft | null {
  const difference = new Date(targetDate).getTime() - Date.now();
  if (difference <= 0) return null;

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / (1000 * 60)) % 60),
    seconds: Math.floor((difference / 1000) % 60),
  };
}

function TimeUnit({ value, label, variant }: { value: number; label: string; variant: 'light' | 'dark' }) {
  const isDark = variant === 'dark';

  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center font-bold text-lg sm:text-xl ${
          isDark
            ? 'bg-white/10 text-white border border-white/10'
            : 'bg-ramadan-deep/10 text-ramadan-deep border border-ramadan-gold/20'
        }`}
      >
        <AnimatePresence mode="popLayout">
          <motion.span
            key={value}
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {String(value).padStart(2, '0')}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className={`text-[10px] sm:text-xs mt-1.5 font-medium ${isDark ? 'text-white/60' : 'text-ramadan-deep/60'}`}>
        {label}
      </span>
    </div>
  );
}

export default function CountdownTimer({ targetDate, className = '', variant = 'dark' }: CountdownTimerProps) {
  const t = useTranslations('ramadan');
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTimeLeft(calculateTimeLeft(targetDate));

    const timer = setInterval(() => {
      const tl = calculateTimeLeft(targetDate);
      if (!tl) {
        clearInterval(timer);
      }
      setTimeLeft(tl);
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  if (!mounted || !timeLeft) return null;

  const isDark = variant === 'dark';

  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${className}`}>
      <span className={`text-xs font-medium ${isDark ? 'text-white/70' : 'text-ramadan-deep/70'}`}>
        {t('campaignEnds')}
      </span>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <TimeUnit value={timeLeft.days} label={t('days')} variant={variant} />
        <span className={`text-lg font-bold ${isDark ? 'text-white/40' : 'text-ramadan-deep/40'}`}>:</span>
        <TimeUnit value={timeLeft.hours} label={t('hours')} variant={variant} />
        <span className={`text-lg font-bold ${isDark ? 'text-white/40' : 'text-ramadan-deep/40'}`}>:</span>
        <TimeUnit value={timeLeft.minutes} label={t('minutes')} variant={variant} />
        <span className={`text-lg font-bold ${isDark ? 'text-white/40' : 'text-ramadan-deep/40'}`}>:</span>
        <TimeUnit value={timeLeft.seconds} label={t('seconds')} variant={variant} />
      </div>
    </div>
  );
}
