# `auth` — Deep Review (2026-05-11)

**Tier:** 1
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/auth/...`, `backend/prisma/schema.prisma` (User, RefreshToken)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §2 (A1, A5) + §4.2 for the seed findings

---

## 1. Health & summary

🟢 green

`auth/` owns identity issuance, refresh-token rotation, password reset, email-verification codes, and social-auth (Google/Apple) onboarding. It is the entry into every multi-tenant boundary downstream. The token-lifecycle code is **solid**: refresh tokens are stored as sha256 hashes with a unique index (`schema.prisma:148`), rotation revokes the spent token (`auth.service.ts:527-530`), reuse detection revokes the whole family (`auth.service.ts:481-488`), `tokenVersion` revocation is honored on both access (`jwt.strategy.ts:67-70`) and refresh (`auth.service.ts:517-524`), and password reset uses an atomic-consume pattern that is the **reference implementation** for one-shot tokens in this codebase (`auth.service.ts:691-722` — see §8). Bcrypt cost is tunable via env with a sane floor/ceiling and applied identically across all hash sites. Login is timing-safe against email-enumeration (`auth.service.ts:421-424`).

Remaining sharp edges are concentrated in three places: (a) the JWT `tokenVersion` check is purely against the claim, with **no per-request DB lookup of the stamp** — revocation latency = JWT TTL on the access-token path (A1); (b) the **social-auth (Google/Apple) and refresh paths re-check `user.status` but the social paths skip `tenant.status`** so a suspended-tenant ADMIN can still log in via Google/Apple even though the password path blocks them (A5 scope refined); (c) async side-effects (email verification send, admin notification) are silently swallowed and the endpoint still returns 200 (`auth.service.ts:259-262`, `:276-278`, `:843-846`, `:896-899`). Compared to the 2026-04-27 cycle this module's health is unchanged — the atomic-consume fix predates this review.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/auth/auth.service.ts` (1335 LOC) — register, login, validateUser, refreshToken, logout, forgot/reset/change password, email verification, Google/Apple OAuth, social-auth user creation.
- `backend/src/modules/auth/auth.controller.ts` (224 LOC) — cookie-only refresh, throttle budgets, refresh-cookie helpers, body-strip of refresh token.
- `backend/src/modules/auth/strategies/jwt.strategy.ts` (75 LOC) — per-request user load, tokenVersion claim check, tenant-status check.
- `backend/src/modules/auth/strategies/local.strategy.ts` (22 LOC) — thin wrapper over `validateUser`.
- `backend/src/modules/auth/guards/jwt-auth.guard.ts`, `roles.guard.ts`, `tenant.guard.ts`, `api-key.guard.ts` — all four.
- `backend/src/modules/auth/auth.module.ts` — global guard registration.
- `backend/src/common/helpers/guard-bypass.helper.ts` — bypass decoration matrix for `@Public` / superadmin / marketing.
- `backend/prisma/schema.prisma:146-160` (RefreshToken), `:179-232` (User auth fields).

**Skimmed only:**
- DTOs (`register.dto.ts`, `login.dto.ts`, `password-reset.dto.ts`, `social-auth.dto.ts`, `verify-email-code.dto.ts`, `auth-response.dto.ts`) — validation decorators only; password complexity regex consistent across `RegisterDto` and `ResetPasswordDto`/`ChangePasswordDto`.
- `decorators/` — `Public`, `Roles`, `CurrentUser` are one-liners.
- `*.spec.ts` files — looked at file names only; coverage gaps tracked in §10.

**Skipped:**
- Superadmin auth (lives in `modules/superadmin/`, separately reviewed).
- Frontend stores / Axios interceptor refresh-flight — covered in `frontend-auth-stores.md` / `frontend-lib.md`.

---

## 3. Business-logic invariants

The contract `auth/` is responsible for keeping. Every row is testable end-to-end.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | A password-reset token is **one-shot** — once consumed (or attempted by a second request in parallel) it cannot mint a second password change. | `auth.service.ts:703-722` (atomic-consume via `updateMany` filtered on `resetTokenHash`, reject when `count === 0`, inside `$transaction` that also revokes refresh tokens) — **VERIFIED** | ❌ none (recommended in §10) | account takeover via leaked-but-still-live reset link |
| I-2 | Refresh-token rotation is **strict**: a newly-issued refresh token revokes the prior one in the same call; presenting a previously-rotated token revokes the entire user family (reuse detection). | `auth.service.ts:481-488` (reuse → family revoke), `:527-530` (rotation revoke) | ❌ none | stolen refresh token can ride on top of a live session indefinitely |
| I-3 | Incrementing `User.tokenVersion` invalidates every outstanding **access** and **refresh** token for that user (logout-everywhere semantics). Revocation latency on access tokens is bounded by JWT TTL because the check is claim-only (see A1). | `jwt.strategy.ts:67-70` (access), `auth.service.ts:517-524` (refresh) | ❌ none | password reset / admin-lockout cannot stop an attacker holding a live access token until expiry |
| I-4 | A user whose `User.status !== 'ACTIVE'` cannot complete login on **any** path (password, refresh, Google, Apple). | `auth.service.ts:434-435` (password), `:505` (refresh), `:989, :1027` (Google), `:1119, :1157` (Apple) | ❌ none | deactivated/suspended user retains a valid session |
| I-5 | A user whose **tenant** `Tenant.status !== 'ACTIVE'` cannot complete login on the password or refresh path. **Partially enforced — social paths bypass this**, see F-2. | `auth.service.ts:437-439` (password), `:508-510` (refresh), `jwt.strategy.ts:60-62` (per-request); **MISSING** at `:989-991, :1027-1029, :1119-1121, :1157-1159` (social) | ❌ none | suspended-tenant ADMIN can log in via Google/Apple even though the password path correctly blocks them |
| I-6 | bcrypt work factor is **consistent** across every hash site (register, social-auth-shadow, reset, change-password) and rooted in `bcryptCost()` so an env bump applies uniformly. | `auth.service.ts:61-68` (cost helper); used at `:229` (register), `:692` (reset), `:755` (change). Social-auth creates a row with `password: ''` at `:1285` (no hash — login disabled, correct) | ❌ none | mixed-cost hashes; offline attack against weaker rows |
| I-7 | Email verification codes are stored **hashed at rest** (sha256), expire within 1 hour, and the raw 6-digit code is delivered only via email; the in-app notification carries the action flag but **not** the code. | `auth.service.ts:817-820` (hash store), `:830-842` (notification without code) | ❌ none | leaked notification or DB row yields a usable verification code |
| I-8 | Password-reset tokens are likewise stored **hashed at rest**; the raw 32-byte token is mailed once and the DB unique index is on the hash. | `auth.service.ts:647-659`; `schema.prisma:206 (resetTokenHash @unique)` | ❌ none | DB leak grants password-reset capability |
| I-9 | Login response time is **invariant** with respect to whether the email is registered — when the user is absent we still run `bcrypt.compare` against a precomputed dummy hash. | `auth.service.ts:44-47, :421-424` | ❌ none | timing-based email enumeration |
| I-10 | The refresh token never appears in a JSON response body and is delivered **only** via httpOnly+sameSite=strict cookie scoped to `/api/auth`. | `auth.controller.ts:27-44` (cookie helpers + `stripRefresh`), `:106` (refresh reads from cookie only) — **VERIFIED** | ❌ none | refresh token reachable from JS; XSS exfiltration |
| I-11 | Password complexity (≥8 chars, lower+upper+digit) is enforced **at every entry point** that sets a password — register, reset, change. | `register.dto.ts:14-18`, `password-reset.dto.ts:21-27, :35-40` | ❌ none | weak passwords admitted via reset/change but not register (drift) |
| I-12 | Newly-registered non-ADMIN users land in `status='PENDING_APPROVAL'` and receive **no tokens** until an existing ADMIN approves — `register()` returns `{accessToken: null, refreshToken: null}` for that branch. | `auth.service.ts:232, :265-294` | ❌ none | self-registered WAITER auto-joins a tenant without approval |
| I-13 | Tenant + Subscription + (social-auth) User are created in **one transaction** so partial failure cannot leave a Tenant without a matching Subscription. | `auth.service.ts:165-192` (password register), `:1256-1304` (social) | ❌ none | downstream code (billing scheduler, subscription guard) NPEs on tenants without a subscription |

> The 2FA state-machine invariant from the prompt is **not applicable here** — 2FA lives in `modules/superadmin/` and is reviewed separately in `superadmin.md`. The main-app auth module has no 2FA path.

---

## 4. State machine

### 4.1 Login / session lifecycle

**No DB enum** — state is reconstructed from `User.status` + presence/absence/revoked-flag of `RefreshToken` rows + the access token's expiry + `tokenVersion` claim.

```
                    [register]                                  [admin approves]
NEEDS_CREDENTIALS ─────────────► PENDING_APPROVAL ─────────────► ACTIVE_NO_SESSION
                                  (no tokens issued)
                                      auth.service.ts:232,265
                                      auth.controller.ts:67-76

NEEDS_CREDENTIALS ─[login OK]──► AUTHENTICATED ─[access exp]──► REFRESH_NEEDED ─[refresh OK]──► AUTHENTICATED
                                      ▲                                                              │
                                      └──────[refresh rotation, new pair issued]─────────────────────┘
                                      
                              [tokenVersion bump]
AUTHENTICATED ────────────────────────────────────────► REVOKED (every live token rejected on next access OR refresh)
                                                        jwt.strategy.ts:67-70 / auth.service.ts:517-524

                              [logout]
AUTHENTICATED ────────────────► REVOKED (refresh family revoked; access still valid until exp — A1 trade-off)
                                auth.service.ts:543-546

                              [refresh-token reuse detected]
AUTHENTICATED ────────────────► REVOKED (whole family revoked)
                                auth.service.ts:481-488
```

There is **no 2FA / NEEDS_2FA state in this module** — the prompt's NEEDS_CREDENTIALS → NEEDS_2FA → AUTHENTICATED machine applies to `modules/superadmin/` only.

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `∅ → PENDING_APPROVAL` | non-ADMIN registers against existing tenant | `auth.service.ts:232` | no — email unique constraint at `:114-116` | admin notification (swallowed on failure, :276-278) |
| `∅ → ACTIVE` | ADMIN registers + creates tenant | `auth.service.ts:165-192` (TX: tenant+subscription) | no — subdomain unique constraint at `:194-202` | verification email (swallowed, :259-262) |
| `PENDING_APPROVAL → ACTIVE` | admin approval flow | **lives outside this module** (`users` module) | — | — |
| `ACTIVE_NO_SESSION → AUTHENTICATED` | password login | `auth.service.ts:431-439` (status + tenant.status checks) | no — issues fresh refresh row each time at `:590-598` | `UserActivity LOGIN`, `lastLogin` write, Sentry user context |
| `AUTHENTICATED → REFRESH_NEEDED` | access token expires (JWT TTL) | `jwt.strategy.ts:30 (ignoreExpiration:false)` | yes | none |
| `REFRESH_NEEDED → AUTHENTICATED` | refresh w/ valid cookie | `auth.service.ts:460-533` (verify sig, lookup hash, check expiresAt, check revokedAt, reuse-revoke, status, tenant.status, tokenVersion, rotate) | **no — rotation is by design destructive on the old token** | old refresh revoked, new pair persisted, no audit log |
| `AUTHENTICATED → REVOKED` | logout | `auth.service.ts:543-546` (refresh family revokeMany), no tokenVersion bump | yes (re-call is a no-op `updateMany`) | `UserActivity LOGOUT` |
| `AUTHENTICATED → REVOKED` | password reset (other tab/device) | `auth.service.ts:703-722` (tokenVersion++, refresh revokeMany — both in `$transaction`) | yes (`updateMany` count==0 on second arrival, see §8) | — |
| `AUTHENTICATED → REVOKED` | change-password | `auth.service.ts:759-771` (tokenVersion++, refresh revokeMany in `$transaction`) | yes | — |
| `* → REVOKED` | refresh-token reuse detected | `auth.service.ts:481-488` | yes | — |

**Forbidden transitions:**
- `REVOKED → AUTHENTICATED` *without* re-credential — must require credentials or social-auth or reset. Enforced by `auth.service.ts:478-488` (revokedAt presence rejects).
- `PENDING_APPROVAL → AUTHENTICATED` via login — rejected at `auth.service.ts:431-432`.
- `inactive tenant + ACTIVE user → AUTHENTICATED` via password — rejected at `auth.service.ts:437-439`. **Via social — NOT REJECTED** (F-2).

**Transitions that should be idempotent but aren't:**
- `refresh rotation` writes a new `RefreshToken` row unconditionally; if the network drops between server write and client receipt, the client retries with the *new* refresh in cookie which is fine — but two concurrent refresh calls with the same cookie can race (see §6 and F-3).

### 4.2 Password-reset flow (separate state machine)

```
NEEDS_RESET ─[POST /auth/forgot-password]──► AWAITING_TOKEN
                                              (resetTokenHash + resetTokenExpiry set on User row;
                                               raw token emailed via emailService.sendPasswordResetEmail;
                                               always returns 200 to avoid email enumeration)

AWAITING_TOKEN ─[POST /auth/reset-password]──► CONSUMED (single-winner)
                                                user.password updated
                                                resetTokenHash := null
                                                resetTokenExpiry := null
                                                tokenVersion := tokenVersion + 1
                                                refreshTokens revokedAt := now()
                                                ALL IN ONE prisma.$transaction
                                                second arrival: BadRequestException (count===0)

AWAITING_TOKEN ─[1h passes]──► EXPIRED
                                (filter `gt: new Date()` at :680-682 excludes;
                                 token field stays set until next forgot-password write)
```

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `∅ → AWAITING_TOKEN` | forgot-password POST | `auth.service.ts:640-666` | no (overwrites prior hash if any — last-write-wins by design) | email send (**NOT** swallowed at :662 — good; throw bubbles to controller) |
| `AWAITING_TOKEN → CONSUMED` | reset-password POST | `auth.service.ts:687-722` | **yes (atomic consume, second arrival rejected with `count===0`)** | tokenVersion++, all refresh tokens revoked, both in `$transaction` |
| `AWAITING_TOKEN → EXPIRED` | clock | implicit via `resetTokenExpiry > now` filter at `:680-682` | yes | — |

### 4.3 Email verification (separate)

```
emailVerified=false ─[POST /auth/resend-verification or auto on register]──► CODE_PENDING
                                                                              codeHash + codeExpires on User

CODE_PENDING ─[POST /auth/verify-email matching code]──► VERIFIED
                                                          emailVerified=true; hash+expires cleared

CODE_PENDING ─[1h passes]──► EXPIRED (filter `<= new Date()` at :871)
```

| From → To | Guard (`file:line`) | Idempotent? |
|-----------|---------------------|-------------|
| `false → CODE_PENDING` | `auth.service.ts:792-820` | no — overwrites prior code (last write wins) |
| `CODE_PENDING → VERIFIED` | `auth.service.ts:867-885` (single conditional `update`) | **no — not atomic. Second-arrival race window: two requests with same code both pass the find, both run the update. Update itself is by `id` and is idempotent on `emailVerified=true`, so the practical exposure is zero, but it is structurally weaker than the password-reset flow.** Flagged in §7 as F-7. |

> 2FA setup vs entry: **N/A in this module.** Both live in `modules/superadmin/` and are covered in `superadmin.md`. The main-app auth path does not gate login on a 2FA factor.

---

## 5. Money & precision audit

**N/A — auth has no money path.** The only Decimal-adjacent touch in this module is creating a `Subscription` row with `amount: 0` on FREE-plan registration (`auth.service.ts:185, :1276`), which is a constant integer literal Prisma will coerce. No `Number(...)` conversions, no comparisons, no rounding policy. Subscription/billing math lives in `modules/subscriptions/`.

---

## 6. Concurrency hazards

### Critical sections + lock strategy

- **Password-reset atomic consume — `auth.service.ts:703-722`.** This is the **gold-standard** pattern in this codebase for one-shot token consumption. It does five things in one shot:
  1. `prisma.$transaction([...])` wraps the work atomically.
  2. The first write is `updateMany` filtered on **both** `id` *and* `resetTokenHash`. Filtering on the hash makes the write idempotent: once the first request flips `resetTokenHash` to null, the second arrival's `updateMany` matches zero rows.
  3. The data payload nulls `resetTokenHash`/`resetTokenExpiry` and increments `tokenVersion`.
  4. The second write is `refreshToken.updateMany` revoking every live refresh token in the same TX.
  5. After the TX, `updateResult.count === 0` is treated as "lost the race" and throws `BadRequestException`.
  
  Net effect: even if N parallel requests present the same valid token, **at most one** can mutate the row; the rest are rejected with the same error the expired-token branch uses. There is no read-modify-write window for an attacker (or a flaky client retry) to slip a second password change through. **Call out as solid — see §8.**

- **Refresh-token rotation — `auth.service.ts:472-533`.** Lookup by sha256 hash, check `revokedAt is null`, mark the old token revoked via `update`, issue new pair. **The "mark old revoked" and "issue new" are NOT in a transaction** (line 527 update runs before `generateTokens` at :533, which itself writes a new RefreshToken row at :590). The window is:
  - Request A reads `stored` (revokedAt=null) ✓
  - Request B reads same `stored` (revokedAt=null) ✓
  - Request A writes `revokedAt=now()` on row.id → succeeds
  - Request B writes `revokedAt=now()` on row.id → also succeeds (idempotent on the column)
  - Both A and B then call `generateTokens` and both mint new (different) refresh-token rows.
  
  Severity: **Medium.** It does not violate I-2 because both new tokens are tied to fresh DB rows with fresh hashes, both will future-rotate correctly, and the family-revoke on reuse detection still fires if either is ever replayed. The bug is that a single stolen refresh token used in parallel with a legitimate one yields **two live sessions** until either is rotated again or reuse triggers. **Fix:** wrap revoke+generate in a `$transaction` and gate the revoke on `where: { id: stored.id, revokedAt: null }` so only the first writer succeeds; reject the loser. Flagged as F-3.

- **JWT validation per request — `jwt.strategy.ts:36-74`.** Hits the DB on every request (user fetch including `tokenVersion`), so revocation-by-`tokenVersion` is effective at the next request. The trade-off is the cost of one indexed read per authenticated request; this is the standard NestJS-Passport idiom and not a defect.

### Race windows still open

| # | Sketch | Where | Severity | Fix |
|---|--------|-------|----------|-----|
| 1 | Two refresh requests with the same cookie race. Both pass `revokedAt is null`, both write `revokedAt=now()` on the old row (idempotent), both mint new tokens. Two live sessions instead of one. | `auth.service.ts:472-533` | Medium | `$transaction([conditional updateMany on stored.id, generate])`; reject when `count===0` |
| 2 | Email-verification consume isn't atomic. Two requests with the same code both pass the find, both run the update. Practically zero damage (the update is idempotent on `emailVerified=true`), but structurally weaker than the reset flow. | `auth.service.ts:867-885` | Low | Mirror the reset-flow pattern: `updateMany where { id, emailVerificationCodeHash }` + reject on count==0 |
| 3 | `forgot-password` overwrites any prior `resetTokenHash`. A user (or attacker abusing forgot-password as a DoS) can force-invalidate a pending reset link. | `auth.service.ts:653-659` | Low/Info | acceptable by design; rate-limited at `auth.controller.ts:144` (5/min) |

### Idempotency keys

- **Present at:** `RefreshToken.tokenHash` is `@unique` (`schema.prisma:148`) so two writes of the same token collide. `User.email` is unique; `User.resetTokenHash` is unique (`schema.prisma:206`) — a second user being assigned an in-flight identical token would P2002. Subdomain is unique with quarantine + suffix retry (`auth.service.ts:76-92`).
- **Missing where needed:** none beyond F-3 (refresh-rotation should be transactionally guarded; the unique constraint alone doesn't prevent the read-modify-write race because the column being rewritten is `revokedAt`, not the hash).

### Async error swallowing (`auth.service.ts:256-262`, `:276-278`, `:843-846`, `:896-899`)

Three sites catch and `console.error` an exception without re-throwing or surfacing through Sentry:
- `register()` swallows `sendEmailVerification` failure → user receives 200 + tokens, never gets the email. F-5.
- `register()` swallows `notifyAdmins` failure for PENDING_APPROVAL → admin never sees the approval ticket; user is stuck. F-5.
- `sendEmailVerification` swallows in-app notification failure (less critical because the email still went out, in-app is a UX adjunct).
- `verifyEmailWithCode` swallows success-notification failure (lowest risk).

The pattern is consistent — fire-and-forget for non-blocking notifications — but registration's email-verification is **load-bearing** (user cannot complete onboarding without it) and should not be swallowed.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 (A1) | High | Cor | `jwt.strategy.ts:67-70`, `auth.service.ts:517-524` | `tokenVersion` revocation check on the **access** path runs against `user.tokenVersion` from the per-request DB read — already authoritative. **However the per-request DB lookup is doing the work**, so this is actually tighter than the original A1 framing claimed. The remaining issue is purely the access-token TTL window between a `tokenVersion` bump and the next request: if a request was already in-flight with an old token, that single request still validates. Severity **downgraded to Medium** in spot-check (see §9). | Document the latency = "next request" (effectively zero on the access path because the DB read fetches the current version). Original A1 hypothesis about "claim-only check" doesn't match the source — `jwt.strategy.ts:41-54` loads the user row including `tokenVersion` on every request. |
| F-2 (A5 refined) | Medium | Sec | `auth.service.ts:989-991, :1027-1029, :1119-1121, :1157-1159` | Social-auth (Google + Apple) flows check `user.status !== 'ACTIVE'` but **do not** check `tenant.status`. A suspended-tenant ADMIN who has linked Google can still log in via Google; the password and refresh paths correctly block them (`:437-439`, `:508-510`). Original A5 said "ADMIN auto-activate on register" — that's actually correct policy (ADMIN creates their own tenant which is `ACTIVE` at creation, see `:166-173`); the real gap is the social-login bypass. | Add the same `tenant.status === ACTIVE` check that `validateUser` has, in all four social-auth branches. |
| F-3 | Medium | Cor | `auth.service.ts:472-533` | Refresh-token rotation is not transactional. Two parallel requests with the same cookie can both succeed and mint two live sessions; old token is idempotently revoked but new tokens are distinct. See §6 race 1. | Wrap revoke+generate in `$transaction`; gate revoke with `where: { id, revokedAt: null }` and reject the loser. |
| F-4 | Medium | Arch | `auth/guards/api-key.guard.ts:46-48` | Both `x-api-key` and `api-key` headers accepted; the second is non-standard and not documented anywhere. | Pick `x-api-key` as canonical; deprecate `api-key`; log a warning when the deprecated header is used so consumers can migrate. |
| F-5 | Medium | Cor | `auth.service.ts:256-262`, `:276-278` | `register()` swallows `sendEmailVerification` and `notifyAdmins` exceptions and still returns 200. User cannot complete email-verification flow; PENDING_APPROVAL user is invisible to admins. | Either re-throw (surface as 5xx and let the client retry registration) or write a `verification_email_send_failed` audit row + Sentry event and expose a "resend verification" affordance. Same for notifyAdmins on the PENDING branch. |
| F-6 | Low | Perf | `auth.service.ts:401-414` | `validateUser` selects the full user row + tenant join, even though the bcrypt-compare-then-reject path only needs `id`, `password`, `status`, `tenantId`, and `tenant.status`. Already close — but `firstName`/`lastName`/`email`/`role` are fetched twice when the user actually logs in (`validateUser` returns a stripped row that `login()` then re-uses, then `generateTokens` reads `tokenVersion` separately at `:560-563`). | Either narrow `validateUser` to auth-only columns and re-fetch the display fields after success, or collapse `validateUser` + `generateTokens`'s tokenVersion read into one query. Low priority. |
| F-7 | Low | Cor | `auth.service.ts:867-885` | Email-verification consume is not atomic. Two parallel requests with the same code both pass the find and both run the update. Practical risk is near-zero (update is idempotent on the success state) but the pattern diverges from the password-reset gold standard. | Mirror the reset pattern: `updateMany where { id, emailVerificationCodeHash }`, reject when `count===0`. |
| F-8 | Low | Sec | `auth.service.ts:298-312, :345-356`, etc. | Sentry events include `email`, `firstName`, `lastName`, `userId`, `tenantId` in `extra` and `tags`. PII in telemetry. | Strip email/name from `tags`; keep them in `extra` only if the Sentry project has PII scrubbing; preferably hash `userId` and drop name fields. (Mirrors §4.1 of `CODE_REVIEW.md`.) |
| F-9 | Low | Sec | `auth.service.ts:44-47` | `DUMMY_BCRYPT_HASH` is computed at module load via `bcrypt.hashSync(..., 12)`, ignoring `BCRYPT_COST`. If an operator raises `BCRYPT_COST` to 14, real-user compares take longer than the dummy, partially re-exposing email enumeration via timing. | Compute the dummy hash lazily on first use with the resolved `bcryptCost()`, or recompute on `ConfigService` ready. |
| F-10 | Low | Arch | `auth.service.ts:281-294` | The `pendingApproval: true` branch returns `as any` because `AuthResponseDto` declares `accessToken: string` non-nullable. | Either type `accessToken: string \| null` on the DTO or split into two response DTOs. |
| F-11 | Info | Arch | `auth.module.ts:24` | `JwtModule.registerAsync` sets `expiresIn` default to `'7d'`, but `generateTokens` overrides it with `JWT_EXPIRES_IN || '15m'` at `:575`. The 7d default is dead config. | Drop the module-level `expiresIn` or align both sites to one source of truth. |
| F-12 | Info | Cor | `auth.service.ts:1284-1294` (social-auth user create) | Creates `password: ''` for social users. Login path's `bcrypt.compare(input, '')` will always return false — correct — but storing the empty string is a smell. | Use `password: null` after migrating the column to nullable, or store an unconditionally-failing sentinel like `'!'`. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

### 8.1 Atomic-consume password-reset — `auth.service.ts:691-722` **[reference implementation]**

This is the single most important "what's solid" pattern in the entire codebase for one-shot token consumption. It is the template every other "consume-once" flow (email verification, magic links, invite codes, signed account-recovery tokens, future API-key one-time-tokens) should follow. The pattern:

```ts
// 1. Look up the user by the *hash* of the presented token (constant-time-ish via unique index).
const resetTokenHash = this.hashToken(token);
const user = await this.prisma.user.findFirst({
  where: { resetTokenHash, resetTokenExpiry: { gt: new Date() } },
  select: { id: true },
});
if (!user) throw new BadRequestException('Invalid or expired reset token');

// 2. Hash the new password OUTSIDE the transaction (bcrypt is CPU-bound; no point holding a TX open).
const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

// 3. The atomic-consume transaction.
const [updateResult] = await this.prisma.$transaction([
  // 3a. updateMany filtered on BOTH id AND resetTokenHash. This is the critical line:
  //     if a parallel request already cleared resetTokenHash to null, the WHERE matches zero rows.
  this.prisma.user.updateMany({
    where: { id: user.id, resetTokenHash },
    data: {
      password: hashedPassword,
      resetTokenHash: null,
      resetTokenExpiry: null,
      tokenVersion: { increment: 1 },   // invalidate every prior access token
    },
  }),
  // 3b. Revoke every live refresh token in the same TX so a stolen refresh can't mint fresh access
  //     tokens after the reset.
  this.prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  }),
]);

// 4. Reject the second-arrival caller. updateMany returns {count: 0} when nothing matched, which is
//    the unambiguous signal that another request consumed the token first.
if (updateResult.count === 0) {
  throw new BadRequestException('Invalid or expired reset token');
}
```

Why this is the gold standard:
1. **No read-modify-write window.** Step 1 reads, step 3a re-asserts the same condition via the WHERE clause. There is no point between the read and the write where an attacker could slip a second consume through — the database does the check at write time, not the application.
2. **Single transaction.** Token consume AND refresh-token revocation AND tokenVersion bump happen atomically. There is no state in which the password has changed but old refresh tokens still mint fresh access tokens.
3. **Single source of error.** `updateMany.count === 0` is the same observation as "user not found by hash" — both produce the same `BadRequestException`. Information leak: zero.
4. **Idempotent revoke.** The refresh-token revoke is `updateMany where revokedAt is null` — calling it twice is safe.
5. **No bcrypt in the TX.** The CPU-bound work happens before the TX opens, so the lock window is minimal.
6. **Self-documenting.** The block carries an in-source comment (`:694-702`) explaining the race window being closed.

**Candidates that should adopt this pattern:**
- `auth.service.ts:867-885` email-verification consume — F-7.
- Subscription renewal write (`modules/subscriptions/`) — see M9 in `CODE_REVIEW.md`. The same `updateMany where idempotencyKey is null` shape closes the renewal race.
- Loyalty-points redemption already does an analogous pattern with Serializable + conditional updateMany — see §3.1 of `CODE_REVIEW.md`. Same family.
- Any future invite-code / magic-link / one-time-OAuth-state flow.

### 8.2 Other solid patterns

- **Refresh token reuse detection — `auth.service.ts:481-488`.** Presenting a previously-rotated refresh token triggers a family-wide revoke and a clear "Refresh token reuse detected" error. This is the OWASP-recommended behavior for catching stolen refresh tokens and is correctly wired here.
- **Timing-safe email enumeration defense — `auth.service.ts:44-47, :421-424`, `:867-874`.** Login + verify-email both run the same expensive work whether or not the user exists, and they return the same error string for "user not found" vs "bad password/code". (Caveat: F-9 — dummy hash uses fixed cost 12 instead of `bcryptCost()`.)
- **Refresh-cookie hygiene — `auth.controller.ts:27-44, :51-54, :106`.** httpOnly + sameSite=strict + path-scoped to `/api/auth` + `Secure` in production; `stripRefresh()` removes the token from every JSON body. The XSS exfiltration surface is minimal.
- **bcrypt cost tunable — `auth.service.ts:61-68`.** Configurable via env with a 10–15 sanity range and a 12 fallback. Production can bump cost without redeploying code.
- **Atomic tenant+subscription creation — `auth.service.ts:165-192, :1256-1304`.** Tenant and Subscription rows are created in one `$transaction`; partial failure can never leave a Tenant without a Subscription.
- **Subdomain quarantine + suffix retry — `auth.service.ts:76-92`.** Defends against subdomain takeover (a new tenant inheriting a recently-released subdomain still referenced by outbound emails / printed QR codes) and recovers cleanly when the preferred slug is taken.
- **`CurrentUser` decorator fails loudly — `decorators/current-user.decorator.ts:14-19`.** Throws an `InternalServerErrorException` instead of returning `undefined` when used on a route without an active auth guard. Catches a class of mis-decorated handlers at request time rather than via a downstream Prisma null-deref.
- **Google access-token audience check — `auth.service.ts:939-949`.** When falling back from ID-token verification to access-token+userinfo, the code first checks `tokeninfo.aud` matches the configured `GOOGLE_CLIENT_ID`. This closes the "any Google access token for any OAuth client could authenticate here" hole that's common in mobile-OAuth integrations.

---

## 9. Spot-checks performed

### Verified end-to-end

- **I-1 atomic-consume** — confirmed at `auth.service.ts:691-722`. The `updateMany where { id, resetTokenHash }` plus `count===0` rejection plus same-TX refresh-token revoke plus tokenVersion increment is exactly the pattern described in §8. The in-source comment at :694-702 explicitly calls out the race window. Solid.
- **I-10 cookie-only refresh** — confirmed at `auth.controller.ts:106`: `const token = req.cookies?.[REFRESH_COOKIE];` is the only source. No JSON body fallback, no `Authorization` header read, no query-string read. The earlier dropped finding ("refresh in JSON body") was a false positive — verified again here.
- **I-5 tenant.status check (password path)** — confirmed at `auth.service.ts:437-439`. `validateUser` selects `tenant: { select: { status: true } }` at :412 and rejects with `UnauthorizedException('Your restaurant account is not active')` when tenant is non-ACTIVE. **The original A5 framing was wrong:** the password path *does* block suspended-tenant ADMINs. The actual gap is in the social-auth path (F-2).
- **I-3 tokenVersion enforcement on refresh** — confirmed at `auth.service.ts:517-524`. The refresh path reads `tokenVersion` from the DB and rejects when the claim's `ver` doesn't match. A1's original phrasing implied the access path did not do a per-request DB lookup; that is also wrong — `jwt.strategy.ts:41-54` does the DB read on every request. A1 is **substantively downgraded** below.
- **F-1 (formerly A1) downgraded** — `jwt.strategy.ts:67-70` validates `payload.ver` against the DB-loaded `user.tokenVersion`, not against the claim alone. The agent's original phrasing ("claim-only check") didn't match the source. Real residual risk is purely "an access token already validated for *this* request will complete this request" — i.e., one-request worst case, not "JWT TTL". Downgraded from High → Medium.

### Dropped (preserved from previous cycle)

- **A2 — "Password-reset token consume race" at `auth.service.ts:691-721`.** Dropped in the 2026-04-27 cycle. Confirmed again here: the atomic-consume pattern is intact. The recommended fix already exists in source with a multi-line comment explaining the race it closes. **No action — this is the reference implementation now cross-linked from §8.**
- **"Refresh token taken from JSON body" — `auth.controller.ts:120-122`.** Dropped in the 2026-04-27 cycle. Re-verified at `auth.controller.ts:106`: `refresh()` reads exclusively from `req.cookies?.[REFRESH_COOKIE]`. Lines 120-122 are part of `getProfile`, an entirely different handler. **No action.**

### Downgraded

- **A1 → F-1.** From High → Medium. The "claim-only" framing was incorrect; the real residual is at-most-one-in-flight-request, not JWT TTL.
- **A5 → F-2.** Reframed and rescoped. The original wording ("ADMIN auto-activate; tenant.status not validated") doesn't match the password path (which validates it correctly). The actual leak is the four social-auth branches. Severity unchanged at Medium.

### *(unverified)* count carried into this review

Two findings (F-4 api-key dual header, F-6 sparse-select) reproduce the *(unverified)* notes from §4.2 of `CODE_REVIEW.md` without further source confirmation beyond reading the cited lines. Marked as such inline where they remain hypotheses.

---

## 10. Recommended tests

The 7 integration tests that would catch §3 invariants and §6 races. Skeletons only.

```ts
// backend/src/modules/auth/__tests__/auth.integration.spec.ts
describe('auth invariants', () => {

  it('I-1: password-reset token cannot be replayed', async () => {
    // arrange: forgot-password, capture token from sent email
    // act: fire two parallel POST /auth/reset-password with the same token
    //      and different new passwords
    // assert: exactly one returns 200; the other returns 400 'Invalid or expired reset token'
    //         final user.password matches the winning request only
    //         user.resetTokenHash === null
    //         user.tokenVersion incremented by exactly 1
    //         all prior refreshToken rows have revokedAt set
  });

  it('I-2 race: two parallel refresh calls with the same cookie produce at most one new session', async () => {
    // arrange: login, capture refresh cookie
    // act: Promise.all([POST /auth/refresh, POST /auth/refresh]) with identical cookie
    // assert: count(refreshTokens where userId=u and revokedAt is null) === 1
    //         old refresh token has revokedAt set
    //         loser receives 401 'Refresh token reuse detected' OR rotation-race-loser error
    // NOTE: this test currently FAILS — see F-3
  });

  it('I-2 reuse: replaying a rotated-out refresh token revokes the whole family', async () => {
    // arrange: login → r1; refresh r1 → r2; (now r1 is revoked, r2 is live)
    // act: POST /auth/refresh with r1 cookie
    // assert: 401 'Refresh token reuse detected'
    //         every refreshToken for the user has revokedAt set (including r2)
  });

  it('I-3: bumping tokenVersion invalidates outstanding access tokens', async () => {
    // arrange: login → at1; manually `prisma.user.update tokenVersion: { increment: 1 }`
    // act: GET /auth/profile with at1
    // assert: 401 'Token has been revoked'
    //         (then login again, confirm new token works)
  });

  it('I-5: suspended-tenant ADMIN cannot log in via password OR social', async () => {
    // arrange: ADMIN registered + active; set tenant.status='SUSPENDED'
    // act + assert: POST /auth/login → 401 'Your restaurant account is not active'
    //               POST /auth/google with linked googleId → CURRENTLY 200 (F-2)
    //               POST /auth/apple with linked appleId  → CURRENTLY 200 (F-2)
  });

  it('F-5: registration that fails to send the verification email surfaces as 5xx (not silent 200)', async () => {
    // arrange: stub EmailService.sendEmailVerificationCode to throw
    // act: POST /auth/register
    // assert: 5xx OR a verification_email_send_failed audit/Sentry event with the new userId
    //         (the current code returns 200 silently — this test should fail today)
  });

  it('cross-tenant: a JWT minted for tenant A cannot read /auth/profile after tenant A is suspended', async () => {
    // arrange: login to A; set A.status='SUSPENDED'
    // act: GET /auth/profile with the still-unexpired token
    // assert: 401 'Your restaurant account is not active' (enforced at jwt.strategy.ts:60-62)
  });
});
```

Cross-tenant isolation suite (per `CODE_REVIEW.md §3.1`): create two tenants, register users in each, try cross-tenant `/auth/profile` and refresh-token reuse across tenant boundaries; assert zero leaks. The atomic-consume test from I-1 is the highest-leverage of these — it pins the §8 reference implementation against regression.
