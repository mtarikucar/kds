import { TooltipRenderProps } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Mascot } from './Mascot';

export function TourTooltip({
  continuous,
  index,
  step,
  size,
  isLastStep,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  const { t } = useTranslation('onboarding');
  const progress = ((index + 1) / size) * 100;

  return (
    <div
      {...tooltipProps}
      className="bg-white rounded-xl shadow-2xl max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Progress bar */}
      <div className="h-1 bg-slate-100">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header with Mascot */}
      <div className="px-5 pt-4 flex items-start gap-4">
        <Mascot size="md" variant="tooltip" speaking />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {step.title && (
                <h3 className="text-lg font-semibold text-slate-800">
                  {step.title}
                </h3>
              )}
            </div>
            <button
              {...closeProps}
              className="p-1.5 -mr-1.5 -mt-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label={t('tour.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="py-2">
            {step.content && (
              <p className="text-slate-600 text-sm leading-relaxed">
                {step.content}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 pt-2 flex items-center justify-between border-t border-slate-100 mt-2">
        {/* Progress indicator */}
        <span className="text-xs text-slate-400">
          {t('tour.progress', { current: index + 1, total: size })}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Skip button */}
          {!isLastStep && (
            <button
              {...skipProps}
              className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              {t('tour.skip')}
            </button>
          )}

          {/* Back button */}
          {index > 0 && (
            <button
              {...backProps}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              {t('tour.back')}
            </button>
          )}

          {/* Next/Finish button */}
          {continuous && (
            <button
              {...primaryProps}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {isLastStep ? (
                <>
                  <Check className="w-4 h-4" />
                  {t('tour.finish')}
                </>
              ) : (
                <>
                  {t('tour.next')}
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default TourTooltip;
