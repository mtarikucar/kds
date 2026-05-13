# `frontend/protected-routes` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `frontend/src/components/ProtectedRoute.tsx`
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/sentry.config.ts`
- `frontend/src/main.tsx`

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.3 (frontend components health), §2 F2 (ProtectedRoute hydration race), §2 F4 (no `unhandledrejection` listener).

---

## 1. Health & summary

🟡 yellow

The four files that make up the admin SPA's render gate, error gate, and telemetry sit on a healthy split-persistence model — `accessToken` lives in memory only (`store/authStore.ts:38-77`), refresh stays httpOnly server-side, Sentry strips the obvious PII keys, and there is no `dangerouslySetInnerHTML` / `innerHTML =` / `eval` anywhere in `frontend/src`. The two remaining sharp edges both flow from one architectural choice: `isAuthenticated` is persisted to localStorage (`authStore.ts:71-74`) while `accessToken` is not. On reload, `ProtectedRoute` reads `isAuthenticated=true` from persisted state, decides to render children, and children fire requests before the in-flight `/auth/refresh` has populated `accessToken` — the classic F2 flicker + double-fetch (`ProtectedRoute.tsx:11-26`). The second edge: `ErrorBoundary` covers render-phase exceptions only; an unhandled Promise rejection (a failed `useQuery`, a missing `await`, a thrown listener) is invisible to Sentry because `main.tsx` never wires `window.addEventListener('unhandledrejection', ...)` (`main.tsx:16-54` — F4). Neither breaks security. Both degrade observability and UX in exactly the modes you most want to see in production.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/components/ProtectedRoute.tsx` (29 LOC) — render gate; reads `isAuthenticated` + `user.role` from `useAuthStore`, redirects to `/login` or `/dashboard`.
- `frontend/src/components/ErrorBoundary.tsx` (176 LOC) — class boundary; `componentDidCatch` forwards to `captureException`; fallback UI with `try-again`/`reload`/`go-home`.
- `frontend/src/sentry.config.ts` (132 LOC) — `initSentry()`, `beforeSend` redaction (`password`, `token`, `apiKey`, `secret`, `authorization`), browser-context strip, ignore list, `captureException`/`captureMessage`/`setUser`/`setContext`/`addBreadcrumb` helpers.
- `frontend/src/main.tsx` (54 LOC) — `initSentry()` first, then `<StrictMode><I18n><GoogleOAuth><ErrorBoundary><QueryClient><BrowserRouter><App />`.

**Skimmed (for cross-references, not graded):**
- `frontend/src/store/authStore.ts:37-77` — confirm `partialize` excludes `accessToken` and includes `isAuthenticated`.
- `frontend/src/lib/api.ts:38-84` — confirm single-flight refresh and 401-retry path (F3 in CODE_REVIEW; out of this file's scope but cited from §6).
- `frontend/src/App.tsx:99-101, 161-180` — confirm `ProtectedRoute` wraps role-scoped route groups, and `isAuthenticated` is derived from `!!state.accessToken` *inside `App`* even though `ProtectedRoute` derives it differently.
- `frontend/src/features/auth/authApi.ts:51-64` — `useProfile` gated by `!!accessToken`; relevant to the F2 fix path.
- `frontend/src/features/superadmin/components/SuperAdminProtectedRoute.tsx` and `MarketingProtectedRoute.tsx` — sister route gates; share the same render-blocking gap.

**Skipped:**
- `frontend/src/components/ErrorBoundary.spec.tsx` — covered by §10 recommendations, not the review surface itself.
- `frontend/src/features/voxel-world/components/objects/VoxelModelObject.tsx` (has its own inner `ErrorBoundary` class) — voxel feature is dev-only-lazy-loaded; out of scope here.

---

## 3. Render / auth / observability invariants

The contract these four files are responsible for keeping.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | `ProtectedRoute` does not render children until access-token state is resolved (so children's first API call carries `Authorization`). | `ProtectedRoute.tsx:11-26` — **NOT enforced.** Gate reads only `isAuthenticated` from persisted state; renders children synchronously on reload while `accessToken` is still `null`. F2. | ❌ none | Flicker + double-fetch on every reload; in slow-refresh failure modes, children render then bounce to `/login`, momentarily exposing authenticated screens. |
| I-2 | An unauthenticated user is redirected to `/login` before any protected child mounts. | `ProtectedRoute.tsx:13-15` — `if (!isAuthenticated) return <Navigate to="/login" replace />`. | ❌ none | Bypass of route gate (mitigated by backend auth on every request, so no data leak; only UX/state issue). |
| I-3 | Role-scoped routes deny access when `user.role` is outside `allowedRoles`. | `ProtectedRoute.tsx:18-24` — checks `allowedRoles.includes(userRole)`; redirects to `/dashboard`. | ❌ none | A WAITER reaches `/admin/*`; backend still gates with role guards, but UX is broken. |
| I-4 | React render-phase errors are caught and reported to Sentry. | `ErrorBoundary.tsx:36-50` — `componentDidCatch` calls `captureException(error, { componentStack, errorBoundary: true })`. | ✅ `frontend/src/components/ErrorBoundary.spec.tsx` (1 file — the only frontend test in the project per CODE_REVIEW §3.8) | Errors silently white-screen the app. |
| I-5 | Unhandled Promise rejections are forwarded to Sentry (parity with render errors). | `main.tsx:16-54` — **NOT enforced.** No `window.addEventListener('unhandledrejection', ...)`. No global `error` listener either. F4. | ❌ none | Async failures (`useQuery` thrown, missing `await`, fire-and-forget mutations) disappear silently; production debugging blind. |
| I-6 | Sentry payloads redact known sensitive keys from breadcrumb data. | `sentry.config.ts:42-56` — `beforeSend` redacts `password`, `token`, `apiKey`, `secret`, `authorization` to `[REDACTED]`. | ❌ none | Credentials leak into telemetry. |
| I-7 | Sentry payloads do not include browser storage context (where tokens/auth state could surface). | `sentry.config.ts:59-61` — `delete event.contexts.browser`. | ❌ none | localStorage/sessionStorage snapshot included in error events. |
| I-8 | The app does not render arbitrary HTML or eval code at runtime. | Verified by grep across `frontend/src`: 0 matches for `dangerouslySetInnerHTML`, `.innerHTML =`, `eval(`, `new Function(`. | ✅ static scan | DOM-XSS / RCE-in-JS surface. |
| I-9 | `Sentry.init` is the first observable side-effect on app boot (so it captures errors during `createRoot.render`). | `main.tsx:16` — `initSentry()` called before `ReactDOM.createRoot(...).render(...)`. | ❌ none | Boot-time crashes invisible. |
| I-10 | The `ErrorBoundary` is mounted high enough to catch errors in routing/data layers, but low enough that it doesn't break i18n. | `main.tsx:43-50` — `<ErrorBoundary>` wraps `<QueryClientProvider><BrowserRouter><App />` but is *inside* `<I18nextProvider>` so the fallback's `useTranslation('errors')` works (`ErrorBoundary.tsx:96`). | ❌ none | If reordered above `I18nextProvider`, the fallback would itself throw. Worth a smoke test. |

Invariants flagged "NOT enforced" map to findings F-1 (I-1) and F-2 (I-5) below.

---

## 6. Concurrency / race hazards

This is a frontend file set — "concurrency" here means hydration-order races and event-vs-promise model gaps. Backend money-path races are out of scope.

### 6.1 Hydration race on page reload — I-1 / F-1

**Sketch:**
1. User loads `/admin/users` while authenticated. Tab is closed; reopens later.
2. Browser hydrates `localStorage['auth-storage']`. Zustand's `persist` middleware (`authStore.ts:68-75`) restores `{ user, isAuthenticated: true }`. `accessToken` stays `null` because `partialize` excludes it (correct, by design — `authStore.ts:7-26`).
3. `ProtectedRoute.tsx:11` reads `{ isAuthenticated, user }` → `isAuthenticated === true` → children render immediately (`ProtectedRoute.tsx:26`).
4. Children fire `useQuery`s on mount. `api.ts:18-29` request interceptor reads `accessToken` → `null` → no `Authorization` header.
5. Backend returns `401`. `api.ts:63-83` response interceptor catches, calls `refreshAccessToken()`, which posts to `/auth/refresh` with the httpOnly refresh cookie, gets back a new access token, then re-issues the original request.
6. UX: shell renders → flicker → double-fetch on every query. In the worst case (refresh fails, e.g. revoked cookie), child renders briefly and *then* redirects to `/login`.

**Where:** `ProtectedRoute.tsx:11-26` (the gate that reads `isAuthenticated` without checking `accessToken`).
**Severity:** Medium Cor (low security risk because the backend always re-auths; the protection bypass is purely visual). Upstream `CODE_REVIEW.md §2 F2` rates it High Cor; downgraded here because spot-check confirmed there is no data exfiltration path.
**Fix:** Block render until either (a) `accessToken` is populated, or (b) the single-flight refresh in `lib/api.ts:40-59` has settled with a known result. Concretely: track a `bootRefreshState: 'pending' | 'resolved' | 'failed'` in `authStore` and return a `<FullPageSpinner />` while pending. Or — cheaper — derive `isAuthenticated` from `!!state.accessToken` *inside `ProtectedRoute`* (matches what `App.tsx:101` already does for the route-level check) and add a `<Suspense>`-style spinner driven by a top-level `useProfile` query.

### 6.2 Error event vs Promise rejection — I-5 / F-2

React's `ErrorBoundary` API (verified at `ErrorBoundary.tsx:31-51`) catches *render-phase* exceptions: anything thrown inside `render`, lifecycle methods, or constructors of descendant components. It does **not** catch:
- Errors in event handlers (React docs are explicit; must be wrapped manually).
- Errors thrown in `setTimeout` / `requestAnimationFrame` / `Promise.then` callbacks.
- Rejected Promises that never get a `.catch()` — including `useQuery`/`useMutation` errors when the component unmounts before the error settles, and any `fire-and-forget` mutation in the codebase.

The platform-level catch for these is `window.addEventListener('unhandledrejection', ...)` for promise rejections and `window.addEventListener('error', ...)` for raw script errors. Neither is wired in `main.tsx:16-54`. Sentry's `browserTracingIntegration` (`sentry.config.ts:22`) does install a global handler for un-instrumented errors, but the `replayIntegration` + `browserTracingIntegration` combination only auto-captures certain shapes; many libraries (including TanStack Query in some configurations) swallow the rejection before it bubbles. **Spot-checked:** I did not find any explicit registration of `unhandledrejection` in `frontend/src` (`grep -rn 'unhandledrejection' frontend/src` returns 0).

**Severity:** Medium Cor — Sentry's defaults catch *some* of these but not the long tail. **Fix:** add the two listeners explicitly in `main.tsx` (see §10 test skeleton T-2).

### 6.3 Sister-gate divergence (cross-cut)

`SuperAdminProtectedRoute.tsx:4-16` and `MarketingProtectedRoute.tsx:5-26` share the same render-blocking gap but with different state shapes:
- Superadmin gate has a `requires2FA` branch (`SuperAdminProtectedRoute.tsx:11-13`) that redirects to `/superadmin/2fa`. Otherwise same `isAuthenticated`-only check.
- Marketing gate runs a `useEffect` that JWT-decodes `accessToken.split('.')[1]` and logs out on expiry (`MarketingProtectedRoute.tsx:8-19`). The decode runs *after* render commits — if a child mounts in the same tick and the JWT is already expired, the child renders with an expired token, then the effect fires `logout()`, then the child re-renders into the redirect. Same flicker class.

Fixing F-1 should be done across all three gates with one shared `useAuthBoot()` hook, not per-gate (see §7 F-5).

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Cor | `ProtectedRoute.tsx:11-26` | **I-1 violated.** Render is gated only on `isAuthenticated` from persisted state; `accessToken` is memory-only and `null` on reload. Children render → fire requests → 401 → refresh → retry. Causes UX flicker and double-fetch on every reload. Maps to upstream F2. | Add a `bootRefreshState` to `authStore`. Block render with a centered spinner until `accessToken` is populated *or* the refresh fails. Derive `isAuthenticated` from `!!accessToken` inside the gate, matching `App.tsx:101`. |
| F-2 | Medium | Cor | `main.tsx:16-54` | **I-5 violated.** No `window.addEventListener('unhandledrejection', ...)` and no global `error` listener. Async/Promise rejections that escape `useQuery`/`useMutation` (and event-handler errors that escape components) never reach Sentry. Maps to upstream F4. | In `main.tsx` after `initSentry()`: `window.addEventListener('unhandledrejection', e => captureException(e.reason instanceof Error ? e.reason : new Error(String(e.reason))))` and a parallel `'error'` listener. Keep the existing `ErrorBoundary` for render-phase coverage. |
| F-3 | Medium | Sec | `sentry.config.ts:42-56` | Redaction whitelist is shallow (`Object.keys` of `breadcrumb.data` only) and case-sensitive. Misses `Password`, `Token`, `accessToken`, `refreshToken`, `cookie`, `set-cookie`, `x-api-key`, nested objects, and any field whose redaction-worthiness is implicit (e.g., `phone`, `email`, `tckimlikNo` for the Turkish KVKK surface). The browser-context strip at `:59-61` is good but doesn't cover request bodies serialized into breadcrumbs. | Lowercase the key before comparing; walk nested objects recursively (cap depth); extend the list with `accesstoken`, `refreshtoken`, `cookie`, `set-cookie`, `x-api-key`, `email`, `phone`, `tckimlikno`. Add a denylist regex for JWT-shaped strings in any leaf value. |
| F-4 | Low | Cor | `ProtectedRoute.tsx:18-24` | When `user` is present but `user.role` is `undefined` (`if (allowedRoles && user?.role)`), the role check is skipped silently — the user passes the gate. Should not occur because backend always populates role on `/auth/profile`, but the gate fails open. | Treat missing `user.role` as a denied check: `if (allowedRoles && !userRole) return <Navigate to="/login" replace />`. |
| F-5 | Low | Arch | `ProtectedRoute.tsx:10-27`, `SuperAdminProtectedRoute.tsx:4-16`, `MarketingProtectedRoute.tsx:5-26` | Three near-identical route-gate implementations with diverging hydration semantics (admin: persisted `isAuthenticated`; superadmin: persisted `accessToken`; marketing: persisted `accessToken` + post-mount JWT exp decode). Fixing F-1 once and missing one of the three is likely. | Extract a shared `useAuthBoot(store)` hook that resolves the boot refresh and returns `'pending' | 'authed' | 'unauthed'`. All three gates render a spinner on `pending`, redirect on `unauthed`, render `children`/`<Outlet />` on `authed`. |
| F-6 | Low | Cor | `ErrorBoundary.tsx:36-51` | `componentDidCatch` calls `setState` synchronously (`:41-44`) right before `captureException` (`:47-50`). If `captureException` throws (e.g., Sentry SDK in a bad state, network blocked), the state has already been updated, but the throw propagates out of `componentDidCatch` and React's behavior for a throwing `componentDidCatch` is to log and unmount the tree — which would white-screen the boundary itself. | Wrap `captureException(...)` in a `try { } catch { /* swallow */ }`. Matches the hardening pattern in upstream commit `9b9eee4` ("Sentry try-catch in filter") on the backend filter. |
| F-7 | Low | Arch | `sentry.config.ts:67-80` | `ignoreErrors` includes `'NetworkError'`, `'Network request failed'`, `'Failed to fetch'`. This is broad: a genuine API outage that *should* page on-call is filtered out alongside extension noise. | Split into two arrays: one for known-junk (`top.GLOBALS`, browser-extension noise) → `ignoreErrors`, and a second `beforeSend` rule that downgrades network errors to `level: 'info'` but still records them. |
| F-8 | Low | Perf | `sentry.config.ts:23-26` | `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })` is loaded unconditionally. Replay's overhead is meaningful (~50-100KB gzipped plus capture cost). The `replaysSessionSampleRate` defaults to `0.1` so most sessions don't record, but the SDK still loads. | Gate `replayIntegration` behind `import.meta.env.PROD` or behind an env flag; or use the lazy-load pattern (`replayCanvasIntegration()` + dynamic import) if available in the SDK version. |
| F-9 | Info | Sec | `sentry.config.ts:105-107` | `setUser` accepts `email` and `tenantId` as plain fields. Sentry's UI displays these prominently. Cross-link to upstream `CODE_REVIEW.md §4.1` ("auth.service.ts Sentry tags using email/IP — PII in telemetry tags"): the backend has the same issue. Frontend equivalent: an attacker with Sentry-project read access sees the full tenancy and email map. | Hash the userId (e.g., `sha256(userId).slice(0, 16)`) before calling `Sentry.setUser`. Keep `tenantId` if needed for filtering, drop `email`. Document the contract in the helper's JSDoc. |
| F-10 | Info | Arch | `main.tsx:39-54` | `ErrorBoundary` sits inside `I18nextProvider` (correct, since the fallback uses `useTranslation`) but *outside* `QueryClientProvider`. A throw from `QueryClient` setup or from inside a `QueryClientProvider` lifecycle would be caught — good. But a throw from `I18nextProvider` boot would not (it's above the boundary). i18n boot failures would white-screen. | Either accept this trade-off (i18n is unlikely to throw) or move `<I18nextProvider>` inside `<ErrorBoundary>` and provide a fallback that doesn't depend on i18n. Document the chosen layering. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- `authStore.ts:7-26, 68-75` — **split-persistence design.** The JSDoc block explicitly explains why `accessToken` is memory-only and `isAuthenticated` is persisted. This is the right model; the F-1 gap is in *consuming* it, not in the design. Other features (marketing, superadmin) follow the same pattern. **Keep.**
- `sentry.config.ts:23-26` — `replayIntegration({ maskAllText: true, blockAllMedia: true })`. Aggressive masking by default; the right posture for a multi-tenant POS where any session could record card-data input. **Keep.** (F-8 only suggests gating *whether* replay loads at all, not relaxing the masking.)
- `sentry.config.ts:42-56` — `beforeSend` has a redaction pass. The whitelist is incomplete (F-3) but the *pattern* is right: redact at the boundary, not at every call site. **Keep and extend.**
- `sentry.config.ts:59-61` — `delete event.contexts.browser` strips the localStorage/sessionStorage snapshot Sentry attaches by default. Important because even though we don't store tokens in localStorage, we do store `auth-storage` (user + isAuthenticated) and `cart-storage` (cart contents) — both PII. **Keep.**
- `ErrorBoundary.tsx:21-85` — clean class-component shape; separates raw boundary from the i18n fallback (`TranslatedErrorFallback` at `:95-174`) so the boundary itself has no React-hooks dependencies that could fail during the error path. Three recovery affordances (reset, reload, go-home) and dev-only stack reveal (`:126`). **Pattern to copy** in the voxel-world inner boundary at `features/voxel-world/components/objects/VoxelModelObject.tsx:200+`.
- `main.tsx:16` — Sentry init is the **first** statement after imports. Boot-time React errors are observable. **Keep.**
- **No `dangerouslySetInnerHTML`, no `.innerHTML =`, no `eval(`, no `new Function(`** in `frontend/src` (verified by grep). This is the cleanest DOM-XSS posture in the project. **Keep.**

**Cross-link to backend Sentry tagging gaps:** upstream `CODE_REVIEW.md §4.1` notes that `auth.service.ts` tags Sentry events with raw email/IP. The frontend has the same shape via `sentry.config.ts:105` (`setUser({ email, ... })`). Fix both together — the redaction contract should be: "no raw PII in Sentry tags or `setUser` calls, only hashed identifiers + `tenantId`." Land the backend and frontend changes in one PR with shared documentation in `CLAUDE.md`.

---

## 9. Spot-checks performed

**Verified:**
- F-1: confirmed at `ProtectedRoute.tsx:11-26`. The gate truly reads only `isAuthenticated`. `authStore.ts:71-74` confirms `partialize` excludes `accessToken`. `App.tsx:101` uses `!!state.accessToken` for the same concept — inconsistent with the gate, evidence the bug is real.
- F-2: confirmed by `grep -rn 'unhandledrejection' frontend/src` returning 0 matches. `main.tsx:16-54` has only `initSentry()` and the React render; no listener registration.
- I-8 (no innerHTML/eval): confirmed by `grep -rn 'dangerouslySetInnerHTML\|\.innerHTML\s*=\|\beval(\|new Function('` against `frontend/src` — 0 matches.
- I-6 / F-3: confirmed `beforeSend` redacts the listed keys; confirmed the gap (case-sensitive, no nesting) by reading the loop at `sentry.config.ts:43-55`.

**Dropped (initial concern wasn't right):**
- "I-2 (unauthenticated redirect) is racy because `isAuthenticated` is hydrated synchronously" — verified at `authStore.ts:68-75`: Zustand `persist` middleware hydrates synchronously from `localStorage` before the first render, so `isAuthenticated` is correct on the first render. The race is the opposite direction (false positive on `isAuthenticated`, no `accessToken`), already captured in F-1.

**Downgraded:**
- F-1 — upstream `CODE_REVIEW.md §2 F2` rates this **High Cor**. Downgraded to **Medium Cor** here after verifying that:
  - Backend re-auths every request (no data leak surface);
  - The 401 → refresh → retry path is fully wired in `lib/api.ts:63-83`;
  - The visible failure mode is flicker + double-fetch, not bypass.
  Severity should rise back to High if a Sentry replay shows the brief render of authenticated screens for an unauthenticated user.

---

## 10. Recommended tests

The five tests that would catch the §3 invariants. Skeletons only.

```ts
// frontend/src/components/__tests__/ProtectedRoute.refresh-render-block.spec.tsx
describe('ProtectedRoute hydration', () => {
  it('I-1: does NOT render children before accessToken is resolved on reload', async () => {
    // arrange: seed localStorage['auth-storage'] with { user, isAuthenticated: true }
    //          but leave accessToken null in the in-memory store (simulating reload).
    //          mock /auth/refresh with a 100ms delay.
    // act:     render <BrowserRouter><ProtectedRoute><div data-testid="child" /></ProtectedRoute></BrowserRouter>
    // assert:  queryByTestId('child') is null while refresh is pending.
    //          after refresh resolves, getByTestId('child') is in the document.
    //          api mock for /any/protected/endpoint was NOT called before refresh resolved.
  });

  it('I-2: unauthenticated user is redirected to /login synchronously', () => {
    // arrange: empty localStorage; empty store.
    // act:     render the protected route at /pos
    // assert:  location.pathname === '/login'
  });

  it('I-3: WAITER hitting /admin/* is redirected to /dashboard', () => {
    // arrange: store hydrated with { user: { role: WAITER }, isAuthenticated, accessToken: 'x' }
    // act:     render <ProtectedRoute allowedRoles={[ADMIN, MANAGER]}><AdminPage /></ProtectedRoute>
    // assert:  location.pathname === '/dashboard'
  });
});
```

```ts
// frontend/src/__tests__/unhandledrejection.spec.ts
describe('unhandledrejection forwarding', () => {
  it('I-5: a rejected Promise without .catch is reported to Sentry', async () => {
    // arrange: spy on Sentry.captureException via the helper export.
    //          import main.tsx (or whichever module wires the listener).
    // act:     window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',
    //            { promise: Promise.reject(new Error('boom')), reason: new Error('boom') }))
    // assert:  captureException called once with Error('boom').
  });

  it('a plain window "error" event is also reported', async () => {
    // act:     window.dispatchEvent(new ErrorEvent('error', { error: new Error('sync boom') }))
    // assert:  captureException called once with Error('sync boom').
  });
});
```

```ts
// frontend/src/__tests__/sentry-redaction.spec.ts
describe('Sentry beforeSend redaction', () => {
  it('I-6: redacts password/token/apiKey/secret/authorization (case-insensitive) from breadcrumbs', () => {
    // arrange: build a fake Sentry event with breadcrumbs:
    //   [{ data: { Password: 'pw', AccessToken: 't', cookie: 'c', email: 'x@y' } }]
    // act:     call the beforeSend export directly with the fake event.
    // assert:  every sensitive key in the returned event is '[REDACTED]'.
    //          NOTE: this test will FAIL today against the current implementation (F-3).
    //          Land the fix in the same PR.
  });

  it('I-7: strips contexts.browser', () => {
    // arrange: event.contexts.browser = { localStorage: { 'auth-storage': '...' } }
    // act:     call beforeSend.
    // assert:  event.contexts.browser is undefined.
  });
});
```

```ts
// frontend/src/__tests__/no-dangerous-html.spec.ts
describe('I-8: no unsafe HTML/code sinks', () => {
  it('grep frontend/src finds no dangerouslySetInnerHTML / innerHTML / eval / new Function', () => {
    // act:     execSync("grep -rln 'dangerouslySetInnerHTML\\|\\.innerHTML\\s*=\\|\\beval(\\|new Function('
    //                    frontend/src", { encoding: 'utf8' })
    // assert:  output is empty. Failing this test = PR blocker.
    // (Same scan should run in CI; see CODE_REVIEW.md §11.2.)
  });
});
```

```ts
// frontend/src/components/__tests__/ErrorBoundary.captureException-failure.spec.tsx
describe('I-4 hardening (F-6): boundary survives a Sentry SDK throw', () => {
  it('renders the fallback even when captureException itself throws', () => {
    // arrange: jest.mock('../../sentry.config', () => ({ captureException: () => { throw new Error('sentry down'); } }))
    // act:     render <ErrorBoundary><BoomChild /></ErrorBoundary> where BoomChild throws on mount.
    // assert:  fallback UI ("somethingWentWrong") is in the document.
    //          NOTE: this test FAILS today (F-6). Wrap captureException in try/catch first.
  });
});
```

Cross-link: when implementing F-3 + F-9, also extend the redaction tests to cover the **backend** `sentry.config.ts` (no per-feature review yet for backend Sentry; CODE_REVIEW.md §4.1 captures the same gap). Shared test fixture for the redaction key list.

---

*End of `frontend-protected-routes.md`. Follow-up actions: F-1 and F-2 are P1 in `../CODE_REVIEW.md §7`; F-3 should be promoted there once the redaction gap is reproduced against a live event payload.*
