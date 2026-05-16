# `notifications` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/notifications/...`, `backend/prisma/schema.prisma` (Notification, UserNotificationRead)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — index, exec summary, cross-cutting observations (this module: §3.5 + §4.13)

---

## 1. Health & summary

🟡 yellow

The notifications module owns the in-app realtime notification fan-out — a tenant-scoped Socket.IO namespace plus the persistence layer that backs the bell-icon list and the mark-as-read flow. The module is small (435 LOC across 5 files), correctly scopes rooms by `tenantId` (`notifications.gateway.ts:51`), and uses a service-layer authorization filter to close the previously-noted cross-tenant IDOR write on `markAsRead` (`notifications.service.ts:56-66`). Risk concentrates entirely in the gateway handshake: the missing `payload.type === 'user'` check (§4.13 seed) lets a marketing or superadmin JWT silently authenticate into a tenant realtime stream, and a second, latent bug at `notifications.gateway.ts:45` reads `payload.userId` from a payload that the rest of the system signs as `sub` — so every staff socket joins the room literal `user:undefined`. Health is 🟡 (not 🟢) because the type-check is a known parity gap and the userId/sub mismatch breaks the per-user delivery path that `sendNotificationToUser` is supposed to feed.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/notifications/notifications.gateway.ts` (85 LOC) — handshake, JWT verify, room join, fan-out methods.
- `backend/src/modules/notifications/notifications.service.ts` (190 LOC) — persistence, mark-as-read authz, `notifyAdmins` batch flow.
- `backend/src/modules/notifications/notifications.controller.ts` (32 LOC) — REST surface for list / mark-read / mark-all-read.
- `backend/src/modules/notifications/notifications.module.ts` (32 LOC) — `JwtModule.registerAsync` config + provider wiring.
- `backend/src/modules/notifications/dto/create-notification.dto.ts` (96 LOC) — `NotificationType` / `NotificationPriority` enums, `CreateNotificationDto`.
- `backend/prisma/schema.prisma:1357-1404` — `Notification` and `UserNotificationRead` models.

**Compared against:**
- `backend/src/modules/kds/kds.gateway.ts` (479 LOC) — exemplar gateway with the `payload.type !== 'user'` guard at `:105` and Sentry-wrapped handshake error path at `:84-87`.
- `backend/src/modules/auth/strategies/jwt.strategy.ts:36-39` — canonical `type !== 'user'` rejection used for HTTP.
- `backend/src/modules/auth/auth.service.ts:564-571` — confirms main-app JWTs are signed with `sub: user.id` and `type: 'user'`.
- `backend/src/modules/marketing/services/marketing-auth.service.ts:149-153` and `backend/src/modules/superadmin/services/superadmin-auth.service.ts:558-563` — confirm marketing/superadmin tokens are signed with the same `JWT_SECRET` but `type: 'marketing'` / `type: 'superadmin'`.

**Skipped:**
- HTTP integration with the rest of the platform (callers of `notifyAdmins` / `createAndSend`) — out of risk surface for this review; the gateway is the boundary.

---

## 3. Business-logic invariants

The contract this gateway and service owe their callers. Each row is testable by an integration test.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Handshake MUST verify a JWT before joining any room. | `notifications.gateway.ts:34-42` (no-token reject + `jwtService.verify`) | ❌ none | unauthenticated client receives every tenant's notifications |
| I-2 | Handshake MUST reject tokens with `type !== 'user'` (marketing / superadmin) for parity with `JwtStrategy` and `KdsGateway`. | **NOT ENFORCED** — `notifications.gateway.ts:42-51` performs no `payload.type` check; compare `kds.gateway.ts:105-110` and `jwt.strategy.ts:37-39` | ❌ none | marketing or superadmin token (same `JWT_SECRET`, same HS256) joins `tenant:<tenantId>` and reads every tenant notification in real time |
| I-3 | Rooms MUST be scoped to a single tenant — no cross-tenant fan-out. | `notifications.gateway.ts:51` (`tenant:${payload.tenantId}`); `:81-82` emits only to `tenant:${tenantId}` | ❌ none | tenant A receives tenant B notifications |
| I-4 | Per-user delivery MUST address a stable user identifier present on the JWT. | **BROKEN** — `notifications.gateway.ts:45` reads `payload.userId` but main-app JWTs sign `sub: user.id` (`auth.service.ts:565`), so `client.data.userId === undefined` and the join becomes `user:undefined` at `:50` | ❌ none | every authenticated staff socket joins the same `user:undefined` room; targeted `sendNotificationToUser` either misses the recipient or fans out to every staff member who happens to be connected |
| I-5 | `markAsRead` MUST verify the notification belongs to the caller's tenant AND is addressed to the caller (or is `isGlobal`) before recording a read. | `notifications.service.ts:56-66` — `findFirst` filtered by `tenantId` + `OR: [{ userId }, { isGlobal: true }]`, then `NotFoundException` | ❌ none | cross-tenant IDOR write (the comment at `:53-55` documents this is the regression being defended against) |
| I-6 | `findAll` MUST only return notifications scoped to the caller's tenant AND addressed to the caller (or `isGlobal`) AND not expired. | `notifications.service.ts:28-47` — `where: { tenantId, OR: [{ userId }, { isGlobal: true }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] }` | ❌ none | bell-icon list leaks other-tenant rows or expired notifications |
| I-7 | `notifyAdmins` MUST only target ACTIVE ADMIN/MANAGER users of the same tenant. | `notifications.service.ts:151-158` — `where: { tenantId, role: { in: ['ADMIN', 'MANAGER'] }, status: 'ACTIVE' }` | ❌ none | disabled or cross-tenant admin receives privileged alerts |
| I-8 | Event payloads SHOULD NOT carry sensitive PII (passwords, tokens, raw card numbers, plaintext 2FA codes). | **Not statically enforced** — `notifications.service.ts:107` passes through `createNotificationDto.data` (`any`) unchanged into the emit at `:117-126`. The DTO example at `dto/create-notification.dto.ts:83` shows callers passing OTP-like `{ code: '123456' }`. | ❌ none | leak of verification codes / privileged action context through any compromised browser tab or replayed socket frame |
| I-9 | `data: any` payloads SHOULD be size-bounded so a malformed caller cannot ship megabyte-scale objects through the socket bus. | **Not enforced** — `data?: any` (`create-notification.dto.ts:86`) has no `@MaxLength` / size cap, persisted as `Json?` (`schema.prisma:1364`). | ❌ none | memory pressure on socket server, slow client UIs |

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `notifications.service.ts:82-90` — `markAllAsRead` wraps N `upsert(... notificationId_userId)` calls in `$transaction`. Idempotent by the `@@unique([notificationId, userId])` constraint at `schema.prisma:1400`. ✅
- `notifications.service.ts:67-71` — single `markAsRead` upsert is similarly idempotent on the composite unique key. ✅
- `notifications.service.ts:162-174` — `notifyAdmins` uses `createMany` + a re-fetch keyed by `(tenantId, userId IN admins, createdAt, title)` to recover the inserted rows (`:177-184`). The re-fetch key is not unique — see F-3.

**Broadcast fan-out:**
- `sendNotificationToUser` (`notifications.gateway.ts:73-76`) and `sendNotificationToTenant` (`:81-84`) emit synchronously through `socket.io`'s in-memory adapter. There is no Redis adapter wired in the module, so a multi-replica deploy would drop emits for sockets connected to a different node.
- `notifyAdmins` (`notifications.service.ts:185-187`) emits N times sequentially after the DB write; failure of an individual emit is silently swallowed by socket.io. Acceptable for a best-effort transport, but worth noting since there is no retry queue.

**Subscription room cleanup on disconnect:**
- `handleDisconnect` (`notifications.gateway.ts:66-68`) only logs. socket.io itself drops the socket from all its joined rooms automatically on disconnect (`socket.rooms` is reset by the adapter on `disconnecting` → `disconnect`), so no explicit `socket.leave(...)` is required. **Room cleanup is implicit and correct.** No in-memory data structure outside socket.io keeps a reference to the disconnected client, so there is no leak surface to clean.
- Reconnect handling is delegated to the client; the gateway has no debounce / idempotency on rejoin (unlike `kds.gateway.ts:177-191`'s lastActivity debounce). Acceptable here because the rooms are derived purely from JWT claims, but means a flaky reconnect storm is `N × verify+join`.

**Race windows still open:**
- *Sketch:* admin A is just-promoted from WAITER → MANAGER (`User.role` updated, `tokenVersion` bumped). A concurrent `notifyAdmins` runs before A's stale socket has been forcibly disconnected. The DB query at `:151-158` correctly excludes A (because A is now MANAGER and is included), but if A had just been *demoted*, the open socket still sits in `tenant:${tenantId}` because the gateway has no `tokenVersion` per-tick recheck.
  *Where:* `notifications.gateway.ts:42-51` — JWT verified once at connect; no revocation hook.
  *Severity:* Low Sec — mirrors the JWT-revocation-latency trade-off already documented in `CODE_REVIEW.md §3.2` (A1). Same model as the rest of the system, called out for completeness.
  *Fix:* none required if the system-wide revocation model is accepted; otherwise add a per-emit `tokenVersion` check against a cached map.

**Idempotency keys:**
- DB writes (`Notification.id` defaults to `@default(uuid())`, `UserNotificationRead` keyed on `(notificationId, userId)`) are inherently idempotent at the row level. Socket emits are not idempotent — duplicate `createAndSend` calls would deliver the same notification twice, but the underlying `Notification` row is a fresh insert each time, which is the intended behavior.

---

## 7. Findings

Verified findings unmarked; unverified flagged `*(unverified)*`.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| N-1 | **High** | Sec | `notifications.gateway.ts:32, 42` | Handshake accepts any JWT signed with `JWT_SECRET` regardless of `payload.type`. Marketing and superadmin realms sign with the same secret (`marketing-auth.service.ts:149-153`, `superadmin-auth.service.ts:558-563`); without the `type === 'user'` guard a marketing or superadmin token joins `tenant:<tenantId>` and receives every tenant notification in real time. `JwtStrategy` (`jwt.strategy.ts:37-39`) and `KdsGateway` (`kds.gateway.ts:105-110`) both enforce this check. This is the §4.13 seed finding from `CODE_REVIEW.md`, promoted from Medium → High once the parity with HTTP + KDS auth policy is taken into account. | Add `if (payload.type && payload.type !== 'user') { client.disconnect(); return; }` immediately after `jwtService.verify`, mirroring `kds.gateway.ts:105-110`. Optionally also validate `algorithms: ['HS256']` explicitly at the verify call (currently inherited from module config at `notifications.module.ts:22-23`, but defense-in-depth costs nothing). |
| N-2 | **High** | Cor | `notifications.gateway.ts:45, 50, 73-76` | `payload.userId` is read from a JWT that is signed with `sub: user.id` (verified at `auth.service.ts:565`) — `payload.userId` is `undefined`. As a result `client.data.userId = undefined` and the per-user room becomes `user:undefined`. Every authenticated staff socket joins the same broken room; `sendNotificationToUser(userId, ...)` emits to `user:${userId}` which no real socket is in, so the targeted-delivery path silently no-ops. Tenant-scope fan-out still works (it uses `payload.tenantId`, which IS on the payload, `:46`), but `notifyAdmins`' per-admin emit (`notifications.service.ts:186`) and any direct user-targeted notification is effectively dropped. | Change `payload.userId` to `payload.sub` at `:45` AND change the join template at `:50` to `user:${payload.sub}`. Add a unit/integration test asserting that a user that connects then receives a `sendNotificationToUser(self.id, ...)` actually gets the event. |
| N-3 | Medium | Cor | `notifications.service.ts:177-184` | `notifyAdmins` re-fetches the rows it just inserted by matching `(tenantId, userId IN admins, createdAt, title)`. `createdAt` is a `new Date()` taken once in JS (`:161`) and passed to `createMany` (`:172`), so the equality match works at the moment of insertion — but `(tenantId, userId, title, createdAt)` is **not a unique key** in the schema (`schema.prisma:1383-1385` indexes are non-unique). If a parallel caller fires `notifyAdmins` with the same title to the same admin within the same millisecond, the re-fetch returns N+M rows and the emit at `:185-187` ships unrelated rows to the wrong recipient ids. Low probability in practice (millisecond resolution + same-title collision) but the code is structurally trusting a non-unique key. | Either capture `notification.id` from `createMany`'s `RETURNING` (Prisma's `createManyAndReturn` since 5.14) or add a one-shot uuid `batchKey` column to the data payload and filter the re-fetch on `data.batchKey`. |
| N-4 | Medium | Sec | `notifications.service.ts:107, 117-126` + `dto/create-notification.dto.ts:81-86` | `data: any` flows from the caller into the persisted row AND into the socket emit unchanged — no validation, no allow-list of keys, no PII scrub, no size cap. The DTO example at `:83` literally shows callers passing `{ code: '123456' }` (a verification-code shape) through `createAndSend`. Any caller that puts a token / OTP / signed URL in `data` ships it over the realtime socket and stores it in plaintext in `notifications.data` (Json column, `schema.prisma:1364`). | Constrain `data` to a typed union (deep-link refs, order ids, public scalars). Add a small allow-list scrubber that strips well-known sensitive keys (`code`, `otp`, `token`, `password`, `secret`) before persist + emit. Add a `@MaxLength` on the serialized JSON. |
| N-5 | Medium | Arch | `notifications.gateway.ts:42` | `jwtService.verify(token)` is called without explicit `algorithms: ['HS256']`. The module's `JwtModule.registerAsync` does pin `verifyOptions: { algorithms: ['HS256'] }` (`notifications.module.ts:22-23`), so this is **safe today** — but `KdsGateway` belt-and-braces this at the call site (`kds.gateway.ts:95`: `this.jwtService.verify(token, { algorithms: ['HS256'] })`). A future refactor that swaps the injected `JwtService` for one without HS256 pinning would silently lose the algorithm check here. Defense-in-depth. | Add `{ algorithms: ['HS256'] }` to the `verify` call to mirror `kds.gateway.ts:95`. |
| N-6 | Medium | Arch | `notifications.gateway.ts:60-63` | The outer `try/catch` only logs (`this.logger.error`). The handshake never reports to Sentry, unlike `kds.gateway.ts:84-87` which Sentry-tags `{ source: 'kds-gateway', phase: 'handleConnection' }`. A Prisma outage, JWT library regression or undefined-property access during connect surfaces only as a terse log line. | Mirror `kds.gateway.ts:84-87`: `Sentry.captureException(error, { tags: { source: 'notifications-gateway', phase: 'handleConnection' }, extra: { socketId: client.id } })`. |
| N-7 | Low | Perf | `notifications.service.ts:46` | `findAll` is hard-capped to `take: 50` with no `skip` / pagination cursor. Older notifications are unreachable through the API. Acceptable for a bell-icon dropdown; worth noting if a "notifications history" page is ever added. | Add `skip` / cursor support if/when a history view ships. |
| N-8 | Low | Perf | `notifications.gateway.ts` (whole file) | Module is wired with the default in-memory socket.io adapter (no Redis adapter in `notifications.module.ts`). A multi-replica deploy would deliver to only the replica the recipient socket happens to be connected to. KDS gateway has the same shape; called out here for parity but tracked at the platform level, not module level. | Wire a shared `@socket.io/redis-adapter` if the deploy ever runs more than one Node replica. |
| N-9 | Low | Sec | `notifications.gateway.ts:35, 57, 75, 83` | Logs include `userId`, `tenantId`, and the notification `title`. The title field is caller-supplied free text (`dto/create-notification.dto.ts:28-29`) with no scrub; a caller that puts user PII in the title would write it to backend logs. Severity Low because the title is operator-controlled in current callers, but the log line at `:75` is `Notification sent to user ${userId}: ${notification.title}` — a future feature that allows customer-supplied titles would leak. | Drop `${notification.title}` from the log (keep `userId` / `notificationId`). |

Severity: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

Patterns worth keeping; other features should mirror them.

- `notifications.gateway.ts:34-38` — **fail-closed handshake**. No token → immediate `client.disconnect()` before any room join. Simple, correct, matches the KDS exemplar's intent at `kds.gateway.ts:75-76`.
- `notifications.gateway.ts:51` — **tenant-scoped rooms**. `tenant:${payload.tenantId}` is the only fan-out room and is derived directly from the verified JWT claim. No client-supplied tenant id is ever trusted (unlike the `join-kitchen` inbound handler that `kds.gateway.ts:203-206` deliberately removed). This is the right shape.
- `notifications.service.ts:50-66` — **authorization on `markAsRead`**. The pre-existing comment at `:53-55` documents the cross-tenant IDOR write that was patched; the current `findFirst` filtered by `tenantId` + `OR: [{ userId }, { isGlobal: true }]` followed by `NotFoundException` is the right pattern. **Replicate this filter-then-throw pattern in any future `update-if-allowed` endpoint.**
- `notifications.service.ts:142-189` — **`notifyAdmins` batches via `createMany` instead of N round-trips**. The pre-existing block comment at `:132-141` documents the perf regression that the batched form fixed (50 admins → 1 DB write instead of 50). Pattern worth replicating in any "fan-out to all admins" path.
- `notifications.service.ts:82-90` — `markAllAsRead` uses `$transaction` + idempotent `upsert` on a unique composite key — race-free.
- `notifications.module.ts:16-23` — **`JwtModule` config fails loud if `JWT_SECRET` is missing** (`throw new Error`). Catches misconfigured environments at startup instead of producing silently-unsigned tokens.
- `schema.prisma:1383-1385` — `Notification` has `@@index([tenantId])`, `@@index([userId])`, `@@index([createdAt])`. The `(tenantId, OR: [{ userId }, { isGlobal: true }])` query pattern at `:28-41` will use `tenantId` + post-filter; for the read volumes this table will see (low-frequency bell-icon refresh) it's fine. A compound `(tenantId, createdAt DESC)` would help if this table ever grows to millions of rows.

**Cross-link to the exemplar (for N-1's fix):** the cleanest concrete reference for the `type === 'user'` parity check is `backend/src/modules/kds/kds.gateway.ts:105-110`. `CODE_REVIEW.md §4.14` calls KDS out as "the cleanest gateway in the project"; a future `kds.md` deep review (Tier 2) should explicitly document this guard as the canonical pattern that `notifications` and `analytics` (§4.15) should adopt verbatim.

---

## 9. Spot-checks performed

**Verified:**
- N-1 confirmed at `notifications.gateway.ts:42-51` — no `payload.type` reference anywhere in the file. Marketing and superadmin token shapes verified at `marketing-auth.service.ts:149-153` and `superadmin-auth.service.ts:558-563` (both share `JWT_SECRET`, both set `type` to a non-`user` value). KDS exemplar verified at `kds.gateway.ts:105-110`.
- N-2 confirmed at `notifications.gateway.ts:45` (reads `payload.userId`) vs `auth.service.ts:564-571` (payload has `sub`, no `userId`). Same JWT shape used in `kds.gateway.ts:119` (`client.data.userId = payload.sub`). This is unambiguous — the line will produce `user:undefined` for every connect today.
- I-5 / N-3 baseline confirmed at `notifications.service.ts:56-66`. The authorization pattern is correct; N-3 is a separate concurrency edge on the re-fetch, not a regression in the IDOR fix.
- I-3 (tenant-scoped rooms) verified at `notifications.gateway.ts:51, 81-82`. No room name is derived from anything other than a JWT claim.

**Dropped (initial reading suggested but verified away):**
- "Disconnect handler leaks room membership" — verified at `notifications.gateway.ts:66-68`. socket.io's adapter auto-evicts on disconnect; the gateway holds no out-of-band Map keyed on socket.id (unlike `kds.gateway.ts:48` which does hold a `customerActivityLastWrite` Map but keyed on `sessionId`, not socket id, so doesn't grow per-connect). **Drop.**
- "Inbound message handlers accept untrusted room joins" — verified: there are **no** `@SubscribeMessage` handlers in this gateway. All room membership is connect-time derived from the JWT. **Drop.**

**Downgraded:**
- N-5 (explicit `algorithms: ['HS256']` at the verify call site) downgraded from High → Medium after confirming `notifications.module.ts:22-23` pins `verifyOptions: { algorithms: ['HS256'] }` at the module level. Defense-in-depth only.
- N-1's source severity in `CODE_REVIEW.md §4.13` was Medium; promoted to High here once the impact (cross-realm token can join tenant rooms with no fallback DB check) is laid out alongside the trivial fix cost.

---

## 10. Recommended tests

The 3 tests below target N-1, N-2, the §3 invariants and the disconnect/cleanup contract. Skeletons only.

```ts
// backend/src/modules/notifications/__tests__/notifications.gateway.integration.spec.ts
import { Test } from '@nestjs/testing';
import { io as ioClient, Socket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';

describe('NotificationsGateway invariants', () => {
  let httpUrl: string;
  let jwt: JwtService;
  // bootstrap a Nest test app with NotificationsModule + a real http listener

  it('I-2 / N-1: rejects handshake when JWT type is not "user"', async () => {
    // arrange: sign a token with { sub: 'm-1', tenantId: 't-1', role: 'MARKETING', type: 'marketing' }
    //          using the same JWT_SECRET as the gateway (mirrors marketing-auth.service.ts:149-153)
    const marketingToken = jwt.sign(
      { sub: 'm-1', tenantId: 't-1', role: 'MARKETING', type: 'marketing' },
    );

    // act: connect with that token on the /notifications namespace
    const client: Socket = ioClient(`${httpUrl}/notifications`, {
      auth: { token: marketingToken },
      transports: ['websocket'],
    });

    // assert: the gateway disconnects within a small budget and the client never
    //         receives any 'notification' frame even when we emit to tenant:t-1
    const disconnected = await new Promise<boolean>((resolve) => {
      client.on('disconnect', () => resolve(true));
      setTimeout(() => resolve(false), 500);
    });
    expect(disconnected).toBe(true);
  });

  it('I-3: cross-tenant broadcast does not leak across tenants', async () => {
    // arrange: two staff JWTs in tenants t-A and t-B; both connect with valid type='user'
    // act: gateway.sendNotificationToTenant('t-A', { title: 'A-only' })
    // assert: socket-A receives 'notification' with title='A-only';
    //         socket-B never receives any 'notification' frame in a 200ms window.
  });

  it('N-2: sendNotificationToUser(userId) reaches the user whose JWT.sub === userId', async () => {
    // arrange: sign a user JWT { sub: 'u-1', tenantId: 't-1', role: 'ADMIN', type: 'user' }
    //          connect on /notifications
    // act: gateway.sendNotificationToUser('u-1', { title: 'targeted' })
    // assert: socket receives a 'notification' frame with title='targeted' within 200ms
    // (this is the regression test for the payload.userId vs payload.sub bug)
  });

  it('room-cleanup-on-disconnect: socket no longer receives tenant frames after disconnect', async () => {
    // arrange: staff JWT for tenant t-1; connect, await 'connect'
    // act: client.disconnect(); then gateway.sendNotificationToTenant('t-1', { ... })
    // assert: server.in('tenant:t-1').fetchSockets() resolves to length 0
    //         (proves socket.io's adapter evicted the socket from the room)
  });

  it('I-2 negative control: a valid type="user" JWT IS accepted and joins tenant:<tenantId>', async () => {
    // arrange: sign { sub: 'u-1', tenantId: 't-1', role: 'WAITER', type: 'user' }
    // assert: rooms include 'tenant:t-1' and 'user:u-1' after the fix in N-2
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`: *create two tenants → for every emit method (`sendNotificationToUser`, `sendNotificationToTenant`, `notifyAdmins`) attempt to deliver an event addressed to tenant A → assert no socket connected as tenant B receives any frame.*
