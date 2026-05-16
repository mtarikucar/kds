# `frontend/features/kds` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `frontend/src/features/kds/useKitchenSocket.ts` (115 LOC) — the kitchen display hook: subscribes the shared `/kds` Socket.IO connection, wires `order:new` / `order:updated` / `order:status-changed` into TanStack Query invalidations, plays a Web Audio "ding" + toast.
- Cross-ref: `frontend/src/lib/socket.ts` (145 LOC) — only `initializeSocket`, `disconnectSocket`, `forceDisconnectSocket`, and the `useAuthStore.subscribe` token-rotation block are in scope for this review (the broader refcount design is reviewed in `frontend-lib.md` when that exists).
- Cross-ref: `frontend/src/store/authStore.ts:60-66` — `logout()` clearing semantics (token nulled, `isAuthenticated → false`) — relevant to invariant I-4.
- Cross-ref: `frontend/src/pages/kitchen/KitchenDisplayPage.tsx:23` — the sole consumer of `useKitchenSocket`.
- Cross-ref: `frontend/src/features/auth/authApi.ts:66-85` — `useLogout` clears the TanStack Query cache (`queryClient.clear()`) but does **not** call `forceDisconnectSocket()` — relevant to F-2.
- Cross-ref: `backend/src/modules/kds/kds.gateway.ts:64-73, 95-138, 199-206` — the server-side counterpart audited in [`kds.md`](./kds.md).

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §3.5 (gateway comparison), §4.14 (KDS gateway), §5.1 (`lib/` health), §11.2 (no frontend socket tests).

---

## 1. Health & summary

🟢 **green, with one yellow seam** — the KDS frontend surface is small (115 LOC of hook code + a handful of cross-cuts in `lib/socket.ts`) and structurally correct on every invariant the backend gateway depends on: it does not invent a "join-room" message, it does not trust inbound payloads beyond reading `orderId` / `orderNumber` for log+toast lines, room scoping is delegated to the server (the JWT carries `tenantId`), and the only token the socket sees is the in-memory access token from `useAuthStore` — never `localStorage`. The single seam worth filing (F-2) is that `useLogout` clears the React Query cache and zeroes the auth store, **but does not call `forceDisconnectSocket()`** — so the still-mounted KDS socket relies on the store-subscribe block at `socket.ts:40-47` to detect the token going to `null` and reconnect. That reconnect carries `auth.token === undefined`, the gateway rejects it at `kds.gateway.ts:75-76`, and the socket then enters socket.io's default infinite-retry loop until the page navigates. Functionally not a security bug (rejected handshakes don't reach a room), but it's a slow-leak reconnect storm on logout. Everything else — token replay on rotation, refcount sharing with POS, audio-context reuse — is well-shaped.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/features/kds/useKitchenSocket.ts` (115 LOC) — `getAudioContext` singleton (`:11-22`), `useKitchenSocket` hook body (`:24-115`), the single `useEffect` lifecycle (`:47-112`).
- `frontend/src/lib/socket.ts` (145 LOC) **referenced only** for the call sites `useKitchenSocket` touches: `initializeSocket` (`:17-55`), `disconnectSocket` (`:59-66`), `forceDisconnectSocket` (`:69-75`), and the `useAuthStore.subscribe(...)` token-rotation block (`:40-47`). The notification-socket variants (`:77-134`) are out of scope.

**Skimmed only:**
- `frontend/src/pages/kitchen/KitchenDisplayPage.tsx:23` — sole consumer (`const { isConnected } = useKitchenSocket()`). Route is guarded by `<ProtectedRoute allowedRoles={[ADMIN, MANAGER, KITCHEN]}>` at `App.tsx:175-177`, so the hook cannot mount without a JWT in memory.
- `frontend/src/lib/api.ts:38-59` — to confirm the refresh interceptor writes `useAuthStore.setAccessToken` (`:50`), which is exactly the change the socket's store-subscribe at `socket.ts:40-47` watches.
- `backend/src/modules/kds/kds.gateway.ts` — every server-side claim about room scoping, type discrimination, and rejection behaviour is cross-referenced to [`kds.md`](./kds.md) rather than re-asserted here.

**Skipped:**
- `frontend/src/features/pos/usePosSocket.ts` (415 LOC) — uses the same `initializeSocket()` and the same three `order:*` events, but it owns its own optimistic-state and toast pipeline. Out of scope for this feature review; reviewed under `frontend-features-pos.md` when that exists.
- `OrderQueue.tsx`, `KitchenStatsHeader.tsx`, `OrderCard.tsx` under `frontend/src/components/kitchen/` — pure presentation components, no socket or auth concerns.
- The Web Audio fallback path (`oscillator` ramp at `:31-41`) — verified to use a single shared `AudioContext` (`:11-22`) per Chromium's per-tab cap; no further audit value.

---

## 3. Business-logic invariants

The contract this hook + the slice of `lib/socket.ts` it touches is responsible for keeping. Each row is testable.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **Socket is subscribed to a tenant-scoped room only.** The frontend never sends a `join-*` message; room membership is decided by the backend from the JWT's `tenantId` + `role` claims. The hook is structurally incapable of asking for a different tenant's room. | `useKitchenSocket.ts:101-102` (explanatory comment; no `socket.emit('join-...')` anywhere in the hook); cross-link `kds.gateway.ts:130-138` (server decides rooms); cross-link `kds.gateway.ts:203-206` (no `@SubscribeMessage('join-*')` handlers exist server-side). | ❌ none (no frontend socket tests — `CODE_REVIEW.md §11.2`) | cross-tenant event delivery if the server ever started honouring client-supplied room names |
| I-2 | **Reconnect debounce is delegated to socket.io's default reconnection backoff.** The client does not aggressively reconnect on every `disconnect` event; it relies on the library's built-in exponential backoff (1s → 5s with jitter). The hook itself adds no reconnect loop. | `useKitchenSocket.ts:55-58` (`handleDisconnect` only flips local state; no `socket.connect()` call); `socket.ts:31-34` (no `reconnectionDelay` override → library defaults apply: `reconnection: true`, `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, `reconnectionAttempts: Infinity`). | ❌ none | reconnect storm against the gateway during a network blip; amplifies the F-1 token-spam concern from `kds.md` |
| I-3 | **No inbound payload is trusted without sanitization for the cases it could matter.** Three events are handled: two write to React Query (`invalidateQueries`) and pass `event.orderId` to a second invalidation; one shows a toast with `event.orderNumber`. `invalidateQueries` is structurally inert (it accepts any value as a cache key), and the toast renders `orderNumber` through i18n's `{{ orderNumber }}` interpolation which **HTML-escapes by default** — react-i18next does not parse interpolation as HTML unless `t()` is followed by `<Trans>` or `dangerouslySetInnerHTML`, and neither is used. | `useKitchenSocket.ts:60-72, 74-87, 89-93`; relies on react-i18next default escape — see Sonner toast at `:68` consuming `t('kitchen:kitchen.newOrderNotification', { orderNumber: event.orderNumber })`. | ❌ none | XSS via crafted `orderNumber` if i18n escape is ever disabled or `<Trans>` is added with raw passthrough |
| I-4 | **View state is cleared on tenant change.** "Tenant change" on this frontend means **logout → login as a different tenant's user**; there is no in-session tenant switcher (the frontend has no superadmin tenant impersonation UI). `useLogout` clears `queryClient` (`authApi.ts:76, 82`) which evicts every cached order list, and the store-subscribe block at `socket.ts:40-47` reacts to `accessToken` going `null` and disconnects+reconnects the socket. The KDS hook's own `useEffect` is gated on `queryClient` identity, so a fresh `QueryClient` on re-login would also re-run the effect (in practice the same instance is reused, and react-query cache eviction is what carries the invariant). | `authApi.ts:74-83` (logout → `queryClient.clear()`); `socket.ts:40-47` (token change → reconnect); `useKitchenSocket.ts:47, 112` (effect cleanup on unmount/dep-change). | ❌ none | a re-logged-in user briefly sees the previous tenant's cached orders before the first refetch resolves |

Invariants I-1, I-2, I-3 hold structurally in the code as written. I-4 holds **only because** `useLogout` clears `queryClient` — if a future "switch tenant" flow is added that swaps the JWT without going through `useLogout`, I-4 breaks silently. Flag in §7 as F-3.

---

## 4. State machine

The client-side connection lifecycle. Matches the backend state machine documented in [`kds.md` §4](./kds.md) on the wire — what's new here is the React lifecycle layer that wraps it.

**Hook-state enum** (informal — lives in the `isConnected` `useState` plus the module-level `socket` singleton in `lib/socket.ts`):

| State | Set by | `isConnected` |
|---|---|---|
| `UNMOUNTED` | hook not yet rendered | n/a |
| `MOUNTED_CONNECTING` | `useEffect` runs; `initializeSocket()` returns a `Socket` whose underlying transport is still negotiating | `false` (initial state from `:25`) |
| `CONNECTED` | server-side `handleConnection` succeeded → client receives `'connect'` | `true` (`:52`) |
| `DISCONNECTED_TRANSIENT` | network hiccup; socket.io is retrying with backoff | `false` (`:57`) |
| `DISCONNECTED_AUTH_FAILED` | server rejected the handshake (bad token, wrong type, missing claims) | `false` — socket.io still retries indefinitely (no `reconnection: false`) |
| `UNMOUNTING` | component unmount → effect cleanup runs | n/a |

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `UNMOUNTED → MOUNTED_CONNECTING` | `KitchenDisplayPage` mounts under `<ProtectedRoute allowedRoles={[ADMIN, MANAGER, KITCHEN]}>` | `useKitchenSocket.ts:47-48` (`initializeSocket()`); `socket.ts:18` (`socketRefCount += 1`) | yes — refcount-protected; second mount during dev StrictMode double-render reuses the existing socket (`socket.ts:20-22`) | `socketRefCount += 1`; if `socket && socket.connected` → reuse; if `socket && !socket.connected` → `socket.connect()` (reuse instance); else `io(`${SOCKET_URL}/kds`, { auth: { token } })` and install `useAuthStore.subscribe` rotation listener |
| `MOUNTED_CONNECTING → CONNECTED` | server emits `'connect'` after `kds.gateway.ts:64-73` succeeds | `useKitchenSocket.ts:50-53, 95` | yes per-socket | `setIsConnected(true)` → re-renders `KitchenDisplayPage` showing the green dot in `KitchenStatsHeader` |
| `CONNECTED → DISCONNECTED_TRANSIENT` | transport drop (wifi flap, server restart) | `useKitchenSocket.ts:55-58, 96` (`handleDisconnect`) | yes | `setIsConnected(false)`; socket.io schedules a reconnect attempt (default backoff 1–5 s with jitter) |
| `DISCONNECTED_TRANSIENT → CONNECTED` | socket.io's internal reconnect succeeded; client re-emits `'connect'` | same `handleConnect` at `:50-53` | yes | the gateway runs `handleConnection` afresh — it's a brand-new socket id; tenant scoping is re-derived from the (possibly rotated) JWT |
| `* → MOUNTED_CONNECTING` | token rotation (`useAuthStore.setAccessToken` from refresh interceptor) | `socket.ts:40-47` (`useAuthStore.subscribe`) | **once per token change** — see F-1 caveat | `socket.auth.token = newToken`; `socket.disconnect().connect()` — chained because `.disconnect()` is synchronous in socket.io v4 and returns the socket |
| `CONNECTED → UNMOUNTING` | `KitchenDisplayPage` unmounts (route change) | `useKitchenSocket.ts:104-111` (cleanup function); `socket.ts:60-65` (`disconnectSocket()` decrements refcount) | yes — refcount-aware; if POS is still mounted the underlying socket survives | `socket.off(...)` 5 listeners; `socketRefCount -= 1`; if `0` → `socket.disconnect(); socket = null` |
| `* → DISCONNECTED_AUTH_FAILED` | logout sets `accessToken → null`; rotation listener fires with `state.accessToken === null`; `.auth.token` is set to `undefined`; reconnect attempts now fail the server's `tryStaffAuth` (no token) and `tryCustomerAuth` (no sessionId) | `socket.ts:40-47` and downstream `kds.gateway.ts:75-76` | **NO — see F-2** | socket.io keeps retrying with the empty token; each attempt costs one rejected handshake on the server (`tryStaffAuth` returns false at the no-token branch quickly, but the cycle never exits) |

**Forbidden transitions** (must be guarded; one is currently unguarded):
- `DISCONNECTED_AUTH_FAILED → CONNECTED` while the user is logged out — should be impossible. The store-subscribe rotation block at `socket.ts:40-47` does not unsubscribe; it survives across logout/login cycles. If a user logs back in **without unmounting the KDS page** (impossible in current routing because `ProtectedRoute` bounces to `/login`, but a future SPA design could route through it), the same subscribe block would fire on the new token and reconnect — correct behaviour. The unguarded case is the symmetric one: **the socket never stops retrying with an empty token after logout** if the page remains mounted (e.g., open in a background tab during logout in another tab). Flag in §7 as F-2.
- `MOUNTED_CONNECTING → CONNECTED` while `accessToken === null` — must not happen. Guarded by the route guard at `App.tsx:175-176`; the hook will not mount without `isAuthenticated`. Note: I-4 in `kds.md` (DB-checked customer session) is not relevant here — this hook only ever carries staff JWTs.

**Transitions that should be idempotent and are:**
- `UNMOUNTED → MOUNTED_CONNECTING` — refcount-safe under StrictMode double-mount (`socket.ts:18-27`). Verified: `socket.connected` short-circuits, and disconnected-instance reuse calls `socket.connect()` rather than constructing a new socket.
- `CONNECTED → UNMOUNTING` — cleanup runs exactly once per `useEffect` run because the `useEffect` deps array `[queryClient]` (`:112`) is stable for the QueryClientProvider lifetime.

**Transitions that should be idempotent but aren't** — see F-1 (the `useAuthStore.subscribe` is installed on every `initializeSocket` call that constructs a new socket, but only one socket is constructed per process; in practice this is a single subscribe — still worth tightening).

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- The module-level `socket` singleton in `socket.ts:6` is the only shared state. JavaScript's single-threaded runtime means the refcount increments/decrements at `:18, :60, :70` are interleaving-safe within a tab. Across tabs the singleton is per-tab (separate JS heap), which is the correct boundary.
- `useAuthStore.subscribe(...)` at `socket.ts:40-47` is the cross-cutting "lock" between the refresh interceptor (`lib/api.ts:50`) and the socket. The subscribe callback runs synchronously when `setAccessToken` writes, so there is no window where the socket holds an old token after the store has the new one — modulo the socket.io reconnect-handshake roundtrip.

**Race windows still open** (each with a reproduction sketch):

*Reconnect storm against a token-rotation event*
- *Sketch:* the user's access token expires mid-session. A burst of dashboard hooks all 401 simultaneously; `lib/api.ts:38-59` single-flights the refresh and updates `useAuthStore.accessToken`. The socket-subscribe at `socket.ts:41-46` fires once with the new token, calls `socket.disconnect().connect()`. Meanwhile, **the underlying socket.io engine may already have a reconnect attempt in flight** (transport drop happened ~50 ms before the rotation) carrying the old token in `socket.auth`. That in-flight attempt may complete the handshake against the old token *if the server's `tokenVersion` hasn't been bumped*; the explicit `.disconnect().connect()` then fires a second handshake with the new token. Both succeed; one is torn down ms later.
- *Where:* `socket.ts:40-47` mutates `socket.auth.token` synchronously, but `.disconnect()` is fire-and-forget on the engine's open connection; if the engine is in the middle of `engine.handshake` it may complete with the previously-set `auth`.
- *Severity:* Low Cor. The torn-down handshake doesn't leak data (one socket id was authed under the old token, immediately killed). The risk is a transient race where order-events are delivered to a socket that's about to be replaced — `useKitchenSocket`'s React-Query invalidation is idempotent (`invalidateQueries(['orders'])` is a no-op if no observers exist), so the user-visible effect is zero. Recorded as F-1 in §7.
- *Fix:* check `socket.disconnecting` / use `socket.io.engine.id` to confirm we're acting on the right transport instance, or — simpler — debounce the subscribe handler with a single-flight gate analogous to `refreshInFlight` in `lib/api.ts`.

*Room-join race on token rotation*
- *Sketch:* this is the same race seen from a different angle. The server-side `kds.gateway.ts:130-138` joins rooms inside the synchronous `handleConnection` body, so by the time the client receives `'connect'` the rooms are joined. After token rotation, the explicit `.disconnect().connect()` re-runs `handleConnection` on the server, which re-derives rooms from the *new* JWT's claims. If the new JWT carries a different `role` (e.g., a server-side role change applied between the old and new token) the rooms differ.
- *Where:* `socket.ts:40-47` triggers reconnect; server-side join at `kds.gateway.ts:130-138`.
- *Severity:* none — this is the design. Role change is reflected on next reconnect, which is also when the server re-checks `tokenVersion`. Recorded only for the test plan (§10).

*Optimistic-vs-server status mismatch*
- *Sketch:* a kitchen user clicks "Mark as preparing" on order #123. The mutation `useUpdateOrderStatus` (POSTs `PATCH /orders/123/status`) fires; meanwhile the server emits `order:status-changed { orderId: '123', status: 'PREPARING' }` to the room. The client's mutation might still be in flight when the socket event arrives, or the socket event might arrive after the mutation's `onSuccess` has already optimistically applied the status.
- *Where:* `useKitchenSocket.ts:89-93` (`handleOrderStatusChanged` calls `invalidateQueries(['orders'])` and `invalidateQueries(['orders', event.orderId])`).
- *Behaviour today:* `invalidateQueries` does not directly mutate the cache — it marks the query stale, and any active observer triggers a refetch. The latest server-fetched value wins. If the user clicks again before the refetch lands (e.g., double-tap "preparing"→"ready"), the second mutation may be sent against a stale optimistic value. The hook does not implement optimistic updates itself; the mutation lives in `features/orders/ordersApi.ts` and would need to be inspected separately to determine if it sets the status optimistically.
- *Severity:* Low Cor — `invalidate` is the safe choice (no direct cache write from the socket payload). The risk only materializes if the orders API hook is adding optimistic updates that the socket event then races against. Recorded as F-4 for the test plan (§10).

**Idempotency keys:** not applicable. The hook does not perform writes against the server; it only reads (via React Query) and re-invalidates.

---

## 7. Findings

Same format as `docs/CODE_REVIEW.md`. Verified findings unmarked; unverified flagged `*(unverified)*` with the line they came from.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Low | Cor | `frontend/src/lib/socket.ts:40-47` | **Token-rotation reconnect is not single-flight.** The store-subscribe callback synchronously mutates `socket.auth.token` and calls `socket.disconnect().connect()`. If the engine has a reconnect attempt in flight from a transport drop seconds earlier, that attempt completes with the *previous* `auth.token` value (it was captured at engine handshake init); the explicit reconnect then runs with the new token. Two handshakes against the gateway for one rotation event. No data leak (the old-token socket is torn down ms later) but it doubles handshake load and complicates server-side log triage. | Mirror the `refreshInFlight` single-flight pattern from `lib/api.ts:38-59`: gate the subscribe callback so only one disconnect+connect cycle is allowed per N ms, and check `socket.disconnecting` before issuing `.disconnect()`. Cross-link: see §8 in `kds.md` (cleaner gateway-side log line "reconnect-after-rotation" would help triage). |
| F-2 | Medium | Cor | `frontend/src/features/auth/authApi.ts:74-83` × `frontend/src/lib/socket.ts:40-47` | **Logout does not force-disconnect the KDS socket.** `useLogout` calls `logout()` (zeros `accessToken`) + `queryClient.clear()`, but does not call `forceDisconnectSocket()`. The store-subscribe block at `socket.ts:41-46` reacts to `accessToken` changing to `null` and issues `socket.disconnect().connect()` — the reconnect now carries `auth.token === undefined`. The gateway rejects this at `kds.gateway.ts:75-76` (`no valid authentication`). Socket.io's default `reconnectionAttempts: Infinity` means the client retries forever (1–5 s backoff). For a logged-out tab kept open (common: multiple tabs, log out from one) this is one rejected handshake every few seconds until the page is closed or navigated. Defense-in-depth: `forceDisconnectSocket` exists (`socket.ts:69-75`) specifically for this purpose but is not wired in. | Wire `forceDisconnectSocket()` (and `forceDisconnectNotificationSocket()`) into `useLogout.onSuccess` and `onError` at `authApi.ts:74-83`, before the `queryClient.clear()` line. Verify the `useAuthStore.subscribe` block at `socket.ts:40-47` short-circuits when `socket === null` — it does (`if (... && socket)` guard at `:41`). |
| F-3 | Low | Arch | `frontend/src/features/kds/useKitchenSocket.ts:47-112` *(unverified — depends on whether a tenant-switch UI is ever added)* | **View state is cleared on tenant change only via `useLogout`.** The hook's `useEffect` deps are `[queryClient]` (`:112`); if a future feature mutates `accessToken` *without* calling `logout()` (e.g., a superadmin tenant-impersonation flow), the cached `orders` queries from the previous tenant would remain visible until the next refetch. The store-subscribe in `socket.ts:40-47` would reconnect the socket to the new tenant's rooms, but the React Query cache would not be evicted. | If a tenant switch is added, route it through a helper that calls both `setAccessToken(newToken)` *and* `queryClient.clear()`. Document this invariant in `lib/api.ts` or wherever the switch is introduced. |
| F-4 | Low | Cor | `frontend/src/features/kds/useKitchenSocket.ts:60-72, 89-93` | **Socket payloads are trusted at the `event.orderNumber` / `event.orderId` field level without runtime validation.** TypeScript types (`OrderStatusChangedEvent` at `types/index.ts:552-556`) cover compile-time only; the `'order:new'` and `'order:updated'` handlers take `event: any` (`:60, :74`). i18n interpolation escapes by default (mitigates the obvious XSS path), and `invalidateQueries` is structurally inert against malicious keys, so this is not immediately exploitable — but a future maintainer adding `<Trans i18nKey="..." values={{ orderNumber }} />` with HTML passthrough would open the door. | Tighten types to `NewOrderEvent` / `OrderUpdatedEvent` (define the latter), and consider validating with `zod` at the socket boundary if the events grow richer payloads. Today's risk: low. |

No critical or high findings. The hook is short and well-shaped; the seams are at the lifecycle edges (logout, token rotation) rather than in the data path.

**Findings explicitly *not* logged here** (kept out of the table on purpose):
- "Console.log left in production code" (`:51, :56, :61, :75, :90`) — five debug lines. Stylistic; the existing `CODE_REVIEW.md §3.7` already calls out backend `console.*` cleanup as a separate hardening item. Frontend has the same hygiene gap across many features; not specific to KDS.
- "`isConnected` is set with React state but the socket lifecycle is module-scoped" — true, and intentional. The refcount design ensures the socket survives sibling-component-unmount, while the local `isConnected` state tracks this specific hook's perception. The two are coupled via `handleConnect`/`handleDisconnect` listeners that are re-attached per mount.
- "Audio context never closed" — the singleton `sharedAudioContext` at `:11` lives for the tab's lifetime. Browsers handle this fine; closing would re-create on the next mount and re-trigger the "user gesture required" autoplay constraint.

---

## 8. What's solid (positive findings)

Patterns worth keeping; cross-links to backend kds.md and to where these patterns should propagate.

- **`useKitchenSocket.ts:101-102` — explanatory comment "Room membership is decided server-side from the JWT role on connect; no inbound join/leave messages are needed."** This comment exists because *something needed to be there* — without it, a maintainer reading the hook would wonder why there's no `socket.emit('join-kitchen', ...)`. The comment matches the backend's deliberate **absence** of `@SubscribeMessage('join-*')` documented at `kds.gateway.ts:203-206`. Pattern to replicate: every "intentionally missing" feature should be commented at *both* ends.

- **`frontend/src/lib/socket.ts:14, 18-27, 59-66 — refcount-based socket sharing.** One Socket.IO instance is shared across simultaneous mounts of KDS, POS, Voxel, Notifications. The last unmount disconnects; everything before it just decrements. Cross-link to `frontend-lib.md` when it exists — this is the right pattern, and it would be tempting (but wrong) for each feature hook to open its own socket. The 4-call API (`initializeSocket` / `disconnectSocket` / `forceDisconnectSocket` / `getSocket`) is small enough to audit at a glance.

- **`frontend/src/lib/socket.ts:40-47` — token replay on rotation.** When `useAuthStore.accessToken` changes (because `lib/api.ts:50` wrote it after a refresh), the subscribe block updates `socket.auth.token` and reconnects. This is what makes the backend's `tokenVersion`-based revocation actually land in realtime — without it, a revoked staff JWT keeps its gateway connection until the next natural disconnect. The 4-line comment at `socket.ts:36-39` explicitly explains this. Cross-link to backend `kds.md` invariant I-1 / I-2 — both depend on this client behaviour to be effective at the realtime layer.

- **`useKitchenSocket.ts:11-22` — single shared `AudioContext`.** Chromium caps concurrent AudioContexts at ~6 per tab; allocating one per notification would crash after a busy lunch rush. The singleton is allocated lazily on first notification (avoids the autoplay-policy block at page load) and reused across every order ding. The lazy + try/catch construction is also resilient against older WebKit ("webkitAudioContext" fallback at `:15`).

- **`useKitchenSocket.ts:60-72, 74-87` — invalidate-not-mutate on socket payloads.** Neither handler writes the cache directly with payload contents; both call `queryClient.invalidateQueries(['orders'])`, letting React Query refetch the authoritative state from the server on the next observer tick. This is the right call: it sidesteps the entire optimistic-vs-server-mismatch class (see §6 F-4) because the socket event is treated as "something changed, go ask the server" rather than "here is the new value". Cross-link: `usePosSocket.ts` follows the same pattern (`grep order:status-changed frontend/src/features/`).

- **`useKitchenSocket.ts:104-111` — listener cleanup is symmetric to attachment.** Every `socket.on(...)` at `:95-99` has a matching `socket.off(...)` at `:105-109` with the *same handler reference*. This matters: passing inline `() => ...` to `socket.off` would silently fail to remove the listener (different function identity), and the consequence would be event handlers piling up on every remount. The named-function pattern (`handleConnect`, `handleDisconnect`, ...) is the safe form.

- **Auth-store memory-only `accessToken` propagates cleanly to the socket auth.** `useAuthStore.getState().accessToken` at `socket.ts:29` reads from the in-memory store; the auth store explicitly does **not** persist `accessToken` (`authStore.ts:71-74`, with comment). A page reload mints a fresh access token via the httpOnly refresh cookie, so the socket cannot accidentally authenticate with a stale localStorage value. Cross-link to `CODE_REVIEW.md §3.2`.

- **Lifecycle scoping via `<ProtectedRoute allowedRoles={...}>`** at `App.tsx:175-177`. The hook cannot mount without an authenticated user *of the right role* — KITCHEN, ADMIN, or MANAGER. A WAITER or CASHIER hitting `/kitchen` is redirected at the route layer; the gateway connection never opens for them. This is defense-in-depth on top of the backend's role-based room membership (`kds.gateway.ts:126-138`).

---

## 9. Spot-checks performed

**Verified end-to-end:**
- I-1 (no client-supplied room name) — `grep -n "socket.emit\|join-" useKitchenSocket.ts` returns no matches. Cross-checked: no `@SubscribeMessage('join-*')` on the server side either (`kds.md` invariant I-7).
- F-1 (token rotation not single-flight) — read `socket.ts:40-47` and `lib/api.ts:38-59`. The `refreshInFlight` pattern exists in `api.ts` but is not mirrored in the socket-subscribe. The race is narrow but real.
- F-2 (logout does not force-disconnect) — `grep -n "forceDisconnect" frontend/src/features/auth/` returns no results. `useLogout.onSuccess/onError` in `authApi.ts:74-83` calls `logout()` + `queryClient.clear()` only. Verified the store-subscribe in `socket.ts:40-47` does react to `accessToken → null` (`state.accessToken !== prev.accessToken` is true on transition to null), and verified `socket.disconnect().connect()` is unconditional regardless of whether the new token is truthy — so the reconnect carries an undefined token.
- I-3 (i18n escaping) — `react-i18next` ≥ v11 escapes by default unless `interpolation: { escapeValue: false }` is set in `i18n/config.ts`. Confirmed by reading the toast call site at `:68`: `t('kitchen:kitchen.newOrderNotification', { orderNumber: event.orderNumber })` — no `<Trans>` and no `dangerouslySetInnerHTML` anywhere in `frontend/src/features/kds/`.
- Cross-link claim for §8 ("usePosSocket also uses invalidate-not-mutate") — opened `usePosSocket.ts:386-414`; same `socket.on/off` pattern, same `invalidateQueries`-based handling.
- Refcount idempotency under React StrictMode — read `socket.ts:18-27`. First mount: `socketRefCount=1`, creates socket. StrictMode synthetic unmount/remount: cleanup runs (`socketRefCount=0`, disconnects); re-mount creates a new socket. This is *correct* but does mean StrictMode causes one extra handshake during development — not a production concern.

**Dropped (initial template hints that didn't apply):**
- "Sanitize inbound payload" as a high-severity finding — investigated and dropped. The two write paths (`invalidateQueries`, toast via i18n) are both structurally inert to malicious payloads. Recorded as Low F-4 only.
- "View state cleared on tenant change" as a current bug — the codebase has no in-session tenant switcher today, so the invariant is enforced trivially via `useLogout`'s `queryClient.clear()`. Recorded as Low F-3 with the explicit "unverified — depends on future feature" tag.
- "Reconnect debounce on client" as a missing-feature finding — investigated and dropped. Socket.io's library-level reconnect already implements exponential backoff with jitter (1–5 s); adding a second layer of debounce on top would conflict with the library's state machine. The right place for additional protection is at the gateway side (see `kds.md` F-1).

**Downgraded:**
- F-1 (token-rotation race) originally drafted as Medium in scratch notes — downgraded to Low Cor. The doubled handshake doesn't leak data and is bounded to one duplicate per rotation event; rotations happen on access-token expiry (typically every 15 min), so the realistic blast radius is one duplicate handshake per user per quarter-hour. Cosmetic at best.
- F-2 (logout doesn't force-disconnect) drafted as High Sec in scratch notes — downgraded to Medium Cor. The server *rejects* the empty-token reconnect at `kds.gateway.ts:75-76`, so there's no security boundary breach; the cost is reconnect-spam against the gateway for as long as the logged-out tab stays open. Performance/reliability concern, not a security concern.

---

## 10. Recommended tests

The 3 integration tests that would catch the §3 invariants and §6 race risks. None exist today — `find frontend/src -name "*.spec.ts*" | xargs grep -l -i "socket\|kds"` returns zero. Skeletons only.

```ts
// frontend/src/features/kds/__tests__/useKitchenSocket.spec.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { io as ioMock, Socket } from 'socket.io-client'; // jest mock
import { useKitchenSocket } from '../useKitchenSocket';
import { useAuthStore } from '../../../store/authStore';

describe('useKitchenSocket — invariants & races', () => {
  // F-2 / I-2 — reconnect-storm test on logout
  it('does not enter an infinite empty-token reconnect loop after logout', async () => {
    // arrange: mount KDS with a valid token; let socket connect; assert handshake fired once
    useAuthStore.getState().login({ id: 'u1', role: 'KITCHEN' } as any, 'tok1');
    const { unmount } = renderHook(() => useKitchenSocket(), { wrapper });
    await waitFor(() => expect(connectAttempts).toBe(1));

    // act: logout (current useLogout behaviour — only clears store + queryClient)
    useAuthStore.getState().logout();

    // assert (current, failing): the store-subscribe in lib/socket.ts triggers
    //   socket.disconnect().connect() and the empty-token reconnect retries
    //   indefinitely. After 2s we expect to see >1 handshake attempts.
    // assert (post-fix): useLogout should call forceDisconnectSocket() so
    //   the socket goes to null and the subscribe block is a no-op. After 2s
    //   handshake attempts === 1 and socket === null.
    await new Promise(r => setTimeout(r, 2_000));
    expect(connectAttempts).toBe(1);
    unmount();
  });

  // I-1 — room-isolation test (cross-tenant)
  it('never sends a client-supplied join-* event to the gateway', async () => {
    // arrange: mock io() to capture all socket.emit() calls
    const emitSpy = jest.fn();
    (ioMock as jest.Mock).mockReturnValue({
      connected: false, connect: jest.fn(), disconnect: jest.fn(),
      on: jest.fn(), off: jest.fn(), emit: emitSpy, auth: {},
    } as Partial<Socket>);

    // act: mount, simulate connect, simulate three socket.io events arriving
    useAuthStore.getState().login({ id: 'u1', role: 'KITCHEN' } as any, 'tok1');
    renderHook(() => useKitchenSocket(), { wrapper });

    // assert: emitSpy never called with 'join-kitchen', 'join-pos', or anything
    //   that smells like a room-membership request. Membership is server-decided.
    expect(emitSpy).not.toHaveBeenCalled();
  });

  // F-4 — optimistic-vs-server status mismatch
  it('invalidates queries (not directly cache-writes) on order:status-changed', async () => {
    // arrange: mount KDS; seed React Query cache with order #123 status PREPARING
    const queryClient = new QueryClient();
    queryClient.setQueryData(['orders', '123'], { id: '123', status: 'PREPARING' });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    // act: socket emits order:status-changed with status='READY'
    socketHandlers['order:status-changed']({ orderId: '123', status: 'READY', updatedAt: '...' });

    // assert: cache entry is NOT overwritten with the raw socket payload;
    //   invalidate is called for both ['orders'] and ['orders', '123'].
    //   The authoritative refetch is what would write 'READY' into the cache.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orders', '123'] });
    expect(queryClient.getQueryData(['orders', '123'])).toMatchObject({ status: 'PREPARING' });
  });
});
```

Cross-tenant invariant tests follow the style from `CODE_REVIEW.md §3.1`: *mount KDS as tenant A's KITCHEN user → mock-emit `order:new` events with synthesized payloads claiming tenant B → assert the hook never crashes and the React Query cache reflects exactly what the next refetch returns, not the socket payload contents.* The single hook + the four invariants in §3 collapse to roughly 3 integration tests + 2 unit-level tests, well within the "3–10" §10 budget.
