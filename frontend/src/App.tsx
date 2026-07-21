import { useState, useEffect, useMemo, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
// Code-split routes use lazyWithReload (not React.lazy) so an open tab
// recovers from a deploy that replaced the hashed chunk files: a stale-chunk
// import 404 triggers a one-shot reload onto the fresh index.html instead of
// a white screen. See utils/lazyWithReload.ts.
import { lazyWithReload } from "./utils/lazyWithReload";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import VerifyEmailPage from "./pages/auth/VerifyEmailPage";

// SuperAdmin Pages (lazy-loaded)
const SuperAdminLoginPage = lazyWithReload(
  () => import("./pages/superadmin/SuperAdminLoginPage"),
);
const SuperAdmin2FAPage = lazyWithReload(
  () => import("./pages/superadmin/SuperAdmin2FAPage"),
);
const SuperAdminDashboardPage = lazyWithReload(
  () => import("./pages/superadmin/SuperAdminDashboardPage"),
);
const TenantsPage = lazyWithReload(
  () => import("./pages/superadmin/TenantsPage"),
);
const TenantDetailPage = lazyWithReload(
  () => import("./pages/superadmin/TenantDetailPage"),
);
const AllUsersPage = lazyWithReload(
  () => import("./pages/superadmin/AllUsersPage"),
);
const PlansPage = lazyWithReload(() => import("./pages/superadmin/PlansPage"));
const SubscriptionsPage = lazyWithReload(
  () => import("./pages/superadmin/SubscriptionsPage"),
);
const BankTransferPage = lazyWithReload(
  () => import("./pages/superadmin/BankTransferPage"),
);
const AuditLogsPage = lazyWithReload(
  () => import("./pages/superadmin/AuditLogsPage"),
);
const SuperAdminSettingsPage = lazyWithReload(
  () => import("./pages/superadmin/SuperAdminSettingsPage"),
);
const MarketplaceAdminPage = lazyWithReload(
  () => import("./pages/superadmin/MarketplaceAdminPage"),
);
import {
  SuperAdminLayout,
  SuperAdminProtectedRoute,
} from "./features/superadmin/components";

// (The marketing panel moved to the separate kds-marketing project.)
import ProfilePage from "./pages/profile/ProfilePage";
import FAQPage from "./pages/help/FAQPage";
import CustomersPage from "./pages/customers/CustomersPage";
import CustomerDetailPage from "./pages/customers/CustomerDetailPage";

// QR Menu Pages (lazy-loaded - customer-facing)
const QRMenuPage = lazyWithReload(() => import("./pages/qr-menu/QRMenuPage"));
const CartPage = lazyWithReload(() => import("./pages/qr-menu/CartPage"));
const OrderTrackingPage = lazyWithReload(
  () => import("./pages/qr-menu/OrderTrackingPage"),
);
const QrPaymentResultPage = lazyWithReload(
  () => import("./pages/qr-menu/QrPaymentResultPage"),
);
const LoyaltyPage = lazyWithReload(() => import("./pages/qr-menu/LoyaltyPage"));
const SubdomainQRMenuPage = lazyWithReload(
  () => import("./pages/qr-menu/SubdomainQRMenuPage"),
);
const SubdomainCartPage = lazyWithReload(
  () => import("./pages/qr-menu/SubdomainCartPage"),
);
const SubdomainOrdersPage = lazyWithReload(
  () => import("./pages/qr-menu/SubdomainOrdersPage"),
);
const SubdomainLoyaltyPage = lazyWithReload(
  () => import("./pages/qr-menu/SubdomainLoyaltyPage"),
);

const LandingPage = lazyWithReload(() => import("./pages/LandingPage"));
const PricingPage = lazyWithReload(
  () => import("./pages/marketing/PricingPage"),
);
const ModulesIndexPage = lazyWithReload(
  () => import("./pages/marketing/ModulesIndexPage"),
);
const ModulePage = lazyWithReload(() => import("./pages/marketing/ModulePage"));
const SectorsIndexPage = lazyWithReload(
  () => import("./pages/marketing/SectorsIndexPage"),
);
const SectorPage = lazyWithReload(() => import("./pages/marketing/SectorPage"));
const IntegrationsPage = lazyWithReload(
  () => import("./pages/marketing/IntegrationsPage"),
);
const CorporatePage = lazyWithReload(
  () => import("./pages/marketing/CorporatePage"),
);
const PublicReservationPage = lazyWithReload(
  () => import("./pages/reservations/PublicReservationPage"),
);
const ReservationLookupPage = lazyWithReload(
  () => import("./pages/reservations/ReservationLookupPage"),
);
const TermsOfServicePage = lazyWithReload(
  () => import("./pages/legal/TermsOfServicePage"),
);
const PrivacyPolicyPage = lazyWithReload(
  () => import("./pages/legal/PrivacyPolicyPage"),
);
// Subscription checkout consent links to these three; without
// matching routes the new-tab open lands on the Next.js landing
// app, gets a locale prefix from next-intl, and 404s.
const KvkkPage = lazyWithReload(() => import("./pages/legal/KvkkPage"));
const DistanceSalesPage = lazyWithReload(
  () => import("./pages/legal/DistanceSalesPage"),
);
const RefundPolicyPage = lazyWithReload(
  () => import("./pages/legal/RefundPolicyPage"),
);
import DashboardPage from "./pages/DashboardPage";
import POSPage from "./pages/pos/POSPage";
import KitchenDisplayPage from "./pages/kitchen/KitchenDisplayPage";
// Admin Pages (lazy-loaded)
const MenuManagementPage = lazyWithReload(
  () => import("./pages/admin/MenuManagementPage"),
);
const ProductEditorPage = lazyWithReload(
  () => import("./pages/admin/ProductEditorPage"),
);
const TableManagementPage = lazyWithReload(
  () => import("./pages/admin/TableManagementPage"),
);
const TeamPage = lazyWithReload(() => import("./pages/admin/TeamPage"));
const QRManagementPage = lazyWithReload(
  () => import("./pages/admin/QRManagementPage"),
);
const ReportsAnalyticsPage = lazyWithReload(
  () => import("./pages/admin/ReportsAnalyticsPage"),
);
const StockPage = lazyWithReload(() => import("./pages/admin/StockPage"));
const FinancePage = lazyWithReload(() => import("./pages/admin/FinancePage"));
const ReservationsPage = lazyWithReload(
  () => import("./pages/admin/ReservationsPage"),
);

// Onboarding (lazy-loaded)
const WelcomePage = lazyWithReload(
  () => import("./pages/onboarding/WelcomePage"),
);

// Subscription & Settings Pages (lazy-loaded)
const SubscriptionPlansPage = lazyWithReload(
  () => import("./pages/subscription/SubscriptionPlansPage"),
);
const ChangePlanPage = lazyWithReload(
  () => import("./pages/subscription/ChangePlanPage"),
);
const CheckoutPage = lazyWithReload(
  () => import("./pages/subscription/CheckoutPage"),
);
const PaymentResultPage = lazyWithReload(
  () => import("./pages/subscription/PaymentResultPage"),
);
const SettingsLayout = lazyWithReload(
  () => import("./pages/settings/SettingsLayout"),
);
const POSSettingsPage = lazyWithReload(
  () => import("./pages/settings/POSSettingsPage"),
);
const QRMenuSettingsPage = lazyWithReload(
  () => import("./pages/settings/QRMenuSettingsPage"),
);
const ReportsSettingsPage = lazyWithReload(
  () => import("./pages/settings/ReportsSettingsPage"),
);
const BrandingSettingsPage = lazyWithReload(
  () => import("./pages/settings/BrandingSettingsPage"),
);
const IntegrationsSettingsPage = lazyWithReload(
  () => import("./pages/settings/IntegrationsSettingsPage"),
);
const DesktopAppSettingsPage = lazyWithReload(
  () => import("./pages/settings/DesktopAppSettingsPage"),
);
const ReservationSettingsPage = lazyWithReload(
  () => import("./pages/settings/ReservationSettingsPage"),
);
const ShiftTemplatesSettingsPage = lazyWithReload(
  () => import("./pages/settings/ShiftTemplatesSettingsPage"),
);
const ScheduleSettingsPage = lazyWithReload(
  () => import("./pages/settings/ScheduleSettingsPage"),
);
const DeliveryPlatformsSettingsPage = lazyWithReload(
  () => import("./pages/settings/DeliveryPlatformsSettingsPage"),
);
const SmsSettingsPage = lazyWithReload(
  () => import("./pages/settings/SmsSettingsPage"),
);
import Layout from "./components/layout/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
// HummyTummy Phase 3–12 admin screens.
import StoreHubPage from "./features/store/StoreHubPage";
import HardwareOrderDetailPage from "./features/hardware-store/HardwareOrderDetailPage";
import ProductDetailPage from "./features/hardware-store/ProductDetailPage";
import BranchesPage from "./features/branches/BranchesPage";
import BranchDetailPage from "./features/branches/BranchDetailPage";
import HealthPage from "./features/health/HealthPage";
import WebhooksPage from "./features/webhooks/WebhooksPage";
import PartnerKeysPage from "./features/partner-keys/PartnerKeysPage";
import CallerFeedPage from "./features/caller/CallerFeedPage";
import PlanAndAccessPage from "./features/plan/PlanAndAccessPage";
import FeatureGate from "./components/subscriptions/FeatureGate";
import UpsellCard from "./components/subscriptions/UpsellCard";
import { UpdateDialog } from "./components/UpdateDialog";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useBranchChangeInvalidation } from "./hooks/useBranchChangeInvalidation";
import { useBranchScopeFallback } from "./hooks/useBranchScopeFallback";
import { useNotificationSocket } from "./features/notifications/notificationsApi";
import { useAuthStore } from "./store/authStore";
import { useBranchScopeStore } from "./store/branchScopeStore";
import { UserRole } from "./types";
import { detectSubdomain } from "./utils/subdomain";

function App() {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const isAuthenticated = useAuthStore((state) => !!state.accessToken);
  const user = useAuthStore((state) => state.user);

  // v3.0.0 — hydrate the branch scope every time the persisted user
  // changes. Cross-store side effects live HERE (component effect),
  // not inside authStore.set — the audit's High finding #9 closed.
  useEffect(() => {
    useBranchScopeStore.getState().hydrateFromUser(user);
  }, [user]);

  // v3.0.0 — invalidate every TanStack Query when the active branch changes so
  // stale data from the previous branch can't show up for the staleTime window.
  // Extracted to a unit-tested hook (useBranchChangeInvalidation).
  useBranchChangeInvalidation();

  // v3.1.x safety net — if the active branch can't be resolved from the
  // login/profile response (owner ADMIN/MANAGER with a null primaryBranchId),
  // fetch the tenant's branches and auto-select the first active one so the
  // api-client never hard-rejects every branch-scoped request (blank KDS /
  // generic "failed" toasts on everything).
  useBranchScopeFallback();

  // Detect subdomain access
  const subdomainInfo = useMemo(() => detectSubdomain(), []);

  // Auto-update hook - check for updates on app startup
  const updateState = useAutoUpdate(true);

  // Initialize WebSocket for real-time notifications (hook must be called unconditionally)
  useNotificationSocket();

  // Show update dialog when update is available
  if (updateState.available && !showUpdateDialog) {
    setShowUpdateDialog(true);
  }

  const handleUpdate = () => {
    updateState.downloadAndInstall();
  };

  const handleDismiss = () => {
    setShowUpdateDialog(false);
  };

  // Subdomain access - only show QR menu routes
  if (subdomainInfo.isSubdomainAccess && subdomainInfo.subdomain) {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route
            path="/"
            element={
              <SubdomainQRMenuPage subdomain={subdomainInfo.subdomain} />
            }
          />
          <Route
            path="/cart"
            element={<SubdomainCartPage subdomain={subdomainInfo.subdomain} />}
          />
          <Route
            path="/orders"
            element={
              <SubdomainOrdersPage subdomain={subdomainInfo.subdomain} />
            }
          />
          <Route
            path="/loyalty"
            element={
              <SubdomainLoyaltyPage subdomain={subdomainInfo.subdomain} />
            }
          />
          <Route
            path="/payment-result"
            element={
              <QrPaymentResultPage subdomain={subdomainInfo.subdomain} />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/fiyatlandirma" element={<PricingPage />} />
          <Route path="/ozellikler" element={<ModulesIndexPage />} />
          <Route path="/ozellikler/:slug" element={<ModulePage />} />
          <Route path="/cozumler" element={<SectorsIndexPage />} />
          <Route path="/cozumler/:slug" element={<SectorPage />} />
          <Route path="/entegrasyonlar" element={<IntegrationsPage />} />
          <Route path="/kurumsal" element={<CorporatePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          {/* Subscription checkout (CheckoutPage.tsx) opens these in a new
          tab; paths must match the docLink hrefs there exactly. */}
          <Route path="/legal/kvkk" element={<KvkkPage />} />
          <Route path="/legal/distance-sales" element={<DistanceSalesPage />} />
          <Route path="/legal/refund-policy" element={<RefundPolicyPage />} />
          <Route path="/qr-menu/:tenantId" element={<QRMenuPage />} />
          <Route path="/qr-menu/:tenantId/cart" element={<CartPage />} />
          <Route
            path="/qr-menu/:tenantId/orders"
            element={<OrderTrackingPage />}
          />
          <Route path="/qr-menu/:tenantId/loyalty" element={<LoyaltyPage />} />
          <Route
            path="/qr-menu/:tenantId/payment-result"
            element={<QrPaymentResultPage />}
          />
          <Route
            path="/reserve/:tenantId"
            element={<PublicReservationPage />}
          />
          <Route
            path="/reserve/:tenantId/lookup"
            element={<ReservationLookupPage />}
          />

          {/* Onboarding completion (full-screen, no app chrome) — the
          ProfileCompletionGate routes social signups missing a phone here. */}
          <Route
            path="/welcome"
            element={
              <ProtectedRoute>
                <WelcomePage />
              </ProtectedRoute>
            }
          />

          {/* Protected Routes - All authenticated users */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/help" element={<FAQPage />} />
          </Route>

          {/* Protected Routes - ADMIN, MANAGER, WAITER */}
          <Route
            element={
              <ProtectedRoute
                allowedRoles={[
                  UserRole.ADMIN,
                  UserRole.MANAGER,
                  UserRole.WAITER,
                ]}
              >
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* v3.0.0 — POS is tier-gated (BASIC+). FREE plans (post-trial
            fallback) see the UpsellCard; backend pos-settings endpoints
            also return 403 for these tenants. Sidebar item is hidden
            via the same posAccess feature flag below. */}
            <Route
              path="/pos"
              element={
                <FeatureGate
                  feature="posAccess"
                  fallback={<UpsellCard planName="BASIC" />}
                >
                  <POSPage />
                </FeatureGate>
              }
            />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
          </Route>

          {/* Protected Routes - ADMIN, MANAGER, KITCHEN */}
          <Route
            element={
              <ProtectedRoute
                allowedRoles={[
                  UserRole.ADMIN,
                  UserRole.MANAGER,
                  UserRole.KITCHEN,
                ]}
              >
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/kitchen" element={<KitchenDisplayPage />} />
          </Route>

          {/* Protected Routes - ADMIN, MANAGER only (Admin pages) */}
          <Route
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/menu" element={<MenuManagementPage />} />
            <Route
              path="/admin/menu/products/new"
              element={<ProductEditorPage />}
            />
            <Route
              path="/admin/menu/products/:productId/edit"
              element={<ProductEditorPage />}
            />
            <Route path="/admin/tables" element={<TableManagementPage />} />
            {/* Salon planı artık Masalar sayfasının içinde bir mod. */}
            <Route
              path="/admin/floor-plan"
              element={<Navigate to="/admin/tables" replace />}
            />
            {/* Ekip (merged Users + Personnel). Old paths redirect. */}
            <Route path="/admin/team" element={<TeamPage />} />
            <Route
              path="/admin/users"
              element={<Navigate to="/admin/team" replace />}
            />
            <Route path="/admin/qr-codes" element={<QRManagementPage />} />
            {/* v2.8.88 page-root FeatureGate: direct URL access shows an
            upsell instead of 403. Each fallback links to the matching
            marketplace add-on. */}
            {/* Analitik + Raporlar birleşik sayfası (grup anahtarlı). */}
            <Route
              path="/admin/reports"
              element={
                <FeatureGate
                  feature="advancedReports"
                  fallback={<UpsellCard addOnCode="advanced_reports" />}
                >
                  <ReportsAnalyticsPage />
                </FeatureGate>
              }
            />
            {/* Satın Alma + Reçete & Maliyet folded into the unified Stok
                page (/admin/stock). Old paths redirect. */}
            <Route
              path="/admin/purchasing"
              element={<Navigate to="/admin/stock" replace />}
            />
            {/* Finans — Kasa (eski Nakit & ÖKC) + Belgeler (eski Muhasebe/Faturalar/
                Fiş Kurtarma) tek çatı. Gate yok: yasal çekirdek her planda. */}
            <Route path="/admin/finance" element={<FinancePage />} />
            {/* Eski para rotaları Finans'a yönlenir. */}
            <Route path="/admin/cash" element={<Navigate to="/admin/finance?group=cash" replace />} />
            <Route
              path="/admin/accounting-backoffice"
              element={<Navigate to="/admin/finance?group=documents" replace />}
            />
            <Route
              path="/admin/invoices"
              element={<Navigate to="/admin/finance?group=documents" replace />}
            />
            <Route
              path="/admin/fiscal-recovery"
              element={<Navigate to="/admin/finance?group=documents&tab=edoc" replace />}
            />
            <Route
              path="/admin/costing"
              element={<Navigate to="/admin/stock" replace />}
            />
            {/* Analitik: Raporlar ile birleşti — eski yol yönlendirir. */}
            <Route
              path="/admin/analytics"
              element={<Navigate to="/admin/reports" replace />}
            />
            <Route
              path="/admin/reservations"
              element={
                <FeatureGate
                  feature="reservationSystem"
                  fallback={<UpsellCard planName="PRO" />}
                >
                  <ReservationsPage />
                </FeatureGate>
              }
            />
            <Route
              path="/admin/personnel"
              element={<Navigate to="/admin/team" replace />}
            />
            <Route
              path="/admin/stock"
              element={
                <FeatureGate
                  feature="inventoryTracking"
                  fallback={<UpsellCard planName="BASIC" />}
                >
                  <StockPage />
                </FeatureGate>
              }
            />
            {/* Delivery/package orders were folded into the POS screen's
            "Paket Siparişleri" panel (accept / reject / prep-time). The
            standalone queue is gone; keep the path as a redirect for
            bookmarks/deep-links. */}
            <Route
              path="/admin/delivery-orders"
              element={<Navigate to="/pos" replace />}
            />

            {/* Settings Routes - Nested */}
            <Route path="/admin/settings" element={<SettingsLayout />}>
              <Route
                index
                element={<Navigate to="/admin/settings/pos" replace />}
              />
              {/* v3.0.5: the "Abonelik" tab was removed from Settings — it
              duplicated the top-level Plan & Erişim page (/admin/plan). The
              billing detail page (invoices / cancel / reactivate / scheduled
              downgrade) now lives standalone at /subscription/manage, linked
              from Plan & Erişim. This old settings URL redirects there so any
              existing bookmark keeps working. */}
              <Route
                path="subscription"
                element={<Navigate to="/admin/plan" replace />}
              />
              <Route path="pos" element={<POSSettingsPage />} />
              <Route path="qr-menu" element={<QRMenuSettingsPage />} />
              <Route path="reports" element={<ReportsSettingsPage />} />
              <Route
                path="branding"
                element={
                  <FeatureGate
                    feature="customBranding"
                    fallback={<UpsellCard planName="PRO" />}
                  >
                    <BrandingSettingsPage />
                  </FeatureGate>
                }
              />
              {/* v3.0.6: desktop app moved to a standalone sidebar destination
              (/admin/desktop). Redirect the old Settings sub-tab URL. */}
              <Route
                path="desktop"
                element={<Navigate to="/admin/desktop" replace />}
              />
              {/* v2.8.91: settings sub-pages now wrapped in FeatureGate so
              direct URL hits show UpsellCard instead of an empty page +
              403 toast on every backend call. */}
              <Route
                path="integrations"
                element={
                  <FeatureGate
                    feature="apiAccess"
                    fallback={
                      <UpsellCard addOnCode="api_access" planName="BUSINESS" />
                    }
                  >
                    <IntegrationsSettingsPage />
                  </FeatureGate>
                }
              />
              {/* v3.0.6: webhooks moved from the top-level sidebar (/admin/webhooks)
              into Settings — enterprise/developer feature, same apiAccess gate. */}
              <Route
                path="webhooks"
                element={
                  <FeatureGate
                    feature="apiAccess"
                    fallback={
                      <UpsellCard addOnCode="api_access" planName="BUSINESS" />
                    }
                  >
                    <WebhooksPage />
                  </FeatureGate>
                }
              />
              {/* Phase 7: Partner Display API keys — lets third-party screens/apps
              browse menu, order, self-pay and watch status live via a
              tenant-issued API key. Gated by the externalDisplay plan feature;
              direct URL hit on a tenant lacking it shows the UpsellCard. */}
              <Route
                path="partner-keys"
                element={
                  <FeatureGate
                    feature="externalDisplay"
                    fallback={<UpsellCard planName="BUSINESS" />}
                  >
                    <PartnerKeysPage />
                  </FeatureGate>
                }
              />
              <Route
                path="reservations"
                element={
                  <FeatureGate
                    feature="reservationSystem"
                    fallback={<UpsellCard planName="PRO" />}
                  >
                    <ReservationSettingsPage />
                  </FeatureGate>
                }
              />
              <Route
                path="shifts"
                element={
                  <FeatureGate
                    feature="personnelManagement"
                    fallback={<UpsellCard planName="PRO" />}
                  >
                    <ShiftTemplatesSettingsPage />
                  </FeatureGate>
                }
              />
              <Route
                path="schedule"
                element={
                  <FeatureGate
                    feature="personnelManagement"
                    fallback={<UpsellCard planName="PRO" />}
                  >
                    <ScheduleSettingsPage />
                  </FeatureGate>
                }
              />
              <Route
                path="sms"
                element={
                  <FeatureGate
                    integration={{ domain: "sms" }}
                    fallback={<UpsellCard />}
                  >
                    <SmsSettingsPage />
                  </FeatureGate>
                }
              />
              <Route
                path="online-orders"
                element={
                  <FeatureGate
                    feature="deliveryIntegration"
                    fallback={
                      <UpsellCard
                        addOnCode="delivery_yemeksepeti"
                        planName="PRO"
                      />
                    }
                  >
                    <DeliveryPlatformsSettingsPage />
                  </FeatureGate>
                }
              />
              {/* Cihaz yönetimi şube hub'ına taşındı (Şubeler → şube → sekmeler). */}
              <Route path="payment-terminals" element={<Navigate to="/admin/branches" replace />} />
              <Route
                path="accounting"
                element={
                  <Navigate to="/admin/finance?group=documents&tab=settings" replace />
                }
              />
            </Route>

            {/* Legacy redirects */}
            <Route
              path="/admin/pos-settings"
              element={<Navigate to="/admin/settings/pos" replace />}
            />
            {/* v3.1.6 — billing/subscription management folded into Plan & Erişim
            (/admin/plan); old links/bookmarks redirect there. */}
            <Route
              path="/subscription/manage"
              element={<Navigate to="/admin/plan" replace />}
            />

            {/* Subscription pages */}
            <Route
              path="/subscription/plans"
              element={<SubscriptionPlansPage />}
            />
            <Route
              path="/subscription/change-plan"
              element={<ChangePlanPage />}
            />
            <Route path="/subscription/checkout" element={<CheckoutPage />} />
            <Route
              path="/subscription/success"
              element={<PaymentResultPage outcome="success" />}
            />
            <Route
              path="/subscription/fail"
              element={<PaymentResultPage outcome="failed" />}
            />
            {/* Legacy redirect for old payment URLs */}
            <Route
              path="/subscription/payment"
              element={<Navigate to="/subscription/plans" replace />}
            />
            <Route
              path="/subscription/payment/success"
              element={<Navigate to="/subscription/success" replace />}
            />
            <Route
              path="/subscription/payment/failed"
              element={<Navigate to="/subscription/fail" replace />}
            />

            {/* HummyTummy Phase 3–12: marketplace, hardware store, branches, health.
            Devices + Bridges are now managed INSIDE the branch hub (per-branch),
            so the old flat pages redirect there. */}
            <Route
              path="/admin/devices"
              element={<Navigate to="/admin/branches" replace />}
            />
            <Route
              path="/admin/bridges"
              element={<Navigate to="/admin/branches" replace />}
            />
            {/* Consolidated "Mağaza" hub (add-ons + hardware + orders) reached from
            the top-bar store icon. The old flat routes redirect into its tabs. */}
            <Route path="/admin/store" element={<StoreHubPage />} />
            <Route
              path="/admin/marketplace"
              element={<Navigate to="/admin/store?tab=addons" replace />}
            />
            {/* v2.8.87: rich product/service detail page (real route, not modal). */}
            <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
            {/* v2.8.84: tenant order history + detail. List lives in the hub's
            Siparişlerim tab; the old list URL redirects, detail stays standalone. */}
            <Route
              path="/admin/hardware-orders"
              element={<Navigate to="/admin/store?tab=orders" replace />}
            />
            <Route
              path="/admin/hardware-orders/:id"
              element={<HardwareOrderDetailPage />}
            />
            {/* The branch hub is the device/network management home for EVERY
            tenant (single-location included), so it is NOT multiLocation-gated.
            Creating a 2nd branch is still server-gated (@RequiresFeature). */}
            <Route path="/admin/branches" element={<BranchesPage />} />
            <Route path="/admin/branches/:id" element={<BranchDetailPage />} />
            <Route path="/admin/health" element={<HealthPage />} />
            {/* v3.0.6: webhooks now lives under Settings (/admin/settings/webhooks).
            Redirect the old top-level URL so existing links keep working. */}
            <Route
              path="/admin/webhooks"
              element={<Navigate to="/admin/settings/webhooks" replace />}
            />
            <Route
              path="/admin/caller-feed"
              element={
                <FeatureGate
                  integration={{ domain: "caller" }}
                  fallback={<UpsellCard addOnCode="caller_id_integration" />}
                >
                  <CallerFeedPage />
                </FeatureGate>
              }
            />
            {/* v2.8.88: top-level Plan & Erişim page — plan + quota + active add-ons. */}
            <Route path="/admin/plan" element={<PlanAndAccessPage />} />
            {/* v3.0.6: Desktop app as a standalone sidebar destination (moved out of
            the Settings sub-tabs), mirroring Plan & Erişim. */}
            <Route path="/admin/desktop" element={<DesktopAppSettingsPage />} />
          </Route>

          {/* SuperAdmin Routes */}
          <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
          <Route path="/superadmin/2fa" element={<SuperAdmin2FAPage />} />
          <Route element={<SuperAdminProtectedRoute />}>
            <Route element={<SuperAdminLayout />}>
              <Route
                path="/superadmin"
                element={<Navigate to="/superadmin/dashboard" replace />}
              />
              <Route
                path="/superadmin/dashboard"
                element={<SuperAdminDashboardPage />}
              />
              <Route path="/superadmin/tenants" element={<TenantsPage />} />
              <Route
                path="/superadmin/tenants/:id"
                element={<TenantDetailPage />}
              />
              <Route path="/superadmin/users" element={<AllUsersPage />} />
              <Route path="/superadmin/plans" element={<PlansPage />} />
              <Route
                path="/superadmin/marketplace"
                element={<MarketplaceAdminPage />}
              />
              <Route
                path="/superadmin/subscriptions"
                element={<SubscriptionsPage />}
              />
              <Route
                path="/superadmin/bank-transfer"
                element={<BankTransferPage />}
              />
              <Route
                path="/superadmin/audit-logs"
                element={<AuditLogsPage />}
              />
              <Route
                path="/superadmin/settings"
                element={<SuperAdminSettingsPage />}
              />
            </Route>
          </Route>
          {/* Marketing panel routes removed — it is now a standalone app at
          marketing.hummytummy.com; nginx 301-redirects /marketing/* there. */}
        </Routes>
      </Suspense>

      {/* Update Dialog */}
      {showUpdateDialog && (
        <UpdateDialog
          available={updateState.available}
          version={updateState.version}
          currentVersion={updateState.currentVersion}
          downloading={updateState.downloading}
          error={updateState.error}
          onUpdate={handleUpdate}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}

export default App;
