import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Play, SkipForward } from 'lucide-react';
import { FEATURE_CARDS } from './constants';
import { Mascot } from './Mascot';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTour: () => void;
  onSkip: () => void;
}

export function WelcomeModal({
  isOpen,
  onClose,
  onStartTour,
  onSkip,
}: WelcomeModalProps) {
  const { t } = useTranslation('onboarding');
  const modalRef = useRef<HTMLDivElement>(null);
  const startTourButtonRef = useRef<HTMLButtonElement>(null);

  // Handle keyboard escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus management
  useEffect(() => {
    if (isOpen && startTourButtonRef.current) {
      startTourButtonRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        className="relative z-10 w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300"
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label={t('welcome.close')}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-8 pt-8 pb-6 text-center bg-gradient-to-b from-blue-50 to-white">
          <div className="inline-flex items-center justify-center mb-4">
            <Mascot size="lg" variant="modal" speaking />
          </div>
          <h2 id="welcome-modal-title" className="text-2xl font-bold text-slate-800 mb-2">
            {t('welcome.title')}
          </h2>
          <p className="text-slate-600">{t('welcome.subtitle')}</p>
        </div>

        {/* Feature cards */}
        <div className="px-8 py-6">
          <div className="grid grid-cols-2 gap-4">
            {FEATURE_CARDS.map((feature) => (
              <div
                key={feature.titleKey}
                className="p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl" aria-hidden="true">{feature.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-800 text-sm truncate">
                      {t(feature.titleKey)}
                    </h3>
                    <p className="text-xs text-slate-500 truncate">
                      {t(feature.descriptionKey)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-8 pb-8 flex flex-col sm:flex-row gap-3">
          <button
            ref={startTourButtonRef}
            type="button"
            onClick={onStartTour}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-600/20"
          >
            <Play className="w-5 h-5" />
            {t('welcome.startTour')}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors"
          >
            <SkipForward className="w-5 h-5" />
            {t('welcome.skipTour')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WelcomeModal;
