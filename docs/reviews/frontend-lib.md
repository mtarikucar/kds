# `frontend/src/lib/` — Deep Review (2026-05-11)

**Tier:** 1-ish (security/correctness boundary on the frontend)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/lib/api.ts`, `frontend/src/lib/socket.ts`, `frontend/src/lib/env.ts`, plus `frontend/src/lib/utils.ts`, `frontend/src/lib/currency.ts`, `frontend/src/lib/backgroundRemoval.ts` (skim).
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.1 (Frontend lib), §3.2 (Auth & token model). Seeded findings: **F3** (`refreshInFlight` no timeout), **env localhost fallback** (now non-silent — verify behaviour).

---

## 1. Health & summary

🟢 green (with one Medium hold-over)

This directory owns the **client-side auth contract**: how the SPA carries its access token, how it recovers when the token expires, and how it keeps a live socket connection aligned with token rotation. The shape is solid — access tokens are memory-only, the refresh flow is single-flight (so concurrent 401s don't trigger refresh-token reuse revocation on the backend), the socket reconnects on token rotation so `tokenVersion` revocation actually lands, and `env.ts` now fails loud in production instead of silently routing to `localhost`. The remaining sharp edge is F3 — `refreshInFlight` has no upper time bound, so a hung `/auth/refresh` blocks every queued request indefinitely. Health changed from 🟡 yellow (CODE_REVIEW.md §5.1) to 🟢 green because the env-fallback finding has been remediated (`env.ts:27-30`); F3 is the only remaining lib-level Medium.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/lib/api.ts` (87 LOC) — Axios instance, request interceptor injecting the in-memory access token, response interceptor doing single-flight refresh + retry on 401.
- `frontend/src/lib/socket.ts` (146 LOC) — Two socket.io clients (`/kds`, `/notifications`), refcounted shared instances, token-rotation re-subscribe via Zustand `subscribe`.
- `frontend/src/lib/env.ts` (61 LOC) — Centralised env resolution. `API_URL` / `ASSETS_ORIGIN` / `assetUrl()`. Loud `console.error` in `import.meta.env.PROD` when `VITE_API_URL` is missing.

**Skimmed only:**
- `frontend/src/lib/utils.ts` (217 LOC) — `cn`, date/format helpers, `getOrderUrgency`, `debounce`. No security/correctness surface; `calculateOrderTotal` (line 36) uses plain JS `number` math — fine for display, would be a §5 finding if it backed a money path (it does not — orders/payments money math is server-side).
- `frontend/src/lib/currency.ts` (29 LOC) — Symbol + `toFixed(2)` formatter. No precision claim made because nothing computes from its output.
- `frontend/src/lib/backgroundRemoval.ts` (273 LOC) — Transformers.js model loader for the product-image background-remove feature. Singleton with `isInitializing` guard; not auth/security related.
- `frontend/src/store/authStore.ts` — read for cross-reference (memory-only `accessToken` invariant lives there, `frontend/src/store/authStore.ts:48-50, 60-66, 70-74`).

**Skipped:**
- `frontend/src/lib/tauri.ts` — desktop-app integration; covered by the upcoming Tauri/desktop review (see `docs/plans/phase-1.3-tauri.md`). Not part of the web auth boundary.

---

## 3. Business-logic invariants

The frontend lib layer is the SPA's half of the auth contract. The matching backend half lives in `backend/src/modules/auth/` (`auth.controller.ts:99-115` for `POST /auth/refresh`, `auth.service.ts:453-534` for rotation + reuse detection).

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | `accessToken` is **never** written to `localStorage`/`sessionStorage`. Only `user` + `isAuthenticated` persist; the token is rehydrated by calling `/auth/refresh` against the httpOnly cookie on reload. | `frontend/src/store/authStore.ts:70-74` (Zustand `partialize` omits `accessToken`); also referenced by `lib/api.ts:20` reading via `getState().accessToken`. | ❌ none (no `lib/api` or `authStore` spec — see §3.8 of `CODE_REVIEW.md`) | XSS on admin origin → token exfil; defeats the whole reason the refresh cookie is httpOnly. |
| I-2 | `/auth/refresh` is **single-flight**: N parallel 401s share one in-flight refresh promise; never N concurrent POSTs. | `lib/api.ts:38, 40-58` (`refreshInFlight` slot + `.finally` clears only after settle) | ❌ none | Concurrent rotations race; backend's reuse-detection (`backend/src/modules/auth/auth.service.ts:481-488`) revokes the entire refresh-token family → user logged out. |
| I-3 | 401 retry happens **at most once per request**: `originalRequest._retry` flag prevents a retry-of-a-retry loop if the refreshed token is also rejected. | `lib/api.ts:68-69` | ❌ none | Infinite 401 loop, browser pegged. |
| I-4 | Refresh failure → store cleared + hard redirect to `/login`. No half-authenticated UI. | `lib/api.ts:75-79` (`logout()` then `window.location.href`) | ❌ none | Routes render with `isAuthenticated=true` but no token → UX flicker + cascading 401s with no recovery. |
| I-5 | Token rotation propagates to **every live socket**: when `useAuthStore.accessToken` changes, each socket replays the new JWT and reconnects so the gateway re-evaluates `tokenVersion`. | `lib/socket.ts:40-47` (KDS), `lib/socket.ts:97-104` (notifications) | ❌ none | Revoked token retains a live gateway connection until the next natural disconnect; `tokenVersion` revocation latency = socket lifetime. |
| I-6 | Socket refcount returns to 0 only when every hook that called `initializeSocket()` has called `disconnectSocket()`. The socket is not torn down while another hook is still using it. | `lib/socket.ts:14, 18, 59-66` (and 80, 119-126 for notifications) | ❌ none | Sibling components (POS + KDS + Voxel + Notifications) lose their socket mid-session when one of them unmounts. |
| I-7 | `forceDisconnectSocket()` zeroes the refcount and tears the socket down regardless of outstanding refs — the logout path. | `lib/socket.ts:69-75, 128-134` | ❌ none | A stale logged-out socket keeps receiving tenant-scoped events. |
| I-8 | `API_URL` resolves from `VITE_API_URL` if set; in `import.meta.env.PROD` a missing var logs a loud `console.error` (and Sentry will pick it up). The fallback to `localhost:3000/api` is **dev-only intent**, made visible — not silent — in prod. | `lib/env.ts:21-32` | ❌ none (and no env-loading test) | Production build silently 404s every request. This was the original symptom that justified centralising the helper (`env.ts:1-12` doc). |
| I-9 | `assetUrl()` is idempotent on absolute URLs (`http(s):`, `data:`, `blob:`) and prefixes relative paths with the resolved backend origin. | `lib/env.ts:55-60` | ❌ none | Asset URLs double-prefixed in some cases, broken images in others. |
| I-10 | The `refreshInFlight` slot is cleared in `.finally()` so it survives both success and failure paths — a rejected refresh does not leave a poisoned promise blocking the next attempt. | `lib/api.ts:53-57` | ❌ none | One transient 5xx on `/auth/refresh` permanently breaks refresh until the SPA is reloaded. |

> **Note on test coverage:** the entire frontend has **one** spec file (`ErrorBoundary.spec.tsx`, per `CODE_REVIEW.md §3.8`). Every invariant above is currently asserted by code review only.

---

## 4. State machine

Two coupled machines live in this directory.

### 4.1 Refresh lifecycle (`refreshInFlight`)

**States:** `IDLE` (no slot) · `REFRESHING` (promise pending) · `RESOLVED` (success → token in store, slot cleared) · `REJECTED` (failure → store cleared, redirect to `/login`, slot cleared).

There is no explicit enum — the state is encoded entirely as `refreshInFlight === null` vs the promise. Reading transitions off `lib/api.ts:38-58, 68-80`:

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `IDLE → REFRESHING` | First 401 received | `api.ts:41` (`if (refreshInFlight) return refreshInFlight`) | n/a — first-arrival creates | Sets `refreshInFlight` to the pending POST. |
| `REFRESHING → REFRESHING` (join) | Nth concurrent 401 | `api.ts:41` returns the existing promise | ✅ yes — by design; this is the single-flight invariant (I-2) | None — caller awaits same promise. |
| `REFRESHING → RESOLVED` | `POST /auth/refresh` 200 | `api.ts:48-52` | ✅ — store write is set-not-merge | `setAccessToken()` writes new JWT into `useAuthStore`, which fires the `subscribe()` in `lib/socket.ts:40-47` and rotates every socket (I-5). Slot cleared in `.finally` at `api.ts:53-57`. |
| `REFRESHING → REJECTED` | `POST /auth/refresh` non-2xx (or thrown) | `api.ts:75-79` (catch in the request interceptor, not in `refreshAccessToken`) | ✅ — `logout()` is set-to-null | Calls `useAuthStore.logout()` → `accessToken = null`, fires socket `subscribe` which calls `socket.auth.token = undefined` and reconnects; immediately followed by `window.location.href = '/login'` which terminates the SPA, so the reconnect attempt is mostly moot. Slot cleared in `.finally` at `api.ts:53-57`. |

**Forbidden transitions / gaps:**

- **No `REFRESHING → TIMED_OUT` transition.** If the backend hangs (gateway loss, partition), the promise never settles, `refreshInFlight` is never cleared, every queued and future 401 awaits forever. This is F3 — and the only Medium left in this directory.
- The `_retry` flag on `originalRequest` is per-request, not global; if a second 401 comes back after the *retry* with a still-bad token, the response interceptor returns the rejection straight to the caller (`api.ts:82`). Good — no infinite loop.

### 4.2 Socket lifecycle (per socket: `kds`, `notifications`)

There is no explicit FSM in code, but the union of socket.io's connection state and our refcount yields:

| State | When | Observable |
|-------|------|------------|
| `IDLE` | `socket === null`, `refCount === 0` | `getSocket() === null` |
| `CONNECTING` | First `initializeSocket()` call after IDLE; `io()` returns and dials | `socket.connected === false`, `refCount ≥ 1` |
| `CONNECTED` | Gateway accepted JWT, room joins complete | `socket.connected === true` |
| `RECONNECTING` | Token rotated (I-5) OR transport drop; `disconnect().connect()` chain (`socket.ts:43-44`) OR socket.io built-in retry on `connect_error` (`socket.ts:49-52`) | `socket.connected === false`, `socket !== null` |
| `DISCONNECTED` (soft) | All hooks unmounted (`refCount === 0`) but `socket !== null` happens transiently inside `disconnectSocket()` between `disconnect()` and `socket = null` (`socket.ts:62-65`). | unreachable from outside — same-tick reset to IDLE |
| `IDLE` (terminal) | `disconnectSocket()` or `forceDisconnectSocket()` ran; `socket = null`, `refCount = 0` | `getSocket() === null` |

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `IDLE → CONNECTING` | `initializeSocket()` first call | `socket.ts:17, 29-34` (creates `io()` if `socket === null`) | ✅ — refcount short-circuits at `socket.ts:20-27` if instance exists | Reads `accessToken` from store at the moment of dial; subscribes to store changes (`socket.ts:40-47`). |
| `CONNECTING → CONNECTED` | socket.io transport handshake completes | external (socket.io internals) | ✅ | None on our side; kds.gateway authoritative for room joins. |
| `CONNECTED → RECONNECTING` | `accessToken` changes in store | `socket.ts:41` (`state.accessToken !== prev.accessToken`) + `socket.ts:43` (`if (socket.connected)`) | ✅ — store change fires `subscribe` exactly once per value transition | `socket.auth.token` replaced; `.disconnect().connect()` chain; gateway re-validates JWT. |
| `CONNECTED/RECONNECTING → IDLE` | Last `disconnectSocket()` (refcount hits 0) | `socket.ts:60-66` (`Math.max(0, ...)` + `if (refCount > 0) return`) | ✅ — `Math.max(0, ...)` makes over-decrement safe | `socket.disconnect()`, then `socket = null`. |
| `* → IDLE` | `forceDisconnectSocket()` | `socket.ts:69-75` | ✅ | Refcount reset to 0; intended for logout. |
| `IDLE → CONNECTING` (re-init) | Subsequent `initializeSocket()` after teardown | `socket.ts:20-27` — if `socket` exists but disconnected, calls `socket.connect()`. **Caveat:** after `disconnectSocket()` sets `socket = null`, a re-mount goes through the full `io()` constructor at `socket.ts:31-34` and **registers another `useAuthStore.subscribe` listener** (see §7, F-2). | ✅ for the socket itself; ⚠ subscription leak. | New `io()` instance; new `subscribe()` callback registered. |

**Forbidden transitions / gaps:**

- `CONNECTING → CONNECTED → DISCONNECTED` without a `RECONNECTING` step is **not** treated specially. If the gateway drops the connection because the JWT failed verification (e.g., `tokenVersion` mismatched between when we dialled and when the handshake completed), socket.io retries indefinitely with the **same bad token** until our `subscribe()` listener notices a new `accessToken` write. Not catastrophic — the next 401 on an HTTP call will refresh — but the socket can be in a steady RECONNECTING loop in the gap. Logged once at `socket.ts:50-51` (intentional, comment explains why).
- No backoff/cap on socket.io's reconnect attempts is configured here. Relies entirely on socket.io defaults (exponential up to 5s). Mention only — not a finding.

---

## 6. Concurrency hazards

The lib layer is single-threaded JS, but it owns three concurrency-shaped contracts.

### Critical sections + strategy

- **`refreshAccessToken()` slot guard** — `lib/api.ts:40-58`. The `if (refreshInFlight) return refreshInFlight` check + `.finally` clear is the entire critical section. Because JS is single-threaded *within a tick*, two synchronous calls into `refreshAccessToken()` will see the same `refreshInFlight` value, so the slot fills exactly once per tick. The `.finally` clears the slot only after settlement (`api.ts:53-57`, comment explicit): late 401s arriving *during* the same in-flight refresh join the same promise.
- **`useAuthStore.subscribe`** — `lib/socket.ts:40-47, 97-104`. Zustand fires subscribers synchronously on `set()`, so the token-rotation handler runs in the same tick as `setAccessToken()`. No interleaving with the HTTP retry that triggered the refresh.

### Race windows still open

- *Sketch:* **Refresh hang → cascade block.** Backend `/auth/refresh` accepts the request but stalls (slow DB, network partition, infinite retry on a downstream). `refreshInFlight` promise never settles. Every subsequent 401 awaits it forever; user-visible UX is "everything is loading and never comes back". Tab refresh recovers.
  *Where:* `lib/api.ts:38-58` — F3 (Medium, Cor).
  *Severity:* Medium.
  *Fix:* `Promise.race([axios.post(...), timeout(10_000)])`; on timeout, reject the slot, run the same `logout()` + redirect path as a failed refresh.

- *Sketch:* **Reconnect storm on flaky network.** Network blips → socket.io retries; if simultaneously the access token rotates (a parallel HTTP 401 triggered refresh), the `subscribe()` callback fires `disconnect().connect()` mid-retry. Socket.io handles this internally, but every rotation forces a new handshake — on a sustained partition with frequent token rotation, the gateway sees a flood of authentication attempts from the same client. Not exploitable; load-shaping concern.
  *Where:* `lib/socket.ts:40-47`.
  *Severity:* Low (Perf).
  *Fix:* Debounce rotation reconnects (e.g., 500ms trailing).

- *Sketch:* **Multi-tab token sync.** Tab A logs out (`useAuthStore.logout()` clears the store). Tab B's in-memory `accessToken` is unaffected — Zustand's `persist` middleware only syncs the *persisted* slice (which excludes `accessToken`, see `store/authStore.ts:70-74` — invariant I-1). Tab B keeps making requests with its old token; when those 401, it calls `/auth/refresh` against the httpOnly cookie — but tab A's logout revoked the cookie family server-side (`backend/src/modules/auth/auth.service.ts:543-546`), so refresh fails → logout cascade → both tabs end up logged out. **This is the intended behaviour** but it relies on the 401 actually happening; if tab B was idle, it stays logged in until its next request. No `storage` event listener wires logout across tabs.
  *Where:* `lib/api.ts` (no listener); `store/authStore.ts` (persisted slice excludes token by design).
  *Severity:* Low (Cor) — accept as design; document.
  *Fix (optional):* `window.addEventListener('storage', e => { if (e.key === 'auth-storage' && !JSON.parse(e.newValue ?? '{}').state?.isAuthenticated) useAuthStore.getState().logout(); })`.

### Idempotency keys

- `/auth/refresh` is **not** client-idempotent in the strict sense (it rotates the cookie). The single-flight slot is what protects against duplicate rotations within one tab. Across tabs, the backend's refresh-reuse detection (`auth.service.ts:481-488`) is the failsafe.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Cor | `frontend/src/lib/api.ts:42-57` (was F3 in `CODE_REVIEW.md §5.1`) | `refreshInFlight` has **no timeout**. A hung `/auth/refresh` (slow DB, partition, infinite backend retry) blocks every queued request indefinitely; the SPA is stuck in "loading forever" until a hard refresh. The single-flight design means *all* concurrent 401s pile onto this one promise, amplifying the impact. | Wrap the inner `axios.post` in `Promise.race` with a 10s timeout. On timeout, reject the slot and let the response interceptor run its existing failure path (`api.ts:75-79`: `logout()` + redirect to `/login`). |
| F-2 | Low | Arch | `frontend/src/lib/socket.ts:40-47, 97-104` | Each `initializeSocket()` / `initializeNotificationSocket()` call after a full teardown (refcount → 0 → `socket = null`) registers a **new** `useAuthStore.subscribe` listener without unsubscribing the previous one. The previous listener captures a closed-over `socket` variable that is now `null`, so its body is a no-op (`if (... && socket)` short-circuits), but every reconnect cycle leaks one more listener. Over a long-lived session this is a small `Set` accumulation, not a correctness bug. | Capture the unsubscribe return value: `const unsub = useAuthStore.subscribe(...)`; call `unsub()` in `disconnectSocket()` / `forceDisconnectSocket()`. |
| F-3 | Low | Cor | `frontend/src/lib/socket.ts:31-34, 92-95` | `SOCKET_URL` falls back to `'http://localhost:3000'` if `VITE_SOCKET_URL` is missing — silently, the way `env.ts` used to. Different module from `env.ts`, so the loud-warning helper at `env.ts:27-30` does not cover it. In production with missing env, sockets dial localhost and fail. | Move socket URL resolution into `env.ts` (e.g., `SOCKET_URL = resolveSocketUrl()` with the same PROD-warning pattern), then import from there. |
| F-4 | Low | Cor | `frontend/src/lib/socket.ts:42, 99` | `(socket.auth as any).token` writes via `any` cast; socket.io's `auth` typing is intentional to catch this. Not a runtime issue — `auth` is `{ [k: string]: any }` at runtime — but the cast silences a typecheck that would otherwise force us to declare the auth shape. | Type the auth object: `socket = io(...) as Socket<DefaultEventsMap, DefaultEventsMap>` is the wrong knob; instead, narrow with `(socket.auth as { token?: string }).token = ...`. |
| F-5 | Low | Sec | `frontend/src/lib/socket.ts:49-52, 106-108` | `connect_error` handler logs `error.message` to `console.error`. The message can include backend stack-trace context in some socket.io configurations. Low-risk because the gateway's error messages are short ("Authentication failed", "Invalid token type"), but worth funneling through Sentry instead of bare `console.error` so it benefits from the redaction config (`sentry.config.ts:40-64`). | Replace `console.error` with `Sentry.captureMessage('socket connect_error', { level: 'warning', extra: { message: error.message } })`. |
| F-6 | Info | Arch | `frontend/src/lib/api.ts:77` | Hard redirect uses `window.location.href = import.meta.env.BASE_URL + 'login'`. Works, but kills any in-flight SPA state. React Router's `navigate('/login', { replace: true })` would be smoother — though it requires importing the router into `lib/api.ts`, which is currently dependency-clean. Accept as is; flag for the day someone introduces an interceptor-wide router context. | n/a (accept). |
| F-7 | Info | Cor | `frontend/src/lib/env.ts:32` | The dev/production fallback still returns the localhost URL even after logging the error. This is intentional ("Loud but non-fatal" comment at line 27) so the app continues to render rather than crashing on `undefined`. Confirm that Sentry catches the `console.error` (Sentry's `CaptureConsole` integration must be enabled, or wire `Sentry.captureMessage` directly). | If `CaptureConsole` is not enabled, add `Sentry.captureMessage('[env] VITE_API_URL missing in prod', 'error')` next to the `console.error`. |

> Severity scale: Critical → High → Medium → Low → Info.
> Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **Memory-only access token, persisted user shell** — `frontend/src/store/authStore.ts:48-50, 70-74` (cross-referenced from `lib/api.ts:20`). Pattern: persist non-credential UI state for instant boot, keep the credential ephemeral. Defeats `localStorage` exfil via XSS. **Server-side contract:** the matching half is `backend/src/modules/auth/auth.controller.ts:99-115` (refresh reads only `req.cookies?.[REFRESH_COOKIE]` — no JSON body fallback, see `CODE_REVIEW.md §2 spot-check) + `backend/src/modules/auth/auth.service.ts:579-598` (refresh-token hashed at rest in `RefreshToken` table, rotated on every use, reuse triggers family revocation at `auth.service.ts:481-488`). **Adopt elsewhere:** any future client (mobile, embedded admin) should mirror this split.

- **Single-flight refresh** — `frontend/src/lib/api.ts:38-58`. The promise-slot + `.finally`-clear pattern is the canonical way to express "exactly one in-flight, all comers join the same promise". The inline comment at `api.ts:31-37` explicitly names the failure mode it prevents: tripping the backend's refresh-reuse revocation at `auth.service.ts:481-488`. **Cross-link:** without this pattern, the backend's *correct* reuse-detection logic would log users out every time a dashboard page mounted (it loads 6-10 endpoints in parallel; on a stale token, all 6-10 would 401 and all 6-10 would fire `/auth/refresh`, and only the first rotation would land — the rest would be reuses of the now-revoked token). **Adopt elsewhere:** any other "rotating credential" client flow (e.g., desktop Tauri auth, if it lands) should reuse this exact shape.

- **Token rotation propagated to sockets** — `frontend/src/lib/socket.ts:40-47, 97-104`. The store-subscribe pattern means an HTTP-driven refresh automatically rotates every live socket in the same tick, so `tokenVersion`-based revocation actually lands. **Server-side contract:** `backend/src/modules/auth/auth.service.ts:517-524` (refresh respects `tokenVersion`; mismatch revokes the family) and `backend/src/modules/auth/auth.service.ts:557-577` (every new access token carries the current `ver`). The KDS gateway re-validates on every handshake (`CODE_REVIEW.md §3.5`).

- **Refcounted shared sockets** — `frontend/src/lib/socket.ts:14, 18-27, 59-66, 80, 119-126`. Multiple feature modules (POS, KDS, Voxel, Notifications) can all `initializeSocket()` independently without yanking the connection out from under each other; last unmount wins. The `Math.max(0, ...)` floor at `socket.ts:60, 120` makes over-decrement (double `disconnectSocket()` on the same hook) safe. Comment at `socket.ts:9-13` explains the motivation.

- **`forceDisconnect*` escape hatch** — `frontend/src/lib/socket.ts:69-75, 128-134`. The logout path needs to tear down the socket regardless of outstanding refs (a stale connection would keep receiving tenant-scoped events). Two-pronged API (refcounted normal disconnect + forced disconnect) is the right shape.

- **Centralised env with loud warning** — `frontend/src/lib/env.ts:1-12, 20-33`. The doc-comment names the original symptom ("silently point at localhost in production and 404 every request"). Replaces 30+ scattered `import.meta.env.VITE_API_URL || 'http://localhost:3000/api'` defaults — a missing env now produces one console error at module load instead of dozens of confused bug reports. **Adopt elsewhere:** the same pattern should cover `VITE_SOCKET_URL` (see F-3) and any future `VITE_*_URL`.

- **`assetUrl()` passthrough** — `frontend/src/lib/env.ts:55-60`. Absolute URLs (`http(s):`, `data:`, `blob:`) pass through; relative paths get the resolved backend origin. Idempotent — handles both `'/uploads/x.jpg'` and `'uploads/x.jpg'`. Trim regex `\/+$` at line 41/44 prevents accidental double slashes.

---

## 9. Spot-checks performed

**Verified end-to-end:**

- **F-1 (refresh-hang)** confirmed at `lib/api.ts:42-58` — the `axios.post(...)` call has no timeout option, the default axios timeout is 0 (no limit), and there is no `Promise.race` wrapping. A hung backend will block the promise indefinitely. Slot is cleared via `.finally` at `api.ts:53-57`, which would fire on timeout if a timeout existed — so the fix is mechanical.
- **`env.ts` no-longer-silent** confirmed at `lib/env.ts:24-31` — the `if (import.meta.env.PROD)` branch fires a `console.error` before returning the localhost fallback. The seed in `CODE_REVIEW.md §5.1` ("localhost fallback") referred to the *old* behaviour; the new behaviour is already non-silent. Health upgraded from 🟡 to 🟢 for that reason.
- **Single-flight slot clears on failure** confirmed at `lib/api.ts:53-57` — `.finally` runs on both `.then` resolution and on rejection (`.finally` is rejection-preserving in Promises/A+). A failed refresh therefore clears the slot, and the next 401 starts a fresh refresh attempt. (Would be I-10 violation if missing.)
- **Memory-only access token** confirmed at `frontend/src/store/authStore.ts:70-74` — `partialize` returns `{ user, isAuthenticated }`, omitting `accessToken`. Cross-checked the `CODE_REVIEW.md §11.2` grep: `localStorage.*Item` writes are limited to `i18n_language`.
- **Socket rotation actually disconnects** confirmed at `lib/socket.ts:43-44` — `if (socket.connected) socket.disconnect().connect()`. The `if` guard means a rotation during a transient disconnect (RECONNECTING) just updates `auth.token` and lets socket.io's own reconnect logic carry the new token on its next attempt — correct.

**Dropped (initial concern was wrong):**

- "`refreshAccessToken` doesn't handle non-401 errors from the refresh endpoint" — *Drop.* The function only handles the happy path because the response interceptor at `api.ts:71-79` catches *any* rejection from the awaited `refreshAccessToken()` call and runs the logout/redirect path. The function-level `.then` is enough.
- "`disconnectSocket()` race: another tab unmounting could reset refcount mid-handshake" — *Drop.* Tabs do not share JS heap; the refcount is per-tab. Cross-tab disconnection is a separate concern handled (mostly) by the cookie-revocation chain in §6's multi-tab sketch.
- "Socket `subscribe` could fire before `io()` returns, with `socket === null`" — *Drop.* `subscribe()` is registered at `socket.ts:40` immediately after the `io(...)` assignment at `socket.ts:31`; the assignment is synchronous, so `socket` is non-null by the time the subscribe registers. The `if (... && socket)` at `socket.ts:41` is belt-and-braces but mostly unreachable for the *current* `socket` instance — it does matter for *previous* (leaked) subscribers after a teardown, which is F-2.

**Downgraded:**

- **F3 (CODE_REVIEW.md §5.1)** was Medium; stays Medium here as **F-1**. No change — flagged because the user impact (everything stuck loading) is meaningful even though no security/data-loss surface is exposed.

---

## 10. Recommended tests

Vitest + jsdom + `msw` (mock-service-worker) recommended; the frontend currently has only `ErrorBoundary.spec.tsx`, so a small `frontend/src/lib/__tests__/` directory is the right home.

```ts
// frontend/src/lib/__tests__/api.spec.ts
import { setupServer } from 'msw/node';
import { rest } from 'msw';
import { useAuthStore } from '../../store/authStore';
import { api } from '../api';

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); useAuthStore.getState().logout(); });
afterAll(() => server.close());

describe('lib/api single-flight refresh (I-2)', () => {
  it('I-2: 5 parallel 401s trigger exactly ONE /auth/refresh', async () => {
    // arrange: stub /api/* with 401 first, then 200 after refresh
    let refreshHits = 0;
    server.use(
      rest.post('*/auth/refresh', (_req, res, ctx) => {
        refreshHits += 1;
        return res(ctx.json({ accessToken: 'new-token' }));
      }),
      rest.get('*/protected', (_req, res, ctx) => {
        const auth = _req.headers.get('authorization');
        return auth === 'Bearer new-token'
          ? res(ctx.json({ ok: true }))
          : res(ctx.status(401));
      }),
    );
    useAuthStore.getState().login({} as any, 'stale-token');

    // act: fire 5 concurrent requests
    await Promise.all([1,2,3,4,5].map(() => api.get('/protected')));

    // assert: exactly one refresh hit despite 5 parallel 401s
    expect(refreshHits).toBe(1);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('F-1: refresh that hangs >10s rejects and routes to /login (after fix)', async () => {
    // arrange: /auth/refresh never responds
    server.use(rest.post('*/auth/refresh', () => new Promise(() => {})));
    useAuthStore.getState().login({} as any, 'stale-token');

    // act + assert: api.get('/protected') should reject within ~10s
    await expect(api.get('/protected')).rejects.toThrow(/timeout/i);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('I-3: 401-retry only happens once per request', async () => {
    // arrange: /auth/refresh succeeds but new token is also rejected
    server.use(
      rest.post('*/auth/refresh', (_req, res, ctx) => res(ctx.json({ accessToken: 'still-bad' }))),
      rest.get('*/protected', (_req, res, ctx) => res(ctx.status(401))),
    );
    useAuthStore.getState().login({} as any, 'stale-token');

    // act + assert: api.get should reject (no infinite loop)
    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('I-1: accessToken is never written to localStorage', async () => {
    useAuthStore.getState().login({ id: 'u1' } as any, 'sensitive-token');
    const persisted = JSON.parse(localStorage.getItem('auth-storage') ?? '{}');
    expect(persisted.state?.accessToken).toBeUndefined();
    expect(persisted.state?.user?.id).toBe('u1'); // user IS persisted
  });
});

// frontend/src/lib/__tests__/socket.spec.ts
describe('lib/socket token rotation (I-5) + refcount (I-6)', () => {
  it('I-5: changing accessToken disconnects+reconnects socket with new token', async () => {
    const sock = initializeSocket();
    // simulate connected
    (sock as any).connected = true;
    const disconnectSpy = vi.spyOn(sock, 'disconnect').mockReturnValue(sock);
    const connectSpy = vi.spyOn(sock, 'connect').mockReturnValue(sock);

    useAuthStore.getState().setAccessToken('rotated');

    expect((sock.auth as any).token).toBe('rotated');
    expect(disconnectSpy).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
  });

  it('I-6: refcount keeps socket alive while siblings still mounted', () => {
    const a = initializeSocket();
    const b = initializeSocket();
    expect(a).toBe(b); // shared instance
    disconnectSocket();
    expect(getSocket()).not.toBeNull(); // b still holds it
    disconnectSocket();
    expect(getSocket()).toBeNull(); // both gone
  });

  it('I-7: forceDisconnectSocket tears down regardless of outstanding refs', () => {
    initializeSocket(); initializeSocket(); initializeSocket();
    forceDisconnectSocket();
    expect(getSocket()).toBeNull();
  });
});

// frontend/src/lib/__tests__/env.spec.ts
describe('lib/env fail-loud fallback (I-8)', () => {
  it('I-8: VITE_API_URL missing in prod logs console.error AND returns fallback', () => {
    vi.stubEnv('VITE_API_URL', ''); vi.stubEnv('PROD', true);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // re-import to re-run resolveApiUrl
    vi.resetModules();
    const { API_URL } = require('../env');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('VITE_API_URL'));
    expect(API_URL).toBe('http://localhost:3000/api'); // still returns fallback
  });

  it('I-8: VITE_API_URL missing in dev returns fallback silently', () => {
    vi.stubEnv('VITE_API_URL', ''); vi.stubEnv('PROD', false);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    require('../env');
    expect(spy).not.toHaveBeenCalled();
  });

  it('I-9: assetUrl passes through absolute URLs unchanged', () => {
    expect(assetUrl('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg');
    expect(assetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(assetUrl('/uploads/x.jpg')).toMatch(/\/uploads\/x\.jpg$/);
  });
});
```

These five test files (one for `api`, one for `socket`, one for `env`) would cover invariants I-1 through I-9 — every contract this directory is responsible for keeping — and would directly assert the fix for F-1 once it lands. The matching server-side contract (`backend/src/modules/auth/auth.service.ts:453-534`) is covered separately in `auth.md §10`; the cross-tenant test in `CODE_REVIEW.md §3.1` is the integration-level guard that catches a regression where the client wiring is correct but the server stops honouring `tokenVersion`.
