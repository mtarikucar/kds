'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CrescentMoon, Star } from '@/components/animations/RamadanDecorations';

interface RamadanBannerProps {
  discountEndDate?: string;
}

export default function RamadanBanner({ discountEndDate }: RamadanBannerProps) {
  const t = useTranslations('ramadan');
  const [isVisible, setIsVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0 });

  useEffect(() => {
    setMounted(true);
    const dismissed = sessionStorage.getItem('ramadan-banner-dismissed');
    if (dismissed) setIsVisible(false);
  }, []);

  useEffect(() => {
    if (!discountEndDate) return;

    function update() {
      const diff = new Date(discountEndDate!).getTime() - Date.now();
      if (diff <= 0) {
        setIsVisible(false);
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
      });
    }

    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [discountEndDate]);

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem('ramadan-banner-dismissed', 'true');
  };

  if (!mounted || !isVisible) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed top-16 lg:top-20 left-0 right-0 z-40 overflow-hidden bg-gradient-to-r from-ramadan-deep via-ramadan-purple/80 to-ramadan-deep"
        >
          {/* Shimmer overlay */}
          <div className="absolute inset-0 animate-shimmer opacity-20" />

          {/* Decorative elements */}
          <Star className="absolute left-[5%] top-1/2 -translate-y-1/2 opacity-30 hidden sm:block" size={12} delay={0} />
          <Star className="absolute left-[15%] top-1/4 opacity-20 hidden sm:block" size={8} delay={0.5} />
          <Star className="absolute right-[15%] top-1/3 opacity-25 hidden sm:block" size={10} delay={1} />

          <div className="relative flex items-center justify-center gap-3 sm:gap-4 px-4 py-2.5 sm:py-3">
            {/* Crescent icon */}
            <CrescentMoon className="flex-shrink-0 hidden sm:block" size={24} />

            {/* Message */}
            <span className="text-sm sm:text-base font-semibold text-white">
              {t('bannerTitle')}
            </span>

            {/* Countdown mini */}
            {discountEndDate && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-ramadan-gold font-medium">
                <span className="px-1.5 py-0.5 bg-white/10 rounded">{timeLeft.days}{t('days').charAt(0)}</span>
                <span className="px-1.5 py-0.5 bg-white/10 rounded">{timeLeft.hours}{t('hours').charAt(0)}</span>
                <span className="px-1.5 py-0.5 bg-white/10 rounded">{timeLeft.minutes}{t('minutes').charAt(0)}</span>
              </span>
            )}

            {/* CTA */}
            <a
              href="#pricing"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs sm:text-sm font-semibold text-ramadan-deep bg-ramadan-gold rounded-full hover:bg-ramadan-star transition-colors"
            >
              {t('bannerCta')}
              <ArrowRight className="w-3.5 h-3.5" />
            </a>

            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
