# `frontend-features-orders` — Deep Review (2026-05-11)

**Tier:** 2 (UI, but money-flow-adjacent — verifies the boundary with the Tier-1 backend orders/payments services).
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/features/orders/...`, `frontend/src/features/pos/...`, `frontend/src/store/cartStore.ts`, plus the POS-page + payment/split-bill components that consume them.
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.6 (frontend features green spot-check) — that line only certified "no security/correctness flags on a spot-check"; this review opens every consumer of the orders feature end-to-end and inverts that verdict for the split-bill UI specifically.
**Cross-link:** [`orders.md`](./orders.md) (backend; F-O7 — order-create idempotency missing) and [`payments.md`](./payments.md) (backend; F-1, F-2 — split-bill JS-Number tolerance + missing idempotency).

---

## 1. Health & summary

🟡 **yellow.** The orders feature folder is intentionally minimal — `ordersApi.ts` is a thin React Query layer over the REST endpoints, `cartStore.ts` is a memory-+-localStorage Zustand store for the public QR-menu cart, and the `pos/` feature is just settings + a socket hook. **All the actual order/payment UI lives outside `features/`** (in `components/pos/*.tsx` and `pages/pos/POSPage.tsx`), and that's where the risk concentrates. Three patterns recur: (a) **no client-supplied idempotency key on any mutation** — including the two endpoints (`POST /orders`, `POST /orders/:id/payments/split`) where the backend review explicitly calls for one (orders F-O7, payments F-2); (b) **payment-submit double-tap is guarded only by React Query's `isPending`** — the Promise-return contract of the BillSplitModal multi-order path serializes correctly, but the single-payment + transfer-table mutations have no client-side debounce beyond the mutation's in-flight flag, and the modal closes synchronously on success rather than waiting for the orders query to refetch; (c) **the BillSplitModal handler in POSPage closes the modal on the first mutation success**, so multi-order split bills fire subsequent splits against an unmounted modal — race-prone UX even if the data is sound. Cart display math is non-authoritative (server confirms via `Number(order.finalAmount)` echoed back), but the POS cart's discount/tax preview is JS-float and does *not* round-trip with the server's Decimal computation — flagged in §5. Health is yellow, not green, because the seed claim in CODE_REVIEW.md §5.6 ("no security/correctness flags on a spot-check") doesn't survive an end-to-end pass through `PaymentModal → useCreatePayment → POSPage.handlePaymentConfirm`.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/features/orders/ordersApi.ts` (429 LOC) — every mutation/query hook for orders, payments, split-bill, waiter/bill requests, table-transfer.
- `frontend/src/features/pos/posApi.ts` (30 LOC) — POS settings query/mutation only.
- `frontend/src/features/pos/usePosSocket.ts` (429 LOC) — Socket.IO event handlers that push directly into the React Query cache.
- `frontend/src/store/cartStore.ts` (227 LOC) — public QR-menu cart (persisted to localStorage).
- `frontend/src/pages/pos/POSPage.tsx` (1031 LOC) — the entire POS terminal flow: table-selection, cart, checkout, payment, split-bill, transfer.
- `frontend/src/components/pos/PaymentModal.tsx` (176 LOC) — single-payment form.
- `frontend/src/components/pos/BillSplitModal.tsx` (438 LOC) — split-bill UI (equal / by-items / custom).
- `frontend/src/components/pos/OrderCart.tsx` (266 LOC) — cart panel.
- `frontend/src/components/pos/AwaitingPaymentSection.tsx` (111 LOC) — list of SERVED/READY orders awaiting collection.
- `frontend/src/components/pos/StickyCartBar.tsx` (107 LOC) — mobile cart bar.
- `frontend/src/pages/qr-menu/CartPage.tsx` (130 LOC) + `SubdomainCartPage.tsx` (134 LOC) — public-customer submission paths (use raw axios, not `lib/api`).
- `frontend/src/components/qr-menu/CartContent.tsx` (370 LOC) — display surface for the QR-menu cart.

**Skimmed only:**
- `frontend/src/lib/api.ts` (87 LOC) — interceptor; the orders feature relies on it for the single-flight refresh.
- `frontend/src/components/ProtectedRoute.tsx` (29 LOC) — route-level role gate for `/pos`.
- `frontend/src/App.tsx` (line 168-169) — POS route allowedRoles wiring.
- `frontend/src/components/pos/MenuPanel.tsx` (300 LOC) — product-add surface; no money math beyond display.

**Skipped:**
- `components/pos/TransferTableModal.tsx`, `TableMergeModal.tsx`, `BillRequestsPanel.tsx`, `WaiterRequestsPanel.tsx`, `PendingOrdersPanel.tsx`, `ProductOptionsModal.tsx` — flow-supporting UI, no money math, no idempotency-relevant mutations beyond what's wired through `ordersApi.ts`.
- KDS / kitchen-side UI (`components/kitchen/*`) — out of orders-submit/pay scope; the gateway and queries are reviewed separately.

---

## 3. Business-logic invariants

Each row is a property an integration or UI test could assert.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **Price displays are derived from server response, not authoritative client-side math.** The cart's *preview* total is local (`POSPage.tsx:608-616`, `OrderCart.tsx:63-64`) but every persisted `Order.finalAmount` is read from the server's response (`POSPage.tsx:183, 360, 372, 436, 449`) and that's what gets passed to `PaymentModal` (`POSPage.tsx:958`). The customer never pays based on the local subtotal. | `POSPage.tsx:360, 449` (server overwrites local `currentOrderAmount`); `PaymentModal.tsx:91-93` (renders the server-confirmed total) | ❌ none | Customer charged client-tampered amount; revenue mismatch with backend. |
| I-2 | **Payment amount on `POST /orders/:id/payments` is the server-derived `currentOrderAmount`, not the cart preview.** | `POSPage.tsx:472-486` — `handlePaymentConfirm` uses `payingOrderAmount ?? currentOrderAmount` (both server-derived). The local `total` (`POSPage.tsx:616`) is never the `amount` field on the payment write. | ❌ none | Cart-tampered discount → underpayment that backend accepts (within tolerance) |
| I-3 | **Order submit is idempotent on retry** (network blip retries → exactly one order). | **NOT enforced anywhere.** `useCreateOrder` (`ordersApi.ts:40-61`) sends no idempotency key; the POSPage `createOrder` callback (`POSPage.tsx:367-385, 444-462`) sends no key. Backend orders F-O7 calls this out: the partial unique would be on `(tenantId, idempotencyKey)` — frontend supplies neither. | ❌ none | Two identical orders in the kitchen after a transient 504 retry (and the `react-query` mutation doesn't auto-retry by default, but the user pressing the button twice — see F-FE2 — has the same effect). |
| I-4 | **Payment submit is single-flight** — the user cannot fire two payment writes for the same `currentOrderId` simultaneously. | `POSPage.tsx:88, 472-486` — `useCreatePayment` returns `isPending` via `isCreatingPayment`, which is wired into `PaymentModal.isLoading` (`POSPage.tsx:960`). The Button's `isLoading` state disables it (`PaymentModal.tsx:166-169`). **However:** the modal does NOT call `event.preventDefault()` on form submit before `useMutation.mutate` resolves; relies on the controlled-button `isLoading` only. **And:** the `<button type="submit">` (`PaymentModal.tsx:163-169`) does not include `disabled` based on `isLoading`. The `Button` component would need to translate `isLoading` → `disabled`. **See F-FE1 — verify in `components/ui/Button.tsx`.** | ❌ none | Double-tap on slow network creates two `Payment` rows. **Backend mitigation:** payments idempotency partial unique index — but it only kicks in if the client sends a key, which it doesn't. So both writes succeed and the order is over-paid. |
| I-5 | **Split-bill submit is single-flight per order.** | `POSPage.tsx:95` reads `isSplitting` from `useSplitBill`; `BillSplitModal.tsx:421` disables the confirm button on `isLoading`. For multi-order splits, `BillSplitModal.handleConfirm:152-173` `await`s each `onConfirm(orderId, …)` sequentially. | ❌ none — multi-order race is real (see §6, F-FE3) | Multi-order modal can close before the last order's split commits; if user re-opens and retries, the partially-split order eats a second split. |
| I-6 | **Role gate: `/pos` is reachable only by ADMIN, MANAGER, or WAITER** (the scope mentioned "CASHIER or higher" — there is no CASHIER role in this codebase; the gate is on the three roles that can take orders). | `App.tsx:168` — `<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER]}>`. `ProtectedRoute.tsx:18-23` enforces it; falls back to `/dashboard` on role mismatch. | ❌ none | KITCHEN/COURIER staff (or a future role with kitchen-only scope) would reach the POS terminal. Backend re-enforces (`orders.controller.ts:48` per `orders.md` §8), so this is defense-in-depth at the UI layer. |
| I-7 | **Tenant scoping is implicit via `authStore.tenantId`** — every order request goes through `lib/api.ts:18-29`, which attaches the JWT; the JWT carries `tenantId`. The frontend never sets a `tenantId` field on order-create or payment payloads (verified — `POSPage.tsx:334-349` includes no tenantId). | `lib/api.ts:18-29` (token attach); JWT verifies on backend. | ❌ none | If `useAuthStore.getState().accessToken` is empty (e.g., reload before refresh), the request 401s — caught by `lib/api.ts:63-84` interceptor, which refreshes and retries. (See `CODE_REVIEW.md` F2/F3 — that race is acknowledged.) |
| I-8 | **Cart state is non-auth** (per CODE_REVIEW.md §5.2: "cartStore persists non-auth data only"). Verified at `cartStore.ts:217-223` — `partialize` exposes only `items, sessionId, tenantId, tableId, currency`. No tokens, no user identifiers, no PII beyond table/tenant ids. | `cartStore.ts:213-224` (`partialize`) | ❌ none | Token/PII leakage into localStorage. **Already correct.** |
| I-9 | **Cart `sessionId` is regenerated on tenant switch** — prevents one tenant's cart leaking into another tenant's QR-menu in the same browser. | `cartStore.ts:60-67` — `if (currentTenantId !== tenantId)` clears items + new `sessionId`. | ❌ none | Customer scans a QR for tenant B while a tenant-A cart is still in localStorage → tenant B sees tenant A's items. **Already handled.** |
| I-10 | **Customer-order submit (QR-menu) prevents double submission via a local `isSubmitting` boolean.** | `CartPage.tsx:43-44` (`if (isSubmitting) return`); `SubdomainCartPage.tsx:44-45`. **Note:** this is a guard against re-entrance from the same handler, NOT against double-tap on the button — but `CartContent.tsx:328` disables the submit button when `isSubmitting`. Combined, the QR-menu path is OK. | ❌ none | Double order from a flaky network retry. The handler bails before the second POST. **Already handled.** |
| I-11 | **Public-customer POST `/customer-orders` uses raw axios (not the shared `api` instance)**, so the auth interceptor and the env-loud-fail fallback do NOT apply on this path. Both `CartPage.tsx:70-71` and `SubdomainCartPage.tsx:73-74` silently fall back to `http://localhost:3000/api` when `VITE_API_URL` is missing. | **VIOLATED** — see F-FE4. | ❌ none | The `lib/env.ts` regression-guard (introduced in commit `5154c2e`) is bypassed by these two pages; a prod build without `VITE_API_URL` will misroute customer orders. |

---

*(§4 state machine — skipped: the cart and POS UI hold transient local state (`cartItems`, `currentOrderId`, `currentOrderAmount`, `payingOrderId`, `isPaymentModalOpen`), not a persistent state machine. Orders' state machine is owned and asserted by the backend at `order-state-machine.ts` — covered in `orders.md` §4.)*

---

## 5. Money & precision audit — source-of-truth boundary

**Scope-task asked specifically:** "if frontend calculates totals for display, verify the source-of-truth boundary; flag any client-authoritative math."

### Where money first enters the frontend

| Source | Where it lands | Float/Decimal | Used for |
|--------|----------------|---------------|----------|
| `Product.price` (server `Decimal(10,2)` → JSON Number) | `Product.price` in `types/index.ts`; consumed at `POSPage.tsx:609`, `OrderCart.tsx:63`, `cartStore.ts:33-43` | **JS Number** | Cart preview only — never sent back as `unitPrice` on the order DTO (verified at `POSPage.tsx:340-348`, `444-458`: only `productId`, `quantity`, `notes`, `modifiers` are sent). |
| `Modifier.priceAdjustment` (server `Decimal(10,2)` → Number) | Modifier objects from `useProducts`; consumed at `POSPage.tsx:610-613`, `cartStore.ts:38-42` | JS Number | Same as above — preview only, server recomputes. |
| `Order.finalAmount` (server `Decimal(10,2)` → Number on JSON wire) | `POSPage.tsx:183, 360, 372, 436, 449`; `AwaitingPaymentSection.tsx:89, 95`; `BillSplitModal.tsx:50, 150, 154` | JS Number | **This is the authoritative value the customer pays.** It travels server→client→`PaymentModal.total`→`createPayment.amount`→server. The round-trip is `Decimal → Number → Decimal`; precision is fine for 2-dp currency (`< 2^53/100 = 9e13`). |
| `OrderItem.subtotal` (server `Decimal(10,2)` → Number) | `BillSplitModal.tsx:120, 340` | JS Number | Split-by-items aggregate. Float-summed. **Inherits payments F-1 risk on this side too** (see below). |

### Decimal-to-Number conversion sites in scope

Reproduced with `grep -n 'Number(\|parseFloat(' frontend/src/{features/orders,features/pos,store/cartStore.ts,components/pos,pages/pos,pages/qr-menu,components/qr-menu}`:

| `file:line` | Code | Purpose | Risk |
|-------------|------|---------|------|
| `cartStore.ts:33-43` | `(productPrice + modifierTotal) * quantity` on JS Numbers | Cart-item preview only; persisted to localStorage in `itemTotal` | **Display only.** Never sent to server. Safe. |
| `POSPage.tsx:183, 360, 372, 436, 449` | `Number(order.finalAmount)` | Stores server's `finalAmount` as `currentOrderAmount` (JS Number) | Acceptable round-trip for 2-dp amounts; the *same* Number gets sent back as `amount` on payment write. |
| `POSPage.tsx:608-616` | `Number(item.price)`, `mod.priceAdjustment * mod.quantity`, sum, `subtotal - discount` | Local cart preview — `total` is shown in `StickyCartBar` and `OrderCart` | **Display only.** Server recomputes; the discrepancy between client preview and server-recomputed `finalAmount` is reconciled on the create/update response (`POSPage.tsx:360`). |
| `AwaitingPaymentSection.tsx:89, 95` | `Number(order.finalAmount)` for display + as the `amount` argument to `onCollectPayment` | Display + arg to mutation | Acceptable — comes straight from server. |
| `BillSplitModal.tsx:50, 154` | `Number(o.finalAmount)` for `totalAmount` + per-order alloc | Display + sent as `amount` in each split entry | **High-risk on multi-order split:** the per-order allocation loop at `BillSplitModal.tsx:152-173` allocates Number amounts and uses `Math.min(p.amount, orderAmt - allocated)` + `Math.round(canAllocate * 100) / 100` — float math that can leave a 1-cent crumb on the last order. Backend tolerates ±0.01 (`payments.service.ts:451`, payments F-1) but the tolerance is on the *backend's* JS-Number comparator, so a 0.005-cent drift on the client meets the 0.01 drift on the server *additively*. Worst case: 2-cent shortfall accepted by the backend, customer underpays. |
| `BillSplitModal.tsx:120` | `sum + Number(item.subtotal)` for by-items allocation | Sets `entry.amount` shown in the modal and posted | Same as above. |
| `BillSplitModal.tsx:82-86` | `Math.floor((totalAmount / numberOfPeople) * 100) / 100`; last person absorbs the remainder | Equal-split per-person amounts | **Correct algorithm** — floor first n−1, last absorbs rounding. The only concern is the modal sends `numberOfParts` (not in DTO at `types/index.ts:233-238`) — verify the backend DTO accepts it (per payments.md, `split-bill.dto.ts` has no field; the array of `payments` is the source of truth, so the floor/remainder pattern is correctly translated into per-entry amounts). |
| `BillSplitModal.tsx:163, 165` | `Math.round(canAllocate * 100) / 100`, `Math.round((p.amount - canAllocate) * 100) / 100` | Per-order allocation rounding | Two-step rounding can over- or under-shoot by 1 cent. See above. |
| `OrderCart.tsx:63-64, 205` | `subtotal = items.reduce(...)`, `parseFloat(e.target.value) || 0` | Cart preview + discount input | Display + DTO `discount` field. The server re-derives `finalAmount = totalAmount − discount` (see `orders.md` I-8), so client-side float in `discount` is non-authoritative. **But:** the user types into the discount field expecting a specific final price; if the client preview (`OrderCart.tsx:64`: `total = subtotal − discount`) shows `99.99` while the server computes `99.98` after tax-rounding, the customer sees one number and pays another. Not a bug per se — flagged as F-FE6 (UI-vs-server drift on discounted orders). |

### Source-of-truth boundary verdict

**Server is authoritative.** All money written back to the server (`createOrder` items, `createPayment.amount`, `splitBill.payments[].amount`) is either (a) a `productId` reference the server prices itself, or (b) a `Number` echo of the server's own previously-emitted `finalAmount`. The frontend never invents a price the server didn't first compute.

**Drift hazards** that don't break the boundary but show seams to the user:
1. **Discount preview** (`OrderCart.tsx:64`) is `subtotal − discount` in JS Number; server applies tax rounding after discount (`orders.service.ts:217-218`, see `orders.md` §5 row "`Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100`"). Visible discrepancy on orders with non-zero `taxRate`.
2. **Multi-order split allocation** (`BillSplitModal.tsx:152-173`) compounds JS-float rounding on top of the backend's already-JS-float comparator (payments F-1). The two layers stack.
3. **`Number(order.finalAmount)` is fine for 2-dp amounts but converts a Decimal-typed value to a float-typed value** for every order-related display — the same anti-pattern called out in `payments.md` C-11..C-17 (response-shape conversions) is mirrored here, but acceptable for display.

No client-authoritative *write* of a price; flagged drifts are display-only.

---

## 6. Concurrency hazards (UI-side)

**Double-submit on payment — F-FE1.**
*Sketch:* user clicks "Confirm Payment" twice within ~80 ms (touchscreen / slow network). The `PaymentModal` form's `onSubmit` (`PaymentModal.tsx:87, 81-83`) calls `onConfirm(data)`, which calls `createPayment.mutate(...)` (`POSPage.tsx:479-538`). The `Button` at `PaymentModal.tsx:163-169` has `isLoading={isLoading}` but **does not pass `disabled={isLoading}`** — verify in `components/ui/Button.tsx` whether `isLoading` implies `disabled`. If `Button` only shows a spinner without disabling, the form is submittable twice. Backend has no idempotency key on `createPayment` (the DTO accepts one — `payments.service.ts:127-141` — but the frontend never sets it), so both writes succeed; backend payments F-8 race ("no row-lock on Order") then admits both inside the 1-cent tolerance window.
*Where:* `PaymentModal.tsx:87, 163-169` + `POSPage.tsx:479-538`.
*Severity:* High Cor.
*Fix:* (a) `Button` should accept `disabled={isLoading}` semantics by default; (b) generate an idempotency key on `handlePaymentConfirm` (e.g., `crypto.randomUUID()`) and include it in `CreatePaymentDto`. The backend already has the partial unique index.

**Order-create double-tap — F-FE2.**
*Sketch:* user clicks "Checkout" or "Create Order" twice. `useCreateOrder` (`ordersApi.ts:40-61`) returns `isPending` (wired to `isCreatingOrder` at `POSPage.tsx:87`), and OrderCart's Button uses `isLoading={isCheckingOut}` (`OrderCart.tsx:222, 253`); StickyCartBar does the same (`StickyCartBar.tsx:70-94`). **As with F-FE1, this is `isLoading`-only — no explicit `disabled`.** And `useCreateOrder` sends no idempotency key (`ordersApi.ts:44-46`: `api.post('/orders', data)`). Backend orders F-O7 documents: order numbers are unique-per-tenant, so the two requests get *different* order numbers — they don't collapse. The kitchen sees two of the same order.
*Where:* `ordersApi.ts:40-61` + `OrderCart.tsx:222-256` + `StickyCartBar.tsx:70-94`.
*Severity:* High Cor.
*Fix:* (a) ensure `Button` disables on `isLoading`; (b) generate an idempotency key when the cart is first submitted, persist it on the order DTO, drop it once the order succeeds (per backend F-O7 fix-shape).

**Split-bill multi-order race — F-FE3.**
*Sketch:* `BillSplitModal.handleConfirm` (lines 152-173) iterates active orders and `await`s each `onConfirm(orderId, …)`. `POSPage.handleBillSplit` (`POSPage.tsx:590-605`) wraps the mutation in a Promise that **closes the modal inside `onSuccess`** (line 596: `setIsBillSplitModalOpen(false)`) on the *first* successful split. The for-loop in `BillSplitModal` continues iterating, but the modal is unmounted — subsequent `await onConfirm(...)` calls are made from a detached component; their resolution still triggers the `onSuccess` callback in the next iteration, but if any of them fails, the modal is already gone and the error toast doesn't have a modal to reopen against. Worse: `setCurrentOrderId(null)` (line 597) is also called on the first success, so by the time the second iteration runs, `currentOrderId` is already cleared. (The second iteration doesn't actually need `currentOrderId` because it has its own `order.id`, so this is cosmetic, but it's a real UX seam.)
*Where:* `POSPage.tsx:590-605` + `BillSplitModal.tsx:146-174`.
*Severity:* Medium Cor (no data loss, but a half-completed split with no UI feedback on the rest is confusing).
*Fix:* Move `setIsBillSplitModalOpen(false)` and `setCurrentOrderId(null)` out of the per-mutation `onSuccess` and into the modal's outer handler — call them after all `await`ed mutations resolve, OR wrap the whole iteration in a single tracker.

**Optimistic UI vs server confirm — F-FE5.**
The `usePosSocket` hook (`usePosSocket.ts:47-198`) does **server-push optimistic insertion** into the React Query cache for `order:new`, `order:updated`, `order:status-changed`, `order:item-status-changed`, `table:orders-transferred`, `bill-request:*`, `waiter-request:*`. This is not classic optimistic UI (the client doesn't speculate), but it does *bypass* the standard React Query refetch path:
- **`handleNewOrder` at `:47-88`:** prepends the order to the table-specific cache (`tableQueryKey` at line 64) using the literal status string `'PENDING,PREPARING,READY,SERVED'`. **This must match the exact filter the page uses** — POSPage at line 114-119 builds the same string with `.join(',')`. If a future page passes them as an array (`status: ['PENDING', ...]`), the queryKeys diverge and the socket-push misses. Brittle.
- **`handleOrderUpdated` at `:90-163`:** uses `queryClient.setQueriesData({ predicate: ... })` to update *all* `['orders', ...]` cache entries — except `['orders', 'pending']` which is handled separately. The predicate logic is correct (`queryKey[0] === 'orders' && queryKey[1] !== 'pending'`), but if a developer adds a new orders query with a different shape, the predicate silently doesn't fire.
- **`handleOrderStatusChanged` at `:165-198`:** only the order id + status come over the wire — the cache entry is patched in place with `updatedAt: event.timestamp || new Date().toISOString()`. **Issue:** if the socket message and the REST mutation response arrive out-of-order (e.g., user clicks "Ready" → REST mutation succeeds and patches cache with full order → socket arrives 20 ms later with just `{ orderId, status, timestamp }` → the in-place merge clobbers any fields that came in the REST response and aren't in the socket payload). Verified: the merge at line 184-187 is a shallow spread of the existing cache row + the three socket fields, so other fields survive. **OK.**
*Severity:* Low Cor / Medium Arch (the queryKey shape coupling is the real risk).
*Fix:* extract the table-query-key construction into a shared util used by both `POSPage` and `usePosSocket`.

**Idempotency keys — missing everywhere.**
None of the order/payment mutations in `ordersApi.ts` send an `Idempotency-Key` header or DTO field. Backend orders F-O7 and payments F-2 both call for this. The frontend is the *easy* side: `crypto.randomUUID()` per submit, stash in component state, reuse on retry.

---

## 7. Findings

Severity: Critical → High → Medium → Low → Info. Dimension: Sec / Cor / Arch / Perf.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-FE1 | High | Cor | `PaymentModal.tsx:87, 163-169` + `POSPage.tsx:479-538` | **Payment submit not single-flight at the UI layer.** Form submit relies on the `Button`'s `isLoading={isLoading}` prop to prevent re-submission; the button does not pass `disabled={isLoading}` to the underlying `<button>`. Plus, the form has no idempotency key — backend payments idempotency partial unique only fires if a key is supplied. Double-tap → two `Payment` rows + payments F-8 race window. | Audit `components/ui/Button.tsx` so `isLoading` always implies `disabled`. Generate `idempotencyKey = crypto.randomUUID()` when the modal opens (one key per modal lifetime); attach it to the `CreatePaymentDto`; the backend partial unique catches retries. |
| F-FE2 | High | Cor | `ordersApi.ts:40-61`; `OrderCart.tsx:222-256`; `StickyCartBar.tsx:70-94` | **Order-create has no idempotency key.** Mirrors backend orders F-O7. Double-tap on Checkout / Create Order → two distinct orders (each with its own auto-generated `orderNumber`) reach the kitchen. | Generate `idempotencyKey` on cart-submit (lives on POSPage state until success); send in `CreateOrderDto`; backend adds matching partial unique (per orders F-O7 fix). |
| F-FE3 | Medium | Cor | `POSPage.tsx:590-605` + `BillSplitModal.tsx:146-174` | **Split-bill multi-order: modal closes on the FIRST mutation success, while the iteration is still running.** `setIsBillSplitModalOpen(false)` and `setCurrentOrderId(null)` fire inside the per-mutation `onSuccess` callback. The second-and-subsequent `await onConfirm(order.id, …)` calls fire from a detached modal; if any fail mid-iteration, the error toast has no surface. | Hoist the close-modal + clear-state side effects out of the mutation's `onSuccess`. Resolve them after the for-loop completes (or on a single `Promise.all`-equivalent rejection). |
| F-FE4 | Medium | Cor | `pages/qr-menu/CartPage.tsx:70`; `pages/qr-menu/SubdomainCartPage.tsx:73` | **Public customer-order submit bypasses `lib/api` AND `lib/env`.** Both pages instantiate raw axios and fall back to `'http://localhost:3000/api'` when `VITE_API_URL` is missing. The recent fix (commit `5154c2e`) to `lib/env.ts:21-32` *loudly fails* in prod for the rest of the codebase — but these two QR-menu submit handlers never call `getApiUrl()` and silently regress. Worst case: prod build without `VITE_API_URL` → every customer order POSTs to `localhost:3000/api`, which the customer's browser cannot reach → toast errors / no orders received. | Replace the raw `axios.post(API_URL + '/customer-orders', ...)` with the shared `api` instance (drop `withCredentials` if the endpoint is `@Public()`), OR at minimum import `API_URL` from `lib/env.ts` so the env-loud-fail applies. The QR-menu is a no-auth-cookie path — `axios.create({ baseURL: API_URL })` without the auth interceptor is fine; the env guard is the load-bearing fix. |
| F-FE5 | Medium | Arch | `usePosSocket.ts:64, 107, 254-263` and `POSPage.tsx:114-119` | **Socket-push cache mutation duplicates the queryKey shape literally** (`['orders', { tableId, status: 'PENDING,PREPARING,READY,SERVED' }]`). If the POSPage's `useOrders` filter format ever drifts (e.g., to `status: ['PENDING',...]`), the socket-push silently misses and the page falls back to polling-on-mount only. | Extract a single source of truth: `getTableOrdersQueryKey(tableId, statuses[])`. Import from both call sites. |
| F-FE6 | Medium | Cor | `OrderCart.tsx:63-64`; `POSPage.tsx:608-616` | **Cart total preview can disagree with server `finalAmount` on discounted orders with tax.** Local: `total = subtotal − discount` (JS Number). Server: applies tax rounding *after* discount-proportional adjustment (`orders.service.ts:217-218`, see `orders.md` §5). User sees `99.99` in the cart, then `99.98` (or `100.00`) in PaymentModal after the server response — confusing. | Either (a) recompute the displayed total using the same `Math.round(... * 100) / 100` formula the backend uses for tax, OR (b) suppress the local "total" and only show the server-confirmed total once an order exists. Option (b) is simpler and aligns the UI with backend authority. |
| F-FE7 | Medium | Cor | `BillSplitModal.tsx:152-173` | **Multi-order split allocates with two-step `Math.round`-on-Number; can leave a 1-cent crumb that the backend's also-Number tolerance check then absorbs.** The frontend and backend tolerances stack — worst case 2-cent shortfall. Cross-link payments F-1 (M2). | Move to a Decimal helper on the frontend for split-allocation math, OR allocate integer cents (`Math.round(amount * 100)` everywhere; convert to currency only at the boundary). Pair with the backend F-1 fix. |
| F-FE8 | Medium | Cor | `POSPage.tsx:472-486` | **Payment amount sourced from local `payingOrderAmount ?? currentOrderAmount` (cached client state) instead of refetched-on-open.** Race: user adds an item, opens the existing order's payment modal, server-side `finalAmount` was just updated by another waiter — modal shows the stale amount the client cached at order-create time. Backend will reject (overage check `payments.service.ts:117-124`) or accept (if amount went down), but the user pays based on a stale display. | Refetch the order on PaymentModal-open and pass the fresh `finalAmount` as `total`. Or rely on the socket-push from `usePosSocket` (already wired) and assert `currentOrder.finalAmount` is current. |
| F-FE9 | Low | Cor | `useUpdateOrderStatus` at `ordersApi.ts:92-119` vs `useCancelOrder` at `:121-142` | **Inconsistent endpoints for status updates.** `useUpdateOrderStatus` calls `/kds/orders/:id/status` (KDS-specific). `useCancelOrder` calls `/orders/:id/status`. `useCancelKdsOrder` calls `/kds/orders/:id/cancel`. Three callers, three endpoint shapes. Backend state machine is centralized (`orders.md` §4) but the frontend chooses different doors. | Consolidate to one client-side helper that picks the endpoint based on context. Document the KDS vs orders endpoint split in CLAUDE.md / orders README. |
| F-FE10 | Low | Sec | `usePosSocket.ts:38-44, 48, 91, 165, 200, 249` and friends | **64 `console.log/warn` calls in usePosSocket.** No PII per se (order ids, status strings), but combined with `event.table.number`, `event.transferredCount`, etc., a future log shipper could leak operational data. Acceptable in dev; in prod they're shipped to the browser console. | Gate behind `import.meta.env.DEV` (matches the ErrorBoundary pattern in `frontend/src/components/ErrorBoundary.tsx:126`). |
| F-FE11 | Low | Cor | `cartStore.ts:54-88` | **`initializeSession` reads + writes state in 5 separate `set()` calls** when only one is needed. The branch logic is sound but a single `set` would avoid intermediate React re-renders. | Coalesce into one terminal `set(newState)`. |
| F-FE12 | Low | Cor | `cartStore.ts:33-43` | **`calculateItemTotal` does `productPrice + modifierTotal` in JS Number; persisted as `itemTotal` in localStorage.** Two-decimal currency = safe in practice, but the value is then displayed in `CartContent.tsx:312` via `AnimatedNumber` (which doesn't re-derive from product price). If a tenant changes a product's price between the customer's two visits, the persisted `itemTotal` will show the old price until the cart is cleared. | Recompute `itemTotal` on cart read, or invalidate `itemTotal` when product fetch returns a different `price`. |
| F-FE13 | Info | Cor | `POSPage.tsx:42-95` | **POSPage holds 19 useState hooks** + 8 `useMutation`s + 4 `useQuery`s. The component is 1031 LOC and orchestrates 8 modals. Maintainability rather than correctness. CODE_REVIEW.md `frontend` section didn't flag this; recording as a future refactor candidate. | Extract `useCartViewModel()` / `usePaymentViewModel()` hooks to consolidate the state machine. Or split into POSTableSelectionPage + POSOrderPage. |

---

## 8. What's solid (positive findings)

- **Route-level role gate** (`App.tsx:168` + `ProtectedRoute.tsx:18-23`) — clean composition: `<ProtectedRoute allowedRoles={[ADMIN, MANAGER, WAITER]}>` is declarative and falls back to `/dashboard` on role mismatch. Backend re-enforces (`orders.controller.ts:48` per `orders.md` §8); this is the right defense-in-depth shape. **Pattern to keep.**
- **Server-confirmed totals as the payment source** (`POSPage.tsx:183, 360, 372, 436, 449`) — every `currentOrderAmount` write reads `Number(order.finalAmount)` straight off the server response, *not* from the local cart preview. The cart preview exists for UX only; the payment write uses the server's value. This is exactly the boundary CODE_REVIEW.md §5.6 needed to verify.
- **Cart `sessionId` regeneration on tenant change** (`cartStore.ts:60-67`) — prevents one tenant's cart from leaking into another tenant's QR-menu in the same browser. Plus the localStorage `partialize` (`cartStore.ts:217-223`) confirms no tokens or PII beyond `tenantId` / `tableId`.
- **QR-menu submit double-submit guard** (`CartPage.tsx:43-44`; `SubdomainCartPage.tsx:44-45`) — `isSubmitting` re-entrance guard *plus* `CartContent.tsx:328` button-disable. Two layers. (Compare to the POS-side payment modal which has only one layer — F-FE1.)
- **Socket cache-push (read-only side)** (`usePosSocket.ts:172-198`) — the `handleOrderStatusChanged` shallow-merge preserves fields not in the socket payload. Subtle but right.
- **Tenant scoping is implicit, not duplicated** — `ordersApi.ts` never sets a `tenantId` field on any DTO; it relies on the JWT-bearing `lib/api.ts:18-29` interceptor. Cleaner than the alternative (passing `useAuthStore.getState().tenantId` into every DTO, which would be redundant *and* tamper-vulnerable).
- **Two-step checkout gate** (`POSPage.tsx:136-168`) — payment eligibility for dine-in respects `posSettings.requireServedForDineInPayment` and surfaces a localized "blocked reason" string on the button. Server enforces independently; UI reads it as a hint.
- **`useCreatePayment` invalidates the customer query** (`ordersApi.ts:185-187`) — closes the loop on the backend's customer-stat update inside the payment TX (`payments.service.ts:171-189, 226-246`).

---

## 9. Spot-checks performed

**Verified (opened cited line + read surrounding context):**
- **F-FE1** — confirmed at `PaymentModal.tsx:163-169`: `<Button isLoading={isLoading}>` — passes `isLoading`, not `disabled`. Whether `Button` disables on `isLoading` is a contract question for `components/ui/Button.tsx`; in either case, the *idempotency key* is missing on the wire (verified at `POSPage.tsx:480-486` — only `orderId, amount, method, transactionId, customerPhone` go out).
- **F-FE2** — confirmed at `ordersApi.ts:44-46`: `api.post('/orders', data)` — no idempotency header, no DTO field. `POSPage.tsx:367-385` shows the create handler builds `orderData` without any key.
- **F-FE3** — confirmed at `POSPage.tsx:594-601`: `setIsBillSplitModalOpen(false)` and `setCurrentOrderId(null)` are inside `onSuccess`, which fires per-mutation. `BillSplitModal.tsx:153-173` does `for (order of sortedOrders) { await onConfirm(...) }` — for N orders, the modal is closed after order 1.
- **F-FE4** — confirmed at `CartPage.tsx:70-71` and `SubdomainCartPage.tsx:73-74`: both have `const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';` — direct regression of the `lib/env.ts` loud-fail guard (commit `5154c2e`).
- **I-6 (role gate)** — confirmed at `App.tsx:168-169`: `<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER]}>` wrapping `<Route path="/pos" element={<POSPage />} />`. No `CASHIER` role exists in `types/index.ts:2-8` (the prompt's "CASHIER or higher" doesn't map to a real role); the three approved roles are correct for POS.
- **I-8 (cart non-auth)** — confirmed at `cartStore.ts:217-223`: `partialize` returns only non-auth fields. No `accessToken` / `refreshToken` / `user` exposure.
- **I-1 (display boundary)** — traced the path: server response `order.finalAmount` (Decimal → JSON Number) → `Number(order.finalAmount)` → `currentOrderAmount` state → `PaymentModal.total` prop → `formatPrice(total)` display + `amountToPay` arg → `createPayment.amount`. The customer's payment-write `amount` is the server's own Number echo, not the local cart subtotal. **Boundary holds.**

**Dropped / downgraded:**
- **CODE_REVIEW.md §5.6 "No security/correctness flags on a spot-check" — downgraded.** The spot-check window was too narrow: the orders feature folder is intentionally thin and looks clean in isolation, but the actual order/payment UI lives in `components/pos/*` and `pages/pos/POSPage.tsx`, which contain F-FE1 (payment double-submit), F-FE2 (no order idempotency), F-FE3 (split-bill modal premature close), and F-FE4 (QR-menu env regression). Health verdict moves green → yellow.

---

## 10. Recommended tests

The 3–10 tests that would catch the §3 invariants and §6 races. Skeletons only.

```ts
// frontend/src/__tests__/pos-payment.spec.tsx
describe('POS — payment double-submit (I-4, F-FE1)', () => {
  it('clicking Confirm Payment twice fires the mutation exactly once', async () => {
    // arrange: render POSPage with a SERVED order in state
    // act: open PaymentModal, click Confirm twice within 50 ms
    // assert: api.post('/orders/:id/payments', ...) called exactly once
    // assert (after F-FE1 fix): the request body has an idempotencyKey field
  });

  it('payment amount sent to server equals server-confirmed finalAmount, not cart preview', async () => {
    // arrange: cart subtotal = 99.99 (client); server returns finalAmount=98.97 after tax/discount
    // act: complete checkout → server returns the order → open payment modal → confirm
    // assert: createPayment.mutate({amount: 98.97}) — the SERVER value, not 99.99
  });
});

describe('POS — order-create idempotency (I-3, F-FE2)', () => {
  it('clicking Checkout twice creates exactly one order', async () => {
    // arrange: render POSPage with a non-empty cart
    // act: click Checkout twice within 80 ms
    // assert: api.post('/orders', ...) called exactly once
    // assert (after F-FE2 fix): the request body has an idempotencyKey field;
    //                         after retry on transient 504, the same key is reused
  });
});

describe('POS — role gate (I-6)', () => {
  it.each(['ADMIN', 'MANAGER', 'WAITER'])('%s can reach /pos', async (role) => {
    // arrange: authStore.user = { role, ... }
    // act: navigate to /pos
    // assert: POSPage renders (sees "tableSelection" or "order" view)
  });

  it.each(['KITCHEN', 'COURIER'])('%s is redirected to /dashboard', async (role) => {
    // arrange: authStore.user = { role, ... }
    // act: navigate to /pos
    // assert: redirected to /dashboard (location.pathname === '/dashboard')
  });

  it('unauthenticated user is redirected to /login', async () => {
    // arrange: authStore.isAuthenticated = false
    // act: navigate to /pos
    // assert: redirected to /login
  });
});

describe('POS — split-bill multi-order (F-FE3)', () => {
  it('multi-order split: modal stays open until all orders are split', async () => {
    // arrange: table with 2 active orders, totalAmount 50 + 30
    // act: open BillSplitModal, equal-split for 4 people, confirm
    // assert: api.post('/orders/:idA/payments/split', ...) called once
    // assert: api.post('/orders/:idB/payments/split', ...) called once (sequentially)
    // assert: modal closes only AFTER both mutations resolve
    // assert (after F-FE3 fix): if order B fails, the error toast appears and modal stays open
  });
});

describe('QR-menu — env safety (I-11, F-FE4)', () => {
  it('CartPage uses VITE_API_URL when present', async () => {
    // arrange: import.meta.env.VITE_API_URL = 'https://api.prod.example/api'
    // act: submit order from CartPage
    // assert: axios.post called with 'https://api.prod.example/api/customer-orders'
  });

  it.failing('CartPage fails loudly when VITE_API_URL missing in prod (currently silent fallback to localhost)', async () => {
    // arrange: import.meta.env.PROD = true, VITE_API_URL = undefined
    // act: submit order
    // assert: throws or console.errors (not silently POSTs to localhost:3000)
    // (After F-FE4 fix: rewires through lib/env.ts which is loud per commit 5154c2e)
  });
});

describe('cart store (I-8, I-9)', () => {
  it('localStorage never contains auth tokens', () => {
    // arrange: login + add items to cart
    // act: serialize localStorage
    // assert: no key matches /accessToken|refreshToken|jwt/i
  });

  it('tenant change clears items + regenerates sessionId', () => {
    // arrange: initialize cart for tenantA; add items
    // act: initialize cart for tenantB (different tenantId)
    // assert: items.length === 0; sessionId !== previousSessionId
  });
});

describe('POS — display vs server boundary (I-1, F-FE6)', () => {
  it('cart preview total can disagree with PaymentModal total when tax rounding applies', async () => {
    // arrange: items totalling 99.99; tenant taxRate=18% (post-discount adjustment kicks in)
    // act: render cart with discount=10, observe OrderCart total
    // act: complete checkout → server returns order with finalAmount that differs by 1-2 cents
    // assert: PaymentModal.total === order.finalAmount (server-authoritative)
    // assert (documents the seam — and after F-FE6 fix, the cart preview matches)
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`. For the frontend, that's a route-level guard: spawn an unauthenticated browser context, attempt to reach `/pos`, `/kds`, every admin route, and assert each redirects without a network call to the protected backend. The frontend currently has **1 spec file total** (`ErrorBoundary.spec.tsx`, per CODE_REVIEW.md §3.8) — adding the seven above would close the largest single coverage gap noted in §3.8 and in the P3 backlog (CODE_REVIEW.md §7).

---

**Counts:** 11 invariants (I-1…I-11), 13 findings (F-FE1…F-FE13), 0 *(unverified)* — every finding above was opened at the cited `file:line`. Two of those (F-FE1's Button-`isLoading`-implies-`disabled` question; `components/ui/Button.tsx` was *not* in the read window for this review) need one more spot-check before remediation; the rest are confirmed verbatim.
