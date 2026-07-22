# Stok Sadeleşmesi + Tedarik Rehberi — Design Spec

**Date:** 2026-07-22
**Branch:** `feat/stock-procurement-guidance` (worktree)
**Decisions (user-approved):** hybrid guidance source (curated Türkiye channel guide + tenant's own purchase history); single-level 6-tab IA with Tedarik Rehberi as the landing tab; guidance UI must stay simple — depth lives in the data/research, not the screen.

## 1. Problem

`/admin/stock` is a 3-level hierarchy: 3 groups (Envanter / Satın Alma / Maliyet & Reçete) × 18 leaf tabs, all in local `useState` (no URL sync — every visit resets). Duplicated concepts across groups ("Satın Alma" twice, suppliers twice, recipes twice), PurchasingPage tab labels hardcoded Turkish (4 locales broken), 13 dead API hooks including the entire supplier-item price catalog (`useAddSupplierItem`/`useRemoveSupplierItem` — no UI exists), and the Sipariş Önerileri tab is display-only (no create-PO action). Customers cannot follow the procurement process, and the product gives zero guidance on WHERE to buy or at what price.

## 2. Goals

1. One-level, 6-tab Stok section a restaurant operator can follow without training.
2. A **Tedarik Rehberi** landing tab that answers, per item: *what to buy today, from where, at what price, why* — one line each, with a one-click draft-PO action.
3. The "why" is backed by (a) the tenant's own purchase-price history and (b) a deeply-researched, source-cited Türkiye supply-channel ruleset. Research depth stays behind the UI.
4. No schema migration; frontend + one read-only backend endpoint + one versioned data file.

## 3. Information architecture — 6 tabs, single level

Route stays `/admin/stock` (FeatureGate `inventoryTracking`, roles ADMIN+MANAGER). Active tab syncs to the URL as `?tab=<id>` (same pattern as Tables' `?view`, v3.2.128); back/forward and deep links work. `StockPage.tsx` is rebuilt as the single tab shell; `StockManagementPage`/`PurchasingPage`/`CostingPage` are dismantled (their tab components are re-parented, not rewritten).

| # | Tab id (`?tab=`) | TR label | Contents (existing components re-parented) |
|---|---|---|---|
| 1 | `guide` (default) | Tedarik Rehberi | NEW GuidanceTab (section 4) |
| 2 | `items` | Malzemeler | StockItemsTab + category manager; header stat cards (from StockDashboard: toplam/aktif/düşük stok/yaklaşan SKT) + tek Değerleme kartı (useStockValuation — dead hook revived) |
| 3 | `orders` | Siparişler | PurchaseOrdersTab (full PO lifecycle) + PO templates + receive + barcode lookup + supplier return (RMA) — the "Şablonlar & Barkod" tab dissolves in here |
| 4 | `suppliers` | Tedarikçiler | SuppliersTab (CRUD) + NEW supplier-item price catalog UI (revives `useAddSupplierItem`/`useRemoveSupplierItem`/`useSupplier`; per-supplier item list: supplierSku, unitPrice, isPreferred) + scorecard + VendorBillsTab + AP aging — as stacked sub-sections with anchor nav, not tabs |
| 5 | `costing` | Reçete & Maliyet | RecipesTab (CRUD, from Envanter) + recipe costing + menu engineering + usage variance (CostingPage content) |
| 6 | `operations` | Operasyon | MovementsTab + WasteLogTab + StockCountsTab + branch transfers — as a small secondary switcher inside the tab (4 dense admin screens; still one level below the main row, but this is the only tab with an inner switcher and it is labeled as such) |

**Removed as standalone surfaces:** Gösterge Paneli (stats fold into Malzemeler header + Rehber), Sipariş Önerileri (becomes Rehber), Stok Değerleme (card in Malzemeler), Şablonlar & Barkod (inside Siparişler), Tedarikçi Faturaları / Borç Yaşlandırma / Tedarikçi Karnesi (inside Tedarikçiler), Şube Transferleri (inside Operasyon), the 3-group pill switcher itself.

**Redirects:** `/admin/purchasing` → `/admin/stock?tab=orders`; `/admin/costing` → `/admin/stock?tab=costing` (update the existing `Navigate` targets).

**i18n:** new `tabs.*` keys + all currently-hardcoded PurchasingPage labels move to `stock.json`, mirrored to 5 locales (CI parity gate).

## 4. Tedarik Rehberi tab

Two sections, nothing else:

### 4a. "Bugün alınması gerekenler"

One row per below-par item (from the existing reorder computation), grouped by recommended supplier where possible:

```
Dana kıyma   12 kg önerilen   → Kasap Ali  ₺420,00/kg   son 3 alımda en ucuz (Metro ₺465) ↗ %12/ay
Domates      25 kg önerilen   → 💡 Hal'den alın — kafe hacminde %15-25 daha uygun
[Kasap Ali için sipariş taslağı oluştur (3 kalem, ~₺6.940)]
```

- **Source priority per item:** `OWN_HISTORY` (≥2 receipts of this item in the last 180 days → cheapest supplier by most-recent base-unit price, with runner-up price and trend arrow) → `CATALOG` (cheapest linked `SupplierStockItem.unitPrice`) → `CHANNEL` (curated rule matched by category/keyword).
- **Draft-PO action:** per recommended-supplier group, one button creates a DRAFT purchase order via the existing `POST /stock-management/purchase-orders` with the suggested lines; navigates to `?tab=orders` with the new PO highlighted. (Fixes the display-only reorder gap.)
- Empty state: "Par altında malzeme yok 🎉" + link to Malzemeler for setting `minStock` if fewer than 3 items have par levels.

### 4b. "Kanal rehberi"

Seven category cards (Et/Tavuk/Balık, Sebze-Meyve, Kuru Gıda/Bakliyat, Süt/Kahvaltılık, İçecek, Ambalaj/Sarf, Temizlik/Hijyen). Card face: category icon + one-line recommendation for the tenant's volume tier. Expanding a card shows the short detail: recommended channel(s) ranked, typical price advantage, minimum order/delivery, payment-term practice, e-fatura note, 2-3 practical rules — all from the curated ruleset, each with a source reference id (rendered as a subtle "Kaynak" tooltip/footnote).

- **Volume tier** (`SMALL_CAFE` / `MID_RESTAURANT` / `MULTI_BRANCH`): inferred server-side — `branchCount > 1` → MULTI_BRANCH; else received-PO spend over the last 90 days annualized ≥ the ruleset's `midTierMonthlySpendTRY` threshold → MID_RESTAURANT; else SMALL_CAFE. A small segmented control lets the user view another tier (client-side only, not persisted).

## 5. Backend — `GET /stock-management/guidance`

New read-only endpoint in the stock-management module (controller-level `@RequiresFeature(PlanFeature.INVENTORY_TRACKING)`, ADMIN+MANAGER — deliberately NOT the analytics/insights rail, whose ADVANCED_REPORTS gate would mismatch the page). No cron; computed per request; 5-minute in-memory cache per (tenant, branch).

Response shape:

```ts
{
  volumeTier: 'SMALL_CAFE' | 'MID_RESTAURANT' | 'MULTI_BRANCH',
  buyList: [{
    stockItemId, name, unit, currentStock, par, suggestedQty,
    purchaseUnit: string | null, purchaseQty: number | null,
    recommended: Source,          // highest-priority source
    alternatives: Source[],       // 0-2 runners-up for the "why" line
  }],
  channelGuide: [{
    categoryKey: 'MEAT'|'PRODUCE'|'DRY_GOODS'|'DAIRY'|'BEVERAGE'|'PACKAGING'|'CLEANING',
    recommendationKey: string,    // i18n key for the one-liner (per tier)
    detail: { channels: [{ channelKey, rankForTier, advantageNote, minOrderNote, paymentNote, eInvoiceNote, sourceIds: string[] }], rules: string[] /* i18n keys */ }
  }]
}

Source =
  | { type: 'OWN_HISTORY', supplierId, supplierName, lastUnitPrice, lastPurchaseAt, avgUnitPrice90d, trendPct: number|null, receiptCount }
  | { type: 'CATALOG', supplierId, supplierName, unitPrice, isPreferred }
  | { type: 'CHANNEL', categoryKey, channelKey, recommendationKey }
```

**Price history derivation (money-sensitive, unit-tested):** join `PurchaseOrderItem` × `PurchaseOrder` (status SUBMITTED/PARTIALLY_RECEIVED/RECEIVED, last 180 days, branch-scoped). Base-unit price = `unitPrice / (conversionFactor ?? 1)` (mirrors the receive path's math). Per (item, supplier): `lastUnitPrice` = price on the most recent line; `avgUnitPrice90d` = mean over 90 days; `trendPct` = (last − first-in-90d)/first-in-90d, null with <2 points. `OWN_HISTORY` requires ≥2 lines across the 180-day window for the item; recommended supplier = lowest `lastUnitPrice`.

**Category matcher:** stock category name first, then item name, against per-guide-category Turkish keyword lists (e.g. MEAT: kıyma, dana, kuzu, tavuk, but, antrikot, sucuk, balık, somon…); unmatched → generic advice line (no card-level claim). Matcher is a pure function with its own spec.

## 6. Curated ruleset + research

The deep-research workflow (running; cross-verified, source-cited) produces:
- `backend/src/modules/stock-management/data/procurement-guide.data.ts` — versioned constant: channels (CASH_CARRY, WHOLESALE_MARKET/hal, ONLINE_B2B, PRODUCER_COOP, LOCAL_BUTCHER_WHOLESALER, DISTRIBUTOR) × 7 categories × 3 tiers with ranked recommendations, notes, `midTierMonthlySpendTRY` threshold, and `sources: [{id, title, publisher, url, accessedAt}]`.
- `docs/research/2026-07-22-tr-restaurant-procurement-channels.md` — the full cited report (repo record; the UI's "Kaynak" footnotes reference these ids).
- All user-facing rationale strings are i18n keys in `stock.json` `guide.*`, 5 locales.
Claims that fail verification are excluded from the ruleset — a category with weak evidence gets a conservative generic recommendation rather than a specific percentage.

## 7. Testing

- `StockPage` spec: 6 tabs render by role/gate, `?tab` URL sync (push + restore), redirect targets.
- `GuidanceTab` spec: buy-list rows with each source type, draft-PO action calls create-PO with suggested lines, tier switcher, empty states, fail-soft error.
- Backend `guidance.service.spec`: base-unit normalization (`conversionFactor` division), cheapest-supplier pick, trend math, ≥2-receipt rule, tier inference boundaries; matcher spec (category hit, item-name hit, no-match fallback).
- Existing 13 stock component specs stay green (components re-parented only).
- Chromium screenshot pass on the new tab shell + Rehber (jsdom-misses-layout lesson from the QR redesign).
- Help portal `admin-guide/stock.mdx` (tr+en) rewritten for the 6-tab layout (it still documents the pre-consolidation 8 tabs).

## 8. Delivery phases

1. **IA restructure** — 6-tab shell, URL sync, re-parenting, label i18n, redirects. Ships alone.
2. **Guidance** — backend endpoint + service + matcher (ruleset stubbed with structure + conservative content), Rehber UI with buy-list + draft-PO, supplier catalog UI. Ships alone.
3. **Content + docs** — verified ruleset from research, channel-guide detail content, 5-locale guide strings, help docs, full report into `docs/research/`.

Each phase: branch commits → full vitest → lint → the standard release flow (PR → merge → tag → CI deploy; push via `scripts/push-via-openssl.sh`).

## 9. Out of scope

Live price feeds/scraping; supplier marketplace integrations; price-history schema/migrations (derived from PO data only); `StockSettings` UI; per-tenant custom channel rules; analytics-insights cron integration (the guidance endpoint is self-contained; an insights bridge can come later); non-Türkiye channel content (UZ/KG guides follow the market-expansion program separately).
