'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

const FIRST_VISIT_KEY = 'hummytummy_first_visit';

export function FloatingMascot() {
  const [isHovered, setIsHovered] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const t = useTranslations('mascot');

  useEffect(() => {
    try {
      const hasVisited = localStorage.getItem(FIRST_VISIT_KEY);
      if (!hasVisited) {
        setIsFirstVisit(true);
        setShowWelcome(true);
        localStorage.setItem(FIRST_VISIT_KEY, 'true');

        const timer = setTimeout(() => {
          setShowWelcome(false);
        }, 5000);

        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) — treat as returning visitor
    }
  }, []);

  const isVisible = isHovered || showWelcome;

  return (
    <div
      className="fixed bottom-0 right-0 md:right-8 z-50"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Speech Bubble */}
      <div
        className={`absolute bottom-full right-0 mb-2 w-52 sm:mb-3 sm:w-64 md:w-72 transition-all duration-200 ease-out ${
          isVisible
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
        }`}
      >
        <div className="relative rounded-xl bg-white p-3 shadow-lg ring-1 ring-black/5 sm:rounded-2xl sm:p-4">
          {isFirstVisit && showWelcome ? (
            <>
              <p className="mb-2 text-sm font-medium text-foreground">
                {t('welcome')}
              </p>
              <p className="text-xs text-muted">
                {t('welcomeMessage')}
              </p>
            </>
          ) : (
            <>
              <p className="mb-2 text-sm font-medium text-foreground">
                {t('greeting')}
              </p>
              <p className="mb-2 text-xs text-muted">
                {t('subtitle')}
              </p>
              <ul className="space-y-1 text-xs text-foreground">
                <li className="flex items-start gap-1.5">
                  <span className="text-brand">&#8226;</span>
                  <span>{t('feature1')}</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-brand">&#8226;</span>
                  <span>{t('feature2')}</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-brand">&#8226;</span>
                  <span>{t('feature3')}</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-brand">&#8226;</span>
                  <span>{t('feature4')}</span>
                </li>
              </ul>
            </>
          )}

          {/* Arrow pointing to mascot */}
          <div className="absolute -bottom-2 right-8 h-4 w-4 rotate-45 bg-white ring-1 ring-black/5" />
        </div>
      </div>

      {/* Mascot */}
      <div className="relative h-24 w-36 cursor-pointer sm:h-32 sm:w-48 md:h-40 md:w-60 hover:scale-105 transition-transform duration-200">
        <Image
          src="/voxel_chef_bottom.webp"
          alt="HummyTummy Chef Mascot"
          fill
          className="drop-shadow-lg"
          loading="lazy"
        />
      </div>
    </div>
  );
}
