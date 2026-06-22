# Partner Display API (Remote-Screen Integration) — Design

**Date:** 2026-06-22
**Branch:** `feat/partner-display-api`
**Status:** Approved (brainstorming) → planning

## 1. Problem

A partner wants to run their **own table tablet** (and, generally, other external
apps/screens) that does what the built-in **QR-code menu** does — browse the menu,
place an order, self-pay, call a waiter / request the bill, and watch order status
live — while running **outside** this system and integrating through stable,
documented interfaces.

Today the QR-menu flow is fully public and reusable, **but** there is no first-class
integration surface: no partner/tenant API credential, no versioned contract, per-IP
rate limits that a venue full of tablets behind one NAT IP would trip, an anonymous
customer session with a hard 4h TTL and no refresh, a broken `customer:order-created`
WS emit, no live push on self-pay settlement, and no plan gate. (See
`docs/.../wueo3kap7` analysis; summarized in §3.)

## 2. Goals / Non-Goals

### Goals (v1)
- A **tenant-self-service API key** a restaurant ADMIN issues to its integrator.
- A **per-screen, scoped, short-lived token** minted by the partner's backend via an
  **HMAC-signed** request (master secret never reaches the device).
- A **versioned `/api/v1/display/*` surface** covering: menu read, order placement,
  self-pay (PayTR), waiter/bill requests, order/payment status read.
- **Live updates** to the screen over Socket.IO `/kds` using the screen token, plus a
  **REST polling fallback**.
- **Plan gating** behind a new `feature.externalDisplay` feature key.
- **Per-key / per-screen rate limiting** (not per-IP).
- Published **OpenAPI** contract with `ApiKey` (HMAC) + `Screen` security schemes.

### Non-Goals (v1)
- Staff/KDS role replication (seeing all branch orders, mutating kitchen status).
- Non-TR / non-TRY payments (self-pay stays PayTR + TRY, as today).
- An open public developer ecosystem with consent screens / OAuth-Connect (we are
  **tenant self-service**, one API key per tenant→integrator relationship).
- Changing the existing QR-menu web SPA behavior (only shared services are touched).

## 3. Existing system (what we build on — do NOT reinvent)

- **Customer ordering pipeline** is reusable and browser-independent. Order identity
  is a free-form string `sessionId` column on `Order`; tenant/branch are resolved
  **server-side** (never from the body). Services:
  `customer-orders.service.createOrder`, `self-pay-intent.service`,
  `self-pay-query.service`, the inline qr-menu query in `qr-menu.controller.ts`.
- **`webhooks-outbound`** is the template for a tenant-issued, plan-gated, secret-once
  credential (`TenantWebhookSubscription`: sha256 secret hash, ADMIN, `@RequiresFeature`,
  `@SkipBranchScope`, per-tenant cap, SSRF/HMAC helpers).
- **`device-mesh`** is the template for an opaque, sha256-stored, revocable,
  branch-scoped bearer token with a non-`Bearer` `Authorization:` scheme and a
  dedicated guard (`DeviceTokenGuard`).
- **`KdsGateway`** (`/kds` Socket.IO namespace, Redis adapter) already does dual
  handshake auth (staff JWT or customer `sessionId`) and (tenant,branch)/session-scoped
  rooms. We add a third principal.
- **Guard bypass:** `shouldBypassGlobalAuth()` only honors `@Public`/superadmin
  metadata. New machine-auth routes MUST register a new metadata key there or the
  global `JwtAuthGuard`/`BranchGuard` chain rejects them before the dedicated guard
  runs. (This is the latent device-mesh heartbeat bug; we fix the class properly.)
- **Plan features** require the documented **3-place sync**: `SubscriptionPlan` schema
  column + `PlanProjector.FEATURE_COLUMNS` + `getEffectiveFeatures` fallback.
- **Conventions:** global prefix `/api`; standard error envelope with `errorCode`;
  `paginated()` meta; `@Throttle` per route; CORS locked to `*.hummytummy.com` +
  localhost (native apps are unaffected; a partner **web** origin must be allowlisted).

## 4. Architecture (thin layer over existing services)

```
┌──────────────┐  HMAC-signed mint        ┌───────────────────────────────┐
│Partner backend│ ───────────────────────▶ │ POST /api/v1/partner/         │
│ (holds API key│                          │      screen-sessions          │
│  + secret)    │ ◀─ screenToken+refresh ── │  PartnerKeyGuard (HMAC verify)│
└──────────────┘                           └───────────────────────────────┘
        │ ships screenToken to device
        ▼
┌──────────────┐  Authorization: Screen <t> ┌───────────────────────────────┐
│ Table tablet │ ──────────────────────────▶│ /api/v1/display/*             │
│  (no secret) │                            │  ScreenTokenGuard + scope     │
│              │ ◀── menu/order/pay/status ─│  → reuse customer-orders /    │
│              │                            │    self-pay / menu services   │
│              │  WS /kds auth.screenToken  └───────────────────────────────┘
│              │ ◀═══ display:order-* / payment-settled (room screen-session-<id>)
└──────────────┘
```

**Isolation boundary:** a small `OrderingContext` ({tenantId, branchId, tableId?,
sessionKey, customerId?}) is resolved from **either** a `CustomerSession` (QR web) **or**
a `ScreenSession` (partner) and fed into the single `createOrder`/self-pay code path, so
business logic stays single-sourced.

## 5. Data model (new)

### `PartnerApiKey` (tenant-scoped; mirrors `TenantWebhookSubscription`)
| field | notes |
| --- | --- |
| `id` | cuid |
| `tenantId` | FK Tenant (cascade) |
| `keyId` | public id, e.g. `pk_live_<rand>`; safe to log; unique |
| `secretHash` | `sha256(secret)`; raw secret returned **once** at creation |
| `name` | human label |
| `scopes` | `String[]` ⊆ {`menu:read`,`orders:write`,`orders:read`,`payments:write`,`requests:write`,`realtime:subscribe`} |
| `allowedReturnOrigins` | `String[]`; PayTR self-pay return URL allowlist |
| `allowedBranchIds` | `String[]`; empty = all tenant branches |
| `status` | `active` \| `revoked` |
| `lastUsedAt`, `createdBy`, `createdAt`, `revokedAt` | audit |

Per-tenant cap (e.g. 10). Revoking cascades: all child `ScreenSession`s are revoked.

### `ScreenSession` (per-screen scoped token)
| field | notes |
| --- | --- |
| `id` | cuid; **also** written to `Order.sessionId` (free-form string) |
| `tenantId`, `branchId` | explicit (no "first active branch" fallback) |
| `tableId` | optional; validated to belong to branch/tenant |
| `partnerApiKeyId` | FK PartnerApiKey (cascade on revoke) |
| `scopes` | `String[]` ⊆ key scopes |
| `tokenHash` | `sha256(screenToken)`; access token |
| `refreshTokenHash` | `sha256(refreshToken)`; rotating, single-use |
| `expiresAt` | access TTL ~1h |
| `refreshExpiresAt` | ~30d |
| `revokedAt`, `lastSeenAt`, `createdAt` | |

## 6. Auth flows

### 6.1 Partner key → screen token (HMAC-signed, machine-to-machine)
`POST /api/v1/partner/screen-sessions`
Headers: `X-Partner-Key: <keyId>`, `X-Partner-Timestamp: <unix s>`,
`X-Partner-Signature: hex(hmac_sha256(secret, timestamp + "\n" + method + "\n" + path + "\n" + sha256(body)))`.
`PartnerKeyGuard`: lookup key by `keyId` → load `secretHash` → recompute HMAC
(timing-safe) → reject stale timestamp (±300s, replay window) → enforce
`@RequiresFeature(externalDisplay)` and `status=active` → `req.partnerKey`.
Body: `{ branchId, tableId?, scopes?: string[] }` (requested scopes ⊆ key scopes;
branch ∈ `allowedBranchIds` if set). Returns
`{ screenToken, refreshToken, expiresAt, scopes, tenantId, branchId, tableId }`.

`POST /api/v1/partner/screen-sessions/refresh` — body `{ refreshToken }`; rotates both
tokens single-use; same `PartnerKeyGuard`.

### 6.2 Screen token → display API
Header `Authorization: Screen <screenToken>` (non-`Bearer`, like `Device`).
`ScreenTokenGuard`: sha256 lookup → active + not expired → `req.screen =
{ id, tenantId, branchId, tableId, scopes }`. A `@RequireScope('orders:write')`
decorator + guard enforces per-endpoint scope.

### 6.3 Guard reachability (critical)
New metadata `@MachineAuth()` (key `IS_MACHINE_AUTH_KEY`) added to
`shouldBypassGlobalAuth()` so the global Jwt/Roles/Tenant/Branch/Subscription chain
steps aside on partner/display routes; the dedicated `PartnerKeyGuard` /
`ScreenTokenGuard` (declared via `@UseGuards`) becomes the sole gate. Applied
class-level on both new controllers. (We do **not** use `@Public` because these routes
are authenticated, just not by JWT.)

## 7. Endpoints

### Partner (machine, `PartnerKeyGuard`)
- `POST /api/v1/partner/screen-sessions`
- `POST /api/v1/partner/screen-sessions/refresh`
- `DELETE /api/v1/partner/screen-sessions/:id` (revoke one screen)

### Partner key management (ADMIN JWT, `@RequiresFeature(externalDisplay)`, `@SkipBranchScope`) — clones `webhooks-outbound`
- `GET /api/v1/partner/api-keys`
- `POST /api/v1/partner/api-keys` (secret returned once)
- `DELETE /api/v1/partner/api-keys/:id`

### Display (screen, `ScreenTokenGuard` + scope) — reuse existing services
| endpoint | scope | reuse |
| --- | --- | --- |
| `GET /api/v1/display/menu` | `menu:read` | qr-menu query, **branch-aware** |
| `GET /api/v1/display/tables` | `menu:read` | tables (branch) |
| `POST /api/v1/display/orders` (`Idempotency-Key`) | `orders:write` | `createOrder` via `OrderingContext` |
| `GET /api/v1/display/orders` , `/orders/:id` | `orders:read` | session/table scoped list |
| `POST /api/v1/display/waiter-requests` , `/bill-requests` | `requests:write` | request services |
| `GET /api/v1/display/payable-items` | `payments:write` | `self-pay-query` |
| `POST /api/v1/display/pay-intent` | `payments:write` | `self-pay-intent`; return URL from `allowedReturnOrigins` |
| `GET /api/v1/display/pay-status` | `payments:write` | `self-pay-query` |

## 8. Realtime

- Extend `KdsGateway.handleConnection` with a third path: `handshake.auth.screenToken`
  → validate `ScreenSession` → join room `screen-session-<id>`; auto-disconnect at
  access-token expiry; require `realtime:subscribe` scope.
- Emit to that room: `display:order-created`, `display:order-approved`,
  `display:order-status-updated`, `display:payment-settled`, `display:waiter-ack`.
- **Bug fixes required (existing defects the integration depends on):**
  1. `emitNewOrderWithCustomer` is called with wrong arity (`branchId`/`sessionId`
     mismatch) so `customer:order-created` never fires — fix signature + callers.
  2. Self-pay settlement emits no WS event — add an emit on settle in the self-pay
     webhook handler (benefits the QR web app too).
- **REST polling fallback:** the existing `GET /display/orders` + `GET
  /display/pay-status` are the documented fallback when WS is unavailable.

## 9. Plan gating

New `PlanFeature.EXTERNAL_DISPLAY` (`feature.externalDisplay`). 3-place sync:
`SubscriptionPlan` schema column, `PlanProjector.FEATURE_COLUMNS`,
`getEffectiveFeatures` fallback. `@RequiresFeature(EXTERNAL_DISPLAY)` gates **API-key
creation** and **screen-session minting** (checked in `PartnerKeyGuard` against the
resolved entitlement set). Tenants without it cannot issue keys or mint tokens.

## 10. Rate limiting

Custom `ThrottlerGuard.getTracker` override (or a `@Throttle` storage keyed by
principal): track by `partnerKey.keyId` on `/partner/*` and by `screen.id` on
`/display/*` instead of IP. Per-scope buckets (e.g. `orders:write` 60/min/screen,
`pay-intent` 10/min/screen, `menu:read` 120/min/screen). Solves the NAT-IP collision.

## 11. Security

- HMAC sign + ±300s timestamp window (replay), timing-safe compares, secret shown once,
  sha256-at-rest for key secret + screen tokens + refresh tokens.
- Revocation cascade: revoke API key → revoke all its `ScreenSession`s (token dead next
  request).
- PayTR return URL from `allowedReturnOrigins` (stop trusting `Origin`/`Referer`).
- Scope enforced per endpoint; branch pinned by token (no body override; no
  "first active branch" fallback).
- Audit log on key create/revoke and screen-session mint (reuse audit infra).
- All amounts/pricing remain server-derived (unchanged from customer rail).

## 12. Frontend (ADMIN)

A new **Settings → API & Integrations → Partner API keys** screen (gated by
`externalDisplay` entitlement): list keys, create (show secret + scopes + return
origins + branch restriction once), revoke. Tenant-wide route → mirror in
`TENANT_WIDE_PATH_PREFIXES`. i18n keys mirrored to all 5 locales (ar/en/ru/tr/uz).

## 13. Testing

- **Unit:** `PartnerKeyGuard` HMAC verify (valid/replay/bad-sig/stale), `ScreenTokenGuard`
  (valid/expired/revoked/scope), `OrderingContext` resolution, scope decorator, rate-limit
  tracker keying, plan-gate.
- **Real-DB e2e (CI gate):** full guard chain through the new routes — mint key → sign →
  mint screen token → place order → poll status → self-pay intent; revoke cascade kills
  the screen; plan-gate 403 without feature. (HTTP-level, since mocked Prisma can't catch
  the guard-chain reachability class — same lesson as the device null→NOT-NULL bug.)
- **Contract drift + i18n parity** jobs already in CI must stay green.

## 14. Rollout

Branch → PR → merge `main` → `vX.Y.Z` tag → CI deploy (standing release workflow).
Ships **disabled** until a tenant gets the `externalDisplay` plan feature and issues a
key — zero runtime change for existing tenants. **Prod tag is user-gated.**

## 15. Open risks / to verify during implementation
- Confirm the global guard-chain reachability fix on a running server (the device-mesh
  precedent is untested).
- `Order.sessionId` is a free-form string today — confirm no implicit assumption that it
  is a 64-hex `CustomerSession` id anywhere downstream (KDS, reports) before reusing it
  for `ScreenSession` ids; if found, add a discriminator column.
- PayTR `merchantOid` prefix space (`SP` is self-pay) — ensure screen-originated self-pay
  reuses the same prefix/rail without collision.
