# Dashboard Redesign — Design Spec

**Date:** 2026-07-21
**Scope:** `frontend/src/pages/DashboardPage.tsx` + small shared-UI additions. Frontend-only; no backend changes, no migrations.
**Decisions (user-approved):** operational + business hybrid ("komuta merkezi" layout A); selected-branch scope only; refine the existing visual language (slate/white + orange-500 accent); include the Outfit font-loading fix.

## 1. Problem

The current dashboard is a launcher: a large POS hero card, an 8-item shortcut grid, and two thin strips (today's sales KPI pills, quota pills). It answers "where do I go?" but not "is everything OK right now?". Known defects: stale deeplinks (`/admin/users`, `/admin/settings/subscription`), COURIER sees a completely blank page, `font-heading` (Outfit) is declared but never loaded, and the page is locked to `h-[calc(100vh-10rem)]`.

## 2. Goals

A restaurant owner opening the page answers in ~5 seconds: how is today going (money), what needs my attention right now (ops), and what should I look into (stock/insights) — with navigation still one click away. All widgets reuse **existing** React Query hooks; plan-gated widgets render nothing when the feature is absent (never fire 403ing queries).

## 3. Page structure (ADMIN / MANAGER)

Root keeps `data-tour="dashboard-container"`. Fixed height removed; page scrolls naturally (`space-y-6`).

1. **Greeting header** — time-of-day greeting + user first name, subtitle with long-format date. Existing h1 convention (`text-2xl font-heading font-bold text-slate-900`).
2. **SetupChecklist** — unchanged (self-hides when complete).
3. **KPI row** — `grid grid-cols-2 lg:grid-cols-4 gap-4`:
   - *Bugünkü Ciro*, *Sipariş*, *Ort. Sepet*: `useSalesReport({today, tomorrow})` + `useSalesComparison` → `metricTrend` vs-yesterday arrows. Gated behind `hasFeature('advancedReports')` via the wrapper-component pattern (wrapper checks the feature, inner component calls hooks unconditionally — rules of hooks).
   - *Açık Masa*: `useTables()` → `OCCUPIED/total`. No plan gate.
   - Values `text-3xl font-bold tabular-nums`; rendered with the new shared `ui/StatCard`.
4. **Live ops strip** — `grid grid-cols-2 lg:grid-cols-4 gap-4`, compact clickable cards, each `refetchInterval: 30_000` + `refetchOnWindowFocus`:
   - *Mutfak kuyruğu*: `useOrders({status:'PENDING,PREPARING,READY'})` → per-status counts → links `/kitchen`. No plan gate.
   - *Onay bekleyen*: `usePendingOrders()` (PENDING_APPROVAL) → links `/pos`.
   - *Çağrılar*: `useWaiterRequests()` + `useBillRequests()` combined count → links `/pos`.
   - *Bugünkü rezervasyonlar*: `useReservationStats(today)` (pending+confirmed shown) → links `/admin/reservations`. Gated `reservationSystem`.
5. **Middle row** — `grid lg:grid-cols-3 gap-4`:
   - *Saatlik Satış* (lg:col-span-2): `useOrdersByHour(today)` → hand-rolled div-bar chart (no chart lib), trimmed to the active window (first→last hour with data, min span fallback), current hour highlighted, orange-500 fill on slate-100 track, order-count + revenue on hover/label. Footer link "Detaylı rapor →" `/admin/reports`. Gated `advancedReports`.
   - *Dikkat paneli* (lg:col-span-1): low-stock top-5 from `useLowStockItems()` (gated `inventoryTracking`, rose-toned rows, link `/admin/stock`) + top-3 `useActionableInsights()` (gated `advancedReports`, severity-colored: CRITICAL rose / WARNING amber / INFO slate, link `/admin/reports`). If both gates are off the panel is omitted and the chart spans full width. `staleTime` 5 min.
6. **Bottom row** — `grid lg:grid-cols-3 gap-4`:
   - *En Çok Satanlar (bugün)* (lg:col-span-2): `useTopProducts({today, tomorrow})` top-5 with quantity + revenue. Gated `advancedReports`.
   - *Kısayollar* (lg:col-span-1): compact icon grid of the role-filtered quick actions, keeps `data-tour="quick-actions"`. POS is the first tile with primary (orange) styling — the big hero card is removed from the ADMIN/MANAGER view. Fixed links: Ekip → `/admin/team` (label `navigation.team`), Ayarlar → `/admin/settings`.
7. **Quota strip** — moves to the page bottom as one slim row of pills (same `useGetUsageSnapshot`, same warn ≥80% amber / full ≥100% rose treatment, links `/admin/plan`).

Widgets whose plan gate is off simply do not render (row grids auto-flow); no upsell cards on the dashboard.

## 4. Role variants

- **WAITER:** greeting + large POS hero card (kept — POS is their front door) + Açık Masa and Çağrılar ops cards + Müşteriler shortcut.
- **KITCHEN:** greeting + large Mutfak hero card + kitchen queue counts card.
- **COURIER:** currently a blank page (bug). Now: greeting + Profil and Yardım link cards.
- ADMIN/MANAGER-only sections (SetupChecklist, KPI, chart, attention, quota) stay role-checked exactly as today.

## 5. Visual language

- Existing `Card`/`Badge` components; `rounded-xl`, `border-slate-200/60`, `shadow-sm`; section titles via `CardTitle`.
- Accent = brand `primary-500` (orange) for chart fill, POS tile, active elements. Status colors: rose (critical/out-of-stock), amber (warning/quota-warn), green (positive trends).
- `ReportsPage`'s local `StatCard` is promoted to shared `ui/StatCard` (props: title, value, icon, iconTone, trend?, hint?); ReportsPage switches to the shared one.
- New `ui/Skeleton` component (thin wrapper over the existing `.animate-shimmer` utility); all dashboard widgets show skeleton blocks while loading instead of "…".
- **Font fix:** add Outfit to the Google Fonts request in `frontend/index.html` so `font-heading` renders as configured (app-wide, intended design finally applied).
- RTL: rely on flex/grid + existing `[dir=rtl]` rules; no hardcoded left/right margins in new components (use `gap`, `ms-`/`me-` where needed).

## 6. Data / refresh / failure policy

- Ops tiles: `refetchInterval` 30 s. Sales/hourly/top-products: `staleTime` 60 s (React Query default refetch on mount/focus). Low stock + insights: `staleTime` 5 min. No socket wiring on the dashboard (kept simple; POS/KDS screens remain the real-time surfaces).
- Every widget owns its states: loading → skeleton; error → one-line muted message inside the card (page never breaks); empty → friendly copy (e.g. "Bugün henüz satış yok").
- All hooks are branch-scoped by convention (branchId in query key + `X-Branch-Id` header); switching branch in the header refreshes the whole dashboard automatically.

## 7. i18n

New keys under `common.json` → `dashboard.*` (greeting variants, section titles, ops labels, empty/error strings), mirrored to all 5 locales (tr/en/ar/ru/uz — CI locale-parity gate enforces this). Reuse existing keys where present (`todaysSales`, `todaysOrders`, `vsYesterday`, quota keys, navigation labels).

## 8. Testing

- New `DashboardPage.spec.tsx` following the neighborhood pattern (vi.mock the `*Api` modules, render under `QueryClientProvider` + `MemoryRouter`): role variants (ADMIN full layout, WAITER hero, KITCHEN hero, COURIER non-blank), plan-gating (no `advancedReports` → no KPI/chart/top-products and no gated query firing), corrected links (`/admin/team`), tour anchors present.
- `ui/StatCard.test.tsx`, `ui/Skeleton.test.tsx`. ReportsPage existing tests must stay green after the StatCard swap.
- Full frontend vitest suite green before PR; then branch → PR → merge → tag → CI deploy (standard flow).

## 9. Out of scope

Backend/API changes; dark mode; chart libraries; Reports page's blue accent (left as-is); sidebar/navigation changes; camera analytics (inert); cross-branch aggregate views.
