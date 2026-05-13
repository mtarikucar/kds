# `analytics/` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/analytics/...`
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §4.15 — analytics gateway + services seeds

---

## 1. Health & summary

🟡 yellow

The analytics module owns the high-volume telemetry path — edge devices stream person-detection records over a Socket.IO gateway, the gateway fans them into `OccupancyRecord` + `TrafficFlowRecord` rows, and the HTTP-side `HeatmapService` aggregates the same tables into grids for the dashboard. Multi-tenant scoping is consistent across all six services (`backend/src/modules/analytics/services/`) and the gateway: every write and every read is filtered on `tenantId`, and the gateway rooms are namespaced `analytics-${tenantId}` (`analytics.gateway.ts:114`). The risk concentrates in two places. First, the handshake at `analytics.gateway.ts:106-120` accepts *any* JWT signed by the shared secret without the `payload.type === 'user'` check that `kds.gateway.ts:105-110` enforces — a marketing or superadmin token validates here and joins a tenant's analytics room. Second, the high-volume edge stream is unbounded on both write (`updateTrafficFlow` at `analytics.gateway.ts:483-526` does N sequential awaited upserts per tick, where N ≤ 1600 cells on the 40×40 grid documented at `heatmap.service.ts:23`) and read (`getOccupancyHeatmap` at `heatmap.service.ts:70-83` does an unbounded `findMany` over a caller-supplied time window with no `take` cap). Health changed from 🟢 (last review, §4.15) to 🟡 because the gateway parity gap and the per-tick burst are now spelled out as findings rather than one-line bullets.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/analytics/gateways/analytics.gateway.ts` (547 LOC) — handshake auth, edge-device registration, occupancy ingest, heartbeat, traffic-flow upsert, dashboard broadcasts.
- `backend/src/modules/analytics/services/heatmap.service.ts` (624 LOC) — occupancy/traffic/dwell heatmaps, traffic-flow path queries, congestion analysis, heatmap cache.
- `backend/prisma/schema.prisma:1866-1926` — `OccupancyRecord` (indices `[tenantId, timestamp]`, `[tableId]`, `[trackingId, timestamp]`) and `TrafficFlowRecord` (`@@unique([tenantId, hourBucket, cellX, cellZ])`, `@@index([tenantId, hourBucket])`, `@@index([cellX, cellZ])`).
- `backend/src/modules/kds/kds.gateway.ts:92-144` — read end-to-end for cross-link as the gateway exemplar.

**Skimmed only:**
- `backend/src/modules/analytics/services/insights.service.ts` (481 LOC) — tenant scoping verified at lines 40, 60, 80, 103, 184, 211; insight list at `:53-61` paginates with `take: limit` (skim only because not the focus surface).
- `backend/src/modules/analytics/services/table-analytics.service.ts` (541 LOC) — tenant scoping verified at lines 29, 42, 67, 168, 188, 249, 272, 314.
- `backend/src/modules/analytics/services/camera.service.ts` (345 LOC) — tenant scoping verified at lines 37, 75, 89, 111, 163, 191, 209, 228, 260.
- `backend/src/modules/analytics/analytics.controller.ts:48-49` — guard chain `JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard`; heatmap endpoints gated by `@Roles(ADMIN, MANAGER)` and `@RequiresFeature(ADVANCED_REPORTS)` (`:62-63`).

**Skipped:**
- `services/mock-data-generator.service.ts` (593 LOC) — dev-only seed path, no production risk surface.
- `dto/`, `enums/` — DTO validation shapes; not a risk surface here.

---

## 3. Business-logic invariants

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Handshake JWT must have `payload.type === 'user'` (reject marketing / superadmin tokens, matching `kds.gateway.ts:105-110`). | **NOT ENFORCED** — `analytics.gateway.ts:106-120` verifies signature only; no `type` check. | ❌ none | Marketing-realm or superadmin token validates against the shared secret and joins `analytics-${tenantId}` for any tenant id encoded in its claim. See F-1. |
| I-2 | Every `OccupancyRecord` / `TrafficFlowRecord` write is scoped to the connected socket's `tenantId`, not the payload's claimed `tenantId`. | `analytics.gateway.ts:244` (`tenantId !== payload.tenantId` rejection), `:254` (`tenantId` from socket data piped into `createMany`), `:484, 506-510, 513` (traffic-flow upsert uses the socket-scoped `tenantId`). | ❌ none | Edge device could forge a write to another tenant's records. Currently guarded — keep the guard. |
| I-3 | Every analytics read query filters by `tenantId` (no unfiltered `findMany`). | `heatmap.service.ts:72, 162, 233, 300, 320, 380`; `insights.service.ts:40, 80, 103, 184, 211`; `table-analytics.service.ts:29, 42, 67, 168, 188, 249, 272, 314`; `camera.service.ts:37, 75, 89, 111, 163, 191`. | ❌ none | Cross-tenant heatmap/traffic leak. Currently consistently held. |
| I-4 | Per-tick traffic-flow upsert batch is bounded so a single occupancy frame cannot enqueue >K DB round-trips. | **NOT ENFORCED** — `analytics.gateway.ts:500-525` iterates `cellCounts` with one awaited `upsert` per cell; upper bound is the grid cell count (40×40 = 1600, per comment at `heatmap.service.ts:22-23`; clamped to 100×100 = 10000 elsewhere by `clampGridDim` at `heatmap.service.ts:26-29` but **this clamp protects reads, not the write path**). | ❌ none | Hostile or buggy edge device sends a frame with detections spread across many cells, gateway issues thousands of sequential upserts per tick, head-of-line blocking on Prisma pool. See F-2. |
| I-5 | Heatmap / traffic-flow read queries are bounded — either a `take` cap on the row count, or a server-enforced max time window, or both. | **PARTIALLY ENFORCED** — grid dimensions clamped (`heatmap.service.ts:54-55, 143-144, 227-228`), but `findMany` on `occupancyRecord` (`:70-83`, `:298-312`, `:318-335`) and `trafficFlowRecord` (`:159-172`, `:231-246`, `:378-393`) takes a caller-supplied `startDate`/`endDate` from `analytics.controller.ts:75-76` (defaults to last 24h but a client may pass a multi-month range) with no `take` and no window-width check. | ❌ none | Multi-month range over a busy floor returns millions of `OccupancyRecord` rows, OOMs the Node process or stalls the query pool. See F-3. |
| I-6 | Edge-device DB writes filtered by `(deviceId, tenantId)` so device id collisions across tenants don't cross-update. | `analytics.gateway.ts:308-315` (heartbeat), `:340-356` (health), `:457-463` (status). All correctly include `tenantId`. The `EdgeDevice.@@unique([tenantId, deviceId])` constraint (referenced at `:176-180`) confirms the scoping shape. | ❌ none | Compromised tenant-A device flips tenant-B device status. Currently held. |
| I-7 | Heartbeat/health writes require an authenticated `client.data.tenantId` — never `undefined`. | `analytics.gateway.ts:309, 341` use `client.data.tenantId` directly. If `handleConnection` failed to set it but didn't disconnect, the `updateMany` would resolve to `tenantId: undefined` and **match every device row**. The flow at `:107-120` does disconnect on error, so practically held, but the dependency is implicit. | ❌ none | If a future refactor breaks the disconnect-on-error path, every device row in the DB is updatable. See F-5 (defensive hardening). |

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `analytics.gateway.ts:175-201` — `edgeDevice.upsert` keyed by `(tenantId, deviceId)` composite unique. Atomic at the DB level; race-free for device-registration storms.
- `analytics.gateway.ts:503-524` — `trafficFlowRecord.upsert` keyed by `(tenantId, hourBucket, cellX, cellZ)`. Per-cell atomicity is fine, but the loop is **N sequential awaits** (one per cell), not a transaction. Two concurrent ticks for the same hour bucket race on `increment` ops — those are commutative under the unique constraint, so the *count* is correct, but Prisma pool occupancy is N × clients.

**Race windows still open** (each with a reproduction sketch):

- *Sketch — traffic-flow burst:* edge device sends one `edge:occupancy` payload with `detections` spread across 1600 distinct `(gridX, gridZ)` cells. `handleOccupancyData` (`analytics.gateway.ts:236-279`) does one bulk `createMany` (good) then fires `updateTrafficFlow` (`:267`) which executes 1600 sequential awaited upserts (`:500-525`). At 10 frames/sec from K cameras, the gateway holds K × 1600 in-flight DB ops; Prisma pool starves; other handlers (heartbeat, registration, the kds gateway's order writes) queue behind it.
  *Where:* `analytics.gateway.ts:500-525`
  *Severity:* High Perf
  *Fix:* (a) clamp `cellCounts.size` and drop overflow with a counter metric; (b) batch into a single raw `INSERT … ON CONFLICT DO UPDATE … SET person_count = person_count + EXCLUDED.person_count` so one round-trip handles all cells; (c) move the whole flow off the request socket and onto a queue (BullMQ) since the call site is already fire-and-forget at `:267-269`.

- *Sketch — heatmap query DoS:* admin calls `GET /analytics/heatmap/occupancy?startDate=2020-01-01&endDate=2026-05-11` (`analytics.controller.ts:75-76` accepts any caller-provided ISO date). `heatmap.service.ts:70-83` issues an unbounded `findMany` on `OccupancyRecord` across six years. On a busy floor (≥10 detections/sec, 8h/day → ~100M rows/year), this returns hundreds of millions of rows into Node memory. The cache at `:58-67` *can* short-circuit, but the very first call for that range builds the cache by running this query.
  *Where:* `heatmap.service.ts:70-83`, also `:159-172`, `:231-246`, `:298-312`, `:318-335`, `:378-393`.
  *Severity:* High Perf (memory) / Medium Sec (admin-side DoS)
  *Fix:* server-side max window (e.g., 30d for HOURLY, 1y for DAILY); reject longer windows with `400 Bad Request`. Add `take: 1_000_000` as a belt-and-suspenders cap. Add `(tenantId, timestamp)` is already present at `schema.prisma:1894`; confirm Postgres uses it via `EXPLAIN`.

- *Sketch — handshake type bypass:* attacker holds a `type: 'marketing'` JWT (signed by the shared `JWT_SECRET` per the JwtStrategy + KDS gateway notes at `kds.gateway.ts:101-110`). Connects to `/analytics-edge` namespace. `analytics.gateway.ts:107` calls `jwtService.verify(token)` — signature passes. `:110-114` reads `payload.tenantId` (marketing tokens may or may not carry one; if they do, attacker joins `analytics-${that_tenantId}`).
  *Where:* `analytics.gateway.ts:106-120` — missing the check that `kds.gateway.ts:105-110` performs.
  *Severity:* Medium Sec
  *Fix:* mirror `kds.gateway.ts:95, 105-110` — pass `algorithms: ['HS256']` and reject `payload.type !== 'user'`.

**Idempotency keys:**
- Traffic-flow upsert: keyed by `(tenantId, hourBucket, cellX, cellZ)` — natural idempotency. Replaying the same detection adds to the counter (not idempotent on counts) but `OccupancyRecord.createMany` uses `skipDuplicates: true` (`analytics.gateway.ts:263`), which is the row-level guard. Acceptable.
- Heatmap cache: keyed by `(tenantId, startTime, endTime, granularity, metric)` at `heatmap.service.ts:553-561`. Race on concurrent first-build is benign (last write wins; payload is deterministic).

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Sec | `backend/src/modules/analytics/gateways/analytics.gateway.ts:106-120` | Handshake verifies the JWT signature but does not check `payload.type === 'user'`. A `type: 'marketing'` or `type: 'superadmin'` token signed by the shared secret authenticates and joins `analytics-${tenantId}`. `kds.gateway.ts:95, 105-110` performs both the `algorithms: ['HS256']` pin and the explicit type check. | Mirror the kds gateway: `this.jwtService.verify(token, { algorithms: ['HS256'] })` then `if (payload.type && payload.type !== 'user') { client.disconnect(); return; }`. Same fix applies to `notifications.gateway.ts` per §4.13 of the upstream review. |
| F-2 | Medium | Perf | `backend/src/modules/analytics/gateways/analytics.gateway.ts:252-273, 308-355, 483-526` | `handleOccupancyData` → `updateTrafficFlow` issues one awaited `upsert` per `(cellX, cellZ)` cell. Upper bound is the active-cell count of a single occupancy frame; the documented grid is 40×40 (`heatmap.service.ts:23`), so a maximally-spread frame produces 1600 sequential DB round-trips per tick per camera. Heartbeat (`:308-315`) and health (`:340-356`) writes are single-row but unthrottled — a misconfigured device that sends heartbeats at 100Hz floods the pool. | Cap `cellCounts.size` to a constant (e.g., 256) and drop the overflow with a `tenantId`-tagged warn log. Replace the per-cell loop with `prisma.$executeRaw` doing a single multi-row `INSERT … ON CONFLICT … DO UPDATE SET person_count = … + EXCLUDED.person_count`. Throttle heartbeats per device — e.g., debounce DB writes to one per minute (the kds gateway does this for `customerSession.lastActivity` at `kds.gateway.ts:174-191`). |
| F-3 | Medium | Perf | `backend/src/modules/analytics/services/heatmap.service.ts:70-83` (occupancy heatmap), `:159-172` (traffic), `:231-246` (dwell), `:298-312`, `:318-335` (flow paths), `:378-393` (congestion) | All six heatmap reads do unbounded `findMany` over a caller-supplied date range. Controller (`analytics.controller.ts:75-76`) defaults to 24h but accepts any ISO date. On a busy floor (~360k `OccupancyRecord`/day at 10Hz/8h), even a 30-day uncached query returns ~10M rows into Node memory. | (a) Cap the range server-side per granularity (HOURLY ≤ 30d, DAILY ≤ 1y, WEEKLY ≤ 5y); reject longer windows with `BadRequestException`. (b) Add `take: 1_000_000` as a hard ceiling. (c) For occupancy specifically, push the grid aggregation into a SQL `GROUP BY (floor(positionX/cellSize), floor(positionZ/cellSize))` so only one row per cell crosses the wire. (d) Confirm `@@index([tenantId, timestamp])` (already present at `schema.prisma:1894`) is being used via `EXPLAIN`. |
| F-4 | Low | Sec | `backend/src/modules/analytics/gateways/analytics.gateway.ts:107` | `jwtService.verify(token)` accepts the default algorithm list. The strategy elsewhere pins HS256 (`kds.gateway.ts:95`). With both HS256 and RS256 disabled-by-default in newer @nestjs/jwt this is currently safe, but explicit pinning is the documented hardening. | `verify(token, { algorithms: ['HS256'] })`. Bundle with F-1. |
| F-5 | Low | Sec | `backend/src/modules/analytics/gateways/analytics.gateway.ts:308-315, 340-356, 457-463` | Heartbeat / health / status `updateMany`s filter by `{ deviceId, tenantId: client.data.tenantId }`. If a future refactor lets `handleConnection` set `client.data.authenticated` but skip `client.data.tenantId`, the filter resolves to `tenantId: undefined`, which Prisma treats as "match anything." Defense-in-depth only — the current connect flow always sets both. | Add an explicit guard at the top of each handler: `if (!client.data.tenantId) { return { success: false, error: 'unauthenticated' }; }`. Or move the `tenantId` derivation into a shared helper that throws. |
| F-6 | Info | Arch | `backend/src/modules/analytics/services/heatmap.service.ts:296-352` | `getTrafficFlowPaths` runs N+1: one `findMany` for distinct tracking ids (`:298-312`), then one `findMany` per tracking id (`:318-335`). `limit` defaults to 50, so worst case is 51 queries. Not a bug — just brittle as the cap grows. | Collapse into a single query: `findMany` with `where: { trackingId: { in: trackingIds } }, orderBy: [{ trackingId: 'asc' }, { timestamp: 'asc' }]`, then group in JS. |
| F-7 | Info | Cor | `backend/src/modules/analytics/gateways/analytics.gateway.ts:267-269` | Fire-and-forget `updateTrafficFlow` returns success to the edge device even if the aggregation write later fails. Acceptable for a metric that's recomputable from `OccupancyRecord` (the source of truth at `:252-264`), but the failure is only logged, not surfaced as a Sentry event. | If revenue/staffing decisions are made off `TrafficFlowRecord`, add `Sentry.captureException` in the `.catch` at `:268` so silent aggregation drift is visible. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **Consistent tenant scoping pattern.** Every read in `heatmap.service.ts`, `insights.service.ts`, `table-analytics.service.ts`, `camera.service.ts` filters by `tenantId` as the first key in the `where` clause. Cross-checked at: `heatmap.service.ts:72, 162, 233, 300, 320, 380`; `insights.service.ts:40, 80, 103, 184, 211`; `table-analytics.service.ts:29, 42, 67, 168, 188`; `camera.service.ts:37, 75, 89, 111, 163, 191, 209, 228, 260`. Writes mirror the pattern: `analytics.gateway.ts:254` (occupancy), `:309, 341, 458` (edge device by `(tenantId, deviceId)`), `:506-510` (traffic flow). **Candidates that should adopt this strictness:** none — analytics is already at the bar; this pattern is the floor other modules should hold to.

- **Composite-key device disambiguation.** `analytics.gateway.ts:69-86` keys the `connectedDevices` map by `${tenantId}:${deviceId}` and the `findDevice` helper at `:79-86` requires the caller to pass `tenantId` to disambiguate. This closes a latent cross-tenant device-id collision that a naive `Map<deviceId, conn>` would expose. The `EdgeDevice.@@unique([tenantId, deviceId])` constraint at the schema level (referenced at `analytics.gateway.ts:176-180`) makes the same guarantee in storage.

- **Grid-dimension clamp on heatmap reads.** `heatmap.service.ts:22-29, 54-55, 143-144, 227-228` clamps caller-supplied `gridWidth`/`gridDepth` to `MAX_GRID_DIMENSION = 100`, blocking a 10k×10k allocation. The clamp is documented with the threat it closes. **Candidates that should adopt this:** the heatmap reads themselves still need a parallel time-window clamp (F-3), but the structural pattern of "validate-and-clamp at the service boundary" is good.

- **`createMany` with `skipDuplicates`.** `analytics.gateway.ts:263` ensures replayed occupancy frames don't duplicate `OccupancyRecord` rows. The composite `(tenantId, hourBucket, cellX, cellZ)` unique on `TrafficFlowRecord` (`schema.prisma:1922`) provides parallel idempotency for the aggregation table.

- **Cross-link — KDS gateway as the gateway exemplar.** `backend/src/modules/kds/kds.gateway.ts:92-144` is the pattern analytics should adopt: pinned `algorithms: ['HS256']` (`:95`), explicit `payload.type !== 'user'` rejection (`:105-110`), tenant-and-role-scoped room joins (`:130-138`), debounced DB writes on reconnect (`:174-191`), and a `Sentry.captureException` envelope around the entire handshake (`:84-88`). Analytics gateway has the room scoping but is missing the type check (F-1), the algorithm pin (F-4), and the Sentry envelope on `handleConnection`. *(Note: `docs/reviews/kds.md` does not yet exist as of this review; once it does, this section should link to its §8.)*

---

## 9. Spot-checks performed

**Verified:**
- F-1 confirmed at `analytics.gateway.ts:106-120` — no `payload.type` branch anywhere in `handleConnection`; compared side-by-side with `kds.gateway.ts:105-110`.
- F-2 confirmed at `analytics.gateway.ts:500-525` — sequential `await this.prisma.trafficFlowRecord.upsert(...)` inside the `for (const [key, count] of cellCounts)` loop; no `Promise.all`, no batching, no cap on `cellCounts.size`.
- F-3 confirmed at `heatmap.service.ts:70-83` — `findMany` has `where: { tenantId, timestamp: { gte, lte } }` and `select: { positionX, positionZ, state }` but no `take`. Controller at `analytics.controller.ts:75-76` constructs `start`/`end` from raw `Query` strings with no upper-bound validation.
- I-2 (tenant scoping on writes) verified at `analytics.gateway.ts:244-264` (occupancy rejects on `tenantId !== payload.tenantId` then uses socket-scoped `tenantId`) and `:483-525` (traffic flow uses the same socket-scoped value).
- I-6 (`(deviceId, tenantId)` composite filter) verified at `:309, 341, 458`.

**Dropped (initial scope was wrong):**
- "Heatmap cache may leak across tenants" — verified at `heatmap.service.ts:553-561, 593-601`: the cache lookup key is `tenantId_startTime_endTime_granularity_metric`, so cross-tenant collision is structurally impossible. Drop.

**Downgraded:**
- F-1 — held at Medium (not High) because the attack requires the attacker to already possess a valid same-secret JWT from a sibling realm (marketing/superadmin). Real-world impact is "another realm's user can passively join the analytics broadcast stream"; the gateway does not accept writes from non-`edge:register`'d sockets, so there's no write-amplification path.
- F-2 — held at Medium (not High) because the upsert loop is fire-and-forget (`:267-269`) and the originating socket gets `success: true` immediately; the *gateway* doesn't block on the burst. The risk is pool starvation for other tenants' queries, not user-facing latency on this tenant.
- F-3 — held at Medium because the upstream controller is gated by `@Roles(ADMIN, MANAGER)` + `@RequiresFeature(ADVANCED_REPORTS)` (`analytics.controller.ts:62-63`), so it's an authenticated admin-only DoS — not externally exploitable.

---

## 10. Recommended tests

```ts
// backend/src/modules/analytics/__tests__/analytics.gateway.spec.ts
describe('AnalyticsGateway handshake (I-1)', () => {
  it('rejects a JWT with type="marketing" even if signature is valid', async () => {
    // arrange: sign a token with the shared JWT_SECRET, payload { sub, tenantId, type: 'marketing' }
    // act: connect to /analytics-edge with that token in handshake.auth.token
    // assert: socket.connected === false within 200ms; logger.warn called with 'unsupported token type'
  });

  it('rejects a JWT with type="superadmin"', async () => {
    // same shape, type='superadmin'
  });

  it('accepts a JWT with type="user"', async () => {
    // sign with type='user', expect joined room === `analytics-${tenantId}`
  });

  it('disconnects when client.data.tenantId is unset on a heartbeat (F-5)', async () => {
    // simulate a partially-authed socket; emit edge:heartbeat
    // assert: handler returns { success: false }, no DB updateMany fires
  });
});

describe('updateTrafficFlow burst cap (I-4)', () => {
  it('does not issue more than CAP DB upserts for a single occupancy frame', async () => {
    // arrange: spy on prisma.trafficFlowRecord.upsert
    // act: emit edge:occupancy with 2000 detections spread across 2000 unique (gridX,gridZ) cells
    // assert: upsert was called at most CAP times (e.g., 256); overflow counter incremented;
    //         logger.warn called with 'traffic-flow burst dropped' once
  });

  it('completes within bounded latency under a 1600-cell burst', async () => {
    // act: same as above but with 1600 cells (the 40×40 documented max)
    // assert: the fire-and-forget promise resolves within e.g. 2s on a dev DB
  });
});

describe('Heatmap query window cap (I-5)', () => {
  it('rejects an occupancy heatmap request with startDate > 30 days ago at HOURLY granularity', async () => {
    // arrange: GET /analytics/heatmap/occupancy?startDate=2025-01-01&endDate=2026-05-11&granularity=HOURLY
    // assert: 400 BadRequest with body containing 'window too large'
    // assert: prisma.occupancyRecord.findMany was NOT called
  });

  it('accepts a 30-day window at HOURLY', async () => {
    // assert: 200, response.gridWidth === 20, findMany called exactly once
  });

  it('caps result rows at the take limit and warns when truncated', async () => {
    // arrange: seed 1_500_000 OccupancyRecords inside the window
    // act: GET /analytics/heatmap/occupancy
    // assert: findMany's where clause includes a `take` <= 1_000_000;
    //         response includes a `truncated: true` flag in meta
  });
});

describe('Tenant isolation (I-3)', () => {
  // Follows the style from CODE_REVIEW.md §3.1.
  it('creates two tenants and asserts zero cross-reads across every analytics endpoint', async () => {
    // arrange: tenant A with 100 OccupancyRecords + 50 TrafficFlowRecords; tenant B with 0
    // act: as a tenant-B admin, hit GET /analytics/heatmap/{occupancy,traffic,dwell},
    //       /analytics/traffic-flow, /analytics/congestion, /analytics/insights, /analytics/tables, /analytics/cameras
    // assert: every response contains 0 rows / empty grid; no tenant-A id leaks in any payload field
  });
});
```
