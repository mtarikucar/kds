import { useTranslation } from 'react-i18next';
import { Sparkles, LogOut, PlayCircle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useOnboardingContext } from '../onboarding';
import { useExitDemo } from './useDemo';

/**
 * Persistent banner shown while the user is exploring the shared demo
 * restaurant. Source of truth is authStore.demoMode (not user.isDemo, which a
 * profile refetch can drop). Offers to (re)start the guided tour and to return
 * to the real account. Rendered inside OnboardingProvider so startTour is in
 * scope.
 */
export function DemoBanner() {
  const { t } = useTranslation('common');
  const demoMode = useAuthStore((s) => s.demoMode);
  const { startTour } = useOnboardingContext();
  const { exitDemo } = useExitDemo();

  if (!demoMode) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-amber-500 px-4 py-2 text-sm text-amber-950 shadow-sm"
    >
      <Sparkles className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-[12rem] font-medium">
        {t('demo.banner', {
          defaultValue:
            'Demo modundasınız — örnek bir restoranı keşfediyorsunuz. Değişiklikler her gün sıfırlanır.',
        })}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => startTour()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950/10 px-3 py-1.5 font-semibold text-amber-950 transition-colors hover:bg-amber-950/20"
        >
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {t('demo.startTour', { defaultValue: 'Tanıtım turunu başlat' })}
        </button>
        <button
          type="button"
          onClick={exitDemo}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-amber-900"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('demo.exit', { defaultValue: 'Hesabıma dön' })}
        </button>
      </div>
    </div>
  );
}

export default DemoBanner;
