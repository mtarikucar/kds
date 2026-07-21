import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  UtensilsCrossed,
  Table,
  BarChart3,
  Settings,
  QrCode,
  UserCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  X,
  Code,
  CalendarCheck,
  UsersRound,
  Package,
  Wallet,
  LogOut,
  User,
  Stethoscope,
  PhoneIncoming,
  Download,
  CreditCard,
  Building2,
  Sparkles,
} from 'lucide-react';
import { UserRole, PlanFeatures } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useLogout } from '../../features/auth/authApi';
import { useEnterDemo } from '../../features/demo';
import { RTL_LANGUAGES } from '../../i18n/config';

/**
 * v2.8.88 — typed grouped sidebar.
 *
 * Pre-v2.8.88 Sidebar.tsx rendered 25 flat nav items in a single list.
 * It worked when there were 8; at 25 it's tiring to scan and the
 * Activity / Package icons repeat enough to defeat their cue value.
 *
 * Now: 6 named sections, each with a collapse chevron, persisted per
 * section in `uiStore.collapsedSections`. Rail mode
 * (`isSidebarCollapsed=true`) hides section headers entirely — icons
 * stack with the icon-only style they had before.
 *
 * Gating: each item carries `roles?` and `gate?: { feature?,
 * integration?: { domain, vendor? } }`. The filter hides — never
 * 403s. If every item in a section is hidden, the section header
 * doesn't render either.
 */

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  labelFallback?: string;
  roles: UserRole[];
  gate?: {
    feature?: keyof PlanFeatures;
    integration?: { domain: string; vendor?: string };
  };
}

interface NavSection {
  id: string;
  labelKey: string;
  labelFallback: string;
  items: NavItem[];
  /** Reserved for sections that should never collapse (e.g. İşletme). */
  alwaysOpen?: boolean;
}

const SECTIONS: NavSection[] = [
  {
    id: 'business',
    labelKey: 'navigation.sections.business',
    labelFallback: 'İşletme',
    alwaysOpen: true,
    items: [
      {
        to: '/dashboard',
        icon: LayoutDashboard,
        labelKey: 'navigation.dashboard',
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER],
      },
      {
        to: '/pos',
        icon: ShoppingCart,
        labelKey: 'navigation.pos',
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
        // v3.0.0 — hide POS for FREE plans (post-trial fallback). The
        // route itself is also wrapped in <FeatureGate feature="posAccess">;
        // hiding the nav prevents the dead-end click.
        gate: { feature: 'posAccess' },
      },
      {
        to: '/kitchen',
        icon: ChefHat,
        labelKey: 'navigation.kitchen',
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
      },
      {
        to: '/customers',
        icon: UserCircle,
        labelKey: 'navigation.customers',
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
      },
    ],
  },
  {
    id: 'menuAndTables',
    labelKey: 'navigation.sections.menuAndTables',
    labelFallback: 'Menü & Masa',
    items: [
      {
        to: '/admin/menu',
        icon: UtensilsCrossed,
        labelKey: 'navigation.menu',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        // Salon planı (canlı harita + düzenleyici) artık Masalar sayfasının
        // içinde bir mod — ayrı /admin/floor-plan sekmesi kaldırıldı.
        to: '/admin/tables',
        icon: Table,
        labelKey: 'navigation.tables',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        to: '/admin/qr-codes',
        icon: QrCode,
        labelKey: 'navigation.qrCodes',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        to: '/admin/reservations',
        icon: CalendarCheck,
        labelKey: 'navigation.reservations',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        gate: { feature: 'reservationSystem' },
      },
    ],
  },
  {
    id: 'operation',
    labelKey: 'navigation.sections.operation',
    labelFallback: 'Operasyon',
    items: [
      {
        // Ekip: merged Users + Personnel. User-account management is available
        // to all plans; the personnel surfaces (Puantaj tab, performance in the
        // users table) gate themselves inside the page on personnelManagement.
        to: '/admin/team',
        icon: UsersRound,
        labelKey: 'navigation.team',
        labelFallback: 'Ekip',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        to: '/admin/stock',
        icon: Package,
        labelKey: 'navigation.stock',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        gate: { feature: 'inventoryTracking' },
      },
      {
        // Analitik & Raporlar birleşik bölümü — Raporlar + Analitik tek sayfada
        // grup anahtarıyla (bkz. ReportsAnalyticsPage).
        to: '/admin/reports',
        icon: BarChart3,
        labelKey: 'navigation.reportsAnalytics',
        labelFallback: 'Analitik & Raporlar',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        gate: { feature: 'advancedReports' },
      },
      {
        // Finans: Nakit & ÖKC + Muhasebe + Fiş Kurtarma tek çatı (FinancePage).
        // Gate yok — kasa + fatura kesme yasal çekirdek, her planda.
        to: '/admin/finance',
        icon: Wallet,
        labelKey: 'navigation.finance',
        labelFallback: 'Finans',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      // Analitik: artık Raporlar ile birleşti (/admin/reports) — ayrı nav yok.
      // Paket Siparişleri: folded into the POS screen's "Paket Siparişleri"
      // panel — no separate nav entry.
      // Faturalar is now the "Faturalar" tab inside Muhasebe — no separate nav.
    ],
  },
  {
    id: 'multiBranch',
    labelKey: 'navigation.sections.multiBranch',
    labelFallback: 'Şubeler ve Cihazlar',
    items: [
      {
        // The branch hub manages each branch's devices + local network too, so
        // it is NOT multiLocation-gated — single-location tenants provision
        // their devices here. (Creating a 2nd branch is still server-gated.)
        to: '/admin/branches',
        icon: Building2,
        labelKey: 'navigation.branches',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        to: '/admin/health',
        icon: Stethoscope,
        labelKey: 'navigation.health',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
    ],
  },
  // 'Pazaryeri' moved out of the sidebar → top-bar "Mağaza" icon (Header.tsx)
  // → consolidated /admin/store hub (add-ons + hardware + orders tabs).
  {
    id: 'planAndAccess',
    labelKey: 'navigation.sections.planAndAccess',
    labelFallback: 'Ayarlar & Erişim',
    items: [
      {
        to: '/admin/plan',
        icon: CreditCard,
        labelKey: 'navigation.planAndAccess',
        labelFallback: 'Plan & Erişim',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        // v3.0.6: Desktop app promoted from a buried Settings sub-tab to a
        // first-class sidebar destination (standalone /admin/desktop), sitting
        // next to Plan & Erişim. Webhooks moved the other way → Settings tab.
        to: '/admin/desktop',
        icon: Download,
        labelKey: 'navigation.desktopApp',
        labelFallback: 'Masaüstü Uygulaması',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        to: '/admin/settings',
        icon: Settings,
        labelKey: 'navigation.settings',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
      {
        to: '/admin/caller-feed',
        icon: PhoneIncoming,
        labelKey: 'navigation.callerFeed',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
        gate: { integration: { domain: 'caller' } },
      },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isRTL?: boolean;
}

const Sidebar = ({ isOpen, onClose, isRTL: isRTLProp }: SidebarProps) => {
  const { t, i18n } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const {
    isSidebarCollapsed,
    toggleSidebar,
    collapsedSections,
    toggleSection,
  } = useUiStore();
  const { hasFeature, hasIntegration } = useSubscription();
  const { mutate: logout, isPending: isLoggingOut } = useLogout();
  const demoMode = useAuthStore((state) => state.demoMode);
  const { enterDemo, isPending: isEnteringDemo } = useEnterDemo();
  const isRTL = isRTLProp ?? RTL_LANGUAGES.includes(i18n.language);

  // "Explore the demo" is offered to owners/managers (the accounts that get the
  // full app) and hidden once already in demo (the banner owns the exit there).
  const canExploreDemo =
    !demoMode &&
    (user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER);

  const handleLogout = () => {
    if (window.innerWidth < 768) {
      onClose();
    }
    logout();
  };

  const handleExploreDemo = () => {
    if (window.innerWidth < 768) {
      onClose();
    }
    enterDemo();
  };

  const handleNavClick = () => {
    if (window.innerWidth < 768) {
      onClose();
    }
  };

  function itemVisible(item: NavItem): boolean {
    if (!user?.role || !item.roles.includes(user.role as UserRole)) return false;
    if (item.gate?.feature && !hasFeature(item.gate.feature)) return false;
    if (
      item.gate?.integration &&
      !hasIntegration(item.gate.integration.domain, item.gate.integration.vendor)
    ) {
      return false;
    }
    return true;
  }

  // Filter every section's items, then drop sections that have nothing
  // left. This collapses-by-hide rather than 403'ing on click.
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    visibleItems: section.items.filter(itemVisible),
  })).filter((section) => section.visibleItems.length > 0);

  return (
    <aside
      className={`fixed md:static inset-y-0 z-50 ${isRTL ? 'right-0 md:order-2' : 'left-0'} bg-slate-900 text-white h-screen md:h-auto md:min-h-screen flex flex-col transform transition-all duration-300 ease-in-out ${
        isOpen
          ? 'translate-x-0'
          : isRTL
            ? 'max-md:translate-x-full'
            : 'max-md:-translate-x-full'
      } ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} w-64`}
    >
      {/* Header */}
      <div className="px-5 py-6 flex items-center justify-between border-b border-slate-800/50 flex-shrink-0">
        {!isSidebarCollapsed && (
          <h2 className="text-xl font-heading font-bold bg-gradient-to-r from-primary-400 to-primary-300 bg-clip-text text-transparent">
            HummyTummy
          </h2>
        )}
        {isSidebarCollapsed && <div className="w-full" />}

        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Desktop collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center w-8 h-8 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isSidebarCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
        >
          {isSidebarCollapsed
            ? (isRTL ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />)
            : (isRTL ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />)
          }
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 flex-1 overflow-y-auto">
        {canExploreDemo && (
          <button
            type="button"
            onClick={handleExploreDemo}
            disabled={isEnteringDemo}
            className={`mb-4 w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-amber-400/10 text-amber-200 ring-1 ring-amber-400/30 transition-all duration-150 hover:from-amber-500/30 hover:to-amber-400/20 hover:text-amber-100 disabled:opacity-60 disabled:cursor-not-allowed ${
              isSidebarCollapsed ? 'md:justify-center' : ''
            }`}
            title={isSidebarCollapsed ? t('demo.enter', { defaultValue: "Demo'yu keşfet" }) : undefined}
          >
            <Sparkles className="h-5 w-5 flex-shrink-0" />
            <span className={`text-sm font-semibold ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
              {t('demo.enter', { defaultValue: "Demo'yu keşfet" })}
            </span>
          </button>
        )}
        <div className="space-y-4">
          {visibleSections.map((section) => {
            const isCollapsed =
              !section.alwaysOpen && !isSidebarCollapsed && collapsedSections[section.id];
            const showHeader = !isSidebarCollapsed && !section.alwaysOpen;

            return (
              <div key={section.id} className="space-y-1">
                {showHeader && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
                    aria-expanded={!isCollapsed}
                  >
                    <span>
                      {t(section.labelKey, { defaultValue: section.labelFallback })}
                    </span>
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>
                )}
                {!isCollapsed && (
                  <div className="space-y-1">
                    {section.visibleItems.map((item) => {
                      const label = t(item.labelKey, {
                        defaultValue: item.labelFallback ?? item.labelKey,
                      });
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={handleNavClick}
                          className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                              isActive
                                ? 'bg-white/10 text-white font-medium'
                                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                            } ${isSidebarCollapsed ? 'md:justify-center' : ''}`
                          }
                          title={isSidebarCollapsed ? label : undefined}
                        >
                          <item.icon className="h-5 w-5 flex-shrink-0" />
                          <span
                            className={`text-sm ${isSidebarCollapsed ? 'md:hidden' : ''}`}
                          >
                            {label}
                          </span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Development section - only visible in dev mode for ADMIN */}
        {import.meta.env.DEV && user?.role === UserRole.ADMIN && (
          <div className="mt-6 pt-4 border-t border-slate-800/50">
            {!isSidebarCollapsed && (
              <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
                Development
              </p>
            )}
            <NavLink
              to="/dev/floor-plan"
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                } ${isSidebarCollapsed ? 'md:justify-center' : ''}`
              }
              title={isSidebarCollapsed ? 'Floor Plan 3D' : undefined}
            >
              <Code className="h-5 w-5 flex-shrink-0" />
              <span className={`text-sm ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Floor Plan 3D</span>
            </NavLink>
          </div>
        )}
      </nav>

      {/* Footer: user info + logout. Always visible on mobile so users can
          sign out from the slide-in menu; on desktop it complements the
          header's logout button. */}
      <div className="flex-shrink-0 border-t border-slate-800/50 px-3 py-3 space-y-1">
        <NavLink
          to="/profile"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
              isActive
                ? 'bg-white/10 text-white font-medium'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            } ${isSidebarCollapsed ? 'md:justify-center' : ''}`
          }
          title={isSidebarCollapsed ? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() : undefined}
        >
          <div className="w-8 h-8 rounded-lg bg-white/10 ring-1 ring-white/10 flex items-center justify-center flex-shrink-0">
            <User className="h-4 w-4" />
          </div>
          <div className={`min-w-0 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
            <p className="text-sm font-medium truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-slate-400 capitalize truncate">
              {user?.role?.replace('_', ' ')}
            </p>
          </div>
        </NavLink>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-slate-300 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-60 disabled:cursor-not-allowed ${
            isSidebarCollapsed ? 'md:justify-center' : ''
          }`}
          title={isSidebarCollapsed ? t('app.logout') : undefined}
          aria-label={t('app.logout')}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          <span className={`text-sm font-medium ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
            {t('app.logout')}
          </span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
