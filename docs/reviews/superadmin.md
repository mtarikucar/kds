# `superadmin` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/superadmin/`
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §2 (A3, A4) + §4.4 (refresh race, tempToken audit, initial-seed race)

---

## 1. Health & summary

🟡 yellow

`superadmin` owns the highest-privilege identity in the product: platform operators who can suspend tenants, mutate plans, extend subscriptions, and read cross-tenant data. The TOTP core (replay-locked steps at `superadmin-auth.service.ts:99-118`, SHA-256-hashed one-shot backup codes at `:140-152`, separate JWT secret enforced at `superadmin.module.ts:38-52`, bcrypt timing-normalization at `superadmin-auth.service.ts:165-171`, mandatory-2FA gate at `:207-219`, replay-protected secret promotion via `pendingTwoFactorSecret` at `:312-394`) is the cleanest auth code in the repo and should be the template for tenant 2FA when it ships. The risk concentrates in the **state-machine edges** that bound the TOTP core: failed-login counter resets too early (A3 — verified), `regenerateBackupCodes` admits null secret implicitly (A4 — verified), refresh issues new tokens **without rotating `tokenVersion`** so an arbitrary number of concurrent refreshes succeed (verified — worse than seed described), `createInitialSuperAdmin` is not idempotent (verified), and the `verify-2fa` HTTP body containing the `tempToken` is not in `DetailedRequestLoggerMiddleware`'s redaction allow-list (verified — the seed misattributed this to the audit log, see §9). No findings rise to Critical because every gap requires either privileged access already, a coincident multi-instance seed, or a network log capture. None of the verified items will appear in production as exploits today, but each one is the kind of latent property the audit will surface when 2FA usage broadens.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/superadmin/services/superadmin-auth.service.ts` (643 LOC) — login, 2FA setup/enable/disable, backup-code regen, refresh, logout, initial seed.
- `backend/src/modules/superadmin/services/superadmin-audit.service.ts` (200 LOC) — `AuditLog` row writer + CSV/JSON export with CSV-injection escaping.
- `backend/src/modules/superadmin/services/superadmin-tenants.service.ts` (663 LOC) — tenant status flips, plan/feature/limit overrides, status notifications.
- `backend/src/modules/superadmin/services/superadmin-subscriptions.service.ts` (467 LOC) — plan CRUD, subscription extend/cancel/update with downgrade-guard.
- `backend/src/modules/superadmin/services/superadmin-users.service.ts` (204 LOC) — cross-tenant user listing + activity.
- `backend/src/modules/superadmin/controllers/superadmin-auth.controller.ts` (130 LOC) — throttle budgets + `@SuperAdminPublic` boundaries.
- `backend/src/modules/superadmin/guards/superadmin.guard.ts` (97 LOC) — JWT verify + `tokenVersion` DB recheck per request.
- `backend/src/modules/superadmin/superadmin.module.ts` (84 LOC) — JWT module wiring with secret-length / secret-collision validation.
- `backend/prisma/schema.prisma:1739-1799` — `SuperAdmin`, `AuditLog` models.

**Skimmed only:**
- `services/superadmin-dashboard.service.ts` (307 LOC) — read-only aggregations; no business-logic invariants beyond pagination.
- `controllers/superadmin-{audit,dashboard,subscriptions,tenants,users}.controller.ts` — thin pass-throughs gated by `SuperAdminGuard`.
- `dto/*.ts` — `class-validator` shape only; the meaningful guards re-validate in the service (verified at `superadmin-subscriptions.service.ts:359-361`).
- `decorators/{current-superadmin,superadmin}.decorator.ts` — metadata wrappers.

**Skipped:**
- `backend/src/common/middleware/request-logger.middleware.ts` was opened only to verify whether `tempToken` reaches log sinks (it does, on `verify-2fa`; see §7).

---

## 3. Business-logic invariants

Each row is testable — an integration test could assert it.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | A superadmin row can never become "authenticated" without `twoFactorEnabled === true`. | `superadmin-auth.service.ts:207-219` (login refuses), `:263-265` (verify-2fa refuses) | ❌ none | password-only access to platform-wide controls. |
| I-2 | `failedLogins` must reset only after the **full** login flow (password + 2FA) completes, not after password alone. | `superadmin-auth.service.ts:221-224` (currently resets pre-2FA — A3) | ❌ none | brute-force counter never trips because each password-correct attempt resets it; lockout (5 fails → 30 min at `:190-194`) becomes inert. |
| I-3 | TOTP step is single-use within the replay-lock window. | `:103-110, 112-118` | ❌ none | sniffed code reusable within the ~90s window. |
| I-4 | A used backup code is irrevocably burned. | `:122-138` (filter-out before returning true) | ❌ none | recovery code becomes infinite-use 2FA bypass. |
| I-5 | `regenerateBackupCodes` rejects when `twoFactorSecret` is null. | `superadmin-auth.service.ts:468-470, 471-481` — **only checks `twoFactorEnabled`**, then passes `twoFactorSecret` (possibly null) to `verifyTotp`. `verifyTotp` returns `false` when secret is null (`:88-89`), so the path returns 400 — the invariant **does hold by accident**, not by the explicit check the seed (A4) calls for. | ❌ none | none in current code, but a refactor that changes the `verifyTotp` null-handling branch silently re-opens the door. |
| I-6 | `enable2FA` promotes `pendingTwoFactorSecret` → `twoFactorSecret` only after a TOTP from the **pending** secret verifies. | `:357-369, 373-382` | ❌ none | attacker could swap a victim's secret for their own. |
| I-7 | Refresh-token rotation: a refresh-token-on-use must invalidate the prior refresh token (one-shot rotation). | `:522-548` — **violated**; `generateTokens` never increments `tokenVersion`, so the prior refresh stays valid for its 7-day TTL. | ❌ none | session can be silently cloned across attacker + victim. |
| I-8 | Initial-superadmin seed is idempotent (running the seed script twice does not create two rows, error out destructively, or partially mutate state). | `:609-612` — only checks count, then creates; race window between `count()` and `create()` is open. The `@unique` on `email` saves correctness if the same email is used; with different emails on two concurrent runs, two SAs land. | ❌ none | two initial SAs with full powers, or transient 500 on legitimate retry. |
| I-9 | Audit log row must not contain plaintext credentials (passwords, TOTP codes, backup codes, JWT secrets, JWT tokens, refresh tokens, tempTokens). | `superadmin-audit.service.ts:41-56` + every `auditService.log({...})` callsite. Verified: `superadmin-auth.service.ts:208-215, 292-299, 384-391, 449-456, 509-516` log only `{ip, userAgent, backupCodeUsed, reason}` and a `newData` boolean. **Invariant holds in the audit table.** (The seed claim that "controller :44-49 writes tempToken to audit" is incorrect — see §9.) | ❌ none | hot table containing secrets; export-to-CSV would leak. |
| I-10 | `verify-2fa` request body (`tempToken` + `code`) is not written to HTTP-request logs in plaintext. | **Violated** at `common/middleware/request-logger.middleware.ts:125-136` — `shouldLogBody` allow-list contains `/auth/login` (matches `/superadmin/auth/login` via substring) but NOT `/auth/verify-2fa`. Body logs include the tempToken in cleartext for the lifetime of the log retention. | ❌ none | log-store reader can replay 2FA on captured tempToken within its 10-min TTL (`:234`). |
| I-11 | TOTP verification uses a constant-time comparator. | `speakeasy.totp.verifyDelta` at `:91-96`. `speakeasy` derives + compares HMAC digests; comparison is `string ===`, not `crypto.timingSafeEqual`. Practical timing exposure is small because TOTP codes are 6 digits, but the invariant the seed asks for ("constant-time compare") is **not strictly held**. Information leak: at most ~6 character positions of a 6-digit code. | ❌ none | theoretical timing oracle on TOTP digit positions; negligible in practice given throttle (5/min at controller `:30`). |
| I-12 | Backup codes are never persisted in plaintext; only SHA-256 hashes are stored. | `:140-152` (hash on generate), `:131-136` (filter by hash on burn). | ❌ none | DB dump = bypass 2FA. |
| I-13 | A `pendingTwoFactorSecret` cannot be promoted by anyone other than the owning superadmin within an authenticated session. | `:312-369` runs under `SuperAdminGuard` (`controller:65-81`). | ❌ none | privilege escalation via 2FA hijack. |
| I-14 | `tokenVersion` bump invalidates all live access **and** refresh tokens on the next request. | Access path: `guards/superadmin.guard.ts:79-81`. Refresh path: `superadmin-auth.service.ts:543-545`. | ❌ none | logout / password-change / 2FA-change all rely on this; if either path breaks, revocation latency = JWT TTL. |
| I-15 | Tenant downgrade via SA path cannot silently leave the tenant over plan-limits. | `superadmin-subscriptions.service.ts:266-294` | ❌ none | tenant invisibly over-quota; next quota-checked write fails confusingly. |
| I-16 | Tenant status change is atomic with subdomain quarantine. | `superadmin-tenants.service.ts:215-243` (`$transaction` wraps status flip + `reserveSubdomain`). | ❌ none | suspended tenant's subdomain re-claimable by a phisher between TX steps. |
| I-17 | Plan deletion is forbidden when active subscriptions reference it. | `superadmin-subscriptions.service.ts:139-147` | ❌ none | dangling FK + null `currentPlan` (linked-fault: T5 in CODE_REVIEW.md). |
| I-18 | Subscription extension days are bounded `[1, 3650]` even if the DTO drifts. | `superadmin-subscriptions.service.ts:359-361` | ❌ none | accidental 10-year free extension on a typo. |
| I-19 | CSV audit-log exports cannot inject formulas via attacker-controlled tenant name / email. | `superadmin-audit.service.ts:17-22` (`escapeCsvCell` prefixes `=+-@\t\r` rows with `'`). | ❌ none | spreadsheet RCE on operator workstation. |
| I-20 | The login response for an unknown email runs a dummy bcrypt to flatten timing. | `:165-171` | ❌ none | enumeration primitive on the SA email set (tiny population). |
| I-21 | Login refuses when account is locked or status != ACTIVE before bcrypt. | `:173-184` | ❌ none | wasted bcrypt CPU; (security: fine) timing leak that account is locked vs inactive. |

---

## 4. State machine

### 4.1 Superadmin authentication FSM (per-request, per-account)

**States** (derived from `SuperAdmin` row + held tokens):

| State | Held by | DB shape |
|---|---|---|
| `NO_ACCOUNT` | — | row absent |
| `LOCKED_OUT` | account | `lockedUntil > now` (`:173-180`) |
| `INACTIVE` | account | `status !== 'ACTIVE'` (`:182-184`) |
| `NEEDS_PASSWORD` | session | no token / expired |
| `NEEDS_2FA` | session | holds `tempToken` (`type:'superadmin-2fa-pending'`, 10-min TTL `:226-236`) |
| `AUTHENTICATED` | session | access token (`type:'superadmin'`, 1h `:562-569`) + refresh (`type:'superadmin-refresh'`, 7d `:570-577`) |

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `NEEDS_PASSWORD → NEEDS_PASSWORD` | bad password | `:186-200` | no — increments `failedLogins`, may set `lockedUntil` | counter write |
| `NEEDS_PASSWORD → LOCKED_OUT` | 5th bad password | `:190-194` | no | `lockedUntil = now + 30m` |
| `NEEDS_PASSWORD → NEEDS_2FA` | correct password + `twoFactorEnabled` | `:186, 207` | no — **also resets `failedLogins=0` at `:221-224` (A3 — too early)** | mints `tempToken` (10m), writes counter reset |
| `NEEDS_PASSWORD → 403 ForbiddenException` | correct password + `!twoFactorEnabled` | `:207-219` | yes | audit row (`reason: '2fa_not_enabled'`) |
| `NEEDS_2FA → AUTHENTICATED` | correct TOTP or unused backup code | `:267-285` | no | `lastLogin`, `lastLoginIp`, audit row, TOTP step write or backup-code burn |
| `NEEDS_2FA → NEEDS_2FA` | bad code | `:283-285` (401) | yes | none — **no `failedLogins` increment on bad 2FA; brute-force budget is per-throttle (5/min controller `:30`) only** |
| `AUTHENTICATED → AUTHENTICATED` | refresh-token use | `:522-548` | **no rotation** (I-7) — same `tokenVersion` reused | mints new access + refresh, does **not** invalidate prior refresh |
| `AUTHENTICATED → NEEDS_PASSWORD` | logout | `:491-520` | no — bumps `tokenVersion` | audit row |
| `AUTHENTICATED → NEEDS_PASSWORD` | `tokenVersion` mismatch | guard `:79-81` / service `:543-545` | yes | 401 only |

### 4.2 2FA setup FSM

**States:**

| State | DB shape |
|---|---|
| `NO_2FA` | `twoFactorEnabled=false`, `twoFactorSecret=null`, `pendingTwoFactorSecret=null` |
| `SECRET_GENERATED` | `twoFactorEnabled=false`, `pendingTwoFactorSecret=<base32>`, `twoFactorSecret=null` |
| `2FA_VERIFIED` (transient — same TX as `SETUP_COMPLETE`) | not distinct; the `enable2FA` promotion is atomic. |
| `SETUP_COMPLETE` | `twoFactorEnabled=true`, `twoFactorSecret=<base32>`, `pendingTwoFactorSecret=null`, `backupCodes=hash[10]`, `tokenVersion+=1` |
| `BACKUP_REGEN` (variant of SETUP_COMPLETE) | `backupCodes` replaced; no `tokenVersion` bump |
| `2FA_DISABLED` | `twoFactorEnabled=false`, `twoFactorSecret=null`, `backupCodes=[]`, `tokenVersion+=1` |

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `NO_2FA → SECRET_GENERATED` | `GET /2fa/setup` (auth'd) | `:312-329` | **no — every call overwrites `pendingTwoFactorSecret`**; a partially-enrolled SA replays losing the old pending secret. Acceptable: setup is supposed to be retryable. |
| `SECRET_GENERATED → SETUP_COMPLETE` | `POST /2fa/enable` w/ code from pending secret | `:346-394` (verifies code against `pendingTwoFactorSecret`, not the missing `twoFactorSecret`) | no — bumps `tokenVersion`; second call lands `400 'Please set up 2FA first'` because `pendingTwoFactorSecret` is null |
| `SETUP_COMPLETE → SETUP_COMPLETE` (backup regen) | `POST /2fa/regenerate-backup-codes` w/ TOTP | `:461-489` — checks `twoFactorEnabled`, then calls `verifyTotp` (returns false if secret null) | yes — re-generates 10 codes; no version bump |
| `SETUP_COMPLETE → 2FA_DISABLED` | `POST /2fa/disable` w/ current password + TOTP/backup | `:401-459` | no — bumps `tokenVersion`; clears all 2FA fields |
| `2FA_DISABLED → NEEDS_PASSWORD` (login attempt) | next `POST /login` | `:207-219` | yes — **2FA-mandatory gate forbids login** until ops re-provisions |

**Forbidden transitions:**
- `SECRET_GENERATED → AUTHENTICATED` directly via login — would have allowed self-enroll bootstrap; explicitly forbidden by `:207-219` ("password → self-enroll → full access" path is closed; documented in code comment `:202-206`).
- `SETUP_COMPLETE → NO_2FA` without password — `disable2FA` requires current password + valid 2FA code (`:415-435`).
- `BACKUP_REGEN` without 2FA code — `:471-481` requires a valid TOTP (backup codes are explicitly **not** accepted here; only TOTP).

**Transitions that should be idempotent but aren't:**
- Refresh rotation (FSM 4.1 row 7) — flagged F-3 in §7.
- Initial seed (`createInitialSuperAdmin :598-642`) — count-then-create race window, no `ON CONFLICT` — flagged F-4 in §7.

---

## 5. Money & precision audit

**N/A** — `superadmin` reads aggregated revenue stats (`superadmin-tenants.service.ts:181`, `:458-460`, `superadmin-users.service.ts:118`) via `Number(x._sum.finalAmount) || 0` purely for display in the SA dashboard. No money writes, no rounding policy, no reconciliation. The precision-loss those `Number(...)` calls cause is a display-only artefact — they belong in the `orders/`, `accounting/`, and `subscriptions/` reviews. Note for the dashboard story: stats sourced from `Order.finalAmount` aggregated across all tenants are coerced to JS `Number` here; if a single tenant's lifetime PAID revenue exceeds `2^53 − 1` cents the displayed total drifts, but that's a UI bug not a business-logic one.

---

## 6. Concurrency hazards

### 6.1 Critical sections + lock strategy

- `superadmin-tenants.service.ts:215-243` — status flip + subdomain quarantine wrapped in a single `$transaction`. Strong invariant (I-16); no other write path can interleave (would still need ROW LOCK if the tenant is being updated by another writer, but cross-tenant SA flows don't collide).
- `superadmin-subscriptions.service.ts:305-321` — `subscription.update` + `tenant.update({currentPlanId})` wrapped in a single `$transaction` so feature-gating cannot lag the plan record.
- TOTP step write at `:112-118` — uses a single `update`; the `lastTotpStep`/`lastTotpStepExpiresAt` columns are updated unconditionally to the latest accepted step. Verified replay protection: a second verify against the **same** code reads the (now-persisted) step at `:103-110` and rejects.

### 6.2 Race windows still open

**F-3 / I-7: refresh-token rotation race (verified — worse than seed).**

*Sketch:* attacker holding a refresh token R issues `POST /superadmin/auth/refresh` twice in parallel. Both requests:
1. Verify R (valid).
2. `findUnique({where: {id: payload.sub}})` returns identical `superAdmin.tokenVersion = N`.
3. Compare `payload.ver === N` — both pass.
4. Call `generateTokens(superAdmin)` — both mint new (access, refresh) pairs **with the same `ver: N`**.

The seed says "payload.ver check vs new ver write not atomic". Verified: `generateTokens` (`:550-589`) **never increments `tokenVersion`** at all. There is no rotation; the prior refresh token stays valid for its 7-day TTL. So the issue is not just a race — it's a missing invariant: refresh is not one-shot. Two concurrent (or sequential) refreshes from the same R both succeed; an attacker who exfiltrates R from victim has 7 days of indistinguishable parallel sessions.

*Where:* `superadmin-auth.service.ts:522-548` + `:550-589` (generateTokens).
*Severity:* High · Sec.
*Fix:* atomic rotation. In a `$transaction`, do `UPDATE super_admins SET tokenVersion = tokenVersion + 1 WHERE id = ? AND tokenVersion = ? RETURNING tokenVersion` — if `count === 0`, reject as replay; otherwise mint tokens with the new `ver`. Alternatively store a per-refresh-token jti in a `super_admin_refresh_tokens` table and burn it on use (mirrors the tenant `auth.service.ts:691-721` atomic-consume pattern).

**F-4: `createInitialSuperAdmin` non-idempotent (verified).**

*Sketch:* two seed scripts (CI + manual) launch concurrently on a fresh DB.
1. Both call `prisma.superAdmin.count()` → 0.
2. Both pass the `if (existingCount > 0)` guard.
3. Both call `prisma.superAdmin.create({...})` with **different emails** → both rows land; the platform has two initial SAs, each with `twoFactorEnabled=true` and a working TOTP secret.
4. Same email → second `create` raises Prisma unique-constraint error (P2002); operator sees a 500.

*Where:* `:598-642`.
*Severity:* Medium · Arch.
*Fix:* `prisma.superAdmin.upsert` keyed on a sentinel `email`, or wrap in `$transaction` + advisory lock (`pg_advisory_xact_lock(djb2('superadmin_initial_seed'))`), or run via a migration with its own lock semantics.

**F-1: `failedLogins` counter reset race (verified, A3).**

*Sketch:* concurrent password-correct attempts (e.g., automated retry on a flapping client) all execute `:221-224` (`failedLogins: 0`). Then a third request enters with a sniffed password and bypasses the counter check at `:190` because it was just reset. The race isn't the reset — it's the **timing** of the reset. The semantic bug (resetting before 2FA succeeds) is the primary issue; the concurrency wrinkle just makes detection harder.

*Where:* `:221-224`.
*Severity:* High · Sec.
*Fix:* reset `failedLogins` inside `verify2FA` at `:287-290` (where `lastLogin` is already written) instead of in `login`. Optionally also enforce the counter on **2FA** failures so a brute-force on the 6-digit code trips the same lockout.

### 6.3 Idempotency keys

- **Refresh:** missing — see F-3.
- **Initial seed:** missing — see F-4.
- **Plan create / update / delete:** no client-supplied key; the unique constraint on `SubscriptionPlan.name` (in `prisma/schema.prisma` — out-of-scope but assumed) is the practical key. Acceptable for a low-frequency SA-only path.
- **Subscription extend:** no idempotency key; a retried `POST /extend` on the same subscription adds the days twice. Lower-priority because SA-only and audited; still worth a `(subscriptionId, actorId, idempotencyKey)` if the endpoint becomes more automated.
- **Tenant status flip:** explicitly no-op short-circuited at `superadmin-tenants.service.ts:204-212` if `previousStatus === updateDto.status` — clean idempotency.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Sec | `superadmin-auth.service.ts:221-224` | `failedLogins` reset to 0 on **password-correct + 2FA-not-yet-attempted**. A password-guessing attacker who eventually lands a valid password (e.g., from a separate leak) starts every subsequent 2FA brute-force attempt with a fresh counter. The 5-failure lockout (`:190-194`) is effectively unreachable. (A3 — verified.) | Reset only in `verify2FA :287-290`. Also consider per-2FA-failure increments. |
| F-2 | Low | Sec | `superadmin-auth.service.ts:468-481` (`regenerateBackupCodes`) | The seed (A4) flagged "no explicit null check on `twoFactorSecret`". Verified: the explicit check is missing, but `verifyTotp :88-89` returns `false` when the secret is null, so `:480` correctly throws `BadRequestException`. **Invariant holds by side effect, not by explicit guard.** Refactor risk is real (any change to `verifyTotp`'s null-handling silently re-opens this). | Add `if (!superAdmin.twoFactorSecret) throw new BadRequestException('2FA is not configured')` at `:470` for defense-in-depth. Severity Low instead of High because the door isn't actually open today. |
| F-3 | High | Sec | `superadmin-auth.service.ts:522-548` + `:550-589` (`refreshToken` / `generateTokens`) | Refresh is **not one-shot rotated**. `generateTokens` does not increment `tokenVersion`; the prior refresh token remains valid for its full 7-day TTL after a refresh succeeds. Two parallel refreshes both succeed; a leaked refresh is silently usable in parallel with the legitimate session. (§4.4 row 1 — verified, severity matches seed.) | Wrap in `$transaction`: `UPDATE super_admins SET tokenVersion = tokenVersion + 1 WHERE id = ? AND tokenVersion = ?` — if 0 rows, throw `Session revoked`; otherwise mint with the new version. Or add a `super_admin_refresh_tokens` jti-burn table. |
| F-4 | Medium | Arch | `superadmin-auth.service.ts:598-642` (`createInitialSuperAdmin`) | Count-then-create race: two concurrent seed scripts (with distinct emails) can both pass the `existingCount === 0` gate and land two initial SAs; same email collapses to a 500 instead of a clean no-op. (§4.4 row 3 — verified.) | `upsert` keyed on email, or wrap in `$transaction` + `pg_advisory_xact_lock(djb2('superadmin_initial_seed'))`. |
| F-5 | Medium | Sec | `common/middleware/request-logger.middleware.ts:125-136` (allow-list) — affecting `superadmin/auth/verify-2fa` body | `DetailedRequestLoggerMiddleware.shouldLogBody` redacts `/auth/login` but not `/auth/verify-2fa`. The `verify-2fa` body contains the 10-minute `tempToken` (`dto/verify-2fa.dto.ts:8`) and the 6-digit code in cleartext. Log readers (Loki/CloudWatch) holding the request line can replay the 2FA path for the tempToken's 10-min lifetime. (§4.4 row 2 — re-attributed: seed said "tempToken written to audit log"; the audit log writes do **not** include `tempToken`, see §9. The real exposure is the HTTP log.) | Add `/auth/verify-2fa`, `/2fa/enable`, `/2fa/disable`, `/2fa/regenerate-backup-codes`, `/auth/refresh` to the `sensitiveRoutes` allow-list. Or invert the model: redact by default, allow-list non-sensitive. |
| F-6 | Medium | Sec | `superadmin-auth.service.ts:91-96` (TOTP verify via `speakeasy.totp.verifyDelta`) | `speakeasy` compares HMAC digests with `string ===`, not `crypto.timingSafeEqual`. Timing window for a 6-digit code is microscopic and the controller is throttled to 5/min (`controller:30`), so practical exploitability is near-zero. The strict invariant from the seed ("constant-time compare") is not held. | Acceptable as-is given throttle; document the trade-off, or switch to a vetted constant-time TOTP implementation if compliance asks. |
| F-7 | Medium | Sec | `superadmin-auth.service.ts:283-285` (2FA failure) | A bad 2FA code returns 401 with no per-account counter. The endpoint throttle is per-IP (5/min, `controller:30`). An attacker rotating IP can brute-force the 6-digit code (10⁶ space, ~12 days at 5/min/IP across 200 IPs ≈ minutes). The password lockout doesn't protect this path because the tempToken bypasses it. | Increment `failedLogins` (or a separate `failed2FA` counter) on each invalid 2FA code; lock the account when threshold trips. |
| F-8 | Medium | Cor | `superadmin-auth.service.ts:122-138` (`verifyBackupCode`) | Read-modify-write on `backupCodes`: load array, `.includes(hash)`, then `update` with the filtered array. Concurrent uses of the same backup code both pass `.includes(hash)`, both write filtered arrays — but the second write **overwrites** the first; net effect is the code is burned exactly once **but the side effect (auth pass) happens twice**. So a code-reuse attacker who can submit twice in parallel gets 2FA accepted twice. | Replace with conditional update: `updateMany({ where: { id, backupCodes: { has: hash } }, data: { backupCodes: { set: filtered } } })` — reject when `count === 0`. Or move the filter to `pgUpdate ... WHERE ? = ANY(backup_codes)` under a row lock. |
| F-9 | Low | Sec | `superadmin-auth.service.ts:478` | `verifyTotp` for `regenerateBackupCodes` mutates `lastTotpStep` even on the regen path, meaning a SA who just did `verify-2fa` cannot regenerate codes within the 90s replay window using the same authenticator step. UX edge, not security; documenting. | None required; consider clarifying error message ("please wait for the next TOTP step"). |
| F-10 | Low | Arch | `superadmin-auth.service.ts:312-329` (`setup2FA`) | Every call overwrites `pendingTwoFactorSecret`, silently invalidating any in-flight enrollment. Acceptable per the documented retry model (comment at `:307-311`) but worth tightening: a stray re-call from a concurrent tab destroys the secret the operator just photographed. | Idempotency: only generate if `pendingTwoFactorSecret == null` and `twoFactorEnabled == false`; otherwise return the existing pending secret/QR. |
| F-11 | Medium | Sec | `superadmin-auth.controller.ts:115-122` (`refresh`) | Refresh token accepted via JSON body (`@Body('refreshToken')`), not via httpOnly cookie. This diverges from the tenant `auth` pattern (which uses cookies) and means the frontend has to hold the refresh token in JS-readable state — XSS-exfiltratable. (Frontend mitigation: the `superAdminAuthStore` does not persist the refresh — documented in CODE_REVIEW.md §5.2 — but it still lives in memory and is exposed to any in-page script.) | Switch to httpOnly + SameSite=Strict cookie set by `verify2FA`/`refresh` response; mirror the tenant pattern. |
| F-12 | Low | Arch | `superadmin-auth.service.ts:550-589` (`generateTokens`) | Access token TTL is 1h and refresh TTL is 7d, mirroring tenant `auth`. There is no separate idle-vs-absolute timeout for SA sessions, which are higher-privilege than tenant sessions. | Consider shorter TTLs for SA (e.g., 15m access, 12h refresh) given the audit obligation. |
| F-13 | Info | Arch | `superadmin-audit.service.ts:194-199` (`getRecentActivity`) | Default `limit = 10` is hardcoded; caller can pass higher but there is no upper bound check on this method (the filter DTO caps at 100 elsewhere, but `getRecentActivity` doesn't take a DTO). Currently only called from `superadmin-dashboard.service.ts` with literal `10`; no live exposure. | Add a `Math.min(limit, 100)` clamp for defense-in-depth. |
| F-14 | Info | Sec | `superadmin-audit.service.ts:151-155` (`export`) | `take: 10000` hard cap on exports — sensible. Note that the export endpoint is gated by `SuperAdminGuard` only; no per-export audit row is written (export of audits doesn't itself appear in audits). | Add an audit-log row for "audit export performed" with filter parameters; closes the meta-loop. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

Patterns worth keeping — and copying.

- `superadmin-auth.service.ts:47-50, 165-171` — **bcrypt timing normalization on unknown email.** Module-load constant-time dummy hash, run on the not-found path so response timing doesn't leak SA email enumeration. Candidate to replicate: tenant `auth.service.ts validateUser` (per CODE_REVIEW.md A5 / §4.2 row `Low Perf`).
- `superadmin-auth.service.ts:91-118` — **TOTP replay protection.** Stores the last accepted step in `lastTotpStep` + an expiry; refuses re-use of the same step inside the window. The 90s lock (`TOTP_REPLAY_LOCK_MS`) is documented (`:38`) to bracket the verify-delta window (`TOTP_WINDOW=1` at `:33`, comment `:27-32`). The whole design — separate columns, persisted on success, expiry-bounded — is the cleanest TOTP-replay defence in the repo.
- `superadmin-auth.service.ts:140-152` — **Backup-code hashing + one-shot burn.** SHA-256-hashed at generate-time, returned plaintext exactly once, hashed comparison on use, used code removed from the array. Same hash function is reused (`hashSecret :63-65`) so storage and verification can't drift. Pattern to copy: subscription/recovery codes anywhere else.
- `superadmin-auth.service.ts:307-394` — **Two-phase 2FA enrollment via `pendingTwoFactorSecret`.** Setup writes to a sandbox column; only a TOTP from the **pending** secret promotes it to live (`:373-382`). This kills the "rotate secret to attacker's authenticator" attack on a stolen session.
- `superadmin-auth.service.ts:201-219` — **Mandatory-2FA gate.** Refuses to mint a tempToken if `twoFactorEnabled` is false, with a documented audit row + a 403 message that routes ops to a provisioning channel. Comment at `:202-206` explicitly describes the "self-enroll bootstrap" attack this closes.
- `superadmin-auth.service.ts:380, 445, 506` — **`tokenVersion` bumped on enable-2FA, disable-2FA, logout.** Combined with the per-request DB recheck at `guards/superadmin.guard.ts:79-81`, this gives near-instant revocation. (Verified gap: the bump is missing on `refresh` — see F-3 — and on `changePassword` because that path doesn't exist yet.)
- `superadmin-audit.service.ts:17-22` — **CSV-injection-safe export.** Prefixes any cell starting with `=+-@\t\r` with a single quote so Excel/Sheets can't interpret it as a formula; doubles embedded quotes and wraps in double-quotes. Tenant names and emails are attacker-controllable and could otherwise smuggle `=cmd|'/c calc'!A1` into an operator's spreadsheet.
- `superadmin.module.ts:38-52` — **Boot-time JWT secret validation.** Refuses to start if `SUPERADMIN_JWT_SECRET`/`SUPERADMIN_JWT_REFRESH_SECRET` are missing, shorter than 32 chars, or equal to the tenant `JWT_SECRET`. Catches the "ops copy-paste the tenant secret into the SA env" footgun before the process ever serves a request.
- `superadmin-auth.controller.ts:29-31` — **Aggressive per-route throttles.** `LOGIN_THROTTLE = 5/min`, `VERIFY_2FA_THROTTLE = 5/min`, `REFRESH_THROTTLE = 30/min`. Tighter than the tenant equivalents, appropriate to the privilege level.
- `guards/superadmin.guard.ts:62-81` — **Per-request DB recheck of `tokenVersion`.** Unlike tenant `JwtStrategy` (which trusts the claim — A1 in CODE_REVIEW.md), the SA guard reads the live row on every request. Revocation latency = ms, not = access-token TTL. The perf cost is acceptable because SA traffic is low.
- `superadmin-tenants.service.ts:215-243` — **Status-flip + subdomain quarantine in a single `$transaction`.** Prevents the "suspend → release subdomain → phisher claims" window.
- `superadmin-subscriptions.service.ts:266-294` — **Downgrade quota guard on SA plan change.** Re-checks user/table/product/category counts against new plan limits before allowing the move; mirrors the tenant-side `assertDowngradeAllowed` pattern.

---

## 9. Spot-checks performed

**Verified end-to-end:**
- F-1 (A3) — confirmed at `superadmin-auth.service.ts:186-200, 221-224`. The reset at `:221-224` runs immediately after `isPasswordValid === true`, before the 2FA gate, before `verify2FA` is reachable.
- F-3 (refresh race / no-rotation) — confirmed at `:522-548` and `:550-589`. `generateTokens` has no `tokenVersion` write; `refreshToken` returns its result. The seed (§4.4 row 1) said "payload.ver check vs new ver write not atomic"; the verified condition is stronger — there is **no new ver write at all**, atomic or otherwise.
- F-4 (initial-seed race) — confirmed at `:609-612, :622-634`. `count()` then `create()` with no lock; `email @unique` (schema `:1741`) saves correctness for same-email races but not for different-email ones.
- F-8 (backup-code RMW race) — confirmed at `:122-138`. The `update` writes `backupCodes: filtered` rather than conditionally testing `has: hash` server-side.
- I-9 (no plaintext secrets in audit log) — confirmed by reading every `auditService.log` callsite in `superadmin-auth.service.ts` (`:208-215, 292-299, 384-391, 449-456, 509-516`) and `superadmin-tenants.service.ts` (`:261-271, 598-614`) and `superadmin-subscriptions.service.ts` (`:118-126, 151-158, 323-336, 381-397, 453-463`). No callsite passes a token, password, secret, code, or backup code. Schema `AuditLog :1780-1799` is structurally fine.
- I-16 (status flip + subdomain quarantine atomic) — confirmed by re-reading the `$transaction` block at `superadmin-tenants.service.ts:215-243`.

**Dropped (initial report was wrong):**
- **"Audit log contains tempToken in plaintext at controller :44-49."** Re-read: lines 44-49 of `superadmin-auth.controller.ts` are the `@Post('login')` handler that calls `authService.login(...)` and returns its result — the controller itself does no logging. The `login` service path's only audit call (`:208-215`) writes when `!twoFactorEnabled`, with metadata `{ ip, userAgent, reason: '2fa_not_enabled' }` — no token. The successful-password-+-2FA-enabled branch returns `{ requiresTwoFactor: true, tempToken }` **without writing an audit row at all** (the next audit row lands inside `verify2FA :292-299`, also without the tempToken). **The audit log claim is not held.** **The real exposure is HTTP request-body logging** (see F-5) — the seed mis-attributed the venue.
- **"`regenerateBackupCodes` accepts null `twoFactorSecret`."** The explicit null guard the seed asks for is missing, but `verifyTotp :88-89` returns `false` on null secret, so the code path at `:480` throws `BadRequestException`. **Invariant holds by accident, not by construction.** Downgraded High → Low (F-2).

**Severity downgraded:**
- A4 (seed High) → F-2 Low — see above.
- "Audit log plaintext tempToken" (seed Medium Sec) → dropped (audit) and re-issued as F-5 Medium Sec against the request logger middleware.

**Pattern note:** of the four agent-flagged items from CODE_REVIEW.md §2 and §4.4 spot-checked, two were verified exactly as flagged (A3, refresh race, initial-seed race), one was correct in spirit but stronger in fact (refresh has no rotation at all, not just non-atomic rotation), and one was wrong-venue (tempToken is exposed via HTTP logs, not the audit table). Always pull the cited line; "logged in plaintext" in particular is a verb that the seed reviewer used loosely.

---

## 10. Recommended tests

The 6 tests below would catch every §3 invariant marked ❌ and every §6 race.

```ts
// backend/src/modules/superadmin/__tests__/superadmin-auth.integration.spec.ts

describe('superadmin auth invariants', () => {
  it('I-2 / F-1: failedLogins resets only after 2FA succeeds, not after password', async () => {
    // arrange: SA with 2FA enabled, failedLogins = 4
    // act: POST /login with correct password (response: requiresTwoFactor=true, tempToken)
    // assert: prisma.superAdmin row still has failedLogins = 4
    // act: 5th wrong-password attempt
    // assert: account is locked (next login returns "Account locked")
  });

  it('I-5 / F-2: regenerateBackupCodes refuses when twoFactorSecret is null', async () => {
    // arrange: SA with twoFactorEnabled=true but twoFactorSecret=null (force-inject)
    // act: POST /2fa/regenerate-backup-codes with any code
    // assert: 400 BadRequest (current behaviour) AND no new backupCodes minted
  });

  it('I-7 / F-3: refresh is one-shot — the prior refresh token is invalidated on use', async () => {
    // arrange: complete login + 2FA, capture refreshToken R1
    // act: POST /refresh with R1 → R2 + access2
    // act: POST /refresh with R1 again
    // assert: second call returns 401 "Session revoked" (currently fails — succeeds today)
  });

  it('I-7 / F-3 race: two concurrent refreshes from the same token must collapse to one success', async () => {
    // arrange: capture R1
    // act: Promise.all([refresh(R1), refresh(R1)])
    // assert: exactly one resolves with tokens, the other rejects with 401 (currently both succeed)
  });

  it('I-8 / F-4: createInitialSuperAdmin is idempotent across concurrent seeds', async () => {
    // arrange: empty SA table
    // act: Promise.all([createInitialSuperAdmin(a@x, ...), createInitialSuperAdmin(b@x, ...)])
    // assert: prisma.superAdmin.count() === 1 AND the call from the loser resolves without throwing
    //         OR explicitly rejects with a known "seed already running" error
  });

  it('I-9 / F-5: verify-2fa request body is not visible in HTTP logs', async () => {
    // arrange: capture logger.log calls
    // act: POST /superadmin/auth/verify-2fa with body { tempToken, code }
    // assert: no log entry contains the tempToken string verbatim
  });

  it('F-8: backup-code burn is atomic under concurrent submit', async () => {
    // arrange: SA with one backup code C remaining
    // act: Promise.all([verify2FA(tempToken, C), verify2FA(tempToken, C)])
    // assert: exactly one resolves with access+refresh, the other with 401 "Invalid 2FA code"
    //         AND prisma.superAdmin.backupCodes.length === 0
  });

  it('I-1: login is refused for a SA without 2FA enabled', async () => {
    // arrange: SA row with twoFactorEnabled=false, correct password
    // act: POST /login
    // assert: 403 Forbidden AND audit row exists with reason='2fa_not_enabled'
  });
});

describe('superadmin tenant + subscription invariants', () => {
  it('I-15: downgrade refused when current usage exceeds new plan limits', async () => {
    // arrange: tenant with 200 active users on Pro (maxUsers=500), Free plan exists (maxUsers=5)
    // act: PUT /superadmin/subscriptions/:id { planId: free.id }
    // assert: 400 BadRequest with message including 'users 200/5'
  });

  it('I-16: tenant suspend atomically quarantines subdomain', async () => {
    // arrange: tenant ACTIVE with subdomain 'pizza'
    // act: PUT /superadmin/tenants/:id/status { status: 'SUSPENDED' }
    // assert: prisma.tenant.status === 'SUSPENDED' AND subdomain reservation row exists with reason='tenant_suspended'
    // act: try to create a new tenant claiming 'pizza'
    // assert: rejected
  });

  it('I-19: CSV export quotes formulas in tenant names', async () => {
    // arrange: tenant name = '=cmd|"/c calc"!A1', generate one audit row for it
    // act: GET /superadmin/audit/export?format=csv
    // assert: row contains `"'=cmd|""/c calc""!A1"` (leading single quote, doubled internal quotes)
  });
});
```

Cross-tenant invariant tests (per `../CODE_REVIEW.md §3.1`) are out-of-scope here — SA endpoints are deliberately cross-tenant. The test that matters at this layer is **role escalation:** a tenant-scoped `JwtStrategy` token must never satisfy `SuperAdminGuard`. Recommended:

```ts
it('tenant access token cannot authenticate SA endpoints', async () => {
  // arrange: tenant ADMIN, capture their access token T
  // act: GET /superadmin/auth/me with Bearer T
  // assert: 401 Unauthorized (guard rejects because the SA JWT secret differs and the claim type isn't 'superadmin')
});
```
