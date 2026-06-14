# Track 1 — Backend Branch-Scope Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every confirmed cross-branch data-leak in the backend by making the leaking read/write paths filter on `branchId`, not `tenantId` alone.

**Architecture:** `BranchGuard` is a global `APP_GUARD` (auth.module.ts:52) that already resolves `req.scope = {tenantId, branchId, userId, role}` on every non-`@SkipBranchScope` route (header → JWT `activeBranchId` → `primaryBranchId`). The leaking services simply ignore the resolved `branchId`. The fix is therefore **non-breaking**: switch the leaking controller handlers to `@CurrentScope() scope: BranchScope` and the service methods from `(tenantId: string, …)` to `(scope: BranchScope, …)`, building the Prisma `where` via the canonical `branchScope(scope)` helper (`common/scoping/branch-scope.ts`). One exception (`entitlement.guard`) reads the wrong request field and is a one-line fix.

**Tech Stack:** NestJS, Prisma, Jest (`jest --maxWorkers=2`), e2e via `jest --config ./test/jest-e2e.json` + supertest.

**Scope note:** This is **Track 1A (backend)** only — the actual server-side authorization fix. The frontend half (bake `branchId` into react-query keys + invalidate cache on branch switch) is **Track 1B**, a separate plan/PR written after 1A merges, because the two are independent subsystems and the server fix is the security-critical one.

**Reference modules (the target pattern):** `orders`, `tables`, `stock` already use `@CurrentScope()` + `branchScope(scope)` correctly. Mirror them.

---

## Standard branch-scope transform (the recipe every backend task applies)

For each leaking method:

**Controller** — replace the ad-hoc tenant read with the resolved scope:

```ts
// BEFORE
import { Req } from "@nestjs/common";
listPending(@Req() req: any) {
  return this.svc.listPending(req.user.tenantId);
}

// AFTER
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";
listPending(@CurrentScope() scope: BranchScope) {
  return this.svc.listPending(scope);
}
```

**Service** — take the scope and build the where via the helper:

```ts
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";

// BEFORE
async listPending(tenantId: string) {
  return this.prisma.cashDrawerMovement.findMany({
    where: { tenantId, approvalStatus: "DRAFT" },
  });
}

// AFTER
async listPending(scope: BranchScope) {
  return this.prisma.cashDrawerMovement.findMany({
    where: { ...branchScope(scope), approvalStatus: "DRAFT" },
  });
}
```

`branchScope(scope)` returns `{ tenantId, branchId }`. For compound-WHERE update/delete guards, spread it the same way: `where: { id, ...branchScope(scope), approvalStatus: "DRAFT" }`.

**Callers:** after changing a service signature, grep for every caller (`grep -rn "\.methodName(" src`) — including gateways and other services — and update them to pass `scope`. Tests that call `svc.method('t-1', …)` become `svc.method(scope, …)` where `scope = { tenantId: 't-1', branchId: 'b-1', userId: 'u-1', role: 'MANAGER' }`.

**Unit-test assertion pattern** (matches the repo harness — `mockPrismaClient()`, direct `new Service(prisma as any)`):

```ts
const args = (prisma.model.findMany as any).mock.calls[0][0];
expect(args.where.branchId).toBe('b-1');     // the leak is closed
expect(args.where.tenantId).toBe('t-1');     // tenant scope still present
```

**Behaviour-preservation rule:** do **not** widen any route to tenant-wide. If a method genuinely needs to span branches (e.g. an explicit "all branches" admin report), that is out of scope for Track 1 — leave it and flag it; do not silently change semantics.

---

### Task 1: Fix `EntitlementGuard` branch resolution (one-line, highest confidence)

**Files:**
- Modify: `backend/src/modules/entitlements/entitlement.guard.ts:52`
- Test: `backend/src/modules/entitlements/entitlement.guard.spec.ts` (create if absent)

The guard reads `req.user?.branchId`, which the JWT strategy never sets (it sets `primaryBranchId`/`activeBranchId`/`allowedBranchIds`; `BranchGuard` writes the resolved branch to `req.scope.branchId`). Branch-scoped entitlement grants are therefore always evaluated at tenant scope.

- [ ] **Step 1: Write the failing test**

```ts
import { EntitlementGuard } from './entitlement.guard';

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('EntitlementGuard branch resolution', () => {
  it('resolves the entitlement set with req.scope.branchId, not req.user.branchId', async () => {
    const entitlements = { getForTenant: jest.fn().mockResolvedValue({ features: {}, limits: {}, integrations: {} }) };
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)            // IS_PUBLIC_KEY
        .mockReturnValueOnce(['posAccess']),   // REQUIRE_ENTITLEMENT_KEY
    };
    const guard = new EntitlementGuard(reflector as any, entitlements as any);
    const req = { user: { tenantId: 't-1' }, scope: { tenantId: 't-1', branchId: 'b-1' } };
    await guard.canActivate(ctx(req)).catch(() => undefined);
    expect(entitlements.getForTenant).toHaveBeenCalledWith('t-1', 'b-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/entitlements/entitlement.guard.spec.ts -t "branch resolution"`
Expected: FAIL — `getForTenant` called with `('t-1', null)` because the guard reads `req.user.branchId`.

- [ ] **Step 3: Implement the fix**

In `entitlement.guard.ts:52` change:
```ts
const branchId: string | null = req.user?.branchId ?? null;
```
to:
```ts
// BranchGuard resolves the active branch onto req.scope; req.user carries
// only primary/active/allowed branch ids, never a single `branchId`.
const branchId: string | null = req.scope?.branchId ?? null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/entitlements/entitlement.guard.spec.ts -t "branch resolution"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/entitlements/entitlement.guard.ts backend/src/modules/entitlements/entitlement.guard.spec.ts
git commit -m "fix(entitlements): resolve branch-scoped grants from req.scope.branchId not req.user.branchId"
```

---

### Task 2: `cash-drawer` — branch-scope reads & approvals

**Files:**
- Modify: `backend/src/modules/cash-drawer/cash-drawer.controller.ts:50-87` (listPending/findOne/approve/reject)
- Modify: `backend/src/modules/cash-drawer/cash-drawer.service.ts` (`listPending` 81, `approve` 91, `reject` 117, `findOne` 143)
- Test: `backend/src/modules/cash-drawer/cash-drawer.service.spec.ts`

Cash movements are physical, per-branch money events. `create` is already branch-scoped (`@CurrentScope`); the read/approval paths leak across branches.

- [ ] **Step 1: Write the failing test** (append to the existing describe block)

```ts
const scope = { tenantId: 't-1', branchId: 'b-1', userId: 'u-1', role: UserRole.MANAGER } as any;

it('listPending scopes by branchId (no cross-branch leak)', async () => {
  (prisma.cashDrawerMovement.findMany as any).mockResolvedValue([]);
  await svc.listPending(scope);
  const where = (prisma.cashDrawerMovement.findMany as any).mock.calls[0][0].where;
  expect(where.branchId).toBe('b-1');
  expect(where.tenantId).toBe('t-1');
});

it('approve gates the compound WHERE on branchId', async () => {
  (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({ id: 'm-1' });
  await svc.approve(scope, 'm-1', { id: 'u-1', role: UserRole.MANAGER as any });
  const where = (prisma.cashDrawerMovement.updateMany as any).mock.calls[0][0].where;
  expect(where.branchId).toBe('b-1');
});
```

Also update the two existing `approve`/`reject` 403 tests to pass `scope` instead of `'t-1'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/modules/cash-drawer/cash-drawer.service.spec.ts`
Expected: FAIL — `where.branchId` is `undefined`; the legacy `approve('t-1', …)` calls no longer typecheck/behave.

- [ ] **Step 3: Implement**

Apply the Standard transform to `listPending`, `findOne`, `approve`, `reject`:
- `listPending(scope: BranchScope)` → `where: { ...branchScope(scope), approvalStatus: "DRAFT" }`
- `findOne(scope: BranchScope, movementId)` → `where: { id: movementId, ...branchScope(scope) }`
- `approve(scope: BranchScope, movementId, approver)` → both the `updateMany` guard and the `findFirstOrThrow` get `...branchScope(scope)`
- `reject(scope: BranchScope, movementId, approver, dto)` → same

Keep `create(tenantId, branchId, userId, dto)` as-is (already correct) OR migrate it to `create(scope, dto)` for consistency (optional, low-risk). Update the controller handlers per the recipe.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/modules/cash-drawer/cash-drawer.service.spec.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/cash-drawer/
git commit -m "fix(cash-drawer): branch-scope listPending/findOne/approve/reject (close cross-branch money leak)"
```

---

### Task 3: `kds` REST path — branch-scope kitchen orders

**Files:**
- Modify: `backend/src/modules/kds/kds.controller.ts:38,55,78,90`
- Modify: `backend/src/modules/kds/kds.service.ts` (`getKitchenOrders` 33, `updateOrderStatus` 79, `payItemsPartial`/item path ~177, `cancelOrder` 251)
- Check callers: `backend/src/modules/kds/kds.gateway.ts`, any `personnel/attendance` emit paths
- Test: `backend/src/modules/kds/kds.service.spec.ts` (create if absent)

A kitchen display belongs to one branch; `getKitchenOrders(tenantId)` returns every branch's orders, and `updateOrderStatus`/`cancelOrder` can mutate any branch's order within the tenant.

- [ ] **Step 1: Write the failing test**

```ts
import { KdsService } from './kds.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('KdsService branch scope', () => {
  let prisma: MockPrismaClient;
  let svc: KdsService;
  const scope = { tenantId: 't-1', branchId: 'b-1', userId: 'u-1', role: 'COOK' } as any;
  beforeEach(() => {
    prisma = mockPrismaClient();
    // construct with the same collaborators the real module injects (gateway, stockDeduction) as light mocks
    svc = new KdsService(prisma as any, { emitOrderStatusChange: jest.fn(), emitNewOrder: jest.fn() } as any, { reverseForOrder: jest.fn() } as any);
  });

  it('getKitchenOrders filters by branchId', async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);
    await svc.getKitchenOrders(scope);
    const where = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });
});
```

(Adjust the constructor arg list to the real `KdsService` constructor — read it first.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/modules/kds/kds.service.spec.ts`
Expected: FAIL — `where.branchId` undefined.

- [ ] **Step 3: Implement**

- `getKitchenOrders(scope: BranchScope)` → `where: { ...branchScope(scope), status: { in: [...] } }`
- `updateOrderStatus(id, status, scope: BranchScope)` → lookup `where: { id, ...branchScope(scope) }` and the compound TOCTOU `updateMany` `where: { id, ...branchScope(scope), status: order.status }`
- `cancelOrder(id, scope: BranchScope)` → same compound-WHERE treatment
- item/pay path (`~177`): thread `scope` instead of `tenantId`; keep the `order: { ...branchScope(scope) }` relation filter
- Controller: replace `req.tenantId` with `@CurrentScope() scope` on all four handlers; pass `scope`.
- Update `kds.gateway.ts` and any other callers of these methods to pass a scope (the gateway already knows tenantId + branchId per socket room).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/modules/kds/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/kds/
git commit -m "fix(kds): branch-scope REST getKitchenOrders/updateOrderStatus/cancelOrder"
```

---

### Task 4: `personnel` — branch-scope all reads

**Files:**
- Modify: `backend/src/modules/personnel/services/schedule.service.ts` (`getWeeklySchedule` 13), `attendance.service.ts` (history/summary readers), `shift-swap.service.ts` (findAll), `performance.service.ts` (metrics readers)
- Modify: `backend/src/modules/personnel/controllers/*.controller.ts` (the read handlers)
- Test: `backend/src/modules/personnel/services/schedule.service.spec.ts`, `attendance.service.spec.ts`

Writes already derive `branchId` (from the shift template / user `primaryBranchId`); the **read** paths (`getWeeklySchedule`, `getTodayAttendance`, `getAttendanceHistory`, `getAttendanceSummary`, shift-swap `findAll`, performance metrics) filter by `tenantId` only, exposing every branch's scheduling/attendance to a single-branch manager.

- [ ] **Step 1: Write the failing test** (schedule)

```ts
const scope = { tenantId: 't-1', branchId: 'b-1', userId: 'u-1', role: 'MANAGER' } as any;
it('getWeeklySchedule filters by branchId', async () => {
  (prisma.shiftAssignment.findMany as any).mockResolvedValue([]);
  (prisma.shiftTemplate.findMany as any).mockResolvedValue([]);
  await svc.getWeeklySchedule(scope);
  const where = (prisma.shiftAssignment.findMany as any).mock.calls[0][0].where;
  expect(where.branchId).toBe('b-1');
});
```

Repeat the analogous assertion for `attendance.service` `getAttendanceHistory`/`getAttendanceSummary` and shift-swap `findAll`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/modules/personnel/`
Expected: FAIL — `branchId` undefined on the read where-clauses.

- [ ] **Step 3: Implement**

Apply the Standard transform to every **read** method across the four personnel services and their controller handlers. Leave the write methods (`assign`, `clockIn/Out`, `breakStart/End`, swap approvals) unchanged except for switching their signatures to `scope` for consistency where they already resolve branchId correctly. Be careful: `assign` derives `branchId` from the template — keep that; just thread `scope.tenantId` through.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/modules/personnel/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/personnel/
git commit -m "fix(personnel): branch-scope schedule/attendance/swap/performance reads"
```

---

### Task 5: `z-reports` — branch-scope fiscal aggregation

**Files:**
- Modify: `backend/src/modules/z-reports/z-reports.service.ts` (`generateReport` aggregation queries: orders, payments, cashDrawerMovement, cancelledOrders, openOrders)
- Modify: `backend/src/modules/z-reports/z-reports.controller.ts` (use `@CurrentScope` consistently; `findAll`/`findOne` already tenant-wide list — scope to branch)
- Test: `backend/src/modules/z-reports/z-reports.service.spec.ts`

The report row is written with a non-null `branchId`, but every aggregation query filters only on `tenantId` + day bounds, so a multi-branch tenant generates N identical reports each summing **all** branches' money — per-branch fiscal/cash totals are wrong.

- [ ] **Step 1: Write the failing test**

```ts
it('generateReport aggregates orders scoped to the report branch', async () => {
  // arrange the minimal mocks generateReport needs, then:
  await svc.generateReport(scope, /* dto */);
  const orderWhere = (prisma.order.aggregate as any).mock.calls[0][0].where; // or findMany, match impl
  expect(orderWhere.branchId).toBe('b-1');
});
```

(Read `generateReport` first to mirror its exact Prisma calls/shapes.)

- [ ] **Step 2: Run to verify it fails** — `npx jest src/modules/z-reports/` → FAIL (branchId absent in aggregation where).

- [ ] **Step 3: Implement** — add `...branchScope(scope)` (or `branchId: scope.branchId`) to every aggregation `where`. Ensure `findAll`/`findOne` read paths scope by branch and pull scope from `@CurrentScope()` consistently (the controller currently mixes `req.user.tenantId` and `@CurrentScope`).

- [ ] **Step 4: Run to verify it passes** — `npx jest src/modules/z-reports/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/z-reports/
git commit -m "fix(z-reports): branch-scope fiscal aggregation (correct per-branch Z totals)"
```

---

### Task 6: `fiscal-core` — persist & scope `branchId`

**Files:**
- Modify: `backend/src/modules/fiscal-core/fiscal.service.ts` (`issueReceipt` persist `branchId`; `listPending`/`cancel`/`retryFailed` scope by branch)
- Possibly migration: confirm `fiscal_receipt` has a `branchId` column; if not, add a Prisma migration (follow the repo's hand-written-migration workflow).
- Test: `backend/src/modules/fiscal-core/fiscal.service.spec.ts`

`FiscalReceiptRequest` carries `branchId` but it is never persisted on `fiscal_receipt` nor used in any where-clause; all scoping is tenant-only.

- [ ] **Step 1: Write the failing test** — assert `issueReceipt` writes `data.branchId` and `listPending(scope)` filters `where.branchId`.
- [ ] **Step 2: Run to verify it fails** — `npx jest src/modules/fiscal-core/` → FAIL.
- [ ] **Step 3: Implement** — persist `branchId` from the request on create; add `...branchScope(scope)` to `listPending`/`cancel`/`retryFailed`. If the column is missing, add it via a hand-written `migration.sql` + `prisma generate` per the project's migration workflow, defaulting existing rows by joining their device's branch (or NULL-backfill + note).
- [ ] **Step 4: Run to verify it passes** — `npx jest src/modules/fiscal-core/` → PASS.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/fiscal-core/ backend/prisma/
git commit -m "fix(fiscal-core): persist and branch-scope fiscal receipts"
```

---

### Task 7: `analytics` — branch-scope heatmap data fetch + cache key integrity

**Files:**
- Modify: `backend/src/modules/analytics/services/heatmap.service.ts` (`getOccupancyHeatmap`, `getTrafficHeatmap`, `getDwellTime`, `getCongestion`, `getTrafficFlowPaths`), `table-analytics.service.ts`, `insights.service.ts`
- Test: `backend/src/modules/analytics/services/heatmap.service.spec.ts`

The heatmap queries filter by `tenantId` only; `branchId` is used **only** in the cache key. A branch-A manager sees all branches' aggregated occupancy/traffic, and that cross-branch result is then cached under branch A's key — poisoning it.

- [ ] **Step 1: Write the failing test** — for each heatmap method, assert the underlying `findMany` where includes `branchId`.
- [ ] **Step 2: Run to verify it fails** — `npx jest src/modules/analytics/` → FAIL.
- [ ] **Step 3: Implement** — add `branchId: scope.branchId` to every heatmap/table-analytics/insights data `where`. (Cache key already includes branchId — once the data is correctly scoped, the cache is consistent.) Fix the `getTrafficFlowPaths` N+1 only if trivial; otherwise leave for Track 5 and note it.
- [ ] **Step 4: Run to verify it passes** — `npx jest src/modules/analytics/` → PASS.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/analytics/
git commit -m "fix(analytics): branch-scope heatmap/table-analytics/insights data fetch"
```

---

### Task 8: `reservations` — branch-scope public availability reads

**Files:**
- Modify: `backend/src/modules/reservations/services/reservations.service.ts` (`getAvailableTables`, `getAvailableSlots`, `lookupReservation`) and `controllers/public-reservations.controller.ts`
- Test: `backend/src/modules/reservations/services/reservations.service.spec.ts`

Public availability reads scope by `tenantId` only, so a multi-branch tenant exposes every branch's tables/slots to anonymous callers. **Caveat:** public routes are `@SkipBranchScope` (no `req.scope`), so branch must come from the request (a `branchId`/subdomain path param), not `@CurrentScope`. Resolve the branch explicitly and validate it belongs to the tenant.

- [ ] **Step 1: Write the failing test** — assert `getAvailableTables({ tenantId, branchId })` filters `where.branchId` and rejects a `branchId` from another tenant.
- [ ] **Step 2: Run to verify it fails** — `npx jest src/modules/reservations/` → FAIL.
- [ ] **Step 3: Implement** — add a required/resolved `branchId` to the public availability DTOs/path, validate `branch.tenantId === tenantId`, and add `branchId` to the where-clauses. If a public caller has no branch context, pick the deterministic default branch and document it (do not fan across all branches). Align the read-path `parseLocalDate` timezone handling with the write path while here.
- [ ] **Step 4: Run to verify it passes** — `npx jest src/modules/reservations/` → PASS.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reservations/
git commit -m "fix(reservations): branch-scope public availability + lookup reads"
```

---

### Task 9: Cross-branch isolation E2E (capstone)

**Files:**
- Create: `backend/test/branch-isolation.e2e-spec.ts` (model bootstrap on `backend/test/orders.e2e-spec.ts`)
- Run: `npm run test:e2e`

Prove the leaks are closed end-to-end over HTTP, not just at the where-clause level.

- [ ] **Step 1: Write the failing-then-passing e2e**

Mirror `orders.e2e-spec.ts` bootstrap: seed one tenant with **two branches** (`b-1`, `b-2`) and a MANAGER pinned to each. Mint a token per manager (send `X-Branch-Id` accordingly). Then assert isolation for each fixed module:

```ts
// Manager-A (branch b-1) must NOT see branch b-2's data.
it('cash-drawer: branch A cannot list branch B pending movements', async () => {
  // create a DRAFT movement in b-2 (as manager-B)
  // GET /cash-drawer/movements/pending as manager-A
  // expect the b-2 movement id is absent from the response
});
it('kds: branch A kitchen feed excludes branch B orders', async () => { /* … */ });
it('personnel: branch A weekly schedule excludes branch B assignments', async () => { /* … */ });
it('kds: manager-A cannot PATCH a branch-B order status', async () => {
  // expect 404/403, and the order is unchanged
});
```

- [ ] **Step 2: Run to verify it fails on `test` baseline / passes after Tasks 2-8**

Run: `npm run test:e2e -- branch-isolation`
Expected: PASS once Tasks 2–8 are merged in the branch (run against the working branch, not `test`).

- [ ] **Step 3: Commit**

```bash
git add backend/test/branch-isolation.e2e-spec.ts
git commit -m "test(e2e): cross-branch isolation across cash-drawer/kds/personnel"
```

---

## Final verification

- [ ] Run the full backend unit suite: `cd backend && npm test` → all green.
- [ ] Run e2e: `cd backend && npm run test:e2e` → all green.
- [ ] `grep -rn "req.user.tenantId\|req.tenantId" src/modules/{kds,cash-drawer,personnel,z-reports,analytics,fiscal-core}` → no remaining tenant-only reads on the fixed paths.
- [ ] Typecheck: `cd backend && npx tsc --noEmit` → clean.
- [ ] Open PR `test` ← `fix/track1-branch-scope`; after merge to `main`, cut the next `vX.Y.Z` tag per the release workflow.

## Self-review notes
- **Spec coverage:** Tasks 1–8 map 1:1 to the eight confirmed leaks in the audit (entitlement guard, cash-drawer, kds, personnel, z-reports, fiscal-core, analytics, reservations). Task 9 is the E2E proof. ✅
- **Behaviour preservation:** no route is widened to tenant-wide; `branchId` was already resolved by the global `BranchGuard`, so single-branch tenants are unaffected. ✅
- **Out of scope (flag, don't fix here):** god-file splits (Track 5), analytics N+1 (Track 5), reservations timezone-only-if-trivial, frontend query-key/cache (Track 1B).
