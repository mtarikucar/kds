import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, HelpCircle } from 'lucide-react';
import { Mascot } from './Mascot';
import { useOnboardingContext } from './OnboardingProvider';

export function MascotButton() {
  const { t } = useTranslation('onboarding');
  const { startTour, hasCompletedTour } = useOnboardingContext();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        closeDropdown();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeDropdown]);

  const handleRestartTour = () => {
    setIsOpen(false);
    startTour();
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        aria-label={t('mascot.restartTour')}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <Mascot size="sm" speaking={!hasCompletedTour} />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              onClick={handleRestartTour}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4 text-slate-500" aria-hidden="true" />
              {t('mascot.restartTour')}
            </button>
            <a
              href="https://hummytummy.com/docs"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <HelpCircle className="w-4 h-4 text-slate-500" aria-hidden="true" />
              {t('mascot.help')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default MascotButton;
