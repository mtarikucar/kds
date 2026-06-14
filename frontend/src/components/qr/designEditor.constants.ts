// Shared, behavior-neutral constant data for the QR DesignEditor.
// Moved verbatim out of DesignEditor.tsx so the editor component and its
// presentational tab children can import the same source of truth.

// Max file size for logo upload (5MB)
export const MAX_LOGO_SIZE = 5 * 1024 * 1024;

export const colorThemes = [
  { id: 'modernBlue', name: 'Modern Blue', primary: '#3B82F6', secondary: '#1E40AF', background: '#F0F9FF' },
  { id: 'elegantDark', name: 'Elegant Dark', primary: '#1F2937', secondary: '#111827', background: '#F9FAFB' },
  { id: 'warmOrange', name: 'Warm Orange', primary: '#F97316', secondary: '#EA580C', background: '#FFF7ED' },
  { id: 'freshGreen', name: 'Fresh Green', primary: '#10B981', secondary: '#059669', background: '#F0FDF4' },
  { id: 'royalPurple', name: 'Royal Purple', primary: '#8B5CF6', secondary: '#7C3AED', background: '#FAF5FF' },
  { id: 'classicRed', name: 'Classic Red', primary: '#EF4444', secondary: '#DC2626', background: '#FEF2F2' }
];

export const designTemplates = [
  {
    id: 'fineDining',
    name: 'Fine Dining',
    description: 'Elegant and sophisticated design',
    preview: '🍽️',
    settings: {
      primaryColor: '#1F2937',
      secondaryColor: '#111827',
      backgroundColor: '#F9FAFB',
      fontFamily: 'Playfair Display',
      layoutStyle: 'LIST',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      itemsPerRow: 1
    }
  },
  {
    id: 'modernCafe',
    name: 'Modern Cafe',
    description: 'Clean and minimal design',
    preview: '☕',
    settings: {
      primaryColor: '#3B82F6',
      secondaryColor: '#1E40AF',
      backgroundColor: '#F0F9FF',
      fontFamily: 'Inter',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: false,
      showImages: true,
      itemsPerRow: 2
    }
  },
  {
    id: 'fastFood',
    name: 'Fast Food',
    description: 'Vibrant and energetic design',
    preview: '🍔',
    settings: {
      primaryColor: '#EF4444',
      secondaryColor: '#DC2626',
      backgroundColor: '#FEF2F2',
      fontFamily: 'Montserrat',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: false,
      showImages: true,
      itemsPerRow: 3
    }
  },
  {
    id: 'healthyFresh',
    name: 'Healthy & Fresh',
    description: 'Natural and organic feel',
    preview: '🥗',
    settings: {
      primaryColor: '#10B981',
      secondaryColor: '#059669',
      backgroundColor: '#F0FDF4',
      fontFamily: 'Open Sans',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      itemsPerRow: 2
    }
  },
  {
    id: 'pizzaPlace',
    name: 'Pizza Place',
    description: 'Warm and inviting design',
    preview: '🍕',
    settings: {
      primaryColor: '#F97316',
      secondaryColor: '#EA580C',
      backgroundColor: '#FFF7ED',
      fontFamily: 'Roboto',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      itemsPerRow: 2
    }
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Simple black and white',
    preview: '⚫',
    settings: {
      primaryColor: '#000000',
      secondaryColor: '#374151',
      backgroundColor: '#FFFFFF',
      fontFamily: 'Inter',
      layoutStyle: 'LIST',
      showRestaurantInfo: false,
      showPrices: true,
      showDescription: false,
      showImages: false,
      itemsPerRow: 1
    }
  }
];

export const fontOptions = [
  { value: 'Inter', label: 'Inter', className: 'font-sans' },
  { value: 'Roboto', label: 'Roboto', className: 'font-sans' },
  { value: 'Open Sans', label: 'Open Sans', className: 'font-sans' },
  { value: 'Playfair Display', label: 'Playfair Display', className: 'font-serif' },
  { value: 'Merriweather', label: 'Merriweather', className: 'font-serif' },
  { value: 'Montserrat', label: 'Montserrat', className: 'font-sans' }
];
