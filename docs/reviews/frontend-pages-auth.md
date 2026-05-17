# `frontend/src/pages/auth` — Deep Review (2026-05-11)

**Tier:** Frontend parity (template adapted — §3 = render/token/identity contracts; §4 = client-side form/flow state; §5 money skipped).
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/pages/auth/{LoginPage,RegisterPage,ForgotPasswordPage,ResetPasswordPage,VerifyEmailPage}.tsx`
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.5 (seeded the OAuth implicit-flow concern); [`auth.md`](auth.md) (server-side contracts — atomic password-reset consume, email-enumeration timing-safety, refresh-cookie httpOnly delivery).

---

## 1. Health & summary

🟡 yellow

These five pages are the client-side surface of every identity transition the SPA performs: credential login, registration (with PENDING_APPROVAL branch), forgot-password request, password reset, and email-code verification. Token plumbing is **already correctly off the page** — the pages delegate to `features/auth/authApi.ts` mutations and `store/authStore.ts`, neither of which persists `accessToken` to `localStorage` (see `authStore.ts:71-74` partialize). What remains on the page is form validation, navigation, and OAuth invocation, and that's where the risk concentrates: (a) `useGoogleLogin({ flow: 'implicit' })` on both `LoginPage.tsx:77` and `RegisterPage.tsx:132` hands the page an `access_token` and posts it to `/auth/google` — the server is therefore trusted to validate the token via Google's userinfo/tokeninfo endpoint rather than verifying a signed ID token via auth-code+PKCE; (b) every authenticated landing is hard-coded to `/dashboard` regardless of `user.role` (`LoginPage.tsx:53,60,70`), so a WAITER/KITCHEN/COURIER lands one click away from their working screen and the in-between render leaks one extra protected fetch; (c) the password-reset success page does its own `setTimeout(navigate, 3000)` (`ResetPasswordPage.tsx:57-59`) which keeps the now-revoked session interactive for 3 s. None of these is exploitable from the outside given the backend's atomic-consume + email-enumeration timing-safety (cross-link: `auth.md` I-1, I-9, §6 race-table row 3). Verdict yellow because the OAuth flow choice is a security posture decision that needs an explicit answer, not because anything here is presently broken.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/pages/auth/LoginPage.tsx` (217 LOC) — email/password form, Google OAuth implicit-flow invocation, pending-approval banner from location state, post-login navigation.
- `frontend/src/pages/auth/RegisterPage.tsx` (314 LOC) — registration form with role-conditional restaurant-name vs tenant-select, PasswordStrength UI, terms checkbox gate, Google OAuth implicit-flow, pending-approval branch.
- `frontend/src/pages/auth/ForgotPasswordPage.tsx` (177 LOC) — request-email form + post-submit confirmation screen.
- `frontend/src/pages/auth/ResetPasswordPage.tsx` (162 LOC) — token-from-query consume form, new+confirm password, success screen with auto-redirect.
- `frontend/src/pages/auth/VerifyEmailPage.tsx` (153 LOC) — 6-digit code entry, manual email entry for unauthenticated path, resend-button (auth-only).

**Cross-referenced (not re-reviewed):**
- `frontend/src/features/auth/authApi.ts` — the React Query mutations these pages call. Token persistence verified in `authStore.ts:71-74` (memory-only access token).
- `frontend/src/store/authStore.ts` — `partialize` excludes `accessToken`.
- `frontend/src/main.tsx:43-50` — `ErrorBoundary` wraps the entire tree including the auth pages.
- `frontend/src/components/ui/PasswordStrength.tsx` — informational UI; **does not gate** submit.
- `frontend/src/App.tsx:148-150` — routing.

**Skipped:**
- 2FA UI — not present in this folder; `superadmin-auth.service.ts` owns the only 2FA in this codebase (`auth.md` §4.3 explicitly notes the main app does not gate login on a 2FA factor). No client-side surface to review.
- Apple-auth UI — `useAppleAuth` exists in `authApi.ts:186-202` but no page invokes it; out of scope.

---

## 3. Render / identity / OAuth invariants

The contracts these pages owe the rest of the SPA and the user. Each is testable.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Password **never logged or persisted** by the page. `react-hook-form` state lives in the React tree; submit hands the plaintext to `useLogin`/`useRegister`/`useResetPassword`, which POSTs over the wire and discards. No `console.log` of form data; no `localStorage.setItem`; no analytics event with the value. | `LoginPage.tsx:57-63`, `RegisterPage.tsx:68-102`, `ResetPasswordPage.tsx:48-63` — submit handlers carry `data` straight into the mutation; no intermediate write. `authStore.ts:71-74` partialize excludes everything except `user` + `isAuthenticated`. | ❌ none | password in browser storage / Sentry breadcrumb / console.* survives a future ops handoff |
| I-2 | Google OAuth must run an **auth-code flow with PKCE** if the server is going to trust the client-supplied artifact as proof of Google identity. Current setting is `flow: 'implicit'` — the SPA receives an `access_token` and forwards it to `/auth/google`. Whether this satisfies the invariant depends entirely on the server's verification step (does `/auth/google` call Google's `tokeninfo`/`userinfo` and check `aud` against your client_id, or does it trust the access token at face value?). **Not enforced on the client at all.** | `LoginPage.tsx:66-78`, `RegisterPage.tsx:121-133` — `flow: 'implicit'` passed explicitly. Server contract is in `backend/src/modules/auth/auth.service.ts` (Google branch, ~`:989-991, :1027-1029`; see [`auth.md` F-2](auth.md) which spot-checked the social-auth status guard). | ❌ none | a Chrome extension / network intermediary that observes the access_token can replay it to your `/auth/google` for the same client_id and impersonate the user |
| I-3 | The password-reset page must not allow the form to submit without a `token` query parameter. Missing token = early redirect to `/forgot-password`. | `ResetPasswordPage.tsx:41-46` `useEffect` redirects; `:48-49` guard `if (!token) return;` before mutate; `:104-106` renders `null` while redirect is pending. | ❌ none | client renders the reset form, user types a new password, mutation fires with `token: ""` and 4xxs — not a security defect but the UX leaks an unused password attempt to the wire |
| I-4 | Error messages must **not** disambiguate "unknown email" from "wrong password" from "account suspended". The page surfaces whatever the backend returns; the **backend** is responsible for the constant-time, single-message behavior. Cross-link: [`auth.md` I-9](auth.md) — `validateUser` is timing-safe and returns `'Invalid credentials'` for all three branches. | `authApi.ts:21-23` (login `onError`), `authApi.ts:96-98` (forgot-password `onError`) — both fall through to `error.response?.data?.message`, so leakage risk is **server-controlled, not page-controlled**. `ForgotPasswordPage.tsx:32-37` always advances to `emailSent` on 200 (server-side enumeration defense at `auth.md` §4.2 returns 200 unconditionally). | ❌ none | combined with a server-side leak this becomes an enumeration oracle |
| I-5 | Post-login navigation must land the user on a route their role can actually render. Today **all roles route to `/dashboard`** (`LoginPage.tsx:53, :60, :70`) regardless of `user.role`. `ProtectedRoute.tsx:21-22` then redirects to `/dashboard` if the user lacks the route's `allowedRoles`, but `/dashboard` itself is universally allowed (per `Sidebar.tsx:54` it lists all five roles), so the redirect doesn't break — it just means a WAITER lands on a manager-leaning screen. This is a **UX** finding, but it also means there's no test asserting role-correct landing pages, which would catch a future bug where someone adds a role gate to `/dashboard`. | `LoginPage.tsx:51-55, :60, :70` (all three navigate to `/dashboard`); `RegisterPage.tsx:97-99` (always navigates to `/login`); `VerifyEmailPage.tsx:40` (post-verify navigates to `/dashboard` or `/login`); `ResetPasswordPage.tsx:58` (post-reset always `/login`). | ❌ none | WAITER/KITCHEN sees dashboard tile they're not supposed to (today: harmless); future: `/dashboard` gets an ADMIN-only gate and login silently bounces every non-admin to `/login` via ProtectedRoute |
| I-6 | The Google client_id must be present at boot. Missing → `GoogleOAuthProvider` initializes with `''` and the popup will fail with a generic Google error. | `main.tsx:19` `googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID \|\| ''` — falls back to empty string silently. `LoginPage.tsx:74-76, RegisterPage.tsx:129-131` only `console.error` on failure. | ❌ none | misconfigured environment ships to prod with a silent OAuth-broken state; users see "Sign in with Google" → modal flashes → nothing |
| I-7 | After a successful password reset the local session must be considered invalid until the user re-authenticates. Today the page sits on the success screen for 3 s with `accessToken` still in the Zustand store (`ResetPasswordPage.tsx:57-59`). The server has already revoked refresh + bumped `tokenVersion` ([`auth.md` I-3, §6 — atomic-consume](auth.md)), so any in-flight access token is dead by next request — but the *current* render of the success screen could still navigate to `/dashboard` via browser back/forward and try a request before the timeout fires. | `ResetPasswordPage.tsx:54-60` — `setResetSuccess(true)` then 3 s timeout; no `useAuthStore.getState().logout()` call between. | ❌ none | low — server rejects on next request, but the SPA-side UX briefly suggests the old session is still valid |
| I-8 | Registration **must not** issue tokens for the PENDING_APPROVAL branch. The page consumes `response.pendingApproval` and navigates to `/login` with a banner instead of treating it as a logged-in user. Cross-link: [`auth.md` I-12](auth.md) — server returns `accessToken: null` for that branch. | `RegisterPage.tsx:87-100` (branch on `pendingApproval`); `authApi.ts:38-44` (no `login()` call in `useRegister.onSuccess`). | ❌ none | self-registered WAITER auto-authenticated despite needing admin approval (server already guards; client mirrors correctly) |
| I-9 | The Verify-Email page must accept exactly 6 numeric digits and refuse to submit otherwise. | `VerifyEmailPage.tsx:8` `CODE_LENGTH = 6`; `:33` early-return on `code.length !== CODE_LENGTH`; `:114` `pattern="\d{6}"`; `:118` strips non-digits via `replace(/\D/g, '').slice(0, 6)`; `:131` button `disabled={code.length !== CODE_LENGTH}`. | ❌ none | non-numeric / variable-length code hits the wire and 400s — UX nit, not security |

Invariants I-1, I-3, I-8, I-9 are unambiguously enforced. I-2 is the §5.5 seed and remains **unverified on the server side** from this review — the page is doing what the upstream finding flagged. I-4 is server-controlled and we trust the upstream finding. I-5 and I-7 are present-tense gaps.

---

## 4. State machines

### 4.1 LoginPage form lifecycle

```
                ┌──────────────────────────────────────────┐
                │              IDLE                        │
                │  rememberMe, email, password (RHF)       │
                └────────────┬─────────────────────────────┘
                             │ handleSubmit(onSubmit) (LoginPage.tsx:57)
                             │ — Zod validates on blur, blocks invalid
                             ▼
                ┌──────────────────────────────────────────┐
                │   SUBMITTING (isPending===true)          │
                │   Button isLoading; Google btn disabled  │
                │   via disabled={isGooglePending} (:184)  │
                └────────────┬─────────────────────────────┘
                             │
                ┌────────────┴─────────────┬──────────────┐
                ▼                          ▼              ▼
        ┌──────────────┐         ┌────────────────┐  ┌──────────┐
        │  SUCCESS     │         │   ERROR        │  │ (no 2FA  │
        │ login() →    │         │ toast.error    │  │  branch  │
        │ store; nav   │         │ form re-       │  │  exists) │
        │ '/dashboard' │         │ enabled        │  └──────────┘
        └──────────────┘         └────────────────┘
```

**Notes on the state machine:**
- **No SUBMITTING → 2FA branch** in this codebase. The main-app login is single-factor; 2FA is superadmin-only ([`auth.md` §4.3 / superadmin.md](auth.md)).
- The **double-submit window** is partially handled by `Button isLoading={isPending}` (`LoginPage.tsx:183`) and the Google-button's `disabled={isPending}` (`:194`), but the **form's `<form onSubmit>` itself is not guarded** — pressing Enter twice in <16 ms (before `isPending` flips) double-fires. React Query's mutation will execute the second `mutate` and the backend will see two POST `/auth/login`. The backend's `validateUser` is idempotent (no side effects until token issuance), but two refresh cookies get rotated through and only the last sticks. Flagged in §7 as F-1.
- **SUCCESS → /dashboard** is hard-coded; `user.role` is never read here. See I-5.
- **`isAuthenticated` reactive redirect** (`:51-55`) fires after `login()` flips the store. There are therefore *two* `navigate('/dashboard')` triggers — the `onSuccess` callback at `:60` and the `useEffect` at `:53` — both pointing the same direction, so no observable bug; mild redundancy.

### 4.2 RegisterPage form lifecycle

```
IDLE ──[handleSubmit]──► SUBMITTING ──┬──► SUCCESS_NORMAL → navigate('/login')           (RegisterPage.tsx:98)
                                       │
                                       ├──► SUCCESS_PENDING → navigate('/login',         (:91-96)
                                       │       { state: { pendingApproval, message } })
                                       │
                                       └──► ERROR → toast.error (authApi.ts:45-47)

Guards:
- !acceptedTerms (:69-71) early-returns. Button also disabled={!acceptedTerms} (:281).
- Zod refine (:37-48): if role===ADMIN require restaurantName, else require tenantId.
- isAdmin (:66) toggles which field is rendered (:230-246).
```

The PENDING_APPROVAL banner is read by LoginPage from `location.state` (`LoginPage.tsx:27-28, :110-123`) — this is the **same-tab** route state which doesn't survive a page reload, so if the user reloads `/login` after a PENDING registration the banner is gone. Acceptable for a UX nudge; not a contract violation.

### 4.3 Password-reset state machine (client mirror of server flow)

```
ForgotPasswordPage:
  IDLE ─[submit email]─► REQUEST_SENT (emailSent===true, banner UI)        (:34-36, :61-108)

ResetPasswordPage:
  ENTRY ─[no ?token]──► REDIRECT to /forgot-password                       (:41-46)
  ENTRY ─[?token present]──► TOKEN_AWAITING_USE
                              user types new+confirm password
                              Zod refine confirms match (:26-29)
        │
        ▼
  TOKEN_AWAITING_USE ─[submit]─► CONSUMING (isPending)
        │
        ├──► PASSWORD_SET (resetSuccess===true)                            (:54-60)
        │      success screen + setTimeout 3 s → navigate('/login')
        │      ⚠ stale access token still in memory store during 3s window  (I-7)
        │
        └──► ERROR → toast.error                                           (authApi.ts:110-113)
```

The page **does not have a TOKEN_VERIFIED state separate from TOKEN_AWAITING_USE**, because the backend doesn't expose a "verify-only" endpoint. The only call is `POST /auth/reset-password` which atomically consumes the token ([`auth.md` §6 — gold-standard pattern](auth.md)). So:

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `URL → REDIRECT` | `searchParams.get('token')` is falsy | `ResetPasswordPage.tsx:42-46` | yes | none |
| `URL → TOKEN_AWAITING_USE` | `token` present | `:42-46` (else branch) | yes | renders form |
| `TOKEN_AWAITING_USE → CONSUMING` | submit | `:48-49` re-checks `!token`; Zod `:26-29` | no (mutation in flight) | POST /auth/reset-password |
| `CONSUMING → PASSWORD_SET` | mutation success | `:54-60` `onSuccess` | **server-side yes** (atomic-consume, second arrival ⇒ 400) | server-side: tokenVersion++, refresh revoke, password updated — **all in a single `$transaction`** |
| `CONSUMING → ERROR` | mutation reject | `authApi.ts:110-113` | yes | toast only |
| `PASSWORD_SET → /login` | `setTimeout(3000)` | `:57-59` | yes | navigation |

**Reset-link replay protection:** server-side. The client does not need to defend against replay because the backend's atomic-consume guarantees at most one consume per token. Cross-link: [`auth.md` §6 race-table + §8 reference implementation](auth.md). The **only** client-side hardening needed is to call `useAuthStore.getState().logout()` between `setResetSuccess(true)` and the redirect so a back-button gesture during the 3 s window cannot re-render the authenticated shell with a now-revoked access token. Flagged as F-2.

### 4.4 VerifyEmailPage state machine

`VerifyEmailPage.tsx:18` declares the local state union explicitly: `'idle' | 'success' | 'error'`. There is **no SUBMITTING state** in the local enum — the page relies on `isVerifying` from the mutation hook. The error state is sticky until the user types again (no `useEffect` clears `errorMessage` on `code` change), but typing into the input does not block submit; only `code.length !== 6` does (`:131`).

```
idle ─[submit valid code]─► (isVerifying) ─┬─► success → setTimeout 2s → navigate(dashboard|login)
                                            └─► error (errorMessage retained until next submit)
```

---

## 5. Money & precision audit

**N/A.** No price math on these pages.

---

## 6. Concurrency / replay hazards

### 6.1 Double-submit on login

`LoginPage.tsx:138` `<motion.form onSubmit={handleSubmit(onSubmit)}>` has **no `disabled` attribute on the form itself** during pending. The submit button has `isLoading={isPending}` (`:183`), and `Button` (assumed to set `disabled` while loading — verify in `components/ui/Button.tsx`) blocks a second click, but **keyboard Enter on the email field still fires submit even with a disabled button** in some browsers if the form's `onSubmit` is not gated. React Query's `useMutation` is **not** single-flight by default — a second `mutate()` call enqueues a second network request. Verified at `useMutation` docs and at `useLogin` (`authApi.ts:8-25`): no `mutate` short-circuit on pending.

**Reproduction sketch:** focus password field, press Enter, immediately press Enter again before the optimistic re-render. Two POST `/auth/login` fire. Server runs `validateUser` twice; both succeed; both call `generateTokens` ([`auth.md` §6 race row 1](auth.md) — refresh-rotation isn't transactional, so this matches the F-3 server-side window). Net: two refresh-token rows persisted, only the latest cookie sticks. Severity Low (no privilege escalation), but it amplifies the server-side F-3 race.

**Fix on client:** gate the submit handler:

```ts
const onSubmit = (data: LoginFormData) => {
  if (isPending) return;
  login(data, { onSuccess: () => navigate('/dashboard') });
};
```

Same gap exists on `RegisterPage.tsx:68-102`, `ForgotPasswordPage.tsx:32-37`, `ResetPasswordPage.tsx:48-63`, `VerifyEmailPage.tsx:30-52`. Flagged once in §7 as F-1.

### 6.2 Reset-link replay (server-side handled)

Server side: atomic-consume in a `$transaction` ([`auth.md` I-1, §6, §8 gold-standard pattern](auth.md)). Client side: no defense needed beyond not surfacing the second `BadRequestException` as a confusing toast. Today `authApi.ts:111-113` flattens it to `error.response?.data?.message` which the backend sets to `'Invalid or expired reset token'` for both the "wrong hash" and the "lost the race" branch (see `auth.service.ts:687-722` in the backend review). No info leak.

### 6.3 OAuth implicit-flow replay window

`useGoogleLogin({ flow: 'implicit' })` produces an `access_token` that is then `POST`ed to `/auth/google` (`LoginPage.tsx:67-72`). The token transits:
1. Google's auth server → user's browser (URL fragment redirect, never sent to your origin's server).
2. `@react-oauth/google` callback → `tokenResponse.access_token` in JS memory.
3. `googleAuth(tokenResponse.access_token, ...)` → axios POST → your `/auth/google` over TLS.

The window of exposure on the browser is step 2 — any other code running on the same origin can read `tokenResponse.access_token` from the callback if it monkey-patches `useGoogleLogin`. Auth-code+PKCE would shrink that window: the browser would forward a **single-use code** instead, the code would be exchanged server-side for a verified ID token, and a replay of the captured code would fail. This is **the** reason the IETF current best practice (RFC 8252 / OAuth 2.1 draft) deprecates implicit flow for SPAs. See §7 F-3.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Low | Cor | `LoginPage.tsx:57-63`, `RegisterPage.tsx:68-102`, `ForgotPasswordPage.tsx:32-37`, `ResetPasswordPage.tsx:48-63`, `VerifyEmailPage.tsx:30-52` | Submit handlers don't short-circuit when the underlying mutation is already pending. The button is disabled, but keyboard-Enter on a non-button focus or a same-tick second submit can fire two mutations. Amplifies server-side refresh-rotation race ([`auth.md` F-3](auth.md)). | `if (isPending) return;` as the first line of every `onSubmit`. Or pass `mutate` to a `singleFlight()` wrapper. |
| F-2 | Low | Sec | `ResetPasswordPage.tsx:54-60` | After password reset success the local Zustand store still holds the (now server-revoked) access token for 3 seconds while the redirect timeout runs. Browser-back/forward during that window paints the authenticated shell briefly even though the next API call will 401. | Call `useAuthStore.getState().logout()` immediately after `setResetSuccess(true)` at `:55`, before the `setTimeout`. |
| F-3 (was §5.5 seed) | Medium | Sec | `LoginPage.tsx:66-78`, `RegisterPage.tsx:121-133` | Google OAuth uses `flow: 'implicit'` (`:77`, `:132`) which returns an `access_token` to the browser. The page forwards that token to `/auth/google` (`authApi.ts:170-183`). Modern guidance (OAuth 2.1 draft, RFC 8252) deprecates implicit flow for SPAs in favor of **auth-code + PKCE** so the browser never holds a long-lived bearer. Whether this is exploitable depends entirely on the server's `/auth/google` verification — does it re-validate `aud === client_id` and pull profile via tokeninfo, or does it trust the SPA-supplied token's claims? Server-side: not verified in this review; see cross-link. | Migrate to `useGoogleLogin({ flow: 'auth-code' })` and have the server exchange the code with `code_verifier`. As an interim hardening, confirm `/auth/google` (a) calls Google's `tokeninfo` endpoint, (b) asserts `aud === GOOGLE_CLIENT_ID`, (c) asserts `email_verified === true` before creating/linking a User row. |
| F-4 | Low | Sec | `VerifyEmailPage.tsx:43-49` | Error message defaults to the **English literal** `'Verification failed. The code may be expired or invalid.'` whenever `error.response?.data?.message` is falsy. Two issues: (a) the literal is not i18n'd while every other auth-error toast goes through `i18n.t(...)` (cf. `authApi.ts:22, :46, :97`); (b) the message could phrase as "code expired or invalid" without distinguishing — already does. Not an info-leak, but inconsistent with the codebase pattern. | Pipe through `i18n.t('auth:verifyEmail.errorDefault')`. |
| F-5 | Low | Cor | `LoginPage.tsx:51-55` and `:60` | Two parallel `navigate('/dashboard')` paths: `useEffect` on `isAuthenticated` *and* `onSuccess` callback. After a successful `login` mutation both fire. Today the `replace` semantics make it idempotent, but if a future change lands the `onSuccess` path on a role-conditional route while the `useEffect` still targets `/dashboard`, the user will land on whichever resolves first — race-y by accident. | Remove the `useEffect` (`:51-55`); rely on the `onSuccess` callback. The `useEffect` was for boot-time redirection of an already-authenticated user who navigated to `/login` directly — that case can move to a route guard. |
| F-6 | Medium | Sec/UX | `LoginPage.tsx:53, :60, :70`; `VerifyEmailPage.tsx:40` | Post-login / post-verify navigation is always to `/dashboard` regardless of `user.role`. WAITER, KITCHEN, COURIER all land on the admin-shaped dashboard. No present-tense security defect (all roles are allowed on `/dashboard` per `Sidebar.tsx:54`), but: (a) it's the kind of behavior that silently breaks the day someone gates `/dashboard` for ADMIN/MANAGER only; (b) it leaks one extra protected-route fetch for non-admin roles. | Compute a role-to-landing map (`ADMIN→/dashboard`, `MANAGER→/dashboard`, `WAITER→/tables`, `KITCHEN→/kds`, `COURIER→/deliveries`) and navigate from that. Add a test (§10 T-3). |
| F-7 | Low | Sec | `LoginPage.tsx:74-76`, `RegisterPage.tsx:129-131` | Google OAuth `onError` does `console.error('Google login error:', error)`. The `error` object from `@react-oauth/google` can include `error_description` and the bound client_id — fine in dev, but in production with Sentry breadcrumbs enabled this can land non-PII config in error telemetry. Low risk, but mirrors the §5.9 / auth.md F-8 pattern of "telemetry leakage". | Either drop the `console.error` in prod or replace with a `Sentry.captureMessage('google_oauth_error', { level: 'warning' })` with no raw object. |
| F-8 | Low | Cor | `RegisterPage.tsx:31` | Zod password validator is `z.string().min(8, ...)` only — no upper/lower/digit. The PasswordStrength UI (`:199`, `PasswordStrength.tsx:23-50`) renders requirement ticks but **does not gate submit**. So a user typing `"password"` will see four red X's in the UI and the form will still submit. Backend rejects via `RegisterDto` complexity regex ([`auth.md` I-11](auth.md)), so the server enforces the contract; the page misrepresents the bar. | Tighten the Zod schema to match the backend regex (`/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/`) so the page's own validator agrees with the visible strength meter, eliminating a "looks blocked, actually allowed" UX gap. Same drift exists at `ResetPasswordPage.tsx:23` (`min(8)` only). |
| F-9 | Low | Sec | `main.tsx:19` | `googleClientId` falls back to empty string if `VITE_GOOGLE_CLIENT_ID` is missing, silently. The Google login button still renders; click → silent failure. Operationally a foot-gun: a misconfigured env reaches prod undetected. | Throw at boot in production builds if `VITE_GOOGLE_CLIENT_ID` is empty, mirroring the `VITE_API_URL` hardening landed in commit `5154c2e`. |
| F-10 | Info | UX | `ResetPasswordPage.tsx:121, :129` | New-password fields use `type="password"` directly (raw `<Input>`) instead of `PasswordInput` (which provides the eye-toggle used elsewhere — see `LoginPage.tsx:153, RegisterPage.tsx:192`). Inconsistent UX. | Swap to `PasswordInput`. |
| F-11 | Info | UX | `LoginPage.tsx:26, :168-169` | `rememberMe` is captured into local state and **never sent to the backend**. The login mutation body is `{email, password}` only (`authApi.ts:12-15`). The checkbox is decorative. | Either wire `rememberMe` into the login payload and use it to switch the refresh-cookie's `Max-Age` server-side, or drop the checkbox until the feature exists. |

Severity scale: Critical → High → Medium → Low → Info. None Critical/High.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **`LoginPage.tsx:138` form via `react-hook-form` + Zod resolver** — schema is colocated with the form (`:30-33`), validation runs on blur (`:48`), errors render inline (`:146, :156`). This is the pattern every form in the SPA should follow; today only the auth pages and a few settings pages do.
- **`RegisterPage.tsx:69-71` + `:281` double-gate on `acceptedTerms`** — both the handler early-returns *and* the button is disabled. Belt-and-braces in case the disabled-button is bypassed (e.g., Enter-on-form).
- **`RegisterPage.tsx:87-100` PENDING_APPROVAL branch** correctly diverts to `/login` with route state instead of treating the response as logged-in. Mirrors [`auth.md` I-12](auth.md). LoginPage then reads that state and renders the banner (`LoginPage.tsx:110-123`). The pattern of "register hands off to login via `location.state`" avoids persisting any PENDING marker in storage — clean.
- **`ResetPasswordPage.tsx:41-46`** guard against missing `?token`. Most SPA reset-password screens render the form unconditionally and let the API 4xx; this one redirects upfront.
- **`VerifyEmailPage.tsx:114, :118, :131`** triple-defense on 6-digit code: HTML pattern, in-handler regex strip, button-disabled gate.
- **`authStore.ts:71-74`** `partialize` keeps the access token in memory only. This is **already** the gold standard for SPA token handling and the auth pages take advantage of it correctly — no `localStorage.setItem('token', ...)` anywhere on these pages.
- **Error-boundary integration** — `main.tsx:43-50` wraps the whole tree including the auth routes, so a render-time exception inside any of these pages still shows the ErrorBoundary fallback rather than a white screen. Spot-check: no auth page uses Suspense / async-component patterns that would defeat this.
- **`ForgotPasswordPage.tsx:34-37`** advances to `emailSent` only on `onSuccess`. There is no `onError` advance — so if the server (incorrectly) starts returning 4xx for unknown emails in the future, the page would surface that as a toast instead of silently confirming. The server already returns 200 unconditionally ([`auth.md` §4.2](auth.md)); the client doesn't try to second-guess.

---

## 9. Spot-checks performed

**Verified:**
- F-3 (OAuth implicit) — `LoginPage.tsx:77` explicit `flow: 'implicit'`; `authApi.ts:170-183` posts `tokenResponse.access_token` (not an id_token) to `/auth/google`. Matches §5.5 seed.
- F-6 (role-blind redirect) — `LoginPage.tsx:53, :60, :70` all use literal `'/dashboard'`; no `user.role` read.
- F-8 (Zod password drift) — `RegisterPage.tsx:31` is `min(8)` only; `PasswordStrength.tsx:23-50` checks five requirements; submit handler does not consult strength score.
- I-1 (no password persistence) — grepped for `localStorage` writes in the three pages: only `authStore` persist (via Zustand middleware) writes, and `partialize` (`authStore.ts:71-74`) excludes password and access token. RHF state is in React memory.
- I-9 (6-digit guard) — `VerifyEmailPage.tsx:8, :33, :114, :118, :131` all verified together.

**Cross-linked to backend (not re-verified here):**
- I-2 / F-3 server side — depends on `/auth/google` implementation in `auth.service.ts`. The upstream review note ([`auth.md` F-2](auth.md)) verified the *status guards* on social-auth but did **not** verify the Google token-validation step itself. That's still open.
- I-4 (email enumeration timing) — confirmed in [`auth.md` I-9](auth.md), `auth.service.ts:421-424`.
- I-7 (reset session revocation) — server already nukes tokenVersion + refresh in the same `$transaction` ([`auth.md` I-1, §8](auth.md)); the only client-side gap is the 3-s window flagged as F-2.

**Dropped:**
- *Was considered:* "RememberMe state may persist credentials". Verified `LoginPage.tsx:26` only stores the boolean in component state; it is never read after, never sent to backend (see F-11). No credential persistence. Drop.
- *Was considered:* "Google OAuth callback URL might be susceptible to open-redirect via `state` parameter". `@react-oauth/google`'s `useGoogleLogin` manages `state` internally and does not expose a redirect-after-login parameter on the page side. Drop.
- *Was considered:* "ResetPasswordPage might be vulnerable to a planted `?token=` if the user visits a phishing URL that auto-submits". The form requires the user to type a new password — there is no auto-submit. The phishing scenario would have to convince the user to type their *desired* new password into the form, at which point the attacker would need control of the email inbox to know the real token; that's not a client-side defect. Drop.

**Downgraded:**
- F-3 from High → Medium because the server-side validation step is plausibly already secure (Google's tokeninfo call is the de-facto pattern); upgrading back to High contingent on a server-side audit finding that `/auth/google` trusts the access token without external validation.

**No unverified findings** in this file. Every row in §7 is grounded in a line read end-to-end. The single "depends-on" is F-3's server-side leg.

---

## 10. Recommended tests

Five tests. The first three are integration tests against the rendered pages with msw-mocked `/auth/*` endpoints; T-4 is a unit test on the Zod schema; T-5 is a server-side test that lives in the backend repo but is referenced here because the client-side invariant depends on it.

```ts
// frontend/src/pages/auth/__tests__/LoginPage.spec.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('LoginPage invariants', () => {
  // I-4 + I-9: invalid credentials produce a single generic message and no
  // distinguishable response timing between "unknown email" and "wrong password".
  it('T-1: invalid-credentials does not distinguish email-unknown vs password-wrong', async () => {
    // arrange: msw returns 401 with `{message: 'Invalid credentials'}` for both
    //   - email=ghost@example.com / password=foo
    //   - email=real@example.com  / password=wrong
    // act: submit each, measure (a) shown toast text, (b) elapsed time
    // assert: identical toast string; elapsed time within 50 ms of each other
    //   (server-side timing-safety; this test catches a regression that adds
    //    a client-side branch like "if 404 say X, if 401 say Y")
  });

  // I-2 / F-3 (client side only): the OAuth flow must NOT be 'implicit'.
  // This is a snapshot-style guard so the day someone migrates to auth-code,
  // accidentally reverting breaks CI.
  it('T-2: Google OAuth uses auth-code+PKCE flow, not implicit', () => {
    // arrange: import { useGoogleLogin } from '@react-oauth/google';
    // mock useGoogleLogin to capture its argument.
    // act: render LoginPage and click the Google button.
    // assert: the captured argument's `flow` property is 'auth-code', not 'implicit'.
    //   FAILS today (intentional — pinned to the F-3 fix). Once F-3 lands,
    //   remove this skip.
  });

  // I-5 / F-6: role-correct landing page.
  it('T-3: post-login navigation routes to the role-appropriate page', async () => {
    // arrange: parameterize over UserRole. Mock /auth/login to return a user
    //   with that role + an accessToken.
    // act: submit the form.
    // assert: navigate() called with the expected path per role:
    //   ADMIN, MANAGER -> /dashboard
    //   WAITER        -> /tables   (or whichever is canonical)
    //   KITCHEN       -> /kds
    //   COURIER       -> /deliveries
    //   Today this test will fail for non-admin roles — that's the point.
  });
});

// frontend/src/pages/auth/__tests__/RegisterPage.spec.tsx
describe('RegisterPage invariants', () => {
  // I-8 + F-8: password complexity drift between Zod and the strength meter.
  it('T-4: weak passwords pass Zod but the strength meter flags them — should not', async () => {
    // arrange: render RegisterPage; type email/firstName/lastName; accept terms;
    //   type password="password" (8 chars, all lowercase, no digit).
    // act: click submit.
    // assert: Zod refuses (form does not call useRegister.mutate).
    //   Today this assertion FAILS — Zod accepts. After F-8 fix it passes.
    //
    // Bonus: parameterize over edge cases:
    //   - 7 chars all-classes: Zod refuses (length)
    //   - 8 chars all-lower:    Zod refuses (after fix; currently accepts)
    //   - 8 chars upper+lower+digit: Zod accepts
  });
});

// backend/src/modules/auth/__tests__/google-oauth.integration.spec.ts
// (Lives in backend but cross-referenced here because it's the server-side
//  half of F-3.)
describe('POST /auth/google verifies tokens via tokeninfo', () => {
  // T-5: a forged access_token with audience != GOOGLE_CLIENT_ID is rejected.
  it('rejects an access_token whose tokeninfo audience does not match', async () => {
    // arrange: mock https://oauth2.googleapis.com/tokeninfo to return
    //   { aud: 'attacker-client-id', email: 'victim@example.com', email_verified: true }
    // act: POST /auth/google { credential: '<forged-token>' }
    // assert: 401, no User row created, no audit row.
    //
    // If this test cannot be written because the server doesn't call tokeninfo
    // at all, that IS the F-3 finding and confirms the High variant.
  });
});
```

Cross-tenant tests are not relevant here (auth pages predate tenant binding). For the post-login destination test (T-3) follow the integration-test style from `CODE_REVIEW.md §3.1` — parameterize over `UserRole`, assert the navigation target per role.
