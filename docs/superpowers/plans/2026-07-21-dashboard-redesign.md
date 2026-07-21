# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard` as a "command center" (KPIs → live ops → hourly chart + attention panel → top sellers + shortcuts → quota) per `docs/superpowers/specs/2026-07-21-dashboard-redesign-design.md`.

**Architecture:** Frontend-only. New widget components under `frontend/src/features/dashboard/`, each owning its own data hook, plan-gate wrapper, skeleton/error/empty states. `DashboardPage.tsx` becomes a thin role-aware composer. Two shared UI promotions: `ui/StatCard` (extracted from ReportsPage) and `ui/Skeleton`.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Tailwind 3.4, lucide-react, vitest + @testing-library/react, react-i18next.

## Global Constraints

- **Frontend-only.** No backend, no schema, no migration changes.
- **No new npm dependencies** (no chart library — charts are hand-rolled div bars).
- **Git:** conventional-commit messages; NEVER add any Claude/AI trailer or marker (hard user rule).
- **i18n:** every new key added to ALL FIVE locales: `frontend/src/i18n/locales/{tr,en,ar,ru,uz}/common.json`, inside the existing `"dashboard"` object. Verify with `node scripts/check-i18n-parity.mjs` from repo root.
- **Tour anchors preserved:** `data-tour="dashboard-container"` on the page root, `data-tour="quick-actions"` on the shortcuts grid.
- **Plan-gate pattern:** a wrapper component checks `useSubscription().hasFeature(...)` and returns `null`; only the inner component calls query hooks (rules of hooks; gated tenants must never fire 403ing queries).
- **Branch scoping is automatic:** all hooks already put `branchId` in query keys; the axios client injects `X-Branch-Id`. Never add manual branch headers.
- **All commands below run from `frontend/` unless stated.** Test: `npx vitest run <file>`; lint: `npm run lint`.
- Existing hooks consumed (exact signatures, do not modify except where a task says so):
  - `useSalesReport(params: {startDate: string; endDate: string})`, `useSalesComparison(params)`, `useTopProducts(params)`, `metricTrend(comparison, metric)` from `src/features/reports/reportsApi.ts`
  - `useOrdersByHour(date?: string)` → `{date, hourlyData: {hour, orderCount, totalSales}[]}` from `src/api/enhancedReportsApi.ts`
  - `useOrders(filters?, options?: {refetchInterval?, keepPreviousData?, enabled?})`, `usePendingOrders()`, `useWaiterRequests()`, `useBillRequests()` from `src/features/orders/ordersApi.ts`
  - `useTables()` → `Table[]` (`status: 'AVAILABLE'|'OCCUPIED'|'RESERVED'`) from `src/features/tables/tablesApi.ts`
  - `useReservationStats(date?: string)` → `{total, pending, confirmed, seated, completed, cancelled, noShow, rejected}` from `src/features/reservations/reservationsApi.ts`
  - `useLowStockItems()` → `any[]` (`{id, name, currentStock, minStock, unit}`) from `src/features/stock-management/stockManagementApi.ts`
  - `useActionableInsights()` → `Insight[]` (`severity: 'INFO'|'WARNING'|'CRITICAL'`, `title`) from `src/features/analytics/analyticsApi.ts`
  - `useGetUsageSnapshot()` → `{users, branches, tables, products, monthlyOrders: {current, max}; computedAt}` (`max === -1` = unlimited) from `src/features/plan/planApi.ts`
  - `useFormatCurrency()` → `(amount: number) => string` from `src/hooks/useFormatCurrency.ts`
  - `useSubscription()` → `{hasFeature(k: keyof PlanFeatures): boolean}` from `src/contexts/SubscriptionContext.tsx`
  - `useAuthStore((s) => s.user)` → `{firstName, lastName, role}` from `src/store/authStore.ts`

## File Structure

```
frontend/src/components/ui/Skeleton.tsx                      NEW  shared skeleton block
frontend/src/components/ui/Skeleton.test.tsx                 NEW
frontend/src/components/ui/StatCard.tsx                      NEW  shared KPI card (promoted from ReportsPage)
frontend/src/components/ui/StatCard.test.tsx                 NEW
frontend/src/pages/admin/ReportsPage.tsx                     MOD  swap local StatCard → shared
frontend/src/i18n/locales/{tr,en,ar,ru,uz}/common.json       MOD  new dashboard.* keys
frontend/src/features/dashboard/lib.ts                       NEW  todayRange, greetingKey, QUICK_ACTIONS
frontend/src/features/dashboard/lib.test.ts                  NEW
frontend/src/features/dashboard/components/WidgetStates.tsx  NEW  shared error/empty one-liners
frontend/src/features/dashboard/components/KpiRow.tsx        NEW  SalesKpis (gated) + OpenTablesKpi
frontend/src/features/dashboard/components/KpiRow.test.tsx   NEW
frontend/src/features/dashboard/components/OpsTiles.tsx      NEW  OpsGrid + 5 tiles
frontend/src/features/dashboard/components/OpsTiles.test.tsx NEW
frontend/src/features/dashboard/components/HourlySalesCard.tsx      NEW
frontend/src/features/dashboard/components/HourlySalesCard.test.tsx NEW
frontend/src/features/dashboard/components/AttentionCard.tsx        NEW
frontend/src/features/dashboard/components/AttentionCard.test.tsx   NEW
frontend/src/features/dashboard/components/TopProductsCard.tsx      NEW
frontend/src/features/dashboard/components/TopProductsCard.test.tsx NEW
frontend/src/features/dashboard/components/ShortcutsCard.tsx NEW  compact quick actions
frontend/src/features/dashboard/components/QuotaStrip.tsx    NEW  moved from DashboardPage
frontend/src/features/dashboard/components/HeroCard.tsx      NEW  WAITER/KITCHEN hero
frontend/src/pages/DashboardPage.tsx                         MOD  full rewrite: role-aware composer
frontend/src/pages/DashboardPage.spec.tsx                    NEW
frontend/index.html                                          MOD  load Outfit font
```

---

### Task 1: `ui/Skeleton` shared component

**Files:**
- Create: `frontend/src/components/ui/Skeleton.tsx`
- Test: `frontend/src/components/ui/Skeleton.test.tsx`

**Interfaces:**
- Produces: `Skeleton` React component, props `{ className?: string }`, default export + named. Renders a `div` with `data-testid="skeleton"`, classes `animate-shimmer bg-slate-100 rounded-md` merged with `className` via `cn`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ui/Skeleton.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from './Skeleton';

describe('Skeleton', () => {
  it('renders a shimmer block with merged classes', () => {
    render(<Skeleton className="h-8 w-24" />);
    const el = screen.getByTestId('skeleton');
    expect(el.className).toContain('animate-shimmer');
    expect(el.className).toContain('h-8');
  });

  it('is aria-hidden so screen readers skip placeholders', () => {
    render(<Skeleton />);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/Skeleton.test.tsx`
Expected: FAIL — cannot resolve `./Skeleton`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/components/ui/Skeleton.tsx
import { cn } from '../../lib/utils';

// Loading placeholder. Uses the existing .animate-shimmer utility from
// index.css; size it with h-*/w-* via className.
const Skeleton = ({ className }: { className?: string }) => (
  <div
    data-testid="skeleton"
    aria-hidden="true"
    className={cn('animate-shimmer bg-slate-100 rounded-md', className)}
  />
);

export { Skeleton };
export default Skeleton;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/Skeleton.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Skeleton.tsx frontend/src/components/ui/Skeleton.test.tsx
git commit -m "feat(ui): add shared Skeleton loading placeholder"
```

---

### Task 2: `ui/StatCard` shared component + ReportsPage swap

**Files:**
- Create: `frontend/src/components/ui/StatCard.tsx`
- Test: `frontend/src/components/ui/StatCard.test.tsx`
- Modify: `frontend/src/pages/admin/ReportsPage.tsx:122-158` (delete local StatCard, import shared; update 4 call sites ~lines 230-256 to pass `trendLabel`)

**Interfaces:**
- Produces: `StatCard` component:
  ```tsx
  interface StatCardProps {
    title: string;
    value: string | number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;            // tailwind bg class for the icon circle, e.g. "bg-green-500"
    trend?: { value: number; isPositive: boolean };
    trendLabel?: string;      // e.g. t('dashboard.vsYesterday') — rendered after the trend %
    isLoading?: boolean;      // renders a Skeleton in place of the value
  }
  ```
  Value uses `text-2xl font-bold tabular-nums`. Trend text: `{↑|↓} %{value} {trendLabel}` in green-600/red-600 (matches the existing ReportsPage markup so its i18n strings render identically).
- Consumes: `Skeleton` from Task 1, `Card`/`CardContent` from `src/components/ui/Card.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ui/StatCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banknote } from 'lucide-react';
import StatCard from './StatCard';

describe('StatCard', () => {
  it('renders title, value and positive trend with label', () => {
    render(
      <StatCard
        title="Bugünkü Ciro"
        value="₺12.450"
        icon={Banknote}
        color="bg-green-500"
        trend={{ value: 8, isPositive: true }}
        trendLabel="düne göre"
      />,
    );
    expect(screen.getByText('Bugünkü Ciro')).toBeInTheDocument();
    expect(screen.getByText('₺12.450')).toBeInTheDocument();
    expect(screen.getByText(/↑ %8 düne göre/)).toBeInTheDocument();
  });

  it('renders a negative trend in red', () => {
    render(
      <StatCard
        title="t"
        value={5}
        icon={Banknote}
        color="bg-blue-500"
        trend={{ value: 3, isPositive: false }}
        trendLabel="vs"
      />,
    );
    expect(screen.getByText(/↓ %3 vs/).className).toContain('text-red-600');
  });

  it('shows a skeleton instead of the value while loading', () => {
    render(<StatCard title="t" value="" icon={Banknote} color="bg-blue-500" isLoading />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/StatCard.test.tsx`
Expected: FAIL — cannot resolve `./StatCard`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/components/ui/StatCard.tsx
import React from 'react';
import { Card, CardContent } from './Card';
import Skeleton from './Skeleton';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  trend?: { value: number; isPositive: boolean };
  trendLabel?: string;
  isLoading?: boolean;
}

// Shared KPI stat card (promoted from ReportsPage's page-local version so the
// dashboard and reports render identical stat tiles).
const StatCard = ({ title, value, icon: Icon, color, trend, trendLabel, isLoading }: StatCardProps) => (
  <Card>
    <CardContent className="pt-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-500 mb-1 truncate">{title}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          )}
          {!isLoading && trend && (
            <p className={`text-xs mt-1 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.isPositive ? '↑' : '↓'} %{trend.value}
              {trendLabel ? ` ${trendLabel}` : ''}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-full shrink-0 ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </CardContent>
  </Card>
);

export { StatCard };
export default StatCard;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/StatCard.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Swap ReportsPage to the shared component**

In `frontend/src/pages/admin/ReportsPage.tsx`:
1. Delete the whole local `const StatCard = ({ ... }) => (...)` block (lines 122-158).
2. Add import near the other ui imports: `import StatCard from '../../components/ui/StatCard';`
3. The local version hardcoded `t('reports.vsPreviousPeriod')` inside the trend; the shared one takes `trendLabel`. Add `trendLabel={t('reports.vsPreviousPeriod')}` to the three call sites that pass `trend` (totalSales, totalOrders, averageOrderValue — around lines 230-249). The fourth call site (no trend) needs no change.

- [ ] **Step 6: Run the ReportsPage-related tests + lint**

Run: `npx vitest run src/pages/admin && npm run lint`
Expected: all existing tests pass, lint clean (prettier gate: no unformatted new files).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/StatCard.tsx frontend/src/components/ui/StatCard.test.tsx frontend/src/pages/admin/ReportsPage.tsx
git commit -m "feat(ui): promote StatCard to shared component, swap ReportsPage to it"
```

---

### Task 3: i18n keys for the new dashboard (all 5 locales)

**Files:**
- Modify: `frontend/src/i18n/locales/tr/common.json`, `.../en/common.json`, `.../ar/common.json`, `.../ru/common.json`, `.../uz/common.json` — add keys INSIDE the existing `"dashboard"` object of each file. Do not remove existing keys.

**Interfaces:**
- Produces: the exact key set below, consumed by Tasks 4-11 as `t('dashboard.<key>')` (namespace `common`).
- Reused existing keys (already present, do NOT re-add): `todaysSales`, `todaysOrders`, `vsYesterday`, `pending`, `preparing`, `ready`, `viewAll`, `kpiError`, `quotaUsers`, `quotaBranches`, `quotaProducts`, `quotaMonthlyOrders`, `posDescription`, `kitchenDescription`, `menuDescription`, `tablesDescription`, `customersDescription`, `qrCodesDescription`, `reportsDescription`, `settingsDescription`, `welcomeBack`.

- [ ] **Step 1: Add the keys**

Turkish (`tr/common.json`, inside `"dashboard": {`):

```json
"greetingMorning": "Günaydın",
"greetingAfternoon": "İyi günler",
"greetingEvening": "İyi akşamlar",
"avgBasket": "Ort. Sepet",
"openTables": "Açık Masa",
"kitchenQueue": "Mutfak Kuyruğu",
"pendingApproval": "Onay Bekleyen",
"calls": "Çağrılar",
"callsHint": "{{waiter}} garson · {{bill}} hesap",
"reservationsToday": "Bugünkü Rezervasyonlar",
"reservationsHint": "{{confirmed}} onaylı · {{pending}} bekliyor",
"hourlySales": "Saatlik Satış",
"attention": "Dikkat",
"lowStock": "Düşük Stok",
"insightsTitle": "İçgörüler",
"topProductsToday": "Bugünün En Çok Satanları",
"shortcuts": "Kısayollar",
"noSalesYet": "Bugün henüz satış yok",
"allClear": "Her şey yolunda",
"widgetError": "Veri yüklenemedi",
"detailedReport": "Detaylı rapor",
"teamDescription": "Ekip ve vardiya yönetimi",
"profileTitle": "Profil",
"profileDescription": "Hesap bilgilerini görüntüle",
"helpTitle": "Yardım",
"helpDescription": "Kullanım kılavuzu ve destek",
"qtySold": "{{count}} adet"
```

English (`en/common.json`):

```json
"greetingMorning": "Good morning",
"greetingAfternoon": "Good afternoon",
"greetingEvening": "Good evening",
"avgBasket": "Avg. Basket",
"openTables": "Open Tables",
"kitchenQueue": "Kitchen Queue",
"pendingApproval": "Awaiting Approval",
"calls": "Calls",
"callsHint": "{{waiter}} waiter · {{bill}} bill",
"reservationsToday": "Today's Reservations",
"reservationsHint": "{{confirmed}} confirmed · {{pending}} pending",
"hourlySales": "Hourly Sales",
"attention": "Needs Attention",
"lowStock": "Low Stock",
"insightsTitle": "Insights",
"topProductsToday": "Today's Top Sellers",
"shortcuts": "Shortcuts",
"noSalesYet": "No sales yet today",
"allClear": "All clear",
"widgetError": "Couldn't load data",
"detailedReport": "Detailed report",
"teamDescription": "Team & shift management",
"profileTitle": "Profile",
"profileDescription": "View your account",
"helpTitle": "Help",
"helpDescription": "Guides and support",
"qtySold": "{{count}} sold"
```

Arabic (`ar/common.json`):

```json
"greetingMorning": "صباح الخير",
"greetingAfternoon": "طاب يومك",
"greetingEvening": "مساء الخير",
"avgBasket": "متوسط السلة",
"openTables": "الطاولات المفتوحة",
"kitchenQueue": "طابور المطبخ",
"pendingApproval": "بانتظار الموافقة",
"calls": "النداءات",
"callsHint": "{{waiter}} نادل · {{bill}} حساب",
"reservationsToday": "حجوزات اليوم",
"reservationsHint": "{{confirmed}} مؤكد · {{pending}} قيد الانتظار",
"hourlySales": "المبيعات بالساعة",
"attention": "يتطلب الانتباه",
"lowStock": "مخزون منخفض",
"insightsTitle": "الرؤى",
"topProductsToday": "الأكثر مبيعًا اليوم",
"shortcuts": "اختصارات",
"noSalesYet": "لا مبيعات اليوم بعد",
"allClear": "كل شيء على ما يرام",
"widgetError": "تعذر تحميل البيانات",
"detailedReport": "تقرير مفصل",
"teamDescription": "إدارة الفريق والمناوبات",
"profileTitle": "الملف الشخصي",
"profileDescription": "عرض معلومات حسابك",
"helpTitle": "المساعدة",
"helpDescription": "الأدلة والدعم",
"qtySold": "{{count}} قطعة"
```

Russian (`ru/common.json`):

```json
"greetingMorning": "Доброе утро",
"greetingAfternoon": "Добрый день",
"greetingEvening": "Добрый вечер",
"avgBasket": "Средний чек",
"openTables": "Открытые столы",
"kitchenQueue": "Очередь кухни",
"pendingApproval": "Ждут одобрения",
"calls": "Вызовы",
"callsHint": "{{waiter}} официант · {{bill}} счёт",
"reservationsToday": "Брони на сегодня",
"reservationsHint": "{{confirmed}} подтверждено · {{pending}} в ожидании",
"hourlySales": "Продажи по часам",
"attention": "Требует внимания",
"lowStock": "Низкий запас",
"insightsTitle": "Инсайты",
"topProductsToday": "Хиты продаж сегодня",
"shortcuts": "Ярлыки",
"noSalesYet": "Сегодня продаж пока нет",
"allClear": "Всё в порядке",
"widgetError": "Не удалось загрузить данные",
"detailedReport": "Подробный отчёт",
"teamDescription": "Команда и смены",
"profileTitle": "Профиль",
"profileDescription": "Просмотр вашего аккаунта",
"helpTitle": "Помощь",
"helpDescription": "Руководства и поддержка",
"qtySold": "{{count}} шт."
```

Uzbek (`uz/common.json`):

```json
"greetingMorning": "Xayrli tong",
"greetingAfternoon": "Xayrli kun",
"greetingEvening": "Xayrli kech",
"avgBasket": "O'rtacha savat",
"openTables": "Ochiq stollar",
"kitchenQueue": "Oshxona navbati",
"pendingApproval": "Tasdiq kutmoqda",
"calls": "Chaqiruvlar",
"callsHint": "{{waiter}} ofitsiant · {{bill}} hisob",
"reservationsToday": "Bugungi bronlar",
"reservationsHint": "{{confirmed}} tasdiqlangan · {{pending}} kutilmoqda",
"hourlySales": "Soatlik savdo",
"attention": "E'tibor talab qiladi",
"lowStock": "Kam zaxira",
"insightsTitle": "Tahlillar",
"topProductsToday": "Bugungi eng ko'p sotilganlar",
"shortcuts": "Yorliqlar",
"noSalesYet": "Bugun hali savdo yo'q",
"allClear": "Hammasi joyida",
"widgetError": "Ma'lumot yuklanmadi",
"detailedReport": "Batafsil hisobot",
"teamDescription": "Jamoa va smenalar boshqaruvi",
"profileTitle": "Profil",
"profileDescription": "Hisob ma'lumotlarini ko'rish",
"helpTitle": "Yordam",
"helpDescription": "Qo'llanmalar va yordam",
"qtySold": "{{count}} dona"
```

- [ ] **Step 2: Verify parity**

Run from repo root: `node scripts/check-i18n-parity.mjs`
Expected: exit 0 / no missing-key report for common.json.

- [ ] **Step 3: Verify JSON validity**

Run from repo root: `for l in tr en ar ru uz; do python3 -m json.tool frontend/src/i18n/locales/$l/common.json > /dev/null && echo "$l OK"; done`
Expected: five `OK` lines.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/locales/*/common.json
git commit -m "feat(i18n): add dashboard command-center keys to all locales"
```

---

### Task 4: dashboard lib — `todayRange`, `greetingKey`, `QUICK_ACTIONS`

**Files:**
- Create: `frontend/src/features/dashboard/lib.ts`
- Test: `frontend/src/features/dashboard/lib.test.ts`

**Interfaces:**
- Produces:
  - `todayRange(now?: Date): { startDate: string; endDate: string }` — `[today, tomorrow)` as `yyyy-MM-dd` strings (mirrors the window the old TodayKpiStrip used, so "previous" in `/reports/sales-comparison` is exactly yesterday).
  - `greetingKey(now?: Date): 'dashboard.greetingMorning' | 'dashboard.greetingAfternoon' | 'dashboard.greetingEvening'` — hours 5-11 morning, 12-17 afternoon, else evening.
  - `QUICK_ACTIONS: QuickAction[]` where `QuickAction = { to: string; icon: LucideIcon; label: string; description: string; roles: UserRole[]; isPrimary?: boolean }` — the role-filtered shortcut definitions moved out of DashboardPage, with the stale links fixed (`/admin/team` + `navigation.team`, `/admin/settings` + `navigation.settings`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/features/dashboard/lib.test.ts
import { describe, it, expect } from 'vitest';
import { todayRange, greetingKey, QUICK_ACTIONS } from './lib';

describe('todayRange', () => {
  it('returns [today, tomorrow) as yyyy-MM-dd', () => {
    const r = todayRange(new Date(2026, 6, 21, 15, 30)); // 21 Jul 2026
    expect(r).toEqual({ startDate: '2026-07-21', endDate: '2026-07-22' });
  });

  it('crosses month boundaries correctly', () => {
    const r = todayRange(new Date(2026, 6, 31));
    expect(r.endDate).toBe('2026-08-01');
  });
});

describe('greetingKey', () => {
  it.each([
    [6, 'dashboard.greetingMorning'],
    [11, 'dashboard.greetingMorning'],
    [12, 'dashboard.greetingAfternoon'],
    [17, 'dashboard.greetingAfternoon'],
    [18, 'dashboard.greetingEvening'],
    [23, 'dashboard.greetingEvening'],
    [3, 'dashboard.greetingEvening'],
  ])('hour %i → %s', (hour, key) => {
    expect(greetingKey(new Date(2026, 6, 21, hour))).toBe(key);
  });
});

describe('QUICK_ACTIONS', () => {
  it('uses consolidated routes (no stale deeplinks)', () => {
    const targets = QUICK_ACTIONS.map((a) => a.to);
    expect(targets).toContain('/admin/team');
    expect(targets).toContain('/admin/settings');
    expect(targets).not.toContain('/admin/users');
    expect(targets).not.toContain('/admin/settings/subscription');
  });

  it('marks POS as the single primary action', () => {
    expect(QUICK_ACTIONS.filter((a) => a.isPrimary).map((a) => a.to)).toEqual(['/pos']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/lib.test.ts`
Expected: FAIL — cannot resolve `./lib`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/features/dashboard/lib.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/lib.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/lib.ts frontend/src/features/dashboard/lib.test.ts
git commit -m "feat(dashboard): add date-range/greeting helpers and quick-action defs"
```

---

### Task 5: shared widget states + KPI row

**Files:**
- Create: `frontend/src/features/dashboard/components/WidgetStates.tsx`
- Create: `frontend/src/features/dashboard/components/KpiRow.tsx`
- Test: `frontend/src/features/dashboard/components/KpiRow.test.tsx`

**Interfaces:**
- Produces (WidgetStates): `WidgetError` (`{}` props — muted one-line `t('dashboard.widgetError')`, `data-testid="widget-error"`), `WidgetEmpty` (`{ text: string }` — muted one-liner, `data-testid="widget-empty"`).
- Produces (KpiRow): `SalesKpis` (gated `advancedReports`; renders 3 `StatCard`s: today's sales, orders, avg basket, each with vs-yesterday trend) and `OpenTablesKpi` (ungated; `StatCard` value `"{occupied}/{total}"`). Both render as grid ITEMS (no own grid wrapper) — the page places them inside `grid grid-cols-2 lg:grid-cols-4 gap-4`.
- Consumes: `StatCard` (Task 2), `todayRange` (Task 4), `useSalesReport`/`useSalesComparison`/`metricTrend`, `useTables`, `useSubscription`, `useFormatCurrency`, `useTranslation('common')`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/dashboard/components/KpiRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SalesKpis, OpenTablesKpi } from './KpiRow';

vi.mock('../../reports/reportsApi', () => ({
  useSalesReport: () => globalThis.__sales,
  useSalesComparison: () => globalThis.__comparison,
  metricTrend: (_c: unknown, metric: string) =>
    metric === 'totalSales' ? { value: 8, isPositive: true } : undefined,
}));
vi.mock('../../tables/tablesApi', () => ({
  useTables: () => globalThis.__tables,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

declare global {
  /* eslint-disable no-var */
  var __sales: any;
  var __comparison: any;
  var __tables: any;
  var __features: string[];
  /* eslint-enable no-var */
}

describe('SalesKpis', () => {
  it('renders nothing without advancedReports (gate wrapper)', () => {
    globalThis.__features = [];
    globalThis.__sales = { data: undefined, isLoading: false, isError: false };
    globalThis.__comparison = { data: undefined };
    const { container } = render(<SalesKpis />);
    expect(container.firstChild).toBeNull();
  });

  it('renders sales, orders and avg basket with trend when entitled', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__sales = {
      data: { totalSales: 12450, totalOrders: 86, averageOrderValue: 145 },
      isLoading: false,
      isError: false,
    };
    globalThis.__comparison = { data: {} };
    render(<SalesKpis />);
    expect(screen.getByText('₺12450')).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('₺145')).toBeInTheDocument();
    expect(screen.getByText(/↑ %8/)).toBeInTheDocument();
  });
});

describe('OpenTablesKpi', () => {
  it('shows occupied/total from useTables', () => {
    globalThis.__features = [];
    globalThis.__tables = {
      data: [{ status: 'OCCUPIED' }, { status: 'OCCUPIED' }, { status: 'AVAILABLE' }],
      isLoading: false,
      isError: false,
    };
    render(<OpenTablesKpi />);
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('renders nothing on error (fails soft, page stays intact)', () => {
    globalThis.__tables = { data: undefined, isLoading: false, isError: true };
    const { container } = render(<OpenTablesKpi />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/KpiRow.test.tsx`
Expected: FAIL — cannot resolve `./KpiRow`.

- [ ] **Step 3: Write WidgetStates**

```tsx
// frontend/src/features/dashboard/components/WidgetStates.tsx
import { useTranslation } from 'react-i18next';

// Per-widget soft failure: one muted line inside the card, never a page break.
export const WidgetError = () => {
  const { t } = useTranslation('common');
  return (
    <p data-testid="widget-error" className="text-xs text-slate-400 py-2">
      {t('dashboard.widgetError')}
    </p>
  );
};

export const WidgetEmpty = ({ text }: { text: string }) => (
  <p data-testid="widget-empty" className="text-sm text-slate-400 py-2">
    {text}
  </p>
);
```

- [ ] **Step 4: Write KpiRow**

```tsx
// frontend/src/features/dashboard/components/KpiRow.tsx
import { useTranslation } from 'react-i18next';
import { Banknote, Receipt, ShoppingBag, Table as TableIcon } from 'lucide-react';
import StatCard from '../../../components/ui/StatCard';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useSalesReport, useSalesComparison, metricTrend } from '../../reports/reportsApi';
import { useTables } from '../../tables/tablesApi';
import { todayRange } from '../lib';

// Gate wrapper: tenants without advancedReports must never fire the /reports
// queries (they would 403). Inner component calls hooks unconditionally.
export function SalesKpis() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('advancedReports')) return null;
  return <SalesKpisInner />;
}

function SalesKpisInner() {
  const { t } = useTranslation('common');
  const formatCurrency = useFormatCurrency();
  const range = todayRange();
  const { data: sales, isLoading, isError } = useSalesReport(range);
  const { data: comparison } = useSalesComparison(range);

  if (isError) return null; // KPI row fails soft; ops tiles still tell the story

  return (
    <>
      <StatCard
        title={t('dashboard.todaysSales')}
        value={formatCurrency(sales?.totalSales ?? 0)}
        icon={Banknote}
        color="bg-green-500"
        trend={metricTrend(comparison, 'totalSales')}
        trendLabel={t('dashboard.vsYesterday')}
        isLoading={isLoading}
      />
      <StatCard
        title={t('dashboard.todaysOrders')}
        value={String(sales?.totalOrders ?? 0)}
        icon={Receipt}
        color="bg-blue-500"
        trend={metricTrend(comparison, 'totalOrders')}
        trendLabel={t('dashboard.vsYesterday')}
        isLoading={isLoading}
      />
      <StatCard
        title={t('dashboard.avgBasket')}
        value={formatCurrency(sales?.averageOrderValue ?? 0)}
        icon={ShoppingBag}
        color="bg-purple-500"
        trend={metricTrend(comparison, 'averageOrderValue')}
        trendLabel={t('dashboard.vsYesterday')}
        isLoading={isLoading}
      />
    </>
  );
}

export function OpenTablesKpi() {
  const { t } = useTranslation('common');
  const { data: tables, isLoading, isError } = useTables();

  if (isError) return null;
  const occupied = (tables ?? []).filter((tb) => tb.status === 'OCCUPIED').length;
  const total = (tables ?? []).length;

  return (
    <StatCard
      title={t('dashboard.openTables')}
      value={`${occupied}/${total}`}
      icon={TableIcon}
      color="bg-orange-500"
      isLoading={isLoading}
    />
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/KpiRow.test.tsx`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/dashboard/components/WidgetStates.tsx frontend/src/features/dashboard/components/KpiRow.tsx frontend/src/features/dashboard/components/KpiRow.test.tsx
git commit -m "feat(dashboard): add KPI row widgets (sales gated, open tables ungated)"
```

---

### Task 6: live ops tiles

**Files:**
- Create: `frontend/src/features/dashboard/components/OpsTiles.tsx`
- Test: `frontend/src/features/dashboard/components/OpsTiles.test.tsx`

**Interfaces:**
- Produces: `OpsTile` (presentational: `{ to, icon, label, primaryText, hint?, tone?: 'default'|'alert', isLoading? }` — compact clickable Card-styled `Link`, `data-testid="ops-tile"`), plus data tiles: `KitchenQueueTile` (30s poll, per-status counts, link `/kitchen`), `ApprovalsTile` (link `/pos`, alert tone when count > 0), `CallsTile` (waiter+bill combined, link `/pos`, alert tone when > 0), `ReservationsTile` (gated `reservationSystem`, link `/admin/reservations`). Each returns `null` on its query error.
- Consumes: `useOrders` (with `{refetchInterval: 30_000}`), `usePendingOrders`, `useWaiterRequests`, `useBillRequests`, `useReservationStats`, `todayRange` (Task 4 — `startDate` used as today's date), `Skeleton`, `useSubscription`, `useTranslation('common')`.
- NOTE: `usePendingOrders`/`useWaiterRequests`/`useBillRequests` have no options param — do NOT modify them; their socket-invalidated caches plus mount/focus refetch are fresh enough for a dashboard tile. Only the kitchen-queue `useOrders` call polls (it accepts options).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/dashboard/components/OpsTiles.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KitchenQueueTile, ApprovalsTile, CallsTile, ReservationsTile } from './OpsTiles';

vi.mock('../../orders/ordersApi', () => ({
  useOrders: (...args: unknown[]) => {
    globalThis.__useOrdersArgs = args;
    return globalThis.__orders;
  },
  usePendingOrders: () => globalThis.__pending,
  useWaiterRequests: () => globalThis.__waiterReqs,
  useBillRequests: () => globalThis.__billReqs,
}));
vi.mock('../../reservations/reservationsApi', () => ({
  useReservationStats: () => globalThis.__resStats,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && ('waiter' in opts || 'confirmed' in opts)
        ? `${k}:${JSON.stringify(opts)}`
        : k,
  }),
}));

declare global {
  /* eslint-disable no-var */
  var __orders: any;
  var __useOrdersArgs: any;
  var __pending: any;
  var __waiterReqs: any;
  var __billReqs: any;
  var __resStats: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const renderIn = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('KitchenQueueTile', () => {
  it('shows per-status counts and polls every 30s', () => {
    globalThis.__orders = {
      data: [{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'PREPARING' }, { status: 'READY' }],
      isLoading: false,
      isError: false,
    };
    renderIn(<KitchenQueueTile />);
    expect(screen.getByText('4')).toBeInTheDocument(); // total in queue
    expect(screen.getByText(/2 dashboard\.pending/)).toBeInTheDocument();
    expect(globalThis.__useOrdersArgs[0]).toEqual({ status: 'PENDING,PREPARING,READY' });
    expect(globalThis.__useOrdersArgs[1]).toMatchObject({ refetchInterval: 30_000 });
    expect(screen.getByTestId('ops-tile')).toHaveAttribute('href', '/kitchen');
  });

  it('renders nothing on error', () => {
    globalThis.__orders = { data: undefined, isLoading: false, isError: true };
    const { container } = renderIn(<KitchenQueueTile />);
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });
});

describe('ApprovalsTile', () => {
  it('links to /pos and uses alert tone when approvals wait', () => {
    globalThis.__pending = { data: [{ id: 'o1' }], isLoading: false, isError: false };
    renderIn(<ApprovalsTile />);
    const tile = screen.getByTestId('ops-tile');
    expect(tile).toHaveAttribute('href', '/pos');
    expect(tile.className).toContain('border-amber-300');
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('CallsTile', () => {
  it('sums waiter and bill requests', () => {
    globalThis.__waiterReqs = { data: [{ id: 'w1' }], isLoading: false, isError: false };
    globalThis.__billReqs = { data: [{ id: 'b1' }, { id: 'b2' }], isLoading: false, isError: false };
    renderIn(<CallsTile />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/"waiter":1/)).toBeInTheDocument();
    expect(screen.getByText(/"bill":2/)).toBeInTheDocument();
  });
});

describe('ReservationsTile', () => {
  it('renders nothing without the reservationSystem feature', () => {
    globalThis.__features = [];
    const { container } = renderIn(<ReservationsTile />);
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('shows confirmed+pending when entitled', () => {
    globalThis.__features = ['reservationSystem'];
    globalThis.__resStats = {
      data: { total: 6, pending: 2, confirmed: 4, seated: 0, completed: 0, cancelled: 0, noShow: 0, rejected: 0 },
      isLoading: false,
      isError: false,
    };
    renderIn(<ReservationsTile />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/"confirmed":4/)).toBeInTheDocument();
    expect(screen.getByTestId('ops-tile')).toHaveAttribute('href', '/admin/reservations');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/OpsTiles.test.tsx`
Expected: FAIL — cannot resolve `./OpsTiles`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/features/dashboard/components/OpsTiles.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LucideIcon, ChefHat, CheckCircle2, Bell, CalendarClock } from 'lucide-react';
import { cn } from '../../../lib/utils';
import Skeleton from '../../../components/ui/Skeleton';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useOrders, usePendingOrders, useWaiterRequests, useBillRequests } from '../../orders/ordersApi';
import { useReservationStats } from '../../reservations/reservationsApi';
import { todayRange } from '../lib';

// Live ops tiles refresh policy: the kitchen queue polls (useOrders supports
// options); approvals/calls ride their socket-invalidated caches + mount/focus
// refetch. All tiles fail soft (null) so one bad rail never breaks the page.
const OPS_POLL_MS = 30_000;

interface OpsTileProps {
  to: string;
  icon: LucideIcon;
  label: string;
  primaryText: string;
  hint?: string;
  tone?: 'default' | 'alert';
  isLoading?: boolean;
}

export const OpsTile = ({ to, icon: Icon, label, primaryText, hint, tone = 'default', isLoading }: OpsTileProps) => (
  <Link
    to={to}
    data-testid="ops-tile"
    className={cn(
      'group flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md',
      tone === 'alert' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200/60 hover:border-slate-300',
    )}
  >
    <div
      className={cn(
        'p-2 rounded-lg shrink-0 transition-colors',
        tone === 'alert' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200',
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 truncate">{label}</div>
      {isLoading ? (
        <Skeleton className="h-6 w-10 mt-0.5" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums text-slate-900">{primaryText}</span>
          {hint && <span className="text-xs text-slate-500 truncate">{hint}</span>}
        </div>
      )}
    </div>
  </Link>
);

export function KitchenQueueTile() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = useOrders(
    { status: 'PENDING,PREPARING,READY' },
    { refetchInterval: OPS_POLL_MS, keepPreviousData: true },
  );
  if (isError) return null;
  const orders = data ?? [];
  const count = (s: string) => orders.filter((o) => o.status === s).length;
  return (
    <OpsTile
      to="/kitchen"
      icon={ChefHat}
      label={t('dashboard.kitchenQueue')}
      primaryText={String(orders.length)}
      hint={`${count('PENDING')} ${t('dashboard.pending')} · ${count('PREPARING')} ${t('dashboard.preparing')} · ${count('READY')} ${t('dashboard.ready')}`}
      isLoading={isLoading}
    />
  );
}

export function ApprovalsTile() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = usePendingOrders();
  if (isError) return null;
  const n = (data ?? []).length;
  return (
    <OpsTile
      to="/pos"
      icon={CheckCircle2}
      label={t('dashboard.pendingApproval')}
      primaryText={String(n)}
      tone={n > 0 ? 'alert' : 'default'}
      isLoading={isLoading}
    />
  );
}

export function CallsTile() {
  const { t } = useTranslation('common');
  const waiter = useWaiterRequests();
  const bill = useBillRequests();
  if (waiter.isError && bill.isError) return null;
  const w = (waiter.data ?? []).length;
  const b = (bill.data ?? []).length;
  const n = w + b;
  return (
    <OpsTile
      to="/pos"
      icon={Bell}
      label={t('dashboard.calls')}
      primaryText={String(n)}
      hint={t('dashboard.callsHint', { waiter: w, bill: b })}
      tone={n > 0 ? 'alert' : 'default'}
      isLoading={waiter.isLoading || bill.isLoading}
    />
  );
}

// Gate wrapper: /reservations 403s without the reservationSystem feature.
export function ReservationsTile() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('reservationSystem')) return null;
  return <ReservationsTileInner />;
}

function ReservationsTileInner() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = useReservationStats(todayRange().startDate);
  if (isError) return null;
  return (
    <OpsTile
      to="/admin/reservations"
      icon={CalendarClock}
      label={t('dashboard.reservationsToday')}
      primaryText={String(data?.total ?? 0)}
      hint={t('dashboard.reservationsHint', {
        confirmed: data?.confirmed ?? 0,
        pending: data?.pending ?? 0,
      })}
      isLoading={isLoading}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/OpsTiles.test.tsx`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/components/OpsTiles.tsx frontend/src/features/dashboard/components/OpsTiles.test.tsx
git commit -m "feat(dashboard): add live ops tiles (kitchen, approvals, calls, reservations)"
```

---

### Task 7: hourly sales chart card

**Files:**
- Create: `frontend/src/features/dashboard/components/HourlySalesCard.tsx`
- Test: `frontend/src/features/dashboard/components/HourlySalesCard.test.tsx`

**Interfaces:**
- Produces: `HourlySalesCard` — gated `advancedReports` (wrapper + inner). Card with title `t('dashboard.hourlySales')`, hand-rolled vertical bar chart from `useOrdersByHour(todayRange().startDate)`, and a footer link `t('dashboard.detailedReport')` → `/admin/reports`. Windowing: bars span first→last hour having `orderCount > 0`, extended to include the current hour, min 6-hour span; all-zero data → `WidgetEmpty` with `t('dashboard.noSalesYet')`. Current-hour bar `bg-primary-500`, others `bg-primary-200`; bar height % of max `totalSales`; each bar wrapped in a container with `title="{hour}:00 · {orders} · {revenue}"`.
- Consumes: `useOrdersByHour`, `todayRange`, `useFormatCurrency`, `Card/CardHeader/CardTitle/CardContent`, `Skeleton`, `WidgetError`, `WidgetEmpty`, `useSubscription`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/dashboard/components/HourlySalesCard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HourlySalesCard from './HourlySalesCard';

vi.mock('../../../api/enhancedReportsApi', () => ({
  useOrdersByHour: () => globalThis.__hourly,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

declare global {
  /* eslint-disable no-var */
  var __hourly: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const hourly = (overrides: Record<number, { orderCount: number; totalSales: number }>) => ({
  date: '2026-07-21',
  hourlyData: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orderCount: overrides[hour]?.orderCount ?? 0,
    totalSales: overrides[hour]?.totalSales ?? 0,
  })),
});

const renderCard = () =>
  render(
    <MemoryRouter>
      <HourlySalesCard />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 21, 15, 0, 0)); // 15:00
});
afterEach(() => vi.useRealTimers());

describe('HourlySalesCard', () => {
  it('renders nothing without advancedReports', () => {
    globalThis.__features = [];
    const { container } = renderCard();
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('renders bars only for the active window (first data hour → current hour)', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = {
      data: hourly({ 9: { orderCount: 3, totalSales: 450 }, 12: { orderCount: 8, totalSales: 1200 } }),
      isLoading: false,
      isError: false,
    };
    renderCard();
    const bars = screen.getAllByTestId('hour-bar');
    // window 9..15 inclusive = 7 bars
    expect(bars).toHaveLength(7);
    expect(bars[3]).toHaveAttribute('title', expect.stringContaining('₺1200'));
  });

  it('shows the empty state when the day has no sales', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = { data: hourly({}), isLoading: false, isError: false };
    renderCard();
    expect(screen.getByTestId('widget-empty')).toHaveTextContent('dashboard.noSalesYet');
  });

  it('shows the soft error line on failure', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = { data: undefined, isLoading: false, isError: true };
    renderCard();
    expect(screen.getByTestId('widget-error')).toBeInTheDocument();
  });

  it('links to the detailed report', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = { data: hourly({ 12: { orderCount: 1, totalSales: 100 } }), isLoading: false, isError: false };
    renderCard();
    expect(screen.getByRole('link', { name: /dashboard\.detailedReport/ })).toHaveAttribute('href', '/admin/reports');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/HourlySalesCard.test.tsx`
Expected: FAIL — cannot resolve `./HourlySalesCard`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/features/dashboard/components/HourlySalesCard.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Skeleton from '../../../components/ui/Skeleton';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useOrdersByHour } from '../../../api/enhancedReportsApi';
import { todayRange } from '../lib';
import { WidgetError, WidgetEmpty } from './WidgetStates';

const MIN_SPAN = 6;

export default function HourlySalesCard() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('advancedReports')) return null;
  return <HourlySalesCardInner />;
}

function HourlySalesCardInner() {
  const { t } = useTranslation('common');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, isError } = useOrdersByHour(todayRange().startDate);

  const hours = data?.hourlyData ?? [];
  const active = hours.filter((h) => h.orderCount > 0);
  const nowHour = new Date().getHours();

  // Window: first hour with data → max(last hour with data, current hour),
  // padded to a minimum span so a single busy hour doesn't render one lonely bar.
  let windowed: typeof hours = [];
  if (active.length > 0) {
    const first = active[0].hour;
    let last = Math.max(active[active.length - 1].hour, nowHour);
    if (last - first + 1 < MIN_SPAN) last = Math.min(23, first + MIN_SPAN - 1);
    windowed = hours.filter((h) => h.hour >= first && h.hour <= last);
  }
  const maxSales = Math.max(1, ...windowed.map((h) => h.totalSales));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('dashboard.hourlySales')}</CardTitle>
        <Link
          to="/admin/reports"
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
        >
          {t('dashboard.detailedReport')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {isError ? (
          <WidgetError />
        ) : isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : windowed.length === 0 ? (
          <WidgetEmpty text={t('dashboard.noSalesYet')} />
        ) : (
          <div className="flex items-end gap-1.5 h-40" role="img" aria-label={t('dashboard.hourlySales')}>
            {windowed.map((h) => (
              <div
                key={h.hour}
                data-testid="hour-bar"
                title={`${String(h.hour).padStart(2, '0')}:00 · ${h.orderCount} · ${formatCurrency(h.totalSales)}`}
                className="flex-1 flex flex-col items-center gap-1 min-w-0"
              >
                <div className="w-full h-32 flex items-end">
                  <div
                    className={`w-full rounded-t ${h.hour === nowHour ? 'bg-primary-500' : 'bg-primary-200'}`}
                    style={{ height: `${Math.max(h.totalSales > 0 ? 6 : 2, Math.round((h.totalSales / maxSales) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums">{h.hour}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/HourlySalesCard.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/components/HourlySalesCard.tsx frontend/src/features/dashboard/components/HourlySalesCard.test.tsx
git commit -m "feat(dashboard): add hourly sales bar chart card"
```

---

### Task 8: attention panel (low stock + insights)

**Files:**
- Create: `frontend/src/features/dashboard/components/AttentionCard.tsx`
- Test: `frontend/src/features/dashboard/components/AttentionCard.test.tsx`

**Interfaces:**
- Produces: `AttentionCard` — returns `null` when NEITHER `inventoryTracking` NOR `advancedReports` is granted. Three inner variants (`InnerBoth`/`InnerStock`/`InnerInsights`) mount exactly the entitled hooks (403 safety without conditional hooks), then render one Card titled `t('dashboard.attention')` with: `LowStockSection` (top 5 of `useLowStockItems()`, rose-toned rows `{name} {currentStock}/{minStock} {unit}`, links `/admin/stock`) and `InsightsSection` (top 3 of `useActionableInsights()`, severity dot: CRITICAL rose-500 / WARNING amber-500 / INFO slate-400, links `/admin/reports`). All entitled sections empty → `WidgetEmpty` with `t('dashboard.allClear')`.
- Consumes: `useLowStockItems`, `useActionableInsights`, `useSubscription`, `Skeleton`, `WidgetEmpty`, `WidgetError`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/dashboard/components/AttentionCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AttentionCard from './AttentionCard';

vi.mock('../../stock-management/stockManagementApi', () => ({
  useLowStockItems: () => globalThis.__lowStock,
}));
vi.mock('../../analytics/analyticsApi', () => ({
  useActionableInsights: () => globalThis.__insights,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

declare global {
  /* eslint-disable no-var */
  var __lowStock: any;
  var __insights: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const ok = (data: unknown) => ({ data, isLoading: false, isError: false });
const renderCard = () =>
  render(
    <MemoryRouter>
      <AttentionCard />
    </MemoryRouter>,
  );

describe('AttentionCard', () => {
  it('renders nothing when neither gate is granted', () => {
    globalThis.__features = [];
    const { container } = renderCard();
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('shows top-5 low stock rows when inventoryTracking is granted', () => {
    globalThis.__features = ['inventoryTracking'];
    globalThis.__lowStock = ok(
      Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `Item${i}`, currentStock: 1, minStock: 5, unit: 'kg' })),
    );
    renderCard();
    expect(screen.getAllByTestId('low-stock-row')).toHaveLength(5);
    expect(screen.getByText('Item0')).toBeInTheDocument();
    expect(screen.queryByText('Item5')).not.toBeInTheDocument();
  });

  it('shows top-3 insights with severity dots when advancedReports is granted', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__insights = ok([
      { id: 'i1', title: 'Critical thing', severity: 'CRITICAL' },
      { id: 'i2', title: 'Warn thing', severity: 'WARNING' },
      { id: 'i3', title: 'Info thing', severity: 'INFO' },
      { id: 'i4', title: 'Overflow', severity: 'INFO' },
    ]);
    renderCard();
    expect(screen.getAllByTestId('insight-row')).toHaveLength(3);
    expect(screen.queryByText('Overflow')).not.toBeInTheDocument();
  });

  it('shows all-clear when both sections are entitled but empty', () => {
    globalThis.__features = ['inventoryTracking', 'advancedReports'];
    globalThis.__lowStock = ok([]);
    globalThis.__insights = ok([]);
    renderCard();
    expect(screen.getByTestId('widget-empty')).toHaveTextContent('dashboard.allClear');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/AttentionCard.test.tsx`
Expected: FAIL — cannot resolve `./AttentionCard`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/features/dashboard/components/AttentionCard.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Skeleton from '../../../components/ui/Skeleton';
import { cn } from '../../../lib/utils';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useLowStockItems } from '../../stock-management/stockManagementApi';
import { useActionableInsights } from '../../analytics/analyticsApi';
import { WidgetEmpty, WidgetError } from './WidgetStates';

// A query-result shape shared by the sections. `undefined` = that section's
// plan gate is off (its hook was never mounted, so it can never 403).
type QueryLike<T> = { data?: T; isLoading: boolean; isError: boolean } | undefined;

// 403 safety: the gated hooks live in three tiny inner variants so exactly
// the entitled hooks mount — never an `if` around a hook, never a query a
// gated tenant would 403 on.
export default function AttentionCard() {
  const { hasFeature } = useSubscription();
  const stockGate = hasFeature('inventoryTracking');
  const insightGate = hasFeature('advancedReports');
  if (!stockGate && !insightGate) return null;
  if (stockGate && insightGate) return <InnerBoth />;
  if (stockGate) return <InnerStock />;
  return <InnerInsights />;
}

function InnerBoth() {
  const low = useLowStockItems();
  const ins = useActionableInsights();
  return <AttentionBody low={low} ins={ins} />;
}
function InnerStock() {
  const low = useLowStockItems();
  return <AttentionBody low={low} />;
}
function InnerInsights() {
  const ins = useActionableInsights();
  return <AttentionBody ins={ins} />;
}

const isEmpty = (q: QueryLike<unknown[]>) =>
  !q || (!q.isLoading && !q.isError && (q.data ?? []).length === 0);

function AttentionBody({ low, ins }: { low?: QueryLike<any[]>; ins?: QueryLike<any[]> }) {
  const { t } = useTranslation('common');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.attention')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="attention-body">
        {low && <LowStockSection query={low} />}
        {ins && <InsightsSection query={ins} />}
        {isEmpty(low) && isEmpty(ins) && <WidgetEmpty text={t('dashboard.allClear')} />}
      </CardContent>
    </Card>
  );
}

function LowStockSection({ query }: { query: NonNullable<QueryLike<any[]>> }) {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = query;
  if (isError) return <WidgetError />;
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const items = (data ?? []).slice(0, 5);
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 mb-2">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t('dashboard.lowStock')}
      </div>
      <ul className="space-y-1">
        {items.map((it: { id: string; name: string; currentStock: number; minStock: number; unit: string }) => (
          <li key={it.id} data-testid="low-stock-row">
            <Link
              to="/admin/stock"
              className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-1.5 text-sm hover:bg-rose-100 transition-colors"
            >
              <span className="text-slate-800 truncate">{it.name}</span>
              <span className="text-rose-700 tabular-nums shrink-0">
                {it.currentStock}/{it.minStock} {it.unit}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEVERITY_DOT: Record<string, string> = {
  CRITICAL: 'bg-rose-500',
  WARNING: 'bg-amber-500',
  INFO: 'bg-slate-400',
};

function InsightsSection({ query }: { query: NonNullable<QueryLike<any[]>> }) {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = query;
  if (isError) return <WidgetError />;
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const insights = (data ?? []).slice(0, 3);
  if (insights.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        <Lightbulb className="h-3.5 w-3.5" />
        {t('dashboard.insightsTitle')}
      </div>
      <ul className="space-y-1">
        {insights.map((ins) => (
          <li key={ins.id} data-testid="insight-row">
            <Link
              to="/admin/reports"
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors"
            >
              <span className={cn('h-2 w-2 rounded-full shrink-0', SEVERITY_DOT[ins.severity] ?? 'bg-slate-400')} />
              <span className="text-slate-800 truncate">{ins.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/AttentionCard.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/components/AttentionCard.tsx frontend/src/features/dashboard/components/AttentionCard.test.tsx
git commit -m "feat(dashboard): add attention panel (low stock + actionable insights)"
```

---

### Task 9: top products card

**Files:**
- Create: `frontend/src/features/dashboard/components/TopProductsCard.tsx`
- Test: `frontend/src/features/dashboard/components/TopProductsCard.test.tsx`

**Interfaces:**
- Produces: `TopProductsCard` — gated `advancedReports`. Card titled `t('dashboard.topProductsToday')`; top-5 of `useTopProducts(todayRange())` sorted as returned; each row (`data-testid="top-product-row"`): rank badge, `productName`, `t('dashboard.qtySold', {count: quantitySold})`, `formatCurrency(revenue)`, and a relative revenue bar (`width = revenue / max * 100%`, `bg-primary-200`). Empty → `WidgetEmpty` `t('dashboard.noSalesYet')`.
- Consumes: `useTopProducts` (`TopProduct = {productId, productName, categoryName, quantitySold, revenue}`), `todayRange`, `useFormatCurrency`, `useSubscription`, Card parts, `Skeleton`, `WidgetError`, `WidgetEmpty`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/dashboard/components/TopProductsCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopProductsCard from './TopProductsCard';

vi.mock('../../reports/reportsApi', () => ({
  useTopProducts: () => globalThis.__topProducts,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts?.count !== undefined ? `${opts.count} adet` : k),
  }),
}));

declare global {
  /* eslint-disable no-var */
  var __topProducts: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const renderCard = () =>
  render(
    <MemoryRouter>
      <TopProductsCard />
    </MemoryRouter>,
  );

describe('TopProductsCard', () => {
  it('renders nothing without advancedReports', () => {
    globalThis.__features = [];
    const { container } = renderCard();
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('renders top-5 rows with quantity and revenue', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__topProducts = {
      data: Array.from({ length: 6 }, (_, i) => ({
        productId: `p${i}`,
        productName: `Ürün${i}`,
        categoryName: 'Ana',
        quantitySold: 30 - i,
        revenue: 3000 - i * 100,
      })),
      isLoading: false,
      isError: false,
    };
    renderCard();
    expect(screen.getAllByTestId('top-product-row')).toHaveLength(5);
    expect(screen.getByText('Ürün0')).toBeInTheDocument();
    expect(screen.getByText('30 adet')).toBeInTheDocument();
    expect(screen.getByText('₺3000')).toBeInTheDocument();
    expect(screen.queryByText('Ürün5')).not.toBeInTheDocument();
  });

  it('shows the empty state when no sales today', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__topProducts = { data: [], isLoading: false, isError: false };
    renderCard();
    expect(screen.getByTestId('widget-empty')).toHaveTextContent('dashboard.noSalesYet');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/components/TopProductsCard.test.tsx`
Expected: FAIL — cannot resolve `./TopProductsCard`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/features/dashboard/components/TopProductsCard.tsx
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Skeleton from '../../../components/ui/Skeleton';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useTopProducts } from '../../reports/reportsApi';
import { todayRange } from '../lib';
import { WidgetError, WidgetEmpty } from './WidgetStates';

export default function TopProductsCard() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('advancedReports')) return null;
  return <TopProductsCardInner />;
}

function TopProductsCardInner() {
  const { t } = useTranslation('common');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, isError } = useTopProducts(todayRange());
  const products = (data ?? []).slice(0, 5);
  const maxRevenue = Math.max(1, ...products.map((p) => p.revenue));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.topProductsToday')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <WidgetError />
        ) : isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : products.length === 0 ? (
          <WidgetEmpty text={t('dashboard.noSalesYet')} />
        ) : (
          <ol className="space-y-2.5">
            {products.map((p, i) => (
              <li key={p.productId} data-testid="top-product-row">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-800">{p.productName}</span>
                  <span className="text-xs text-slate-500 tabular-nums shrink-0">
                    {t('dashboard.qtySold', { count: p.quantitySold })}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                    {formatCurrency(p.revenue)}
                  </span>
                </div>
                <div className="mt-1 ms-9 h-1 rounded-full bg-slate-100">
                  <div
                    className="h-1 rounded-full bg-primary-200"
                    style={{ width: `${Math.round((p.revenue / maxRevenue) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/components/TopProductsCard.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/components/TopProductsCard.tsx frontend/src/features/dashboard/components/TopProductsCard.test.tsx
git commit -m "feat(dashboard): add today's top products card"
```

---

### Task 10: shortcuts card, quota strip, hero card

**Files:**
- Create: `frontend/src/features/dashboard/components/ShortcutsCard.tsx`
- Create: `frontend/src/features/dashboard/components/QuotaStrip.tsx`
- Create: `frontend/src/features/dashboard/components/HeroCard.tsx`

No colocated tests here — all three are exercised end-to-end by `DashboardPage.spec.tsx` in Task 11 (links, tour anchor, quota tones, hero rendering). They contain no branching logic beyond what that spec covers.

**Interfaces:**
- Produces:
  - `ShortcutsCard({ actions: QuickAction[] })` — Card titled `t('dashboard.shortcuts')`; content div carries `data-tour="quick-actions"`. The `isPrimary` action renders as a full-width orange tile (`bg-primary-500 text-white`); the rest as a `grid grid-cols-2 gap-2` of small icon tiles.
  - `QuotaStrip()` — the existing DashboardPage `QuotaStrip`/`QuotaPill` moved verbatim into this file (same `useGetUsageSnapshot`, same thresholds/tones/`/admin/plan` links), with the wrapper class changed to `flex flex-wrap gap-2` (slim bottom row).
  - `HeroCard({ to, icon, title, description })` — the current POS hero markup (dark gradient Link) generalized: used by WAITER (POS) and KITCHEN (Kitchen) views.
- Consumes: `QuickAction` type (Task 4), `useGetUsageSnapshot` + `UsageDimension` from `../../plan/planApi`, existing icons.

- [ ] **Step 1: Write ShortcutsCard**

```tsx
// frontend/src/features/dashboard/components/ShortcutsCard.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { QuickAction } from '../lib';

export default function ShortcutsCard({ actions }: { actions: QuickAction[] }) {
  const { t } = useTranslation('common');
  const primary = actions.find((a) => a.isPrimary);
  const rest = actions.filter((a) => !a.isPrimary);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.shortcuts')}</CardTitle>
      </CardHeader>
      <CardContent data-tour="quick-actions" className="space-y-2">
        {primary && (
          <Link
            to={primary.to}
            className="flex items-center gap-3 rounded-lg bg-primary-500 px-4 py-3 text-white shadow-sm hover:bg-primary-600 transition-colors"
          >
            <primary.icon className="h-5 w-5" />
            <span className="font-semibold">{t(primary.label)}</span>
          </Link>
        )}
        <div className="grid grid-cols-2 gap-2">
          {rest.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className="group flex items-center gap-2 rounded-lg border border-slate-200/60 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <action.icon className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0" />
              <span className="text-sm text-slate-700 truncate">{t(action.label)}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Write QuotaStrip (move, don't rewrite)**

Cut `QuotaStrip` + `QuotaPill` (lines 287-336) from `frontend/src/pages/DashboardPage.tsx` into the new file, unchanged except imports and the wrapper div:

```tsx
// frontend/src/features/dashboard/components/QuotaStrip.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LucideIcon, Users, Building2, Package, ShoppingCart } from 'lucide-react';
import { useGetUsageSnapshot, type UsageDimension } from '../../plan/planApi';

// v2.8.88 quota pills, relocated to the dashboard's bottom edge. Same
// endpoint feeds Plan & Erişim; React Query caches it per session.
export default function QuotaStrip() {
  const { t } = useTranslation('common');
  const { data: snapshot } = useGetUsageSnapshot();
  if (!snapshot) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="quota-strip">
      <QuotaPill icon={Users} label={t('dashboard.quotaUsers')} dim={snapshot.users} />
      <QuotaPill icon={Building2} label={t('dashboard.quotaBranches')} dim={snapshot.branches} />
      <QuotaPill icon={Package} label={t('dashboard.quotaProducts')} dim={snapshot.products} />
      <QuotaPill icon={ShoppingCart} label={t('dashboard.quotaMonthlyOrders')} dim={snapshot.monthlyOrders} />
    </div>
  );
}

function QuotaPill({ icon: Icon, label, dim }: { icon: LucideIcon; label: string; dim: UsageDimension }) {
  const unlimited = dim.max === -1;
  const pct = unlimited ? 0 : Math.min(100, Math.round((dim.current / Math.max(1, dim.max)) * 100));
  const status = unlimited ? 'ok' : pct >= 100 ? 'full' : pct >= 80 ? 'warn' : 'ok';
  const tone =
    status === 'full'
      ? 'border-rose-200 bg-rose-50'
      : status === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-white';
  const textTone = status === 'full' ? 'text-rose-700' : status === 'warn' ? 'text-amber-700' : 'text-slate-600';
  return (
    <Link to="/admin/plan" className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${tone}`}>
      <Icon className={`h-3.5 w-3.5 ${textTone}`} />
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${textTone}`}>
        {dim.current} {unlimited ? '/ ∞' : `/ ${dim.max}`}
      </span>
    </Link>
  );
}
```

- [ ] **Step 3: Write HeroCard**

```tsx
// frontend/src/features/dashboard/components/HeroCard.tsx
import { Link } from 'react-router-dom';
import { ArrowRight, LucideIcon } from 'lucide-react';

// Large entry-point card for single-purpose roles (WAITER → POS, KITCHEN → KDS).
export default function HeroCard({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      data-testid="hero-card"
      className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 shadow-lg hover:shadow-xl transition-all duration-300 block"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-primary-600/10 to-orange-400/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="relative flex items-center gap-4">
        <div className="p-3 bg-white/10 rounded-xl group-hover:bg-white/15 transition-colors">
          <Icon className="h-8 w-8 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <p className="text-slate-400 text-sm">{description}</p>
        </div>
        <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" />
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Typecheck + lint the three files**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: clean. In this task, delete the page-local `QuotaStrip`/`QuotaPill` definitions from `DashboardPage.tsx` and add `import QuotaStrip from '../features/dashboard/components/QuotaStrip';` in their place so the page keeps compiling (Task 11 rewrites the page wholesale anyway).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/components/ShortcutsCard.tsx frontend/src/features/dashboard/components/QuotaStrip.tsx frontend/src/features/dashboard/components/HeroCard.tsx frontend/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): add shortcuts card, relocated quota strip, hero card"
```

---

### Task 11: DashboardPage rewrite + spec

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx` (full rewrite)
- Test: `frontend/src/pages/DashboardPage.spec.tsx`

**Interfaces:**
- Consumes everything produced by Tasks 4-10. Role layout matrix:
  - ADMIN/MANAGER: greeting → SetupChecklist → KPI grid (`SalesKpis` + `OpenTablesKpi`) → ops grid (`KitchenQueueTile`, `ApprovalsTile`, `CallsTile`, `ReservationsTile`) → middle grid (HourlySalesCard 2/3 + AttentionCard 1/3 — spans adapt when one is gated off) → bottom grid (TopProductsCard 2/3 + ShortcutsCard 1/3) → QuotaStrip.
  - WAITER: greeting → HeroCard(POS) → ops grid (`OpenTablesKpi` in a 2-col grid with `CallsTile`) → ShortcutsCard (customers etc. from role-filtered QUICK_ACTIONS minus POS-as-primary since the hero covers it — pass the filtered list as-is; the primary tile doubles as a POS link, acceptable, simpler).
  - KITCHEN: greeting → HeroCard(Kitchen) → `KitchenQueueTile`.
  - COURIER: greeting → two link cards (Profil `/profile`, Yardım `/help`).
- Page-level layout gating: `hasFeature('advancedReports')` decides the middle/bottom grid spans; widget-level wrappers still own query mounting.

- [ ] **Step 1: Write the failing spec**

```tsx
// frontend/src/pages/DashboardPage.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './DashboardPage';
import { UserRole } from '../types';

// Every data hook the dashboard touches is mocked through globalThis so each
// test pins exactly one behavior (pattern: SetupChecklist.spec.tsx).
const q = (data: unknown) => ({ data, isLoading: false, isError: false });

vi.mock('../features/onboarding/SetupChecklist', () => ({ default: () => null }));
vi.mock('../features/reports/reportsApi', () => ({
  useSalesReport: () => globalThis.__sales,
  useSalesComparison: () => q(undefined),
  useTopProducts: () => globalThis.__topProducts,
  metricTrend: () => undefined,
}));
vi.mock('../api/enhancedReportsApi', () => ({
  useOrdersByHour: () => globalThis.__hourly,
}));
vi.mock('../features/orders/ordersApi', () => ({
  useOrders: () => globalThis.__orders,
  usePendingOrders: () => globalThis.__pending,
  useWaiterRequests: () => globalThis.__waiterReqs,
  useBillRequests: () => globalThis.__billReqs,
}));
vi.mock('../features/tables/tablesApi', () => ({
  useTables: () => globalThis.__tables,
}));
vi.mock('../features/reservations/reservationsApi', () => ({
  useReservationStats: () => globalThis.__resStats,
}));
vi.mock('../features/stock-management/stockManagementApi', () => ({
  useLowStockItems: () => globalThis.__lowStock,
}));
vi.mock('../features/analytics/analyticsApi', () => ({
  useActionableInsights: () => globalThis.__insights,
}));
vi.mock('../features/plan/planApi', () => ({
  useGetUsageSnapshot: () => globalThis.__usage,
}));
vi.mock('../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('../store/authStore', () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user: globalThis.__user }),
}));
vi.mock('../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('../hooks/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateIntl: () => '21 Temmuz 2026 Salı' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k} ${o.name}` : k) }),
}));

declare global {
  /* eslint-disable no-var */
  var __user: any;
  var __features: string[];
  var __sales: any;
  var __topProducts: any;
  var __hourly: any;
  var __orders: any;
  var __pending: any;
  var __waiterReqs: any;
  var __billReqs: any;
  var __tables: any;
  var __resStats: any;
  var __lowStock: any;
  var __insights: any;
  var __usage: any;
  /* eslint-enable no-var */
}

const renderPage = () => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  globalThis.__features = ['advancedReports', 'inventoryTracking', 'reservationSystem'];
  globalThis.__user = { firstName: 'Tarik', lastName: 'U', role: UserRole.ADMIN };
  globalThis.__sales = q({ totalSales: 12450, totalOrders: 86, averageOrderValue: 145 });
  globalThis.__topProducts = q([{ productId: 'p1', productName: 'Adana', categoryName: 'Ana', quantitySold: 3, revenue: 300 }]);
  globalThis.__hourly = q({ date: '2026-07-21', hourlyData: [{ hour: 12, orderCount: 2, totalSales: 200 }] });
  globalThis.__orders = q([{ status: 'PENDING' }]);
  globalThis.__pending = q([]);
  globalThis.__waiterReqs = q([]);
  globalThis.__billReqs = q([]);
  globalThis.__tables = q([{ status: 'OCCUPIED' }, { status: 'AVAILABLE' }]);
  globalThis.__resStats = q({ total: 2, pending: 1, confirmed: 1, seated: 0, completed: 0, cancelled: 0, noShow: 0, rejected: 0 });
  globalThis.__lowStock = q([]);
  globalThis.__insights = q([]);
  globalThis.__usage = q({
    users: { current: 2, max: 5 },
    branches: { current: 1, max: 1 },
    tables: { current: 5, max: -1 },
    products: { current: 10, max: 100 },
    monthlyOrders: { current: 50, max: 1000 },
    computedAt: 'now',
  });
});

describe('DashboardPage — ADMIN', () => {
  it('renders the full command center with tour anchors', () => {
    const { container } = renderPage();
    expect(container.querySelector('[data-tour="dashboard-container"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="quick-actions"]')).toBeTruthy();
    expect(screen.getByText('₺12450')).toBeInTheDocument(); // sales KPI
    expect(screen.getByText('1/2')).toBeInTheDocument(); // open tables
    expect(screen.getByText('dashboard.kitchenQueue')).toBeInTheDocument();
    expect(screen.getByText('dashboard.topProductsToday')).toBeInTheDocument();
    expect(screen.getByTestId('quota-strip')).toBeInTheDocument();
  });

  it('uses consolidated routes in shortcuts (no stale deeplinks)', () => {
    const { container } = renderPage();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/team');
    expect(hrefs).toContain('/admin/settings');
    expect(hrefs).not.toContain('/admin/users');
    expect(hrefs).not.toContain('/admin/settings/subscription');
  });

  it('hides gated widgets without features (and page still stands)', () => {
    globalThis.__features = [];
    renderPage();
    expect(screen.queryByText('₺12450')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.hourlySales')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.reservationsToday')).not.toBeInTheDocument();
    // ungated survivors:
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('dashboard.kitchenQueue')).toBeInTheDocument();
  });
});

describe('DashboardPage — role variants', () => {
  it('WAITER gets the POS hero and no admin sections', () => {
    globalThis.__user = { firstName: 'W', lastName: 'A', role: UserRole.WAITER };
    renderPage();
    expect(screen.getByTestId('hero-card')).toHaveAttribute('href', '/pos');
    expect(screen.queryByText('dashboard.topProductsToday')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-strip')).not.toBeInTheDocument();
  });

  it('KITCHEN gets the kitchen hero and queue tile', () => {
    globalThis.__user = { firstName: 'K', lastName: 'A', role: UserRole.KITCHEN };
    renderPage();
    expect(screen.getByTestId('hero-card')).toHaveAttribute('href', '/kitchen');
    expect(screen.getByText('dashboard.kitchenQueue')).toBeInTheDocument();
  });

  it('COURIER no longer sees a blank page', () => {
    globalThis.__user = { firstName: 'C', lastName: 'A', role: UserRole.COURIER };
    const { container } = renderPage();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/profile');
    expect(hrefs).toContain('/help');
  });
});
```

- [ ] **Step 2: Run spec to verify it fails**

Run: `npx vitest run src/pages/DashboardPage.spec.tsx`
Expected: FAIL — old page markup (hero for admin, stale links, no quota-strip testid).

- [ ] **Step 3: Rewrite the page**

```tsx
// frontend/src/pages/DashboardPage.tsx
import { useTranslation } from 'react-i18next';
import { ShoppingCart, ChefHat, UserCircle, HelpCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '../types';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useFormatDate } from '../hooks/useFormatDate';
import SetupChecklist from '../features/onboarding/SetupChecklist';
import { greetingKey, QUICK_ACTIONS } from '../features/dashboard/lib';
import { SalesKpis, OpenTablesKpi } from '../features/dashboard/components/KpiRow';
import {
  KitchenQueueTile,
  ApprovalsTile,
  CallsTile,
  ReservationsTile,
  OpsTile,
} from '../features/dashboard/components/OpsTiles';
import HourlySalesCard from '../features/dashboard/components/HourlySalesCard';
import AttentionCard from '../features/dashboard/components/AttentionCard';
import TopProductsCard from '../features/dashboard/components/TopProductsCard';
import ShortcutsCard from '../features/dashboard/components/ShortcutsCard';
import QuotaStrip from '../features/dashboard/components/QuotaStrip';
import HeroCard from '../features/dashboard/components/HeroCard';

const DashboardPage = () => {
  const user = useAuthStore((state) => state.user);
  const userRole = user?.role as UserRole;

  return (
    <div className="space-y-6" data-tour="dashboard-container">
      <Greeting firstName={user?.firstName} />
      {userRole === UserRole.WAITER ? (
        <WaiterView />
      ) : userRole === UserRole.KITCHEN ? (
        <KitchenView />
      ) : userRole === UserRole.COURIER ? (
        <CourierView />
      ) : (
        <ManagerView />
      )}
    </div>
  );
};

function Greeting({ firstName }: { firstName?: string }) {
  const { t } = useTranslation('common');
  const { formatDateIntl } = useFormatDate();
  return (
    <div>
      <h1 className="text-2xl font-heading font-bold text-slate-900">
        {t(greetingKey())}
        {firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="text-slate-500 mt-1">
        {formatDateIntl(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  );
}

// ADMIN + MANAGER: the full command center.
function ManagerView() {
  const { hasFeature } = useSubscription();
  const advanced = hasFeature('advancedReports');
  const attention = advanced || hasFeature('inventoryTracking');
  const actions = QUICK_ACTIONS.filter((a) =>
    a.roles.some((r) => r === UserRole.ADMIN || r === UserRole.MANAGER),
  );

  return (
    <>
      <SetupChecklist />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SalesKpis />
        <OpenTablesKpi />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KitchenQueueTile />
        <ApprovalsTile />
        <CallsTile />
        <ReservationsTile />
      </div>
      {(advanced || attention) && (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          {advanced && (
            <div className={attention ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <HourlySalesCard />
            </div>
          )}
          {attention && (
            <div className={advanced ? 'lg:col-span-1' : 'lg:col-span-3'}>
              <AttentionCard />
            </div>
          )}
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {advanced && (
          <div className="lg:col-span-2">
            <TopProductsCard />
          </div>
        )}
        <div className={advanced ? 'lg:col-span-1' : 'lg:col-span-3'}>
          <ShortcutsCard actions={actions} />
        </div>
      </div>
      <QuotaStrip />
    </>
  );
}

function WaiterView() {
  const { t } = useTranslation('common');
  const actions = QUICK_ACTIONS.filter((a) => a.roles.includes(UserRole.WAITER));
  return (
    <>
      <HeroCard
        to="/pos"
        icon={ShoppingCart}
        title={t('navigation.pos')}
        description={t('dashboard.posDescription')}
      />
      <div className="grid grid-cols-2 gap-4">
        <OpenTablesKpi />
        <CallsTile />
      </div>
      <ShortcutsCard actions={actions} />
    </>
  );
}

function KitchenView() {
  const { t } = useTranslation('common');
  return (
    <>
      <HeroCard
        to="/kitchen"
        icon={ChefHat}
        title={t('navigation.kitchen')}
        description={t('dashboard.kitchenDescription')}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KitchenQueueTile />
      </div>
    </>
  );
}

// COURIER previously matched zero quick actions and saw a blank page.
function CourierView() {
  const { t } = useTranslation('common');
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <OpsTile to="/profile" icon={UserCircle} label={t('dashboard.profileTitle')} primaryText={t('dashboard.profileDescription')} />
      <OpsTile to="/help" icon={HelpCircle} label={t('dashboard.helpTitle')} primaryText={t('dashboard.helpDescription')} />
    </div>
  );
}

export default DashboardPage;
```

Notes for the implementer:
- `SetupChecklist` no longer needs the ADMIN/MANAGER guard around it — `ManagerView` is only rendered for those roles. The KPI/quota role guards likewise dissolve into the view split.
- `CourierView` reuses `OpsTile` with description text in `primaryText` — the `text-xl font-bold` will style it; if it reads too heavy, wrap description in the `hint` prop instead and put a dash in `primaryText` — implementer's visual call, spec only asserts the links exist.
- Remove ALL now-unused imports from the old page body (`Link`, `format`, `addDays`, quota icons, `TodayKpiStrip` internals, `useGetUsageSnapshot`, `useSalesReport`, etc. — the rewrite above is the complete file).
- The old `TodayKpiStrip`/`KpiPill` code is deleted (superseded by `SalesKpis`).
- The unused `t` in `DashboardPage` body: remove `const { t } = useTranslation('common');` from the top-level component if nothing references it after the split (Greeting has its own).

- [ ] **Step 4: Run the spec + typecheck**

Run: `npx vitest run src/pages/DashboardPage.spec.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: 6 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.spec.tsx
git commit -m "feat(dashboard): rebuild dashboard as role-aware command center"
```

---

### Task 12: Outfit font fix + full verification

**Files:**
- Modify: `frontend/index.html:29` (fonts href)

- [ ] **Step 1: Fix the font request**

In `frontend/index.html` line 29, extend the Google Fonts URL with Outfit (600/700 are the weights `font-heading font-semibold/bold` uses):

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Full frontend suite**

Run: `npm run test:ci`
Expected: all suites pass (baseline ~1989 tests + new ones). Investigate ANY failure — especially `src/pages/admin` (StatCard swap) and onboarding tour specs.

- [ ] **Step 3: Lint + i18n checks**

Run: `npm run lint` and from repo root `node scripts/check-i18n-parity.mjs && node scripts/check-i18n-value-drift.mjs`
Expected: all clean. If the value-drift check flags newly added keys whose translation is legitimately identical across locales (e.g. "Profil" tr/uz, "POS"), add those keys to `scripts/i18n-value-drift-baseline.json` following that file's existing entry format — do NOT reword a correct translation just to silence the check.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html
git commit -m "fix(fonts): load Outfit so font-heading renders as configured"
```

- [ ] **Step 6: Visual verification**

Launch the dev app (`npm run dev`) and check `/dashboard` as an admin: KPI row, ops tiles, chart, attention panel, top products, shortcuts, quota strip; then narrow the viewport to phone width and confirm 2-col KPI/ops grids and stacked cards. Confirm the react-joyride tour still anchors (`data-tour` attrs) by running the tour from onboarding if reachable.

---

## Final integration (after all tasks)

- [ ] Run FULL suite one more time from `frontend/`: `npm run test:ci` (memory lesson: run the full vitest before any tag).
- [ ] `npm run lint` — prettier gate (`lint:ci` in CI has no `--fix`).
- [ ] Push branch `feat/dashboard-redesign` (use `scripts/push-via-openssl.sh` — plain `git push` fails on this network), open PR to `main` via `gh`, NO AI markers anywhere.
