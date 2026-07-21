import { format, addDays } from 'date-fns';
import {
  ShoppingCart,
  Table as TableIcon,
  UtensilsCrossed,
  LucideIcon,
  ChefHat,
  Users,
  UserCircle,
  QrCode,
  BarChart3,
  Settings,
} from 'lucide-react';
import { UserRole } from '../../types';

// Window = [today 00:00, tomorrow 00:00]; the sales-comparison endpoint
// mirrors the same span backwards, so "previous" is exactly yesterday.
export const todayRange = (now: Date = new Date()) => ({
  startDate: format(now, 'yyyy-MM-dd'),
  endDate: format(addDays(now, 1), 'yyyy-MM-dd'),
});

export const greetingKey = (now: Date = new Date()) => {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'dashboard.greetingMorning' as const;
  if (h >= 12 && h < 18) return 'dashboard.greetingAfternoon' as const;
  return 'dashboard.greetingEvening' as const;
};

export interface QuickAction {
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
  roles: UserRole[];
  isPrimary?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    to: '/pos',
    icon: ShoppingCart,
    label: 'navigation.pos',
    description: 'dashboard.posDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
    isPrimary: true,
  },
  {
    to: '/kitchen',
    icon: ChefHat,
    label: 'navigation.kitchen',
    description: 'dashboard.kitchenDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
  },
  {
    to: '/admin/menu',
    icon: UtensilsCrossed,
    label: 'navigation.menu',
    description: 'dashboard.menuDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER],
  },
  {
    to: '/admin/tables',
    icon: TableIcon,
    label: 'navigation.tables',
    description: 'dashboard.tablesDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER],
  },
  {
    to: '/admin/team',
    icon: Users,
    label: 'navigation.team',
    description: 'dashboard.teamDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER],
  },
  {
    to: '/customers',
    icon: UserCircle,
    label: 'navigation.customers',
    description: 'dashboard.customersDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
  },
  {
    to: '/admin/qr-codes',
    icon: QrCode,
    label: 'navigation.qrCodes',
    description: 'dashboard.qrCodesDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER],
  },
  {
    to: '/admin/reports',
    icon: BarChart3,
    label: 'navigation.reportsAnalytics',
    description: 'dashboard.reportsDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER],
  },
  {
    to: '/admin/settings',
    icon: Settings,
    label: 'navigation.settings',
    description: 'dashboard.settingsDescription',
    roles: [UserRole.ADMIN, UserRole.MANAGER],
  },
];
