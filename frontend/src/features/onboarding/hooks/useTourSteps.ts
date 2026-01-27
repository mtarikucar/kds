import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../store/authStore';
import { UserRole } from '../../../types';
import { TourConfig, TourStep, TOUR_IDS } from '../tours/types';
import { adminTourSteps } from '../tours/adminTour';
import { waiterTourSteps } from '../tours/waiterTour';
import { kitchenTourSteps } from '../tours/kitchenTour';

interface UseTourStepsReturn {
  tourConfig: TourConfig | null;
  steps: TourStep[];
  tourId: string | null;
}

export function useTourSteps(): UseTourStepsReturn {
  const { t } = useTranslation('onboarding');
  const user = useAuthStore((state) => state.user);
  const role = user?.role as UserRole | undefined;

  return useMemo(() => {
    if (!role) {
      return { tourConfig: null, steps: [], tourId: null };
    }

    let baseSteps: TourStep[];
    let tourId: string;
    let tourName: string;

    switch (role) {
      case UserRole.ADMIN:
      case UserRole.MANAGER:
        baseSteps = adminTourSteps;
        tourId = TOUR_IDS.ADMIN;
        tourName = 'Admin Tour';
        break;
      case UserRole.WAITER:
        baseSteps = waiterTourSteps;
        tourId = TOUR_IDS.WAITER;
        tourName = 'Waiter Tour';
        break;
      case UserRole.KITCHEN:
        baseSteps = kitchenTourSteps;
        tourId = TOUR_IDS.KITCHEN;
        tourName = 'Kitchen Tour';
        break;
      default:
        return { tourConfig: null, steps: [], tourId: null };
    }

    // Translate steps
    const translatedSteps = baseSteps.map((step, index) => {
      const stepKey = getStepKey(tourId, index);
      return {
        ...step,
        title: t(`steps.${stepKey}.title`, { defaultValue: '' }),
        content: t(`steps.${stepKey}.content`, { defaultValue: '' }),
      };
    });

    return {
      tourConfig: {
        id: tourId,
        name: tourName,
        steps: translatedSteps,
      },
      steps: translatedSteps,
      tourId,
    };
  }, [role, t]);
}

function getStepKey(tourId: string, index: number): string {
  const stepKeys: Record<string, string[]> = {
    [TOUR_IDS.ADMIN]: [
      'dashboard.welcome',
      'dashboard.quickActions',
      'pos.tableGrid',
      'pos.menuPanel',
      'pos.orderCart',
      'menu.productList',
      'menu.addCategory',
      'qr.management',
      'qr.download',
      'tables.viewToggle',
      'tables.floorPlan3d',
      'settings.navigation',
      'completion',
    ],
    [TOUR_IDS.WAITER]: [
      'dashboard.welcome',
      'pos.tableGrid',
      'pos.orderCart',
      'notifications',
      'completion',
    ],
    [TOUR_IDS.KITCHEN]: [
      'kitchen.stats',
      'kitchen.orderQueues',
      'kitchen.orderActions',
    ],
  };

  return stepKeys[tourId]?.[index] || `step${index}`;
}

export default useTourSteps;
