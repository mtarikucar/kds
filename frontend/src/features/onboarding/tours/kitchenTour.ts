import { TourStep, TourConfig, TOUR_IDS } from './types';

export const kitchenTourSteps: TourStep[] = [
  {
    target: '[data-tour="kitchen-stats"]',
    content: '',
    title: '',
    placement: 'center',
    disableBeacon: true,
    route: '/kitchen',
    spotlightPadding: 0,
    locale: {
      skip: 'tour.skip',
    },
  },
  {
    target: '[data-tour="kitchen-stats"]',
    content: '',
    title: '',
    placement: 'bottom',
    disableBeacon: true,
    route: '/kitchen',
    spotlightPadding: 8,
  },
  {
    target: '[data-tour="order-queues"]',
    content: '',
    title: '',
    placement: 'top',
    disableBeacon: true,
    route: '/kitchen',
    spotlightPadding: 8,
  },
  {
    target: '[data-tour="order-actions"]',
    content: '',
    title: '',
    placement: 'top',
    disableBeacon: true,
    route: '/kitchen',
    spotlightPadding: 8,
  },
  {
    target: 'body',
    content: '',
    title: '',
    placement: 'center',
    disableBeacon: true,
    spotlightPadding: 0,
    styles: {
      spotlight: {
        display: 'none',
      },
    },
  },
];

export const kitchenTour: TourConfig = {
  id: TOUR_IDS.KITCHEN,
  name: 'Kitchen Tour',
  steps: kitchenTourSteps,
};

export default kitchenTour;
