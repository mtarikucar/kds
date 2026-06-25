# Store / Marketplace — Consolidated Hub, Flow Fixes & Device Provisioning

**Date:** 2026-06-25
**Goal:** Move the marketplace out of the main sidebar into a top-bar "Mağaza" entry with a consolidated, polished hub (add-ons + hardware + orders); fix the silent flow failures; and close the loop so buying hardware provisions a device.

**User intent (confirmed via AskUserQuestion):** problems = (1) görsel/UX dağınık, (2) sessiz akış hataları, (3) donanım↔cihaz kopuk; nav = top-bar "Mağaza" entry (out of sidebar). Prod has a real catalog (12 hardware SKUs + 14 add-ons) and the PayTR→entitlement / order flows work — so this is consolidation + polish + targeted fixes, not a rebuild.

---

## 1. Nav + consolidated hub (görsel)
- **Top bar (`Header.tsx`):** add a `Store` icon-button → `/admin/store` (next to the notification bell), so the store is reachable from anywhere.
- **Sidebar (`Sidebar.tsx`):** delete the `marketplace` group (the 3 items) — declutters the long sidebar.
- **`StoreHubPage` (`/admin/store`):** one header ("Mağaza") + a tab bar — **Eklentiler · Donanım · Siparişlerim** (query-param `?tab=`). Renders the existing Marketplace / hardware-Store / HardwareOrders bodies, header-stripped (the hub owns the page header), for a single consistent surface.
- **Routes/redirects:** `/admin/marketplace` → `/admin/store?tab=addons`; `/admin/hardware-orders` → `/admin/store?tab=orders`; keep `/admin/store/:sku` (product detail) and `/admin/hardware-orders/:id` (order detail). Repoint any in-app links (BranchesPage `?focus=`, SetupChecklist).
- i18n in all 5 locales for the hub tabs/title.

## 2. Silent-flow fixes
- **Quote warnings:** `CartQuote.warnings` already returns `["Hardware not directly purchasable: …", …]`. Render them on the hardware-store cart panel (amber list) so silently-dropped/unsellable items are explained instead of vanishing.
- **Image fallback:** `ProductImage` hides 404s (renders null). Show a neutral placeholder (icon) instead.
- **Shipping address:** the ShippingAddressForm accepts an empty branch address (line1 blank) → validate `line1` non-empty before allowing submit.
- **Marketplace focus deep-link:** `?focus=<code>` breaks when the user filters to a category that excludes the code (and never clears the param / no feedback). Fix: auto-select the focused add-on's category on first load, and clear the param after the highlight.

## 3. Hardware → device provisioning (donanım↔cihaz)
- In `CheckoutService.confirmAndProvision`, **inside the existing `(tenantId, paymentRef)` idempotency block + the SERIALIZABLE tx**, after the `HardwareOrderItem` rows are created: for each hardware line whose `HardwareProduct.category` maps to a device-mesh kind, create `qty` Device slots in the order's branch.
  - **Category → device kind:** `kds_screen→kds_screen`, `pos_terminal→pos_terminal`, `printer→receipt_printer`, `tablet→tablet_waiter`, `bridge→local_bridge`, `yazarkasa→yazarkasa`, `scanner→scanner`, `caller_id→caller_id`. **Skip peripherals** (`cash_drawer`, `accessory`, `service`, customer-display) — not device-mesh kinds.
  - **Branch:** the order's `branchId` if set, else the tenant's **HQ branch** (`isHeadquarters`), else the earliest active branch. (Ties into the branch hub: the bought device shows up there, ready to pair.)
  - **Idempotent:** runs once per `paymentRef` (the block already guards this); each slot carries the order id in `config` so a manual re-run can dedupe. Device creation failure must NOT fail the order (best-effort, logged) — the order/payment is the source of truth; a missing slot is recoverable, a failed paid order is not.
- A device created this way starts `unprovisioned` with a pair code (the operator pairs the physical unit on arrival) — exactly the normal device-mesh lifecycle, now seeded by the purchase.

## Phasing
Phase A = nav + hub + polish (frontend) + silent-flow fixes (mostly FE, warnings already on BE). Phase B = hardware→device provisioning (backend) + tests. Adversarial review (provisioning idempotency / branch-scope / order-safety), then ship. Quality bar: backend tsc/jest/eslint, frontend tsc/eslint/vitest/build, i18n parity+value-drift; device-creation must be best-effort (never break a paid order) and idempotent.
