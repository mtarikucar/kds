# `frontend/pages/superadmin/` — Deep Review (2026-05-11)

**Tier:** 1 (frontend parity — gates the highest-privilege console)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/pages/superadmin/`, `frontend/src/store/superAdminAuthStore.ts`, `frontend/src/features/superadmin/components/SuperAdminProtectedRoute.tsx`, `frontend/src/features/superadmin/components/SuperAdminLayout.tsx`, `frontend/src/features/superadmin/api/superAdminApi.ts`, `frontend/src/App.tsx` (routes)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §3.2 (auth & token model), §5.2 (`superAdminAuthStore` duplicate-state seed), §5.5 (pages skim). Backend mirror: [`superadmin.md`](superadmin.md) §3 invariants I-1, I-2, I-7, I-9, I-10, I-13.

---

## 1. Health & summary

🟡 yellow

The pages own the only client surface that can authenticate the highest-privilege identity in the product and operate it (suspend tenants, mutate plans, extend subscriptions, read cross-tenant audit logs). The login → 2FA → dashboard flow correctly mirrors the backend three-state FSM (`NEEDS_PASSWORD → NEEDS_2FA_ENTRY / NEEDS_2FA_SETUP → AUTHENTICATED`), 2FA cannot be skipped, the `Navigate replace` redirects fire **before** any protected child renders, and `tempToken` is never written to `localStorage` (`superAdminAuthStore.ts:93-97`). The risk concentrates in three places: **(1)** `partialize` persists `accessToken` to `localStorage` (`superAdminAuthStore.ts:95`) — directly contradicts the main-app auth store at `frontend/src/store/authStore.ts:70-74` and the CODE_REVIEW.md §3.2 claim that "Three frontend auth stores all follow memory-only access-token pattern"; an XSS on this origin drains the highest-privilege bearer. **(2)** The refresh path uses a JSON body `{refreshToken}` (`superAdminApi.ts:55-58`) instead of the httpOnly-cookie pattern the main app uses (`frontend/src/store/authStore.ts:13-17`) — and because `refreshToken` is excluded from `partialize` (`superAdminAuthStore.ts:93-97`) but `accessToken` is persisted, refresh is **structurally impossible after page reload**: as soon as the rehydrated access token expires (≤1h), every request 401s and the interceptor bounces to `/login`. **(3)** `SuperAdminProtectedRoute.tsx:5-13` only checks `isAuthenticated` and `requires2FA`; `requires2FASetup` is missing from the gate, so a partial-state user with `isAuthenticated=false && requires2FASetup=true` falls through to the "redirect to /login" branch — a refresh while mid-setup loses progress, not a security bypass but a state-machine drift from the FSM the backend documents at `superadmin.md §4.1`.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/pages/superadmin/SuperAdminLoginPage.tsx` (102 LOC) — email/password form, post-login redirect dispatcher.
- `frontend/src/pages/superadmin/SuperAdmin2FAPage.tsx` (165 LOC) — TOTP entry + setup-and-enable flows on a single page, gated by `requires2FA` / `requires2FASetup`.
- `frontend/src/pages/superadmin/SuperAdminDashboardPage.tsx` (215 LOC) — read-only metric cards; no mutations.
- `frontend/src/pages/superadmin/TenantsPage.tsx` (183 LOC) — list/search/filter, status flip with `window.confirm` only.
- `frontend/src/pages/superadmin/TenantDetailPage.tsx` (650 LOC) — overrides editor, plan-change modal, status flip.
- `frontend/src/pages/superadmin/AllUsersPage.tsx` (265 LOC) — cross-tenant user list + activity log tab.
- `frontend/src/pages/superadmin/AuditLogsPage.tsx` (210 LOC) — filter + CSV/JSON export via blob.
- `frontend/src/pages/superadmin/SuperAdminSettingsPage.tsx` (161 LOC) — second 2FA-setup flow (post-auth).
- `frontend/src/store/superAdminAuthStore.ts` (100 LOC) — duplicate-state seed (§5.2 of CODE_REVIEW.md).
- `frontend/src/features/superadmin/components/SuperAdminProtectedRoute.tsx` (16 LOC).
- `frontend/src/features/superadmin/components/SuperAdminLayout.tsx` (28 LOC) — second gate after `SuperAdminProtectedRoute`.
- `frontend/src/features/superadmin/api/superAdminApi.ts` (507 LOC) — axios instance, refresh interceptor, all query hooks.
- `frontend/src/App.tsx:227-242` — route wiring (login + 2fa are public, rest under `SuperAdminProtectedRoute` + `SuperAdminLayout`).

**Skimmed only:**
- `pages/superadmin/PlansPage.tsx` (24,849 bytes), `pages/superadmin/SubscriptionsPage.tsx` (7,963 bytes) — CRUD over plans/subscriptions; both use the same `useSuperAdminAuthStore` gate transitively. No state-machine logic on the auth boundary.
- `features/superadmin/components/SuperAdminSidebar.tsx` — navigation only, no auth side effects.
- `features/superadmin/types.ts` — DTO shapes only; `SuperAdmin` type lacks any `role` field (the JWT type discriminator carries the role server-side).

**Skipped:**
- Section §5 (Money & precision) — superadmin pages do no client-side price math. Plan prices are read off API as `Number(plan.monthlyPrice)` (`TenantDetailPage.tsx:610`) and rendered with `toLocaleString()`; tenant revenue is rendered the same way (`SuperAdminDashboardPage.tsx:138`). Both are display-only — no comparison, sum, or write-back from the rendered number.

---

## 3. Business-logic invariants

Each row is testable — an integration test could assert it.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **2FA cannot be skipped via UI state.** Setting `isAuthenticated=true` requires both a password-correct login and a successful TOTP verify — there is no client setter that flips only `isAuthenticated` without also clearing `tempToken`/`requires2FA`/`requires2FASetup`. | `superAdminAuthStore.ts:63-73` (`login()` is the only path that sets `isAuthenticated:true` *and* it always clears the 2FA flags), `setSuperAdmin()` at `:35-37` (sets `isAuthenticated:true` without clearing — only called from the `verify-2fa` success branch in practice; **flag in §7** as a latent footgun). | ❌ none (no frontend tests for any superadmin page) | password-only authentication if a future caller invokes `setSuperAdmin()` directly. |
| I-2 | **Route gating runs before render.** Any visit to `/superadmin/*` (except `/login`, `/2fa`) is intercepted by `<SuperAdminProtectedRoute />` **before** the lazy-loaded page module mounts; an unauthenticated user never instantiates `TenantsPage`, never fires its `useTenants` query, never sees layout chrome. | `App.tsx:230-241` (wraps all protected routes in `<SuperAdminProtectedRoute />` + `<SuperAdminLayout />`), `SuperAdminProtectedRoute.tsx:7-13` (returns `<Navigate>` element which short-circuits before `<Outlet>`). | ❌ none | direct-URL navigation to `/superadmin/audit-logs` flashes the page chrome + fires API calls before the token check (no current evidence of this — verified at the cited lines). |
| I-3 | **`tempToken` is never persisted to disk.** `partialize` excludes `tempToken`, `refreshToken`, `requires2FA`, `requires2FASetup`. | `superAdminAuthStore.ts:93-97` | ❌ none | reload-after-tab-close keeps a valid 10-min `tempToken` in `localStorage` for any XSS to harvest. |
| I-4 | **`refreshToken` is never persisted to disk.** Justified in the in-source comment at `:89-92`: an XSS on this origin would otherwise exfiltrate the highest-privilege token pair. | `superAdminAuthStore.ts:93-97` | ❌ none | as comment states. |
| I-5 | **`accessToken` is memory-only (parity with main `authStore`).** | **VIOLATED** at `superAdminAuthStore.ts:95` — `partialize` explicitly includes `state.accessToken`. The main app store at `frontend/src/store/authStore.ts:70-74` deliberately excludes it. CODE_REVIEW.md §3.2 documents "Three frontend auth stores all follow memory-only access-token pattern" — that claim is wrong for this store. | ❌ none | XSS on `/superadmin/*` origin lifts the bearer out of `localStorage` and replays it against the SA API for up to 1h (`superadmin-auth.service.ts:562-569` issues 1h access tokens). |
| I-6 | **Refresh-from-cookie pattern parity with main app.** The main app uses an httpOnly refresh cookie (`frontend/src/store/authStore.ts:13-17`); the superadmin store should follow the same pattern. | **VIOLATED** — `superAdminApi.ts:55-58` posts `{refreshToken}` as a JSON body, and the token is read from in-memory state (`:51`). The store's `refreshToken` is **not** persisted (`:93-97`), so after any page reload the refresh path is structurally dead: `getState().refreshToken === null` at `:52` → `throw 'No refresh token'` → interceptor `:80-83` → `logout()` + `window.location.href = .../superadmin/login`. The persisted `accessToken` extends the session until it expires; once it does, the user is forced to re-login + re-2FA from scratch. | ❌ none | UX: forced re-2FA on every page reload after token expiry. Security: the JSON-body design means the refresh token must live in JS — directly contradicts the SOP for high-privilege paths. |
| I-7 | **Every protected route runs through the role/identity check.** The superadmin pages run under a *separate JWT realm* (`type:'superadmin'`, separate secret enforced server-side at `superadmin.module.ts:38-52` per `superadmin.md §2`) and a *separate axios instance* (`superAdminApi.ts:29-43`). The frontend does no role-name check (`SuperAdmin` type at `features/superadmin/types.ts:2-9` has no `role` field) — the realm separation **is** the role check. | `App.tsx:230` (every protected route wrapped); `superAdminApi.ts:37-43` (every request gets `Authorization: Bearer <superadminAccessToken>` and only that). | ❌ none | a future refactor that wires a tenant-realm token into the superadmin axios instance would be undetectable client-side; the backend `SuperAdminGuard` is the last line. |
| I-8 | **Logout clears every credential field.** `logout()` resets `superAdmin`, both tokens, `tempToken`, `isAuthenticated`, both `requires2FA*` flags. | `superAdminAuthStore.ts:75-85` | ❌ none | residual `isAuthenticated:true` after logout would re-flash the protected shell. |
| I-9 | **The `requires2FASetup` state is reachable only with a valid `tempToken`.** The login API dispatcher at `superAdminApi.ts:101-103` sets `tempToken` *and* `requires2FASetup` in one call (`setTempToken(tempToken, true)`), so the two are atomic on success. | `superAdminAuthStore.ts:47-53` (single setter writes both fields). | ❌ none | a setter that updates only `requires2FASetup` would leave a user in a "show me the QR" state with no token — `/2fa` then 404s on `setup-with-token` and surfaces an error. |
| I-10 | **Mutating actions (suspend / delete / change-plan) require explicit confirmation.** | `TenantsPage.tsx:31`, `TenantDetailPage.tsx:114, 180`, `SubscriptionsPage.tsx:30, 36-39`, `PlansPage.tsx:16` — all use `window.confirm` / `window.prompt`. | ❌ none | UX-only — not a security invariant. The backend audit logs every mutation regardless. |
| I-11 | **Audit-log export blob is created and revoked on the client without leaving handles.** | `AuditLogsPage.tsx:28-36` — `URL.createObjectURL` + `link.click()` + `link.remove()`, but **no `URL.revokeObjectURL`** — flag in §7 (memory leak under repeated exports). | ❌ none | unbounded blob retention in long-lived SA sessions exporting many logs. |
| I-12 | **No mutation is dispatched while `isAuthenticated=false`.** Every mutation hook at `superAdminApi.ts:264-484` calls through `superAdminApi`; the request interceptor only attaches `Authorization` if `accessToken` is non-null (`:38-42`). Without an access token the backend rejects with 401, the response interceptor at `:69-85` attempts a refresh, and on refresh failure calls `logout()`. The render gate ensures no superadmin page can mount without `isAuthenticated`, so this is a defense-in-depth claim, not a load-bearing one. | render gate `SuperAdminProtectedRoute.tsx:7-9` + interceptor `superAdminApi.ts:37-43`. | ❌ none | a future mutation invoked outside the layout (e.g., from a global notification dropdown) would still 401, but with `_retry=true` set on the original request after one cycle, it would silently drop. |

---

## 4. State machine

The superadmin authentication FSM mirrors the backend FSM documented at `superadmin.md §4.1`. The frontend states are held as a **bag of four booleans + two tokens** in `superAdminAuthStore.ts:6-13`, not a single enum (see F-1 in §7).

**Conceptual states** (derived from `(isAuthenticated, requires2FA, requires2FASetup, tempToken, accessToken)`):

| State | Tuple shape | Visible page |
|---|---|---|
| `NEEDS_PASSWORD` | `(false, false, false, null, null)` | `SuperAdminLoginPage` |
| `NEEDS_2FA_ENTRY` | `(false, true, false, <tempToken>, null)` | `SuperAdmin2FAPage` |
| `NEEDS_2FA_SETUP` | `(false, false, true, <tempToken>, null)` | `SuperAdmin2FAPage` (setup branch) |
| `AUTHENTICATED` | `(true, false, false, null, <accessToken>)` | any `/superadmin/<x>` |

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `NEEDS_PASSWORD → NEEDS_PASSWORD` | bad creds | `superAdminApi.ts:96-110` (no onSuccess branch fires) | yes | mutation error surfaces at `SuperAdminLoginPage.tsx:46-50` |
| `NEEDS_PASSWORD → NEEDS_2FA_ENTRY` | correct creds + 2FA enabled | `superAdminApi.ts:104-106` calls `setTempToken(tempToken, false)` | no — overwrites prior `tempToken` if any | `requires2FA=true`, store gains `tempToken` |
| `NEEDS_PASSWORD → NEEDS_2FA_SETUP` | correct creds + 2FA not yet set up | `superAdminApi.ts:101-103` calls `setTempToken(tempToken, true)` | no | `requires2FASetup=true`, store gains `tempToken` |
| `NEEDS_PASSWORD → AUTHENTICATED` | correct creds + 2FA disabled at API layer | `superAdminApi.ts:107-109` (`if data.accessToken && data.refreshToken && data.superAdmin`) | yes | login() clears all 2FA flags + writes both tokens. **Note:** the backend invariant I-1 at `superadmin.md` forbids this transition (a SA must always have 2FA enabled); the frontend code accepts it if the backend somehow returns it. Defense-in-depth: keep the path but flag in §7 as an over-permissive dispatcher. |
| `NEEDS_2FA_ENTRY → AUTHENTICATED` | correct TOTP / backup code | `superAdminApi.ts:122-126` `useVerify2FA.onSuccess` calls `login()` | yes | `login()` clears `tempToken`, `requires2FA`, sets both real tokens. |
| `NEEDS_2FA_SETUP → AUTHENTICATED` | correct TOTP from pending secret | `superAdminApi.ts:167-172` `useEnable2FAWithToken.onSuccess` calls `login()` | yes | same as above. |
| `NEEDS_2FA_*` → `NEEDS_PASSWORD` | user clicks "Cancel" on 2FA page | `SuperAdmin2FAPage.tsx:52-54` calls `logout()` | yes | clears everything including `tempToken`. |
| `AUTHENTICATED → NEEDS_PASSWORD` | refresh fails (401 + no refresh token / refresh rejects) | `superAdminApi.ts:80-84` calls `logout()` + `window.location.href = .../login` | yes | hard navigation breaks any in-flight optimistic UI. |
| `AUTHENTICATED → AUTHENTICATED` | access-token expiry + refresh succeeds | `superAdminApi.ts:69-79` single-flight refresh + retry | **broken after reload** — see I-6 / F-2 in §7. | new access token written via `setAccessToken` (`:60`). |
| `AUTHENTICATED → NEEDS_PASSWORD` | explicit logout | `superAdminApi.ts:175-187` `useSuperAdminLogout` → `logout()` | yes | POST `/auth/logout` first, then clear. |

**Forbidden transitions** (asserted by code or implied by backend FSM):

- `NEEDS_PASSWORD → AUTHENTICATED` *without* a 2FA hop — backend prevents it (`superadmin-auth.service.ts:207-219` per `superadmin.md` I-1). The frontend dispatcher at `superAdminApi.ts:100-110` will accept it if the response shape allows — see F-3 in §7.
- `NEEDS_2FA_* → NEEDS_2FA_*` (sibling) — there is no transition between `NEEDS_2FA_ENTRY` and `NEEDS_2FA_SETUP`; the backend response shape determines which one is entered on login, and `setTempToken(t, needsSetup)` writes them mutually-exclusively (`superAdminAuthStore.ts:47-53`). ✅ guarded.

**Idempotency gaps** (flag in §7): the login `onSuccess` dispatcher overwrites `tempToken` unconditionally; a duplicated login response (network retry) would simply replace one valid `tempToken` with another — no real harm since the backend invalidates the prior `tempToken` on issue. Worth documenting, not worth fixing.

---

## 6. Concurrency hazards

The SPA has only the browser tab as a concurrency surface, plus the React Query cache and the in-flight refresh. The three race windows worth flagging:

**Critical sections + locking:**

- `superAdminApi.ts:48, 72-79` — **single-flight refresh.** A module-level `inFlightRefresh` promise serializes simultaneous 401-retries. Pattern is correct (matches the main-app `lib/api.ts:42-57` shape per CODE_REVIEW.md §3.2). One concern: **no timeout** — if `/superadmin/auth/refresh` hangs, every queued request blocks for the full axios default. The main `lib/api.ts` has the same gap (F3 in CODE_REVIEW.md §2). Mirror the fix here.

**Race windows still open:**

- **Race 1 (refresh-race after reload, structural).**
  *Sketch:* Tab A reloads. `partialize` rehydrates `accessToken` from localStorage but not `refreshToken` (`superAdminAuthStore.ts:93-97`). The store's `accessToken` is still valid for up to 1h; ten React Query subscriptions fire on mount; the first one to 401 enters the interceptor at `:69`, hits `refreshAccessToken()` at `:50-62`, finds `refreshToken === null`, throws, hits the catch at `:80-83`, calls `logout()`, calls `window.location.href = ...`. The other nine queued requests resolve to whatever state the hard navigation leaves them in. The user sees: dashboard flash → logout → login screen.
  *Where:* `superAdminAuthStore.ts:93-97` (the partialize choice) + `superAdminApi.ts:50-62` (the refresh design that needs the JSON token).
  *Severity:* Medium Cor (UX) + High Sec (refresh-from-body is wrong for highest-privilege).
  *Fix:* either (a) move refresh to httpOnly cookie like the main app does (`/superadmin/auth/refresh` reads from `req.cookies?.[REFRESH_COOKIE]`); or (b) at minimum, stop persisting `accessToken`, so reload deterministically lands on `/superadmin/login` instead of flashing the shell.

- **Race 2 (2FA-bypass via direct URL navigation, no current bypass).**
  *Sketch:* Open `/superadmin/dashboard` in an incognito tab. The route is wrapped by `SuperAdminProtectedRoute` (`App.tsx:230`); the gate at `:7-9` checks `!isAuthenticated && !requires2FA` and `Navigate replace`s to `/superadmin/login`. The protected page never mounts. The `SuperAdminLayout.tsx:8-14` is a second redundant gate inside that. **No bypass at the cited lines.** The only edge: `requires2FASetup=true && isAuthenticated=false` is *not* matched by either branch at `SuperAdminProtectedRoute.tsx:7-13` — the user falls through to `<Outlet />` because `!isAuthenticated && !requires2FA` is true and Navigate fires to `/login`, which is the correct fall-back (the login page's own gate at `SuperAdminLoginPage.tsx:16-18` then redirects to `/2fa`). Net: no bypass, but the protected route's logic should explicitly enumerate the four states rather than rely on the login page to re-dispatch. See F-4 in §7.
  *Where:* `SuperAdminProtectedRoute.tsx:5-13`.
  *Severity:* Low Cor.
  *Fix:* check all three flags explicitly.

- **Race 3 (persist-hydration flicker, two-tab divergence).**
  *Sketch:* Tab A is authenticated; tab B opens `/superadmin/dashboard`. Zustand `persist` rehydrates `(superAdmin, accessToken, isAuthenticated)` from `localStorage` synchronously on store-init (zustand default), so tab B's `SuperAdminProtectedRoute.tsx:5-13` reads `isAuthenticated=true` and renders the layout. Immediately after, the dashboard fires `useDashboardStats()` (`superAdminApi.ts:190-198`) which sends the persisted access token. If that token expired in the gap between tab-A logout and tab-B open, the 401 → refresh → fail → `logout()` → hard-nav chain kicks in. The user sees: dashboard flash → forced login. Net: no security violation (the backend rejected the call), but **a UX flicker the main app's `ProtectedRoute` already documents as F2 in CODE_REVIEW.md §2** — the superadmin path inherits the same gap because `isAuthenticated` is persisted.
  *Where:* `superAdminAuthStore.ts:93-97` (persists `isAuthenticated`).
  *Severity:* Low Cor.
  *Fix:* gate the protected outlet behind a `bootstrapped` flag that flips true only after `/me`-style validation; same pattern recommended for the main `ProtectedRoute` in CODE_REVIEW.md §3.2.

**Idempotency keys (mutations):** none. Tenant suspend/delete, plan change, subscription extend/cancel, override save — all are simple POST/PATCH without a client-supplied idempotency key. The user-clicks-twice scenario is gated only by `mutation.isPending` disabling buttons (`TenantDetailPage.tsx:394-399`, `:638-642`). A double-fire from a flaky network is therefore plausible. Same shape as M10 in CODE_REVIEW.md §2 (split-bill) — backend would be the right place to add the key, not the client.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Sec | `frontend/src/store/superAdminAuthStore.ts:93-97` | **`accessToken` is persisted to `localStorage`** — breaks parity with the main `authStore.ts:70-74` memory-only pattern and contradicts the assumption in CODE_REVIEW.md §3.2. XSS on the SA origin can exfiltrate the highest-privilege bearer for up to 1h. The in-source comment at `:89-92` only justifies excluding the *refresh* token; it does not address why the access token is included. | Remove `accessToken` from `partialize`. Accept the consequence that page reload forces an explicit refresh (which is the entire point of the refresh-cookie pattern in the main app). |
| F-2 | High | Cor | `frontend/src/features/superadmin/api/superAdminApi.ts:50-62` + `superAdminAuthStore.ts:93-97` | **Refresh-from-cookie pattern parity broken.** Refresh reads `refreshToken` from in-memory state (`:51`) and posts it in a JSON body (`:57`); `refreshToken` is not in `partialize`, so after every page reload the refresh path is dead and the user is forced into a full re-2FA cycle as soon as the cached access token expires. The main app uses an httpOnly cookie (`authStore.ts:13-17`). | Either (a) switch `/superadmin/auth/refresh` to read from the httpOnly `superadmin_refresh` cookie and drop the JSON body, or (b) accept the UX cost and document it — but in (b) case still remove the now-useless body-based path. |
| F-3 | Medium | Sec | `frontend/src/features/superadmin/api/superAdminApi.ts:100-110` | **Login `onSuccess` dispatcher accepts the `(accessToken, refreshToken, superAdmin)` branch unconditionally** — if the backend ever returns those fields *without* a 2FA hop (a bug, or a misconfigured SA with `twoFactorEnabled=false`), the client logs them in without ever traversing the 2FA state. Backend currently forbids this at `superadmin-auth.service.ts:207-219` (I-1 in `superadmin.md`), so it's defense-in-depth. | Add an explicit assertion: `if (!data.requiresTwoFactor && !data.requires2FASetup) throw new Error('SA login must traverse 2FA')` or at minimum log a Sentry breadcrumb on the unexpected branch. |
| F-4 | Medium | Cor | `frontend/src/features/superadmin/components/SuperAdminProtectedRoute.tsx:5-13` | **`requires2FASetup` is missing from the protected-route gate.** The route checks `!isAuthenticated && !requires2FA` for the login redirect and `requires2FA` for the 2FA redirect — `requires2FASetup` is checked nowhere. The current fallback is: `requires2FASetup=true && isAuthenticated=false` → Navigate to `/login` → login page checks `requires2FA || requires2FASetup` (`SuperAdminLoginPage.tsx:16`) → Navigate to `/2fa`. Two-hop redirect with a brief flash of the login page. | Enumerate the four states explicitly: `if (!isAuthenticated && !requires2FA && !requires2FASetup) → /login`; `else if (requires2FA || requires2FASetup) → /2fa`; `else <Outlet />`. |
| F-5 | Medium | Arch | `frontend/src/store/superAdminAuthStore.ts:9, 11-12, 17, 47-53` | **Duplicate-state seed** (carried over from CODE_REVIEW.md §5.2). Three coordinated booleans (`requires2FA`, `requires2FASetup`, plus implicit "no 2FA flags set") + a `tempToken` represent what the backend models as a single enum (`NEEDS_2FA_ENTRY` / `NEEDS_2FA_SETUP` / `AUTHENTICATED` per `superadmin.md §4.1`). Every consumer (`SuperAdminLoginPage.tsx:9, 16`, `SuperAdmin2FAPage.tsx:11-13, 31, 35, 45`, `SuperAdminProtectedRoute.tsx:5, 7, 11`, `SuperAdminLayout.tsx:6, 8, 12`) re-derives the same boolean logic, and F-4 is a direct consequence: the gate forgot one of the booleans. | Replace with `authState: 'NEEDS_PASSWORD' \| 'NEEDS_2FA_ENTRY' \| 'NEEDS_2FA_SETUP' \| 'AUTHENTICATED'`. Setters become single-field writes; gates become a `switch`. Cross-links: backend FSM in [`superadmin.md`](superadmin.md) §4.1, the equivalent main-app store at `frontend/src/store/authStore.ts` (which has a flat shape but no 2FA branching to model). |
| F-6 | Medium | Sec | `frontend/src/store/superAdminAuthStore.ts:35-37` | **`setSuperAdmin()` sets `isAuthenticated:true` without clearing 2FA flags.** Only `login()` at `:63-73` performs the atomic transition. `setSuperAdmin` is currently called only from response handlers that already have `(superAdmin, accessToken, refreshToken)` — but any future caller that invokes it with stale state could land in `(isAuthenticated:true, requires2FA:true)`, an undefined state under the FSM. | Either delete `setSuperAdmin` (only `login` should mint the authed state) or make it also clear the 2FA flags. |
| F-7 | Low | Perf | `frontend/src/pages/superadmin/AuditLogsPage.tsx:29-35` | **Object URL not revoked** after CSV/JSON export. Repeated exports accumulate blob references in the page lifetime. | Call `URL.revokeObjectURL(url)` after `link.click()` (or after a microtask). |
| F-8 | Low | Cor | `frontend/src/features/superadmin/api/superAdminApi.ts:69-89` | **No refresh timeout.** A hung `/superadmin/auth/refresh` blocks every queued request indefinitely. Same shape as F3 in CODE_REVIEW.md §2. | Wrap the in-flight promise in `Promise.race` with a 10s timeout. |
| F-9 | Low | Sec | `frontend/src/pages/superadmin/SuperAdminSettingsPage.tsx:11-31, 95-117` | **Second 2FA-setup surface.** `useSetup2FA` (`superAdminApi.ts:130-139`) calls `/2fa/setup` (no temp token, uses the live SA session), then `useEnable2FA` (`:141-148`) POSTs the code. Distinct from the `setup-with-token` / `enable-with-token` pair on `SuperAdmin2FAPage`. Backend (`superadmin.md` §4.2) treats both flows as legitimate. Risk: a SA who already has 2FA enabled but visits Settings could be presented with the "Setup 2FA" button if `superAdmin.twoFactorEnabled` is stale (cached) — the button is gated by `!superAdmin?.twoFactorEnabled` at `:77` which is read off the *persisted* `SuperAdmin` object. | Refetch the SA profile on Settings page mount (or invalidate `['superadmin', 'profile']` after enable). |
| F-10 | Low | Sec | `frontend/src/features/superadmin/api/superAdminApi.ts:82` | Hard navigation via `window.location.href = import.meta.env.BASE_URL + 'superadmin/login'` instead of `Navigate`. Acceptable here (drops in-flight state on refresh failure) but it bypasses React Router; if a future deploy mounts the SPA under a non-default `BASE_URL` with rewrites missing, the URL composition could 404. | Use the `react-router` `useNavigate` hook from a top-level error boundary, or document the BASE_URL contract. |
| F-11 | Info | Arch | `frontend/src/pages/superadmin/TenantDetailPage.tsx:610` | `Number(plan.monthlyPrice).toLocaleString()` — display-only conversion of a backend Decimal-like field. No comparison, sum, or write-back from the rendered value. Listed for completeness only. | none. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **Separate store, separate axios instance per realm.** `superAdminApi.ts:29-43` builds its own axios client with its own interceptor + its own token source; the main app's `lib/api.ts` and the SA path never share a token. Combined with the backend's separate JWT secret (`superadmin.md §2`, `superadmin.module.ts:38-52`), this is a clean realm boundary. **Pattern to keep** — adopt the same shape if/when a marketing-admin realm goes Tier-1; cross-link to [`superadmin.md`](superadmin.md) §8.
- **Single-flight refresh.** `superAdminApi.ts:48, 72-79` correctly serializes concurrent 401-retries through a shared promise. Matches `lib/api.ts:42-57` per CODE_REVIEW.md §3.2. Needs a timeout (F-8) but the locking is right.
- **Two-layer route gate.** `SuperAdminProtectedRoute` + `SuperAdminLayout` both check `isAuthenticated` before rendering. Belt-and-braces; if the outer gate is bypassed by a future refactor (e.g., `<Outlet />` reused at a different depth), the inner gate still blocks. Cf. CODE_REVIEW.md §3.2.
- **`tempToken` and `refreshToken` excluded from persistence.** `superAdminAuthStore.ts:93-97` does the harder part right; F-1 is the one regression on the same line.
- **2FA cancel flow drops the session entirely.** `SuperAdmin2FAPage.tsx:52-54` calls `logout()`, not just clears `tempToken` — prevents a "cancel mid-2FA but still authenticated" state. Cross-link: backend mirror at `superadmin-auth.service.ts` doesn't have a per-tempToken revoke endpoint, so the JWT just expires after its 10-min TTL.
- **All mutations go through React Query + `queryClient.invalidateQueries`.** Cache coherence on suspend/delete/extend/override-save (e.g., `superAdminApi.ts:272-275, 335-339, 350-354`). UI never reads a stale tenant after a mutation lands.
- **CSV/JSON export uses backend-rendered blob, not client-side rendering.** `AuditLogsPage.tsx:27-36` — formula-injection protection lives on the server (`superadmin-audit.service.ts:17-22` per `superadmin.md` I-19). Client only triggers the download.
- **Lazy-loaded routes.** `App.tsx:10-19` — every SA page is `lazy()`; non-SA users never download the SA chunk.

---

## 9. Spot-checks performed

**Verified:**
- F-1 — confirmed at `superAdminAuthStore.ts:95`: `partialize` explicitly returns `accessToken: state.accessToken`. The main-app store at `authStore.ts:70-74` returns only `user` and `isAuthenticated`. Asymmetry is real.
- F-2 — confirmed at `superAdminApi.ts:51-58`: refresh reads `getState().refreshToken` and posts `{refreshToken}` as a JSON body. The main app's `/auth/refresh` reads from a cookie per `authStore.ts:13-17` and the surrounding comments.
- F-4 — confirmed at `SuperAdminProtectedRoute.tsx:5-13`: only `isAuthenticated` and `requires2FA` are read; `requires2FASetup` is referenced nowhere in the gate. Traced the fallback chain through `SuperAdminLoginPage.tsx:16`.
- I-3 / I-4 — confirmed at `superAdminAuthStore.ts:93-97`: `tempToken` and `refreshToken` are absent from the returned partialize object.
- I-7 — confirmed at `features/superadmin/types.ts:2-9`: no `role` field on `SuperAdmin`. Combined with the dedicated axios instance, the realm is the role.

**Dropped (initial pattern-matching was wrong):**
- "Direct-URL navigation to `/superadmin/dashboard` bypasses 2FA" — verified at `App.tsx:230-241` + `SuperAdminProtectedRoute.tsx:5-13`. The route is wrapped; the gate fires before `<Outlet />`; the lazy chunk never mounts. **Drop.**
- "`SuperAdminLoginPage` allows submit while a `tempToken` exists" — verified at `SuperAdminLoginPage.tsx:12-18`: the page Navigate-replaces to `/dashboard` (if authed) or `/2fa` (if any 2FA flag is set) *before* rendering the form. Form is unreachable from a 2FA-in-progress state. **Drop.**

**Downgraded:**
- F-9 — initially flagged as Medium (stale-cache-could-show-setup-to-an-already-enabled-SA), downgraded to Low because the backend `/2fa/enable` endpoint rejects when 2FA is already enabled (verified at `superadmin-auth.service.ts` per `superadmin.md` I-6). The frontend bug is cosmetic.
- Race 3 (persist-hydration flicker) — would be Medium if it caused a security flash, but the rendered shell holds only public navigation chrome and the dashboard hooks 401 on the very first request. UX-only → Low.

---

## 10. Recommended tests

The 3–6 tests that would catch the §3 invariants and §6 races. Skeletons only.

```ts
// frontend/src/pages/superadmin/__tests__/superadmin-auth-gate.spec.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';

describe('superadmin auth gates', () => {
  beforeEach(() => useSuperAdminAuthStore.getState().logout());

  it('I-2 / Race 2: direct-URL nav to /superadmin/dashboard with no tokens redirects to /login before the page module loads', async () => {
    // arrange: store is in NEEDS_PASSWORD; mount <App> with initialEntries=['/superadmin/dashboard']
    // act: render
    // assert: window.location pathname === '/superadmin/login'
    //         AND the SuperAdminDashboardPage chunk was never imported (mock React.lazy + spy on the import())
  });

  it('I-1: cannot reach AUTHENTICATED without traversing 2FA — setSuperAdmin alone leaves requires2FA intact', () => {
    // arrange: store.setTempToken('abc', false)  // NEEDS_2FA_ENTRY
    // act: store.setSuperAdmin({ ...sa, twoFactorEnabled: true })
    // assert: store.requires2FA === true  (F-6 — currently false; should flip to true after fix)
  });

  it('F-4: requires2FASetup=true && isAuthenticated=false directs through ProtectedRoute → /2fa in a single hop (no flash of /login)', async () => {
    // arrange: store.setTempToken('abc', true)  // NEEDS_2FA_SETUP
    // mount <App> with initialEntries=['/superadmin/audit-logs']
    // assert: only one Navigate fires; final pathname === '/superadmin/2fa'
    //         AND SuperAdminLoginPage was never rendered (assertion on screen.queryByText('Sign in'))
  });
});

// frontend/src/store/__tests__/superAdminAuthStore.spec.ts
describe('superAdminAuthStore persistence invariants', () => {
  it('I-3 / I-4: tempToken and refreshToken are never written to localStorage', () => {
    // arrange: store.setTempToken('temp123', false); store.setTokens('access', 'refresh')
    // act: read localStorage.getItem('superadmin-auth-storage')
    // assert: parsed payload does NOT contain 'temp123' or 'refresh'
  });

  it('I-5 (post-fix): accessToken is NOT written to localStorage', () => {
    // arrange: store.login(sa, 'access', 'refresh')
    // act: read localStorage.getItem('superadmin-auth-storage')
    // assert: parsed payload does NOT contain 'access'
    // (currently FAILS — see F-1)
  });
});

// frontend/src/features/superadmin/api/__tests__/superAdminApi.spec.ts
describe('superadmin refresh interceptor', () => {
  it('Race 1 / F-2: page reload with expired-access + no-refresh-token → bounces to /login, no infinite loop', async () => {
    // arrange: hydrate store from a fake localStorage payload that includes only accessToken + isAuthenticated
    //          mock /superadmin/dashboard/stats to return 401
    // act: trigger the query
    // assert: window.location.href set to .../superadmin/login exactly once
    //         AND no second request fires after refresh failure
  });

  it('F-8: refresh times out at 10s instead of hanging indefinitely', async () => {
    // arrange: mock /superadmin/auth/refresh to never resolve
    // act: fire a 401-retry through the interceptor
    // assert: rejection within 10.5s
  });
});
```

The cross-tenant style assertion from CODE_REVIEW.md §3.1 doesn't apply here — superadmin is *intentionally* cross-tenant. The equivalent property is "no non-superadmin JWT can reach the superadmin API" — that's a backend test, not a frontend one (covered by `superadmin.md` §10).
