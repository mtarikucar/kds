# `subscriptions` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/subscriptions/...`, `backend/prisma/schema.prisma` (Subscription, SubscriptionPayment, SubscriptionPlan, Invoice, InvoiceCounter, Tenant)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §2 (M9), §3.3 (scheduler pattern), §4.5 (per-module table)

---

## 1. Health & summary

🟡 yellow.

This module owns: (a) the lifecycle of a tenant's Subscription row (TRIALING → ACTIVE → PAST_DUE → EXPIRED / CANCELLED), (b) the period boundary for plan-feature/limit enforcement, (c) invoice generation with monotonic numbering, (d) the contact-driven renewal flow (the codebase does not currently have in-band payment capture — Stripe/PayTR were removed; renewals are confirmed off-platform via WhatsApp/Email and recorded by SuperAdmin). The risk concentrates in two places: (1) the renewal scheduler at `subscription-scheduler.service.ts:71-98`, which currently transitions ACTIVE → PAST_DUE on every period boundary (a deliberate "fail closed" design) — there is no idempotency key on the PAST_DUE write itself, but the operation is naturally idempotent because PAST_DUE → PAST_DUE is a no-op state change; the *real* idempotency gap is on the `confirmContactRenewal` path (`subscription.service.ts:656-720`) which writes a `SubscriptionPayment` + `Invoice` per call, and (2) the `dueDate: new Date()` default in `billing.service.ts:73` which violates the invariant `dueDate ≥ periodStart` when invoices are pre-dated. The state machine itself is sound — concurrent activations are blocked by a verified partial unique index (`migrations/20260420180000_tenant_fks_and_partial_uniques/migration.sql`). The advisory-lock cron pattern at `subscription-scheduler.service.ts:29-43` is the **canonical multi-instance scheduler safety pattern** referenced elsewhere in the repo.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/subscriptions/services/subscription.service.ts` (888 LOC) — lifecycle, plan change, renewal, trial expiry, effective features
- `backend/src/modules/subscriptions/services/billing.service.ts` (214 LOC) — invoice generation, proration, period math
- `backend/src/modules/subscriptions/services/subscription-scheduler.service.ts` (199 LOC) — 6 cron jobs, advisory-lock pattern
- `backend/src/modules/subscriptions/guards/plan-feature.guard.ts` (174 LOC) — feature/limit/plan gate
- `backend/src/modules/subscriptions/guards/subscription.guard.ts` (53 LOC) — `RequiresActiveSubscription` gate
- `backend/src/modules/subscriptions/decorators/*.ts` (4 files, ~40 LOC) — metadata decorators
- `backend/src/modules/subscriptions/controllers/subscription.controller.ts` (159 LOC) — tenant-scoped endpoints
- `backend/src/modules/subscriptions/controllers/contact.controller.ts` (219 LOC) — WhatsApp / email handoff
- `backend/prisma/schema.prisma:683-890` — `SubscriptionPlan`, `Subscription`, `SubscriptionPayment`, `Invoice`, `InvoiceCounter`
- `backend/prisma/migrations/20260420180000_tenant_fks_and_partial_uniques/migration.sql` — partial unique on `(tenantId)` WHERE status IN (ACTIVE, TRIALING, PAST_DUE)
- `backend/src/common/constants/subscription.enum.ts` — status, billing cycle, plan-type enums

**Skimmed only:**
- `services/notification.service.ts` (444 LOC) — email templates only, no business invariants
- `services/contact.service.ts` (99 LOC) — link generation, no state
- `services/invoice-pdf.service.ts` (225 LOC) — render only; the `Number(invoice.tax)` and `Number(v)` usage at lines 67 and 157 is for display formatting only
- `controllers/invoice.controller.ts` (87 LOC) — pass-through to BillingService
- `dto/*.ts` — class-validator DTOs, no logic

**Skipped:**
- `templates/emails/*.hbs` — out of risk surface
- Frontend subscription page — covered separately under `frontend-pages-subscription.md`

---

## 3. Business-logic invariants

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **At most one ACTIVE/TRIALING/PAST_DUE subscription per tenant.** | DB partial unique `subscriptions_tenantId_active_key` (migration `20260420180000_tenant_fks_and_partial_uniques/migration.sql`); P2002 catch in `subscription.service.ts:163-170` | ❌ none | duplicate subscriptions, double-billing, plan-feature ambiguity |
| I-2 | **Each (subscriptionId, periodStart) maps to at most one renewal write.** | **NOT enforced** — see M9 in §7. `confirmContactRenewal` (`subscription.service.ts:673-720`) only deduplicates on `externalReference`; if the caller omits it (or supplies a fresh one on retry), a new `SubscriptionPayment` + `Invoice` row is created on each call | ❌ none | duplicate invoices, double-counted revenue, audit drift |
| I-3 | **Renewal is idempotent on retry given the same `externalReference`.** | `subscription.service.ts:674-684` (early-return on duplicate); `applyUpgrade` mirrors at `subscription.service.ts:326-336`. **Conditional on caller passing the key** — controllers do not (see F-2 in §7) | ❌ none | same as I-2 |
| I-4 | **Cron runs at most once per tick across instances.** | `subscription-scheduler.service.ts:29-43` `pg_try_advisory_lock` with deterministic lock id per job name | ❌ none | duplicate renewals, double trial expiry, double cancellation emails |
| I-5 | **Plan-feature gates honored per tenant.currentPlan, with `featureOverrides` taking precedence.** | `plan-feature.guard.ts:97-111` and `subscription.service.ts:817-844` (`getEffectiveFeatures`) | ❌ none | unauthorized feature use, revenue leak |
| I-6 | **Usage-limit gates re-check live counts.** | `plan-feature.guard.ts:124-173`; downgrade pre-check `subscription.service.ts:268-291` and re-check at apply time `:415` | ❌ none | downgrade to a too-small plan with over-capacity tenant |
| I-7 | **Currency consistent across subscription + payments + invoices.** | `subscription.service.ts:200-204` rejects cross-currency plan change; `:317-319` repeats for `applyUpgrade`. `SubscriptionPayment.currency` is set from `subscription.currency` at `:690`. `Invoice.currency` is forwarded by `billing.service.ts:70` | ❌ none | mixed-currency totals, accounting drift |
| I-8 | **Tenant isolation on every subscription query.** | `subscription.service.ts:55-73` (`getSubscriptionById` rejects with NotFound on tenant mismatch); `billing.service.ts:122,148,162` (every list/find scopes via `subscription: { tenantId }`); controller threads `req.user.tenantId` at `subscription.controller.ts:46,52,72,...` | ❌ none | cross-tenant IDOR (invoice numbers leak, plan info leak) |
| I-9 | **`dueDate ≥ periodStart` on every invoice.** | **NOT enforced.** `billing.service.ts:73` hard-codes `dueDate: new Date()`; if `createInvoice` is called with a `periodStart` in the future (e.g. pre-billing the next period), `dueDate` precedes it. See F-3 in §7 | ❌ none | invoice past-due on issue, incorrect collections timing |
| I-10 | **Trial may only be granted once per tenant.** | `subscription.service.ts:104-107` (`!tenant.trialUsed`); `:155` sets `trialUsed=true` inside the same transaction as the subscription create | ❌ none | repeated free trials, revenue leak |
| I-11 | **A FREE plan never grants a trial.** | `subscription.service.ts:107` (`plan.name !== SubscriptionPlanType.FREE`) | ❌ none | nonsensical state |
| I-12 | **Cross-currency plan changes are refused.** | `subscription.service.ts:200-204` and `:317-319` | ❌ none | garbage proration math |
| I-13 | **Invoice numbers are monotonic per YYYYMM scope and collision-free under concurrency.** | `billing.service.ts:22-37` — `invoiceCounter.upsert` with `{increment: 1}` inside the caller's transaction; suffix adds 6 hex chars of entropy | ❌ none | duplicate invoice numbers, audit drift |
| I-14 | **PAST_DUE → EXPIRED only after 7 days past `currentPeriodEnd`.** | `subscription-scheduler.service.ts:120-137` (`past-due-subscriptions` cron) | ❌ none | premature loss of access |
| I-15 | **Scheduled downgrade re-validates usage at apply time, not just at schedule time.** | `subscription.service.ts:415` calls `assertDowngradeAllowed` inside `applyScheduledDowngrade` after the scheduler picks the row up | ❌ none | downgrade lands with over-capacity tenant |
| I-16 | **Only `autoRenew` and `cancelAtPeriodEnd` are mutable via the `updateSubscription` endpoint.** | `subscription.service.ts:594-605` — explicit field whitelist; everything else (planId, status, amount, currency) blocked from mass-assignment | ❌ none | direct manipulation of financial state via PATCH |
| I-17 | **`reactivateSubscription` only valid when `cancelAtPeriodEnd=true`.** | `subscription.service.ts:568-572` | ❌ none | re-enable a fully cancelled subscription |
| I-18 | **A tenant on the FREE plan does not require an active SubscriptionRow to use the app.** | `plan-feature.guard.ts:79-83` — `if (!activeSubscription && currentPlan.name !== 'FREE') throw` | ❌ none | FREE-tier users locked out |
| I-19 | **Currently-trialing subscription with expired `trialEnd` lands in PAST_DUE, not CANCELLED.** | `subscription.service.ts:872-877` (`expireTrials`) | ❌ none | unintended hard cancellation |

---

## 4. State machine

**Status enum:** `backend/src/common/constants/subscription.enum.ts:8-14` — `ACTIVE`, `CANCELLED`, `EXPIRED`, `PAST_DUE`, `TRIALING`. The Prisma column at `schema.prisma:747` defaults to `"ACTIVE"`.

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `(none) → TRIALING` | `createSubscription` with `canUseTrial=true` | `subscription.service.ts:104-119`; partial unique `subscriptions_tenantId_active_key` makes concurrent create impossible | Yes — second concurrent call hits P2002 (`:163-170`) | tenant.trialUsed=true, tenant.currentPlanId set, tenant.trialStart/trialEnd set |
| `(none) → ACTIVE` | `createSubscription` without trial | `subscription.service.ts:129-149` | Yes (P2002) | tenant.currentPlanId set |
| `TRIALING → PAST_DUE` | `expireTrials` cron at midnight | `subscription.service.ts:861-877` (`trialEnd <= now`); cron `subscription-scheduler.service.ts:56-69` | **Effectively yes** — second run finds no rows because previous already flipped to PAST_DUE; per-row try/catch isolates failures | logged only (no notification today) |
| `ACTIVE → PAST_DUE` | `renewSubscription` called by renewal cron when `currentPeriodEnd ∈ [now, now+1day]` | `subscription.service.ts:615-650`; cron `subscription-scheduler.service.ts:71-98` | **Effectively yes** — status is set unconditionally to PAST_DUE; on re-run the row no longer matches the cron's `status=ACTIVE` filter (`:80`). But: the email notification at `:634-643` is **not** idempotent — re-running the same row would resend "payment failed" emails. This window is closed by the cron's filter, not by the function. | email "payment failed" to admin (best-effort, swallowed on failure) |
| `PAST_DUE → ACTIVE` | `confirmContactRenewal` (SuperAdmin action after off-platform payment) | `subscription.service.ts:656-720` | **Only if caller passes `externalReference`** — see I-2/I-3, F-1, M9 | `SubscriptionPayment` row created, `Invoice` row created, `currentPeriodStart`/`End` rolled forward, `isTrialPeriod=false` |
| `PAST_DUE → EXPIRED` | `past-due-subscriptions` cron 7 days after `currentPeriodEnd` | `subscription-scheduler.service.ts:120-137` | Yes — `updateMany` with `status=PAST_DUE` filter; second run matches 0 rows | `endedAt = now` |
| `ACTIVE → ACTIVE (new period, new plan)` | `applyUpgrade` after off-platform payment | `subscription.service.ts:298-387` | **Yes** — dedup on `externalReference` (`:326-336`); the `subscription.update` is naturally idempotent since the payload is deterministic given a fixed `(planId, billingCycle)` and the `SubscriptionPayment.externalReference` unique fails the second write | tenant.currentPlanId set, `SubscriptionPayment` + `Invoice` rows |
| `ACTIVE → ACTIVE (downgrade scheduled)` | `changePlan` with `newAmount ≤ currentAmount` | `subscription.service.ts:247-265` | Yes — second call rejected by `:193-197` ("already a scheduled plan change") | none until period end |
| `ACTIVE → ACTIVE (downgrade applied)` | `scheduled-downgrades` cron after `currentPeriodEnd` | `subscription.service.ts:404-460`; cron `subscription-scheduler.service.ts:172-198` | Not strictly — but the cron filter (`scheduledDowngradePlanId: not null` + `currentPeriodEnd <= now` + `status=ACTIVE`) only matches rows that haven't been downgraded yet, and the function nulls the scheduled fields, so the second run filters out the row. Race window inside a tick is closed by the advisory lock. | tenant.currentPlanId set, scheduled fields cleared, "plan-change-confirmation" email |
| `ACTIVE → CANCELLED (immediate)` | `cancelSubscription(immediate=true)` | `subscription.service.ts:501-526` | **No** — second call rejected by `:508-510` ("already cancelled"); but if 510 races with a concurrent call the second can still set `cancelledAt`/`endedAt` to a later timestamp. Severity low — same final state, only timestamp jitter. | `endedAt=now`, `autoRenew=false`, "cancelled immediate" email |
| `ACTIVE → ACTIVE (cancelAtPeriodEnd=true)` | `cancelSubscription(immediate=false)` | `subscription.service.ts:521-526` | Effectively yes — re-running flips `cancelAtPeriodEnd` true→true | "will cancel" email |
| `(cancelAtPeriodEnd=true) → CANCELLED` | `pending-cancellations` cron at midnight after `currentPeriodEnd` | `subscription-scheduler.service.ts:100-118` | Yes — `updateMany` with `status: not CANCELLED` filter | `endedAt=now` |
| `(cancelAtPeriodEnd=true) → ACTIVE` | `reactivateSubscription` | `subscription.service.ts:566-582` | Yes — re-running sets the same flags | `cancelAtPeriodEnd=false`, `autoRenew=true`. **`cancelledAt` is intentionally preserved** as audit (`:564-565`) |

**Forbidden transitions** (guarded):
- `CANCELLED → *` — guarded at `subscription.service.ts:508-510` (cancel attempted twice); no explicit guard for re-entering ACTIVE from CANCELLED, but the partial unique `subscriptions_tenantId_active_key` excludes CANCELLED, so a `createSubscription` after cancel **succeeds** (and is treated as a brand-new subscription). This is intentional per design.
- `EXPIRED → *` — same partial unique permits a new subscription after EXPIRED, so this is also "terminal for this row, but tenant may re-subscribe."
- Mass-assignment of `planId`, `status`, `amount`, `currency`, trial flags via `PATCH /:id` — blocked by field whitelist at `subscription.service.ts:594-605`.

**Transitions that should be idempotent but aren't** (see §7):
- `confirmContactRenewal` without `externalReference` — F-1 / M9.
- `cancelSubscription(immediate=true)` second concurrent call — F-7 (low severity).

---

## 5. Money & precision audit

**Decimal entry points** (where `Prisma.Decimal` first appears):
- `schema.prisma:690-691` — `SubscriptionPlan.monthlyPrice`, `yearlyPrice` (`@db.Decimal(10, 2)`)
- `schema.prisma:767` — `Subscription.amount` (`@db.Decimal(10, 2)`)
- `schema.prisma:804` — `SubscriptionPayment.amount`
- `schema.prisma:852-854` — `Invoice.subtotal`, `tax`, `total`

**Decimal-to-Number conversions** (each a precision-loss hazard, in scope):
- `subscription.service.ts:239` — `prorationAmount.toNumber()` — used in **response DTO** to the admin UI for display. Risk: if proration exceeds `Number.MAX_SAFE_INTEGER / 100` cents (≈ 90 trillion units) the UI loses precision. **Not a defect for realistic Decimal(10,2) values**; flag for the day pricing crosses currency-unit thresholds.
- `subscription.service.ts:240` — `new Prisma.Decimal(newAmount).toNumber()` — same display path.
- `subscription.service.ts:638` — `Number(subscription.amount)` — passed to `sendPaymentFailed` notification for email rendering. Display-only, but undocumented; if the email template ever does math on the value it would silently drift.
- `controllers/contact.controller.ts:121, 201` — `Number(plan.monthlyPrice) / Number(plan.yearlyPrice)` — passed to the contact-link response DTO for the UI. Display-only.
- `services/invoice-pdf.service.ts:67, 157` — `Number(v).toFixed(2)` and `Number(invoice.tax) > 0` — PDF render. Display-only; same caveat as above.

`grep -n 'Number(\|parseFloat(\|toNumber()' backend/src/modules/subscriptions/` confirms there are **no** Number conversions on the *write* path. All persistence stays in `Prisma.Decimal`. The proration math at `billing.service.ts:189-202` is exemplary: `Prisma.Decimal.ROUND_HALF_UP` to 2dp, all `mul`/`div`/`sub` on Decimal.

**Rounding policy + tolerance constants:**
- `billing.service.ts:201` — `toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)` on proration. Justified: 2dp matches `@db.Decimal(10, 2)`. No sunset condition needed.
- No tolerance constants — no split-bill, no sum-of-parts reconciliation. Tax is fixed at zero (`billing.service.ts:58`) and the comment at `:55-56` flags that per-region tax must use Decimal.

**Sum-of-parts reconciliation:**
- `Invoice.subtotal + tax === total` — asserted *by construction* at `billing.service.ts:57-59` (`total = subtotal.add(tax)`), so the invariant is "always true at write." There is no DB-level check constraint.
- Σ `SubscriptionPayment.amount` vs Invoice.total — **NOT asserted.** A renewal creates one payment + one invoice with matching amounts at `:686-696` and `:698-707`, but nothing stops a downstream patch from desyncing them. Flag for future tightening (not §7 severity-worthy today because the surface is only SuperAdmin actions).

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**

- `subscription-scheduler.service.ts:29-43` — `pg_try_advisory_lock(djb2(jobName))` wrapping every cron tick. Verified pattern, **canonical for the repo**. Lock id is constant-derived (DJB2 from a fixed job-name string), so two replicas hash identically. Lock is released in `finally`; if the holder crashes, PG releases at session end.
- `subscription.service.ts:128-162` — `$transaction` around `subscription.create` + `tenant.update`. P2002 from the partial unique `subscriptions_tenantId_active_key` rolls the whole TX back, so two concurrent createSubscription calls leave the loser cleanly empty.
- `subscription.service.ts:324-386` — `$transaction` for `applyUpgrade` (subscription update + tenant update + payment row + invoice row). Idempotency key check at `:326-336` is inside the TX.
- `subscription.service.ts:673-720` — `$transaction` for `confirmContactRenewal`. Idempotency key check at `:674-684`.
- `billing.service.ts:28-32` — `invoiceCounter.upsert` with `{increment: 1}`. Inside the caller's TX. The DB serializes the row update on `scope` PK, so two concurrent invoices in the same YYYYMM scope can never collide.

**Race windows still open:**

- **M9 (verified): renewal-write idempotency on `confirmContactRenewal`.**
  *Sketch:* SuperAdmin clicks "confirm payment" twice; or a retry script replays an HTTP request. The first call writes payment+invoice and flips PAST_DUE → ACTIVE. The second call: if no `externalReference` is supplied, `:674` is false, so the dedup short-circuit is skipped; it writes a *second* payment and a *second* invoice for the **same** new period, then flips ACTIVE → ACTIVE with the same new period dates (no-op on subscription, but two payment rows + two invoice rows now exist).
  *Where:* `subscription.service.ts:673-720` (the function); no caller in `controllers/` currently passes `externalReference` — the SuperAdmin call site lives outside this module (`backend/src/modules/superadmin/...` per the referenced contact-based flow) and was not in scope, but the contract — "renewal is idempotent" — requires either the caller to pass a key or the function to derive one.
  *Severity:* High Cor.
  *Fix:* see §7 F-1.

- **M9b (lower severity but symmetric): `renewSubscription` flips ACTIVE → PAST_DUE unconditionally.** Idempotent at the row level (PAST_DUE → PAST_DUE), but the `sendPaymentFailed` email at `:634-643` is not gated — if the renewal cron's lock failed and somehow two replicas processed the same row (impossible with the verified pattern, hypothetical only), the tenant gets two "payment failed" emails. The advisory lock closes this in practice.

- **Cron retry semantics:** all 6 jobs are `@Cron` decorators with no internal retry. If a tick fails mid-batch (e.g. DB connection drop after `:90` for-loop has processed 3 of 10 subscriptions), the remaining 7 are picked up on the next tick because the cron filter (`currentPeriodEnd: { gte: now, lte: tomorrow }`) still matches them. **However** the 3 already-processed ones are now in PAST_DUE, so the next tick filter (`status: ACTIVE`) excludes them — natural idempotency by state advancement. Good design.

- **DJB2 lock-id collision risk** (`subscription-scheduler.service.ts:45-54`): the hash is a 32-bit signed integer (`| 0`). Across the 9 schedulers in the codebase (§3.3 of CODE_REVIEW.md cites 9), a birthday-paradox collision is astronomically unlikely (≈ 9 jobs / 2^32 space), but the scheme has no central registry, so a future engineer adding a 10th job is one careless rename away from a silent collision with another module's lock. Flag — not a defect today, but brittle as the count grows.

- **Subdomain reservation (not in this module)** mentioned for cross-reference: `tenants.service.ts` has a pattern (per CODE_REVIEW.md §4.3) where a reservation row can outlive a rolled-back TX. Subscriptions does not have an analogous pattern — every cross-table write is inside `$transaction`.

**Idempotency keys:**

- **Present** at `subscription.service.ts:326-336` (`applyUpgrade`) and `:674-684` (`confirmContactRenewal`). Key field: `SubscriptionPayment.externalReference` (`schema.prisma:811`, `@unique`).
- **Missing where needed** at the *controller-to-service* boundary: no controller currently surfaces an `externalReference` parameter into `confirmContactRenewal` or `applyUpgrade`. The keys are wired into the service signatures but only callable from SuperAdmin code paths that were not in this scope. The codebase has the *mechanism*; the missing piece is end-to-end propagation. Flag in §7 (F-1).

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 (M9) | High | Cor | `subscription.service.ts:673-720` | `confirmContactRenewal` is idempotent **only** when the caller supplies `externalReference`. The current SuperAdmin endpoint that triggers this (outside this module's scope) is not verified to always pass one; the function does not derive a fallback key. Network retry, double-click, or manual replay → duplicate `SubscriptionPayment` + `Invoice` rows for the same renewal period. | **Add a composite unique** on `SubscriptionPayment(subscriptionId, paidAt::date)` OR a dedicated `(subscriptionId, periodStart)` field; OR derive `externalReference` from `(subscriptionId, periodStart-ISO)` when omitted so the existing `@unique` traps duplicates. Add a NestJS `BadRequestException` on the P2002 path that returns 200 with the prior result (idempotent semantics for clients). Add an integration test (§10 T-2). |
| F-2 | High | Cor | `subscription.service.ts:298-387` (`applyUpgrade`) | Same shape as F-1: idempotency conditional on caller passing `externalReference`. The dup-check at `:326` short-circuits, but a caller that re-invokes without the key will: bump period dates, write a new payment, write a new invoice — and the second TX's `subscription.update` blanks out the "fresh new period" from the first call. | Same fix as F-1; or have the service generate a deterministic key from `(subscriptionId, newPlanId, billingCycle, periodStart)` when caller omits it. |
| F-3 (M-medium) | Medium | Cor | `billing.service.ts:73` | `dueDate: new Date()` hard-codes due-date to issue-time. Violates the natural invariant `dueDate ≥ periodStart` when an invoice is issued for a future period (e.g. trial-end pre-billing). Sales-invoice does the right thing — see CODE_REVIEW.md §4.5 reference to `sales-invoice.service.ts:84-86`. | Replace with `dueDate: periodEnd` (or `periodStart + tenant.defaultPaymentTermDays` once that field exists). Mirror the `sales-invoice.service.ts` pattern. |
| F-4 | Medium | Arch | `subscription-scheduler.service.ts:45-54` | DJB2-based lock ids are deterministic but have no central registry. Brittle as the cron-job count grows beyond ~10. A future rename can silently collide with another module's lock without a compile-time signal. | Replace ad-hoc hashing with a typed `LockId` enum (e.g. `enum AdvisoryLockId { SUBSCRIPTION_RENEWAL = 1001, … }`) in `common/`. All modules import from one file. |
| F-5 | Medium | Sec | `plan-feature.guard.ts:60-67` | `tenant.currentPlan` accessed without null-guard before `:69` and `:79`. `Tenant.currentPlan` is `onDelete: SetNull` (`schema.prisma:87`) — a deleted plan leaves a tenant with `currentPlan=null`. Code throws `ForbiddenException` on `:65-67` if currentPlan is null, but the same field is later used at `:103` (`currentPlan[feature]`) which would NPE if `currentPlan` were truthy but a feature key absent. **Note:** the explicit `if (!tenant || !tenant.currentPlan)` at `:65` is actually present — flag retained at Medium for the cross-reference with `tenants.service.ts:91-149` (T5 in CODE_REVIEW.md) which has the same upstream null-plan issue and is fixed there but cross-checked here. *(re-verify — see §9)* | Tighten to `if (!tenant || !tenant.currentPlan) { throw ... }`. Already present at `:65` — no change required after re-verify. |
| F-6 | Medium | Cor | `subscription.service.ts:872-877` (`expireTrials`) | When a trial expires, the subscription flips to PAST_DUE but **no admin notification is sent**. The cron at `subscription-scheduler.service.ts:139-170` (`trial-reminders`) has a placeholder log only (line 158-162: `// Placeholder — the notification service does not yet have a dedicated trial-ending-soon email template.`). Tenants whose trial expires today get no email, no in-app prompt, no warning. | Wire up `notificationService.sendTrialEnding` (likely needs to be added) and `sendTrialExpired`. Both templates live in `templates/emails/` — `trial-ending.hbs` exists; add `trial-expired.hbs`. |
| F-7 | Low | Cor | `subscription.service.ts:501-526` (`cancelSubscription`) | Two concurrent `cancel(immediate=true)` calls both pass the `:508-510` guard if they read the row before either writes. Both succeed; final `endedAt`/`cancelledAt` is the later writer's. Same final state — only timestamp jitter. | `updateMany` with `where: { id, status: { not: 'CANCELLED' } }` and reject if `count === 0`. Mirrors the pending-cancellation pattern. |
| F-8 | Low | Perf | `subscription.service.ts:44, 62` | `getCurrentSubscription` and `getSubscriptionById` always include up to 50 invoices + 5 (or all) payments. For tenants with long histories this is wasteful on every "current subscription" poll the frontend does. | Lazy-load: split into `getCurrentSubscription()` (no children) and `getCurrentSubscriptionDetailed()` (with children, only called from the settings page). |
| F-9 | Low | Arch | `subscription.service.ts:638` | `Number(subscription.amount)` passed to `sendPaymentFailed`. Display-only today, but undocumented — a future change that does math on the email-side would silently lose precision. | Pass `subscription.amount.toFixed(2)` (Decimal method) and accept a `string` in the notification signature, or pass the raw Decimal and format on the email-render side. |
| F-10 | Low | Arch | `subscription.service.ts:121-122` | `dto.billingCycle === BillingCycle.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice` repeated 6+ times across the service (also `:212`, `:322`, `:419-420`, contact controller `:121, 201`). | Extract `pickAmount(plan, cycle): Prisma.Decimal` helper. |
| F-11 | Info | Cor | `subscription.service.ts:206` | `dto.billingCycle || subscription.billingCycle` allows changing billing cycle silently during a plan change (DTO field is documented as optional). No defect — but worth a comment that mid-period billing-cycle switches re-run proration as if it were a plan-amount change. | Doc comment only. |
| F-12 | Info | Sec | `controllers/subscription.controller.ts:37-41` (`@Public() Get('plans')`) | The public plans endpoint exposes all `SubscriptionPlan` fields including discount metadata. No findings — this is intentional for the landing page. | n/a |

---

## 8. What's solid (positive findings)

- **`subscription-scheduler.service.ts:29-43` — `pg_try_advisory_lock` wrapper.** This is the **canonical multi-instance scheduler pattern** for the repo. The `withJobLock(jobName, run)` helper is concise, generic, and the `finally` release is correct. Other modules with cron jobs (z-reports, stock-alerts, token-refresh, order-polling) follow the same shape and should continue to. The one place this pattern is broken — `delivery-platforms/schedulers/order-polling.scheduler.ts` adds a redundant local `isRunning` flag (CODE_REVIEW.md §4.8) — should be migrated *to* this pattern.

- **`schema.prisma` partial unique index `subscriptions_tenantId_active_key`** (migration `20260420180000_tenant_fks_and_partial_uniques/migration.sql`). The DB enforces "one active-ish subscription per tenant" with a `WHERE status IN ('ACTIVE','TRIALING','PAST_DUE')` predicate, which is exactly the right scope (CANCELLED and EXPIRED subscriptions can coexist with a new active one — allowing re-subscribe). The application-side P2002 catch at `subscription.service.ts:163-170` translates it to a user-facing BadRequest. **Pattern worth replicating** for any other "one-of-X-per-tenant" invariant.

- **`billing.service.ts:22-37` — InvoiceCounter atomic upsert + entropy suffix.** Solves the M3-class race that the `accounting` module suffers from (CODE_REVIEW.md §4.7). Two concurrent invoice writes serialize on the `(scope)` PK update; the 6-hex suffix also makes invoice-number enumeration ("guess INV-202604-0001") impractical. The accounting module should adopt this exact pattern.

- **`billing.service.ts:189-202` — Decimal-first proration.** Every operand is constructed via `new Prisma.Decimal(...)`, the ratio is computed via `Decimal.div`, and the result is `toDecimalPlaces(2, ROUND_HALF_UP)`. No JS `Number` slips in. Reference implementation for any other proration / discount math.

- **`subscription.service.ts:55-73` — `getSubscriptionById` tenant assertion.** A single helper that every controller path runs through. Both "subscription not found" and "subscription belongs to another tenant" return the same `NotFoundException` message, which avoids the IDOR-leaks-existence-via-error-code anti-pattern.

- **Field whitelisting on `updateSubscription`** (`subscription.service.ts:594-605`). Only `autoRenew` and `cancelAtPeriodEnd` are mutable via PATCH. Mass-assignment of `planId`/`status`/`amount`/`currency`/trial flags is structurally prevented. This is the safest possible shape — other "update" endpoints in the repo should follow.

- **Plan-feature override precedence** (`plan-feature.guard.ts:97-111` and `subscription.service.ts:817-844`). Tenant-level `featureOverrides` JSON column lets SuperAdmin grant individual tenants features outside their plan tier without forking the plan catalog. Override consistently takes precedence over plan default; the helper returns a flat `{ features, limits }` shape that's easy to test.

- **State-machine soundness noted in CODE_REVIEW.md §4.5** is confirmed by reading: trial → ACTIVE → PAST_DUE → EXPIRED is a one-way river; CANCELLED is terminal-per-row but tenants can re-subscribe; `cancelAtPeriodEnd` is a separate axis that doesn't conflict with status.

---

## 9. Spot-checks performed

**Verified:**
- **M9 (F-1) confirmed at `subscription.service.ts:673-720`.** `:674` reads `if (externalReference) {...}` — the dedup is conditional on the caller passing the key. There is no schema-level guard (`SubscriptionPayment` has `externalReference @unique` at `schema.prisma:811`, but that's only enforced when the key is present and non-null).
- **`pg_try_advisory_lock` pattern verified at `subscription-scheduler.service.ts:29-43`.** Lock id is constant-derived (`jobLockId(jobName)`), unlock is in `finally`, and the lock id passes through `$queryRawUnsafe` only after being computed by `djb2()` from a constant string — so the "Unsafe" call is safe (no user input).
- **Partial unique index verified at `migrations/20260420180000_tenant_fks_and_partial_uniques/migration.sql`** — `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_tenantId_active_key ON subscriptions(tenantId) WHERE status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')`. Matches `SubscriptionStatus` enum minus CANCELLED and EXPIRED.
- **F-3 (M-medium) confirmed at `billing.service.ts:73`** — `dueDate: new Date()` is literal.
- **No SubscriptionRenewal model exists** — the seed plan in CODE_REVIEW.md §2 references "renewal write," which in this codebase materializes as `SubscriptionPayment` + `Invoice` rows. The invariant I-2 / I-3 is thus *about those two tables*, not about a hypothetical `SubscriptionRenewal` model.
- **F-12 (Info) — `@Public() Get('plans')` verified at `subscription.controller.ts:37-41`.** Intentional.
- **Money paths: zero `Number()` on write paths** — confirmed via `grep -n 'Number(\|parseFloat(\|toNumber()' backend/src/modules/subscriptions/`. The five hits (subscription.service.ts:239, :240, :638; contact.controller.ts:121, :201; invoice-pdf.service.ts:67, :157) are all display-only.

**Downgraded:**
- **F-5 (plan-feature.guard null-guard)** — originally suspected the `currentPlan` access at `:103` could NPE. Re-verified at `:65-67`: the guard correctly throws `ForbiddenException` if `!tenant || !tenant.currentPlan` before any feature lookup. The `:103` access is gated. **Severity dropped from High → Medium (defense-in-depth note only)**. The cross-reference to T5 in CODE_REVIEW.md (subdomain-change flow in `tenants.service.ts`) is unchanged — that is a separate site.

**Dropped:**
- *(none — every initial hypothesis in CODE_REVIEW.md §4.5 held under spot-check.)*

**Not verified (carry-forward, marked unverified in CODE_REVIEW.md):**
- The *caller* of `confirmContactRenewal` and `applyUpgrade` lives in `superadmin/` and was not re-read in this round. F-1 / F-2 assume the worst case (caller may not pass `externalReference`). Confirm at the SuperAdmin call site before remediation; if the caller already always passes a key, F-1 / F-2 can be reduced to "add a schema-level safety net" rather than a fix.

---

## 10. Recommended tests

```ts
// backend/src/modules/subscriptions/__tests__/subscriptions.integration.spec.ts
describe('subscriptions invariants', () => {
  it('I-1: two concurrent createSubscription calls for the same tenant → exactly one ACTIVE/TRIALING row', async () => {
    // arrange: tenant T, plan P (paid)
    // act: Promise.all([create(T, P), create(T, P)])
    //      expect one to resolve, the other to throw BadRequest (P2002 → "already has an active subscription")
    // assert: prisma.subscription.count({ where: { tenantId: T, status: { in: ['ACTIVE','TRIALING'] } } }) === 1
  });

  it('I-2 + F-1: two concurrent confirmContactRenewal without externalReference create exactly one SubscriptionPayment', async () => {
    // arrange: subscription in PAST_DUE
    // act: Promise.all([confirmContactRenewal(id), confirmContactRenewal(id)])
    // assert (current behavior — FAILS): prisma.subscriptionPayment.count({ where: { subscriptionId: id } }) === 1
    //                                    prisma.invoice.count({ where: { subscriptionId: id } }) === 1
    // This test should fail today and pass after F-1 fix lands.
  });

  it('I-3: confirmContactRenewal with same externalReference twice → only first writes', async () => {
    // act: await confirm(id, 'ref-123'); await confirm(id, 'ref-123');
    // assert: prisma.subscriptionPayment.count({ where: { externalReference: 'ref-123' } }) === 1
  });

  it('plan-downgrade-state: schedule downgrade, then exceed new plan limits before period end → applyScheduledDowngrade rejects', async () => {
    // arrange: tenant on PRO (maxUsers 20), schedule downgrade to BASIC (maxUsers 5)
    //          create 10 active users between schedule time and period-end
    // act: applyScheduledDowngrade(subscriptionId)
    // assert: throws BadRequest with "current usage exceeds new plan limits"
    //         subscription.planId is still PRO
  });

  it('PAST_DUE entry: ACTIVE subscription with currentPeriodEnd ≤ now+1day → renewSubscription marks PAST_DUE', async () => {
    // arrange: ACTIVE subscription, currentPeriodEnd = now()
    // act: schedulerService.handleSubscriptionRenewals()
    // assert: status === 'PAST_DUE'
    //         "payment failed" notification queued
  });

  it('PAST_DUE exit: confirmContactRenewal moves PAST_DUE → ACTIVE and resets period', async () => {
    // arrange: PAST_DUE subscription
    // act: confirmContactRenewal(id, 'ref-456')
    // assert: status === 'ACTIVE'
    //         currentPeriodStart, currentPeriodEnd advanced by billingCycle
    //         isTrialPeriod === false
  });

  it('PAST_DUE → EXPIRED only after 7 days', async () => {
    // arrange: PAST_DUE subscription, currentPeriodEnd = 6 days ago
    // act: schedulerService.handlePastDueSubscriptions()
    // assert: still PAST_DUE
    // arrange2: currentPeriodEnd = 8 days ago
    // act2: schedulerService.handlePastDueSubscriptions()
    // assert2: status === 'EXPIRED', endedAt set
  });

  it('cross-tenant: subscription belonging to tenant A is not visible/mutable from tenant B', async () => {
    // arrange: tenant A with subscription Sa; tenant B logged in
    // act: GET /subscriptions/:Sa as B
    //      PATCH /subscriptions/:Sa as B { autoRenew: false }
    //      POST /subscriptions/:Sa/cancel as B
    // assert: all three → 404 NotFound (NOT 403, to avoid IDOR existence leak)
    //         Sa.autoRenew unchanged
  });

  it('I-9 + F-3: invoice issued for a future period has dueDate ≥ periodStart', async () => {
    // arrange: billingService.createInvoice with periodStart = +30 days
    // act: createInvoice(...)
    // assert (current behavior — FAILS): invoice.dueDate.getTime() >= invoice.periodStart.getTime()
    // Should fail today (dueDate = now()), pass after F-3 fix.
  });

  it('I-12: cross-currency plan change rejected', async () => {
    // arrange: subscription on TRY plan; new plan on USD
    // act: changePlan(id, { newPlanId: usdPlan.id })
    // assert: throws BadRequest "Plan currency change is not supported"
  });

  it('I-13: 100 concurrent invoices in the same YYYYMM scope → 100 distinct invoice numbers', async () => {
    // arrange: 100 subscriptions ready for renewal
    // act: Promise.all(100 × createInvoice(...))
    // assert: prisma.invoice.findMany({ select: { invoiceNumber: true } }) → 100 unique values
    //         sequence component is monotonically 0001..0100 (entropy suffix differs)
  });

  it('I-15: scheduled downgrade re-validates usage at apply time', async () => {
    // see plan-downgrade-state above — this is the canonical test for I-15.
  });

  it('I-16: PATCH /subscriptions/:id { planId: <new> } is silently ignored', async () => {
    // act: PATCH with a body containing planId, amount, status (all forbidden)
    // assert: 200 OK with unchanged subscription (only autoRenew/cancelAtPeriodEnd ever propagate)
  });

  it('M9b: cron lock prevents double-renewal across two replicas', async () => {
    // arrange: spawn two scheduler instances pointing at the same DB
    //          one ACTIVE subscription with currentPeriodEnd in [now, now+1day]
    // act: both replicas tick `handleSubscriptionRenewals` simultaneously
    // assert: subscription transitioned to PAST_DUE exactly once
    //         exactly one "payment failed" notification queued
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`:
*create two tenants → attempt cross-tenant access via every subscription endpoint (`GET /:id`, `PATCH /:id`, `POST /:id/cancel`, `POST /:id/reactivate`, `POST /:id/change-plan`, `GET /:id/invoices`, `GET /:id/scheduled-downgrade`, `DELETE /:id/scheduled-downgrade`) → assert zero leaks (all 404).*
