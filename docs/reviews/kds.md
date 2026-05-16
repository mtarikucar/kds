# `kds` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `backend/src/modules/kds/kds.gateway.ts` (479 LOC) — the realtime bus
- `backend/src/modules/kds/kds.module.ts` (34 LOC) — JwtModule wiring
- `backend/src/modules/kds/kds.controller.ts` (75 LOC) — HTTP surface
- `backend/src/modules/kds/kds.service.ts` (243 LOC) — kitchen order state mutations
- Cross-ref: `backend/src/modules/auth/strategies/jwt.strategy.ts:37-38` (the `payload.type !== 'user'` policy this gateway mirrors)
- Cross-ref: `backend/src/modules/notifications/notifications.gateway.ts:32-54` (missing type check)
- Cross-ref: `backend/src/modules/analytics/gateways/analytics.gateway.ts:96-116` (missing type check)
- Cross-ref: `backend/prisma/schema.prisma:1217+` (`CustomerSession` model)

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — see §3.5 (WebSocket gateways comparison table), §4.13–§4.15 (KDS / notifications / analytics gateways), §8 (KDS called out as "what's already excellent").

---

## 1. Health & summary

🟢 **green** — and this is the **exemplar**. `kds.gateway.ts` is the cleanest of the three Tier-1 gateways in the project: dual-path authentication (staff JWT + customer session DB lookup), an explicit `payload.type !== 'user'` reject that closes the cross-realm token-confusion attack, mutually exclusive room sets per auth path (a customer-session socket *cannot* be in `kitchen-${tenantId}` because the only places `join()` is called for staff rooms live inside `tryStaffAuth`), role-based room membership decided at connect time (not by inbound `join-*` events — those handlers were deliberately removed, see `:203-206`), and a per-session debounce on `lastActivity` writes that disarms reconnect-storm DB pressure. The only finding worth filing is the rate-limit gap on the handshake itself (`§7 F-1`, Low Sec) — every other gateway in this codebase should be reading this file to learn what "scoped right" looks like. Health is unchanged from 2026-04-27; the prior review already called this module out in §8 of `CODE_REVIEW.md`.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/kds/kds.gateway.ts` (479 LOC) — connection lifecycle (`:56-90`), staff auth (`:92-144`), customer auth (`:146-197`), emit helpers (`:212-477`).
- `backend/src/modules/kds/kds.module.ts` (34 LOC) — only thing worth noting: `JWT_SECRET` is loaded from `ConfigService` and **shared with the main-app JWT realm** (`:21`), which is precisely why the `payload.type === 'user'` discriminator at `:105-110` is load-bearing.
- `backend/src/modules/kds/kds.service.ts` (243 LOC) — `getKitchenOrders` (`:33-72`), `updateOrderStatus` (`:74-140`), `updateOrderItemStatus` (`:142-187`), `cancelOrder` (`:189-241`).
- `backend/src/modules/kds/kds.controller.ts` (75 LOC) — 4 endpoints, all gated by `JwtAuthGuard + TenantGuard + RolesGuard`, all role-restricted to `ADMIN|MANAGER|KITCHEN`.

**Skimmed only:**
- `backend/src/modules/auth/strategies/jwt.strategy.ts:37-38` — to confirm the gateway's type discriminator is the *same* policy applied for HTTP (it is — both reject any `payload.type` that is defined and not equal to `'user'`).
- `backend/src/modules/notifications/notifications.gateway.ts:32-54` — to confirm it's missing the type check (it is).
- `backend/src/modules/analytics/gateways/analytics.gateway.ts:96-116` — same (it is).
- `backend/prisma/schema.prisma:1217+` (`CustomerSession`) — to confirm `isActive` + `expiresAt` are the right gates for the lookup at gateway `:147-156`.

**Skipped:**
- `backend/src/modules/kds/dto/` — thin DTOs.
- Per-emit-helper inner shape (`emitNewOrder`, `emitOrderUpdated`, ...) — they are pure broadcast wrappers. Once tenancy and room scoping are verified at `:243-477`, the bodies add nothing the §3 invariants depend on.
- Frontend socket client (`frontend/src/lib/socket.ts`) — separate review file (`frontend-features-kds.md`).

---

## 3. Business-logic invariants

The contract the gateway is responsible for keeping. Each row is a testable property of the socket lifecycle.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **JWT signature is verified on every handshake.** No staff socket reaches a `join()` call without `jwtService.verify` succeeding. | `kds.gateway.ts:95` (`this.jwtService.verify(token, { algorithms: ['HS256'] })`) — explicit `algorithms` pin defeats `alg=none` and RS-vs-HS confusion. | ❌ none | unauthenticated socket joins tenant room, receives every order event |
| I-2 | **Non-`user` token types are rejected** even when the HS256 signature is valid. Marketing and superadmin tokens share the secret and would otherwise authenticate into the tenant realtime stream. | `kds.gateway.ts:105-110` (`if (payload.type && payload.type !== 'user') return false`) | ❌ none | superadmin/marketing token grants tenant room access via socket; HTTP `JwtStrategy` blocks it but socket would not |
| I-3 | **`tenantId` and `role` must both be present** on a verified payload before any room is joined. | `kds.gateway.ts:112-117` (`if (!tenantId || !role) ... return false`) | ❌ none | malformed/legacy token joins rooms without proper scoping |
| I-4 | **Rooms are strictly scoped by `tenantId`.** Every `client.join(...)` and every `server.to(...)` includes `tenantId` in the room name; there is no global broadcast room and no tenant-id-stripped variant. | `kds.gateway.ts:131,134,137,172` (joins); `:245-477` (emits — all 13 emit-helpers use `kitchen-${tenantId}` / `pos-${tenantId}` / `personnel-${tenantId}` / `customer-session-${sessionId}`) | ❌ none | cross-tenant data leak across the realtime channel |
| I-5 | **Staff and customer auth paths are mutually exclusive.** A customer-session socket never joins `kitchen-*` / `pos-*` / `personnel-*`; a staff socket never joins `customer-session-*`. `tryStaffAuth` is the only function that joins staff rooms; `tryCustomerAuth` is the only function that joins the customer room. The `handleConnection` flow returns immediately after the first successful auth (`:66, :72`). | `kds.gateway.ts:64-73` (early-return after success); `:130-138` (staff joins, only inside `tryStaffAuth`); `:172` (customer join, only inside `tryCustomerAuth`) | ❌ none | privilege confusion: customer socket joins kitchen room, or vice versa |
| I-6 | **Customer-session validity is verified against the DB on every connect** (`isActive: true` and `expiresAt > now`). Validity is **not** trusted from the handshake payload — the session id is treated as an opaque lookup key. | `kds.gateway.ts:147-165` (`prisma.customerSession.findUnique` + `:162` (`!session.isActive || new Date() > session.expiresAt`)) | ❌ none | expired/revoked session id grants room access until the socket disconnects naturally |
| I-7 | **Role-based room membership** is decided at connect time from the JWT-claim `role`, not from any inbound socket event. Inbound `join-kitchen` / `join-pos` handlers were deliberately removed (`:203-206`) so a connected customer socket cannot elevate. | `kds.gateway.ts:126-138` (joins decided from `role`); `:203-206` (comment documenting the removal) | ❌ none | privilege escalation via emit |
| I-8 | **`lastActivity` writes are debounced per session** at 60 s in-process granularity, so reconnect storms do not amplify into DB write storms. | `kds.gateway.ts:48-49, 177-191` (`customerActivityLastWrite` Map + `ACTIVITY_DEBOUNCE_MS = 60_000`) | ❌ none | mobile-network flapping → CustomerSession write QPS spike → tail latency |
| I-9 | **Unexpected exceptions in the handshake disconnect the socket *and* surface to Sentry** with `source: 'kds-gateway'` tags, rather than being swallowed by a bare warn log. | `kds.gateway.ts:77-89` (`Sentry.captureException` with `tags.phase: 'handleConnection'`) | ❌ none | silent failure mode — bad token vs Prisma outage indistinguishable in logs |

Invariants here are about **socket lifecycle and room scoping**, not money — there is no decimal precision or invoice-numbering concern in this module. The HTTP surface (`kds.controller.ts`) also relies on the standard guard chain (`JwtAuthGuard + TenantGuard + RolesGuard`) and `kds.service.ts` scopes all reads by `tenantId` (`kds.service.ts:33-39, 76-81, 150-153, 168-170, 191-196`) — these inherit the patterns audited under `tenants.md` and don't generate gateway-specific invariants.

---

## 4. State machine

**Connection state enum** (informal — not a DB column; lives in `client.data` on the Socket.IO socket).

| State | Set by | `client.data.userType` |
|---|---|---|
| `HANDSHAKE` | initial — `handleConnection` is running | unset |
| `AUTHED_STAFF` | `tryStaffAuth` returns `true` | `'staff'` (`:122`) |
| `AUTHED_CUSTOMER` | `tryCustomerAuth` returns `true` | `'customer'` (`:170`) |
| `DISCONNECTED` | `handleDisconnect` | n/a |

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `HANDSHAKE → AUTHED_STAFF` | `handleConnection` with `token` present | `kds.gateway.ts:64-66` — `tryStaffAuth` succeeded (JWT verify + `type==='user'` + `tenantId&&role`) | yes per-socket (each socket runs handshake once) | join 1–3 staff rooms (`:131-138`); set `client.data.{userId,tenantId,role,userType='staff'}` (`:119-122`) |
| `HANDSHAKE → AUTHED_CUSTOMER` | `handleConnection` with `sessionId` present (and either no token, or token auth failed) | `kds.gateway.ts:70-72` — `tryCustomerAuth` succeeded (DB lookup + `isActive` + `expiresAt > now`) | yes per-socket | join `customer-session-${sessionId}` (`:172`); set `client.data.{sessionId,tenantId,customerId,userType='customer'}` (`:167-170`); optionally write `customerSession.lastActivity` if 60 s elapsed since last write (`:177-191`) |
| `HANDSHAKE → DISCONNECTED` | neither auth path succeeded | `kds.gateway.ts:75-76` (`no valid authentication` → `client.disconnect()`) | yes | warn log only |
| `HANDSHAKE → DISCONNECTED` | any unexpected exception | `kds.gateway.ts:77-89` (`catch (error)` → Sentry + `client.disconnect()`) | yes | Sentry event with `tags.source='kds-gateway'`, `tags.phase='handleConnection'`, `extra.socketId` |
| `AUTHED_STAFF → DISCONNECTED` | client close / server hangup | `handleDisconnect:199-201` | yes | log only — **no Socket.IO `client.data` cleanup needed** because the socket object is discarded |
| `AUTHED_CUSTOMER → DISCONNECTED` | client close / server hangup | `handleDisconnect:199-201` | yes | log only; the `customerActivityLastWrite` Map entry persists (intentional — it's the debounce key for the *next* connect from this `sessionId`) |

**Forbidden transitions** (must be guarded — all currently are):
- `AUTHED_STAFF → AUTHED_CUSTOMER` and `AUTHED_CUSTOMER → AUTHED_STAFF` — impossible by construction. `handleConnection` returns immediately after the first successful auth (`:66, :72`); there is no inbound event that flips `userType`. **I-5** depends on this.
- `HANDSHAKE → AUTHED_STAFF` via *customer-session id only* — impossible. `tryStaffAuth` is only invoked when `token` is truthy (`:64`).
- `HANDSHAKE → AUTHED_CUSTOMER` via *JWT token only* — impossible. `tryCustomerAuth` is only invoked when `sessionId` is truthy (`:70`).
- Elevation of customer socket into staff rooms via inbound `join-kitchen` / `join-pos` events — explicitly forbidden by the **absence** of handlers; documented at `:203-206`.

**Transitions that should be idempotent and are:**
- `HANDSHAKE → AUTHED_*` is naturally idempotent per-socket because Socket.IO calls `handleConnection` exactly once per connection. Re-connects from the same client always start a new socket id and re-run the full handshake — there is no resume / handshake-replay path.
- `lastActivity` update is idempotent under the 60-s debounce window (`:177-180`). Two reconnects 100 ms apart cause one write, not two.

No transitions are "should be idempotent but aren't" in this module.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `customerActivityLastWrite` Map (`:48`) is an **in-process** debounce shared across all sockets handled by one replica. It is a `Map<string,number>` — JS is single-threaded, so concurrent `get`+`set` from two near-simultaneous connections is interleaving-safe. The single dropped write under a tie is the desired behavior (debounce), not a race bug.
- The `prisma.customerSession.update` at `:181-190` is fire-and-forget (`.catch` only) and not transactional with the `findUnique` at `:147`. This is intentional and safe — `lastActivity` is a presence-tracking field, not a security or business-state field; a stale read followed by a stale write loses at most one timestamp tick. **Do not** wrap this in a transaction; the current shape is correct for the use case.

**Race windows still open** (each with a reproduction sketch):

*Reconnect storm (multiple-tab + flaky network)*
- *Sketch:* a customer opens the QR-menu on two tabs simultaneously with the same `sessionId`. Both tabs open WebSocket connections within ~50 ms.
- *Where:* `kds.gateway.ts:146-197` (`tryCustomerAuth`).
- *Behavior:* both sockets read the same `CustomerSession` row (`:147`), both pass the `isActive`+`expiresAt` check, both join `customer-session-${sessionId}` (`:172`), and Socket.IO holds two distinct sockets in the same room. Broadcasts via `emitToCustomerSession` (`:296`) reach both tabs — **this is the intended behavior** (multi-tab support), not a bug.
- The 60-s debounce on `lastActivity` (`:177-180`) means only one of the two parallel connects writes; the other is correctly suppressed.
- *Severity:* none — this is the design.

*Broadcast tenancy*
- *Sketch:* a staff user with `tenantId=T1` connects; a customer with `tenantId=T2` session connects. Server emits `emitNewOrder('T2', order)`.
- *Where:* `kds.gateway.ts:243-249` and every other `emitTo*` / `emit*` helper at `:251-477`.
- *Behavior:* the broadcast targets `kitchen-T2` / `pos-T2` — the T1 staff socket joined `kitchen-T1`, *not* `kitchen-T2`, so it does not receive the event. Verified at `:131-138` (join is parametrized on `tenantId` from the JWT, not from any caller-supplied argument).
- *Caveat to keep an eye on:* any future emit-helper that takes a `tenantId` argument from outside and then `server.to(...)` calls it without the `${tenantId}` interpolation would break I-4. All 13 current helpers do the interpolation correctly (`:245-477`).
- *Severity:* none in current code; this is a structural correctness property to assert via tests (§10).

*Multiple-tab staff*
- *Sketch:* an ADMIN opens two browser windows. Both sockets connect, both verify the same JWT, both join `kitchen-${tenantId}` and `pos-${tenantId}` and `personnel-${tenantId}`.
- *Where:* `kds.gateway.ts:130-138`.
- *Behavior:* both sockets are in the room; both receive every broadcast. Standard Socket.IO behavior. No deduplication is attempted (and shouldn't be — that's the client's UI problem if it cares).
- *Severity:* none.

*Token-spam at handshake (rate-limit gap — the §4.14 finding)*
- *Sketch:* an attacker opens 10 000 socket connections per second, each presenting a different forged/expired token. Each connection hits `tryStaffAuth → jwtService.verify` (a CPU-bound HMAC verification), fails, falls through to `tryCustomerAuth` (a DB round-trip to `findUnique`), fails, logs a warn line, and disconnects.
- *Where:* `kds.gateway.ts:56-90` — the whole `handleConnection` body has no per-IP / per-socket rate limiter.
- *Severity:* Low Sec / Medium Perf — the JWT verify is cheap (~µs per call), but the **customer-session fallback DB round-trip** is the actual amplification surface: a flood of bogus connections with random `sessionId` query params turns into one Prisma SELECT per connect. Mitigation is at `nginx`/L4 in production, but the gateway should also reject obviously-malformed tokens before reaching `jwtService.verify` and rate-limit per IP — see §7 F-1.

**Idempotency keys:**
- Not applicable to this module. Socket lifecycle isn't an at-least-once write pattern.

---

## 7. Findings

Same format as `docs/CODE_REVIEW.md`. Verified findings unmarked; unverified flagged `*(unverified)*` with the line they came from.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Low | Sec | `kds.gateway.ts:56-90` | **Handshake has no rate limiter.** `tryStaffAuth` (`:92-144`) logs failed JWT verifications but does not throttle token spam; `tryCustomerAuth` (`:146-197`) hits the DB on every attempt. An attacker can flood the namespace with bogus tokens / session ids, turning each connection into one `jwtService.verify` + one `prisma.customerSession.findUnique`. Identical row in `CODE_REVIEW.md §4.14`. | Add a per-IP attempt counter (e.g., `@nestjs/throttler` adapted for `@WebSocketGateway`, or a small in-memory `Map<ip, {count, windowStart}>`) at the top of `handleConnection`; reject with `client.disconnect()` after N failed attempts in a 60-s window. Cap the customer-session DB lookup at the same gate so it never runs more than X times per IP per minute. |

No other findings. This is intentional — the gateway is short, well-shaped, and (other than F-1) does everything the §3 invariants demand.

**Findings explicitly *not* logged here** (kept out of the table on purpose, listed so future readers don't refile them):
- "JWT verification doesn't check `tokenVersion`" — out of scope for the gateway. The `tokenVersion` revocation-latency trade-off is documented under `auth.md` and tracked as `CODE_REVIEW.md A1`. Adding it here would duplicate the trade-off without resolving the underlying policy decision.
- "`emit*` helpers accept `any`-typed payload arguments" — true (`:212, 243, 251, 259, ...`) but stylistic; tightening the types adds compile-time hygiene with no runtime contract change.
- "`customerActivityLastWrite` Map grows unbounded across the process lifetime" — true but practically bounded by the number of distinct customer sessions seen by one replica; the entries are tiny (string→number). A periodic prune would be polish, not correctness.

---

## 8. What's solid (positive findings)

**This module is the exemplar.** Every pattern below is something other gateways should adopt — cross-links to the gateways currently missing them are explicit.

- **`kds.gateway.ts:64-73` — single-shot dual-auth ladder.** Staff JWT is attempted first; on failure (or on the absence of `token`), the customer session id is attempted; if neither matches, the socket is disconnected. Each `try*Auth` returns a `boolean` and the caller `return`s immediately on the first `true`, so a successful staff auth cannot also trigger customer-session DB work. *Candidates that should adopt:* nothing else in the codebase has a dual auth path; pattern is unique to this gateway.

- **`kds.gateway.ts:95` — explicit `algorithms: ['HS256']` pin on `jwtService.verify`.** Defeats `alg=none` and RS↔HS confusion at the library level instead of relying on a global default. *Candidates that should adopt:*
  - `backend/src/modules/notifications/notifications.gateway.ts:42` — `this.jwtService.verify(token)` with no `algorithms` option.
  - `backend/src/modules/analytics/gateways/analytics.gateway.ts:107` — same.

- **`kds.gateway.ts:105-110` — strict `payload.type !== 'user'` rejection.** Marketing and superadmin tokens are signed against the shared secret; without this discriminator any valid superadmin or marketing token would authenticate into the tenant realtime stream. The same policy is enforced for HTTP at `auth/strategies/jwt.strategy.ts:37-38`. *Candidates that should adopt:*
  - `backend/src/modules/notifications/notifications.gateway.ts:42-46` — type check **missing**. Already filed as `CODE_REVIEW.md §3.5` ("Add a `payload.type === 'user'` check for parity with KDS").
  - `backend/src/modules/analytics/gateways/analytics.gateway.ts:107-114` — type check **missing**. Same upstream finding.

- **`kds.gateway.ts:112-117` — defensive nullity check on `tenantId` and `role` after `verify`.** A malformed payload that signed correctly but lacked claims would not silently `join('kitchen-undefined')`. *Candidates that should adopt:* any other socket gateway that pulls claims out of a verified payload.

- **`kds.gateway.ts:130-138` — role-decided room membership, no inbound `join-*` handler.** Membership is computed once from `role` at connect time. The deliberate **absence** of `@SubscribeMessage('join-kitchen')` is documented at `:203-206`. A customer socket therefore *cannot* elevate into staff rooms by emitting a bare message. *Candidates that should adopt:* this is the structural pattern the other two gateways already match (no inbound `join-*` handlers exist there either), but they don't enforce the type-discriminator that makes the room name trustworthy.

- **`kds.gateway.ts:146-165` — customer-session validity via DB lookup, not via signed token.** The handshake carries an opaque `sessionId` string; validity (`isActive`, `expiresAt`) is asserted against the live `CustomerSession` row. There is **no JWT for customer sessions**, which is deliberate — revoking a customer session is a single `UPDATE customer_session SET isActive=false WHERE sessionId=?`, not a token-version dance. *Candidates that should adopt:* if a customer-orders auth is ever moved to a JWT, keep the DB lookup; do not switch to claim-only validation.

- **`kds.gateway.ts:48-49, 177-191` — in-process debounce on `lastActivity` writes.** 60-second window per session id; fire-and-forget with `.catch` only. Disarms reconnect-storm DB pressure without coordinating across replicas — the staleness window matches the use case (presence tracking) and the inherent error mode (split-brain across replicas writes more than once per minute, which is also fine). *Candidates that should adopt:* any high-frequency "touch timestamp" write path. Notifications and analytics gateways do not have presence tracking, so the pattern isn't directly applicable, but the analytics gateway's `traffic-flow` upsert path (`CODE_REVIEW.md §4.15`) is conceptually similar and would benefit from a comparable batch-or-skip layer.

- **`kds.gateway.ts:77-89` — Sentry capture wrapping the whole `handleConnection`.** Previously a JWT-library regression or a Prisma outage during `findUnique` would have shown up as a one-line `authentication error: ...` warn with no stack. The current shape preserves full stack traces with `source: 'kds-gateway'` / `phase: 'handleConnection'` tags. This was added in commit `9b9eee4` ("fix(hardening): Sentry try-catch in filter; single-flight token refresh in axios"). *Candidates that should adopt:* both other gateways' `handleConnection` bodies — they currently swallow exceptions into a warn line.

- **`kds.module.ts:18-27` — JwtModule registered with the same `JWT_SECRET` env var as the main-app realm.** This is correct *because* the gateway enforces the type discriminator at `:105-110`. Without that discriminator, the shared-secret choice would be the bug; with it, it's the right design (one secret, three realms, type-tagged tokens).

- **`kds.service.ts:150-153` — tenant scoping at the Prisma `where` boundary instead of post-fetch.** Lookups for `orderItem` filter `order: { tenantId }` directly in the query rather than fetching by id and then checking. Removes the TOCTOU window and prevents cross-tenant probing via timing differences. The existing comment at `:147-149` explains the pattern.

---

## 9. Spot-checks performed

**Verified end-to-end:**
- F-1 (rate-limit gap) — opened `:56-90` and `:92-144` and `:146-197`; confirmed no throttling decorator on `handleConnection` and no in-method rate counter. The DB round-trip on every failed-token-then-fallback-sessionId attempt is the actual amplification surface (`:147`).
- I-1 (`algorithms: ['HS256']` pin) — confirmed at `:95` literally.
- I-2 (type-discriminator) — confirmed at `:105-110`; cross-checked with `auth/strategies/jwt.strategy.ts:37-38` (the gateway's policy matches HTTP).
- I-4 (room scoping by tenantId) — `grep -n "server\.to\|client\.join" kds.gateway.ts` listed all 13 emit helpers + 4 joins; every one interpolates either `tenantId` or `sessionId`. No global / tenant-stripped room exists.
- I-5 (staff/customer mutual exclusion) — confirmed by reading `:64-73` (early-return per branch) and verifying that the only `join('kitchen-* | pos-* | personnel-*')` call sites are inside `tryStaffAuth` (`:130-138`) and the only `join('customer-session-*')` call site is inside `tryCustomerAuth` (`:172`).
- I-7 (no inbound `join-*`) — `grep -n "@SubscribeMessage" kds.gateway.ts` returns nothing; the explanatory comment at `:203-206` confirms the removal was deliberate.
- Cross-link claims for §8 — opened `notifications.gateway.ts:32-54` and `analytics.gateway.ts:96-116`. Neither file checks `payload.type === 'user'`; neither pins `algorithms`. Cross-links are accurate.

**Dropped (initial template hints that didn't apply):**
- "Reconnect debounce is a race" — investigated and dropped. The single-threaded JS runtime + intended-to-lose-races debounce semantics mean concurrent connects deduplicate to one write, which is the goal. Not a finding.
- "Multi-tab same session can fan-out events twice" — investigated and dropped. Two sockets in the same `customer-session-${sessionId}` room each receive the broadcast — this is the design (multi-tab support), not a defect. Frontend tabs are responsible for their own UI dedup.

**Downgraded:**
- F-1 originally proposed as Medium Sec in scratch notes — downgraded to Low Sec / Medium Perf hybrid (logged as Low Sec to match `CODE_REVIEW.md §4.14`). Rationale: the JWT verify is cheap; the realistic abuse is DB-amplification via the customer-session fallback, and L4 rate-limiting at `nginx` already covers the most common attacker shape. The gateway-side mitigation is defense-in-depth.

---

## 10. Recommended tests

The 4 integration tests that would catch the §3 invariants and §6 race risks. Skeletons only; not full implementations. None of these tests exist today — `find backend -name "*kds*.spec.ts"` returns zero.

```ts
// backend/src/modules/kds/__tests__/kds.gateway.integration.spec.ts
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';

describe('KdsGateway socket auth & scoping', () => {
  // I-1, I-2, I-3 — handshake-bypass test
  it('rejects sockets with no token and no sessionId', async () => {
    // arrange: app under test on :3000, namespace /kds
    // act: const s = io('ws://localhost:3000/kds', { auth: {} });
    // assert: receives 'disconnect' within 500 ms; never enters any room
  });

  it('rejects sockets carrying a marketing-realm token (type !== "user")', async () => {
    // arrange: mint a token with { sub, tenantId, role: 'ADMIN', type: 'marketing' } against JWT_SECRET
    // act: connect with that token
    // assert: handshake rejected at kds.gateway.ts:105-110; socket disconnects;
    //         WARN log line matches /unsupported token type 'marketing'/
  });

  it('rejects sockets with valid signature but missing tenantId/role claims', async () => {
    // arrange: mint a token { sub, type: 'user' } — no tenantId, no role
    // act: connect
    // assert: disconnected; matches kds.gateway.ts:114-117
  });

  // I-4 — cross-tenant broadcast test
  it('does not deliver kitchen events across tenants', async () => {
    // arrange: two staff sockets, tenants T1 and T2, both KITCHEN role
    // act: gateway.emitNewOrder('T1', { ... })
    // assert: T1 socket receives 'order:new' once; T2 socket receives 0 events
    //         (cross-tenant invariant — repeat for every emit-helper in :243-477)
  });

  // I-5, I-7 — room-isolation test (staff vs customer)
  it('customer-session socket cannot receive kitchen broadcasts', async () => {
    // arrange: seed CustomerSession{ sessionId: 'cs1', tenantId: 'T1', isActive: true,
    //   expiresAt: +1h }; connect customer socket with { auth: { sessionId: 'cs1' } }
    // act: gateway.emitNewOrder('T1', { ... })
    // assert: customer socket receives 0 'order:new' events
    //         (proves the customer-session-${sessionId} room is disjoint from kitchen-T1)
  });

  it('staff socket cannot receive customer-session-scoped events', async () => {
    // arrange: connect ADMIN socket with valid user JWT for tenant T1
    // act: gateway.emitCustomerOrderCreated('cs1', { ... })
    // assert: ADMIN socket receives 0 customer:* events
  });

  // F-1 — token-spam rate-limit test (currently FAILS; pin once F-1 is fixed)
  it.todo('throttles repeated handshake failures from the same IP', async () => {
    // arrange: 100 connections in <1 s, each with a random invalid token
    // act: count how many reach jwtService.verify / prisma.customerSession.findUnique
    // assert (post-fix): after N failures the gateway short-circuits with
    //         client.disconnect() before the DB round-trip; current code performs
    //         100 verify+find pairs.
  });

  // I-6 — customer-session validity is DB-checked, not token-trusted
  it('rejects customer-session id that maps to isActive=false', async () => {
    // arrange: seed CustomerSession{ sessionId: 'cs2', isActive: false, expiresAt: +1h }
    // act: connect with { auth: { sessionId: 'cs2' } }
    // assert: disconnected; matches kds.gateway.ts:162
  });

  it('rejects customer-session id that is expired', async () => {
    // arrange: seed CustomerSession{ sessionId: 'cs3', isActive: true, expiresAt: -1m }
    // act: connect
    // assert: disconnected; matches kds.gateway.ts:162
  });

  // I-8 — reconnect debounce
  it('coalesces lastActivity writes under the 60-s debounce window', async () => {
    // arrange: customer-session row 'cs4'; spy on prisma.customerSession.update
    // act: connect, disconnect, reconnect 4× over 5 seconds
    // assert: customerSession.update called exactly once (first connect);
    //         remaining connects suppressed by ACTIVITY_DEBOUNCE_MS guard at :179
  });
});
```

The cross-tenant invariant test should follow the style from `CODE_REVIEW.md §3.1`: *create two tenants → attempt cross-tenant access via every emit-helper → assert zero leaks*. The 13 emit-helpers at `kds.gateway.ts:243-477` can be parameterized as a single table-driven test rather than 13 hand-written cases.
