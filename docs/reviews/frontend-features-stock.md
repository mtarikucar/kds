## `frontend/features/stock-management` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/features/stock-management/**` (12 files: `stockManagementApi.ts`, `types.ts`, and 10 `components/*.tsx`). Route + role-gate at `frontend/src/App.tsx:189` and `frontend/src/components/ProtectedRoute.tsx:10-24`. Parent page at `frontend/src/pages/admin/StockManagementPage.tsx:1-75`.
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.6 (Features) — one-line "no security/correctness flags on a spot-check"; this review revises that to 🟡 yellow. Cross-link to [`./stock-management.md`](./stock-management.md) for the backend invariants (I-1…I-14) this frontend is the client of.

---

## 1. Health & summary

🟡 yellow

The feature owns the admin UI for ingredient stock: items + categories, recipes, suppliers, purchase orders, manual movements, waste logs, stock counts, and the dashboard. It's an unusually well-disciplined React feature in one specific way: **there is zero optimistic UI** — every mutation hits the server, every `onSuccess` calls `qc.invalidateQueries` against the relevant key, and every numeric value rendered (`currentStock`, `quantity`, `costPerUnit`) comes from a re-fetched server response (`stockManagementApi.ts:99, 112, 124-127, 313-316, 346-348, 372-374, 421-424`). That single decision is exactly what the backend wants (see `stock-management.md` §3 I-2 / I-3 — the server is the only authority that can decrement stock under a `Serializable` transaction with a guarded `updateMany`) and means the optimistic-adjustment hazard simply does not exist on this client. The risk concentrates in two places: (a) double-submit windows on every form button — buttons are disabled while the mutation is pending but the table-row action icons in `PurchaseOrdersTab.tsx`/`StockCountsTab.tsx` fire `.mutate(id)` directly with no per-row disabled state, so a user can click Submit-PO / Finalize-Count / Cancel-PO repeatedly before the round-trip lands; and (b) every list hook calls the backend without `take`/`skip` and the UI has no pagination affordance, so it inherits the backend cap-gap called out as F-2 and F-3 in `stock-management.md`. Health is yellow rather than green because the double-submit windows are real and the alert-acknowledgment UX is non-existent (the dashboard renders `dashboard.lowStockItems` as a passive list with no acknowledge / dismiss action — the server keeps re-broadcasting via the scheduler, so the user has no way to silence a known-handled alert from the UI). No optimistic patterns to remove; no tenant scoping bug to fix.

---

## 2. Scope of this review

**Read end-to-end:**
- `stockManagementApi.ts` (479 LOC) — 33 `useQuery`/`useMutation` hooks; every list hook, every mutation, the invalidation keys.
- `types.ts` (246 LOC) — enums + DTO shapes; `StockItem.currentStock: number` is a frontend-side `Number` coercion of the backend `Decimal(10,3)`.
- `components/StockDashboard.tsx` (113 LOC) — alert + recent-movements + expiring-batches render.
- `components/StockItemsTab.tsx` (139 LOC) — list + create/edit/delete.
- `components/StockItemForm.tsx` (308 LOC) — item create/edit modal + inline category management.
- `components/RecipesTab.tsx` (131 LOC) + `RecipeForm.tsx` (147 LOC) — recipe CRUD + stock-check modal.
- `components/SuppliersTab.tsx` (187 LOC) — supplier CRUD.
- `components/PurchaseOrdersTab.tsx` (331 LOC) — PO list, create, view, receive, submit, cancel.
- `components/MovementsTab.tsx` (171 LOC) — manual movement list + create form.
- `components/WasteLogTab.tsx` (171 LOC) — waste log list + create form.
- `components/StockCountsTab.tsx` (256 LOC) — count list, create, inline count-session editor, finalize.
- `pages/admin/StockManagementPage.tsx` (75 LOC) — parent tab host.

**Skimmed only:**
- `App.tsx:66, 189` — confirms lazy import + `/admin/stock` route is inside the `[ADMIN, MANAGER]` `ProtectedRoute` block (`App.tsx:180`).
- `ProtectedRoute.tsx:10-24` — confirms `isAuthenticated` + `allowedRoles.includes(userRole)` gate, redirect to `/dashboard` on role mismatch.
- `lib/api.ts:9-15, 18-29, 38-59` — confirms axios sends only `Authorization: Bearer <jwt>` + httpOnly refresh cookie; **no** client-supplied tenant header anywhere in the flow.

**Skipped:**
- None — the whole feature was read end-to-end.

---

## 3. Business-logic invariants

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Server is the **only** authority for `currentStock`; the client never optimistically adjusts it before a successful response | `stockManagementApi.ts` — every mutation has `onSuccess: qc.invalidateQueries(...)` and **no `onMutate` / `setQueryData` block** (lines `99, 112, 124-127, 313-316, 346-348, 372-374, 421-424`). Components render `Number(item.currentStock)` directly off the cached server payload (`StockItemsTab.tsx:93, 102-103`; `StockDashboard.tsx:55, 77`) | ❌ none | UI shows a phantom decrement the server never accepted; user reads a stock figure that disagrees with the database (see backend `stock-management.md` I-2 / F-4) |
| I-2 | Tenant scope is inherited from the JWT — the client never reads, persists, or sends a tenant id | `lib/api.ts:9-15, 18-29` (no tenant header, `Authorization` is the only auth header); `stockManagementApi.ts` — no `tenantId` anywhere in the file (verified by absence: 0 matches) | ❌ none | client-forged tenant id reaches a service that does `where: { tenantId }` and exfiltrates cross-tenant rows (backend `stock-management.md` I-1) |
| I-3 | The route is gated to `ADMIN, MANAGER` | `App.tsx:180, 189` — route nested inside `<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}>`; gate is enforced in `ProtectedRoute.tsx:18-24` | ❌ none | `WAITER` / `KITCHEN` user navigates to `/admin/stock` and the page mounts before the backend rejects the request — UX leak only, no data leak (backend controllers re-check roles, see `backend/.../stock-items.controller.ts:25, 32, 39, 47`) |
| I-4 | Pagination is respected — the client requests bounded pages matching the caps that backend `stock-management.md` F-2 (`LIMIT 100` on low-stock raw query) and F-3 (`take=100`, clamp `[1, 500]` on `findAll`) call for | **NOT enforced** — `stockManagementApi.ts:69-73` (`useStockItems`) has no `take`/`skip` in params; `:82-86` (`useLowStockItems`), `:88-92` (`useExpiringSoon`), `:335-339` (`useIngredientMovements`), `:355-359` (`useWasteLogs`), `:271-275` (`usePurchaseOrders`), `:381-385` (`useStockCounts`), `:196-200` (`useSuppliers`), `:24-28` (`useStockCategories`) all fetch unbounded lists; UI has zero pagination controls | ❌ none | client receives the whole tenant's stock list — slow render, memory pressure, and silently masks the backend bound-gap. Even once backend lands the caps, the UI still has no "page 2" affordance |
| I-5 | A pending mutation must not be re-submitted from the same control | **PARTIALLY enforced** — modal Save buttons disable on `isLoading` (`StockItemForm.tsx:297`, `RecipeForm.tsx:138`, `PurchaseOrdersTab.tsx:255, 322`, `MovementsTab.tsx:162`, `WasteLogTab.tsx:162`, `SuppliersTab.tsx:78`, `StockCountsTab.tsx:150`). **NOT enforced** for the table-row action buttons in `PurchaseOrdersTab.tsx:92, 102` (submit / cancel) and `StockCountsTab.tsx:87, 90, 191` (finalize / cancel) — those call `.mutate(id)` with no per-row pending state, so the icon stays clickable while the request is in flight | ❌ none | double POST → backend invariant must absorb it. `submit` and `cancel` are state-machine transitions (idempotent in backend `purchase-orders.service.ts:267-321` for cancel; submit transitions DRAFT→SUBMITTED and a second call would 4xx) so the worst-case is a confusing toast. `finalize` is the dangerous one — see §6 |
| I-6 | Alert UI does not impose its own re-fire (no client-driven socket emit) | `StockDashboard.tsx:1-113` is render-only — no `socket.emit` / no `useEffect` posting back to the server; alert state lives entirely in `useStockDashboard()` (`stockManagementApi.ts:442-446`) which is a passive `GET /stock-management/dashboard` | ❌ none | UI accidentally re-publishes an alert. Backend already double-emits via `getDashboard` (see backend `stock-management.md` F-7); frontend correctly does not amplify it |
| I-7 | Numeric rendering coerces server `Decimal` with `Number(...)` and `.toFixed(n)` — UI display only, never written back as a derived value | `StockItemsTab.tsx:93, 102-106`; `StockDashboard.tsx:55, 77, 98`; `MovementsTab.tsx:84-86`; `WasteLogTab.tsx:86, 89`; `PurchaseOrdersTab.tsx:156`; `StockCountsTab.tsx:219, 236, 242`; `RecipesTab.tsx:83, 110` | ❌ none | low-risk: display precision loss past ~15 significant digits, but the numbers written back to the server come from `<input type="number">` user input, not from these `Number()` calls — so the schema-side `Decimal(10,3)` is never poisoned by a UI round-trip |

I-1, I-2, I-3 are the three "must hold" properties for the §3 prompt; I-4 is the §6 / §8 pagination invariant the backend cares about. I-5 / I-6 are the §6 concurrency invariants the UI is responsible for. I-7 is bookkeeping for I-1 — the UI's `Number()` conversions are read-only.

---

## 6. Concurrency hazards

**Stock-adjustment double-submit** (the §6-required hazard):

- *Sketch:* user clicks the Finalize button on an `IN_PROGRESS` count row at `StockCountsTab.tsx:87`. The handler is `finalizeMutation.mutate(count.id)` — no `disabled`, no per-row state, no `useTransition` guard. While the POST is in flight (a count with many items finalizes inside a `$transaction` and is not instant — see backend `stock-counts.service.ts:125-147`) the user, seeing nothing happen, clicks again. A second `POST /stock-counts/:id/finalize` queues. The backend status-transition guard (count must still be `IN_PROGRESS`) absorbs the second request *only if* the first transaction has committed and updated the status before the second one reads it — which is exactly the kind of race the count-finalize service was designed to handle, but the UI is needlessly multiplying the load and the user's "did it work?" anxiety.
  *Where:* `StockCountsTab.tsx:87` (table-row finalize), `:90` (table-row cancel), `:191` (session-modal finalize).
  *Severity:* Medium Cor. Data corruption requires the backend's atomic-claim pattern to fail; with the current backend code (`stock-counts.service.ts:144-147` uses `updateMany` with a `tenantId` predicate) it doesn't. The hazard is UX + log spam + wasted DB work.
  *Fix:* drive the button `disabled` off `finalizeMutation.isPending && finalizeMutation.variables === count.id` (TanStack Query exposes `variables` on the mutation). Same shape for `cancelMutation` / `submitMutation` in `PurchaseOrdersTab.tsx:92, 102`.

- *Sketch (worse case):* `MovementsTab.tsx:118-125` and `WasteLogTab.tsx:119-125` submit a movement / waste log on form submit; the Save button is disabled while `createMutation.isPending` (`MovementsTab.tsx:162`, `WasteLogTab.tsx:162`), but a user pressing **Enter** in the quantity input rapid-fires `onSubmit` faster than React commits the disabled prop. Backend `ingredient-movements.service.ts:36-73` has **no atomic guard** on `currentStock` (backend `stock-management.md` F-4) — two near-simultaneous `OUT` movements lose one decrement to last-write-wins. The UI is one of two ways to trigger that race (the other is concurrent users); double-submit prevention here is therefore higher-leverage than for the protected paths.
  *Where:* `MovementsTab.tsx:118-125`, `WasteLogTab.tsx:119-125`.
  *Severity:* High Cor (because it pairs with an unguarded backend write — see backend `stock-management.md` F-4).
  *Fix:* in addition to the `disabled` on `isPending`, prevent the second `onSubmit` synchronously: `if (createMutation.isPending) return;` at the top of `handleSubmit`, plus debounce the Enter key.

**Alert-acknowledgment race** (the second §6-required hazard):

- *Sketch:* the cron at backend `schedulers/stock-alerts.scheduler.ts:28-31` runs every hour and (today, before the F-1 fix in `stock-management.md`) emits the entire low-stock set to the KDS / POS rooms on every tick. The dashboard at `StockDashboard.tsx:50-58` and `:94-104` renders `dashboard.lowStockItems` and `dashboard.expiringBatches` as a passive list. There is **no acknowledge / dismiss / snooze action** in the UI — `StockDashboard.tsx:1-113` has no button on any alert row, no `useMutation` consuming an alert. Combined with backend F-7 (`stock-dashboard.service.ts:24-25` calls `checkLowStock` synchronously on every dashboard load, which emits a socket event as a side effect), the user reload of the page **re-broadcasts an alert** to the entire KDS room. So when two managers open the dashboard within the same second to investigate the same low-stock event, they both trigger an emit; the KDS receives the same alert payload twice in quick succession; if the KDS deduplicates by `(itemId, currentStock)` it absorbs the duplicate, if not it shows the toast twice.
  *Where:* `StockDashboard.tsx:1-113` (no acknowledge UI), `stockManagementApi.ts:442-446` (`useStockDashboard` — a plain GET with no debounce on multiple tabs).
  *Severity:* Medium Cor. The backend has the bug (it shouldn't emit on a read); the frontend has the *missing feature* (no way for a user to mark "I see it, stop reminding me until the state changes"). The two together are why this looks like a race: the user has no idempotent way out of the alert loop.
  *Fix:* (a) add an `acknowledge(itemId)` mutation that calls a new backend endpoint setting `lastAcknowledgedAt` on the alert state (paired with the backend F-1 / I-12 state-transition tracking). (b) until that lands, *cosmetic fix*: persist a `Set<itemId>` of "dismissed-this-session" in `sessionStorage`, render dismissed rows greyed-out; this at least gives the user agency.

**Idempotency keys:**

- Present at: nowhere on the client. Every mutation is a plain `POST` / `PATCH` with no `Idempotency-Key` header. This is consistent with the rest of the frontend (`lib/api.ts` doesn't set one), and the backend's idempotency lives at the row level (`stockDeducted=false` claim, count's `IN_PROGRESS` status guard).
- Missing where needed: `MovementsTab.tsx:118-125` (manual movement), `WasteLogTab.tsx:119-125` (waste log), `PurchaseOrdersTab.tsx:120, 169` (PO create / receive). All four are dangerous on a flaky-network retry: the client has no way to tell the backend "this is the same submit you already saw." Flag for the same fix being recommended in `CODE_REVIEW.md` M9 / M10.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `MovementsTab.tsx:118-125`; `WasteLogTab.tsx:119-125` | Manual-movement / waste-log forms have no synchronous double-submit guard inside `handleSubmit`. Paired with the backend's unguarded `IngredientMovementsService.create` (backend `stock-management.md` F-4), a rapid double-Enter races into a lost decrement. The `disabled={isLoading}` on the Save button (`MovementsTab.tsx:162`) only protects the *click* path, not the *Enter-in-field* path. | Add `if (createMutation.isPending) return;` at top of both `handleSubmit`. Independently push the backend fix in `stock-management.md` F-4. |
| F-2 | Medium | Cor | `PurchaseOrdersTab.tsx:92, 102`; `StockCountsTab.tsx:87, 90, 191` | Table-row icon buttons fire `submitMutation.mutate(order.id)` / `cancelMutation.mutate(order.id)` / `finalizeMutation.mutate(count.id)` / `cancelMutation.mutate(count.id)` with no per-row disabled state. A user can click each multiple times before the round-trip lands. Backend status-transition guards absorb this *if* the first transaction has committed by the second click; otherwise wasted work + 4xx toast spam. | Use `mutation.isPending && mutation.variables === id` to disable per-row; OR introduce a `pendingIds: Set<string>` local to the tab and gate `onClick`. |
| F-3 | Medium | Perf | `stockManagementApi.ts:69-73, 82-92, 196-200, 271-275, 335-339, 355-359, 381-385` | Eight list hooks fetch without `take`/`skip`. UI has no pagination controls. Mirrors backend `stock-management.md` F-3 — the client is the other half of that gap. Even after the backend caps land, this UI silently truncates with no "page 2" / "showing 100 of N" affordance. | Extend each query DTO with `take`/`skip` (default `take=50`). Add a footer in each `*Tab` with `Showing N of {total}` + `Load more`. |
| F-4 | Medium | Cor | `StockDashboard.tsx:1-113` | No alert acknowledgment UI: low-stock and expiring-batch rows are rendered as static text. Combined with backend `stock-management.md` F-1 (alert re-emit every cron tick) and F-7 (emit-on-dashboard-load), the user has no idempotent way out of the alert loop. | Add `acknowledge(itemId)` mutation tied to a new backend endpoint (or session-only dismissal as a stop-gap). Track per-item `acknowledgedAt` and grey out dismissed rows until the underlying state changes. |
| F-5 | Medium | Cor | `RecipeForm.tsx:31-35` | `useEffect` fetches `/menu/products` via the raw `api` instance instead of `useQuery` — no caching, no automatic retry, every modal open refetches. Empty dep array means a stale `t` closure if the i18n language changes mid-modal (minor). | Extract a `useMenuProducts()` hook in `stockManagementApi.ts` (or a shared `menuApi.ts`) using `useQuery`. |
| F-6 | Low | Cor | `StockCountsTab.tsx:222-231` | `<input>` `onChange` fires `updateItemMutation.mutate` on every keystroke. No debounce. Counting 20 items at 3 keystrokes each = 60 mutation requests in seconds. Backend at `stock-counts.service.ts` accepts each one; race-free per the patch endpoint, but bandwidth-wasteful. | Debounce to ~400 ms via `useDebouncedCallback` or `lodash.debounce`; commit on blur. |
| F-7 | Low | Cor | `StockItemsTab.tsx:21-25, 31-34`; `RecipesTab.tsx:20-28, 30-34`; `SuppliersTab.tsx:96-110` | Delete confirmations use `window.confirm` — blocking, not styled, not localized via `t()`. (`StockItemsTab.tsx:32` does pass a translated string, but `window.confirm` itself is the platform native modal — accessibility / theming are out of the app's control.) | Replace with a reusable `<ConfirmDialog>` component; existing toast/`sonner` setup already provides the styling vocabulary. |
| F-8 | Low | Cor | `types.ts:66-68` | `StockItem.currentStock: number` (and `minStock`, `costPerUnit`) is typed as `number` but the backend ships a `Decimal` serialized as a string in some Prisma configurations. Every component then re-wraps with `Number(...)`. Risk is small (numbers within JS-safe range) but the type lies about the wire shape. | Type as `number | string` and centralize coercion in a `decimalToNumber()` helper. |
| F-9 | Low | Arch | `StockManagementPage.tsx:13` | Eight tabs in a single `useState<TabType>` — no URL persistence, so refresh drops the user back to `dashboard`. Deep-linking to a tab from a notification is impossible. | Mirror tab state to `useSearchParams()` (`?tab=movements`). |
| F-10 | Low | Arch | `stockManagementApi.ts:97, 109, 155, 167, 211, 223, 249, 287, 311, 344, 370, 397` | Twelve mutation `mutationFn`s typed as `(data: any) => ...`. The form components also pass `any`. Defeats the point of the DTO types in `types.ts`. | Type each `mutationFn` against the matching DTO; remove the `any`s in `*Form` props. |
| F-11 | Low | Sec | `App.tsx:189` vs `backend/.../stock-items.controller.ts:25, 32, 39, 47` | Frontend route is gated for `[ADMIN, MANAGER]` only; backend `findAll` / `low-stock` / `expiring-soon` / `findOne` also accept `UserRole.KITCHEN`. A `KITCHEN` user can hit the read endpoints (e.g., from a desktop integration) but cannot land on the page. Not a bug — defense in depth — but worth a one-line comment explaining the intentional asymmetry so a future contributor doesn't "fix" the route to include `KITCHEN`. | Add a comment to `App.tsx:180` documenting the role-narrowing rationale (admin UI only; reads are backend-allowed for KITCHEN for the KDS gateway). |
| F-12 | Info | Arch | `stockManagementApi.ts:35-39, 48-52, 60-64, 99-103, 113-116, 124-128, ...` | Every mutation hard-codes the toast text via `i18n.t(...)`. Good consistency, but the success/error fork is duplicated 24 times. | Extract a `mutationWithToast(keyPrefix)` helper; would also centralize the missing `onError`-with-server-message fallback (today most `onError` show the generic translation string and discard the axios error body). |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- `stockManagementApi.ts` — **no `onMutate` / `setQueryData` block anywhere in the file**, paired with `qc.invalidateQueries` after every mutation. This is the textbook way to keep the client honest when the server holds the authority for a stateful quantity. **Other features that mutate server-authoritative numbers (orders, payments, subscriptions) should copy this pattern verbatim instead of optimistically advancing the UI before the server commits.** Cross-link: this is the client half of backend `stock-management.md` I-2 / I-3 ("server is the source of truth, atomic-claim on the write side").
- `stockManagementApi.ts` — **no tenant id leaks across the wire**: grep for `tenantId` returns zero matches in the whole feature. Tenant scoping is purely a JWT-side concern (`lib/api.ts:18-29` adds only `Authorization`). Matches the CODE_REVIEW.md §3.1 pattern.
- `App.tsx:180, 189` + `ProtectedRoute.tsx:18-24` — role-gated route with a clean redirect to `/dashboard` on mismatch. The backend re-checks via `@Roles(...)` on each controller (`stock-items.controller.ts:25, 32, 39, 47`) — proper defense in depth.
- `stockManagementApi.ts:99, 124-127, 313-316, 346-348, 372-374, 421-424` — mutation `onSuccess` invalidates the **set** of related keys (e.g., `useReceivePurchaseOrder` invalidates both `purchaseOrders` and `stockItems`), so the receive-PO flow's downstream stock change is reflected without a manual page refresh.
- `StockCountsTab.tsx:174-175, 189` — finalize button only enables when `allCounted` is true (`countedCount === count.items.length`). A small client-side guard that prevents the most common "I forgot to count one" mistake before the server has to reject it.
- `PurchaseOrdersTab.tsx:91-105` — status-aware action buttons: Submit only on `DRAFT`; Receive only on `SUBMITTED` / `PARTIALLY_RECEIVED`; Cancel only on non-terminal. Mirrors the backend PO state machine and avoids most invalid-transition requests.
- `StockItemForm.tsx:38-115` — inline category management (create / edit / delete) without a separate page. Modal-within-modal pattern is cleanly state-machined via `categoryMode: 'idle' | 'create' | 'manage' | 'edit'`.
- `pages/admin/StockManagementPage.tsx:1-75` — eight tab components mounted via conditional render (`{activeTab === 'x' && <X />}`) rather than always-mounted-hidden. Each tab's queries only fire when the tab is open. Good bundle-cost discipline even with the page being lazy-loaded at `App.tsx:66`.

---

## 9. Spot-checks performed

**Verified:**
- F-1 confirmed at `MovementsTab.tsx:118-125` and `WasteLogTab.tsx:119-125`: `handleSubmit` has no synchronous re-entry guard; the `disabled={isLoading}` at `:162` only fires after React commits the next render.
- F-2 confirmed at `PurchaseOrdersTab.tsx:92, 102` and `StockCountsTab.tsx:87, 90, 191`: bare `.mutate(id)` calls, no per-row disabled state.
- F-3 confirmed by reading each `useQuery` declaration in `stockManagementApi.ts` — none of the eight list hooks pass `take`/`skip`; the corresponding query DTOs (`stock-item-query.dto.ts`, the implicit `purchase-orders` filter, etc.) have no `limit` field either.
- F-4 confirmed at `StockDashboard.tsx:50-60, 87-107`: rows render as `<div>` with text, no `<button>` per row.
- I-1 (no optimistic adjustment) confirmed by grep: 0 matches for `onMutate|setQueryData|optimisticUpdate` in `stockManagementApi.ts`.
- I-2 (no tenant leak) confirmed by grep: 0 matches for `tenantId|X-Tenant` across the feature directory and `lib/api.ts`.
- I-3 (role gate) confirmed by reading `App.tsx:180, 189` and `ProtectedRoute.tsx:10-24`.
- F-11 asymmetry confirmed by reading `backend/.../stock-items.controller.ts:25, 32, 39, 47` (KITCHEN role allowed on read endpoints) vs `App.tsx:180` (ADMIN/MANAGER only on the route).

**Dropped (initial report was wrong):**
- "Optimistic UI hides backend errors" — looked plausible from the toast-on-success pattern, but verified by reading every `onSuccess` and confirming none of them write to the cache before the server acknowledges. The toast fires *after* the server response, so a backend rejection lands in `onError` and the cache stays consistent. **Drop.**

**Downgraded:**
- F-6 (debounce on count-item input) considered Medium initially; downgraded to Low after confirming the backend endpoint is race-free (`stock-counts.service.ts` PATCH on a count item is idempotent for the same `countedQty`). It's a bandwidth issue, not a correctness one.

---

## 10. Recommended tests

```ts
// frontend/src/features/stock-management/__tests__/stock-management.spec.tsx
describe('stock-management frontend invariants', () => {
  it('I-5 / F-1 double-submit: rapid Enter on movement form fires exactly one POST', async () => {
    // arrange: render <MovementsTab/> with mocked api.post resolving after 200ms
    // act: fill form, press Enter twice within 50ms
    // assert: api.post called exactly once with the movement payload
    //         (this test FAILS today — see F-1)
  });

  it('I-5 / F-2 per-row double-submit: clicking Finalize twice on a count fires one request', async () => {
    // arrange: render <StockCountsTab/> with one IN_PROGRESS count and a 300ms api stub
    // act: click the finalize icon twice within 100ms
    // assert: api.post('/stock-counts/:id/finalize') called once
    //         (this test FAILS today — see F-2)
  });

  it('I-4 / F-3 pagination cap: list hooks send take/skip and respect a 100-item cap', async () => {
    // arrange: spy on api.get; render <StockItemsTab/> with a tenant returning 600 items
    // act: mount the component
    // assert: api.get called with { params: { take: 50, skip: 0, ... } }
    //         response renders <= cap rows; footer shows "Showing 50 of 600"
    //         (this test FAILS today — see F-3; pairs with backend stock-management.md F-3)
  });

  it('I-1 server authority: a mutation rejection rolls back nothing because nothing was optimistically applied', async () => {
    // arrange: render <StockItemForm/> editing an item with currentStock=10
    // act: update currentStock to 7 in the form, click Save, api.patch rejects with 409
    // assert: the table row still shows 10 (no optimistic write); toast.error called
  });

  it('I-2 tenant scope inherited: client sends no tenant header', async () => {
    // arrange: render the feature; intercept axios requests
    // act: trigger a stock-items GET, a movement POST, a PO POST
    // assert: none of the captured requests carry an X-Tenant-* header or tenantId in body/query
  });

  it('I-3 role gate: a WAITER lands on /dashboard when hitting /admin/stock', async () => {
    // arrange: mock authStore with user.role = WAITER, isAuthenticated = true
    // act: <MemoryRouter initialEntries={['/admin/stock']}>
    // assert: rendered route is /dashboard (the ProtectedRoute redirect)
  });

  it('I-6 alert UI does not re-emit: opening the dashboard fires no socket.emit', async () => {
    // arrange: spy on the socket instance from lib/socket; render <StockDashboard/>
    // act: wait for useStockDashboard to resolve
    // assert: socket.emit was not called (the page is read-only;
    //         note: backend may still emit on its read side — see backend F-7)
  });
});
```

Cross-link: every "FAILS today" test above pairs with a backend finding in [`./stock-management.md`](./stock-management.md). The pagination test (I-4 / F-3) is the most useful — it would catch both the client and the server gap in one integration sweep. Cross-tenant style test should mirror `CODE_REVIEW.md` §3.1: render the feature with two distinct JWTs sequentially, assert each session only sees its own tenant's data (driven by the backend response — the client carries no tenant marker to falsify).
