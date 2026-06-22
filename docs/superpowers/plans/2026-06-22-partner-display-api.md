# Partner Display API (Remote-Screen Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let third-party apps/screens (a partner's table tablet) do what the QR-code menu does — browse menu, order, self-pay, call waiter/bill, watch status live — via a tenant-issued API key → HMAC-minted per-screen scoped token, gated by a new plan feature.

**Architecture:** A thin authenticated layer over existing services. `PartnerApiKey` (tenant-issued, ADMIN, plan-gated) → partner backend HMAC-signs a request to mint a `ScreenSession` (opaque token + rotating refresh, bound to tenant+branch+table, scoped). Each `ScreenSession` **backs a real `CustomerSession`** (`orderingSessionId`, 64-hex) so the unchanged `customer-orders`/`self-pay`/`qr-menu` services and the existing `customer-session-<id>` realtime room are reused verbatim. New `@MachineAuth()` metadata makes the global guard chain step aside for `PartnerKeyGuard`/`ScreenTokenGuard`.

**Tech Stack:** NestJS 10, Prisma/PostgreSQL, Socket.IO (+Redis adapter), @nestjs/throttler v6, node:crypto, Jest (+ real-DB e2e CI gate), React (ADMIN UI).

**Design spec:** `docs/superpowers/specs/2026-06-22-partner-display-api-design.md`

---

## Conventions & invariants (read before any task)

- Global prefix `/api`. New routes live under `/api/v1/...`.
- **Crypto (verbatim):** `import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"; import { v7 as uuidv7 } from "uuid";` Token = `uuidv7() + "." + randomBytes(24).toString("base64url")`. Hash at rest = `createHash("sha256").update(raw).digest("hex")`. Always **look up by hash**, never by raw.
- **HMAC verify:** reuse `verifyHmacHex(expectedHex, providedHex)` from `backend/src/modules/integration-gateway/sig-verify.ts:25` (do NOT re-roll; do NOT copy `WebhookOutboundService.verify`).
- **Revoke is IDOR-safe:** single compound `updateMany({ where:{ id, tenantId }, data:{ status:"revoked", revokedAt: new Date() }})` then `if (count===0) throw NotFoundException`. Never read-then-check.
- **List endpoints** use an explicit `select` allowlist that OMITS `*Hash` (device.service.list pattern), never the webhook full-row spread.
- **Prisma migrations are hand-written** (`migrate dev`/`db push` broken locally): write `migration.sql` with additive `NOT NULL DEFAULT`, then `cd backend && npx prisma generate`, then `tsc`/`jest`. Migration dir `<YYYYMMDDHHMMSS>_snake_name`, timestamp strictly > `20260621120000`.
- **eslint + prettier every new/touched file before commit** (strict CI gate). TDD: failing test → minimal impl → green → commit. Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT touch staff-side `BranchScope` ack/complete paths.

---

## File Structure

**New (backend):**
- `backend/src/modules/auth/decorators/machine-auth.decorator.ts` — `@MachineAuth()` metadata.
- `backend/src/modules/partner/partner.module.ts`
- `backend/src/modules/partner/dto/{create-api-key.dto.ts,mint-screen-session.dto.ts,refresh-screen-session.dto.ts,create-display-order.dto.ts,create-display-request.dto.ts,create-display-pay-intent.dto.ts}`
- `backend/src/modules/partner/partner-api-key.service.ts` — issue/list/revoke keys.
- `backend/src/modules/partner/screen-session.service.ts` — mint/refresh/revoke screen tokens + backing CustomerSession.
- `backend/src/modules/partner/guards/partner-key.guard.ts` — HMAC + feature gate; sets `req.partnerKey`, `req.machinePrincipalId`.
- `backend/src/modules/partner/guards/screen-token.guard.ts` — token lookup; sets `req.screen`, `req.machinePrincipalId`.
- `backend/src/modules/partner/decorators/{require-scope.decorator.ts}` + `guards/screen-scope.guard.ts`.
- `backend/src/modules/partner/controllers/{partner-api-keys.controller.ts,partner-screen-sessions.controller.ts,display.controller.ts}`
- `backend/src/common/guards/machine-throttler.guard.ts` — per-principal throttle tracker.
- `backend/test/partner-display.e2e-spec.ts` — real-DB e2e.

**Modified (backend):** `guard-bypass.helper.ts` (+1 clause); `subscription.enum.ts`, `schema.prisma`, `plan-projector.service.ts`, `effective-features.fold.ts`, and the full EXTERNAL_DISPLAY mirror set (Phase 0); `kds.gateway.ts` (+`tryScreenAuth`); `customer-orders.service.ts:281` (arity fix); `self-pay-webhook.service.ts` (settlement emit + DI); `qr-menu` query (branch-aware helper); `app.module.ts` (throttler subclass); `customer-session.service.ts` (+`createForScreen`/extend helper).

**New (frontend):** `frontend/src/features/partner-keys/{partnerKeysApi.ts,PartnerKeysPage.tsx}` + Settings route + i18n keys (5 locales).

---

## PHASE 0 — `EXTERNAL_DISPLAY` plan feature (foundational; gates everything)

Mirrors `apiAccess` exactly. The 3-place sync PLUS the wider mirror set (card-verified). Camel value `"externalDisplay"`; engine key `feature.externalDisplay`; enum member `EXTERNAL_DISPLAY`.

### Task 0.1: Add the enum + schema column + migration

**Files:** Modify `backend/src/common/constants/subscription.enum.ts:70`; `backend/prisma/schema.prisma:980`; Create `backend/prisma/migrations/20260622HHMMSS_add_external_display_feature/migration.sql`.

- [ ] **Step 1:** In `subscription.enum.ts` `PlanFeature` enum add after `API_ACCESS = "apiAccess",`:
```ts
  EXTERNAL_DISPLAY = "externalDisplay",
```
- [ ] **Step 2:** In `schema.prisma` `SubscriptionPlan` feature-flag block (after `apiAccess`):
```prisma
  externalDisplay     Boolean @default(false)
```
- [ ] **Step 3:** Write `migration.sql` (mirror `20260602100000_v3_plan_pos_and_branch_limits`):
```sql
ALTER TABLE "subscription_plans" ADD COLUMN "externalDisplay" BOOLEAN NOT NULL DEFAULT false;
UPDATE "subscription_plans" SET "externalDisplay" = true WHERE "name" IN ('TRIAL','BUSINESS');
```
- [ ] **Step 4:** `cd backend && npx prisma generate` — Expected: regenerates client with `externalDisplay` on `SubscriptionPlan`.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(plans): add externalDisplay feature column + migration"`.

### Task 0.2: Wire the projector + fallback fold (3-place sync places 2 & 3) + drift tests

**Files:** Modify `plan-projector.service.ts:43-59`; `plan-projector.service.spec.ts:258-273`; `effective-features.fold.ts` (interface ~18 + features map ~55); `effective-features.fold.spec.ts:3-21`.

- [ ] **Step 1:** Add `"externalDisplay",` to `FEATURE_COLUMNS`.
- [ ] **Step 2:** Add `'externalDisplay',` to `EXPECTED_FEATURES` in the projector spec (drift tripwire — fails CI otherwise).
- [ ] **Step 3:** In `effective-features.fold.ts`: add `externalDisplay: boolean;` to `PlanGrantSource` and `externalDisplay: plan.externalDisplay,` to the `features` map.
- [ ] **Step 4:** Add `externalDisplay: false,` to the `PLAN` fixture in `effective-features.fold.spec.ts`.
- [ ] **Step 5:** Run: `cd backend && npx jest plan-projector.service.spec effective-features.fold.spec` — Expected: PASS.
- [ ] **Step 6:** Commit.

### Task 0.3: Mirror through every plan-feature surface (compile-driven)

**Files (each add an `externalDisplay` line mirroring `apiAccess`):** `subscription-plans.const.ts` (interface + every plan literal); `auth-provisioning.service.ts:112-139`; `superadmin-tenants.service.ts` (union ~24, FEATURE_KEYS ~36, pick ~554); `update-tenant-overrides.dto.ts:30-33`; `subscription-filter.dto.ts:156-159`; `superadmin-subscriptions.service.ts` (create ~114, update ~181); `subscription-response.dto.ts:61-72`; `subscription.service.ts:1249-1260`; `demo.service.ts:41-53` (`true`); `prisma/seed.ts` (8 spots); `prisma/seed-demo.ts:119` (`true`); `feature-plan-matrix.spec.ts:46-64`.

- [ ] **Step 1:** Make all edits above (default `false` per plan except TRIAL/BUSINESS/demo `true`; PATCH-update uses `updateDto.externalDisplay`, create uses `?? false`). The `auth-provisioning` seed is mandatory (omitting it reproduces the v3.0.7 `posAccess`-hidden bug).
- [ ] **Step 2:** Run: `cd backend && npx tsc --noEmit` — Expected: no errors (TS forces the field everywhere `PlanGrantSource`/`PlanConfig.features` is used).
- [ ] **Step 3:** Run: `cd backend && npx jest subscription superadmin entitlements auth-provisioning feature-plan-matrix` — fix any fixture compile/assert failures by adding `externalDisplay`.
- [ ] **Step 4:** Commit: `feat(plans): mirror externalDisplay across plan-feature surfaces`.

---

## PHASE 1 — Data model: `PartnerApiKey` + `ScreenSession`

### Task 1.1: Add Prisma models + migration

**Files:** Modify `backend/prisma/schema.prisma`; Create `backend/prisma/migrations/20260622HHMMSS_partner_display_tables/migration.sql`.

- [ ] **Step 1:** Add models (mirror `TenantWebhookSubscription` + `Device`):
```prisma
model PartnerApiKey {
  id                   String    @id @default(cuid())
  tenantId             String
  tenant               Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  keyId                String    @unique           // public id, e.g. pk_live_xxx
  secretHash           String                       // sha256(secret), never the raw
  name                 String
  scopes               String[]  @default([])
  allowedReturnOrigins String[]  @default([])
  allowedBranchIds     String[]  @default([])
  status               String    @default("active") // active | revoked
  lastUsedAt           DateTime?
  createdBy            String?
  createdAt            DateTime  @default(now())
  revokedAt            DateTime?
  screenSessions       ScreenSession[]
  @@index([tenantId, status])
  @@index([secretHash])
  @@map("partner_api_keys")
}

model ScreenSession {
  id                 String        @id @default(cuid())
  tenantId           String
  branchId           String
  tableId            String?
  partnerApiKeyId    String
  partnerApiKey      PartnerApiKey @relation(fields: [partnerApiKeyId], references: [id], onDelete: Cascade)
  orderingSessionId  String        @unique          // 64-hex; == backing CustomerSession.sessionId & Order.sessionId
  scopes             String[]      @default([])
  tokenHash          String        @unique
  refreshTokenHash   String        @unique
  tokenExpiresAt     DateTime
  refreshExpiresAt   DateTime
  status             String        @default("active") // active | revoked
  lastSeenAt         DateTime?
  createdAt          DateTime      @default(now())
  revokedAt          DateTime?
  @@index([tenantId, branchId, status])
  @@index([tokenHash])
  @@index([partnerApiKeyId])
  @@map("screen_sessions")
}
```
Add the back-relations `partnerApiKeys PartnerApiKey[]` (Tenant model is already huge; add the field where other tenant relations live).
- [ ] **Step 2:** Hand-write `migration.sql` — `CREATE TABLE "partner_api_keys" (...)` and `"screen_sessions" (...)` with the columns/defaults/indexes above (text[] columns default `'{}'`, FKs to `tenants`/`partner_api_keys` with `ON DELETE CASCADE`). Model exact column types on the generated SQL of `tenant_webhook_subscriptions` + `devices`.
- [ ] **Step 3:** `cd backend && npx prisma generate`.
- [ ] **Step 4:** Run: `npx tsc --noEmit` — Expected: clean.
- [ ] **Step 5:** Commit: `feat(partner): add PartnerApiKey + ScreenSession models`.

---

## PHASE 2 — Machine auth primitives

### Task 2.1: `@MachineAuth()` + one-line bypass

**Files:** Create `machine-auth.decorator.ts`; Modify `guard-bypass.helper.ts`.

- [ ] **Step 1:** Create decorator (mirror `public.decorator.ts` verbatim):
```ts
import { SetMetadata } from "@nestjs/common";
export const IS_MACHINE_AUTH_KEY = "isMachineAuth";
export const MachineAuth = () => SetMetadata(IS_MACHINE_AUTH_KEY, true);
```
- [ ] **Step 2:** In `guard-bypass.helper.ts` import `IS_MACHINE_AUTH_KEY` and add inside the `return (...)`:
```ts
    || !!reflector.getAllAndOverride<boolean>(IS_MACHINE_AUTH_KEY, targets)
```
This makes Jwt/Roles/Tenant/Branch all step aside (all four consume this helper). **Note:** `SubscriptionStatusGuard` and `PlanFeatureGuard` do NOT use the helper — they no-op when `req.user.tenantId` is absent, which machine routes leave unset, so they fly through. We enforce the feature gate inside `PartnerKeyGuard` instead.
- [ ] **Step 3:** Test `backend/src/common/helpers/guard-bypass.helper.spec.ts`: assert `shouldBypassGlobalAuth` returns true when a handler carries `IS_MACHINE_AUTH_KEY`. Run: `npx jest guard-bypass` — PASS.
- [ ] **Step 4:** Commit.

### Task 2.2: `MachineThrottlerGuard` (per-principal rate limit)

**Files:** Create `backend/src/common/guards/machine-throttler.guard.ts`; Modify `app.module.ts:175-178`.

- [ ] **Step 1:** Subclass (throttler runs BEFORE guards, so parse principal from the raw header):
```ts
import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class MachineThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const auth: string | undefined = req.headers?.authorization;
    if (auth?.startsWith("Screen ")) {
      return `screen:${auth.slice(7).split(".")[0]}`; // uuidv7 prefix — stable, non-secret
    }
    const partnerKey: string | undefined = req.headers?.["x-partner-key"];
    if (partnerKey) return `pk:${partnerKey}`;
    return req.ips?.length ? req.ips[0] : req.ip;
  }
}
```
- [ ] **Step 2:** In `app.module.ts` change `useClass: ThrottlerGuard` → `useClass: MachineThrottlerGuard` (keep the 3-tier `forRoot`). Import the new guard.
- [ ] **Step 3:** Test `machine-throttler.guard.spec.ts`: instantiate, call `getTracker` with a `Screen <uuid>.xxx` header → `screen:<uuid>`; with `x-partner-key` → `pk:...`; with neither → ip. Run `npx jest machine-throttler` — PASS.
- [ ] **Step 4:** Commit.

---

## PHASE 3 — `PartnerApiKey` service + ADMIN controller

### Task 3.1: `PartnerApiKeyService`

**Files:** Create `partner-api-key.service.ts`; Test `partner-api-key.service.spec.ts`.

- [ ] **Step 1 (test first):** spec asserts: `issue()` returns `{ ...row, secret }` with `secret` matching `^pk_live_secret_`, stores only `secretHash = sha256(secret)`, enforces cap; `authenticate(keyId, secret)` returns the row when sha256 matches + status active else null; `revoke(tenantId,id)` flips status+cascades (deletes child screen sessions) and `count===0 → NotFound`.
- [ ] **Step 2 (impl):** Clone webhook-outbound `subscribe`/`revoke` + device select-safe `list`. Key shape: public id `keyId = "pk_live_" + randomBytes(9).toString("base64url")`; raw secret `secret = "pk_live_secret_" + randomBytes(24).toString("base64url")`; `secretHash = createHash("sha256").update(secret).digest("hex")` (no KMS — auth-only, raw never re-derived). Cap const `PARTNER_API_KEY_CAP_PER_TENANT = Math.max(1, Number(process.env.PARTNER_API_KEY_CAP_PER_TENANT ?? "10"))`. `authenticate(keyId, rawSecret)`: `findFirst({ where: { keyId, status:"active" } })` → null-check → `timingSafeEqual` of `sha256(rawSecret)` vs stored `secretHash` (hex, equal-length) → fire-and-forget `lastUsedAt` touch → return row. `revoke`: compound `updateMany({where:{id,tenantId},data:{status:"revoked",revokedAt:new Date()}})` then `screenSession.updateMany({where:{partnerApiKeyId:id},data:{status:"revoked",revokedAt:new Date()}})`; `count===0 → NotFoundException`. `list(tenantId)`: explicit `select` omitting `secretHash`. Emit `partner_api_key.created.v1` / `.revoked.v1` via `outbox.append(...).catch(captureSwallowedEmit(...))`.
- [ ] **Step 3:** Run `npx jest partner-api-key.service` — PASS.
- [ ] **Step 4:** Commit.

### Task 3.2: ADMIN management controller + DTO

**Files:** Create `partner-api-keys.controller.ts`, `dto/create-api-key.dto.ts`; partial `partner.module.ts`.

- [ ] **Step 1:** DTO: `name: string (@IsString @Length(1,80))`, `scopes?: string[] (@IsArray @IsIn(SCOPES,{each:true}))`, `allowedReturnOrigins?: string[] (@IsUrl({},{each:true}))`, `allowedBranchIds?: string[] (@IsUUID(undefined,{each:true}))`. Define `export const SCOPES = ["menu:read","orders:write","orders:read","payments:write","requests:write","realtime:subscribe"] as const;`.
- [ ] **Step 2:** Controller — clone `webhooks-outbound.controller.ts` verbatim (ADMIN + `PlanFeatureGuard` + `@RequiresFeature(PlanFeature.EXTERNAL_DISPLAY)` + `@SkipBranchScope`), `@Controller("v1/partner/api-keys")`: `GET` list, `POST` issue (secret once), `DELETE :id` revoke. All scope by `req.user.tenantId`.
- [ ] **Step 3:** Add `/v1/partner` to the frontend `TENANT_WIDE_PATH_PREFIXES` mirror (`frontend/src/lib/api.ts`) so the SPA omits `X-Branch-Id`.
- [ ] **Step 4:** Test `partner-api-keys.e2e` slice OR unit the controller wiring; full chain covered in Phase 9. Commit.

---

## PHASE 4 — `ScreenSession` mint/refresh (HMAC machine path)

### Task 4.1: backing-session helper on `CustomerSessionService`

**Files:** Modify `customer-session.service.ts`.

- [ ] **Step 1 (test):** `createForScreen(tenantId, tableId?, ttlMs)` returns a `{ sessionId(64-hex), expiresAt }` like `createSession`, and `extendSession(sessionId, newExpiresAt)` bumps `expiresAt` (used on screen refresh).
- [ ] **Step 2 (impl):** `createForScreen` = same body as `createSession` but `expiresAt = new Date(Date.now()+ttlMs)` (screen-controlled, not the 4h default) — reuse `randomBytes(32).toString("hex")`. `extendSession` = `updateMany({where:{sessionId,isActive:true},data:{expiresAt}})`.
- [ ] **Step 3:** `npx jest customer-session.service` — PASS. Commit.

### Task 4.2: `ScreenSessionService`

**Files:** Create `screen-session.service.ts`; Test `screen-session.service.spec.ts`.

- [ ] **Step 1 (test):** `mint(partnerKey, { branchId, tableId?, scopes? })` validates branch ∈ key.allowedBranchIds (if set) + belongs to tenant, validates table ∈ branch (if given), requested scopes ⊆ key.scopes, creates a backing CustomerSession via `createForScreen`, returns `{ screenToken, refreshToken, expiresAt, scopes, tenantId, branchId, tableId, orderingSessionId }` (raw tokens once). `authenticate(rawToken)` returns the active, unexpired row else null. `refresh(partnerKey, rawRefresh)` rotates both tokens atomically (updateMany keyed on old refreshTokenHash + not-expired → count===0 guard), extends backing CustomerSession. `revoke(tenantId,id)` IDOR-safe.
- [ ] **Step 2 (impl):** token gen `newToken()`/hash `hashToken()` cloned from device.service. TTLs via `numericEnv(config?.get("SCREEN_TOKEN_TTL_MS"), 3600_000)` and `numericEnv(config?.get("SCREEN_REFRESH_TTL_MS"), 30*86400_000)`. Cap `SCREEN_SESSION_CAP_PER_BRANCH` (count active per (tenantId,branchId)). On mint: create backing CustomerSession (`createForScreen(partnerKey.tenantId, tableId, refreshTtlMs)`) then `screenSession.create({ data: { tenantId, branchId, tableId, partnerApiKeyId: partnerKey.id, orderingSessionId, scopes, tokenHash, refreshTokenHash, tokenExpiresAt, refreshExpiresAt }})`. `authenticate`: `findFirst({where:{tokenHash, status:"active"}})` → expiry check → null/return. `refresh`: rotate + `extendSession(orderingSessionId, new refreshExpiresAt)` + return new pair. Emit `screen_session.issued.v1`/`.refreshed.v1`/`.revoked.v1`.
- [ ] **Step 3:** `npx jest screen-session.service` — PASS. Commit.

### Task 4.3: `PartnerKeyGuard` + screen-sessions controller

**Files:** Create `guards/partner-key.guard.ts`, `controllers/partner-screen-sessions.controller.ts`, `dto/{mint,refresh}-screen-session.dto.ts`.

- [ ] **Step 1 (test guard):** valid HMAC over `${ts}\n${method}\n${path}\n${sha256(body)}` with active key + feature enabled → `req.partnerKey` set + true; bad sig / stale ts (>±300s) / revoked key / feature disabled → Unauthorized/Forbidden.
- [ ] **Step 2 (impl guard):** read `x-partner-key`, `x-partner-timestamp`, `x-partner-signature`; `authenticate(keyId)`-style lookup of the key row; recompute `createHmac("sha256", <rawSecret?>)` — **but we store only the hash**, so signing uses the secret the partner holds and we must verify HMAC with the stored secret → we DON'T have the raw secret. **Resolution:** sign with `keyId`+secret where the server recomputes using the secret — since we only keep `secretHash`, switch the scheme to **HMAC keyed by the raw secret, verified by recomputing with the secret we DO NOT store**. Therefore store the secret **encrypted at rest** (KMS, like webhook `secretEnc`) so the guard can unseal it to verify HMAC. Update Task 1.1/3.1: `PartnerApiKey` gains `secretEnc Bytes` (KMS) in addition to `secretHash` (fast lookup is by `keyId`, not secret). Guard: load key by `keyId` → `unsealSecret(secretEnc)` → `expected = createHmac("sha256", secret).update(`${ts}\n${method}\n${path}\n${sha256(rawBody)}`).digest("hex")` → `verifyHmacHex(expected, providedSig)` → timestamp window → `entitlements.getForTenant(tenantId,null).features["feature.externalDisplay"]===true` else Forbidden → set `req.partnerKey`, `req.machinePrincipalId="pk:"+keyId`.
- [ ] **Step 3 (controller):** `@MachineAuth() @UseGuards(PartnerKeyGuard) @Controller("v1/partner/screen-sessions")`: `POST /` mint, `POST /refresh` refresh, `DELETE /:id` revoke. `@Throttle` machine-appropriate limits.
- [ ] **Step 4:** `npx jest partner-key.guard` — PASS. Commit.

> **Note for executor:** Task 4.3 Step 2 supersedes the "no KMS" note in Task 3.1 — request signing requires the server to recompute HMAC, so the secret MUST be recoverable (KMS-sealed `secretEnc`), exactly like `webhook-outbound`. Clone its `unsealSecret`/KMS usage. `secretHash` is kept only for the (optional) bearer-style `authenticate(keyId,secret)` fast path; the canonical partner auth is HMAC-signed.

---

## PHASE 5 — Display API (thin adapters over existing services)

### Task 5.1: `ScreenTokenGuard` + `@RequireScope` + scope guard

**Files:** Create `guards/screen-token.guard.ts`, `decorators/require-scope.decorator.ts`, `guards/screen-scope.guard.ts`.

- [ ] **Step 1 (test):** `Authorization: Screen <token>` valid+active → `req.screen={id,tenantId,branchId,tableId,scopes,orderingSessionId}`; expired/revoked/wrong-scheme → Unauthorized. `@RequireScope("orders:write")` + `ScreenScopeGuard`: 403 when `req.screen.scopes` lacks it.
- [ ] **Step 2 (impl):** mirror `DeviceTokenGuard` (`scheme!=="Screen" → Unauthorized`), call `screenSessionService.authenticate(token)`, set `req.screen` + `req.machinePrincipalId`. `RequireScope` = `SetMetadata("requiredScope", scope)`; guard reads it + `req.screen.scopes`.
- [ ] **Step 3:** `npx jest screen-token.guard screen-scope.guard` — PASS. Commit.

### Task 5.2: Branch-aware menu helper

**Files:** Modify `qr-menu` query into a shared service method `getPublicMenu(tenantId, { tableId?, branchId? })`; reuse from both the existing `qr-menu.controller` and display.

- [ ] **Step 1 (test):** menu for a tenant filters category/product availability and, when `branchId` given, respects per-branch availability if such overrides exist (else identical to tenant-wide). Keep response shape identical.
- [ ] **Step 2 (impl):** extract the inline query from `qr-menu.controller.ts:getPublicMenu` into `MenuQueryService.getPublicMenu` (no behavior change), add an optional `branchId` filter only where branch-scoped availability columns exist; controller delegates. (If no per-branch availability exists yet, `branchId` is accepted but a no-op — documented.)
- [ ] **Step 3:** `npx jest qr-menu menu` — PASS. Commit.

### Task 5.3: `DisplayController` (orders/requests/self-pay/menu) + DTOs

**Files:** Create `controllers/display.controller.ts`, `dto/create-display-{order,request,pay-intent}.dto.ts`.

- [ ] **Step 1:** DTOs carry NO sessionId (server supplies `req.screen.orderingSessionId`). `CreateDisplayOrderDto`: `items[]` (reuse the item shape from `CreateCustomerOrderDto`), `notes?`, `type?`. `CreateDisplayRequestDto`: `{ message? }`. `CreateDisplayPayIntentDto`: `{ items:[{orderItemId,quantity}], customerPhone? }`.
- [ ] **Step 2:** Controller `@MachineAuth() @UseGuards(ScreenTokenGuard, ScreenScopeGuard) @Controller("v1/display")`. Each handler builds the existing service DTO from `req.screen` and calls the unchanged service:
  - `GET /menu` (`menu:read`) → `MenuQueryService.getPublicMenu(req.screen.tenantId,{tableId:req.screen.tableId, branchId:req.screen.branchId})`.
  - `POST /orders` (`orders:write`, `Idempotency-Key` header honored) → construct `CreateCustomerOrderDto { sessionId: req.screen.orderingSessionId, tableId: req.screen.tableId, items, type, latitude/longitude: <branch/tenant coords> }` → `customerOrdersService.createOrder(dto)`. **Geofence:** fetch `tenant.{latitude,longitude}` once; if set, pass them as the order coords so the venue-installed screen passes the existing geofence with no service change.
  - `GET /orders` (`orders:read`) → `customerOrdersService.getSessionOrders(req.screen.orderingSessionId)`.
  - `POST /waiter-requests` / `/bill-requests` (`requests:write`) → build `CreateWaiterRequestDto/CreateBillRequestDto { sessionId: orderingSessionId, tableId: req.screen.tableId, message }` → existing service (requires tableId — 400 if screen is tableless; documented).
  - `GET /payable-items` (`payments:write`) → `selfPayQueryService.getPayableItemsForSession(orderingSessionId)`.
  - `POST /pay-intent` (`payments:write`) → `selfPayIntentService.createPayIntent(orderingSessionId, dto, req.ip, <returnOrigin from partnerKey.allowedReturnOrigins[0]>)`. Resolve the partner key via `req.screen.partnerApiKeyId` to read `allowedReturnOrigins`.
  - `GET /pay-status` (`payments:write`) → `selfPayQueryService.getPayStatus(orderingSessionId, oid)`.
- [ ] **Step 3:** `@Throttle` per-scope tiers. Register everything in `partner.module.ts` (import `CustomerOrdersModule`, `MenuModule`, `EntitlementsModule`(global), `KdsModule`, `SubscriptionsModule`). Add `PartnerModule` to `AppModule`.
- [ ] **Step 4:** `npx tsc --noEmit` clean. Commit.

---

## PHASE 6 — Realtime (reuse customer room) + the two bug fixes

### Task 6.1: Fix arity bug (`emitNewOrderWithCustomer`)

**Files:** Modify `customer-orders.service.ts:281-285`.

- [ ] **Step 1 (test):** a unit test on the emit call (or assert via a spy) that `emitNewOrderWithCustomer` receives `(tenantId, branchId, order, sessionId)` in that order.
- [ ] **Step 2 (fix):** change the call to:
```ts
    this.kdsGateway.emitNewOrderWithCustomer(
      tenantId,
      branchId,
      createdOrder,
      dto.sessionId,
    );
```
(`branchId` is already in scope from the branch derivation.)
- [ ] **Step 3:** `npx jest customer-orders.service` — PASS. Commit `fix(kds): correct emitNewOrderWithCustomer arity so customer:order-created fires`.

### Task 6.2: Self-pay settlement emit + DI

**Files:** Modify `self-pay-webhook.service.ts` (ctor ~33, success ~191-197).

- [ ] **Step 1 (test):** on `handleWebhookSuccess`, after status flips to SUCCEEDED, the gateway receives `emitToCustomerSession(intent.sessionId, "customer:payment-settled", {...})`; an emit throw does NOT fail the webhook (still returns OK).
- [ ] **Step 2 (fix):** inject `@Optional() private kdsGateway?: KdsGateway` (KdsModule already imported by CustomerOrdersModule; no forwardRef). After the SUCCEEDED `updateMany`:
```ts
    try {
      this.kdsGateway?.emitToCustomerSession(intent.sessionId, "customer:payment-settled", {
        merchantOid,
        status: "SUCCEEDED",
        orderIds: itemsByOrder.map((b) => b.orderId),
      });
    } catch { /* best-effort; webhook must still return OK */ }
```
Only on the SUCCEEDED path (not partial/failed).
- [ ] **Step 3:** `npx jest self-pay-webhook.service` — PASS. Commit.

### Task 6.3: `tryScreenAuth` in the gateway

**Files:** Modify `kds.gateway.ts` (handleConnection ~84-104, add private method).

- [ ] **Step 1 (test):** a socket handshake with `auth.screenToken` for an active ScreenSession joins room `customer-session-<orderingSessionId>` (so it receives the existing `customer:*` events) and sets `client.data.userType="screen"`; expired/revoked → rejected.
- [ ] **Step 2 (impl):** in `handleConnection`, read `const screenToken = client.handshake.auth.screenToken;` and add a branch (after staff, before final reject): `if (screenToken) { if (await this.tryScreenAuth(client, String(screenToken))) return; }`. Implement `tryScreenAuth` mirroring `tryCustomerAuth`: `screenSessionService.authenticate(token)` → if active+unexpired set `client.data.{screenSessionId,tenantId,branchId,userType:"screen",sessionExpiresAt:tokenExpiresAt}`, `client.join("customer-session-"+row.orderingSessionId)` (reuse existing emits) AND `client.join("screen-session-"+row.id)`, install the `.unref?.()` expiry timer guarded by `msToExpiry>0 && <0x7fffffff`. Require the `realtime:subscribe` scope (reject if absent).
- [ ] **Step 3:** Add `screenToken` to the FE socket factories (`frontend/src/lib/socket.ts:77,125`) is NOT needed for partner devices (they build their own client) — leave the FE web app unchanged.
- [ ] **Step 4:** `npx jest kds.gateway` — PASS. Commit.

---

## PHASE 7 — Frontend ADMIN: Partner API keys

### Task 7.1: API client + page + route + i18n

**Files:** Create `frontend/src/features/partner-keys/{partnerKeysApi.ts,PartnerKeysPage.tsx}`; modify Settings layout/route; add i18n keys to all 5 locales (ar/en/ru/tr/uz).

- [ ] **Step 1:** `partnerKeysApi.ts`: `list/create/revoke` against `/v1/partner/api-keys` (uses the shared tenant-wide api client; the prefix is already mirrored in `TENANT_WIDE_PATH_PREFIXES`).
- [ ] **Step 2:** `PartnerKeysPage.tsx` (gated by `hasFeature("externalDisplay")` via the existing entitlements hook): list keys (name, keyId, scopes, status, lastUsedAt), a "Create key" modal (name + scope checkboxes + return origins + branch restriction) that shows the secret **once** with a copy button + "store it now" warning, and a revoke action with confirm. Reuse `ui/Modal`, `getApiErrorMessage`, toast patterns.
- [ ] **Step 3:** Register under Settings → "API & Integrations". Mirror new JSON keys into all 5 locales (CI i18n parity gate).
- [ ] **Step 4:** `cd frontend && npm run build` / lint — PASS. Commit.

---

## PHASE 8 — End-to-end gate + OpenAPI

### Task 8.1: Real-DB e2e through the full chain

**Files:** Create `backend/test/partner-display.e2e-spec.ts` (mirror the existing real-DB e2e harness: PostGIS + Redis service containers, `prisma db push`).

- [ ] **Step 1:** Seed a tenant with `externalDisplay` enabled + a branch + a table. Flow: (1) ADMIN JWT `POST /v1/partner/api-keys` → secret once; (2) HMAC-sign + `POST /v1/partner/screen-sessions {branchId,tableId}` → screenToken; (3) `GET /v1/display/menu` (Screen auth) → menu; (4) `POST /v1/display/orders` → order PENDING_APPROVAL; (5) `GET /v1/display/orders` → lists it; (6) revoke the API key → screen token now 401 (cascade). Negative: tenant WITHOUT the feature → `POST /v1/partner/screen-sessions` 403; stale HMAC timestamp → 401.
- [ ] **Step 2:** Run: `cd backend && npm run test:e2e -- partner-display` — Expected: PASS (real guard chain — catches the `@MachineAuth` reachability class).
- [ ] **Step 3:** Commit.

### Task 8.2: OpenAPI security schemes + docs

**Files:** Modify `main.ts` Swagger `DocumentBuilder` (add `ApiKey`/`Screen` security schemes via `.addApiKey`/`.addSecurity`); add a short `docs/partner-display-api.md` integration guide (auth flow, signing recipe, endpoints, events).

- [ ] **Step 1:** Add `.addApiKey({type:"apiKey",name:"X-Partner-Key",in:"header"},"PartnerKey")` and a `Screen` bearer-style scheme to the builder; tag the new controllers with `@ApiTags`.
- [ ] **Step 2:** Write the integration guide with a copy-paste HMAC signing example.
- [ ] **Step 3:** Commit.

---

## Final verification (before PR)

- [ ] `cd backend && npx tsc --noEmit` clean; `npx eslint` on all new/touched files clean; `npx jest` green; `npm run test:e2e -- partner-display` green.
- [ ] `cd frontend && npm run build` + lint green; i18n parity (5 locales).
- [ ] Push branch, open PR (do NOT tag prod — user-gated). PR body summarizes: ships disabled until a tenant has `externalDisplay` + issues a key; zero runtime change for existing tenants.

---

## Self-review notes (gaps closed)
- **Spec coverage:** identity/credentials (P3), screen tokens (P4), display surface incl self-pay+requests (P5), realtime+bugfixes (P6), plan gate (P0), rate-limit (P2.2), OpenAPI (P8.2), frontend (P7), tests (P8.1) — all mapped.
- **Resolved during planning:** ScreenSession backs a CustomerSession → no money-code refactor; geofence satisfied by passing tenant coords; realtime reused via the customer room; partner auth requires KMS-sealed secret for HMAC verify (Task 4.3 note supersedes Task 3.1 "no KMS").
- **Carry-over risks (verify in impl):** branch-scoped per-branch menu availability may not exist (then `branchId` filter is a documented no-op); tableless multi-branch screen ordering relies on table-bound sessions for correct branch (waiter/bill already require tableId).
