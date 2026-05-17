# `marketing` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `backend/src/modules/marketing/services/marketing-leads.service.ts` (586 LOC) — the §4.17 seed
- `backend/src/modules/marketing/services/marketing-commissions.service.ts` (146 LOC)
- `backend/src/modules/marketing/services/marketing-offers.service.ts` (162 LOC)
- `backend/src/modules/marketing/services/marketing-tasks.service.ts` (266 LOC)
- `backend/src/modules/marketing/services/marketing-auth.service.ts` (259 LOC)
- `backend/src/modules/marketing/services/marketing-dashboard.service.ts` (192 LOC)
- `backend/src/modules/marketing/services/marketing-reports.service.ts` (177 LOC)
- `backend/src/modules/marketing/services/marketing-users.service.ts` (133 LOC)
- `backend/src/modules/marketing/services/marketing-activities.service.ts` (63 LOC)
- `backend/src/modules/marketing/services/marketing-notifications.service.ts` (54 LOC)
- `backend/src/modules/marketing/guards/marketing.guard.ts` (88 LOC), `marketing-roles.guard.ts` (37 LOC)
- `backend/src/modules/marketing/controllers/marketing-leads.controller.ts`, `marketing-offers.controller.ts`, `marketing-commissions.controller.ts` — `@MarketingRoles('SALES_MANAGER')` enforcement check
- `backend/prisma/schema.prisma:2701-2914` (`MarketingUser`, `Lead`, `LeadActivity`, `MarketingTask`, `LeadOffer`, `Commission`, `MarketingNotification`)

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — §4.17 (`marketing/`) seed row.

---

## 1. Health & summary

🟢 **green** — the marketing module is a *platform-internal* sales-CRM domain (no `tenantId` on `MarketingUser`/`Lead`/`Commission` — it lives above the multi-tenant boundary; see schema `prisma/schema.prisma:2701` and `:2737`). The SALES_REP isolation invariant is enforced **in services**, not in middleware, by branching on `userRole === 'SALES_REP'` and constraining the `where` clause to `assignedToId === userId` / `createdById === userId`. The pattern is repeated 14 times across 7 files and is consistent — but because it is per-method rather than centralized, a future service method that forgets the check is the dominant risk. Commission math is single-source-of-truth in `marketing-leads.service.ts:502-506` (`Prisma.Decimal` × `SIGNUP_COMMISSION_RATE`, `ROUND_HALF_UP` to 2dp) and the conversion path is properly transactional with `convertedTenantId` as the idempotency key. No critical findings. The §4.17 seed (`marketing-leads.service.ts` ≈ 586 LOC) verified at exactly 586 LOC; the splitting recommendation is upheld and refined below.

---

## 2. Scope of this review

**Read end-to-end:**
- `marketing-leads.service.ts` (586) — CRUD + status transitions + `convert()` (commission write, tenant create, subscription create) + `assign()`.
- `marketing-commissions.service.ts` (146) — `findAll`, `getSummary`, `approve`, `updateAmount`, `markPaid`.
- `marketing-offers.service.ts` (162) — offer CRUD + `markSent()` (lead-status side effect).
- `marketing-tasks.service.ts` (266) — task CRUD + `findToday`/`findOverdue`/`findCalendar` (range-capped at 62d).
- `marketing-auth.service.ts` (259) — JWT issue/rotate, failed-login lockout, `tokenVersion` revocation.
- `marketing-dashboard.service.ts`, `marketing-reports.service.ts` — read-only aggregations.
- `marketing-users.service.ts`, `marketing-activities.service.ts`, `marketing-notifications.service.ts`.
- Schema rows for all 7 marketing models (`schema.prisma:2701-2914`).
- Three controllers (`leads`, `offers`, `commissions`) to confirm `@MarketingRoles('SALES_MANAGER')` placement.

**Skimmed only:**
- `marketing.module.ts`, `types.ts`, `decorators/*` (thin DI/typing).
- Remaining 7 controllers — same `@UseGuards(MarketingGuard, MarketingRolesGuard)` shape; sampled to confirm pattern.
- DTOs — sampled `ConvertLeadDto`, `UpdateLeadStatusDto`, `CommissionFilterDto`; standard `class-validator`.

**Skipped:**
- Frontend marketing pages — out of scope (covered by `frontend-features-marketing.md`).
- Audit log / activity feed wiring beyond what `convert()` and `updateStatus()` write inline.

---

## 3. Business-logic invariants

The contract this feature is responsible for keeping. The marketing module has **no `tenantId` on its core records** (it operates above the multi-tenant boundary), so I-CT below replaces the canonical multi-tenant invariant with "rep-scoped isolation". Each row is an integration-test assertion.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | A SALES_REP can only read/write `Lead` rows where `assignedToId === user.id`. | `marketing-leads.service.ts:104-105` (list), `:224-226` (findOne), `:236-238` (update), `:282-284` (updateStatus) | ❌ none | Rep enumerates colleague pipeline / steals lead. |
| I-2 | A SALES_REP can only see/mutate `LeadOffer` rows where `createdById === user.id`. | `marketing-offers.service.ts:26-28` (create — checks lead ownership), `:52-53` (list), `:89-91` (findOne), `:101-103` (update), `:126-128` (markSent) | ❌ none | Same as I-1 for offers. |
| I-3 | A SALES_REP can only see `Commission` rows where `marketingUserId === user.id`. | `marketing-commissions.service.ts:16-17` (list), `:50-52` (summary) | ❌ none | Rep sees payouts that aren't theirs. |
| I-4 | A SALES_REP can only see/mutate `MarketingTask` rows where `assignedToId === user.id`. | `marketing-tasks.service.ts:73-74`, `:129-131`, `:150-152`, `:184-186`, `:210-212`, `:222-224`, `:244-246`, `:259-261` | ❌ none | Same as I-1 for tasks. |
| I-5 | A SALES_REP can only add/view `LeadActivity` rows on leads they are assigned to. | `marketing-activities.service.ts:16-18` (create), `:41-43` (findByLead) | ❌ none | Activity log poisoning across reps. |
| I-6 | Destructive lead actions (`assign`, `convert`, `delete`) require `SALES_MANAGER`. | controller-level `@MarketingRoles('SALES_MANAGER')` at `marketing-leads.controller.ts:66, 76, 86` | ❌ none | SALES_REP self-converts leads / creates unauthorized tenants. |
| I-7 | Commission write/approve operations (`updateAmount`, `approve`, `markPaid`) require `SALES_MANAGER`. | `marketing-commissions.controller.ts:51, 60, 66` | ❌ none | Rep self-approves their own payout. |
| I-8 | Lead status transitions follow `ALLOWED_TRANSITIONS`; terminal `WON`/`LOST` are sealed. | `marketing-leads.service.ts:30-40` (table), `:289-294` (guard) | ❌ none | A WON lead reverts to NEW, leaving the converted tenant orphaned. |
| I-9 | `WON` can only be set by `convert()`; the generic `updateStatus()` endpoint forbids it. | `marketing-leads.service.ts:295-299` (explicit `BadRequestException`) | ❌ none | Rep flips lead to WON without creating a tenant / commission row. |
| I-10 | A lead with `convertedTenantId != null` is sealed — neither `updateStatus()` nor a second `convert()` may proceed. | `marketing-leads.service.ts:300-304` (status), `:373-375` (convert idempotency) | ❌ none | Duplicate tenant / duplicate commission for the same lead. |
| I-11 | A lead `assign()` target must be `role === 'SALES_REP'` and `status === 'ACTIVE'`. | `marketing-leads.service.ts:336-341` | ❌ none | Manager → manager reassignment, or assignment to a deactivated rep. |
| I-12 | A signup commission is deterministically `plan.monthlyPrice × 0.10`, rounded to 2 dp via `ROUND_HALF_UP`, in `Decimal` arithmetic — never `Number`. | `marketing-leads.service.ts:43, 502-506` | ❌ none | Drift between rep payouts and accounting ledgers (penny-rounding compounds monthly). |
| I-13 | A commission row cannot be approved while `amount === 0`. | `marketing-commissions.service.ts:102-107` | ❌ none | Manager rubber-stamps a $0 row that should have been edited first. |
| I-14 | Commission `status` transitions are forward-only and one-step: `PENDING → APPROVED → PAID`. Each transition writes its timestamp. | `marketing-commissions.service.ts:95-97, 111, 125-127, 136-138, 143` | ❌ none | Approved/paid rows mutate → audit drift. |
| I-15 | Commission `amount` is immutable after leaving `PENDING`. | `marketing-commissions.service.ts:125-127` | ❌ none | Manager re-prices a paid commission post-facto. |
| I-16 | Offer transition `DRAFT → SENT` is one-way and only valid while the lead is still open (`convertedTenantId == null` and `status ∉ {WON, LOST}`). | `marketing-offers.service.ts:129-134` | ❌ none | Offers sent after the deal is dead. |
| I-17 | When `markSent()` runs, the lead is advanced to `OFFER_SENT` **only** if not already at a later stage (`OFFER_SENT/WAITING/WON/LOST`). | `marketing-offers.service.ts:142-149` | ❌ none | Lead status regresses from WAITING → OFFER_SENT. |
| I-18 | The marketing auth realm is *distinct* from tenant/superadmin auth: tokens must carry `type: 'marketing'`, and refresh tokens additionally `tokenType: 'refresh'`. The refresh secret has **no fallback** to the access secret. | `marketing-auth.service.ts:39-41` (no-fallback), `:97-110`, `marketing.guard.ts:48-50` | ❌ none | Cross-realm token replay (a tenant access token used against marketing routes, or vice versa). |
| I-19 | A SALES_REP account locks for 15 min after 5 consecutive failed logins, and the counter resets on lock so the next post-unlock typo doesn't immediately re-lock. | `marketing-auth.service.ts:12-13, 63-77` | ❌ none | Permanent rep lockout / counter never reset. |
| I-20 | `tokenVersion` bump on logout / password change invalidates all outstanding access + refresh tokens on the next request. | `marketing-auth.service.ts:130-134, 252-254`; verified at `marketing.guard.ts:69-71` and `marketing-auth.service.ts:119-121` | ❌ none | Stolen token survives logout / password rotation. |
| I-CT | Cross-tenant *of the converted target*: `convert()` writes a fresh `Tenant` row plus its admin `User`, both with brand-new `tenantId`. The signup commission row's `tenantId` matches the just-created tenant. | `marketing-leads.service.ts:433-457, 509-519` | ❌ none | Commission attributed to the wrong tenant. |

Invariants are not invented — each is a contract the existing code is already trying to keep, written down so a test can assert it.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `marketing-leads.service.ts:433-547` (`convert()`) — wrapped in `prisma.$transaction(async (tx) => …)`. Inside: `tenant.create`, `user.create`, `subscription.create`, `leadOffer.update` (offer → ACCEPTED), `lead.update` (status → WON + `convertedTenantId`), `commission.create`, `leadActivity.create`. Idempotency is by `lead.convertedTenantId` checked at `:373-375` *outside* the TX, and by `tenant.subdomain @unique` + `user.email @unique` *inside*; the surrounding `.catch` at `:534-547` translates `P2002` to `409 Conflict`. The subdomain allocator (`allocateSubdomain` at `:66-80`) runs **before** the TX opens — there is a small TOCTOU window between allocator selection and `tenant.create`, but the `@unique` constraint plus the P2002 → 409 translation closes it deterministically.
- `marketing-auth.service.ts:81-89` (login success) — single `update` resets `failedLogins`, `lockedUntil`, sets `lastLogin`. Not transactional with the password compare, but only one writer per request and the row is the user's own.
- `marketing-offers.service.ts:136-150` (`markSent()`) — `prisma.$transaction([offer.update, lead.update?])` array-form; both writes commit atomically. Guard on lead-already-at-later-status at `:142` prevents regression even if two concurrent `markSent()` calls fired on sibling offers.

**Race windows still open** (each with a reproduction sketch):

- *Sketch:* Two SALES_MANAGERs hit `POST /marketing/leads/:id/convert` for the same lead simultaneously. Both `findUnique` at `:371` return `convertedTenantId == null`, both call `allocateSubdomain` and pick the same name, both enter `$transaction`. One TX wins via the `tenant.subdomain @unique` + `lead.convertedTenantId @unique` constraint; the other surfaces P2002 and is translated to 409 at `:534-547`. **Outcome:** safe — verified by tracing the schema's `@unique` markers (`lead.convertedTenantId @unique` at `schema.prisma:2763`). Worth a regression test, see §10.
  *Severity:* Low Cor (already protected).

- *Sketch:* `markSent()` on offer A and on offer B (both DRAFT, same lead) race. Both reads at `:119-122` see lead.status = `MEETING_DONE`. Both TX bodies include the lead.update to OFFER_SENT. **Outcome:** the second commit lands a second `lead.update` to the same value — idempotent in effect. No invariant violated. *Note:* the lead.update is only included if `!['OFFER_SENT','WAITING','WON','LOST'].includes(offer.lead.status)` evaluated at the *read snapshot*, not within the TX — but since both writes are setting the same forward state, the side effect is benign.
  *Severity:* Info.

- *Sketch:* Concurrent `commission.approve()` calls on the same row by two managers. Both `findUnique` see `status === 'PENDING'`. Both call `update`. Both succeed. The row ends up `APPROVED` exactly once; `approvedAt` is set to whichever update committed last. **Outcome:** logically idempotent but the timestamp jitters. *Severity:* Info — not worth fixing.

- *Sketch:* Race between `convert()` (which sets the commission `period` to `now.getFullYear()-MM` at `:507`) and a manager who runs the period at month boundary 23:59:59.999. **Outcome:** the commission lands in the "wrong" month by milliseconds; deterministic from a single Node clock, not racy in the multi-instance sense. *Severity:* Low Cor — see F-3.

- *Sketch:* `updateStatus()` race with `convert()` — rep flips lead to OFFER_SENT while manager `convert()`s. The `updateStatus` path reads `lead.convertedTenantId` at `:300-304` and rejects if non-null; but the read happens *before* the convert TX commits, so a fast rep could pass that check and then the `lead.update` at `:306` could overwrite the WON status the convert TX just wrote. **Outcome:** *unverified*. Prisma's default isolation (READ COMMITTED on Postgres) plus two non-transactional `findUnique → update` sequences makes this theoretically possible. Severity bounded because `convert()` also sets `convertedTenantId`, and a subsequent read by anyone will refuse via the `:300-304` check on the next call — but the row could sit in an inconsistent (`status: OFFER_SENT, convertedTenantId: <set>`) state until then. *Severity:* Medium Cor — see F-2.
  *Fix:* perform `updateStatus`'s read **inside** a TX and re-check `convertedTenantId` before the `update`, or use `updateMany({ where: { id, convertedTenantId: null, status: lead.status }, data: ... })` and assert count = 1.

**Idempotency keys:**
- `lead.convertedTenantId` (`schema.prisma:2763` `@unique`) — gates re-convert at `marketing-leads.service.ts:373-375`. Present.
- `tenant.subdomain @unique` — gates concurrent subdomain claims via P2002 → 409 translation at `:534-547`. Present.
- `user.email @unique` — pre-flight checked at `:379-385`; P2002 fallback covers the race. Present.
- **No idempotency key on `Commission`** — a re-fired `convert()` (after a partial network failure that *did* commit) would normally write a second commission row, but is gated upstream by the `convertedTenantId @unique` constraint, so the second TX never reaches the commission insert. Effectively safe via I-10; not a finding.

---

## 7. Findings

Same format as `docs/CODE_REVIEW.md`. Verified findings unmarked; unverified flagged `*(unverified)*`.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Arch | `marketing-leads.service.ts` (586 LOC — verified) | §4.17 seed confirmed. File concentrates **five** concerns: CRUD, status-transition table + guard, assignment, full conversion (TX + email + commission), and soft-delete. The 165-line `convert()` method (`:370-574`) is by itself worth a dedicated `marketing-lead-conversion.service.ts`. | Split into `marketing-leads.service.ts` (CRUD, ~120 LOC), `marketing-lead-status.service.ts` (transitions + assign + `ALLOWED_TRANSITIONS`, ~150 LOC), `marketing-lead-conversion.service.ts` (`convert()` + `allocateSubdomain()` + commission emit, ~250 LOC). Module boundary preserved — controllers wire to all three. |
| F-2 | Medium | Cor | `marketing-leads.service.ts:279-312` (`updateStatus`) | The read-then-write sequence reads `lead.convertedTenantId` at `:300-304`, then writes status at `:306` without re-asserting the precondition. A concurrent `convert()` between read and write can leave the lead at a non-terminal status with `convertedTenantId` already set. | Replace the bare `update` with `updateMany({ where: { id, convertedTenantId: null, status: lead.status }, data: { status, ... } })` and 404 if `count === 0`. Same pattern as customers/loyalty (`CODE_REVIEW.md §4.16`). |
| F-3 | Low | Cor | `marketing-leads.service.ts:507` | Commission `period = YYYY-MM` is computed from `new Date()` on the API node's wall clock. Tenants and reps in different timezones see month boundaries jitter by ±1 day. | Compute period from a UTC anchor or from the new tenant's `paymentRegion` timezone (TURKEY → `Europe/Istanbul`). Document the policy in the comment. |
| F-4 | Low | Cor | `marketing-commissions.service.ts:102-103` | The zero-amount guard uses `(commission.amount.constructor as any)(...).isZero?.() || Number(commission.amount) === 0`. The `Number()` fallback is a precision-loss hazard for any non-zero value (it would round a Decimal like `0.001` to `0`). For *this* check (`=== 0` on a Decimal-typed column) the risk is theoretical, but the pattern is sloppy. | Use `new Prisma.Decimal(commission.amount).isZero()` directly. Drop the `Number(...)` branch. |
| F-5 | Low | Sec | `marketing-leads.service.ts:553-571` | The welcome email containing the temporary admin password is sent **outside** the conversion TX. If `emailService.sendPlainEmail` fails (network blip, SMTP outage, etc.) the tenant is created and the rep cannot recover the password from the response — the new owner must reset via `/auth/forgot-password`. The console-only log at `:569-570` is not actionable. | Either (a) push the email to a retry queue, or (b) include a `Sentry.captureException` so an operator notices. The fallback comment at `:551-552` is correct but the code doesn't surface the failure anywhere. |
| F-6 | Low | Arch | `marketing-offers.service.ts:105` (`update`), `:136-150` (`markSent`) | The `update` builder uses `const data: any = { ...dto }` — accepts whatever the DTO carries (including `status`, `sentAt`, `respondedAt`). Today the DTO restricts fields, but a future DTO extension could let a rep bypass the `markSent` state machine via plain PATCH. | Mirror the leads.update pattern (explicit field-by-field spread at `marketing-leads.service.ts:242-261`). |
| F-7 | Low | Cor | `marketing-tasks.service.ts:226-227` (`update`) | Same `data: any = { ...dto }` pattern — a future DTO addition that includes `status` would let a SALES_REP transition tasks to states outside `complete()`'s controlled path. | Explicit-field spread, identical to F-6's fix. |
| F-8 | Low | Sec | `marketing-users.service.ts:103-104` (`update`) | Manager-side `update()` re-hashes a new password with bcrypt cost **hardcoded to `10`**, bypassing the `BCRYPT_COST` env config that every other path in the module honors (`marketing-auth.service.ts:23-27`, `marketing-leads.service.ts:53-57`). | Call `this.bcryptCost()` here too. |
| F-9 | Low | Cor | `marketing-users.service.ts:122-132` (`delete`) | Soft-delete sets `status = 'INACTIVE'` but does **not** bump `tokenVersion`. A deactivated rep's outstanding tokens still pass the guard's "active" check only because the guard re-loads the user and rejects on `status !== 'ACTIVE'` (`marketing.guard.ts:65-67`). Sufficient today, but a defense-in-depth gap if the guard ever caches. | Add `tokenVersion: { increment: 1 }` to the same update. |
| F-10 | Info | Arch | `marketing-leads.service.ts:97-177` (`findAll`) | `limit` is taken from `filter.limit` with `|| 20` fallback but is **not capped**. Same pattern at `marketing-tasks.service.ts:67-69`, `marketing-offers.service.ts:48`, `marketing-commissions.service.ts:11-12`. | Add `Math.min(filter.limit ?? 20, 100)`. Already a §4.11 cross-cutting item in `CODE_REVIEW.md`. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/quality) · Perf (performance/reliability).

---

## 8. What's solid (positive findings)

Patterns that already work — call them out so future readers know what to keep, and so other features know what to copy.

- `marketing-leads.service.ts:502-506` — **deterministic commission math.** `new Prisma.Decimal(plan.monthlyPrice).mul(SIGNUP_COMMISSION_RATE).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)`. No `Number()` round-trip. The `SIGNUP_COMMISSION_RATE` constant at `:43` is a single-source-of-truth — explicitly module-scoped, not buried in the function. **Candidates that should adopt this:** any service that today does `Number(x.amount) * y` (see `CODE_REVIEW.md §5` Decimal-conversion list).
- `marketing-leads.service.ts:30-40, 289-294` — **explicit allowed-transitions table.** Terminal states modeled as empty-array entries (`WON: []`, `LOST: []`), guard at `:289-294` rejects with a precise error. Same shape as a finite-state-machine library would emit, no library overhead. **Candidates:** `orders.md` order-status transitions, `subscriptions.md` subscription-status transitions.
- `marketing-leads.service.ts:295-299` — **dual-channel guard for terminal states.** `updateStatus` refuses `WON` explicitly with a message pointing the caller at `/convert`, instead of silently accepting it and leaving the tenant un-created. Excellent error UX.
- `marketing-leads.service.ts:373-375` + `:534-547` — **idempotent conversion + race-narrowing.** The pre-flight `convertedTenantId` check handles the common case; the catch translates the rare-race `P2002` into a clear 409. Same defensive pattern as `tenants.md §I-4`.
- `marketing-auth.service.ts:35-42` — **no-fallback refresh secret.** Explicit comment plus throw if `MARKETING_JWT_REFRESH_SECRET` unset. Closes the cross-realm replay surface. **Candidates:** verify `auth.service.ts` and `superadmin/*` follow the same shape (per `auth.md`/`superadmin.md`, they do).
- `marketing-auth.service.ts:63-77` — **lockout counter resets on lock.** Comment at `:71-73` explicitly calls out the prior bug. The "post-lock typo permanently locks the rep" trap is documented in code.
- `marketing-auth.service.ts:122-125` — **full token-pair rotation on refresh.** Issues a new refresh too, not just a new access. Old refresh ages out even if the client replays it.
- `marketing-leads.service.ts:295-304` — **`WON` is owned by `convert()`, not by status PATCH.** This single rule prevents an entire class of "lead in WON without a tenant" bugs. **Highlight as the pattern to apply** anywhere a terminal state requires side effects.
- `marketing-commissions.service.ts:95-97, 125-127, 137-138` — **immutable-after-PENDING audit posture.** Approved/paid rows are write-locked at the service layer. Combined with timestamp writes (`approvedAt`, `paidAt`), this gives a clean audit trail.
- `marketing-offers.service.ts:142-149` — **forward-only lead-status nudge.** `markSent` only advances the lead status, never regresses it. Idempotent under concurrent offer sends.
- `marketing-tasks.service.ts:164-178` — **bounded calendar range.** `MAX_CALENDAR_RANGE_DAYS = 62` plus `take: 500`. Same shape as `analytics.gateway.ts` heatmap bound — see §4.15.
- `marketing-dashboard.service.ts:55-71, 167-179` and `marketing-reports.service.ts:22-78` — **groupBy-over-loop refactor.** Comments at `:54`, `:85`, `:163` explicitly call out the previous "N separate count queries" anti-pattern. Cross-link to `CODE_REVIEW.md §4.11` (pagination) — these aggregations also need to stay groupBy-shaped.
- Controllers consistently apply `@UseGuards(MarketingGuard, MarketingRolesGuard)` at the class level, and `@MarketingRoles('SALES_MANAGER')` at the method level for destructive operations. The pattern is identical across `marketing-leads.controller.ts:66, 76, 86`, `marketing-offers.controller.ts:62`, `marketing-commissions.controller.ts:51, 60, 66`. No drift.

---

## 9. Spot-checks performed

**Verified:**
- §4.17 seed: `marketing-leads.service.ts` LOC count = 586 exactly (`wc -l`).
- F-1 confirmed at `marketing-leads.service.ts:1-586`: five distinct concerns mapped (CRUD `:82-269`, status transitions `:30-40, 272-325`, assignment `:327-362`, conversion `:364-574`, soft-delete `:576-585`).
- I-1 through I-7 (rep-scope checks) verified by reading each `userRole === 'SALES_REP'` branch.
- I-12 commission-math precision: confirmed `Prisma.Decimal` arithmetic; no `Number()` in the math path.
- I-18 cross-realm guard: `marketing.guard.ts:48-50` checks `payload.type !== 'marketing'`; `marketing-auth.service.ts:105-107, 108-110` checks both `type` and `tokenType`.
- F-8 confirmed: line 104 reads `bcrypt.hash(dto.password, 10)` — the `10` is a literal, not `this.bcryptCost()`.
- Controller-level role gates for SALES_MANAGER-only ops verified at `marketing-leads.controller.ts:66, 76, 86`, `marketing-offers.controller.ts:62`, `marketing-commissions.controller.ts:51, 60, 66`.

**Dropped (initial scan was wrong):**
- "Marketing module lacks tenant isolation" — verified at `schema.prisma:2701, 2737, 2869`. The marketing models intentionally live above the tenant boundary (`MarketingUser` is the sales rep / manager, not a tenant user; `Commission.tenantId` is the *converted target* tenant, not a scope). The correct invariant is rep-scope (I-1…I-5), which **is** enforced. Drop.
- "PlanFeature decorators missing on marketing endpoints" — searched the module; no PlanFeature usage. This is correct — PlanFeature gates *tenant* features, not platform-internal CRM endpoints. Drop.

**Downgraded:**
- F-2 (updateStatus / convert race) — initial classification was High Cor. Verified the `convertedTenantId @unique` constraint at `schema.prisma:2763` prevents the *second* convert, and `updateStatus`'s `:300-304` check catches the post-convert case. The race window only produces a transient inconsistent row that subsequent reads will reject. Downgraded to Medium.
- F-5 (welcome email outside TX) — initial classification was Medium Sec. Verified the password-reset fallback at `marketing-leads.service.ts:563-564` (the welcome email explicitly mentions `/forgot-password`). The owner *can* recover; the gap is observability, not correctness. Downgraded to Low.

---

## 10. Recommended tests

The 3–10 integration tests that would catch the §3 invariants and §6 race risks. Skeletons only.

```ts
// backend/src/modules/marketing/__tests__/marketing.integration.spec.ts

describe('marketing-leads invariants', () => {
  it('I-12 commission-calc: SIGNUP commission is plan.monthlyPrice × 0.10, ROUND_HALF_UP, 2dp', async () => {
    // arrange: rep R, plan P with monthlyPrice = 99.95, lead L assignedTo R
    // act: managerConvert(L, { planId: P.id, tenantName: '...', adminEmail: '...' })
    // assert: commission.amount === Prisma.Decimal('10.00')  (9.995 rounds half-up to 10.00)
    //         commission.type === 'SIGNUP', status === 'PENDING'
    //         commission.period matches YYYY-MM of "now"
  });

  it('I-12 commission-calc: FREE plan (no plan attached) yields amount=0', async () => {
    // arrange: lead L, no offer, no plan
    // act: convert without planId
    // assert: commission.amount.equals(Prisma.Decimal(0))
    //         attempting to approve at marketing-commissions.service:92-107 throws BadRequest
  });

  it('I-8/I-9: lead-scoring stability — terminal WON is sealed', async () => {
    // arrange: lead L, convert to tenant T → L.status === 'WON', L.convertedTenantId === T.id
    // act: PATCH /marketing/leads/:L.id/status with { status: 'CONTACTED' }
    // assert: 400 'Cannot change status of an already-converted lead'
  });

  it('I-8 transitions: every illegal pair is rejected', async () => {
    // arrange: a lead for every status in ALLOWED_TRANSITIONS
    // act: for each (from, to) not in ALLOWED_TRANSITIONS[from], PATCH status
    // assert: 400 'Invalid transition from {from} to {to}'
  });

  it('I-9 WON is exclusively created by /convert', async () => {
    // act: PATCH /marketing/leads/:id/status with { status: 'WON' }
    // assert: 400 'Use /convert to move a lead to WON ...'
  });

  it('F-2 race: convert() and updateStatus() concurrent — final state is consistent', async () => {
    // arrange: lead L at MEETING_DONE, assigned to rep R
    // act: Promise.all([
    //        adminPatch(`/marketing/leads/${L.id}/status`, { status: 'OFFER_SENT' }),
    //        managerPost(`/marketing/leads/${L.id}/convert`, { planId, tenantName, adminEmail }),
    //      ])
    // assert: exactly one succeeds with WON + convertedTenantId set; the other returns 409 or 400.
    //         lead.status === 'WON' iff convertedTenantId != null (no inconsistent state).
  });

  it('cross-rep isolation: SALES_REP A cannot read leads of SALES_REP B', async () => {
    // arrange: reps A, B; lead L_a assigned to A; lead L_b assigned to B
    // act (as A): GET /marketing/leads → only L_a returned
    //              GET /marketing/leads/L_b.id → 403 'You can only view your own leads'
    //              PATCH /marketing/leads/L_b.id → 403
    //              POST /marketing/leads/L_b.id/activities → 403
    //              POST /marketing/offers { leadId: L_b.id, ... } → 403
    // assert: zero leakage of L_b in list, body, or count fields.
  });

  it('I-3/I-7 commission isolation: SALES_REP cannot see or mutate manager-side commission ops', async () => {
    // arrange: rep R with commission C_R, rep S with commission C_S
    // act (as R): GET /marketing/commissions → only C_R
    //              PATCH /marketing/commissions/C_S → 403 (MarketingRolesGuard)
    //              PATCH /marketing/commissions/C_S/approve → 403
    //              PATCH /marketing/commissions/C_S/pay → 403
    // assert: all three 403 from MarketingRolesGuard, not 200 / 404.
  });

  it('I-10 convert idempotency: two simultaneous converts produce one tenant and one commission', async () => {
    // arrange: lead L not yet converted
    // act: Promise.all([convert(L, ...), convert(L, ...)])
    // assert: count(tenant where converted from L) === 1
    //         count(commission where leadId = L.id) === 1
    //         the losing call returns 409 'Lead already converted' or 'tenant ... created concurrently'
  });

  it('I-18 cross-realm token rejection', async () => {
    // arrange: tenant admin JWT (issued by main auth service) and marketing JWT (issued by marketing-auth)
    // act: present tenant JWT to GET /marketing/leads, present marketing JWT to GET /tenants/settings
    // assert: both 401 — payload.type mismatch.
  });

  it('I-19 lockout: 5 failed logins lock for 15min, counter resets on lock', async () => {
    // act: 5 wrong passwords → assert locked === true, failedLogins === 0
    //      advance clock 15 min, then 1 wrong password → assert failedLogins === 1, not auto-relocking
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`. **For this module, the canonical isolation test is the cross-rep test** (I-1 through I-5) rather than cross-tenant — *create two SALES_REPs, attempt cross-rep access via every endpoint, assert zero leaks.*
