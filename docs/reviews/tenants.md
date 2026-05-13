# `tenants` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `backend/src/modules/tenants/tenants.controller.ts`
- `backend/src/modules/tenants/tenants.service.ts`
- `backend/src/modules/tenants/tenants.module.ts`
- `backend/src/modules/tenants/dto/update-tenant-settings.dto.ts`
- `backend/src/modules/auth/guards/tenant.guard.ts` (+ `.spec.ts`)
- `backend/src/modules/auth/guards/jwt-auth.guard.ts`
- `backend/src/modules/auth/guards/roles.guard.ts`
- `backend/src/modules/auth/strategies/jwt.strategy.ts`
- `backend/src/common/helpers/subdomain.helper.ts`
- `backend/src/common/constants/subdomain.const.ts`
- `backend/src/common/helpers/guard-bypass.helper.ts`
- `backend/prisma/schema.prisma` (Tenant, ReservedSubdomain, SubscriptionPlan)
- Cross-ref: `backend/src/modules/superadmin/services/superadmin-tenants.service.ts` (status transitions)
- Cross-ref: `backend/src/modules/auth/auth.service.ts:400-440` (`validateUser` tenant-status gate)

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §2 T4/T5 (table row), §4.3 (`tenants/` per-module report).

---

## 1. Health & summary

🟢 **green** — the *runtime* security posture of this module is fine: the guard chain is correct, the JWT strategy gates suspended-tenant access on every request, and the subdomain-quarantine model is well-thought-out. The remaining sharp edges are **boundary-layer defense-in-depth gaps** — a guard test spec that has drifted from the implementation (TenantGuard no longer validates `params.tenantId`), a TX that leaves a reservation row behind on rollback, an NPE on a null `currentPlan`, and a couple of secondary writes (refresh-token revocation, `tokenVersion` bump) that are *not* fired when a superadmin suspends a tenant. None of this is a "do not deploy" defect — `jwt.strategy.ts:60-62` re-checks tenant status on every request — but each is a hardening item worth filing. Health is unchanged from the 2026-04-27 single-file review: T4 was already downgraded High → Low after verifying the guard chain.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/tenants/tenants.controller.ts` (57 LOC) — 3 endpoints: `GET /tenants/public`, `GET /tenants/settings`, `PATCH /tenants/settings`.
- `backend/src/modules/tenants/tenants.service.ts` (149 LOC) — `findAllPublic()`, `findSettings()`, `updateSettings()`, plus private `validateSubdomainChangePermission()`.
- `backend/src/modules/tenants/dto/update-tenant-settings.dto.ts` (193 LOC) — validation surface for `PATCH /tenants/settings`.
- `backend/src/modules/auth/guards/tenant.guard.ts` (26 LOC) — the only thing that actually populates `req.tenantId`.
- `backend/src/modules/auth/guards/tenant.guard.spec.ts` (57 LOC) — **stale**, tests behavior that isn't in the guard.
- `backend/src/modules/auth/strategies/jwt.strategy.ts` (75 LOC) — verifies the JWT, loads the user, and re-checks `tenant.status` per request.
- `backend/src/common/helpers/subdomain.helper.ts` (52 LOC) — `isSubdomainQuarantined()`, `reserveSubdomain()`, `randomSubdomainSuffix()`.
- `backend/src/common/constants/subdomain.const.ts` (42 LOC) — `RESERVED_SUBDOMAINS`, `SUBDOMAIN_REGEX`, `SUBDOMAIN_QUARANTINE_DAYS=90`.
- `backend/prisma/schema.prisma:18-138` (Tenant) + `:168-177` (ReservedSubdomain) + `:683+` (SubscriptionPlan).

**Skimmed only:**
- `backend/src/modules/auth/guards/jwt-auth.guard.ts` (19 LOC), `roles.guard.ts` (40 LOC), `common/helpers/guard-bypass.helper.ts` (28 LOC) — to confirm the guard chain semantics.
- `backend/src/modules/superadmin/services/superadmin-tenants.service.ts:188-310` (`updateStatus`) — only the parts touching subdomain quarantine + status transitions; full review belongs in `superadmin.md`.
- `backend/src/modules/auth/auth.service.ts:400-440` (`validateUser`) — to confirm the suspended-tenant-login gate.
- `backend/src/modules/menu/controllers/qr-menu.controller.ts:18-37` — to map the public `by-subdomain` reverse-lookup (drives the takeover-quarantine requirement).

**Skipped:**
- `tenants.module.ts` (12 LOC) — trivial DI wiring.
- Frontend tenant-settings page — out of backend scope for this file.

---

## 3. Business-logic invariants

The contract this feature owes. Each row is an integration-test assertion.

| #    | Invariant                                                                                                                                  | Enforced at (`file:line`)                                                                              | Test coverage                                                                                                 | Risk if violated |
|------|--------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|------------------|
| I-1  | Every authenticated tenant-scoped request has `req.tenantId` populated **before** the handler runs.                                        | `tenant.guard.ts:17-22` (returns `false` if `!user.tenantId`, then `request.tenantId = user.tenantId`) | ❌ stale only (`tenant.guard.spec.ts` tests behavior that isn't there)                                         | Cross-tenant data leak / 500 / NPE in service. |
| I-2  | A request can never see / mutate data with a `tenantId` different from `req.tenantId` (the multi-tenant boundary).                         | service queries `where: { tenantId }` across the codebase; **843 references** (`CODE_REVIEW.md §3.1`)  | ❌ no canonical cross-tenant test suite (see §10)                                                              | Data exposure / tenant takeover. |
| I-3  | The DTO subdomain pattern matches `SUBDOMAIN_REGEX` and is not in `RESERVED_SUBDOMAINS`.                                                   | `update-tenant-settings.dto.ts:23-29`, `subdomain.const.ts:35`                                          | ❌                                                                                                            | Phishing-vulnerable subdomain, DNS-label-illegal name. |
| I-4  | Subdomain uniqueness is enforced at the DB layer.                                                                                          | `prisma/schema.prisma:21` (`subdomain String? @unique`); P2002 caught at `tenants.service.ts:139-145`  | ❌                                                                                                            | Two tenants own the same QR-menu URL. |
| I-5  | An outgoing subdomain is parked in `ReservedSubdomain` for `SUBDOMAIN_QUARANTINE_DAYS=90` days when a tenant changes it.                   | `tenants.service.ts:126-132` → `reserveSubdomain()` at `subdomain.helper.ts:31-44`                     | ❌                                                                                                            | Subdomain takeover (phishing via printed QR / cached links). |
| I-6  | A subdomain that is parked (or platform-reserved) cannot be claimed by another tenant inside the quarantine window.                        | `tenants.service.ts:113-119` calls `isSubdomainQuarantined()` (`subdomain.helper.ts:15-25`)            | ❌                                                                                                            | Same as I-5. |
| I-7  | A subdomain change is only allowed if the current plan has `customBranding=true`.                                                          | `tenants.service.ts:56-76`                                                                             | ❌ — and the check **crashes with NPE if `currentPlan` is null** (see F-2 / T5)                                | Free-tier tenant claims a Pro feature; or 500 instead of 403. |
| I-8  | A non-ACTIVE tenant cannot mutate its own settings.                                                                                        | `tenants.service.ts:102-104`                                                                           | ❌                                                                                                            | Suspended tenant continues to edit customer-visible state. |
| I-9  | A non-ACTIVE tenant's existing users cannot continue using the API on the next request.                                                    | `jwt.strategy.ts:60-62` (per-request DB re-check of `tenant.status`)                                   | ❌                                                                                                            | Suspended tenant ADMIN keeps operating. *Latency = 0 requests after the next call — but see F-5 for a related write-side gap.* |
| I-10 | A subdomain reservation row that was inserted as part of a failed settings write must be rolled back with the rest of the TX.              | **NOT enforced** at `tenants.service.ts:122-138` — the reservation is inside `$transaction` so it *is* rolled back here, but see §4.3 / F-3 for the takeover-time-of-check race | ❌ | Stale quarantine rows; harmless. |
| I-11 | A SubscriptionPlan deletion cannot leave Tenant rows that still reference it in code that dereferences `currentPlan.<field>`.              | `schema.prisma:87` uses `onDelete: SetNull`; T5 already files this as a finding.                       | ❌                                                                                                            | NPE / 500 across the codebase (the tenants module is one of many call sites). |
| I-12 | `GET /tenants/public` exposes only `{id, name, subdomain}` of `ACTIVE` tenants — never PII or settings.                                    | `tenants.service.ts:42-54` (literal `select` whitelist) + `where: { status: 'ACTIVE' }`                | ❌                                                                                                            | PII / settings leak through public registration helper. |
| I-13 | The DTO rejects payloads where `subdomain` is an empty string (treated as `undefined` so it doesn't accidentally null a Pro subdomain).    | `update-tenant-settings.dto.ts:15` (`@EmptyStringToUndefined()`)                                       | ❌                                                                                                            | Pro tenant accidentally drops its subdomain on a partial PATCH. |
| I-14 | Cross-tenant access via every list/find endpoint returns 403/404 — never 200 with foreign data. (Canonical multi-tenant invariant.)        | distributed across all services; no central enforcer                                                   | ❌ — **this is the missing canonical test** (see §10)                                                          | Data exposure across the platform. |

Invariants are not invented — each is a contract the existing code is already trying to keep, written down so a test can assert it.

---

## 4. State machine

**Status enum:** `prisma/schema.prisma:22` — `String @default("ACTIVE")` with the comment `// ACTIVE, SUSPENDED, DELETED`; mirrored in `backend/src/common/constants/subscription.enum.ts:59-63` as `TenantStatus`.

| From → To          | Trigger                                                                                                          | Guard (`file:line`)                                                                            | Idempotent?                              | Side effects                                                                                                   |
|--------------------|------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| `(none) → ACTIVE`  | tenant created at registration                                                                                   | `auth.service.ts` register flow (out of scope for this file)                                   | n/a                                      | first ADMIN user created                                                                                       |
| `ACTIVE → SUSPENDED` | SuperAdmin `PATCH /superadmin/tenants/:id/status`                                                              | `superadmin-tenants.service.ts:188-242`                                                        | yes — `:204-212` no-ops if status equal | (1) status flip in TX; (2) **if previous status was ACTIVE and subdomain present**, parks subdomain via `reserveSubdomain(tx, subdomain, 'tenant_suspended')` (`:226-241`); (3) audit log; (4) best-effort in-app + email notification to ADMINs (`:275-281`) |
| `ACTIVE → DELETED`   | same path                                                                                                      | same                                                                                           | yes                                      | same as above, with `reason: 'tenant_deleted'`                                                                  |
| `SUSPENDED → ACTIVE` | SuperAdmin reactivation                                                                                        | same                                                                                           | yes                                      | status flip; subdomain is **not** automatically released — it stays in `ReservedSubdomain` until `availableAfter` passes. *That seems intentional — the reactivated tenant can simply set the same subdomain again (idempotent upsert), but a casual reader may be surprised. Worth a comment.* |
| `DELETED → ACTIVE`   | SuperAdmin can flip back via the same endpoint                                                                  | same                                                                                           | yes                                      | same                                                                                                            |
| `SUSPENDED → DELETED`/`DELETED → SUSPENDED` | SuperAdmin                                                                                          | same                                                                                           | yes                                      | subdomain parking only fires when leaving `ACTIVE` (`:232`) — re-parking is a no-op via the upsert in `subdomain.helper.ts:39-43` |

**Forbidden transitions** — not explicitly rejected in code. The SuperAdmin controller takes any of the three string values via DTO; there is no terminal state. `DELETED` is **not** terminal in this codebase — it's reversible. That's worth noting because most platforms treat `DELETED` as a tombstone; this one treats it as a soft-delete flag.

**Subscription state coupling:**
- `Tenant.currentPlanId` references `SubscriptionPlan.id` via `onDelete: SetNull` (`schema.prisma:87`). A plan deletion leaves `currentPlan` null on every tenant that had it — and the tenants module dereferences `currentPlan.customBranding` at `tenants.service.ts:69` (null-safe via `?.` + `?? false`, **so this specific dereference is safe**). The wider concern at `CODE_REVIEW.md §3.4 / T5` is that *other* sites in the codebase may not be null-safe. *Within this file, T5's specific NPE risk is mitigated by the `?.` chain.* See §9 for the spot-check downgrade.
- The subscription state machine itself (TRIAL / ACTIVE / PAST_DUE / CANCELED) is owned by `subscriptions/` and reviewed in `subscriptions.md`.

**Transitions that should be idempotent but aren't** — none observed; the `updateStatus` early-return at `:204-212` handles the no-op case.

**Transitions that should also flip a *user-side* token state but don't** — see F-5.

---

## 5. Money & precision audit

N/A — tenant module has no money path; billing flows live in `subscriptions/` (subscription renewal, payment retries, dunning) and `accounting/` (invoice numbering, accounting sync). The only `Decimal`-typed field in the Tenant graph is `SubscriptionPlan.monthlyPrice / yearlyPrice` (`schema.prisma:685-686`), and the tenants service only ever reads `currentPlan.customBranding` (a boolean).

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `tenants.service.ts:122-138` — settings update + subdomain quarantine wrapped in `prisma.$transaction(async (tx) => …)`. Both writes commit/abort together. ✅
- `superadmin-tenants.service.ts:215-242` — status flip + subdomain quarantine wrapped in `$transaction`. ✅

**Race windows still open:**

1. **Subdomain reservation TOCTOU** (T4 territory from `CODE_REVIEW.md`)
   *Sketch:* Tenant A `PATCH /tenants/settings { subdomain: "burger" }` and Tenant B `PATCH /tenants/settings { subdomain: "burger" }` arrive concurrently. Both pass `isSubdomainQuarantined()` at `tenants.service.ts:116`. Both enter `$transaction`. One commits, the other fails on the `subdomain @unique` constraint (`schema.prisma:21`) and is mapped to a `ConflictException` at `:140-145`. **Outcome: safe** — the DB unique constraint is the actual enforcer, not the pre-check. The pre-check at `:113-119` is a UX optimization, not the security boundary.
   *Where:* `tenants.service.ts:113-119` vs `:133-137`.
   *Severity:* Low (Cor) — pre-check is racy but the DB catches it; the user gets `409 Conflict` either way.
   *Fix:* none required; document that the unique constraint is the canonical enforcer. If you want to eliminate the brief P2002-style 409 leak (which is fine), retry-with-suffix at the boundary.

2. **Quarantine-release-then-reclaim race**
   *Sketch:* Tenant A's reservation expires at `availableAfter = now`. Tenant B does `PATCH /tenants/settings { subdomain: A_old_subdomain }`. The `isSubdomainQuarantined()` check at `:113-119` reads the same row as `where: { subdomain: normalized }` — there is no `FOR UPDATE`. If at the same instant a cleanup job (none exists today — the `ReservedSubdomain` table is **not garbage-collected**, see F-6) tried to bump `availableAfter`, you'd get a torn read. Today this is theoretical because nothing else touches the row.
   *Where:* `subdomain.helper.ts:21-24`.
   *Severity:* Info — currently unreachable; flag as a hazard if a cleanup/extension job is added.

3. **Reservation cleanup on outer TX rollback (§4.3 row)**
   *Sketch:* Inside `tenants.service.ts:123-138`'s `$transaction`, `reserveSubdomain` writes to `ReservedSubdomain` and then `tenant.update` writes to `Tenant`. If `tenant.update` throws (e.g., DB constraint, connection blip), Prisma rolls back the transaction *including* the reservation upsert. **Outcome: safe within this file** — `$transaction(async (tx) => …)` with the same `tx` for both writes does roll back atomically. The CODE_REVIEW.md §4.3 row reads "Subdomain reservation row not cleaned up if the surrounding TX rolls back" — re-reading the current implementation, the reservation is *inside* the same TX, so it is rolled back. **Downgrade**: see §9.
   The residual concern is the *upsert semantics* of `reserveSubdomain()` (`subdomain.helper.ts:39-43`): on `update` the helper sets `reservedAt: new Date()` and bumps `availableAfter`. If the outer TX rolls back, both fields revert — fine. But if a different code path (e.g., the superadmin status flow at `superadmin-tenants.service.ts:234-240`) reserves the same subdomain *outside* this TX, the two-write order matters. Out of scope for this file; mentioned in §9 of `superadmin.md` when that file lands.

4. **TenantGuard ordering — defense-in-depth gap (T4)**
   *Sketch:* `tenants.controller.ts:38, 48` decorates handlers with `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)`. The current chain populates `req.tenantId` correctly. If a future refactor *(a) removes `TenantGuard`, (b) reorders to put `RolesGuard` before `TenantGuard`, or (c) switches to a different guard pattern*, `req.tenantId` would be `undefined` and `tenantsService.findSettings(undefined)` would call `prisma.tenant.findUnique({ where: { id: undefined } })` — which Prisma rejects with a runtime error, so no data leaks, but the failure mode is a 500 not a 403. **Outcome: safe today, brittle for future maintenance.**
   *Where:* `tenants.controller.ts:43, 54`.
   *Severity:* Low (Sec) — already downgraded High → Low in `CODE_REVIEW.md §2 / T4`.
   *Fix:* one-line `if (!req.tenantId) throw new ForbiddenException()` in each handler, or a `@CurrentTenantId()` param decorator that throws on undefined.

**Idempotency keys:**
- `PATCH /tenants/settings` is naturally idempotent because every field is a "set to value X" update. No idempotency key needed.
- `reserveSubdomain()` uses `upsert` (`subdomain.helper.ts:39-43`), which is idempotent by primary-key.
- The state-transition path at `superadmin-tenants.service.ts:204-212` early-returns for `previousStatus === updateDto.status`, so SuspendTenant is safe to retry.

---

## 7. Findings

Verified findings unmarked; unverified flagged `*(unverified)*` with the line they came from. Severity scale: Critical → High → Medium → Low → Info. Dimension: Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/quality) · Perf (performance/reliability).

| ID  | Sev    | Dim  | Location                                                                                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fix |
|-----|--------|------|-----------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----|
| F-1 | Low    | Sec  | `tenants.controller.ts:43, 54` (T4 from CODE_REVIEW.md §2, **verified, downgraded High→Low**) | Handlers pass `req.tenantId` to the service. They're gated by `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` — `TenantGuard` at `tenant.guard.ts:17-22` populates `req.tenantId` from `user.tenantId` or returns `false`. **Under current wiring this is safe.** Defense-in-depth only: an explicit `if (!req.tenantId) throw new ForbiddenException()` would catch a future refactor that breaks the guard chain. | Add the explicit guard in the handler, or a `@CurrentTenantId()` parameter decorator that throws when missing.   |
| F-2 | Medium | Cor  | `tenants.service.ts:64-69` (T5 from CODE_REVIEW.md §2, **partial — verified-in-this-file**) | T5 reads: "`tenant.currentPlan.customBranding` … `currentPlan` can be null (FK is `SetNull`) → NPE → 500 instead of 403." Re-reading: the dereference is `tenantWithPlan?.currentPlan?.customBranding ?? false` — null-safe. The **NPE risk at this site is mitigated**; the wider risk that *other* callers across the codebase don't null-guard remains (T5 still applies to those callers — flagged separately in `CODE_REVIEW.md §3.4`). **Downgrade for this file only**: High → Medium, and the actual finding is "behaviorally correct, but the `?? false` silently downgrades a `null` plan to "no Pro features", which is the right policy *only* if no-plan == no-Pro is the platform's intent. Add a comment so a future reader doesn't 'fix' it to throw." | Comment-only — or, if you want to differentiate "trial w/ no plan" from "expired w/ null plan", branch on `tenantWithPlan` itself. |
| F-3 | Low    | Arch | `tenants.service.ts:122-138` (§4.3 row from CODE_REVIEW.md, **partial — see §9**)        | §4.3 reads: "Subdomain reservation row not cleaned up if the surrounding TX rolls back." Re-reading: the reservation upsert *is* inside the same `$transaction` via the `tx` parameter, so it rolls back with the outer write. The narrower remaining gap: `reserveSubdomain` is a generic helper used in two places (`tenants.service.ts:131` and `superadmin-tenants.service.ts:234`) — if a future caller invokes it *outside* a TX (e.g., as a best-effort post-commit hook), rollback semantics break. | Add a runtime assertion to `reserveSubdomain` that the passed client is `Prisma.TransactionClient`, or rename to `reserveSubdomainTx`. |
| F-4 | Medium | Cor  | `tenant.guard.spec.ts:1-57`                                                              | The spec tests behavior the guard **no longer has**: it expects `ForbiddenException` when `params.tenantId !== user.tenantId` (`:41-47`) and when `user` has no `tenantId` (`:49-55`). The current `TenantGuard` (`tenant.guard.ts:14-25`) does *not* read `params`, does *not* throw — it returns `false` when `user.tenantId` is missing. The constructor signature also diverges: the spec calls `new TenantGuard()` (`:22`) but the real constructor takes a `Reflector` (`tenant.guard.ts:7`). **The spec almost certainly does not compile against current code, or has been silently skipped.** | Rewrite the spec to test the actual contract: (a) `@Public()` short-circuits; (b) no `user` → `false`; (c) `user.tenantId` missing → `false`; (d) happy path injects `req.tenantId`. |
| F-5 | Medium | Sec  | `superadmin-tenants.service.ts:215-242` (cross-module — kept here because it's the *tenant* lifecycle gap) | When a SuperAdmin flips a tenant to `SUSPENDED` or `DELETED`, the TX flips `status` and quarantines the subdomain — but it does **not** (a) bump `tokenVersion` on the tenant's users, (b) revoke their `RefreshToken` rows, or (c) close their WebSocket connections. The next request from a logged-in ADMIN does get rejected because `jwt.strategy.ts:60-62` re-checks `tenant.status` per request, so **the window is ≤ one request, not the JWT TTL**. However, an open WebSocket (`kds.gateway.ts` etc.) stays connected, and a refresh token issued before suspension is still valid against the tenant-status check (the JWT strategy gates access tokens; refresh tokens are not gated on tenant status at the refresh endpoint — verify). | On suspend/delete: also bump `tokenVersion` for all users of the tenant (single `updateMany`), revoke `RefreshToken` rows (`refresh_tokens` with `userId IN (...)`), and emit a "tenant suspended" event the gateways can subscribe to for forced disconnect. |
| F-6 | Low    | Arch | `subdomain.helper.ts:31-44` + `schema.prisma:168-177`                                    | `ReservedSubdomain` rows are never garbage-collected. After 90 days the `availableAfter` window passes and `isSubdomainQuarantined()` correctly returns `false` (`:24`), but the row stays in the table indefinitely. Not a defect — just unbounded growth at platform scale (one row per ever-released subdomain). | Add a daily cron job (advisory-locked, per `CODE_REVIEW.md §3.3` pattern) that deletes rows where `availableAfter < now() - INTERVAL '30 days'`. |
| F-7 | Low    | Sec  | `tenants.service.ts:42-54` + `tenants.controller.ts:29-35`                                | `GET /tenants/public` returns `{id, name, subdomain}` for every ACTIVE tenant. The whitelist itself is safe (no PII), but the endpoint **has no throttle and no auth**. An attacker can enumerate every active restaurant on the platform — useful for targeted phishing of restaurant owners with branded subdomains. Compare with `qr-menu.controller.ts:17` which does throttle `by-subdomain` at 60 req/min. | Add `@Throttle({ default: { limit: 30, ttl: 60_000 } })`. If the registration-flow consumer is the only legitimate caller, consider gating by `Marketing` or `Public-Stats` auth. |
| F-8 | Low    | Cor  | `tenants.service.ts:91-148` (`updateSettings`)                                            | If the DTO comes in with `subdomain: null`, the flow at `:106-120` enters the `updateDto.subdomain !== undefined` branch, calls `validateSubdomainChangePermission(... null)` which early-returns at `:62` (`if (!newSubdomain) return`), then the `if (updateDto.subdomain && ...)` quarantine check at `:113` short-circuits, then the TX at `:127-131` only quarantines when both old and new are truthy — so `null` is silently allowed. **This is fine if a tenant should be able to *drop* its subdomain**, but the surrounding code (DTO comment `subdomain?: string \| null`, `EmptyStringToUndefined` transform, the Pro-only check) makes the policy ambiguous. | Decide: (a) tenants may drop subdomain freely, OR (b) dropping requires `customBranding` like setting does. Document at `:56-76`. Currently (a) is the implicit behavior. |
| F-9 | Info   | Arch | `tenants.service.ts:122-148` error handling                                              | `P2002` catch at `:139-145` collapses *every* unique-constraint violation into `'Subdomain already in use'`. Today the only unique constraint touched by `updateSettings` is `Tenant.subdomain` (`schema.prisma:21`), so the message is accurate — but if a future migration adds, say, `@@unique([tenantId, reportEmail])`, the error message becomes misleading. | Inspect `err.meta?.target` and branch — or move to `Prisma.PrismaClientKnownRequestError.code === 'P2002'` with a target-aware mapper helper. |

> **Severity notes:** the absence of `Critical` / `High` rows reflects the actual current state of the module, not under-counting. T4 and the §4.3 row were *both* downgraded after end-to-end verification (see §9). The module is in the position other features should aspire to: the boundary guard chain works, the data model encodes the right uniqueness/quarantine, and the DTO surface is conservative.

---

## 8. What's solid (positive findings)

- **`tenants.controller.ts:38, 48`** — `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` chain is the canonical order: authenticate → populate tenant → check role. **Verified in §4.3 of CODE_REVIEW.md.** Every tenant-scoped controller should mirror this exact order. The 843 `tenantId` references across the codebase (`CODE_REVIEW.md §3.1`) ride on this populating step working — it does.
- **`jwt.strategy.ts:60-62`** — per-request DB re-check of `tenant.status`. This is what makes F-5 *not* a session-lifetime hole: the access-token-side gate catches a suspended tenant on the very next call. Pattern to keep.
- **`tenants.service.ts:69`** — `tenantWithPlan?.currentPlan?.customBranding ?? false` is the right way to consume an `onDelete: SetNull` relation. Other consumers of `currentPlan.*` should copy this pattern (T5 in `CODE_REVIEW.md` is about callers that don't).
- **`subdomain.helper.ts:31-44`** — `reserveSubdomain()` uses `upsert` with explicit `availableAfter` math, accepts both `PrismaClient` and `Prisma.TransactionClient` (`:8`), and normalises to lowercase. Clean primitive.
- **`subdomain.const.ts:5-29`** — `RESERVED_SUBDOMAINS` includes platform-level aliases (`www`, `api`, `admin`, `staging`, `login`, `auth`, `cdn`, `assets`, `dashboard`…). Defends against an attacker registering `admin.yourapp.com` and serving lookalike content.
- **`tenants.service.ts:42-54`** — `findAllPublic()` uses a literal `select` whitelist instead of `omit` or relying on the DTO layer to strip fields. No PII can accidentally leak through a future schema migration.
- **`update-tenant-settings.dto.ts:15-30`** — `@EmptyStringToUndefined()` + `@ValidateIf((o) => o.subdomain !== null)` is the right way to allow "set", "clear" (`null`), and "don't touch" (`undefined`) in one PATCH endpoint without ambiguity. The DTO is conservative across all 17 fields (length caps, enum-only currency, lat/lng bounds).
- **`superadmin-tenants.service.ts:215-242`** — status flip + subdomain quarantine inside a single `$transaction`, with the no-op early-return at `:204-212`. The kind of atomic state transition other lifecycle ops should follow.
- **`tenants.service.ts:102-104`** — explicit `tenant.status !== 'ACTIVE'` gate on writes, with a comment explaining why (`// A suspended/deleted tenant must not be able to keep editing…`). Defense-in-depth even though `jwt.strategy.ts` already gates per-request.

---

## 9. Spot-checks performed

**Verified:**
- **F-1 / T4** — verified `tenants.controller.ts:38, 48` shows `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)`; verified `tenant.guard.ts:17-22` returns `false` if `!user.tenantId` and sets `request.tenantId = user.tenantId`. Conclusion: **safe today, defense-in-depth gap only**. Documented at `CODE_REVIEW.md §11.1` (severity downgrade #6).
- **F-4** — opened `tenant.guard.spec.ts` and the actual `tenant.guard.ts` side by side. Spec calls `new TenantGuard()` (no `Reflector`); real guard requires one (`:7`). Spec expects `throw ForbiddenException`; real guard `return false`. **Spec is stale.**
- **State machine** — verified `superadmin-tenants.service.ts:188-242` is the only path that mutates `Tenant.status`, and that the no-op early-return at `:204-212` makes status flips idempotent.
- **I-9 (per-request tenant-status gate)** — verified at `jwt.strategy.ts:60-62`.
- **I-1 (req.tenantId population)** — verified at `tenant.guard.ts:22`.
- **I-8 (suspended-tenant write gate)** — verified at `tenants.service.ts:102-104`.

**Dropped (initial report was wrong / superseded):**
- **F-3 / §4.3 "reservation not cleaned up on rollback"** — verified at `tenants.service.ts:122-138`. The reservation upsert *is* inside the same `$transaction` via the `tx` parameter; Prisma rolls back both writes atomically. **Drop the original framing.** The narrower residual concern (callers using the helper outside a TX) is kept as F-3 at Low severity.
- **T5's NPE risk at this exact site** — verified at `tenants.service.ts:69`. The dereference is `tenantWithPlan?.currentPlan?.customBranding ?? false` — null-safe via optional chaining. **The NPE-risk framing of T5 does not apply to this call site**, though T5 remains valid for *other* `currentPlan.*` dereferences in the codebase. Local downgrade to F-2 / Medium-Cor as a "policy clarity" finding.

**Downgraded:**
- **F-1 (T4)** — severity dropped from **High → Low** because the guard chain is intact under current wiring and the failure mode of a future refactor would be a Prisma runtime error (500), not data exposure. Documented in `CODE_REVIEW.md §11.1`.
- **F-2 (T5 at this site)** — severity dropped from **High → Medium** because `?.` + `?? false` already null-guards.
- **F-3 (§4.3 row at this site)** — severity dropped from **Medium → Low** because the reservation is already inside the same TX.

---

## 10. Recommended tests

This is the canonical home for the cross-tenant invariants suite called out in `CODE_REVIEW.md §3.1`. The tenants module is the *boundary* — if its tests don't catch a cross-tenant leak, nothing else will.

```ts
// backend/test/cross-tenant.e2e-spec.ts (NEW — canonical isolation suite)
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('cross-tenant isolation invariants (I-14)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Two ACTIVE tenants, each with its own ADMIN, MANAGER, products,
  // categories, tables, orders, customers, stock items.
  let tenantA: { id: string; adminToken: string };
  let tenantB: { id: string; adminToken: string };

  beforeAll(async () => {
    // ... bootstrap two tenants via /auth/register; capture access tokens
  });

  afterAll(async () => {
    await app.close();
  });

  // Endpoints that take a tenant-scoped LIST result (must filter by req.tenantId).
  // For each: tenant-A token must NEVER see tenant-B data.
  const listEndpoints = [
    'GET  /tenants/settings',          // tenants module
    'GET  /orders',                    // orders module
    'GET  /orders/group-bill-summary', //   ↑
    'GET  /products',                  // menu module
    'GET  /categories',                //   ↑
    'GET  /tables',                    // tables module
    'GET  /reservations',              // reservations module
    'GET  /customers',                 // customers module
    'GET  /stock/items',               // stock-management module
    'GET  /stock/movements',           //   ↑
    'GET  /stock/recipes',             //   ↑
    'GET  /personnel/users',           // personnel module
    'GET  /personnel/schedule',        //   ↑
    'GET  /reports/z-reports',         // z-reports module
    'GET  /accounting/sales-invoices', // accounting module
    'GET  /subscriptions/current',     // subscriptions module
    'GET  /notifications',             // notifications module
    'GET  /analytics/heatmap',         // analytics module
    'GET  /delivery-platforms/configs',// delivery-platforms module
    'GET  /delivery-platforms/orders', //   ↑
    'GET  /integrations',              // settings/integrations module
    'GET  /modifiers',                 // modifiers module
    'GET  /layouts',                   // layouts module
  ];

  it.each(listEndpoints)(
    '%s — tenant-A response contains zero rows with tenantId === tenantB.id',
    async (endpoint) => {
      const [method, path] = endpoint.split(/\s+/);
      const res = await request(app.getHttpServer())
        [method.toLowerCase()](path)
        .set('Authorization', `Bearer ${tenantA.adminToken}`);
      expect(res.status).toBeLessThan(400);
      const rows = Array.isArray(res.body) ? res.body : (res.body.data ?? []);
      const leaked = rows.filter((r: any) => r.tenantId === tenantB.id);
      expect(leaked).toEqual([]);
    },
  );

  // Endpoints that take an entity-id path param. Tenant-A token requesting
  // tenant-B's entity must return 403 or 404 — never 200.
  const findEndpoints = [
    { method: 'GET',   pathFor: (id: string) => `/orders/${id}`,         createFor: 'order' },
    { method: 'PATCH', pathFor: (id: string) => `/orders/${id}`,         createFor: 'order' },
    { method: 'DELETE',pathFor: (id: string) => `/orders/${id}`,         createFor: 'order' },
    { method: 'GET',   pathFor: (id: string) => `/products/${id}`,       createFor: 'product' },
    { method: 'GET',   pathFor: (id: string) => `/tables/${id}`,         createFor: 'table' },
    { method: 'GET',   pathFor: (id: string) => `/customers/${id}`,      createFor: 'customer' },
    { method: 'GET',   pathFor: (id: string) => `/stock/items/${id}`,    createFor: 'stockItem' },
    { method: 'GET',   pathFor: (id: string) => `/reservations/${id}`,   createFor: 'reservation' },
    { method: 'GET',   pathFor: (id: string) => `/notifications/${id}`,  createFor: 'notification' },
    { method: 'GET',   pathFor: (id: string) => `/accounting/sales-invoices/${id}`, createFor: 'salesInvoice' },
    // ... extend with every entity in §3 I-14
  ];

  it.each(findEndpoints)(
    '$method $createFor — tenant-A cannot read tenant-B entity',
    async ({ method, pathFor, createFor }) => {
      const tenantBEntityId = await createInTenantB(prisma, createFor);
      const res = await request(app.getHttpServer())
        [method.toLowerCase()](pathFor(tenantBEntityId))
        .set('Authorization', `Bearer ${tenantA.adminToken}`);
      expect([403, 404]).toContain(res.status);
      expect(res.body.tenantId).toBeUndefined();
    },
  );
});
```

```ts
// backend/src/modules/tenants/__tests__/tenants.integration.spec.ts (NEW)
describe('tenants invariants — subdomain & lifecycle', () => {
  it('I-5 subdomain change parks the outgoing subdomain in ReservedSubdomain for 90 days', async () => {
    // arrange: tenant with subdomain="burger", customBranding plan
    // act: PATCH /tenants/settings { subdomain: "burger-grill" }
    // assert:
    //   - DB: reserved_subdomains row exists with subdomain="burger",
    //         reason="subdomain_changed", availableAfter ≈ now + 90d
    //   - DB: tenants.subdomain === "burger-grill"
    //   - second tenant trying to claim "burger" gets 409 from
    //     isSubdomainQuarantined() until availableAfter passes
  });

  it('F-3 subdomain quarantine is rolled back if the tenant.update fails inside the TX', async () => {
    // arrange: monkeypatch prisma.tenant.update to throw mid-tx
    // act: PATCH /tenants/settings { subdomain: "x", currency: "BAD" /* triggers DB error */ }
    // assert:
    //   - response is 5xx
    //   - DB: tenants.subdomain unchanged
    //   - DB: reserved_subdomains has NO row for the old subdomain
    //     (rollback included the reservation upsert)
  });

  it('F-2 / T5 null-plan: a tenant with currentPlan=null gets 403, not 500, when changing subdomain', async () => {
    // arrange: tenant with currentPlanId=null (simulate SetNull after plan delete)
    // act: PATCH /tenants/settings { subdomain: "anything" }
    // assert: response.status === 403, message mentions Pro / customBranding
    //         (today the ?. + ?? false makes this pass; the test pins it down)
  });

  it('I-8 SUSPENDED tenant cannot PATCH /tenants/settings', async () => {
    // arrange: flip tenant status to SUSPENDED via superadmin path
    // act: PATCH /tenants/settings with the still-cached pre-suspension token
    // assert: 401 from jwt.strategy:60-62 (per-request tenant-status check)
    //   — and a fresh login also rejects via auth.service.ts:437
    //   — and even if the token check passes (e.g., bypassed test), the
    //     service layer at tenants.service.ts:102-104 throws 403.
  });

  it('I-7 free-plan tenant gets 403 when setting subdomain', async () => {
    // arrange: tenant on FREE plan (customBranding=false)
    // act: PATCH /tenants/settings { subdomain: "x" }
    // assert: 403, message mentions Pro feature.
  });

  it('I-13 empty string for subdomain is treated as "do not touch"', async () => {
    // arrange: tenant with subdomain="burger"
    // act: PATCH /tenants/settings { subdomain: "" }
    // assert: 200, DB tenants.subdomain still "burger"
  });

  it('I-12 GET /tenants/public exposes only id/name/subdomain of ACTIVE tenants', async () => {
    // arrange: tenants in (ACTIVE, SUSPENDED, DELETED) states
    // act: GET /tenants/public (no auth)
    // assert: only ACTIVE rows; each row has exactly {id, name, subdomain};
    //         no email, phone, currency, lat/lng leak.
  });

  it('F-7 GET /tenants/public is rate-limited', async () => {
    // act: hammer GET /tenants/public > limit
    // assert: 429 after the threshold
    // (currently FAILS — no throttle decorator at tenants.controller.ts:29)
  });
});
```

```ts
// backend/src/modules/auth/__tests__/tenant-suspension.integration.spec.ts (NEW)
describe('cross-link to auth.md — suspended-tenant ADMIN login rejection', () => {
  it('a fresh login attempt for an ADMIN of a SUSPENDED tenant returns 401', async () => {
    // arrange: ACTIVE tenant T with ADMIN u; flip T to SUSPENDED.
    // act: POST /auth/login { email: u.email, password }
    // assert: 401 with message "Your restaurant account is not active"
    //         (auth.service.ts:437)
  });

  it('F-5 a logged-in ADMIN sees the next request rejected after their tenant is SUSPENDED', async () => {
    // arrange: u logged in, has valid access token; SuperAdmin suspends T
    // act: GET /orders with the cached access token
    // assert: 401 from jwt.strategy:60-62 on the very next call
    //   (proves I-9 — the per-request DB re-check makes the window ≤ 1 request)
  });

  it('F-5 refresh tokens are revoked when a tenant is suspended', async () => {
    // arrange: u logged in; capture refresh-token cookie
    // act: superadmin suspends T; POST /auth/refresh with that cookie
    // assert: 401 (currently MAY FAIL — refresh endpoint doesn't re-check
    //   tenant status; see F-5 fix recommendation.)
  });
});
```

```ts
// backend/src/modules/auth/guards/tenant.guard.spec.ts (REWRITE — F-4)
describe('TenantGuard', () => {
  it('@Public() routes are short-circuited (shouldBypassGlobalAuth returns true)', () => { ... });
  it('returns false when user has no tenantId', () => { ... });
  it('returns true and sets request.tenantId when user.tenantId is present', () => { ... });
  it('does NOT inspect params (verifies the current behavior — no path-param check)', () => { ... });
});
```

**Coverage priorities:**
1. The `cross-tenant.e2e-spec.ts` suite is the **single highest-leverage hardening test** in this codebase. The 843 `tenantId` references mean the boundary is enforced in 843 places — but no test verifies it from outside.
2. The `F-4` spec rewrite is a 30-min job that prevents the guard from silently breaking.
3. The `F-3` rollback test pins down the §4.3 row so it doesn't drift on future refactor.

---

*End of `tenants.md`. Tied back to `CODE_REVIEW.md §2 T4/T5` and `§4.3`. Next adjacent files: `auth.md` (token lifecycle, suspended-tenant login gate), `superadmin.md` (the lifecycle endpoint that flips status), `prisma-schema.md` (the `onDelete: SetNull` choice on `Tenant.currentPlan`).*
