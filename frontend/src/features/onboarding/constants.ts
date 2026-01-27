export const ONBOARDING_STORAGE_KEY = 'onboarding-storage';

export const TOUR_STYLES = {
  options: {
    arrowColor: '#ffffff',
    backgroundColor: '#ffffff',
    overlayColor: 'rgba(15, 23, 42, 0.75)',
    primaryColor: '#3B82F6',
    textColor: '#1F2937',
    spotlightShadow: '0 0 15px rgba(59, 130, 246, 0.5)',
    zIndex: 10000,
  },
  buttonNext: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    padding: '10px 20px',
  },
  buttonBack: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: 500,
    marginRight: 10,
  },
  buttonSkip: {
    color: '#94A3B8',
    fontSize: 13,
  },
  buttonClose: {
    color: '#94A3B8',
    height: 14,
    width: 14,
  },
  tooltip: {
    borderRadius: 12,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    padding: '20px 24px',
  },
  tooltipContainer: {
    textAlign: 'left' as const,
  },
  tooltipTitle: {
    color: '#1F2937',
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 8,
  },
  tooltipContent: {
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 1.6,
  },
  spotlight: {
    borderRadius: 8,
  },
};

export const FEATURE_CARDS = [
  {
    icon: '📱',
    titleKey: 'welcome.features.pos.title',
    descriptionKey: 'welcome.features.pos.description',
  },
  {
    icon: '🍔',
    titleKey: 'welcome.features.menu.title',
    descriptionKey: 'welcome.features.menu.description',
  },
  {
    icon: '🪑',
    titleKey: 'welcome.features.tables.title',
    descriptionKey: 'welcome.features.tables.description',
  },
  {
    icon: '📊',
    titleKey: 'welcome.features.reports.title',
    descriptionKey: 'welcome.features.reports.description',
  },
];
