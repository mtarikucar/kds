import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  ShoppingCart,
  ChefHat,
  UserCircle,
  UtensilsCrossed,
  Table,
  Users,
  QrCode,
  BarChart3,
  Settings,
  LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useSubscription } from '../contexts/SubscriptionContext';
import { UserRole, PlanFeatures } from '../types';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/utils';

interface MenuItem {
  id: string;
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
  roles: UserRole[];
  requiredFeature?: keyof PlanFeatures;
  priority: number; // Lower number = higher priority
  color: 'primary' | 'accent' | 'secondary' | 'neutral';
}

const HomePage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const userRole = user?.role as UserRole;
  const { hasFeature } = useSubscription();

  const allMenuItems: MenuItem[] = [
    {
      id: 'pos',
      to: '/pos',
      icon: ShoppingCart,
      label: t('navigation.pos'),
      description: t('home.posDescription', 'Sipariş al, ödeme yap'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
      priority: 1,
      color: 'primary',
    },
    {
      id: 'kitchen',
      to: '/kitchen',
      icon: ChefHat,
      label: t('navigation.kitchen'),
      description: t('home.kitchenDescription', 'Mutfak ekranı ve sipariş yönetimi'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
      priority: 2,
      color: 'accent',
    },
    {
      id: 'customers',
      to: '/customers',
      icon: UserCircle,
      label: t('navigation.customers'),
      description: t('home.customersDescription', 'Müşteri bilgileri ve geçmiş'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
      priority: 3,
      color: 'secondary',
    },
    {
      id: 'menu',
      to: '/admin/menu',
      icon: UtensilsCrossed,
      label: t('navigation.menu'),
      description: t('home.menuDescription', 'Menü ve ürün yönetimi'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      priority: 4,
      color: 'primary',
    },
    {
      id: 'tables',
      to: '/admin/tables',
      icon: Table,
      label: t('navigation.tables'),
      description: t('home.tablesDescription', 'Masa düzeni ve yönetimi'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      priority: 5,
      color: 'secondary',
    },
    {
      id: 'users',
      to: '/admin/users',
      icon: Users,
      label: t('navigation.users'),
      description: t('home.usersDescription', 'Kullanıcı ve yetki yönetimi'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      priority: 6,
      color: 'primary',
    },
    {
      id: 'qr-codes',
      to: '/admin/qr-codes',
      icon: QrCode,
      label: t('navigation.qrCodes'),
      description: t('home.qrCodesDescription', 'QR menü kodları yönetimi'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      priority: 7,
      color: 'accent',
    },
    {
      id: 'reports',
      to: '/admin/reports',
      icon: BarChart3,
      label: t('navigation.reports'),
      description: t('home.reportsDescription', 'Satış ve performans raporları'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      requiredFeature: 'advancedReports',
      priority: 8,
      color: 'primary',
    },
    {
      id: 'settings',
      to: '/admin/settings',
      icon: Settings,
      label: t('navigation.settings'),
      description: t('home.settingsDescription', 'Sistem ayarları ve yapılandırma'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      priority: 9,
      color: 'neutral',
    },
  ];

  // Filter items based on role and features, then sort by priority
  const filteredItems = allMenuItems
    .filter((item) => {
      if (!userRole || !item.roles.includes(userRole)) return false;
      if (item.requiredFeature && !hasFeature(item.requiredFeature)) return false;
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  const handleItemClick = (item: MenuItem) => {
    navigate(item.to);
  };

  const colorClasses = {
    primary: {
      bg: 'bg-white',
      hover: 'hover:bg-primary-50',
      iconBg: 'bg-primary-50',
      icon: 'text-primary-600',
      text: 'text-foreground',
      border: 'border-neutral-200',
    },
    accent: {
      bg: 'bg-white',
      hover: 'hover:bg-accent-50',
      iconBg: 'bg-accent-50',
      icon: 'text-accent-600',
      text: 'text-foreground',
      border: 'border-neutral-200',
    },
    secondary: {
      bg: 'bg-white',
      hover: 'hover:bg-secondary-50',
      iconBg: 'bg-secondary-50',
      icon: 'text-secondary-600',
      text: 'text-foreground',
      border: 'border-neutral-200',
    },
    neutral: {
      bg: 'bg-white',
      hover: 'hover:bg-neutral-50',
      iconBg: 'bg-neutral-50',
      icon: 'text-neutral-600',
      text: 'text-foreground',
      border: 'border-neutral-200',
    },
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1], // Custom easing for smooth feel
      },
    },
  };

  return (
    <div className="h-full w-full overflow-hidden bg-neutral-50">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="h-full w-full p-6 md:p-8 lg:p-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 lg:gap-6"
      >
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const colors = colorClasses[item.color];

          return (
            <motion.div key={item.id} variants={itemVariants} className="h-full">
              <Card
                interactive={false}
                onClick={() => handleItemClick(item)}
                variant="outlined"
                className={cn(
                  'h-full w-full cursor-pointer transition-all duration-200',
                  'hover:shadow-sm hover:border-primary-300',
                  'bg-white border-neutral-200/80',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:ring-offset-1',
                  colors.hover
                )}
              >
                <div className="h-full flex flex-col items-center justify-center p-8 md:p-10 lg:p-12 text-center">
                  {/* Icon - Minimal, clean, no background container */}
                  <div className="mb-6 md:mb-8">
                    <Icon className={cn('h-12 w-12 md:h-14 md:w-14 lg:h-16 lg:w-16', colors.icon)} />
                  </div>

                  {/* Title - Clean typography, minimal weight */}
                  <h3 className={cn(
                    'text-xl md:text-2xl font-medium mb-3 md:mb-4',
                    colors.text,
                    'tracking-tight'
                  )}>
                    {item.label}
                  </h3>

                  {/* Description - Subtle, smaller */}
                  <p className="text-sm md:text-base text-neutral-400 max-w-xs leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
};

export default HomePage;
