import { QrCode, LayoutGrid, CreditCard, ChefHat, Building2 } from 'lucide-react';

export const features = [
  {
    id: 'qr-menu',
    icon: QrCode,
    title: 'QR Menu',
    description: 'Create beautiful digital menus that customers can scan and browse instantly. Update prices and items in real-time without reprinting.',
    bullets: [
      'Instant menu updates, zero printing costs',
      'Multi-language support for international guests',
      'Allergen and dietary information display',
    ],
    metrics: [
      { label: 'Printing costs', value: '₺0' },
      { label: 'Update time', value: 'Instant' },
    ],
  },
  {
    id: 'order-management',
    icon: LayoutGrid,
    title: 'Order & Table Management',
    description: 'Get a real-time bird\'s eye view of your entire floor. Track table status, manage reservations, and optimize seating.',
    bullets: [
      'Visual floor plan with live table status',
      'Smart reservation management',
      'Table merge and split functionality',
    ],
    metrics: [
      { label: 'Order processing', value: '40% faster' },
      { label: 'Table turnover', value: '+25%' },
    ],
  },
  {
    id: 'pos-payments',
    icon: CreditCard,
    title: 'POS & Payments',
    description: 'Fast, reliable point of sale with support for all payment methods. Split bills, apply discounts, and close tabs in seconds.',
    bullets: [
      'Accept cards, cash, and mobile payments',
      'Easy bill splitting and item transfers',
      'Automatic tip calculation and distribution',
    ],
    metrics: [
      { label: 'Payment success', value: '99.9%' },
      { label: 'Checkout time', value: '< 30s' },
    ],
  },
  {
    id: 'kitchen-flow',
    icon: ChefHat,
    title: 'Staff & Kitchen Flow',
    description: 'Digital kitchen display system that eliminates paper tickets. Prioritize orders, track cook times, and coordinate your team.',
    bullets: [
      'Real-time kitchen display screens',
      'Order prioritization and timing',
      'Role-based staff task management',
    ],
    metrics: [
      { label: 'Order errors', value: '-85%' },
      { label: 'Avg prep time', value: '12 min' },
    ],
  },
  {
    id: 'multi-branch',
    icon: Building2,
    title: 'Multi-Branch Control',
    description: 'Manage all your locations from a single dashboard. Standardize menus, monitor performance, and scale your business.',
    bullets: [
      'Centralized menu and pricing control',
      'Cross-location analytics and reporting',
      'Branch-specific customization options',
    ],
    metrics: [
      { label: 'Branches', value: 'Unlimited' },
      { label: 'Sync time', value: 'Real-time' },
    ],
  },
];

export type Feature = typeof features[number];
