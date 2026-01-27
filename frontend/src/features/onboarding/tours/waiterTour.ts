import { TourStep, TourConfig, TOUR_IDS } from './types';

export const waiterTourSteps: TourStep[] = [
  {
    target: '[data-tour="dashboard-container"]',
    content: '',
    title: '',
    placement: 'center',
    disableBeacon: true,
    route: '/dashboard',
    spotlightPadding: 0,
    locale: {
      skip: 'tour.skip',
    },
  },
  {
    target: '[data-tour="table-grid"]',
    content: '',
    title: '',
    placement: 'right',
    disableBeacon: true,
    route: '/pos',
    spotlightPadding: 8,
  },
  {
    target: '[data-tour="order-cart"]',
    content: '',
    title: '',
    placement: 'left',
    disableBeacon: true,
    route: '/pos',
    spotlightPadding: 8,
  },
  {
    target: '[data-tour="notifications"]',
    content: '',
    title: '',
    placement: 'bottom',
    disableBeacon: true,
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

export const waiterTour: TourConfig = {
  id: TOUR_IDS.WAITER,
  name: 'Waiter Tour',
  steps: waiterTourSteps,
};

export default waiterTour;
