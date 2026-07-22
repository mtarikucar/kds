# Stok Sadeleşmesi + Tedarik Rehberi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `/admin/stock` from 3 groups × 18 tabs into one-level 6 tabs with a URL-synced shell, and add a research-backed "Tedarik Rehberi" (what to buy, from where, why) with one-click draft-PO.

**Architecture:** Phase 1 is pure frontend re-parenting: existing tab components are composed into 6 URL-driven tab containers; no component internals change. Phase 2 adds one read-only backend endpoint (`GET /stock-management/guidance`) computing a buy-list from the tenant's own PO price history + a curated Türkiye channel ruleset, plus the Rehber UI and a supplier-item price-catalog UI (revives dead hooks). Phase 3 fills the ruleset from the deep-research report.

**Tech Stack:** React 18 + TS, TanStack Query v5, react-router-dom `useSearchParams`, Tailwind, vitest + @testing-library/react, react-i18next; backend NestJS + Prisma, jest.

## Global Constraints

- **No schema migration.** Guidance derives price history from existing `PurchaseOrderItem` × `PurchaseOrder`; no new tables/columns.
- **No new npm dependencies.**
- **Money math is base-unit:** base-unit price = `unitPrice / (conversionFactor ?? 1)` — mirrors `purchase-orders.service.ts:566-572`. Every price comparison/trend uses base-unit prices. Unit-tested.
- **Plan gating:** the guidance endpoint carries controller-level `@RequiresFeature(PlanFeature.INVENTORY_TRACKING)`, roles ADMIN+MANAGER — NOT the analytics ADVANCED_REPORTS rail. Frontend gate: route already wrapped in `FeatureGate feature="inventoryTracking"`.
- **Branch scoping:** all stock queries put `branchId` in the query key (existing convention); the guidance query key includes `branchId`; backend reads branch from request scope like sibling stock-dashboard endpoints. `Supplier`/`SupplierStockItem` are tenant-scoped; `StockItem`/`PurchaseOrder` are branch-scoped — join carefully.
- **i18n:** every new user-facing string is a key in `frontend/src/i18n/locales/{tr,en,ar,ru,uz}/stock.json`; verify `node scripts/check-i18n-parity.mjs` from repo root. Turkish is source of truth.
- **Commits:** plain conventional messages, NO AI/Claude trailer or marker of any kind (hard user rule). Author is the user's own identity.
- **Push:** plain `git push` fails on this network — use `scripts/push-via-openssl.sh`; PR/merge/tag via `gh`.
- **Commands run from the worktree root** `/home/tarik/Projects/kds/.claude/worktrees/stock-procurement-guidance` unless a path says `frontend/` or `backend/`. Frontend tests: `cd frontend && npx vitest run <file>`. Backend tests: `cd backend && npx jest <file>`.
- **Existing components re-parented (do NOT modify their internals in Phase 1):** `StockItemsTab`, `RecipesTab`, `SuppliersTab`, `PurchaseOrdersTab`, `MovementsTab`, `WasteLogTab`, `StockCountsTab`, `VendorBillsTab`, `StockDashboard`, and the section blocks currently inside `PurchasingPage.tsx` (reorder, ap, scorecard, transfers, valuation, templates+barcode+RMA) and `CostingPage.tsx` (menu, variance, recipes-costing).

## File Structure

```
PHASE 1 — IA restructure
frontend/src/i18n/locales/{tr,en,ar,ru,uz}/stock.json      MOD  new tabs.* + purchasing labels moved in
frontend/src/pages/admin/stockTabs.ts                       NEW  tab id type + parse/serialize helper
frontend/src/pages/admin/stockTabs.test.ts                  NEW
frontend/src/pages/admin/stock/ItemsTab.tsx                 NEW  StockItemsTab + stat cards + valuation card
frontend/src/pages/admin/stock/OrdersTab.tsx                NEW  POs + templates + receive + barcode + RMA
frontend/src/pages/admin/stock/SuppliersHub.tsx             NEW  suppliers CRUD + scorecard + bills + AP + catalog
frontend/src/pages/admin/stock/CostingTab.tsx               NEW  recipes CRUD + costing + menu eng + variance
frontend/src/pages/admin/stock/OperationsTab.tsx            NEW  movements + waste + counts + transfers (inner switch)
frontend/src/pages/admin/StockPage.tsx                      MOD  full rewrite → 6-tab URL-synced shell
frontend/src/pages/admin/StockPage.spec.tsx                 NEW
frontend/src/App.tsx                                        MOD  redirect targets → ?tab=orders / ?tab=costing
frontend/src/pages/admin/StockManagementPage.tsx            DEL  (content absorbed)
frontend/src/pages/admin/PurchasingPage.tsx                 DEL  (content absorbed)
frontend/src/pages/admin/CostingPage.tsx                    DEL  (content absorbed)

PHASE 2 — Guidance
backend/src/modules/stock-management/data/procurement-guide.data.ts     NEW  ruleset constant (stub content)
backend/src/modules/stock-management/services/procurement-category.matcher.ts        NEW  keyword matcher
backend/src/modules/stock-management/services/procurement-category.matcher.spec.ts   NEW
backend/src/modules/stock-management/services/guidance.service.ts        NEW  buy-list + tier + channel guide
backend/src/modules/stock-management/services/guidance.service.spec.ts   NEW
backend/src/modules/stock-management/controllers/guidance.controller.ts  NEW  GET /stock-management/guidance
backend/src/modules/stock-management/controllers/guidance.controller.spec.ts  NEW
backend/src/modules/stock-management/stock-management.module.ts          MOD  register controller+service
frontend/src/features/stock-management/guidanceApi.ts                    NEW  useGuidance hook + types
frontend/src/features/stock-management/guidanceApi.test.tsx              NEW
frontend/src/features/stock-management/components/SupplierCatalog.tsx    NEW  per-supplier item price UI
frontend/src/features/stock-management/components/SupplierCatalog.test.tsx NEW
frontend/src/pages/admin/stock/GuidanceTab.tsx                           NEW  buy-list + channel guide UI
frontend/src/pages/admin/stock/GuidanceTab.test.tsx                      NEW
frontend/src/pages/admin/StockPage.tsx                                   MOD  add guide tab (default)

PHASE 3 — Content + docs (research-gated)
backend/.../data/procurement-guide.data.ts                  MOD  verified ruleset content
frontend/src/i18n/locales/*/stock.json                      MOD  guide.* rationale strings, 5 locales
docs/research/2026-07-22-tr-restaurant-procurement-channels.md  NEW  cited report
help/pages/{tr,en}/admin-guide/stock.mdx                    MOD  rewrite for 6-tab layout
```

---

## PHASE 1 — IA restructure

### Task 1: i18n — new tab labels + move hardcoded purchasing labels

**Files:**
- Modify: `frontend/src/i18n/locales/{tr,en,ar,ru,uz}/stock.json`

**Interfaces:**
- Produces: `stock.json` keys consumed by Tasks 2-6 and Phase 2: under a new `"nav"` object — `guide`, `items`, `orders`, `suppliers`, `costing`, `operations` (the 6 main tabs); and any purchasing sub-section labels currently hardcoded in `PurchasingPage.tsx` moved under existing/new groups. Reuse existing `tabs.*`, `suppliers.*`, `purchaseOrders.*`, `vendorBills.*`, `recipes.*` where present.

- [ ] **Step 1: Read the current PurchasingPage hardcoded labels**

Run: `grep -nE "'[A-ZĞÜŞİÖÇ][^']+'|\"[A-ZĞÜŞİÖÇ][^\"]+\"" frontend/src/pages/admin/PurchasingPage.tsx` and note every Turkish literal used as a tab/section label (reorder='Sipariş Önerileri', ap='Borç Yaşlandırma', scorecard='Tedarikçi Karnesi', transfers='Şube Transferleri', valuation='Stok Değerleme', more='Şablonlar & Barkod', etc.).

- [ ] **Step 2: Add the `nav` group + moved labels to tr/stock.json**

Add to `frontend/src/i18n/locales/tr/stock.json` (top level, do not disturb existing keys):

```json
"nav": {
  "guide": "Tedarik Rehberi",
  "items": "Malzemeler",
  "orders": "Siparişler",
  "suppliers": "Tedarikçiler",
  "costing": "Reçete & Maliyet",
  "operations": "Operasyon"
},
"sections": {
  "reorder": "Sipariş Önerileri",
  "apAging": "Borç Yaşlandırma",
  "scorecard": "Tedarikçi Karnesi",
  "transfers": "Şube Transferleri",
  "valuation": "Stok Değerleme",
  "templates": "Şablonlar",
  "barcode": "Barkod",
  "returns": "İade (RMA)",
  "vendorBills": "Tedarikçi Faturaları",
  "catalog": "Fiyat Kataloğu",
  "menuEngineering": "Menü Mühendisliği",
  "usageVariance": "Kullanım Varyansı",
  "recipeCosting": "Reçete Maliyetleri"
}
```

- [ ] **Step 3: Mirror to en/ar/ru/uz**

Add the same `nav` + `sections` objects to the other four locale files with translations:
- en: guide="Purchasing Guide", items="Items", orders="Orders", suppliers="Suppliers", costing="Recipes & Cost", operations="Operations"; sections reorder="Reorder Suggestions", apAging="AP Aging", scorecard="Supplier Scorecard", transfers="Branch Transfers", valuation="Stock Valuation", templates="Templates", barcode="Barcode", returns="Returns (RMA)", vendorBills="Vendor Bills", catalog="Price Catalog", menuEngineering="Menu Engineering", usageVariance="Usage Variance", recipeCosting="Recipe Costs".
- ar: guide="دليل التموين", items="الأصناف", orders="الطلبات", suppliers="الموردون", costing="الوصفات والتكلفة", operations="العمليات"; sections reorder="اقتراحات إعادة الطلب", apAging="أعمار الذمم", scorecard="بطاقة أداء المورد", transfers="تحويلات الفروع", valuation="تقييم المخزون", templates="القوالب", barcode="الباركود", returns="المرتجعات (RMA)", vendorBills="فواتير الموردين", catalog="كتالوج الأسعار", menuEngineering="هندسة القائمة", usageVariance="تباين الاستخدام", recipeCosting="تكاليف الوصفات".
- ru: guide="Гид по закупкам", items="Товары", orders="Заказы", suppliers="Поставщики", costing="Рецепты и себестоимость", operations="Операции"; sections reorder="Рекомендации к заказу", apAging="Долги по срокам", scorecard="Оценка поставщика", transfers="Межфилиальные передачи", valuation="Оценка запасов", templates="Шаблоны", barcode="Штрихкод", returns="Возвраты (RMA)", vendorBills="Счета поставщиков", catalog="Каталог цен", menuEngineering="Инжиниринг меню", usageVariance="Отклонение расхода", recipeCosting="Себестоимость рецептов".
- uz: guide="Ta'minot qo'llanmasi", items="Mahsulotlar", orders="Buyurtmalar", suppliers="Yetkazib beruvchilar", costing="Retsept va tannarx", operations="Operatsiyalar"; sections reorder="Qayta buyurtma takliflari", apAging="Qarz muddatlari", scorecard="Yetkazib beruvchi baholi", transfers="Filiallararo o'tkazmalar", valuation="Zaxira bahosi", templates="Shablonlar", barcode="Shtrix-kod", returns="Qaytarish (RMA)", vendorBills="Yetkazib beruvchi hisoblari", catalog="Narx katalogi", menuEngineering="Menyu muhandisligi", usageVariance="Sarf farqi", recipeCosting="Retsept tannarxi".

- [ ] **Step 4: Verify parity + JSON validity**

Run from repo root: `node scripts/check-i18n-parity.mjs` (expect no missing-key report for stock.json) and `for l in tr en ar ru uz; do python3 -m json.tool frontend/src/i18n/locales/$l/stock.json >/dev/null && echo "$l OK"; done` (expect 5 OKs).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/locales/*/stock.json
git commit -m "feat(i18n): add stock nav + section labels for the 6-tab layout"
```

---

### Task 2: `stockTabs` URL helper

**Files:**
- Create: `frontend/src/pages/admin/stockTabs.ts`
- Test: `frontend/src/pages/admin/stockTabs.test.ts`

**Interfaces:**
- Produces: `type StockTab = 'guide' | 'items' | 'orders' | 'suppliers' | 'costing' | 'operations'`; `STOCK_TABS: StockTab[]` (order matters — `guide` first); `parseStockTab(raw: string | null): StockTab` (unknown/null → `'guide'`); `isStockTab(v: string): v is StockTab`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/pages/admin/stockTabs.test.ts
import { describe, it, expect } from 'vitest';
import { parseStockTab, STOCK_TABS, isStockTab } from './stockTabs';

describe('stockTabs', () => {
  it('lists 6 tabs with guide first', () => {
    expect(STOCK_TABS).toEqual(['guide', 'items', 'orders', 'suppliers', 'costing', 'operations']);
  });
  it('parses a known tab', () => {
    expect(parseStockTab('orders')).toBe('orders');
  });
  it('defaults unknown/null to guide', () => {
    expect(parseStockTab(null)).toBe('guide');
    expect(parseStockTab('bogus')).toBe('guide');
    expect(parseStockTab('')).toBe('guide');
  });
  it('type-guards', () => {
    expect(isStockTab('items')).toBe(true);
    expect(isStockTab('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/stockTabs.test.ts`
Expected: FAIL — cannot resolve `./stockTabs`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/pages/admin/stockTabs.ts
export type StockTab = 'guide' | 'items' | 'orders' | 'suppliers' | 'costing' | 'operations';

// Order defines the tab row; 'guide' is the landing tab.
export const STOCK_TABS: StockTab[] = ['guide', 'items', 'orders', 'suppliers', 'costing', 'operations'];

export const isStockTab = (v: string): v is StockTab => (STOCK_TABS as string[]).includes(v);

export const parseStockTab = (raw: string | null): StockTab =>
  raw && isStockTab(raw) ? raw : 'guide';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/stockTabs.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/stockTabs.ts frontend/src/pages/admin/stockTabs.test.ts
git commit -m "feat(stock): add URL tab helper for the stock section"
```

---

### Task 3: Tab container components (re-parent existing tabs)

**Files:**
- Create: `frontend/src/pages/admin/stock/ItemsTab.tsx`, `OrdersTab.tsx`, `SuppliersHub.tsx`, `CostingTab.tsx`, `OperationsTab.tsx`

**Interfaces:**
- Consumes: existing tab components (unchanged) + existing hooks. `useStockDashboard` (stat cards), `useStockValuation` (revived) from `stockManagementApi.ts`.
- Produces: five default-export components taking no props, each composing existing pieces. Consumed by `StockPage` (Task 4). `SuppliersHub` leaves a mount point where Phase 2's `SupplierCatalog` slots in.

This task moves markup that already exists in `StockManagementPage`/`PurchasingPage`/`CostingPage` into focused containers. Read those three files first; lift the relevant blocks verbatim (imports, section wrappers, the existing inner-tab state for PurchasingPage/CostingPage becomes anchor-scrolled stacked sections, except OperationsTab which keeps a small inner switcher).

- [ ] **Step 1: Write `ItemsTab.tsx`**

```tsx
// frontend/src/pages/admin/stock/ItemsTab.tsx
import { useTranslation } from 'react-i18next';
import { Package, PackageCheck, AlertTriangle, CalendarClock, Wallet } from 'lucide-react';
import StockItemsTab from '../../../features/stock-management/components/StockItemsTab';
import { useStockDashboard, useStockValuation } from '../../../features/stock-management/stockManagementApi';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';

// Malzemeler = the item catalog plus a slim stat header lifted from the old
// dashboard tab (so the standalone dashboard tab can go away).
export default function ItemsTab() {
  const { t } = useTranslation('stock');
  const formatCurrency = useFormatCurrency();
  const { data: dash } = useStockDashboard();
  const { data: valuation } = useStockValuation();

  const stats = [
    { icon: Package, label: t('dashboard.totalItems', 'Toplam Malzeme'), value: dash?.totalItems ?? '—' },
    { icon: PackageCheck, label: t('dashboard.activeItems', 'Aktif'), value: dash?.activeItems ?? '—' },
    { icon: AlertTriangle, label: t('dashboard.lowStock', 'Düşük Stok'), value: dash?.lowStockCount ?? '—', alert: (dash?.lowStockCount ?? 0) > 0 },
    { icon: CalendarClock, label: t('dashboard.expiringSoon', 'Yaklaşan SKT'), value: dash?.expiringBatchCount ?? '—' },
    { icon: Wallet, label: t('sections.valuation'), value: valuation ? formatCurrency(Number(valuation.totalValue ?? 0)) : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${s.alert ? 'border-rose-200 bg-rose-50' : 'border-slate-200/60 bg-white'}`}
          >
            <s.icon className={`h-4 w-4 shrink-0 ${s.alert ? 'text-rose-600' : 'text-slate-500'}`} />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{s.label}</div>
              <div className="text-sm font-semibold text-slate-900 tabular-nums">{s.value}</div>
            </div>
          </div>
        ))}
      </div>
      <StockItemsTab />
    </div>
  );
}
```

- [ ] **Step 2: Write `OrdersTab.tsx`**

Read `PurchasingPage.tsx`; the templates/barcode/RMA blocks live in its `more` tab and PO lifecycle is `PurchaseOrdersTab`. Compose:

```tsx
// frontend/src/pages/admin/stock/OrdersTab.tsx
import PurchaseOrdersTab from '../../../features/stock-management/components/PurchaseOrdersTab';

// Siparişler = the full PO lifecycle. PurchaseOrdersTab already covers
// create/submit/approve/receive/landed-cost/cancel and the receive modal.
// Templates + barcode + RMA are folded in below as stacked sections
// (lift the JSX + hooks — usePoTemplates, useCreateOrderFromTemplate,
// useDeletePoTemplate, lookupBarcode, useSupplierReturn — from the old
// PurchasingPage 'more' tab verbatim).
export default function OrdersTab() {
  return (
    <div className="space-y-8">
      <PurchaseOrdersTab />
      {/* TEMPLATES + BARCODE + RMA sections lifted from PurchasingPage 'more' tab */}
    </div>
  );
}
```

Lift the actual templates/barcode/RMA section JSX from `PurchasingPage.tsx` into the marked spot, with their hook imports. Do not rewrite them.

- [ ] **Step 3: Write `SuppliersHub.tsx`**

```tsx
// frontend/src/pages/admin/stock/SuppliersHub.tsx
import { useTranslation } from 'react-i18next';
import SuppliersTab from '../../../features/stock-management/components/SuppliersTab';
import VendorBillsTab from '../../../features/stock-management/components/VendorBillsTab';

// Tedarikçiler hub: CRUD + price catalog (Phase 2) + scorecard + vendor
// bills + AP aging as stacked sections. Scorecard/AP JSX + hooks
// (useSupplierScorecard, useApAging) are lifted from PurchasingPage.
export default function SuppliersHub() {
  const { t } = useTranslation('stock');
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('nav.suppliers')}</h2>
        <SuppliersTab />
      </section>
      {/* Phase 2 slots <SupplierCatalog /> here */}
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('sections.scorecard')}</h2>
        {/* SCORECARD block lifted from PurchasingPage */}
      </section>
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('sections.vendorBills')}</h2>
        <VendorBillsTab />
      </section>
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('sections.apAging')}</h2>
        {/* AP AGING block lifted from PurchasingPage */}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Write `CostingTab.tsx`**

```tsx
// frontend/src/pages/admin/stock/CostingTab.tsx
import RecipesTab from '../../../features/stock-management/components/RecipesTab';

// Reçete & Maliyet = recipe CRUD (from the old inventory group) + costing,
// menu engineering, usage variance (lift the section JSX + hooks
// useMenuEngineering, useUsageVariance, useRecipes-with-costing from
// CostingPage verbatim, incl. its ADVANCED_REPORTS 403 'upgrade required'
// special-case for the menu-engineering block).
export default function CostingTab() {
  return (
    <div className="space-y-8">
      <RecipesTab />
      {/* MENU ENGINEERING + USAGE VARIANCE + RECIPE COSTING sections from CostingPage */}
    </div>
  );
}
```

- [ ] **Step 5: Write `OperationsTab.tsx` (keeps a small inner switcher)**

```tsx
// frontend/src/pages/admin/stock/OperationsTab.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Trash2, ClipboardCheck, Building2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import MovementsTab from '../../../features/stock-management/components/MovementsTab';
import WasteLogTab from '../../../features/stock-management/components/WasteLogTab';
import StockCountsTab from '../../../features/stock-management/components/StockCountsTab';

type Op = 'movements' | 'waste' | 'counts' | 'transfers';

// Operasyon groups the four dense day-to-day admin screens behind a small
// labeled inner switcher (the only tab with a second level, by design).
export default function OperationsTab() {
  const { t } = useTranslation('stock');
  const [op, setOp] = useState<Op>('movements');
  const ops = [
    { id: 'movements' as const, label: t('tabs.movements'), icon: ArrowRightLeft },
    { id: 'waste' as const, label: t('tabs.waste'), icon: Trash2 },
    { id: 'counts' as const, label: t('tabs.stockCount'), icon: ClipboardCheck },
    { id: 'transfers' as const, label: t('sections.transfers'), icon: Building2 },
  ];
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {ops.map((o) => (
          <button
            key={o.id}
            onClick={() => setOp(o.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              op === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <o.icon className="h-4 w-4" />
            {o.label}
          </button>
        ))}
      </div>
      {op === 'movements' && <MovementsTab />}
      {op === 'waste' && <WasteLogTab />}
      {op === 'counts' && <StockCountsTab />}
      {op === 'transfers' && <div>{/* TRANSFERS block lifted from PurchasingPage */}</div>}
    </div>
  );
}
```

Lift the transfers section JSX + hooks (`useStockTransfers`, `useBranchStockItems`, `useCreate/Complete/CancelStockTransfer`, `useListBranches`) from `PurchasingPage.tsx` into the `transfers` branch.

- [ ] **Step 6: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: clean (the old pages still compile — they're deleted in Task 4).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/stock/
git commit -m "feat(stock): compose existing tabs into 5 section containers"
```

---

### Task 4: StockPage 6-tab shell (URL-synced) + redirects + delete old pages

**Files:**
- Modify: `frontend/src/pages/admin/StockPage.tsx` (full rewrite)
- Modify: `frontend/src/App.tsx` (redirect targets)
- Delete: `frontend/src/pages/admin/StockManagementPage.tsx`, `PurchasingPage.tsx`, `CostingPage.tsx`
- Test: `frontend/src/pages/admin/StockPage.spec.tsx`

**Interfaces:**
- Consumes: `STOCK_TABS`/`parseStockTab` (Task 2); the five containers (Task 3); a `GuidanceTab` that in Phase 1 is a placeholder rendering `t('nav.guide')` (Phase 2 replaces it). Create a temporary `stock/GuidanceTab.tsx` returning `<div>{t('nav.guide')}</div>` so the shell compiles.
- Produces: the shell rendering all 6 tabs, syncing `?tab` via `useSearchParams`.

- [ ] **Step 1: Write the placeholder GuidanceTab**

```tsx
// frontend/src/pages/admin/stock/GuidanceTab.tsx  (Phase 2 replaces the body)
import { useTranslation } from 'react-i18next';
export default function GuidanceTab() {
  const { t } = useTranslation('stock');
  return <div data-testid="guidance-tab">{t('nav.guide')}</div>;
}
```

- [ ] **Step 2: Write the failing spec**

```tsx
// frontend/src/pages/admin/StockPage.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockPage from './StockPage';

// Stub the six tab bodies so the shell test is about routing, not tab internals.
vi.mock('./stock/GuidanceTab', () => ({ default: () => <div>GUIDE_BODY</div> }));
vi.mock('./stock/ItemsTab', () => ({ default: () => <div>ITEMS_BODY</div> }));
vi.mock('./stock/OrdersTab', () => ({ default: () => <div>ORDERS_BODY</div> }));
vi.mock('./stock/SuppliersHub', () => ({ default: () => <div>SUPPLIERS_BODY</div> }));
vi.mock('./stock/CostingTab', () => ({ default: () => <div>COSTING_BODY</div> }));
vi.mock('./stock/OperationsTab', () => ({ default: () => <div>OPERATIONS_BODY</div> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));

const renderAt = (initial: string) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/admin/stock" element={<StockPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('StockPage shell', () => {
  it('defaults to the guide tab with no ?tab', () => {
    renderAt('/admin/stock');
    expect(screen.getByText('GUIDE_BODY')).toBeInTheDocument();
  });
  it('restores the tab from ?tab on load (deep link)', () => {
    renderAt('/admin/stock?tab=orders');
    expect(screen.getByText('ORDERS_BODY')).toBeInTheDocument();
  });
  it('falls back to guide for an unknown ?tab', () => {
    renderAt('/admin/stock?tab=bogus');
    expect(screen.getByText('GUIDE_BODY')).toBeInTheDocument();
  });
  it('renders all six tab buttons', () => {
    renderAt('/admin/stock');
    ['nav.guide', 'nav.items', 'nav.orders', 'nav.suppliers', 'nav.costing', 'nav.operations'].forEach((k) => {
      expect(screen.getByRole('tab', { name: k })).toBeInTheDocument();
    });
  });
  it('switches tab and writes ?tab on click', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderAt('/admin/stock');
    await user.click(screen.getByRole('tab', { name: 'nav.suppliers' }));
    expect(screen.getByText('SUPPLIERS_BODY')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run spec to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/StockPage.spec.tsx`
Expected: FAIL — old StockPage has a group switcher, no `role="tab"`, no `?tab` sync.

- [ ] **Step 4: Rewrite StockPage**

```tsx
// frontend/src/pages/admin/StockPage.tsx
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Package, ClipboardList, Truck, ChefHat, Wrench, LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { STOCK_TABS, parseStockTab, type StockTab } from './stockTabs';
import GuidanceTab from './stock/GuidanceTab';
import ItemsTab from './stock/ItemsTab';
import OrdersTab from './stock/OrdersTab';
import SuppliersHub from './stock/SuppliersHub';
import CostingTab from './stock/CostingTab';
import OperationsTab from './stock/OperationsTab';

const ICONS: Record<StockTab, LucideIcon> = {
  guide: Compass,
  items: Package,
  orders: ClipboardList,
  suppliers: Truck,
  costing: ChefHat,
  operations: Wrench,
};

// Tab lives in the URL (?tab=…) so refresh/deep-link/back all work — same
// convention as Tables (?view). Unknown tab → guide.
const StockPage = () => {
  const { t } = useTranslation('stock');
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseStockTab(searchParams.get('tab'));

  const setTab = (tab: StockTab) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'guide') next.delete('tab');
        else next.set('tab', tab);
        return next;
      },
      { replace: false },
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Package className="h-6 w-6 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-slate-900">{t('title')}</h1>
      </div>

      <div className="border-b border-slate-200 overflow-x-auto">
        <nav className="flex gap-0 -mb-px" role="tablist" aria-label={t('title')}>
          {STOCK_TABS.map((tab) => {
            const Icon = ICONS[tab];
            const selected = active === tab;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(tab)}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  selected
                    ? 'border-emerald-600 text-emerald-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                )}
              >
                <Icon className="h-4 w-4" />
                {t(`nav.${tab}`)}
              </button>
            );
          })}
        </nav>
      </div>

      {active === 'guide' && <GuidanceTab />}
      {active === 'items' && <ItemsTab />}
      {active === 'orders' && <OrdersTab />}
      {active === 'suppliers' && <SuppliersHub />}
      {active === 'costing' && <CostingTab />}
      {active === 'operations' && <OperationsTab />}
    </div>
  );
};

export default StockPage;
```

- [ ] **Step 5: Update App.tsx redirect targets + delete the three old pages**

In `frontend/src/App.tsx`: change `/admin/purchasing` redirect target to `/admin/stock?tab=orders` and `/admin/costing` to `/admin/stock?tab=costing` (the `<Navigate to=... replace/>` elements at lines ~493-494 and ~509-510). Confirm no other import references `StockManagementPage`/`PurchasingPage`/`CostingPage` (grep first), then delete the three files.

Run: `grep -rn "StockManagementPage\|PurchasingPage\|CostingPage" frontend/src --include=*.tsx --include=*.ts | grep -v node_modules` — expect only the deleted files' own former self-refs and any test file for CostingPage menu-gate. If `frontend/src/pages/admin/__tests__/CostingPage.menu-gate.test.tsx` imports the deleted `CostingPage`, move its assertion onto `CostingTab` (the menu-engineering 403 special-case moved there) or delete it if fully covered by CostingTab's own coverage; note which in the commit.

- [ ] **Step 6: Run spec + typecheck + full stock suite**

Run: `cd frontend && npx vitest run src/pages/admin/StockPage.spec.tsx && npx tsc --noEmit -p tsconfig.json && npx vitest run src/features/stock-management`
Expected: shell spec 5 passed; no type errors; existing 73 stock tests still green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/StockPage.tsx frontend/src/pages/admin/StockPage.spec.tsx frontend/src/pages/admin/stock/GuidanceTab.tsx frontend/src/App.tsx
git rm frontend/src/pages/admin/StockManagementPage.tsx frontend/src/pages/admin/PurchasingPage.tsx frontend/src/pages/admin/CostingPage.tsx
git commit -m "feat(stock): rebuild stock section as a 6-tab URL-synced shell"
```

---

## PHASE 2 — Guidance

### Task 5: Category matcher (backend)

**Files:**
- Create: `backend/src/modules/stock-management/services/procurement-category.matcher.ts`
- Test: `backend/src/modules/stock-management/services/procurement-category.matcher.spec.ts`

**Interfaces:**
- Produces: `type GuideCategory = 'MEAT'|'PRODUCE'|'DRY_GOODS'|'DAIRY'|'BEVERAGE'|'PACKAGING'|'CLEANING'`; `matchCategory(input: { categoryName?: string | null; itemName: string }): GuideCategory | null` — pure function; lowercases + Turkish-folds; tries category name first, then item name, against keyword lists; returns `null` when nothing matches.

- [ ] **Step 1: Write the failing test**

```ts
// procurement-category.matcher.spec.ts
import { matchCategory } from './procurement-category.matcher';

describe('matchCategory', () => {
  it('matches meat by item name', () => {
    expect(matchCategory({ itemName: 'Dana Kıyma' })).toBe('MEAT');
    expect(matchCategory({ itemName: 'tavuk but' })).toBe('MEAT');
    expect(matchCategory({ itemName: 'Somon fileto' })).toBe('MEAT');
  });
  it('prefers the category name over the item name', () => {
    expect(matchCategory({ categoryName: 'Temizlik', itemName: 'Bez' })).toBe('CLEANING');
  });
  it('matches produce, dry goods, dairy, beverage, packaging', () => {
    expect(matchCategory({ itemName: 'Domates' })).toBe('PRODUCE');
    expect(matchCategory({ itemName: 'Pirinç' })).toBe('DRY_GOODS');
    expect(matchCategory({ itemName: 'Beyaz peynir' })).toBe('DAIRY');
    expect(matchCategory({ itemName: 'Kola 1L' })).toBe('BEVERAGE');
    expect(matchCategory({ itemName: 'Karton kutu' })).toBe('PACKAGING');
  });
  it('returns null when nothing matches', () => {
    expect(matchCategory({ itemName: 'Zzzxq' })).toBeNull();
  });
  it('is case/diacritic tolerant', () => {
    expect(matchCategory({ itemName: 'KIYMA' })).toBe('MEAT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest procurement-category.matcher`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// procurement-category.matcher.ts
export type GuideCategory = 'MEAT' | 'PRODUCE' | 'DRY_GOODS' | 'DAIRY' | 'BEVERAGE' | 'PACKAGING' | 'CLEANING';

// Turkish-aware fold: lowercase with İ/I handling, strip diacritics for matching.
const fold = (s: string): string =>
  s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();

// Keyword lists are conservative; extend with the research report in Phase 3.
const KEYWORDS: Record<GuideCategory, string[]> = {
  MEAT: ['kiyma', 'dana', 'kuzu', 'et', 'tavuk', 'but', 'kanat', 'gogus', 'antrikot', 'biftek', 'sucuk', 'sosis', 'pastirma', 'balik', 'somon', 'levrek', 'cipura', 'hamsi', 'ton'],
  PRODUCE: ['domates', 'salatalik', 'biber', 'sogan', 'sarimsak', 'patates', 'marul', 'maydanoz', 'limon', 'elma', 'muz', 'portakal', 'yesillik', 'sebze', 'meyve', 'patlican', 'kabak', 'havuc'],
  DRY_GOODS: ['pirinc', 'bulgur', 'mercimek', 'nohut', 'fasulye', 'makarna', 'un', 'seker', 'tuz', 'salca', 'yag', 'zeytinyagi', 'baharat', 'bakliyat', 'kuru'],
  DAIRY: ['sut', 'peynir', 'yogurt', 'kaymak', 'tereyag', 'krema', 'ayran', 'yumurta', 'kasar', 'labne'],
  BEVERAGE: ['kola', 'gazoz', 'su', 'maden', 'meyve suyu', 'cay', 'kahve', 'icecek', 'soda', 'ayran', 'nektar'],
  PACKAGING: ['karton', 'kutu', 'ambalaj', 'poset', 'streç', 'strec', 'folyo', 'bardak', 'tabak', 'catal', 'kasik', 'pipet', 'servis', 'kese'],
  CLEANING: ['temizlik', 'deterjan', 'sabun', 'bez', 'eldiven', 'cop', 'hijyen', 'dezenfekt', 'kagit havlu', 'tuvalet', 'bulasik'],
};

const ORDER: GuideCategory[] = ['MEAT', 'PRODUCE', 'DRY_GOODS', 'DAIRY', 'BEVERAGE', 'PACKAGING', 'CLEANING'];

const scan = (text: string): GuideCategory | null => {
  const f = fold(text);
  for (const cat of ORDER) {
    if (KEYWORDS[cat].some((kw) => f.includes(kw))) return cat;
  }
  return null;
};

export const matchCategory = (input: { categoryName?: string | null; itemName: string }): GuideCategory | null =>
  (input.categoryName ? scan(input.categoryName) : null) ?? scan(input.itemName);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest procurement-category.matcher`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/stock-management/services/procurement-category.matcher.ts backend/src/modules/stock-management/services/procurement-category.matcher.spec.ts
git commit -m "feat(stock): add procurement category matcher"
```

---

### Task 6: Ruleset data constant (structure + conservative stub)

**Files:**
- Create: `backend/src/modules/stock-management/data/procurement-guide.data.ts`

**Interfaces:**
- Produces: `PROCUREMENT_GUIDE: ProcurementGuide` and exported types consumed by `guidance.service.ts` (Task 7). Phase 3 fills real content; this task ships a structurally-complete, conservative stub (no unverified percentage claims) plus the 6 verified facts already available.

- [ ] **Step 1: Write the data module (stub content, real structure)**

```ts
// backend/src/modules/stock-management/data/procurement-guide.data.ts
import type { GuideCategory } from '../services/procurement-category.matcher';

export type VolumeTier = 'SMALL_CAFE' | 'MID_RESTAURANT' | 'MULTI_BRANCH';
export type ChannelKey =
  | 'CASH_CARRY' | 'WHOLESALE_MARKET' | 'ONLINE_B2B'
  | 'PRODUCER_COOP' | 'LOCAL_BUTCHER_WHOLESALER' | 'DISTRIBUTOR';

export interface GuideSource { id: string; title: string; publisher: string; url: string; accessedAt: string; }
export interface ChannelAdvice {
  channelKey: ChannelKey;
  rankForTier: Record<VolumeTier, number>; // 1 = best; higher = worse; 0 = not recommended
  advantageNoteKey: string;  // i18n key (stock.json guide.*)
  minOrderNoteKey: string;
  paymentNoteKey: string;
  eInvoiceNoteKey: string;
  sourceIds: string[];
}
export interface CategoryGuide {
  categoryKey: GuideCategory;
  recommendationKeyByTier: Record<VolumeTier, string>; // one-liner i18n key
  channels: ChannelAdvice[];
  ruleKeys: string[]; // 2-3 practical-rule i18n keys
}
export interface ProcurementGuide {
  version: string;
  midTierMonthlySpendTRY: number; // tier threshold: annualized 90d spend ≥ this → MID_RESTAURANT
  categories: CategoryGuide[];
  sources: GuideSource[];
}

// v0 stub — structurally complete, conservative. Phase 3 replaces content
// from docs/research/2026-07-22-tr-restaurant-procurement-channels.md.
// The 6 verified facts already available are encoded as sources s1..s3.
export const PROCUREMENT_GUIDE: ProcurementGuide = {
  version: '2026-07-22.v0',
  midTierMonthlySpendTRY: 150000,
  sources: [
    { id: 's1', title: 'Metro Gastro Servis', publisher: 'Metro Türkiye', url: 'https://www.metro-tr.com/gastroservis', accessedAt: '2026-07-22' },
    { id: 's2', title: 'HORECA Ürünleri', publisher: 'Bizim Toptan', url: 'https://www.bizimtoptan.com.tr/horeca-urunleri', accessedAt: '2026-07-22' },
    { id: 's3', title: 'Sebze ve Meyve Ticareti — SSS', publisher: 'T.C. Ticaret Bakanlığı', url: 'https://ticaret.gov.tr/ic-ticaret/sikca-sorulan-sorular/sebze-ve-meyve-ticareti', accessedAt: '2026-07-22' },
  ],
  categories: (['MEAT', 'PRODUCE', 'DRY_GOODS', 'DAIRY', 'BEVERAGE', 'PACKAGING', 'CLEANING'] as GuideCategory[]).map(
    (categoryKey) => ({
      categoryKey,
      recommendationKeyByTier: {
        SMALL_CAFE: `guide.rec.${categoryKey}.SMALL_CAFE`,
        MID_RESTAURANT: `guide.rec.${categoryKey}.MID_RESTAURANT`,
        MULTI_BRANCH: `guide.rec.${categoryKey}.MULTI_BRANCH`,
      },
      channels: [],
      ruleKeys: [],
    }),
  ),
};
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/stock-management/data/procurement-guide.data.ts
git commit -m "feat(stock): add procurement guide ruleset scaffold (conservative v0)"
```

---

### Task 7: Guidance service (buy-list + tier + channel guide)

**Files:**
- Create: `backend/src/modules/stock-management/services/guidance.service.ts`
- Test: `backend/src/modules/stock-management/services/guidance.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (existing), `matchCategory` (Task 5), `PROCUREMENT_GUIDE` + types (Task 6). Reuse the reorder computation shape from `ReorderSuggestionService` where practical, but the buy-list needs the price-history join, so compute here.
- Produces: `GuidanceService.getGuidance(tenantId: string, branchId: string): Promise<GuidanceResponse>` with the exact response shape in the spec §5 (`volumeTier`, `buyList[]`, `channelGuide[]`, `Source` union). Consumed by the controller (Task 8).

- [ ] **Step 1: Write the failing spec (mock PrismaService)**

```ts
// guidance.service.spec.ts
import { Test } from '@nestjs/testing';
import { GuidanceService } from './guidance.service';
import { PrismaService } from '../../../prisma/prisma.service';

// Minimal prisma mock: only the models/queries the service uses.
const prismaMock = () => ({
  branch: { count: vi.fn?.() ?? jest.fn() },
  stockItem: { findMany: jest.fn() },
  purchaseOrderItem: { findMany: jest.fn() },
  supplierStockItem: { findMany: jest.fn() },
});

describe('GuidanceService', () => {
  let service: GuidanceService;
  let prisma: ReturnType<typeof prismaMock>;

  beforeEach(async () => {
    prisma = prismaMock();
    const mod = await Test.createTestingModule({
      providers: [GuidanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(GuidanceService);
  });

  it('infers MULTI_BRANCH when the tenant has >1 branch', async () => {
    prisma.branch.count.mockResolvedValue(3);
    prisma.stockItem.findMany.mockResolvedValue([]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance('t1', 'b1');
    expect(r.volumeTier).toBe('MULTI_BRANCH');
  });

  it('normalizes purchase-unit prices to base units when picking cheapest supplier', async () => {
    prisma.branch.count.mockResolvedValue(1);
    // One below-par item
    prisma.stockItem.findMany.mockResolvedValue([
      { id: 'i1', name: 'Dana Kıyma', unit: 'kg', currentStock: 1, minStock: 5, reorderQuantity: null, purchaseUnit: null, purchaseConversion: null, costPerUnit: '500', category: { name: 'Et' } },
    ]);
    // Two suppliers in PO history: supplier A sells by 10kg box at 4500 (=450/kg),
    // supplier B sells per kg at 470. Cheapest base-unit = A (450).
    prisma.purchaseOrderItem.findMany.mockResolvedValue([
      { stockItemId: 'i1', unitPrice: '4500', conversionFactor: 10, purchaseOrder: { supplierId: 'A', supplier: { name: 'Kasap Ali' }, submittedAt: new Date('2026-07-20'), createdAt: new Date('2026-07-20') } },
      { stockItemId: 'i1', unitPrice: '470', conversionFactor: null, purchaseOrder: { supplierId: 'B', supplier: { name: 'Metro' }, submittedAt: new Date('2026-07-18'), createdAt: new Date('2026-07-18') } },
      { stockItemId: 'i1', unitPrice: '4600', conversionFactor: 10, purchaseOrder: { supplierId: 'A', supplier: { name: 'Kasap Ali' }, submittedAt: new Date('2026-07-05'), createdAt: new Date('2026-07-05') } },
    ]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance('t1', 'b1');
    const line = r.buyList.find((l) => l.stockItemId === 'i1');
    expect(line?.recommended.type).toBe('OWN_HISTORY');
    expect(line?.recommended).toMatchObject({ supplierName: 'Kasap Ali' });
    // last base-unit price for A = 4500/10 = 450
    expect((line?.recommended as any).lastUnitPrice).toBeCloseTo(450, 4);
  });

  it('falls back to CATALOG then CHANNEL when history is thin', async () => {
    prisma.branch.count.mockResolvedValue(1);
    prisma.stockItem.findMany.mockResolvedValue([
      { id: 'i2', name: 'Domates', unit: 'kg', currentStock: 0, minStock: 10, reorderQuantity: null, purchaseUnit: null, purchaseConversion: null, costPerUnit: '30', category: { name: 'Sebze' } },
    ]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]); // no history
    prisma.supplierStockItem.findMany.mockResolvedValue([]); // no catalog
    const r = await service.getGuidance('t1', 'b1');
    const line = r.buyList.find((l) => l.stockItemId === 'i2');
    expect(line?.recommended.type).toBe('CHANNEL');
    expect((line?.recommended as any).categoryKey).toBe('PRODUCE');
  });

  it('always returns the 7-category channel guide for the tier', async () => {
    prisma.branch.count.mockResolvedValue(1);
    prisma.stockItem.findMany.mockResolvedValue([]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance('t1', 'b1');
    expect(r.channelGuide).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest guidance.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```ts
// guidance.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { matchCategory, type GuideCategory } from './procurement-category.matcher';
import { PROCUREMENT_GUIDE, type VolumeTier } from '../data/procurement-guide.data';

type Source =
  | { type: 'OWN_HISTORY'; supplierId: string; supplierName: string; lastUnitPrice: number; lastPurchaseAt: string; avgUnitPrice90d: number; trendPct: number | null; receiptCount: number }
  | { type: 'CATALOG'; supplierId: string; supplierName: string; unitPrice: number; isPreferred: boolean }
  | { type: 'CHANNEL'; categoryKey: GuideCategory; channelKey: string | null; recommendationKey: string };

export interface GuidanceResponse {
  volumeTier: VolumeTier;
  buyList: Array<{
    stockItemId: string; name: string; unit: string; currentStock: number; par: number; suggestedQty: number;
    purchaseUnit: string | null; purchaseQty: number | null;
    recommended: Source; alternatives: Source[];
  }>;
  channelGuide: Array<{
    categoryKey: GuideCategory; recommendationKey: string;
    detail: { channels: any[]; rules: string[] };
  }>;
}

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class GuidanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getGuidance(tenantId: string, branchId: string): Promise<GuidanceResponse> {
    const volumeTier = await this.inferTier(tenantId, branchId);

    const items = await this.prisma.stockItem.findMany({
      where: { branchId, isActive: true, minStock: { gt: 0 } },
      include: { category: { select: { name: true } } },
    });
    const belowPar = items.filter((i: any) => Number(i.currentStock) <= Number(i.minStock));

    const since180 = new Date(Date.now() - 180 * DAY);
    const history = belowPar.length
      ? await this.prisma.purchaseOrderItem.findMany({
          where: {
            stockItemId: { in: belowPar.map((i: any) => i.id) },
            purchaseOrder: {
              branchId,
              status: { in: ['SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
              createdAt: { gte: since180 },
            },
          },
          include: { purchaseOrder: { select: { supplierId: true, submittedAt: true, createdAt: true, supplier: { select: { name: true } } } } },
        })
      : [];

    const catalog = belowPar.length
      ? await this.prisma.supplierStockItem.findMany({
          where: { stockItemId: { in: belowPar.map((i: any) => i.id) } },
          include: { supplier: { select: { name: true } } },
        })
      : [];

    const buyList = belowPar.map((item: any) => {
      const par = Number(item.minStock);
      const cur = Number(item.currentStock);
      const suggestedQty = item.reorderQuantity != null ? Number(item.reorderQuantity) : Math.max(par * 2 - cur, par);
      const sources = this.sourcesForItem(item, history, catalog);
      return {
        stockItemId: item.id,
        name: item.name,
        unit: item.unit,
        currentStock: cur,
        par,
        suggestedQty,
        purchaseUnit: item.purchaseUnit ?? null,
        purchaseQty: item.purchaseUnit && item.purchaseConversion
          ? Math.ceil(suggestedQty / Number(item.purchaseConversion))
          : null,
        recommended: sources[0],
        alternatives: sources.slice(1, 3),
      };
    });

    const channelGuide = PROCUREMENT_GUIDE.categories.map((c) => ({
      categoryKey: c.categoryKey,
      recommendationKey: c.recommendationKeyByTier[volumeTier],
      detail: {
        channels: c.channels.map((ch) => ({
          channelKey: ch.channelKey,
          rankForTier: ch.rankForTier[volumeTier],
          advantageNote: ch.advantageNoteKey,
          minOrderNote: ch.minOrderNoteKey,
          paymentNote: ch.paymentNoteKey,
          eInvoiceNote: ch.eInvoiceNoteKey,
          sourceIds: ch.sourceIds,
        })),
        rules: c.ruleKeys,
      },
    }));

    return { volumeTier, buyList, channelGuide };
  }

  private async inferTier(tenantId: string, branchId: string): Promise<VolumeTier> {
    const branchCount = await this.prisma.branch.count({ where: { tenantId } });
    if (branchCount > 1) return 'MULTI_BRANCH';
    const since90 = new Date(Date.now() - 90 * DAY);
    const recent = await this.prisma.purchaseOrderItem.findMany({
      where: { purchaseOrder: { branchId, status: { in: ['SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED'] }, createdAt: { gte: since90 } } },
      select: { quantityOrdered: true, unitPrice: true },
    });
    const spend90 = recent.reduce((s: number, l: any) => s + Number(l.quantityOrdered) * Number(l.unitPrice), 0);
    const annualizedMonthly = (spend90 / 3);
    return annualizedMonthly >= PROCUREMENT_GUIDE.midTierMonthlySpendTRY ? 'MID_RESTAURANT' : 'SMALL_CAFE';
  }

  // Base-unit price = unitPrice / (conversionFactor ?? 1) — mirrors receive path.
  private baseUnitPrice(line: any): number {
    const factor = line.conversionFactor != null ? Number(line.conversionFactor) : 1;
    return Number(line.unitPrice) / (factor || 1);
  }

  private sourcesForItem(item: any, history: any[], catalog: any[]): Source[] {
    const sources: Source[] = [];

    // OWN_HISTORY: per supplier, need ≥2 lines for the item across 180d.
    const lines = history.filter((h) => h.stockItemId === item.id);
    const bySupplier = new Map<string, any[]>();
    for (const l of lines) {
      const sid = l.purchaseOrder.supplierId;
      if (!bySupplier.has(sid)) bySupplier.set(sid, []);
      bySupplier.get(sid)!.push(l);
    }
    const histSources: Source[] = [];
    const since90 = Date.now() - 90 * DAY;
    for (const [sid, ls] of bySupplier) {
      if (ls.length < 2) continue;
      const sorted = [...ls].sort(
        (a, b) => new Date(b.purchaseOrder.submittedAt ?? b.purchaseOrder.createdAt).getTime() - new Date(a.purchaseOrder.submittedAt ?? a.purchaseOrder.createdAt).getTime(),
      );
      const last = sorted[0];
      const lastUnitPrice = this.baseUnitPrice(last);
      const in90 = sorted.filter((l) => new Date(l.purchaseOrder.submittedAt ?? l.purchaseOrder.createdAt).getTime() >= since90);
      const avg90 = in90.length ? in90.reduce((s, l) => s + this.baseUnitPrice(l), 0) / in90.length : lastUnitPrice;
      let trendPct: number | null = null;
      if (in90.length >= 2) {
        const oldest = in90[in90.length - 1];
        const oldP = this.baseUnitPrice(oldest);
        if (oldP > 0) trendPct = Math.round(((lastUnitPrice - oldP) / oldP) * 100);
      }
      histSources.push({
        type: 'OWN_HISTORY',
        supplierId: sid,
        supplierName: last.purchaseOrder.supplier?.name ?? '—',
        lastUnitPrice,
        lastPurchaseAt: new Date(last.purchaseOrder.submittedAt ?? last.purchaseOrder.createdAt).toISOString(),
        avgUnitPrice90d: avg90,
        trendPct,
        receiptCount: ls.length,
      });
    }
    histSources.sort((a: any, b: any) => a.lastUnitPrice - b.lastUnitPrice); // cheapest first
    sources.push(...histSources);

    // CATALOG: SupplierStockItem unitPrice, cheapest first, preferred wins ties.
    const cat = catalog
      .filter((c) => c.stockItemId === item.id)
      .map((c): Source => ({ type: 'CATALOG', supplierId: c.supplierId, supplierName: c.supplier?.name ?? '—', unitPrice: Number(c.unitPrice), isPreferred: !!c.isPreferred }))
      .sort((a: any, b: any) => a.unitPrice - b.unitPrice || (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0));
    sources.push(...cat);

    // CHANNEL: always available as a last resort when a category matches.
    const categoryKey = matchCategory({ categoryName: item.category?.name ?? null, itemName: item.name });
    if (categoryKey) {
      const guide = PROCUREMENT_GUIDE.categories.find((c) => c.categoryKey === categoryKey);
      sources.push({
        type: 'CHANNEL',
        categoryKey,
        channelKey: null,
        recommendationKey: guide ? guide.recommendationKeyByTier.SMALL_CAFE : `guide.rec.${categoryKey}.SMALL_CAFE`,
      });
    }

    // Guarantee at least one source.
    if (sources.length === 0) {
      sources.push({ type: 'CHANNEL', categoryKey: 'DRY_GOODS', channelKey: null, recommendationKey: 'guide.rec.generic' });
    }
    return sources;
  }
}
```

Note: the spec's mock uses `vi.fn ?? jest.fn`; backend uses jest — write the spec with `jest.fn()` only (the `vi` reference is a guard for editors; remove it so backend jest runs clean). If the real Prisma client capitalizes enum status differently, align the `status: { in: [...] }` values with `backend/src/common/constants/stock-management.enum.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest guidance.service`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/stock-management/services/guidance.service.ts backend/src/modules/stock-management/services/guidance.service.spec.ts
git commit -m "feat(stock): add guidance service (buy-list, tier, channel guide)"
```

---

### Task 8: Guidance controller + module wiring

**Files:**
- Create: `backend/src/modules/stock-management/controllers/guidance.controller.ts`
- Test: `backend/src/modules/stock-management/controllers/guidance.controller.spec.ts`
- Modify: `backend/src/modules/stock-management/stock-management.module.ts`

**Interfaces:**
- Consumes: `GuidanceService` (Task 7). Follow `stock-dashboard.controller.ts` for guards/decorators/branch-scope resolution exactly (same base, same `@RequiresFeature(PlanFeature.INVENTORY_TRACKING)`, same role set, same way it obtains tenantId + branchId from the request).
- Produces: `GET /stock-management/guidance` → `GuidanceResponse`; a 5-minute in-memory cache per `${tenantId}:${branchId}`.

- [ ] **Step 1: Read the sibling controller**

Read `backend/src/modules/stock-management/controllers/stock-dashboard.controller.ts` in full — copy its decorator stack, its constructor, and exactly how it reads `tenantId`/`branchId` (e.g. `@CurrentTenant()`, `@BranchId()` or from `req`). Mirror that here; do not invent a new scope-resolution mechanism.

- [ ] **Step 2: Write the failing spec**

```ts
// guidance.controller.spec.ts
import { Test } from '@nestjs/testing';
import { GuidanceController } from './guidance.controller';
import { GuidanceService } from '../services/guidance.service';

describe('GuidanceController', () => {
  let controller: GuidanceController;
  const service = { getGuidance: jest.fn() };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [GuidanceController],
      providers: [{ provide: GuidanceService, useValue: service }],
    }).compile();
    controller = mod.get(GuidanceController);
    jest.clearAllMocks();
  });

  it('delegates to the service with tenant + branch scope', async () => {
    service.getGuidance.mockResolvedValue({ volumeTier: 'SMALL_CAFE', buyList: [], channelGuide: [] });
    // Call the handler the same way the sibling controller's spec does
    // (match the arg-passing style of stock-dashboard.controller.spec.ts).
    const res = await controller.getGuidance(/* tenant, branch per sibling pattern */ 't1' as any, 'b1' as any);
    expect(service.getGuidance).toHaveBeenCalledWith('t1', 'b1');
    expect(res.volumeTier).toBe('SMALL_CAFE');
  });

  it('serves a cached result within the TTL for the same tenant+branch', async () => {
    service.getGuidance.mockResolvedValue({ volumeTier: 'SMALL_CAFE', buyList: [], channelGuide: [] });
    await controller.getGuidance('t1' as any, 'b1' as any);
    await controller.getGuidance('t1' as any, 'b1' as any);
    expect(service.getGuidance).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Write the controller**

Mirror the sibling's guard/scope decorators (shown here with the common kds pattern — adjust to what the sibling actually uses):

```ts
// guidance.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { GuidanceService } from '../services/guidance.service';
// import the same guards/decorators the sibling stock-dashboard.controller uses:
// JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard, @Roles, @RequiresFeature,
// and the tenant/branch param decorators.

const TTL_MS = 5 * 60 * 1000;
interface Cached { at: number; value: any; }

@Controller('stock-management/guidance')
// @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
// @RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class GuidanceController {
  private cache = new Map<string, Cached>();
  constructor(private readonly guidance: GuidanceService) {}

  @Get()
  // @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getGuidance(/* @CurrentTenant() tenantId: string, @BranchId() branchId: string */ tenantId: string, branchId: string) {
    const key = `${tenantId}:${branchId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.guidance.getGuidance(tenantId, branchId);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
```

Replace the commented decorators/param-decorators with the concrete ones the sibling uses; keep the caching logic. If the sibling reads branch from `req` rather than a param decorator, adapt both the handler and the spec's call style to match.

- [ ] **Step 4: Wire into the module**

In `backend/src/modules/stock-management/stock-management.module.ts`: add `GuidanceController` to `controllers` and `GuidanceService` to `providers`.

- [ ] **Step 5: Run tests + build**

Run: `cd backend && npx jest guidance && npx tsc --noEmit -p tsconfig.json`
Expected: controller + service specs green; build clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/stock-management/controllers/guidance.controller.ts backend/src/modules/stock-management/controllers/guidance.controller.spec.ts backend/src/modules/stock-management/stock-management.module.ts
git commit -m "feat(stock): expose GET /stock-management/guidance"
```

---

### Task 9: Frontend guidance API hook

**Files:**
- Create: `frontend/src/features/stock-management/guidanceApi.ts`
- Test: `frontend/src/features/stock-management/guidanceApi.test.tsx`

**Interfaces:**
- Consumes: shared `api` client, `useBranchScopeStore` (both used throughout `stockManagementApi.ts` — copy the pattern).
- Produces: TS types mirroring `GuidanceResponse`/`Source`; `useGuidance()` → `UseQueryResult<GuidanceResponse>`, queryKey `['stock', 'guidance', branchId]`, `GET /stock-management/guidance`, `staleTime` 5 min.

- [ ] **Step 1: Write the failing test**

```tsx
// guidanceApi.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string }) => unknown) => sel({ branchId: 'b1' }),
}));

import api from '../../lib/api';
import { useGuidance, guidanceKeys } from './guidanceApi';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useGuidance', () => {
  it('GETs the guidance endpoint and keys by branch', async () => {
    (api.get as any).mockResolvedValue({ data: { volumeTier: 'SMALL_CAFE', buyList: [], channelGuide: [] } });
    const { result } = renderHook(() => useGuidance(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/stock-management/guidance');
    expect(result.current.data?.volumeTier).toBe('SMALL_CAFE');
    expect(guidanceKeys.guidance('b1')).toEqual(['stock', 'guidance', 'b1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/stock-management/guidanceApi.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// guidanceApi.ts
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export type GuideCategory = 'MEAT' | 'PRODUCE' | 'DRY_GOODS' | 'DAIRY' | 'BEVERAGE' | 'PACKAGING' | 'CLEANING';
export type VolumeTier = 'SMALL_CAFE' | 'MID_RESTAURANT' | 'MULTI_BRANCH';

export type GuidanceSource =
  | { type: 'OWN_HISTORY'; supplierId: string; supplierName: string; lastUnitPrice: number; lastPurchaseAt: string; avgUnitPrice90d: number; trendPct: number | null; receiptCount: number }
  | { type: 'CATALOG'; supplierId: string; supplierName: string; unitPrice: number; isPreferred: boolean }
  | { type: 'CHANNEL'; categoryKey: GuideCategory; channelKey: string | null; recommendationKey: string };

export interface BuyListItem {
  stockItemId: string; name: string; unit: string; currentStock: number; par: number; suggestedQty: number;
  purchaseUnit: string | null; purchaseQty: number | null;
  recommended: GuidanceSource; alternatives: GuidanceSource[];
}
export interface ChannelGuideEntry {
  categoryKey: GuideCategory; recommendationKey: string;
  detail: { channels: Array<{ channelKey: string | null; rankForTier: number; advantageNote: string; minOrderNote: string; paymentNote: string; eInvoiceNote: string; sourceIds: string[] }>; rules: string[] };
}
export interface GuidanceResponse { volumeTier: VolumeTier; buyList: BuyListItem[]; channelGuide: ChannelGuideEntry[]; }

export const guidanceKeys = {
  guidance: (branchId: string | null) => ['stock', 'guidance', branchId] as const,
};

export const useGuidance = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: guidanceKeys.guidance(branchId),
    queryFn: async (): Promise<GuidanceResponse> => (await api.get('/stock-management/guidance')).data,
    staleTime: 5 * 60 * 1000,
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/stock-management/guidanceApi.test.tsx`
Expected: passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/stock-management/guidanceApi.ts frontend/src/features/stock-management/guidanceApi.test.tsx
git commit -m "feat(stock): add useGuidance query hook"
```

---

### Task 10: GuidanceTab UI (buy-list + channel guide + draft-PO)

**Files:**
- Modify: `frontend/src/pages/admin/stock/GuidanceTab.tsx` (replace placeholder)
- Test: `frontend/src/pages/admin/stock/GuidanceTab.test.tsx`

**Interfaces:**
- Consumes: `useGuidance` (Task 9); `useCreatePurchaseOrder` (existing, `stockManagementApi.ts`); `useFormatCurrency`; `useNavigate` + `useSearchParams` (to jump to `?tab=orders` after creating a draft). i18n keys under `guide.*` (add the handful this UI needs — see Step 3 — to 5 locales).
- Produces: the Rehber tab — buy-list rows grouped by recommended supplier with a one-line "why", a per-group "Sipariş taslağı oluştur" button, a channel-guide grid of 7 expandable cards, and a tier segmented control (client-only view switch). Fail-soft on error; empty states.

- [ ] **Step 1: Write the failing test**

```tsx
// GuidanceTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const createPO = vi.fn();
vi.mock('./stock/../../../features/stock-management/guidanceApi', () => ({ useGuidance: () => globalThis.__guidance }));
vi.mock('../../../features/stock-management/stockManagementApi', () => ({
  useCreatePurchaseOrder: () => ({ mutate: createPO, isPending: false }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({ useFormatCurrency: () => (n: number) => `₺${n}` }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k) }) }));

import GuidanceTab from './GuidanceTab';

declare global { /* eslint-disable no-var */ var __guidance: any; /* eslint-enable no-var */ }

const q = (data: unknown) => ({ data, isLoading: false, isError: false });
const renderTab = () => render(<MemoryRouter><GuidanceTab /></MemoryRouter>);

beforeEach(() => {
  createPO.mockReset();
  globalThis.__guidance = q({
    volumeTier: 'SMALL_CAFE',
    buyList: [
      {
        stockItemId: 'i1', name: 'Dana Kıyma', unit: 'kg', currentStock: 1, par: 5, suggestedQty: 9,
        purchaseUnit: null, purchaseQty: null,
        recommended: { type: 'OWN_HISTORY', supplierId: 'A', supplierName: 'Kasap Ali', lastUnitPrice: 420, lastPurchaseAt: '2026-07-20', avgUnitPrice90d: 440, trendPct: 12, receiptCount: 3 },
        alternatives: [{ type: 'OWN_HISTORY', supplierId: 'B', supplierName: 'Metro', lastUnitPrice: 465, lastPurchaseAt: '2026-07-18', avgUnitPrice90d: 465, trendPct: null, receiptCount: 2 }],
      },
    ],
    channelGuide: Array.from({ length: 7 }, (_, i) => ({ categoryKey: ['MEAT','PRODUCE','DRY_GOODS','DAIRY','BEVERAGE','PACKAGING','CLEANING'][i], recommendationKey: `guide.rec.${i}`, detail: { channels: [], rules: [] } })),
  });
});

describe('GuidanceTab', () => {
  it('renders a buy-list row with supplier and price', () => {
    renderTab();
    expect(screen.getByText('Dana Kıyma')).toBeInTheDocument();
    expect(screen.getByText(/Kasap Ali/)).toBeInTheDocument();
    expect(screen.getByText(/₺420/)).toBeInTheDocument();
  });

  it('creates a draft PO for the recommended supplier group', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByTestId('draft-po-A'));
    expect(createPO).toHaveBeenCalledTimes(1);
    const arg = createPO.mock.calls[0][0];
    expect(arg.supplierId).toBe('A');
    expect(arg.items).toEqual([{ stockItemId: 'i1', quantityOrdered: 9, unitPrice: 420 }]);
  });

  it('renders the 7-card channel guide', () => {
    renderTab();
    expect(screen.getAllByTestId('channel-card')).toHaveLength(7);
  });

  it('shows the empty state when nothing is below par', () => {
    globalThis.__guidance = q({ volumeTier: 'SMALL_CAFE', buyList: [], channelGuide: [] });
    renderTab();
    expect(screen.getByTestId('buylist-empty')).toBeInTheDocument();
  });

  it('fails soft on error', () => {
    globalThis.__guidance = { data: undefined, isLoading: false, isError: true };
    renderTab();
    expect(screen.getByTestId('guidance-error')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/stock/GuidanceTab.test.tsx`
Expected: FAIL — placeholder GuidanceTab has none of this.

- [ ] **Step 3: Add the guide.* i18n keys (5 locales), then write GuidanceTab**

Add to each `stock.json` under a `guide` object the UI strings: `title` ("Tedarik Rehberi"/…), `buyNow` ("Bugün alınması gerekenler"), `channelGuide` ("Kanal rehberi"), `createDraft` ("Sipariş taslağı oluştur"), `cheapestRecent` ("son {{count}} alımda en ucuz"), `alt` ("alternatif: {{name}} {{price}}"), `trendUp`/`trendDown` ("↗ %{{pct}}/ay" / "↘ %{{pct}}/ay"), `buyListEmpty` ("Par altında malzeme yok 🎉"), `error` ("Rehber yüklenemedi"), `tier.SMALL_CAFE`/`tier.MID_RESTAURANT`/`tier.MULTI_BRANCH`, `viewAsTier` ("Şu ölçek için görüntüle"), plus `rec.generic` and `rec.<CATEGORY>.<TIER>` conservative one-liners (these can be short and safe now; Phase 3 refines). Mirror to en/ar/ru/uz.

```tsx
// GuidanceTab.tsx
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, TrendingUp, TrendingDown, Compass, ChevronDown } from 'lucide-react';
import { useGuidance, type GuidanceSource, type VolumeTier, type BuyListItem } from '../../../features/stock-management/guidanceApi';
import { useCreatePurchaseOrder } from '../../../features/stock-management/stockManagementApi';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { Card, CardContent } from '../../../components/ui/Card';

const priceOf = (s: GuidanceSource): number | null =>
  s.type === 'OWN_HISTORY' ? s.lastUnitPrice : s.type === 'CATALOG' ? s.unitPrice : null;
const supplierIdOf = (s: GuidanceSource): string | null =>
  s.type === 'CHANNEL' ? null : s.supplierId;
const supplierNameOf = (s: GuidanceSource): string | null =>
  s.type === 'CHANNEL' ? null : s.supplierName;

export default function GuidanceTab() {
  const { t } = useTranslation('stock');
  const formatCurrency = useFormatCurrency();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { data, isLoading, isError } = useGuidance();
  const createPO = useCreatePurchaseOrder();
  const [tierView, setTierView] = useState<VolumeTier | null>(null);

  const tier = tierView ?? data?.volumeTier ?? 'SMALL_CAFE';

  // Group buy-list rows by recommended supplier (channel-only rows go ungrouped).
  const groups = useMemo(() => {
    const m = new Map<string, { supplierId: string; supplierName: string; rows: BuyListItem[] }>();
    const loose: BuyListItem[] = [];
    for (const row of data?.buyList ?? []) {
      const sid = supplierIdOf(row.recommended);
      const sname = supplierNameOf(row.recommended);
      if (sid && sname) {
        if (!m.has(sid)) m.set(sid, { supplierId: sid, supplierName: sname, rows: [] });
        m.get(sid)!.rows.push(row);
      } else loose.push(row);
    }
    return { grouped: [...m.values()], loose };
  }, [data]);

  if (isError) return <p data-testid="guidance-error" className="text-sm text-slate-400 py-6">{t('guide.error', 'Rehber yüklenemedi')}</p>;

  const createDraft = (supplierId: string, rows: BuyListItem[]) => {
    createPO.mutate(
      {
        supplierId,
        items: rows.map((r) => ({
          stockItemId: r.stockItemId,
          quantityOrdered: r.suggestedQty,
          unitPrice: priceOf(r.recommended) ?? 0,
        })),
      } as any,
      {
        onSuccess: () => {
          setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'orders'); return n; });
          navigate('/admin/stock?tab=orders');
        },
      },
    );
  };

  const whyLine = (s: GuidanceSource): string => {
    if (s.type === 'OWN_HISTORY') {
      const base = t('guide.cheapestRecent', { count: s.receiptCount, defaultValue: `son ${s.receiptCount} alımda en ucuz` });
      return base;
    }
    if (s.type === 'CATALOG') return t('guide.catalogPrice', 'katalog fiyatı');
    return t(s.recommendationKey, t('guide.rec.generic', 'kanal rehberine göre önerilir'));
  };

  return (
    <div className="space-y-8">
      {/* Buy list */}
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('guide.buyNow', 'Bugün alınması gerekenler')}</h2>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : (data?.buyList.length ?? 0) === 0 ? (
          <p data-testid="buylist-empty" className="text-sm text-slate-500 py-4">{t('guide.buyListEmpty', 'Par altında malzeme yok 🎉')}</p>
        ) : (
          <div className="space-y-4">
            {groups.grouped.map((g) => {
              const total = g.rows.reduce((s, r) => s + (priceOf(r.recommended) ?? 0) * r.suggestedQty, 0);
              return (
                <Card key={g.supplierId}>
                  <CardContent className="py-4">
                    <ul className="space-y-2">
                      {g.rows.map((r) => {
                        const p = priceOf(r.recommended);
                        return (
                          <li key={r.stockItemId} className="flex items-center gap-3 text-sm">
                            <span className="flex-1 truncate text-slate-800">{r.name}</span>
                            <span className="tabular-nums text-slate-500">{r.suggestedQty} {r.unit}</span>
                            <span className="tabular-nums font-semibold text-slate-900">{p != null ? `${formatCurrency(p)}/${r.unit}` : '—'}</span>
                            <span className="hidden sm:flex items-center gap-1 text-xs text-slate-400 min-w-0">
                              {whyLine(r.recommended)}
                              {r.recommended.type === 'OWN_HISTORY' && r.recommended.trendPct != null && (
                                r.recommended.trendPct >= 0
                                  ? <TrendingUp className="h-3 w-3 text-rose-500" />
                                  : <TrendingDown className="h-3 w-3 text-green-600" />
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm text-slate-600">{g.supplierName} · {g.rows.length} · ~{formatCurrency(total)}</span>
                      <button
                        data-testid={`draft-po-${g.supplierId}`}
                        onClick={() => createDraft(g.supplierId, g.rows)}
                        disabled={createPO.isPending}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <ShoppingCart className="h-4 w-4" />
                        {t('guide.createDraft', 'Sipariş taslağı oluştur')}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {groups.loose.length > 0 && (
              <Card>
                <CardContent className="py-4">
                  <ul className="space-y-2">
                    {groups.loose.map((r) => (
                      <li key={r.stockItemId} className="flex items-center gap-3 text-sm">
                        <span className="flex-1 truncate text-slate-800">{r.name}</span>
                        <span className="tabular-nums text-slate-500">{r.suggestedQty} {r.unit}</span>
                        <span className="flex items-center gap-1 text-xs text-slate-400"><Compass className="h-3 w-3" />{whyLine(r.recommended)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* Channel guide */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-heading font-semibold text-slate-900">{t('guide.channelGuide', 'Kanal rehberi')}</h2>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
            {(['SMALL_CAFE', 'MID_RESTAURANT', 'MULTI_BRANCH'] as VolumeTier[]).map((tv) => (
              <button
                key={tv}
                onClick={() => setTierView(tv)}
                className={`px-2.5 py-1 rounded-md ${tier === tv ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
              >
                {t(`guide.tier.${tv}`, tv)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(data?.channelGuide ?? []).map((c) => <ChannelCard key={c.categoryKey} entry={c} />)}
        </div>
      </section>
    </div>
  );
}

function ChannelCard({ entry }: { entry: { categoryKey: string; recommendationKey: string; detail: { channels: any[]; rules: string[] } } }) {
  const { t } = useTranslation('stock');
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="channel-card" className="rounded-xl border border-slate-200/60 bg-white p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{t(`guide.cat.${entry.categoryKey}`, entry.categoryKey)}</div>
          <div className="text-sm text-slate-800 mt-0.5">{t(entry.recommendationKey, t('guide.rec.generic', ''))}</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {entry.detail.rules.map((rk, i) => <li key={i}>• {t(rk, rk)}</li>)}
        </ul>
      )}
    </div>
  );
}
```

Note: the test's mock path for `guidanceApi` must resolve to the same module the component imports — adjust the `vi.mock` path in the test to `'../../../features/stock-management/guidanceApi'` to match the component's import (fix the placeholder path shown in the test before running).

- [ ] **Step 4: Run test + i18n parity**

Run: `cd frontend && npx vitest run src/pages/admin/stock/GuidanceTab.test.tsx` then from repo root `node scripts/check-i18n-parity.mjs`.
Expected: 5 passed; parity clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/stock/GuidanceTab.tsx frontend/src/pages/admin/stock/GuidanceTab.test.tsx frontend/src/i18n/locales/*/stock.json
git commit -m "feat(stock): build the Tedarik Rehberi tab with one-click draft PO"
```

---

### Task 11: Supplier price-catalog UI (revive dead hooks) + slot into SuppliersHub

**Files:**
- Create: `frontend/src/features/stock-management/components/SupplierCatalog.tsx`
- Test: `frontend/src/features/stock-management/components/SupplierCatalog.test.tsx`
- Modify: `frontend/src/pages/admin/stock/SuppliersHub.tsx` (mount the catalog)

**Interfaces:**
- Consumes (existing, currently-dead hooks — revive them): `useSuppliers`, `useSupplier` (per-supplier detail incl. `supplierStockItems`), `useStockItems`, `useAddSupplierItem` (POST `/suppliers/:supplierId/items` — `{ stockItemId, unitPrice, supplierSku?, isPreferred? }`), `useRemoveSupplierItem`. Confirm the exact mutation arg shape against `stockManagementApi.ts` before writing.
- Produces: `SupplierCatalog` — pick a supplier, see its linked items (supplierSku, unitPrice, preferred), add/remove item links with a price. Feeds the guidance CATALOG source.

- [ ] **Step 1: Confirm the mutation arg shapes**

Run: `grep -n "useAddSupplierItem\|useRemoveSupplierItem\|useSupplier\b" -A 12 frontend/src/features/stock-management/stockManagementApi.ts` and note the exact `mutate` argument object shapes; write the component + test to those shapes.

- [ ] **Step 2: Write the failing test**

```tsx
// SupplierCatalog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const addItem = vi.fn();
const removeItem = vi.fn();
vi.mock('../stockManagementApi', () => ({
  useSuppliers: () => ({ data: [{ id: 'A', name: 'Kasap Ali' }], isLoading: false }),
  useSupplier: (id: string | null) => ({ data: id ? { id, name: 'Kasap Ali', supplierStockItems: [{ stockItemId: 'i1', stockItem: { name: 'Dana Kıyma', unit: 'kg' }, unitPrice: '420', supplierSku: 'KA-01', isPreferred: true }] } : undefined }),
  useStockItems: () => ({ data: [{ id: 'i1', name: 'Dana Kıyma', unit: 'kg' }, { id: 'i2', name: 'Kuzu', unit: 'kg' }] }),
  useAddSupplierItem: () => ({ mutate: addItem, isPending: false }),
  useRemoveSupplierItem: () => ({ mutate: removeItem, isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k) }) }));

import SupplierCatalog from './SupplierCatalog';

describe('SupplierCatalog', () => {
  beforeEach(() => { addItem.mockReset(); removeItem.mockReset(); });

  it('lists a selected supplier\'s catalog items with price and preferred flag', () => {
    render(<SupplierCatalog />);
    expect(screen.getByText('Dana Kıyma')).toBeInTheDocument();
    expect(screen.getByText(/420/)).toBeInTheDocument();
    expect(screen.getByText('KA-01')).toBeInTheDocument();
  });

  it('removes a catalog link', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<SupplierCatalog />);
    await user.click(screen.getByTestId('remove-i1'));
    expect(removeItem).toHaveBeenCalledWith({ supplierId: 'A', stockItemId: 'i1' });
  });
});
```

- [ ] **Step 3: Write the component**

Write `SupplierCatalog.tsx` to the confirmed hook shapes: a supplier `<select>` (first supplier auto-selected), a table of `supplierStockItems` (item name, supplierSku, unitPrice, preferred badge, remove button `data-testid="remove-<stockItemId>"`), and an "add link" row (stock-item select + price input + preferred checkbox → `useAddSupplierItem`). Match the remove mutation arg exactly to what `useRemoveSupplierItem` expects (the test asserts `{ supplierId, stockItemId }` — align both).

- [ ] **Step 4: Slot into SuppliersHub**

In `frontend/src/pages/admin/stock/SuppliersHub.tsx`, import and render `<SupplierCatalog />` in the section marked `{/* Phase 2 slots <SupplierCatalog /> here */}`, under an `<h2>{t('sections.catalog')}</h2>`.

- [ ] **Step 5: Run test + typecheck**

Run: `cd frontend && npx vitest run src/features/stock-management/components/SupplierCatalog.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: 2 passed; clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/stock-management/components/SupplierCatalog.tsx frontend/src/features/stock-management/components/SupplierCatalog.test.tsx frontend/src/pages/admin/stock/SuppliersHub.tsx
git commit -m "feat(stock): add supplier price-catalog UI (feeds guidance)"
```

---

### Task 12: Phase 1-2 verification pass

**Files:** none (verification + fixes only)

- [ ] **Step 1: Full frontend suite**

Run: `cd frontend && npm run test:ci`
Expected: all green (baseline + new). Investigate any failure — especially any residual import of the three deleted pages.

- [ ] **Step 2: Full backend stock-management suite**

Run: `cd backend && npx jest stock-management`
Expected: green (existing + guidance service/controller).

- [ ] **Step 3: Lint + i18n gates**

Run: `cd frontend && npm run lint` and from repo root `node scripts/check-i18n-parity.mjs && node scripts/check-i18n-value-drift.mjs`.
Expected: clean. Add legitimately-identical new keys to `scripts/i18n-value-drift-baseline.json` if value-drift flags them (don't reword correct translations).

- [ ] **Step 4: Builds**

Run: `cd frontend && npm run build` and `cd backend && npm run build`.
Expected: both succeed.

- [ ] **Step 5: Visual verification (Chromium, jsdom-misses-layout lesson)**

Launch the app, log in as admin, open `/admin/stock`: confirm 6 tabs, `?tab` deep-links (reload on `?tab=suppliers` stays there), the Rehber buy-list + draft-PO jump to Siparişler, the channel-guide cards expand, and mobile width keeps the tab row scrollable and cards stacked. Screenshot the Rehber and Tedarikçiler tabs.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "test(stock): fix up integration issues from the 6-tab + guidance pass"
```

---

## PHASE 3 — Content + docs (research-gated)

> Do this task ONLY after the deep-research workflow completes (or with the 6 already-verified facts if research stays blocked). It changes DATA and COPY, not structure — Phases 1-2 ship independently.

### Task 13: Fill the ruleset + guide strings + report + help docs

**Files:**
- Modify: `backend/src/modules/stock-management/data/procurement-guide.data.ts` (real channel content per category/tier + sources)
- Modify: `frontend/src/i18n/locales/*/stock.json` (`guide.rec.*`, channel note keys, rule keys — 5 locales)
- Create: `docs/research/2026-07-22-tr-restaurant-procurement-channels.md` (the cited report)
- Modify: `help/pages/{tr,en}/admin-guide/stock.mdx` (rewrite for the 6-tab layout)

- [ ] **Step 1: Write the research report**

Assemble `docs/research/2026-07-22-tr-restaurant-procurement-channels.md` from the deep-research output: channel × category × tier recommendations, each with a source citation and the confidence. Exclude any claim that failed verification; where evidence is weak, state the conservative recommendation and say so. Encode every source as `{id, title, publisher, url, accessedAt}`.

- [ ] **Step 2: Fill the ruleset data**

Populate `PROCUREMENT_GUIDE.categories[].channels` and `ruleKeys` and `recommendationKeyByTier`, and `sources`, from the report. Every `sourceIds` entry must reference a real `sources[].id`. Keep `midTierMonthlySpendTRY` aligned with the report's tier reasoning. Add a jest test asserting: every `channels[].sourceIds` resolves to a known source id, and every category has a recommendation for all 3 tiers.

```ts
// add to a new procurement-guide.data.spec.ts
import { PROCUREMENT_GUIDE } from './procurement-guide.data';
describe('PROCUREMENT_GUIDE integrity', () => {
  const ids = new Set(PROCUREMENT_GUIDE.sources.map((s) => s.id));
  it('every channel source id resolves', () => {
    for (const c of PROCUREMENT_GUIDE.categories)
      for (const ch of c.channels)
        for (const sid of ch.sourceIds) expect(ids.has(sid)).toBe(true);
  });
  it('every category recommends for all three tiers', () => {
    for (const c of PROCUREMENT_GUIDE.categories)
      for (const tier of ['SMALL_CAFE', 'MID_RESTAURANT', 'MULTI_BRANCH'] as const)
        expect(c.recommendationKeyByTier[tier]).toBeTruthy();
  });
});
```

- [ ] **Step 3: Fill the guide.* i18n strings (5 locales)**

For every key referenced by the ruleset (`guide.rec.<CATEGORY>.<TIER>`, channel note keys, rule keys) add real translated strings to all 5 `stock.json`. Verify `node scripts/check-i18n-parity.mjs`.

- [ ] **Step 4: Rewrite the help docs**

Rewrite `help/pages/tr/admin-guide/stock.mdx` and its `en` mirror for the 6-tab layout (Tedarik Rehberi, Malzemeler, Siparişler, Tedarikçiler, Reçete & Maliyet, Operasyon), documenting the Rehber and the `?tab` deep-links.

- [ ] **Step 5: Verify + commit**

Run: `cd backend && npx jest procurement-guide.data && cd ../ && node scripts/check-i18n-parity.mjs`.

```bash
git add backend/src/modules/stock-management/data/ frontend/src/i18n/locales/*/stock.json docs/research/2026-07-22-tr-restaurant-procurement-channels.md help/pages/tr/admin-guide/stock.mdx help/pages/en/admin-guide/stock.mdx
git commit -m "feat(stock): fill procurement guide content from cited research"
```

---

## Final integration (after all tasks)

- [ ] Full suites once more: `cd frontend && npm run test:ci` and `cd backend && npx jest stock-management`.
- [ ] `cd frontend && npm run lint` (prettier gate: `lint:ci` has no `--fix`).
- [ ] Push `feat/stock-procurement-guidance` via `scripts/push-via-openssl.sh`; open PR to `main` via `gh`; NO AI markers anywhere. (Phases can ship as separate PRs — Phase 1 alone is a coherent shippable simplification.)
