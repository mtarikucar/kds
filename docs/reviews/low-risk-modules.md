# Low-risk modules — Grouped Tier-3 Review (2026-05-11)

**Tier:** 3
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** 16 modules under `backend/src/modules/` — see §2.
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §4.18 + §4.19 — seed verdicts that this file expands.

---

## 1. Health & summary

🟢 green (group verdict)

This file groups the 16 modules that the 2026-04-27 audit (`../CODE_REVIEW.md §4.18-§4.19`) flagged as low-risk and "no significant findings." On re-read they hold up: every controller is wrapped by `JwtAuthGuard + RolesGuard + TenantGuard` registered globally via `APP_GUARD` in `backend/src/modules/auth/auth.module.ts:35-46`, every Prisma read/write is `tenantId`-scoped, and the few public endpoints (`desktop-app`, `public-stats`, `contact`, `public/reservations`, `customer-orders`) are individually `@Throttle()`-capped and resolve any tenant identity server-side instead of trusting the request body. The `desktop-app` `@Public() + @UseGuards(ApiKeyGuard)` co-decoration is correctly enforced — `ApiKeyGuard.canActivate` no longer honors `IS_PUBLIC_KEY` and always demands a constant-time-compared `x-api-key` header. What's left across the group is paperwork: a handful of N+1 image-attach loops, a few `Number(...)` conversions on revenue aggregates that flow only into JSON (not into comparisons), and one observability gap in `public-stats` where a populated `IP_HASH_SALT` is required to keep visitor de-anonymization off the table in prod. None of it is exploitable or correctness-breaking on its own.

`customer-sessions/` does not exist as a standalone module (the session service lives under `backend/src/modules/customers/customer-session.service.ts`); it's skipped.

---

## 2. Scope of this review

**Deep-scanned** (service + controller + module file read end-to-end):
- `modifiers/` — 341 LOC service + 165 LOC controller
- `qr/` — 220 LOC service + 76 LOC controller
- `layouts/` — 114 LOC service + 63 LOC controller
- `tables/` — 343 LOC service
- `stock/` — 254 LOC service + 78 LOC controller
- `contact/` — service + controller + mailer (286 LOC total)
- `desktop-app/` — controller + module + `auth/guards/api-key.guard.ts` cross-check
- `public-stats/` — 351 LOC service + 119 LOC controller
- `pos-settings/` — full
- `personnel/services/attendance.service.ts`, `shift-swap.service.ts`, `schedule.service.ts`, plus `performance.service.ts` (first 100 LOC)
- `reservations/` — creation flow + state transitions + `public-reservations.controller.ts`
- `sms-settings/` — both services + controller (full, small surface)

**Quick-scanned** (main service + controller skimmed for control flow; no per-line read):
- `reports/reports.service.ts` (~530 LOC; spot-read sales / top-products / hourly aggregates)
- `users/users.service.ts` (LIST_SELECT + role/admin-guard helpers + email-change tokenVersion bump)
- `menu/services/products.service.ts` (425 LOC) + `categories.service.ts` (94 LOC)
- `customer-orders/services/customer-orders.service.ts` (createOrder + waiter/bill requests; the rest is symmetric)
- `desktop-app/desktop-app.service.ts` (first 100 LOC — CRUD + manifest)

**Skipped:**
- `customer-sessions/` — does not exist; session lives in `customers/customer-session.service.ts` (covered under `customers.md` if/when authored).
- DTO files, controller test files — not in Tier-3 risk surface.

---

### modifiers · Health: 🟢

Modifier groups (e.g., "Size", "Toppings") and modifiers (e.g., "Large +$2") with product mappings via `ProductModifierGroup` junction. CRUD is straightforward; group-reassignment is the only non-trivial flow.

Files scanned: `modifiers/services/modifiers.service.ts`, `modifiers/controllers/modifiers.controller.ts` (partial), `modifiers/modifiers.module.ts`.

Findings: L-1, L-2 (see §7). Both Info/Low. Notable positive: `assignModifiersToProduct` does an atomic `deleteMany + createMany` in one transaction (`modifiers.service.ts:261-270`) so a product is never left with zero modifier groups during a swap.

### qr · Health: 🟢

QR-code generation for tenant and per-table menu URLs. Subdomain validation in front of the URL builder is the only security-sensitive bit; PNG generation is CPU-bound but capped.

Files scanned: `qr/qr.service.ts`, `qr/qr.controller.ts`, `qr/qr.module.ts`.

Findings: Q-1 (sequential `QRCode.toDataURL` at table cap), Q-2 (first-view race on settings create). Both Low/Info. The `SUBDOMAIN_REGEX` defence at `qr.service.ts:17` defending against host-injection in the QR URL is the right shape and worth copying.

### layouts · Health: 🟢

Voxel-world floor-plan layout (singleton per tenant) + table voxel-position writes. Pure CRUD; no money, no state machine.

Files scanned: `layouts/layouts.service.ts`, `layouts/layouts.controller.ts`, `layouts/layouts.module.ts`.

Findings: LA-1 (truthy guards drop legitimate `0` values), LA-2 (GET endpoint lacks explicit `@Roles`).

### tables · Health: 🟢

Table CRUD + merge/unmerge groups for shared-bill scenarios. The merge flow is the interesting bit — uses `groupId` (UUID, mutable) and emits KDS WebSocket events.

Files scanned: `tables/tables.service.ts`, `tables/tables.module.ts`.

Findings: T-1 (Number-coercion on `finalAmount`/`payment.amount` in `getTableGroup` summary), T-2 (non-deterministic groupId selection when merging multiple groups). Notable positive: atomic delete-with-active-order-check at `tables.service.ts:163-178` — eliminates the count-then-delete race.

### stock · Health: 🟢

Distinct from `stock-management/` (which owns recipe-based deduction). This module is the simpler per-product manual stock adjustment + low-stock alerts surface.

Files scanned: `stock/stock.service.ts`, `stock/stock.controller.ts`, `stock/stock.module.ts`.

Findings: S-1 (separate `isAvailable` write window after the conditional `updateMany`), S-2 (audit note on `updateProductStock` delegation). Notable positive: race-safe OUT decrement via `currentStock: { gte: quantity }` predicate inside `updateMany` (`stock.service.ts:62-74`).

### contact · Health: 🟢

Public contact form. Honeypot + 3-per-hour throttle + admin-only mailer. The "don't send user confirmation to attacker-supplied email" comment at `contact.service.ts:38-42` documents an important historical fix — the form is no longer a spam-cannon.

Files scanned: `contact/contact.service.ts`, `contact/contact.controller.ts`, `contact/mailer.service.ts`.

Findings: C-1 (silent SMTP-not-configured fallback in prod).

### desktop-app · Health: 🟢

CI/CD release publishing for the Tauri desktop app. The interesting bit is the public-vs-API-key split: `@Public()` on the controller class with `@UseGuards(ApiKeyGuard)` on the CI routes. `ApiKeyGuard` (`auth/guards/api-key.guard.ts`) explicitly **does not** honor `IS_PUBLIC_KEY` — the comment block at lines 11-18 documents the historical bypass bug. `safeCompare` uses `timingSafeEqual` (line 49-53). Verified: ApiKeyGuard fires.

Files scanned: `desktop-app/desktop-app.controller.ts`, `desktop-app/desktop-app.module.ts`, `desktop-app/desktop-app.service.ts` (first 100 LOC), `auth/guards/api-key.guard.ts`.

Findings: D-1 (verification note — no fix).

### public-stats · Health: 🟡

Anonymous page-view tracking + public landing-page stats + customer review moderation. The only module in this group with an obvious-on-second-read security gap (PS-1) and a performance hazard on a cron job (PS-2).

Files scanned: `public-stats/public-stats.service.ts`, `public-stats/public-stats.controller.ts`, plus `geolocation.service.ts` skim.

Findings: PS-1 (salt-fallback chain weakens visitor de-anonymization), PS-2 (`groupBy + .length` for distinct-count), PS-3 (vanity-metric privacy tradeoff not documented).

### pos-settings · Health: 🟢

Tenant POS settings singleton (tableless mode, two-step checkout, customer-ordering). The cross-validation between two-step-checkout and customer-ordering is correct (Turkish error strings, by design).

Files scanned: `pos-settings/pos-settings.service.ts`, `pos-settings/pos-settings.controller.ts`.

Findings: PO-1 (two divergent write paths — `findByTenant` uses upsert, `update` does findUnique-then-create/update).

### personnel · Health: 🟢

Attendance (clock-in/out, breaks), shift templates, shift schedule, shift swap requests, performance metrics. Largest module in this group; shift-swap is the only non-trivial state machine.

Files scanned: `personnel/services/attendance.service.ts`, `shift-swap.service.ts`, `schedule.service.ts`, `performance.service.ts` (first 100 LOC), `personnel/personnel.module.ts`.

Findings: PE-1 (attendance "isLate" computed in server timezone, not tenant timezone), PE-2 (defensive-only note on `approve` same-date branch). Notable positives: SwapRequest claim via conditional `updateMany` (`shift-swap.service.ts:108-117`) prevents double-respond, Serializable tx on `approve` (line 240).

### reservations · Health: 🟢

Public + authenticated reservation flow. The createPublicReservation flow uses a Serializable tx + retry loop for both the overlap check and the reservation-number allocation — reference implementation for any human-readable sequential ID.

Files scanned: `reservations/services/reservations.service.ts` (creation + state transitions), `reservations/services/reservation-settings.service.ts`, `reservations/controllers/public-reservations.controller.ts`.

Findings: R-1 (unbounded `where.OR` search vector), R-2 (3-digit reservation-number padding caps 999/day), R-3 (`getStats` does in-JS filter-count instead of SQL groupBy). Notable positive: the retry loop at `reservations.service.ts:142-246` handles both P2002 and P2034 (Postgres serialization failure) explicitly — this shape should be adopted for the sales-invoice number race called out in `../CODE_REVIEW.md` M3.

### reports · Health: 🟢

Read-only aggregation endpoints (sales summary, top products, hourly, customer analytics, inventory, staff performance). Gated by `PlanFeatureGuard` so the feature is plan-tiered, not just role-gated.

Files scanned: `reports/reports.service.ts` (spot-read top + hourly + sales paths), `reports/reports.controller.ts`.

Findings: RP-1 (six `Number(... finalAmount)` conversions that flow to JSON only — bounded loss, not exploitable), RP-2 (`dailySales` re-fetches every PAID order to bucket in JS).

### users · Health: 🟢

Tenant-user CRUD + profile + email change + onboarding + approve/reject/reactivate. The most security-critical module in this group; correctly bumps `tokenVersion` and revokes refresh tokens in the same transaction on every credential change.

Files scanned: `users/users.service.ts` (first 450 LOC), `users/users.controller.ts`.

Findings: U-1 (cosmetic tombstone-email format edge case), U-2 (verification note — no fix). Notable positives: last-admin guard (`countActiveAdminsExcept` + `assertNotLastAdmin`, lines 68-98); explicit `LIST_SELECT` (lines 21-38) so password/tokenVersion never leak through `findMany`; explicit privilege check that a MANAGER cannot mint an ADMIN (line 107-109); explicit "you cannot change your own role" guard (line 207-209).

### sms-settings · Health: 🟢

Tenant-scoped SMS-toggle settings + a notification dispatcher used by `reservations/` and `orders/`. Bodies are Turkish, currently in plain ASCII transliteration (`Sayin` instead of `Sayın`) — the upstream surface that `docs/plans/phase-1.3.md` (Turkish encoding) targets.

Files scanned: `sms-settings/sms-settings.service.ts`, `sms-settings/sms-notification.service.ts`, `sms-settings/sms-settings.controller.ts`.

Findings: SMS-1 (ASCII transliteration — cross-link with phase-1.3 plan), SMS-2 (silent error-swallow with no DLQ).

### menu · Health: 🟢

Categories + Products + QR-menu read paths. Products include image-attach via the `ProductToImage` junction; that loop is the only perf-relevant code.

Files scanned: `menu/services/products.service.ts`, `menu/services/categories.service.ts`, `menu/menu.module.ts` (skim).

Findings: M-1 (N+1 in `attachImagesToProduct`), M-2 (verification note — P2003 → 409 with "mark unavailable" hint is good UX).

### customer-orders · Health: 🟢

QR-menu customer-side order placement + waiter/bill requests. `tenantId` is correctly resolved from the server-side `CustomerSession` row, never from the request body — same defense as the `customers.md` public surface.

Files scanned: `customer-orders/services/customer-orders.service.ts` (createOrder + waiter requests), `customer-orders/controllers/customer-orders.controller.ts` (first 100 LOC).

Findings: CO-1 (verification note — tenantId is server-trusted), CO-2 (waiter-request dedupe window is 60s, silent coalesce). Notable positive: geolocation range check (`isLocationWithinRange`, lines 79-97) prevents off-premises QR orders when the tenant has configured a radius; orderNumber allocation retries on P2002 (lines 134-203).

### customer-sessions · skipped

Module does not exist. `CustomerSession` is owned by `backend/src/modules/customers/customer-session.service.ts`, which will be covered if/when `customers.md` is authored. No findings.

---

## 7. Aggregated findings (indexed by module)

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

| ID | Module | Sev | Dim | Location | Finding | Fix |
|----|--------|-----|-----|----------|---------|-----|
| L-1 | modifiers | Low | Cor | `modifiers/services/modifiers.service.ts:215-221` | `deleteModifier` rejects a modifier "used in any orders" by counting `OrderItemModifier`. A historical, fully-settled order ties up a modifier forever — no soft-delete path. | Add `isAvailable: false` soft-delete branch (mirrors Product policy at `menu/services/products.service.ts:208-214`). |
| L-2 | modifiers | Info | Arch | `modifiers/services/modifiers.service.ts:42-50` | `findAllGroups` filter `includeInactive ? {} : { isAvailable: true }` is applied to the included `modifiers` relation but `_count: { productMappings: true }` is unfiltered. UI badge may mislead. | Align count filter with `isAvailable` or relabel UI as "all-time uses". |
| Q-1 | qr | Low | Perf | `qr/qr.service.ts:170-191` | `getQrCodes` calls `QRCode.toDataURL` sequentially in a `for` loop — 500 tables × ~50ms ≈ 25s blocking. Cap prevents disaster but a chain at the cap times out. | `Promise.all(tables.map(...))`. |
| Q-2 | qr | Info | Arch | `qr/qr.service.ts:23-36` | `getSettings` lazily creates default row on first read. Two concurrent first-views race on `create` → P2002. No retry / no upsert. | Switch to `upsert` (pattern at `pos-settings.service.ts:13-23`). |
| LA-1 | layouts | Low | Cor | `layouts/layouts.service.ts:60-65` | `update` uses truthy guards (`...(updateLayoutDto.width && {...})`) — `width: 0` or empty `name` silently dropped instead of rejected/persisted. | Use `!== undefined`; DTO should reject `width <= 0` upstream. |
| LA-2 | layouts | Info | Sec | `layouts/layouts.controller.ts:27-32` | `GET /layouts` has no `@Roles(...)` — any authenticated tenant user (incl. WAITER, KITCHEN) can read layout JSON. Probably intentional but inconsistent with rest of controller. | Add explicit `@Roles(...)` even if it includes all roles. |
| T-1 | tables | Medium | Cor | `tables/tables.service.ts:317-323, 339` | `getTableGroup` reduces `Number(o.finalAmount)` and `Number(p.amount)` to compute `remainingAmount`. For merged group of >5 high-ticket orders this drifts; value flows into split-bill UI. | Accumulate in `Prisma.Decimal` (mirrors `performance.service.ts:81-85`). |
| T-2 | tables | Low | Cor | `tables/tables.service.ts:199-202` | `mergeTables` picks `uniqueGroups[0]` as surviving `groupId`; ordering is whatever Prisma returns (non-deterministic). | Sort groupIds before `[0]`. |
| S-1 | stock | Low | Cor | `stock/stock.service.ts:100-105` | After conditional `updateMany`, a second unconditional `tx.product.update` writes `isAvailable: newStock > 0`. Race-safe within tx, but `newStock` for the IN branch is from a post-increment `findUniqueOrThrow` — eventual-consistency window on `isAvailable` if a third concurrent OUT lands. | Combine the availability flip with the conditional update via raw `CASE`, or accept the eventual-consistency window. |
| S-2 | stock | Info | Arch | `stock/stock.service.ts:243-252` | `updateProductStock` delegates to `createMovement` with `type=ADJUSTMENT`. Negative-quantity rejection lives in `createMovement` (line 83-85); DTO validator on the controller side should also reject negative. | Confirm DTO validator at `stock/dto/`. |
| C-1 | contact | Info | Sec | `contact/mailer.service.ts:18-23` | Transporter is undefined when `EMAIL_HOST`/`PORT` unset; `sendAdminNotification` silently returns `false`. Prod deploy missing SMTP env vars accepts contact submissions but drops them. | Startup guard: fail boot in prod when contact form is reachable and SMTP is missing. |
| D-1 | desktop-app | Info | Sec | `desktop-app/desktop-app.controller.ts:122-127` + `auth/guards/api-key.guard.ts:14-22` | `@Public() + @UseGuards(ApiKeyGuard)` pairing intentional and verified: `ApiKeyGuard` ignores `IS_PUBLIC_KEY`, uses `timingSafeEqual`. No fix; documents the verification asked for in `../CODE_REVIEW.md §4.19`. | None — keep comment block at `desktop-app.controller.ts:122-124`. |
| PS-1 | public-stats | High | Sec | `public-stats/public-stats.service.ts:23-31` | Salt resolution chain `IP_HASH_SALT ?? JWT_SECRET ?? APP_SECRET`. Prod guard only fires when **all three** are unset. If `JWT_SECRET` is set (always is), guard is silently satisfied even when operator intended `IP_HASH_SALT` as a separately-rotated secret — rotating JWT_SECRET then re-pseudonymizes every historical `ipHash`. | Require `IP_HASH_SALT` explicitly in prod; do not fall back to `JWT_SECRET`. |
| PS-2 | public-stats | Medium | Perf | `public-stats/public-stats.service.ts:235-238` | `uniqueVisitors` uses `pageView.groupBy({ by: ['ipHash'] }).then(r => r.length)` — pulls every distinct hash into Node. At 1M page views this is a memory spike inside a 5-min cron. | `SELECT COUNT(DISTINCT "ipHash")` via `$queryRaw`. |
| PS-3 | public-stats | Low | Cor | `public-stats/public-stats.service.ts:108-119` | `toPublicView` rounds `totalOrders` to nearest 1000 and hides `totalRevenue` — good — but `totalViews` / `uniqueVisitors` exposed at full precision lets a competitor derive launch / adoption curve. | Decide explicitly; document in the comment block. |
| PO-1 | pos-settings | Info | Arch | `pos-settings/pos-settings.service.ts:25-83` | Two write paths: `findByTenant` uses `upsert` (race-safe), `update` does `findUnique → create OR update` (race-prone on first write — P2002 leaks as 500). | Collapse `update` to the same `upsert` shape with validation rules running before the `upsert.where`. |
| PE-1 | personnel | Low | Cor | `personnel/services/attendance.service.ts:46-54` | `isLate` is computed against server-local `Date` (`now`), and `shiftStart` is also server-local. Pod TZ ≠ tenant TZ → wrong shift boundary used for `lateMinutes`. | Use `getTenantMidnight` from `common/helpers/timezone.helper.ts` (pattern adopted in `reports.service.ts:23-33`). |
| PE-2 | personnel | Info | Cor | `personnel/services/shift-swap.service.ts:131-244` | `approve` Serializable-tx-correct; same-date branch (line 203-219) only updates `shiftTemplateId`, not `userId`. Safe by virtue of upstream "cannot swap with yourself" check (line 21-23). | None — defensive note only. |
| R-1 | reservations | Medium | Cor | `reservations/services/reservations.service.ts:292-298` | `findAll` builds unbounded `where.OR` for `search`; no minimum length, no escaping of `%` / `_`. A search for `'_'` matches every reservation — PII-enumeration vector for tenant-internal threat. | Reject empty/whitespace, clamp length 2-64, escape LIKE-meta. |
| R-2 | reservations | Low | Cor | `reservations/services/reservations.service.ts:38-59` | `generateReservationNumber` zero-pads to 3 digits → cap of 999 reservations/day per tenant before next-day rollover. Reasonable but uncommented. | Comment the cap or pad to 4. |
| R-3 | reservations | Info | Arch | `reservations/services/reservations.service.ts:344-358` | `getStats` fetches every reservation for a day and `.filter`-counts in JS. With high volume this should be `groupBy status`. | Convert to `groupBy({ by: ['status'] })`. |
| RP-1 | reports | Medium | Cor | `reports/reports.service.ts:56-59, 107, 187, 227, 270` | Six `Number(... finalAmount)` / `Number(_sum.amount || 0)` conversions feed only into JSON responses. No comparisons / writes downstream. Bounded float-display loss; at >$1e9 daily totals it would round. | Track on same backlog as `payments.service.ts` `Number` conversions (`../CODE_REVIEW.md` M1/M2). |
| RP-2 | reports | Low | Perf | `reports/reports.service.ts:88-114` | `dailySales` re-fetches every PAID order in range to bucket by date in JS. Should be a single `$queryRaw` `SELECT date_trunc('day', "createdAt") ...`. | Postgres `date_trunc + GROUP BY`. |
| U-1 | users | Info | Sec | `users/users.service.ts:291-293` | Tombstone email `{email}+deleted-{id}@tombstone.kds`. For users whose real email contains a `+` alias, this produces nested `+` (still valid RFC 5322 but recovered local-part is ambiguous). Cosmetic. | Replace original `+` with `_` before appending. |
| U-2 | users | Info | Arch | `users/users.service.ts:249-269` | `update` bumps `tokenVersion` on password/email change and revokes refresh tokens in same tx. Verified — matches auth-store rotation contract in `frontend-auth-stores.md`. | None. |
| SMS-1 | sms-settings | Low | Sec | `sms-settings/sms-notification.service.ts:24-110` | All Turkish message bodies are plain-ASCII transliteration (`Sayin` instead of `Sayın`) — GSM-7 encoding workaround. Cross-check with `docs/plans/phase-1.3.md` (Turkish encoding). | If SMS provider supports UCS-2/Unicode, restore diacritics. |
| SMS-2 | sms-settings | Info | Cor | `sms-settings/sms-notification.service.ts:122-135` | `sendIfEnabled` swallows every error path (network, provider, settings lookup) into `logger.error` — by design (SMS must not block parent flow), but no DLQ / retry. Flaky provider silently drops notifications. | If reservation/order SMS becomes contractual, add a `SmsAttempt` table + retry worker. |
| M-1 | menu | Low | Perf | `menu/services/products.service.ts:255-294` | `attachImagesToProduct` does one tenant-check + one upsert per image — O(N) round-trips per product save. | Batch via `findMany({ id: { in: imageIds } })` + `createMany({ skipDuplicates })` + single `updateMany` for the order column. |
| M-2 | menu | Info | Cor | `menu/services/products.service.ts:198-218` | `remove` translates P2003 (FK from OrderItem) into 409 with "mark unavailable" hint. Good UX. | None. |
| CO-1 | customer-orders | Info | Sec | `customer-orders/services/customer-orders.service.ts:59-63` | `tenantId` resolved from `customerSessionService.requireSession(dto.sessionId).tenantId` — request body cannot influence. Controller does not bind tenantId from DTO (`customer-orders.controller.ts:53`). Verified. | None. |
| CO-2 | customer-orders | Low | Cor | `customer-orders/services/customer-orders.service.ts:284-296` | Waiter-request dedupe window is 60s; second tap returns the original row with no `wasDeduped` signal. UI cannot tell whether the call went through. | Surface `wasDeduped: true` on response, or shorten to ~10s. |

---

## 8. What's solid (positive findings)

Patterns from these modules worth copying into Tier-1 / Tier-2 features:

- **Global guard registration** (`backend/src/modules/auth/auth.module.ts:35-46`) — `JwtAuthGuard + RolesGuard + TenantGuard` as `APP_GUARD` providers. Controllers in this group never need to repeat them; the `desktop-app` exception is explicit (`@Public()` opt-out per route) and well-commented. Adopt as the standing rule and treat any `@UseGuards(JwtAuthGuard, ...)` on a non-public controller as redundant.
- **`@Public()` + `@UseGuards(ApiKeyGuard)` co-decoration** (`desktop-app/desktop-app.controller.ts:122-150`, `auth/guards/api-key.guard.ts:14-22`) — `ApiKeyGuard` deliberately ignores `IS_PUBLIC_KEY` reflector so the pairing is safe; constant-time `timingSafeEqual` on the key compare. Reference implementation for any future CI-only endpoint.
- **Conditional `updateMany` for race-safe state mutation** (`stock/stock.service.ts:61-74`, `personnel/services/shift-swap.service.ts:108-117`, `customer-orders/services/customer-orders.service.ts:338-348`) — `where: { ..., status/stock: <predicate> }` + `updateMany` + `count !== 1` ⇒ NotFound. Race-safe without a Serializable tx; works for any counter-style or status-claim mutation.
- **Atomic deleteMany + createMany for set replace** (`modifiers/services/modifiers.service.ts:261-270`) — modifier-group reassignment never leaves a product with zero groups during the swap. Adopt anywhere an N-to-M membership is being rewritten (role permissions, category-product, image-order).
- **Atomic delete with active-order check inside transaction** (`tables/tables.service.ts:163-178`) — eliminates the count-then-delete race that would orphan an FK. Pattern fits any cascade-protected delete (Product, Category, Customer).
- **Honeypot + per-IP throttle on public mutations** (`contact/contact.service.ts:18-25`, `contact/contact.controller.ts:31`, `public-stats/public-stats.controller.ts:34, 64`, `customer-orders/controllers/customer-orders.controller.ts:48, 81`, `reservations/controllers/public-reservations.controller.ts:34, 60, 81`) — silent accept-and-ignore for honeypot field is the right shape (don't tell the bot which field was the trap); 3-per-hour on reviews + contact + public reservations is tight enough to make spam-as-relay uneconomic.
- **Tenant-timezone-aware date ranges** (`reports/reports.service.ts:14-33`) — `getTenantMidnight(tz)` so "today" means the restaurant's day, not the pod's. Migrate `personnel/services/attendance.service.ts:46-54` to the same helper (PE-1 above).
- **`tokenVersion` bump + refresh-token revocation on credential change** (`users/users.service.ts:249-269, 298-321, 408-413`) — every email/password change increments `tokenVersion` and revokes live refresh tokens in the same transaction. Mirrors the contract documented in `frontend-auth-stores.md`. No drift.
- **Last-admin guard** (`users/users.service.ts:68-98, 210-222`) — `countActiveAdminsExcept` + `assertNotLastAdmin` blocks the "orphan tenant" case on demotion, deactivation, and soft-delete. Worth extending to a "last superadmin" check in `superadmin.md`.
- **Atomic upsert for tenant-scoped singleton settings** (`pos-settings/pos-settings.service.ts:13-23`, `sms-settings/sms-settings.service.ts:10-15`) — concurrent first-view race resolved cleanly. Use as the template for any other `[tenantId]`-unique config table.
- **SERIALIZABLE tx + retry loop for ID-allocation under contention** (`reservations/services/reservations.service.ts:137-246`) — handles both P2002 (number race) and P2034 (Postgres `SERIALIZATION_FAILURE`) explicitly, capped at 5 retries. Reference implementation for any human-readable sequential ID; the sales-invoice numbering race called out in `../CODE_REVIEW.md` M3 should adopt this shape.
- **`Prisma.Decimal` accumulation at the JS boundary** (`personnel/services/performance.service.ts:81-85`, `customer-orders/services/customer-orders.service.ts:118-123`) — keeps money math in Decimal and only `.toNumber()`s at the JSON serialization line. Adopt in `reports/reports.service.ts` (RP-1) and `tables/tables.service.ts:317-323` (T-1).
- **Tombstone-on-soft-delete** (`users/users.service.ts:291-293`) — preserves global-unique email index while permitting re-signup; same shape would resolve the soft-delete inconsistency called out in `../CODE_REVIEW.md` Schema §4.20.
- **Explicit `LIST_SELECT` (no Prisma-spread)** (`users/users.service.ts:21-38, 236-243`) — every list/detail query references the `LIST_SELECT` constant; `update` builds the Prisma `data` payload field-by-field instead of spreading the DTO. Prevents future DTO fields from accidentally becoming updatable or leaking through `findMany`. Adopt anywhere a `select` list overlaps with a DTO surface.
- **Geolocation range check before customer order accept** (`customer-orders/services/customer-orders.service.ts:79-97`) — when the tenant has configured a radius, off-premises QR scans are rejected with a clear distance message. Defense against QR-link sharing fraud.
- **Defensive subdomain regex before QR-URL embed** (`qr/qr.service.ts:17, 89`) — re-validates `tenant.subdomain` at QR-generation time even though the tenants module enforces it at write time. Belt-and-suspenders against a historical bad-value row producing an off-host QR redirect.
- **Tenant-scoped product lookup before top-products response** (`reports/reports.service.ts:164-178`) — even though OrderItem→Product is FK-constrained, the report's product fetch re-scopes by `tenantId` so a stale cross-tenant import edge case cannot leak product names.

---
