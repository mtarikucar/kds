# `customers` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `backend/src/modules/customers/customers.service.ts`
- `backend/src/modules/customers/loyalty.service.ts` *(especially `:50-108` — the gold-standard redemption pattern)*
- `backend/src/modules/customers/referral.service.ts`
- `backend/src/modules/customers/phone-verification.service.ts`
- `backend/src/modules/customers/customer-session.service.ts`
- `backend/src/modules/customers/sms.service.ts`
- `backend/src/modules/customers/sms-providers/sms-provider.interface.ts`
- `backend/src/modules/customers/sms-providers/netgsm.provider.ts`
- `backend/src/modules/customers/sms-providers/twilio.provider.ts`
- `backend/src/modules/customers/customers.controller.ts`
- `backend/src/modules/customers/customer-public.controller.ts`
- `backend/src/modules/customers/customers.helpers.ts`
- `backend/src/modules/customers/dto/customer.dto.ts`
- `backend/prisma/schema.prisma:1163-1351` (Customer, CustomerSession, LoyaltyTransaction, PhoneVerification, CustomerReferral)
- `backend/prisma/schema.prisma:990-1013` (SmsSettings — per-tenant SMS toggles)

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — §4.16 (`customers/` per-module report — the loyalty pattern was already flagged as "highlight as a pattern to replicate"), §8 ("What's already excellent").

---

## 1. Health & summary

🟢 **green.** `customers` is one of the calmer modules in the repo, and `loyalty.service.ts:50-108` is the single best example of safe concurrent decrement in the codebase: a Serializable `$transaction` whose decrement is gated by a conditional `updateMany` filtered on `loyaltyPoints >= needed`, with a `count !== 1` check that converts the lost-race into a clean `BadRequestException`. Several adjacent flows already inherit the spirit of the pattern — `phone-verification.service.ts:143-155` atomically increments `attempts` with a `lt: maxAttempts` guard, `customers.service.ts:88-103` uses `updateMany` to avoid TOCTOU on tenant-scoped edits, `customers.service.ts:165-179` recovers from the create-race on `findOrCreateByPhone` via P2002, `referral.service.ts:101-202` wraps the entire referral grant in a Serializable tx with a `referredBy IS NULL` filter to make first-claim-wins atomic. What's left is a small set of secondary edges: two idempotency-by-findFirst checks for welcome bonus / per-order EARN that race in theory (both pre-empted by the comment author but never enforced at the DB layer), an SMS rate-limit count-then-create gap (acceptable), the absence of any DB CHECK on `loyaltyPoints >= 0`, and SMS credentials living in environment variables rather than per-tenant encrypted settings. None are deploy-blockers; the module's discipline is high enough that the gaps stand out specifically because the surrounding pattern is so clean.

---

## 2. Scope of this review

**Read end-to-end:**
- `customers.service.ts` (282 LOC) — CRUD + `findOrCreateByPhone` + `updateStatistics` + analytics.
- `loyalty.service.ts` (391 LOC) — points award/redeem/expire, tier compute, welcome / birthday / referral bonuses, transaction history.
- `referral.service.ts` (246 LOC) — code generation (with retry on P2002), `applyReferralCode` (full Serializable tx), referral stats.
- `phone-verification.service.ts` (218 LOC) — OTP send (per-phone/per-tenant/per-session daily caps + 60s cooldown), verify (atomic attempts-increment).
- `customer-session.service.ts` (191 LOC) — 4-hour public sessions, tenant boundary defense at `:64-72`, cleanup.
- `sms.service.ts` (146 LOC) — provider selection, retry-with-exponential-backoff orchestrator.
- `sms-providers/netgsm.provider.ts` (111 LOC), `twilio.provider.ts` (50 LOC), `sms-provider.interface.ts` (11 LOC).
- `customer-public.controller.ts` (278 LOC) — guest-facing endpoints under `/customer-public/*` with throttle per route.
- `customers.controller.ts` (71 LOC) — staff-facing CRUD under `JwtAuthGuard + TenantGuard + RolesGuard`.
- `customers.helpers.ts` (56 LOC) — `normalizePhone`, `generateOtp` (CSPRNG `randomInt`), `hashOtp` (SHA-256 with `JWT_SECRET` salt), `constantTimeEquals`, `generateReferralSuffix` (CSPRNG `randomBytes`).
- `dto/customer.dto.ts` (159 LOC) — class-validator DTOs; `PHONE_REGEX = /^\+?[1-9]\d{7,14}$/`.
- `prisma/schema.prisma:1163-1351` (the five models) + `:990-1013` (SmsSettings).

**Skimmed only:**
- `customers.module.ts` (30 LOC) — DI wiring.
- `sms-settings/` module (separate folder) — per-tenant toggles for which events trigger SMS; not on the credential path, deferred to its own Tier-3 entry.

**Skipped:**
- Frontend customer pages — out of backend scope.
- `sms-notification.service.ts` in `sms-settings/` — orchestration, not credential storage; orthogonal to this review's concerns.

---

## 3. Business-logic invariants

The contract this feature owes. Each row is **testable** — a property an integration test could assert.

| #    | Invariant                                                                                                                                                  | Enforced at (`file:line`)                                                                                                                                | Test coverage | Risk if violated |
|------|------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|------------------|
| I-1  | `customer.loyaltyPoints` never drops below zero, even under concurrent redemption.                                                                          | `loyalty.service.ts:71-82` (conditional `updateMany where loyaltyPoints >= needed`, `count !== 1 ⇒ throw`) inside Serializable tx at `:107`              | ❌ none        | Negative balance = currency creation, audit drift, customer can keep spending phantom points. |
| I-2  | Loyalty redemption is **race-free**: two concurrent `redeemPoints(N)` calls with balance = `N` produce exactly one success and one `BadRequestException`.   | same as I-1                                                                                                                                              | ❌ none        | Double-spend = direct revenue loss. |
| I-3  | At most one `EARNED` LoyaltyTransaction exists per `(customerId, orderId)`.                                                                                 | `loyalty.service.ts:121-139` (findFirst-then-skip; tenant-scoped via `customer: { tenantId }`) — **no DB unique index** (see F-1)                        | ❌ none        | Retry of payment flow double-credits points. |
| I-4  | At most one welcome `BONUS` LoyaltyTransaction exists per customer.                                                                                         | `loyalty.service.ts:196-219` (findFirst-then-skip with `description: { startsWith: 'Welcome bonus:' }`) — **no DB unique index** (see F-2)               | ❌ none        | Two-tap race grants duplicate welcome gifts (the comment at `:191-195` even names this race). |
| I-5  | A referral code is **single-use per referred customer**: `customer.referredBy` is set exactly once.                                                          | `referral.service.ts:141-147` (`updateMany where referredBy IS NULL` + `count !== 1 ⇒ throw`) inside Serializable tx at `:201`; DB `@unique referredId` on `CustomerReferral` at `schema.prisma:1331` | ❌ none        | Same referrer farms one referred account repeatedly. |
| I-6  | A customer cannot apply **their own** referral code.                                                                                                        | `referral.service.ts:125-127`                                                                                                                            | ❌ none        | Trivial self-grant of `REFERRER_BONUS + REFERRED_BONUS` points. |
| I-7  | A referral grant is only awarded if the referred customer's phone is verified.                                                                              | `referral.service.ts:119-121`                                                                                                                            | ❌ none        | Free farming via fake phone numbers. |
| I-8  | Per-tenant referral grant rate is capped at `DAILY_TENANT_CAP=200` per 24h window.                                                                          | `referral.service.ts:89-99` (count-then-create — see §6 for the race window)                                                                              | ❌ none        | Loyalty-point inflation; tenant cost spike. |
| I-9  | `(tenantId, phone)` is unique — duplicate customer rows cannot exist for the same canonical phone within a tenant.                                          | `schema.prisma:1204` (`@@unique([tenantId, phone])`); race recovery at `customers.service.ts:165-179` catches P2002                                       | ❌ none        | Split loyalty history; phone-based identification breaks. |
| I-10 | `(tenantId, email)` is unique within a tenant.                                                                                                              | `schema.prisma:1203` (`@@unique([tenantId, email])`)                                                                                                     | ❌ none        | Same as I-9 but for email. |
| I-11 | **No cross-tenant data leakage**: every list/find/update/delete is filtered by `req.tenantId`, and relation reads use a `customer: { tenantId }` filter.    | `customers.service.ts:49, 80, 89, 107, 152, 184, 195`; `loyalty.service.ts:64, 76, 84, 122-127, 197-202, 233-235`; `customer-session.service.ts:64-72` (defense-in-depth re-check that the customer's `tenantId` matches the session's) | ❌ none        | Tenant takeover via guessed customer IDs. |
| I-12 | A `markPhoneVerified` write is **not** reachable from the `UpdateCustomerDto` path — only the OTP flow can flip the flag.                                  | `customers.service.ts:129-139` (private method; not invoked by `update()`); `customer-public.controller.ts:213-219` (gated on `result.verified`)         | ❌ none        | Staff (or compromised admin) can mark a phone as verified without ever sending a code → bypass on referral-gate (I-7). |
| I-13 | OTPs are stored as `sha256(JWT_SECRET : code)` and compared in constant time. A DB dump alone does not reveal live codes.                                  | `customers.helpers.ts:32-42`; `phone-verification.service.ts:82, 157-158, 165-167`                                                                       | ❌ none        | DB-read attacker replays codes; timing leak of code. |
| I-14 | OTP verification is bound to the **session that initiated the send** — a different session cannot consume someone else's code.                              | `phone-verification.service.ts:127-135` (`sessionId` is part of the lookup filter)                                                                       | ❌ none        | Phone hijack via parallel session pumping. |
| I-15 | Per-phone OTP send cooldown is 60s; per-phone daily cap 8; per-tenant daily cap 500; per-session daily cap 10.                                              | `phone-verification.service.ts:20-22, 47-79`                                                                                                             | ❌ none        | Pumping fraud against the SMS provider; tenant cost spike. |
| I-16 | A customer with non-trivial loyalty history (any `LoyaltyTransaction` row) cannot be hard-deleted; the `DELETE` is translated to a clear 409.              | `schema.prisma:1266` (`onDelete: Restrict` on `LoyaltyTransaction.customer`); `customers.service.ts:105-127` (P2003 → `ConflictException`)               | ❌ none        | Audit-trail destruction; loyalty liability accounting drift. |
| I-17 | Public-controller endpoints resolve `tenantId` from the **server-side session record**, never from the request body, except for the bootstrap `POST /sessions`. | `customer-public.controller.ts:88, 128, 139, 159, 182, 197, 205, 230, 242, 257` (all call `requireSession(...)`) | ❌ none        | Cross-tenant access via crafted body. |
| I-18 | A linked customer **must** share the session's `tenantId`; mismatch raises 401.                                                                              | `customer-session.service.ts:67-72` (defensive cross-tenant check on `session.customer.tenantId`)                                                        | ❌ none        | Session-to-foreign-customer linkage = takeover. |
| I-19 | SMS provider credentials are **never** logged, never returned in any HTTP response, and never round-tripped through user-controlled state.                  | `netgsm.provider.ts:12-15` + log lines at `:60, 77` (only normalized phone + msgheader code); `twilio.provider.ts:36` (only SID); `sms.service.ts` does not log credentials | ❌ none        | Provider account takeover from log exfil. |
| I-20 | Phone numbers are canonicalized on **every** write path so duplicate detection under `@@unique([tenantId, phone])` works across whitespace variations.       | `customers.helpers.ts:10-16`; called from `customers.service.ts:31, 93, 151, 184` and `phone-verification.service.ts:38, 125, 178`                       | ❌ none        | Duplicate-row workaround via reformatted phone input. |

Invariants are not invented — each is a contract the existing code is already trying to keep, written down so a test can assert it. **Test coverage column is uniformly ❌ — no `customers/**/*.spec.ts` exists today** (verified: `find backend/src/modules/customers -name '*.spec.ts'` returns nothing; the global backend test list is 13 specs, none under `customers/`).

---

## 6. Concurrency hazards

This is the section that matters for `customers/`. The module owns three race-prone surfaces — loyalty mutation, referral grant, and OTP attempts — and gets two-and-a-half of them right.

**Critical sections + lock strategy:**

- `loyalty.service.ts:62-107` — `awardPoints()`. Serializable `$transaction` with the canonical "conditional `updateMany` + `count !== 1` rollback" pattern. **This is the gold-standard implementation in the entire codebase** (called out in `CODE_REVIEW.md §4.16` and §8). See §8 below for the full pattern documentation.
- `referral.service.ts:101-202` — `applyReferralCode()`. Serializable `$transaction` wraps the entire flow: referrer lookup + referred lookup + `CustomerReferral.create` + `customer.updateMany where referredBy IS NULL` (`:141-147`) + two inline loyalty writes against the **same tx client** (`:152-174`) + final `customerReferral.update` to set `rewardedAt`. Atomicity is preserved end-to-end; partial-grant cannot occur.
- `phone-verification.service.ts:143-155` — atomic attempts-increment gated by `attempts: { lt: maxAttempts }`. Mini-version of the gold-standard pattern: two parallel wrong guesses cannot both under-count the counter.
- `customers.service.ts:88-103` — `update()` uses `updateMany where { id, tenantId }` instead of `findFirst` + `update`. Avoids TOCTOU between read and write, no transaction needed because the read isn't load-bearing.
- `customers.service.ts:192-215` — `updateStatistics()` is inside a `$transaction` (default isolation — Read Committed). Reads the customer row, computes `newTotalSpent`, then `updateMany`. Without Serializable, two concurrent calls for the same customer can both read `totalOrders=N` and both write `totalOrders=N+1`. **See F-4 below.**
- `customers.service.ts:151-179` — `findOrCreateByPhone()` recovers from P2002 by re-reading. Clean first-arrival-wins pattern; second arrival returns the row created by the first.

**Race windows still open** (each with a reproduction sketch):

- *Sketch (F-1):* Two payment retries for the same order fire `earnPointsFromOrder(customerId, tenantId, orderId, ...)` simultaneously. Both execute the `findFirst` at `loyalty.service.ts:121-128`, both see `existing=null`, both call `awardPoints` (separate Serializable txes — Serializable doesn't help because the *first* `findFirst` was outside the tx). Both insert an `EARNED` `LoyaltyTransaction` row. **Where:** `loyalty.service.ts:121-128`. **Severity:** Medium Cor. **Fix:** add `@@unique([customerId, orderId, type])` to `LoyaltyTransaction` and let the DB reject the duplicate; the existing recover-on-P2002 idiom from `customers.service.ts:165-179` is the template.

- *Sketch (F-2):* Two parallel `POST /customer-public/identify` taps for a fresh phone (per the comment at `loyalty.service.ts:191-195`). Both see `totalOrders=0/points=0` at `customer-public.controller.ts:102`, both call `awardWelcomeBonus`, both `findFirst` outside the tx and see no welcome row, both award. **Where:** `loyalty.service.ts:196-219`. **Severity:** Medium Cor. **Fix:** either (a) a partial unique index on `LoyaltyTransaction(customerId)` where `type='BONUS' AND description LIKE 'Welcome bonus:%'` (Postgres-only, but the codebase already uses Postgres-specific features), or (b) a `welcomeBonusAwardedAt: DateTime?` column on `Customer` with a conditional `updateMany where welcomeBonusAwardedAt IS NULL` inside a tx — same shape as the redemption gold standard.

- *Sketch (F-3):* `updateStatistics` for the same customer fires twice (split-bill close emitting two `OrderPaid` events, one per ticket). Read Committed lets both reads see `totalOrders=N`; both write `N+1`. **Where:** `customers.service.ts:192-215`. **Severity:** Medium Cor. **Fix:** either upgrade to Serializable (cheap — it's already a `$transaction`) **or** rewrite to a single atomic `updateMany` with `{ totalOrders: { increment: 1 }, totalSpent: { increment: amount } }` and drop `averageOrder` (derive on read; today it's only stored to denormalize for the analytics list at `customers.service.ts:240`).

- *Sketch (F-5):* `applyReferralCode` Serializable tx still does a count-then-create against the daily cap **outside** the tx at `referral.service.ts:91-96`. Two parallel applications can both pass the cap check. **Severity:** Low Cor. **Fix:** acceptable — the absolute overshoot is bounded by concurrency × tx-latency, and the inside-tx writes are still race-free for the per-customer invariants (I-5, I-6).

- *Sketch (F-6):* Phone-verification daily caps (`phone-verification.service.ts:57-79`) are count-then-create with no serialization. Two parallel `sendOTP` calls at cap-1 both pass, both create. **Severity:** Low Sec. **Fix:** acceptable — the 60s per-phone cooldown at `:48-54` is the tighter bound; the daily caps are a backstop, not the primary defense.

- *Sketch (F-7):* `referral.service.ts:29-66` — `generateReferralCode` uses `updateMany where referralCode IS NULL` to write a new code, then re-reads to confirm. The retry loop handles P2002 on `referralCode @unique` (schema.prisma:1177) correctly. But the pattern is non-idiomatic: it could use `update where { id, referralCode: null }` directly and catch P2002 in one place. **Severity:** Info Arch.

**Idempotency keys:**

- `LoyaltyTransaction.orderId` is a **natural** idempotency key for EARNED rows but the DB doesn't enforce it (F-1).
- `CustomerReferral.referredId` is `@unique` (schema.prisma:1331) — DB-enforced single-claim per referred customer. ✅
- `Customer.referralCode` is `@unique` (schema.prisma:1177) — DB-enforced per-platform uniqueness. ✅
- `Customer.@@unique([tenantId, phone])` and `Customer.@@unique([tenantId, email])` — DB-enforced uniqueness per tenant. ✅
- Welcome bonus has **no** DB-enforced key (F-2).
- `PhoneVerification` has no `(sessionId, phone, tenantId, active)` unique constraint, so two parallel `sendOTP` calls can create two pending rows; not a defect (the verify-side resolves by `findFirst orderBy createdAt desc`), but worth noting.

---

## 7. Findings

| ID  | Sev    | Dim | Location                                                         | Finding | Fix |
|-----|--------|-----|------------------------------------------------------------------|---------|-----|
| F-1 | Medium | Cor | `loyalty.service.ts:121-139`                                     | Per-order EARNED idempotency is `findFirst`-then-skip outside any transaction. Two parallel `earnPointsFromOrder` for the same `(customerId, orderId)` can both pass and both insert. | Add `@@unique([customerId, orderId, type])` to `LoyaltyTransaction`; catch P2002 in `earnPointsFromOrder` and return the existing row (template at `customers.service.ts:165-179`). |
| F-2 | Medium | Cor | `loyalty.service.ts:196-219`                                     | Welcome-bonus idempotency relies on `findFirst` with `description: { startsWith: 'Welcome bonus:' }` outside the tx (the comment at `:191-195` explicitly names the race). | Add a partial unique index OR a `welcomeBonusAwardedAt` column on `Customer` and gate inside a conditional `updateMany` — same shape as redemption. |
| F-3 | Medium | Cor | `customers.service.ts:192-215`                                   | `updateStatistics` is in a `$transaction` but uses default Read Committed isolation; concurrent updates for the same customer lose increments (lost-update). The `result.count !== 1` check at `:213` does **not** detect this — it only catches the row going missing. | Either set `isolationLevel: Serializable` (the gold-standard treatment) OR drop the read entirely and use `{ totalOrders: { increment: 1 }, totalSpent: { increment: amount } }` directly. |
| F-4 | Medium | Sec | `sms.service.ts:22-63` + env vars `NETGSM_USERCODE/PASSWORD/MSGHEADER`, `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER` | SMS provider credentials are **process-global env vars**, not per-tenant encrypted settings. A multi-tenant SaaS that ships SMS for several tenants on one provider account is workable, but (a) bills cannot be split per-tenant cleanly, (b) one tenant's runaway send (caught by daily caps but not blocked at the provider) charges the platform, (c) the comparable `settings/integrations` module (the gold-standard for credentials, per `CODE_REVIEW.md §4.12`) uses `encryptJson` + redact-on-response. The `SmsSettings` model at `schema.prisma:990-1013` already exists but only holds **per-tenant event toggles**, no credentials. | Decide: either declare env-var credentials intentional (single platform account) and document — **or** extend `SmsSettings` with encrypted `provider`, `credentials` (encryptJson), and a `findOneWithSecrets` accessor mirroring the integrations module. |
| F-5 | Low    | Cor | `referral.service.ts:89-96`                                      | Daily-cap count is outside the Serializable tx; two parallel `applyReferralCode` at cap-1 both pass. Absolute overshoot is bounded by concurrency. | Move the count inside the tx OR accept; document as bounded. |
| F-6 | Low    | Sec | `phone-verification.service.ts:57-79`                            | Daily caps are count-then-create with no serialization. The 60s per-phone cooldown is the tight bound; the daily cap is a backstop. | Accept, or migrate to a token-bucket in Redis. |
| F-7 | Low    | Cor | `customer-public.controller.ts:102`                              | The condition `customer.totalOrders === 0 && customer.loyaltyPoints === 0` decides whether to award a welcome bonus. A customer who has redeemed back to zero points but has zero orders (e.g., admin adjustment) would re-trigger the bonus — but F-2's idempotency check at `loyalty.service.ts:196-204` blocks the second grant. So the heuristic is sloppy but the safety net catches it. | Replace heuristic with the explicit DB-enforced check from F-2's fix. |
| F-8 | Low    | Sec | `customer-public.controller.ts:84-86` (`@Throttle({ limit: 10, ttl: 60_000 })` on `/identify`) | The throttler is **per-IP** by default. A botnet rotating IPs can drive `findOrCreateByPhone` writes against arbitrary phone numbers, polluting the `Customer` table (the writes succeed; daily SMS caps don't apply because no OTP is sent on identify). | Combine with a per-tenant 24h create-cap on Customer or require an OTP-verified phone before `identify` is allowed to **create** (today it auto-creates on first sight). |
| F-9 | Low    | Cor | `customers.helpers.ts:32-34`                                     | `hashOtp` falls back to `''` if neither `JWT_SECRET` nor `APP_SECRET` is set. In dev that's harmless; in a misconfigured prod, every OTP hashes to `sha256(":code")` — still secure as a one-way hash but loses the dump-resistance benefit. | Throw on boot if neither secret is set (or reuse the existing `JwtAuthGuard` strict requirement). |
| F-10| Low    | Sec | `customer-session.service.ts:14-16`                              | Session lifetime is hardcoded to 4 hours. Acceptable for QR-menu, but no idle-timeout enforcement (only an absolute one) — `updateSessionActivity` at `:104-108` is best-effort and silently swallows errors at `:130`. Last-activity is used in `cleanupExpiredSessions` at `:178-180`, so idle-out works, but only via the cleanup job. | Document the trade-off or surface idle-timeout in `getSession`. |
| F-11| Info   | Arch | `loyalty.service.ts:359-379` (`addPoints` wrapper)               | Wraps `awardPoints` and tacks on a `checkAndUpgradeTier` call. The two are sequenced outside any transaction — the points credit can succeed and the tier upgrade fail (logged but lost). For loyalty this is harmless (tier recomputes on every read in `getTierStatus`), but worth noting. | Either accept (current state) or move tier upgrade inside the same tx. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

### THE GOLD STANDARD — Loyalty redemption pattern

`loyalty.service.ts:50-108` (`awardPoints`) is the canonical race-free decrement-if-allowed implementation in the entire codebase. The full pattern, in five parts:

1. **Serializable `$transaction`** at `loyalty.service.ts:62, 107` —
   ```ts
   return this.prisma.$transaction(async (tx) => { ... },
     { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
   ```
   Postgres SSI gives us snapshot-equivalent semantics; if two txes commit decisions that would violate serializability, Postgres aborts one with `40001` and Prisma surfaces it as a retryable error.

2. **Pre-flight read inside the tx** at `:63-66` —
   ```ts
   const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId } });
   if (!customer) throw new BadRequestException('Customer not found');
   ```
   Tenant-scoped from the first read; no leaks through guessed IDs.

3. **Conditional `updateMany` with the guard predicate** at `:76-79` —
   ```ts
   const result = await tx.customer.updateMany({
     where: { id: customerId, tenantId, loyaltyPoints: { gte: needed } },
     data: { loyaltyPoints: { decrement: needed } },
   });
   ```
   The filter `loyaltyPoints: { gte: needed }` is the load-bearing line. If a concurrent tx already decremented the balance below `needed`, this `updateMany` matches zero rows. **The DB does the arithmetic atomically** — no read-then-write at the application layer.

4. **`count !== 1` ⇒ rollback** at `:80-82` —
   ```ts
   if (result.count !== 1) {
     throw new BadRequestException('Insufficient loyalty points (race)');
   }
   ```
   The throw rolls the entire tx, including the `LoyaltyTransaction.create` at `:90-104`. Two concurrent redeemers of a balance-of-N get one success and one clean 400 — never one success and one phantom debit.

5. **Audit row written in the same tx** at `:90-104` — `balanceBefore` / `balanceAfter` integers, type-tagged, tenant-stamped, capturing the order reference. The audit and the mutation cannot get out of sync because they commit together.

The pattern is **5 SQL statements**, no advisory locks, no application-side retry, no Redis. It is the cheapest correct implementation for a decrement-if-allowed flow on Postgres.

**Cross-link — candidates that should adopt this pattern:**

- **Orders / payments (split-bill, M10 in `CODE_REVIEW.md §2`):** `payments.service.ts:412-533` accepts split-bill writes with no idempotency key. The fix that's been deferred is to add a client-supplied `externalReference` and reject duplicates — that's an idempotency layer, but the **inside** of the split-bill (Σ payments ≤ order.totalAmount) is exactly a decrement-if-allowed problem on the order's remaining balance. The same Serializable tx + conditional `updateMany where remainingAmount >= thisPaymentAmount` shape applies. Today (per M1, M2) the check is `Number(_sum.amount) >= orderAmount` outside any tx — which is the exact pattern the loyalty service abandoned.
- **Subscriptions (renewal, M9):** `subscription-scheduler.service.ts:90-97` writes a renewal record with no idempotency key. The pattern should be: Serializable tx, read the latest renewal, conditional `updateMany on the subscription where periodStart < newPeriodStart`, write the renewal, `count !== 1 ⇒ rollback`. **Composite `@@unique([subscriptionId, periodStart])` on `SubscriptionRenewal` is the DB-level mirror** of the loyalty pattern's `updateMany` guard — and a strictly stronger guarantee, since it survives a missing tx.
- **Accounting (invoice numbering, M3):** `sales-invoice.service.ts:32-33` races on two concurrent POSTs. The loyalty-style fix is: Serializable tx + `UPDATE accounting_settings SET nextInvoiceNumber = nextInvoiceNumber + 1 WHERE id = ? AND nextInvoiceNumber = ? RETURNING nextInvoiceNumber`. The `WHERE nextInvoiceNumber = ?` is the gold-standard guard predicate — only the tx that observed the right pre-state succeeds; the other retries.
- **Stock decrement (`stock-management/`):** any path that decrements `currentStock` for a sale should already use this pattern. Per `CODE_REVIEW.md §4.11`, the module uses advisory locks for cron uniqueness; per-sale decrements would benefit from the same conditional-update shape if they don't already use it.
- **Z-report finalization:** per `CODE_REVIEW.md §4.9`, `z-reports.service.ts:213` finalizes with a conditional `updateMany` — this is already an instance of the pattern; call it out in the cross-link as a peer.

The throughline: **whenever the code does `read X; decide on X; write X-delta` against tenant-scoped state, the gold standard says (a) put the read and write in the same Serializable tx, (b) repeat the decision predicate in the write's `where`, (c) treat `count !== 1` as a clean 4xx.**

### Other patterns worth keeping

- `loyalty.service.ts:65, 84, 232, 263, 287` and across the module: tenant scoping uses **relation filters** (`customer: { tenantId }`) on rows that don't carry their own `tenantId`. `LoyaltyTransaction` *does* have a direct `tenantId` (schema.prisma:1262), but the code uses both the direct column and the relation-filter belt-and-suspenders, blocking cross-tenant probes even if a future refactor drops the column.
- `customers.service.ts:165-179` — **recover-from-P2002** idiom for the create-race: catch the unique-constraint violation, re-read, return the row created by the winning racer. Idiomatic, three lines of code, no application-side lock needed.
- `referral.service.ts:101-202` — full transactional grant: every loyalty mutation inside the referral flow uses the **same `tx` client** at `:152-174`. No nested-tx, no callback-spanning-multiple-prisma-instances bugs.
- `phone-verification.service.ts:143-155` — atomic attempts-increment is a mini-version of the gold standard: `updateMany where attempts: { lt: maxAttempts }`. Catches the parallel-wrong-guess race that would otherwise let an attacker spend 5 guesses against a 3-attempt limit.
- `customer-session.service.ts:64-72` — defense-in-depth re-check that `session.customer.tenantId === session.tenantId`, with a comment explaining why it's defensive (linkCustomerToSession already guards). Mirrors the pattern from `auth/` of "primary check elsewhere, secondary re-check at the boundary."
- `customers.helpers.ts:23-25, 32-35, 37-42` — CSPRNG OTP generation (`randomInt`), salted hash with constant-time compare. Stock-standard but easy to get wrong; this is right.

---

## 9. Spot-checks performed

**Verified:**
- F-1 confirmed at `loyalty.service.ts:121-139`: `findFirst` precedes the `awardPoints` Serializable tx; the tx itself has no per-order guard. A `grep -n '@@unique.*orderId' backend/prisma/schema.prisma | grep -i loyalty` returns nothing — no DB-level enforcement.
- F-2 confirmed at `loyalty.service.ts:196-204`. The author flagged the race in the comment at `:191-195`; the fix is "the cheapest stable check that doesn't require a schema change." Today's defense is correct **for sequential** taps, racy for parallel ones.
- F-3 confirmed at `customers.service.ts:192-215`: `$transaction` without explicit `isolationLevel` defaults to Postgres `read committed` per Prisma docs; the `result.count !== 1` check at `:213` only catches row-disappearance, not lost updates.
- F-4 confirmed: no `@Column ... encrypted` on `SmsSettings` at `schema.prisma:990-1013`, no `encryptJson` import in `sms.service.ts` or providers, all credentials read from `ConfigService` at `sms.service.ts:23-60`.
- I-12 verified: `customers.service.ts:129-139` (`markPhoneVerified`) is a separate private method; `UpdateCustomerDto` at `dto/customer.dto.ts:44-75` has no `phoneVerified` field; `customers.service.ts:88-103` (`update`) does not write `phoneVerified`.
- I-16 verified at `schema.prisma:1266` (`onDelete: Restrict`) + `customers.service.ts:117-124` (P2003 → 409 with the steered-toward-anonymize message).
- I-9 verified at `schema.prisma:1204` + the recover-on-P2002 idiom at `customers.service.ts:165-179`.
- Welcome bonus / referral welcome wording: `loyalty.service.ts:217` writes `'Welcome bonus: ${LOYALTY_CONFIG.welcomeBonus} points'` (with colon) and `referral.service.ts:187` writes `'Welcome bonus for using referral code ${code}'` (no colon). The idempotency check at `loyalty.service.ts:200` uses `startsWith: 'Welcome bonus:'` — the referral message does **not** match, so a referred customer can still receive the welcome bonus on a separate identify call. **Intentional.** Not a finding.

**Dropped (initial reading flagged but verified safe):**
- **"SMS provider credentials leak through error logs."** Verified: `netgsm.provider.ts:60, 77` log only the normalized phone + the public error map; `twilio.provider.ts:36, 45` log only the SID and error.code. No credentials logged. **Drop.**
- **"Welcome-bonus check matches referral bonus."** Verified above — the description prefix is `'Welcome bonus:'` (with colon) vs `'Welcome bonus for ...'` (without). They are disjoint. **Drop.**
- **"Tenant-scoping missing on `loyalty.service.ts:121` findFirst."** Verified — the filter includes `customer: { tenantId }` at `:126`, blocking cross-tenant orderId guesses. **Drop.**
- **"`customer-public.controller.ts:127` reads a `sessionId` query param without validation."** Verified — `getProfile` calls `requireSession(sessionId)` at `:128` which throws `UnauthorizedException` on any invalid token (`customer-session.service.ts:60-63`). The Query param is the session token; that's the design. **Drop.**

**Downgraded:**
- F-5 / F-6 — Initially considered Medium because count-then-create is a textbook race. Downgraded to Low because (a) the *primary* guard for OTP send is the 60s per-phone cooldown at `phone-verification.service.ts:48-54`, which is row-level race-free under Postgres reads-your-own-writes, and (b) for referral the inside-tx I-5 / I-7 guards make the cap a backstop only.

---

## 10. Recommended tests

The eight integration tests below cover the §3 invariants and the §6 race risks. Skeletons only; not full implementations.

```ts
// backend/src/modules/customers/__tests__/loyalty.integration.spec.ts

describe('loyalty redemption — the canonical race test', () => {
  it('I-1/I-2: two concurrent redeemPoints(100) on a balance of 100 → exactly one succeeds', async () => {
    // arrange: customer with loyaltyPoints = 100 (above minRedeemPoints)
    // act:
    const results = await Promise.allSettled([
      service.redeemPoints(customerId, tenantId, 100),
      service.redeemPoints(customerId, tenantId, 100),
    ]);
    // assert:
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    const c = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(c!.loyaltyPoints).toBe(0);
    // and exactly one REDEEMED LoyaltyTransaction row exists
    const txes = await prisma.loyaltyTransaction.count({
      where: { customerId, type: 'REDEEMED' },
    });
    expect(txes).toBe(1);
  });

  it('I-3 (currently F-1): two concurrent earnPointsFromOrder for same orderId → exactly one EARNED row', async () => {
    // EXPECTED TO FAIL TODAY — see F-1.
    await Promise.all([
      service.earnPointsFromOrder(customerId, tenantId, orderId, 'ORD-1', 50),
      service.earnPointsFromOrder(customerId, tenantId, orderId, 'ORD-1', 50),
    ]);
    expect(await prisma.loyaltyTransaction.count({
      where: { customerId, orderId, type: 'EARNED' },
    })).toBe(1);
  });

  it('I-4 (currently F-2): two concurrent awardWelcomeBonus → exactly one BONUS row', async () => {
    // EXPECTED TO FAIL TODAY — see F-2.
    await Promise.all([
      service.awardWelcomeBonus(customerId, tenantId),
      service.awardWelcomeBonus(customerId, tenantId),
    ]);
    expect(await prisma.loyaltyTransaction.count({
      where: { customerId, type: 'BONUS', description: { startsWith: 'Welcome bonus:' } },
    })).toBe(1);
  });
});

describe('customer phone uniqueness — race test', () => {
  it('I-9: two parallel findOrCreateByPhone for same phone → exactly one Customer row', async () => {
    const [a, b] = await Promise.all([
      svc.findOrCreateByPhone('+905551234567', tenantId),
      svc.findOrCreateByPhone('+905551234567', tenantId),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.customer.count({
      where: { tenantId, phone: '+905551234567' },
    })).toBe(1);
  });
  // I-20: variant whitespace/punctuation formats collapse to one row.
});

describe('SMS credentials surface', () => {
  it('I-19: no provider credential string appears in any service log', async () => {
    // arrange: spy on Logger.{log,warn,error}; configure netgsm usercode='SECRET'
    // act: trigger success + failure path
    // assert: for every captured line, expect not to contain 'SECRET' or TWILIO_AUTH_TOKEN
  });
  // I-19 (HTTP): assert no GET endpoint echoes ConfigService credential values.
});

describe('phone OTP — race on attempts counter', () => {
  it('I-15: two concurrent wrong-code verifyOTP calls increment attempts by ≤ 2', async () => {
    await Promise.all([
      svc.verifyOTP(phone, '000000', sessionId, tenantId).catch(() => {}),
      svc.verifyOTP(phone, '000000', sessionId, tenantId).catch(() => {}),
    ]);
    const row = await prisma.phoneVerification.findUnique({ where: { id } });
    expect(row!.attempts).toBeGreaterThanOrEqual(1);
    expect(row!.attempts).toBeLessThanOrEqual(2);
  });
});

describe('cross-tenant isolation (style from CODE_REVIEW §3.1)', () => {
  // I-11: for each of /customers, /customers/:id, /customer-public/profile,
  // /customer-public/loyalty/{balance,transactions,tier}, /customer-public/referral/stats
  // — tenant A's token + tenant B's customer/session ID → 401/403/404, never 200.
});
```

These eight tests cover I-1, I-2, I-3, I-4, I-9, I-11, I-15, I-19, I-20. **Two of them (F-1 / F-2) are written to fail today** — they are the regression-trap for the fixes proposed in §7.

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`: *create two tenants → attempt cross-tenant access via every endpoint → assert zero leaks.* The `customers` module exposes 17 endpoints across the two controllers; the test should iterate them and never see a foreign row.
