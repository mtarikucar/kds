# `frontend-auth-stores` — Deep Review (2026-05-11)

**Tier:** 1 (frontend parity — token/session contract is the identity boundary on the client)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/store/authStore.ts`, `frontend/src/store/marketingAuthStore.ts`, `frontend/src/store/superAdminAuthStore.ts`, `frontend/src/store/cartStore.ts` (briefly)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — §3.2 (auth & token model), §5.2 (seed: `tempToken + requires2FA + requires2FASetup` duplicate state); [`auth.md`](auth.md) §3 I-10 (refresh-token cookie-only contract)

---

## 1. Health & summary

🟡 yellow

The three frontend auth stores together hold the client side of the access-token / refresh-token contract that `backend/src/modules/auth/` issues. `authStore` (tenant users) and `marketingAuthStore` (SALES_REP / SALES_MANAGER) both **correctly** keep `accessToken` in memory and rely on either an httpOnly refresh cookie (`authStore`) or memory-only refresh state (`marketingAuthStore`). `cartStore` is non-auth — it persists cart items and a session id, no credentials. The CODE_REVIEW.md §3.2 summary that "frontend tokens never touch `localStorage`" is **true for two of the three stores but false for `superAdminAuthStore`**: its `partialize` block at `superAdminAuthStore.ts:93-97` persists `accessToken` to `localStorage` despite the in-file comment immediately above claiming the *refresh* token is "deliberately NOT persisted" — the comment defends a weaker invariant than the upstream review documents. This is the single highest-leverage finding in this file and is **upgraded from CODE_REVIEW.md's prior "🟢 green"** for the store layer.

The §5.2 seed is real and stands: `superAdminAuthStore` carries **three boolean flags** (`tempToken: string | null`, `requires2FA: boolean`, `requires2FASetup: boolean`) that encode what is logically a four-state enum (`IDLE | NEEDS_2FA_ENTRY | NEEDS_2FA_SETUP | AUTHENTICATED`). The flags are mutated through three setters (`setTempToken`, `setRequires2FA`, `setRequires2FASetup`) that can independently drift, and consumers in `pages/superadmin/SuperAdmin2FAPage.tsx:21-41` read all three plus `isAuthenticated` to decide which view to render — four booleans, sixteen combinations, only four legal. Refactoring to a single enum collapses the orphan combinations and is straightforward because all writes are localized to this file.

Health is yellow rather than red because (a) the persisted-`accessToken` exposure is bounded by the JWT TTL and a `tokenVersion` revocation on the backend (`auth.md` I-3), and (b) the flag-soup state machine is currently consistent on the happy path — the orphan combinations are reachable only through partial setter calls that no code path currently makes. Both findings are nonetheless real and fixable in S-effort.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/store/authStore.ts` (77 LOC) — tenant-user store, memory-only access token, httpOnly refresh cookie, sync `logout()` reentrancy-safe.
- `frontend/src/store/marketingAuthStore.ts` (68 LOC) — SALES_* role store, memory-only access + refresh, body-passed refresh on retry.
- `frontend/src/store/superAdminAuthStore.ts` (100 LOC) — superadmin store, 2FA pre-login state, persists access token to localStorage.
- `frontend/src/store/cartStore.ts` (226 LOC) — confirmed non-auth (cart items + sessionId only; no credentials).

**Skimmed (cross-link only, not reviewed end-to-end here):**
- `frontend/src/lib/api.ts:38-58` — single-flight refresh against `authStore`.
- `frontend/src/lib/socket.ts:40-47, :97-104` — token-rotation subscription against `authStore.accessToken`.
- `frontend/src/components/ProtectedRoute.tsx:10-26` — render gate using `authStore.isAuthenticated`.
- `frontend/src/features/marketing/api/marketingApi.ts:29-50` — marketing 401 handler reading `refreshToken` from store and POSTing it in the JSON body.
- `frontend/src/features/superadmin/api/superAdminApi.ts:50-89` — superadmin 401 handler reading `refreshToken` from store and POSTing it in the JSON body.
- `frontend/src/features/superadmin/api/superAdminApi.ts:92-187` — login/verify/setup-2FA mutations writing the four flags via `setTempToken`/`login`.
- `frontend/src/features/superadmin/components/SuperAdminProtectedRoute.tsx:5-13` — render gate using the flag tuple.
- `frontend/src/pages/superadmin/SuperAdmin2FAPage.tsx:9-41` — consumer that reads all four flags.

**Skipped:**
- Backend `auth.service.ts` token issuance — covered in [`auth.md`](auth.md).
- 2FA TOTP mechanics on the server — covered in [`superadmin.md`](superadmin.md).

---

## 3. Business-logic invariants

The contract the auth stores own on the client side. Each invariant is testable in a Vitest/Jest unit test against the store and a Playwright/Cypress test for cross-tab / reload behavior.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | `accessToken` is held **in memory only** and never written to `localStorage` / `sessionStorage` / IndexedDB. An XSS on the origin cannot exfiltrate it from persistent storage. | `authStore.ts:70-74` (partialize omits `accessToken`); `marketingAuthStore.ts:62-65` (partialize omits both tokens) — **VERIFIED**. **VIOLATED** at `superAdminAuthStore.ts:93-97` (partialize *includes* `accessToken`) — see F-1. | ❌ none | XSS → highest-privilege superadmin token exfiltration (bounded by JWT TTL + backend `tokenVersion` rotation, but still a real session-takeover primitive) |
| I-2 | The **refresh** token never touches client storage. For tenant users it lives only in the backend-set httpOnly cookie scoped to `/api/auth`; for superadmin and marketing it lives only in store memory and is dropped on reload. | `authStore.ts` has no `refreshToken` field at all — refresh is via cookie (`lib/api.ts:42-47` posts an empty body and relies on `withCredentials`); `marketingAuthStore.ts:62-65` partialize omits `refreshToken`; `superAdminAuthStore.ts:93-97` partialize omits `refreshToken`. The comment at `superAdminAuthStore.ts:89-92` documents this explicitly. — **VERIFIED** | ❌ none | XSS → long-lived (30-day) refresh-token exfiltration; persistent session takeover that survives JWT TTL |
| I-3 | The store state enum is **exhaustive** — every flag combination reachable through public setters represents a legal state. | `authStore.ts` has only `{user, accessToken, isAuthenticated}` — 8 combinations, all legal in practice; `marketingAuthStore.ts` has `{user, accessToken, refreshToken, isAuthenticated}` — 16 combinations, all legal on the happy path. **VIOLATED** at `superAdminAuthStore.ts:9-13, :47-52` — `tempToken / requires2FA / requires2FASetup / isAuthenticated` encode 16 combinations but only 4 are legal (see §4 + F-2). | ❌ none | UI renders inconsistent state (`requires2FA && requires2FASetup` both true; `tempToken` set without either flag); login state-machine drift |
| I-4 | `logout()` clears **all** token state (access + refresh + temp + role flag) **atomically** in a single Zustand `set()` call, so no observer ever sees `accessToken=null` while `isAuthenticated=true` (or vice versa). | `authStore.ts:60-66` (single `set` with three fields); `marketingAuthStore.ts:46-53` (single `set` with four fields); `superAdminAuthStore.ts:75-85` (single `set` with seven fields, including `tempToken`, `requires2FA`, `requires2FASetup`). — **VERIFIED** | ❌ none | Render-during-logout could leak protected-route content for one tick if cleared field-by-field |
| I-5 | The three stores **do not share state**. A logout on one (tenant) must not log the user out of the others (superadmin / marketing), and vice versa — they are distinct identity domains with distinct refresh endpoints. | Three separate `create()` calls with three distinct `persist` names: `'auth-storage'` (`authStore.ts:69`), `'marketing-auth-storage'` (`marketingAuthStore.ts:56`), `'superadmin-auth-storage'` (`superAdminAuthStore.ts:88`). Each store's `logout()` only mutates its own slice. — **VERIFIED** | ❌ none | Cross-domain logout cascade; surprising UX where logging out of marketing kicks the user out of the tenant admin |
| I-6 | The `lib/api.ts` axios interceptor reads only from `useAuthStore` and never touches the other two stores. The marketing and superadmin features use their own dedicated axios instances. | `lib/api.ts:20, :50, :76` (uses `useAuthStore` exclusively); `features/marketing/api/marketingApi.ts:13, :29-30, :43, :47` (uses `useMarketingAuthStore` exclusively); `features/superadmin/api/superAdminApi.ts:38, :51, :60, :81` (uses `useSuperAdminAuthStore` exclusively). — **VERIFIED** | ❌ none | A marketing 401 could blow away the tenant-admin session |
| I-7 | The persisted `isAuthenticated` flag is treated as **a hint, not proof**: every protected fetch path must still attach the in-memory access token (which is null on reload) and rely on a 401-driven refresh to populate it. | `authStore.ts:73` partialize persists `isAuthenticated` for shell rendering only; `lib/api.ts:20-23` attaches the token if present and otherwise lets the request 401 → refresh. The comment at `authStore.ts:11-13` documents the trade-off. — **VERIFIED** for tenant store. | ❌ none (see F-3 ProtectedRoute flicker) | Render of protected content before authentication is actually confirmed (already filed as F2 in CODE_REVIEW.md §2) |

Invariants I-3 and I-1 are the two that are currently violated. The others are upheld.

---

## 4. State machine

The tenant (`authStore`) and marketing (`marketingAuthStore`) stores follow a simple two-state model. The superadmin store carries the full 2FA-bracketed flow and is the one that warrants the diagram.

**Tenant / marketing state enum** (implicit — not encoded as a discriminated union today):

`LOGGED_OUT` → `CREDENTIAL_SUBMITTED` (in-flight POST `/auth/login`) → `AUTHENTICATED` → `REFRESHING` (in-flight POST `/auth/refresh`) → `AUTHENTICATED` (rotated token) → `LOGGED_OUT`.

The store itself does not model `CREDENTIAL_SUBMITTED` or `REFRESHING` — both are TanStack-Query mutation/in-flight-promise concerns (`features/auth/authApi.ts:11-15`, `lib/api.ts:38-58`). The store knows only `LOGGED_OUT` (`isAuthenticated=false`) vs `AUTHENTICATED` (`isAuthenticated=true && accessToken!=null` — or `accessToken==null` immediately after a reload, see I-7 and F-3).

**Superadmin state machine** (the §5.2 seed lives here):

```
                  POST /superadmin/auth/login
LOGGED_OUT ─────────────────────────────────────► CREDENTIAL_SUBMITTED
                                                          │
                            ┌─────────────────────────────┼─────────────────────────┐
                            │ data.requires2FASetup       │ data.requiresTwoFactor   │ data.accessToken
                            ▼                              ▼                          ▼
                  NEEDS_2FA_SETUP                   NEEDS_2FA_ENTRY             AUTHENTICATED
                  (tempToken set,                   (tempToken set,             (full login())
                   requires2FASetup=true)            requires2FA=true)
                            │                              │                          │
                            │ POST enable-with-token       │ POST verify-2fa          │
                            ▼                              ▼                          │
                       AUTHENTICATED ◄──────────── AUTHENTICATED                      │
                            │                                                          │
                            │  401 from any route                                      │
                            ▼                                                          │
                       REFRESHING ──────► AUTHENTICATED (rotated) ────────────────────┤
                            │                                                          │
                            │ refresh fails                                            │
                            ▼                                                          ▼
                       LOGGED_OUT ◄────────────────────────────────────────── (explicit logout)
```

**Transition guards (`file:line`):**

| From → To | Trigger | Guard | Side effects |
|-----------|---------|-------|--------------|
| `LOGGED_OUT → CREDENTIAL_SUBMITTED` | `useSuperAdminLogin.mutate({email,password})` | `superAdminApi.ts:96-99` | POST `/superadmin/auth/login` |
| `CREDENTIAL_SUBMITTED → NEEDS_2FA_SETUP` | response `requires2FASetup && tempToken` | `superAdminApi.ts:101-103` → `setTempToken(token, true)` at `superAdminAuthStore.ts:47-53` | sets `tempToken`, `requires2FA=false`, `requires2FASetup=true` |
| `CREDENTIAL_SUBMITTED → NEEDS_2FA_ENTRY` | response `requiresTwoFactor && tempToken` | `superAdminApi.ts:104-106` → `setTempToken(token, false)` | sets `tempToken`, `requires2FA=true`, `requires2FASetup=false` |
| `CREDENTIAL_SUBMITTED → AUTHENTICATED` | response carries `accessToken + refreshToken + superAdmin` (2FA disabled account — none today, but supported) | `superAdminApi.ts:107-109` → `login(...)` at `superAdminAuthStore.ts:63-73` | sets full identity, clears `tempToken`, clears both flags |
| `NEEDS_2FA_ENTRY → AUTHENTICATED` | `useVerify2FA.mutate({tempToken, code})` | `superAdminApi.ts:122-126` → `login(...)` | clears `tempToken`, `requires2FA`, `requires2FASetup` atomically |
| `NEEDS_2FA_SETUP → AUTHENTICATED` | `useEnable2FAWithToken.mutate({tempToken, code})` | `superAdminApi.ts:167-171` → `login(...)` | same atomic clear |
| `AUTHENTICATED → REFRESHING` | 401 on any protected request | `superAdminApi.ts:69-77` (in-flight singleton) | POST `/superadmin/auth/refresh` with `refreshToken` in JSON body |
| `REFRESHING → AUTHENTICATED` | refresh response carries `accessToken` | `superAdminApi.ts:59-61` → `setAccessToken` | only the access token changes; refreshToken is not rotated client-side |
| `REFRESHING → LOGGED_OUT` | refresh throws or 401s | `superAdminApi.ts:80-84` → `logout()` + redirect | clears all seven fields |
| `* → LOGGED_OUT` | explicit `useSuperAdminLogout` (`superAdminApi.ts:175-187`) or `handleCancel` on 2FA page (`SuperAdmin2FAPage.tsx:52-54`) | `superAdminAuthStore.ts:75-85` | clears all seven fields atomically |

**Forbidden transitions** (must be guarded; currently *not* guarded by the type system — only by convention):

- `NEEDS_2FA_ENTRY ↔ NEEDS_2FA_SETUP` directly without going through `LOGGED_OUT` — would mean a user mid-verification switches into setup mode (or vice versa). Today `setTempToken(_, needsSetup)` writes both flags in a single `set()` so the transition is atomic-replace, not "set one then the other", so this is implicitly safe. The risk is a future caller invoking `setRequires2FA(true)` directly (`superAdminAuthStore.ts:55-57`) and leaving `requires2FASetup` true → both flags simultaneously true. **No callers do this today** but the public setter exposes the foot-gun.
- `AUTHENTICATED → NEEDS_2FA_*` — would mean a logged-in user is bounced back to 2FA. There is no path to this in current code, but again no type-level guard.

**Orphan flag combinations (the §5.2 seed):**

The product space of `{tempToken: ∅|string} × {requires2FA: t|f} × {requires2FASetup: t|f} × {isAuthenticated: t|f}` is 16 states. Of those, **only 4 are legal**:

| `tempToken` | `requires2FA` | `requires2FASetup` | `isAuthenticated` | Legal name |
|---|---|---|---|---|
| `null` | `false` | `false` | `false` | `LOGGED_OUT` |
| `string` | `true` | `false` | `false` | `NEEDS_2FA_ENTRY` |
| `string` | `false` | `true` | `false` | `NEEDS_2FA_SETUP` |
| `null` | `false` | `false` | `true` | `AUTHENTICATED` |

Every other combination is an orphan — e.g. `requires2FA=true && requires2FASetup=true` (both true), `tempToken=null && requires2FA=true` (lost temp), `isAuthenticated=true && requires2FA=true` (logged in but bounced to 2FA). The setters at `superAdminAuthStore.ts:55-61` make orphans reachable: a caller invoking `setRequires2FA(true)` while `requires2FASetup` is already true produces "both true". Today no caller does this, but the type does not forbid it.

**Recommended replacement** (collapse to a discriminated union):

```ts
type SuperAdminAuthState =
  | { kind: 'LOGGED_OUT' }
  | { kind: 'NEEDS_2FA_ENTRY';  tempToken: string }
  | { kind: 'NEEDS_2FA_SETUP';  tempToken: string }
  | { kind: 'AUTHENTICATED';    superAdmin: SuperAdmin; accessToken: string; refreshToken: string };
```

This makes all 12 orphan states unrepresentable. See F-2 / §10 test T-1.

---

## 6. Concurrency hazards

The frontend has no transactional concurrency (no Serializable, no advisory locks), but the auth stores sit at three real race windows that the upstream review (`CODE_REVIEW.md §3.2`, F-2, F-3) already flagged at a high level. Pinning them to `file:line` here.

**H-1 — Multi-tab refresh race against `useAuthStore` (mitigated single-tab, open multi-tab).**

*Sketch:* Two tabs open on the same origin both hold `accessToken=A1` in their own JS heaps. A1 expires. Tab #1 fires a request, gets 401, kicks off `refreshAccessToken()` at `lib/api.ts:40-58`, receives `A2`, writes it into its own `useAuthStore.accessToken`. Tab #2 fires a request in the same window, also gets 401, also kicks off `refreshAccessToken()` — but because the `refreshInFlight` singleton at `lib/api.ts:38` is **per-tab (per JS realm)**, Tab #2 does *not* join Tab #1's promise. It posts a second `/auth/refresh` with the same httpOnly cookie. Whichever lands second hits the backend's refresh-reuse detection (`auth.md` I-2 — `auth.service.ts:481-488`) and revokes the entire family, kicking *both* tabs to /login.

*Where:* `lib/api.ts:38` (singleton scope), `superAdminApi.ts:48` (same pattern).

*Severity:* Medium Cor — annoying UX, not security. Fix is a `BroadcastChannel('auth-refresh')` or a `localStorage`-event mediator that coalesces refresh attempts across tabs. Stays out of the access-token write path so the memory-only invariant is unchanged.

**H-2 — Persist-hydration race (the F2 in CODE_REVIEW.md §2, pinned).**

*Sketch:* On reload, Zustand's `persist` middleware reads `'auth-storage'` from localStorage synchronously and rehydrates `{user, isAuthenticated}` (`authStore.ts:71-74`). `accessToken` is **not** persisted (correct), so the rehydrated state is `{user: U, accessToken: null, isAuthenticated: true}` — the "lies on reload" state described in I-7. `ProtectedRoute` (`components/ProtectedRoute.tsx:13`) reads only `isAuthenticated` and renders children immediately. Children mount, fire their `useQuery` hooks, which hit `lib/api.ts` with `Authorization: undefined` (because `state.accessToken` is null per `:20-23`), get 401, trigger the single-flight refresh at `:40-58`, get `A_new`, retry — **one extra round-trip + a flash of children rendered without data**.

*Where:* `ProtectedRoute.tsx:11-13` reads `isAuthenticated` without waiting for the refresh-handshake; superadmin equivalent at `SuperAdminProtectedRoute.tsx:5-9` *would* avoid this because it persists `accessToken` (F-1) — i.e. the wrong fix to the right problem.

*Severity:* Medium Cor (UX) — same severity as upstream F2. The clean fix is a `useAuthBoot()` hook that calls `/auth/refresh` once at app start and blocks the route tree on a `Suspense` boundary while the promise is in-flight. The dirty fix in `SuperAdminProtectedRoute` (persisting the token) trades a UX race for a security exposure — do not adopt.

**H-3 — Logout race across tabs.**

*Sketch:* Tab #1 calls `useLogout()` → POST `/auth/logout` (backend revokes refresh cookie + bumps `tokenVersion`) → `logout()` clears the in-memory `accessToken`. Tab #2 is mid-request with the **old** `accessToken=A1` already attached. The request lands on the backend, the JWT strategy at `backend/.../jwt.strategy.ts:67-70` checks `tokenVersion` against the new DB stamp, rejects with 401. Tab #2's interceptor at `lib/api.ts:68-79` tries to refresh — refresh cookie is gone, backend rejects, `logout()` fires in Tab #2 and bounces to /login. **Correct outcome**, but Tab #2's logout is *not* coordinated with Tab #1's: Tab #2's in-memory state stays `isAuthenticated=true` until it makes its next request. A tab that is idle (e.g. POSPage with no polling) after a sibling logged out will continue to render the authenticated shell from persisted state until the user touches it.

*Where:* No cross-tab logout listener anywhere in `frontend/src/store/`; persisted `isAuthenticated` at `authStore.ts:73`, `marketingAuthStore.ts:64`, `superAdminAuthStore.ts:96` is never invalidated by a sibling tab.

*Severity:* Medium Sec — the access-token check on the backend will still reject, so no privileged action gets through. The risk is the UI continuing to show the post-login shell (including potentially stale cached data via TanStack Query) after the session has been globally revoked. Fix is the same `BroadcastChannel` as H-1, with a `logout` message that fires `useAuthStore.getState().logout()` in every listener tab.

**No critical sections to protect** — there is no shared-state mutation between the three stores; I-5 is upheld by construction (separate `create()` calls).

**No idempotency keys needed** — store mutations are local JS state, not network writes.

---

## 7. Findings

`*(unverified)*` would mean a claim that I have not opened at the cited line. Every finding below is verified end-to-end at the cited `file:line` in this review.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Sec | `superAdminAuthStore.ts:93-97` | `partialize` includes `accessToken` in the persisted slice, writing the highest-privilege access token to `localStorage` under `'superadmin-auth-storage'`. The in-file comment at `:89-92` documents only that the *refresh* token is omitted, not that the access token is included — a reader of the comment alone would infer the invariant is upheld. This contradicts the CODE_REVIEW.md §3.2 claim that "frontend tokens never touch `localStorage`" and breaks I-1 for the superadmin store. **Mitigations:** access token TTL is short (per `auth.md` I-3) and a server-side `tokenVersion` bump invalidates it on next request — but XSS-on-the-superadmin-origin during the TTL window still yields a session-takeover primitive. | Drop `accessToken` from the `partialize` return at `:93-97`. On reload, accept the same one-401-then-refresh roundtrip the tenant store accepts; or, if the UX of "stay logged in across reloads" is required, route the superadmin refresh through an httpOnly cookie the way `authStore` does (parallel work in `backend/src/modules/superadmin/superadmin-auth.controller.ts`). |
| F-2 | Medium | Arch | `superAdminAuthStore.ts:9-13, :47-61` | Three boolean/string fields (`tempToken`, `requires2FA`, `requires2FASetup`) encode what is logically a 4-state enum (§4 table). 12 of 16 flag combinations are orphans; setters at `:55-61` expose a foot-gun to reach them. (This is the **§5.2 seed**, restated and pinned.) | Replace with a discriminated union (`kind: 'LOGGED_OUT' | 'NEEDS_2FA_ENTRY' | 'NEEDS_2FA_SETUP' | 'AUTHENTICATED'`); collapse `setTempToken` / `setRequires2FA` / `setRequires2FASetup` into a single `setPending2FA({kind, tempToken})` writer; delete the standalone `setRequires2FA` / `setRequires2FASetup` setters (no callers today — verified via grep). |
| F-3 | Medium | Cor | `authStore.ts:73` + `ProtectedRoute.tsx:11-13` | Persisting `isAuthenticated=true` while `accessToken` is null (the post-reload state) makes `ProtectedRoute` render protected children before the refresh-handshake resolves. Children fire requests, all 401, single-flight refresh kicks in at `lib/api.ts:38-58`, then everything retries. Causes a brief flash + double-fetch on every reload. (Same as upstream F2 in CODE_REVIEW.md §2; pinned and detailed in §6 H-2.) | Add a top-level `useAuthBoot()` that awaits `/auth/refresh` once at startup before mounting the route tree. While in-flight, render a skeleton. Do **not** "fix" this by persisting the access token. |
| F-4 | Medium | Cor | `superAdminAuthStore.ts` (no field) and `marketingAuthStore.ts:62-65` (`refreshToken` not persisted) | Both stores hold `refreshToken` in memory and POST it in the JSON body (`marketingApi.ts:38-40`, `superAdminApi.ts:55-58`). On hard reload `refreshToken` is gone (correct — protects I-2) but the access token strategy diverges: tenant uses an httpOnly cookie so reload-then-refresh works without re-login; marketing forces re-login on reload (per the persisted-flag behavior); superadmin avoids re-login by persisting the access token (F-1). The three stores implement three different reload UX, which is fine, but the inconsistency is undocumented in the store files. | Add an in-file comment block at the top of each store summarizing its reload strategy (tenant: cookie-refresh; marketing: re-login required; superadmin: token-survives-until-TTL — to be tightened by F-1). Link to `CODE_REVIEW.md §3.2`. |
| F-5 | Medium | Sec | `marketingApi.ts:38-40` and `superAdminApi.ts:55-58` | Refresh tokens are POSTed in the **JSON request body** rather than via httpOnly cookie. While they are not persisted client-side (good — I-2 holds), this makes the refresh token reachable from JS for the lifetime of the page, so XSS during the session window can steal it. The tenant store correctly delegates to a backend-set httpOnly cookie (`authStore.ts:11-13`, `lib/api.ts:42-47`). | Move marketing + superadmin refresh tokens behind httpOnly cookies (`backend/src/modules/marketing/*` and `backend/src/modules/superadmin/superadmin-auth.controller.ts`). Once moved, drop `refreshToken` from both Zustand store shapes entirely. This converges all three stores on the same auth model and lets I-1/I-2 be enforced by construction, not by `partialize` discipline. |
| F-6 | Low | Arch | `superAdminAuthStore.ts:55-61` | Standalone `setRequires2FA` / `setRequires2FASetup` setters are unused (no callers anywhere — verified via grep on `setRequires2FA(`, `setRequires2FASetup(`). They exist only to make the orphan combinations of F-2 reachable. | Delete both setters along with the F-2 refactor. |
| F-7 | Low | Cor | `marketingAuthStore.ts` (no `setUser`/`setSuperAdmin`-equivalent) and `marketingApi.ts` (no `setRefreshToken` flow on rotate) | The marketing refresh path at `marketingApi.ts:38-43` writes only the new `accessToken` and leaves `refreshToken` unchanged. If the backend rotates the refresh token (it should — single-use refresh is the recommended pattern), the client will keep using the old refresh token on the next 401, and the next refresh will fail. Verify behavior against `backend/src/modules/marketing/...refresh` to confirm whether refresh tokens are single-use or long-lived. | If backend rotates: read `data.refreshToken` from the response at `:42` and call a new `setRefreshToken` setter (mirror `setAccessToken`). If backend does not rotate (long-lived refresh), document the deviation from `auth.md` I-2. |
| F-8 | Info | Arch | `cartStore.ts:1-226` | Confirmed non-auth: persists `items`, `sessionId`, `tenantId`, `tableId`, `currency` to localStorage (`:215-223`). No tokens. No auth role checks. Out of scope for this review. | n/a |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/quality) · Perf (performance/reliability).

---

## 8. What's solid (positive findings)

Patterns to keep and replicate.

- **`authStore.ts:60-66` — sync, reentrancy-safe `logout()`.** The header comment at `:20-25` explicitly documents *why* logout stays sync/local: the 401 interceptor in `lib/api.ts:76` calls it without awaiting, and a fetch-on-logout would create a re-entrancy loop with the interceptor itself. The canonical user-initiated logout (`features/auth/authApi.ts:66-85`) POSTs `/auth/logout` *first* to revoke the refresh cookie, then calls the store's `logout()`. This split is the right shape for "I-401-er, clear local state without reentering me". **Pattern to copy:** marketing + superadmin stores should pull the same comment block in for consistency (F-4).

- **`authStore.ts:71-74` — explicit `partialize` with inline justification.** The comment at `:70` ("Deliberately NOT persisting accessToken — memory only") sits one line above the partialize that omits it. The marketing store mirrors the same pattern at `marketingAuthStore.ts:57-65` and explicitly notes it matches the SuperAdmin stance. **Cross-link to backend:** `auth.md` I-10 (refresh-cookie-only contract on the server) — the two halves together enforce the no-token-in-JS invariant end-to-end.

- **Cross-link to backend atomic-consume.** The single-flight refresh at `lib/api.ts:38-58` and `superAdminApi.ts:48-77` is the client-side complement to the backend's atomic-consume pattern documented in `auth.md` §3 I-1 (password reset, `auth.service.ts:691-722`) and the **strict refresh rotation** documented in `auth.md` §3 I-2 (`auth.service.ts:481-488, :527-530`). The client's job is to never send two concurrent refresh requests against the same cookie/refresh-token (which would trip the backend's reuse-detection and revoke the family); the singleton at `:38`/`:48` is what makes that hold within a tab. The H-1 multi-tab race is the only remaining gap.

- **Three distinct persist namespaces (`auth-storage`, `marketing-auth-storage`, `superadmin-auth-storage`).** Mechanical isolation of the three stores by Zustand `persist.name`. I-5 holds by construction. **Pattern to copy:** any future identity domain (e.g. a customer-app store) should pick its own namespace and never reach across.

- **`cartStore.ts:215-223` is the right scope for `localStorage`.** Non-credential state (cart items, sessionId, tenantId, tableId, currency) persists; credentials do not. Models the right "what belongs in localStorage" boundary for the codebase.

---

## 9. Spot-checks performed

What was opened and verified vs. what stayed at "agent-reported".

**Verified end-to-end:**

- **§5.2 seed (F-2)** — confirmed at `superAdminAuthStore.ts:9-13` (three fields), `:47-52` (combined setter writes two of them), `:55-61` (independent setters), `:75-85` (logout clears all three), and at the consumer `SuperAdmin2FAPage.tsx:9-15, :21-41` (reads all four flags to pick a render branch). Three boolean flags, four legal combinations, twelve orphans. Stands.

- **F-1 (superadmin persists access token)** — confirmed at `superAdminAuthStore.ts:93-97`. The `partialize` return literally includes `accessToken: state.accessToken`. The comment at `:89-92` mentions only the refresh token. The CODE_REVIEW.md §3.2 claim that all three stores are memory-only is wrong on this point and should be amended. **Upgrade in CODE_REVIEW.md.**

- **I-1 / I-2 on `authStore`** — confirmed at `authStore.ts:71-74` (no `accessToken` in partialize; no `refreshToken` field anywhere). Refresh cookie path verified at `lib/api.ts:42-47` (POST `/auth/refresh` with empty body and `withCredentials: true` — relies entirely on the backend-set httpOnly cookie).

- **I-1 / I-2 on `marketingAuthStore`** — confirmed at `marketingAuthStore.ts:62-65` (partialize omits both tokens). Refresh-in-body call confirmed at `marketingApi.ts:38-40` (POSTs `{ refreshToken }` as JSON; F-5).

- **I-4 (atomic logout)** — confirmed at all three logout implementations: `authStore.ts:60-66` (3 fields in one `set()`), `marketingAuthStore.ts:46-53` (4 fields), `superAdminAuthStore.ts:75-85` (7 fields). No field-by-field logout exists in any store.

- **I-5 (stores don't share state)** — confirmed by grepping `useAuthStore`, `useMarketingAuthStore`, `useSuperAdminAuthStore` across `frontend/src/`. Each store is imported only into its own domain's pages and the matching feature-API file. The three axios instances (`lib/api.ts`, `features/marketing/api/marketingApi.ts`, `features/superadmin/api/superAdminApi.ts`) each refer to one and only one store.

- **I-6 (axios instances don't cross stores)** — `lib/api.ts:20, :50, :76` import only `useAuthStore`; `marketingApi.ts:13, :29, :43, :47` import only `useMarketingAuthStore`; `superAdminApi.ts:38, :51, :60, :81` import only `useSuperAdminAuthStore`. Verified.

- **F-6 (orphan setters unused)** — grep `setRequires2FA(` and `setRequires2FASetup(` across `frontend/src/` returns only the definitions inside `superAdminAuthStore.ts:55-61` plus the type declaration at `:18-19`. No call sites. Safe to delete with F-2.

**Dropped:**

- None this round. The §5.2 seed stood; F-1 was a new finding discovered while verifying I-1.

**Severity changes from CODE_REVIEW.md §5.2:**

- **§5.2 seed** was originally tagged Medium / Arch on a single line. Restated here as F-2 (Medium / Arch) — unchanged severity, expanded scope (full state-machine diagram in §4).
- **F-1 (new)** raises the store layer's overall health from CODE_REVIEW.md §5.2's "🟢 green / no findings" to **🟡 yellow** for this file. Recommend amending CODE_REVIEW.md §3.2's "frontend tokens never touch `localStorage`" claim to "tenant + marketing stores keep tokens in memory; superadmin currently persists the access token — see F-1 in `frontend-auth-stores.md`".

---

## 10. Recommended tests

The 5 tests below cover the §3 invariants and the §6 races. Skeletons only.

**T-1 — State enum exhaustiveness (F-2).**

```ts
// frontend/src/store/__tests__/superAdminAuthStore.spec.ts
describe('superAdminAuthStore — exhaustive state', () => {
  const legal = [
    { tempToken: null,  requires2FA: false, requires2FASetup: false, isAuthenticated: false }, // LOGGED_OUT
    { tempToken: 'tok', requires2FA: true,  requires2FASetup: false, isAuthenticated: false }, // NEEDS_2FA_ENTRY
    { tempToken: 'tok', requires2FA: false, requires2FASetup: true,  isAuthenticated: false }, // NEEDS_2FA_SETUP
    { tempToken: null,  requires2FA: false, requires2FASetup: false, isAuthenticated: true  }, // AUTHENTICATED
  ];
  it('every state reachable through public setters is in the legal set', () => {
    // replay every public transition (login → setTempToken(setup) → login,
    // login → setTempToken(entry) → login, login → logout, …); after each,
    // assert the {tempToken, requires2FA, requires2FASetup, isAuthenticated}
    // tuple is element-of `legal`.
  });
  it('logout from every legal state lands in LOGGED_OUT', () => { /* seed each, logout, assert all 7 fields cleared */ });
});
```

**T-2 — Persist hydration race (F-3, H-2).**

```ts
// frontend/src/components/__tests__/ProtectedRoute.spec.tsx
describe('ProtectedRoute — persist hydration', () => {
  it('does not render protected children before refresh resolves', async () => {
    // arrange: seed 'auth-storage' with {user, isAuthenticated: true};
    //          mock POST /auth/refresh to resolve in 100ms with {accessToken: 'A_new'}
    // assert: <Sentinel/> NOT in DOM during the 100ms window; IS after; zero 401s.
  });
  it('redirects to /login when persisted hint says auth but refresh fails', async () => {
    // mock /auth/refresh → 401; assert Navigate to /login; assert store cleared.
  });
});
```

**T-3 — Multi-tab logout (H-3).**

```ts
// frontend/src/store/__tests__/authStore.multitab.spec.ts
describe('authStore — multi-tab logout coordination', () => {
  it('a logout in tab A clears isAuthenticated in tab B', async () => {
    // two JSDOM windows sharing localStorage; A logs in then logout();
    // B's useAuthStore.getState().isAuthenticated should become false within one tick
    // (currently FAILING — flags H-3; passes after the BroadcastChannel fix).
  });
  it('a logout in tab A does NOT cascade to superadmin or marketing stores (I-5)', () => {});
});
```

**T-4 — Memory-only token invariant (I-1).**

```ts
// frontend/src/store/__tests__/token-storage.spec.ts
it('useAuthStore.login does not write accessToken to localStorage', () => {
  useAuthStore.getState().login({ id: 'u1' } as any, 'A1');
  expect(localStorage.getItem('auth-storage')).not.toContain('A1');
});
it('useMarketingAuthStore.login does not write either token to localStorage', () => {
  useMarketingAuthStore.getState().login({ id: 'm1' } as any, 'A1', 'R1');
  const raw = localStorage.getItem('marketing-auth-storage')!;
  expect(raw).not.toContain('A1'); expect(raw).not.toContain('R1');
});
it('useSuperAdminAuthStore.login DOES NOT persist accessToken (currently FAILING — F-1)', () => {
  useSuperAdminAuthStore.getState().login({ id: 's1' } as any, 'A1', 'R1');
  // FAILS today: partialize at superAdminAuthStore.ts:93-97 includes accessToken
  expect(localStorage.getItem('superadmin-auth-storage')).not.toContain('A1');
});
```

**T-5 — Atomic logout (I-4).**

```ts
// frontend/src/store/__tests__/atomic-logout.spec.ts
it('useSuperAdminAuthStore.logout clears all seven fields in one set() call', () => {
  const seen: any[] = [];
  const unsub = useSuperAdminAuthStore.subscribe((s) => seen.push({ ...s }));
  useSuperAdminAuthStore.getState().login({ id: 's1' } as any, 'A1', 'R1');
  useSuperAdminAuthStore.setState({ tempToken: 'tok', requires2FA: true });
  seen.length = 0;
  useSuperAdminAuthStore.getState().logout();
  unsub();
  expect(seen).toHaveLength(1);  // one notification, not seven
  expect(seen[0]).toMatchObject({ accessToken: null, refreshToken: null, tempToken: null, isAuthenticated: false, requires2FA: false, requires2FASetup: false });
});
```

These five tests directly cover I-1, I-3, I-4, F-1, F-2, F-3, and races H-2 / H-3. The remaining race H-1 (multi-tab refresh) is best covered by a Playwright cross-tab integration test rather than a Vitest unit, and is listed as a follow-up in CODE_REVIEW.md §7 P3 (frontend tests).

Cross-tenant invariant tests are not applicable to the store layer — multi-tenancy is enforced on the backend, and the stores carry a single user's identity at a time.
