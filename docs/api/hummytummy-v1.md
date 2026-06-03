# HummyTummy API — v1 reference

> Surface added by the Phase 1–12 build. Coexists with the existing
> `/api/*` routes — those continue to work unchanged. Everything below is
> mounted under the same base URL with a `/v1` prefix.

## Auth schemes

| Scheme | Header | Used by |
|---|---|---|
| User JWT | `Authorization: Bearer <jwt>` | tenant dashboard, super-admin |
| Device token | `Authorization: Device <opaque>` | paired devices (tablets, KDS, …) |
| Bridge token | `Authorization: Bridge <opaque>` | Local Bridge Agent → cloud |
| Public | — | landing-site reads, webhook ingest |

Idempotency: every mutating endpoint accepts `Idempotency-Key: <uuid-v7>` and dedupes on (tenant, key).

## Entitlements

```
GET /v1/entitlements/me
```

Returns the effective set for the authenticated tenant:

```json
{
  "features":     { "feature.kdsIntegration": true, "feature.advancedReports": false },
  "limits":       { "limit.maxTables": 50, "limit.maxUsers": -1 },
  "integrations": { "integration.delivery": ["yemeksepeti", "getir"] },
  "computedAt":   "2026-05-23T08:00:00Z"
}
```

`-1` in any `limit.*` value means **unlimited**.

## Branches

```
GET    /v1/branches
GET    /v1/branches/:id
POST   /v1/branches                { name, code?, timezone?, address? }
PATCH  /v1/branches/:id            { name?, code?, timezone?, address?, status? }
DELETE /v1/branches/:id            -> soft archive
```

## Device Mesh

### Admin

```
GET    /v1/devices?branchId=&kind=&status=
POST   /v1/devices                 { kind, branchId?, capabilities?, model?, serial?, ownership? }
                                   -> { id, ..., pairCode, pairCodeExpiresAt }
DELETE /v1/devices/:id             -> retire
POST   /v1/devices/:id/commands    { kind, payload, priority?, idempotencyKey? }
GET    /v1/devices/:id/commands?status=&limit=
```

### Device-side

```
POST   /v1/devices/pair            { pairCode, model?, serial?, capabilities? }
                                   -> { deviceId, token, tokenExpiresAt, ... }
POST   /v1/devices/heartbeat       { batteryPct?, ip?, agentVersion?, queueDepth? }     (Device token)
GET    /v1/devices/next-command                                                          (Device token)
POST   /v1/devices/commands/:commandId/ack
        { status: 'done'|'failed', result?, error? }                                     (Device token)
```

`pairCode` is 6 chars `[A-Z0-9]`, 10-minute TTL, single-use. `token` is the raw bearer — store it on the device, send sha256 in DB; never log raw.

## Local Bridge

```
GET    /v1/bridges?branchId=
POST   /v1/bridges                  { branchId, productSku?, hostname? }
                                    -> { bridgeId, provisioningToken }     # shown once
DELETE /v1/bridges/:id

POST   /v1/bridges/claim            { provisioningToken, hostname?, os?, agentVersion? }
                                    -> { bridgeId, token, tokenExpiresAt }  # raw bearer
POST   /v1/bridges/heartbeat        { hostname?, os?, agentVersion? }       (Bridge token)
```

## Marketplace (add-ons)

```
# Public
GET    /v1/marketplace/addons?kind=

# Tenant
GET    /v1/marketplace/addons/mine
POST   /v1/marketplace/addons/purchase   { addOnCode, quantity?, branchId? }
DELETE /v1/marketplace/addons/:tenantAddOnId?immediate=true|false

# Super-admin
GET    /v1/superadmin/marketplace/addons
POST   /v1/superadmin/marketplace/addons        { code, name, kind, billing, priceCents, grants, deps?, ... }
PATCH  /v1/superadmin/marketplace/addons/:id
DELETE /v1/superadmin/marketplace/addons/:id    -> archive
```

`grants` is a JSON object whose keys are entitlement keys:

```json
{
  "feature.kdsIntegration": true,
  "limit.kdsScreens":       1,
  "integration.delivery":   ["yemeksepeti"]
}
```

Numeric grants are multiplied by `quantity` at projection time. `-1` propagates as unlimited.

## Hardware Catalog + Checkout

```
# Public
GET    /v1/catalog/products?category=
GET    /v1/catalog/products/sku/:sku

# Super-admin
GET    /v1/superadmin/catalog/products?status=&category=
POST   /v1/superadmin/catalog/products       { sku, category, name, priceCents, ... }
PATCH  /v1/superadmin/catalog/products/:id
DELETE /v1/superadmin/catalog/products/:id   -> archive
POST   /v1/superadmin/catalog/products/:id/stock     { qty, serials? }

# Checkout
POST   /v1/checkout/quote                    cart -> priced lines
POST   /v1/checkout/start                    cart -> re-quote (no DB writes)
POST   /v1/checkout/confirm                  { cart, paymentRef } -> provisions everything
```

Cart shape (mix-and-match):

```json
{
  "items": [
    { "type": "plan",     "code": "PRO", "billingCycle": "MONTHLY" },
    { "type": "addon",    "code": "kds_extra_screen", "qty": 2, "branchId": "b_1" },
    { "type": "hardware", "sku": "kds-21in-touch", "qty": 1 },
    { "type": "service",  "code": "onsite_install_kds", "branchId": "b_1" }
  ],
  "shippingAddress": {...},
  "billingAddress":  {...}
}
```

Quote response includes line-by-line pricing, currency, tax, shipping, and warnings for unbuyable items.

## Fiscal

The fiscal API is mostly invoked server-to-server (from OrdersService completion), but admin tools call:

```
POST   /v1/fiscal/devices                    { branchId, providerId, serial, ... }
POST   /v1/fiscal/receipts                   { fiscalDeviceId, orderId?, lines, payments, idempotencyKey }
POST   /v1/fiscal/receipts/:id/cancel        { reason }
POST   /v1/fiscal/devices/:id/close-day
GET    /v1/fiscal/devices/:id/status
GET    /v1/fiscal/pending                    -> recovery panel (queued/failed)
```

## Caller / Phone Orders

```
GET    /v1/caller/recent?limit=
POST   /v1/caller/webhooks/:providerId/:tenantId       (Public; signature verified by adapter)
```

## Fulfillment

```
POST   /v1/installation                       { branchId?, hwOrderId?, preferredDates?, notes? }
GET    /v1/installation?status=
POST   /v1/warranties/:id/claims              { issue, severity?, description? }

POST   /v1/superadmin/shipments/:orderId      { carrier, trackingNo?, meta? }
PATCH  /v1/superadmin/shipments/:shipmentId/delivered
GET    /v1/superadmin/shipments/:orderId
```

## Integration Gateway

```
GET    /v1/integrations/providers?kind=
POST   /v1/integrations/connections           { providerId, branchId?, credentials?, config? }
GET    /v1/integrations/connections
DELETE /v1/integrations/connections/:id

POST   /v1/integrations/webhooks/:providerId/:tenantId   (Public)
```

Credentials are envelope-encrypted at rest (AES-256-GCM with a per-tenant derived key).

## Outbound Webhooks

```
GET    /v1/webhooks/subscriptions
POST   /v1/webhooks/subscriptions        { url, events? }   -> { ..., secret }  # shown ONCE
DELETE /v1/webhooks/subscriptions/:id
```

Each delivery is signed:

```
X-HummyTummy-Event-Id:    <uuidv7>
X-HummyTummy-Event-Type:  order.completed.v1
X-HummyTummy-Signature:   t=<ms_since_epoch>,v1=<hex hmac-sha256>
```

5-minute timestamp tolerance, replay protection. Auto-pauses after 20 consecutive failures.

## Health Dashboard

```
GET    /v1/health/branches                   -> [{ id, name, health: { score 0..100, pill, breakdown, countedDevices } }]
GET    /v1/health/branches/:branchId
```

## Event Catalog (outbox types)

All consumers MUST be idempotent on `id` (UUIDv7).

| Event | Producer | Key payload fields |
|---|---|---|
| `subscription.activated.v1` | SubscriptionService | tenantId, subscriptionId, planCode, periodStart, periodEnd |
| `subscription.cancelled.v1` | SubscriptionService | same |
| `subscription.upgraded.v1` / `subscription.downgraded.v1` | SubscriptionService | same |
| `tenant.overrides_changed.v1` | SuperadminTenantsService | tenantId |
| `addon.purchased.v1` / `addon.cancelled.v1` | TenantMarketplaceService | tenantId, addOnId, addOnCode, branchId?, quantity? |
| `feature.entitlement.changed.v1` | EntitlementsModule | tenantId, features, limits, integrations |
| `order.created.v1` / `.updated.v1` / `.completed.v1` / `.cancelled.v1` | OrdersService | orderId, tenantId, branchId, status |
| `device.slot_created.v1` / `device.paired.v1` | DeviceService | deviceId, kind, branchId |
| `device.command.created.v1` / `.completed.v1` / `.failed.v1` / `.requeued.v1` | CommandQueueService | commandId, deviceId, kind |
| `bridge.provisioned.v1` | LocalBridgeService | bridgeId, branchId |
| `fiscal.receipt.printed.v1` / `.failed.v1` | FiscalService | fiscalReceiptId, fiscalNo, fiscalDeviceId |
| `fiscal.day.closed.v1` | FiscalService | fiscalDeviceId, zNo |
| `payment.intent_created.v1` / `.refund_completed.v1` | PaymentsFacadeService | providerId, intentId, externalRef |
| `payment.webhook.<type>.v1` | PaymentsFacadeService.ingestWebhook | provider-specific |
| `hardware.order.shipped.v1` / `.delivered.v1` | ShipmentService | orderId, shipmentId, carrier?, trackingNo? |
| `installation.requested.v1` / `.scheduled.v1` / `.completed.v1` | InstallationService | requestId |
| `warranty.created.v1` / `warranty.claim.filed.v1` | WarrantyService | warrantyId, productId, serial |
| `caller.incoming.v1` / `.answered.v1` / `.ended.v1` / `.missed.v1` | CallerService | callerEventId, providerId, callId, e164, customerId |
| `integration.connected.v1` / `.disconnected.v1` | IntegrationService | connectionId, providerId |
| `integration.webhook.<provider>.received.v1` | IntegrationService | webhookEventId, providerId, type |
| `checkout.completed.v1` | CheckoutService | tenantId, paymentRef, quote, hardwareOrderId?, addOnIds[] |

## Idempotency rules

- Order creation: `Idempotency-Key` header (UUIDv7 recommended).
- Fiscal receipts: `idempotencyKey` in the body. Unique on `(tenantId, idempotencyKey)`.
- Device commands: `idempotencyKey` in the body. Unique on `(deviceId, idempotencyKey)`.
- Webhook delivery: each outbox event id is delivered at-most-once per subscription (unique on `(subscriptionId, eventId)`).
- Add-on purchases: dedupe via `paymentRef` once payment is wired.

## Errors

Standard NestJS shape — `{ statusCode, message, error? }`. Notable codes:

- `403 Forbidden` from `EntitlementGuard` → "Feature not enabled: feature.kds" or "Limit reached for limit.maxTables (50/50)" or "Integration not enabled: yemeksepeti"
- `400 Bad Request` from `TenantMarketplaceService.purchase` → "Add-on requires: plan:PRO, delivery_hub" (clients should drive a "bundle upsell" modal)
- `401 Unauthorized` from `DeviceTokenGuard` / `BridgeTokenGuard` → typically means the bearer expired and the device should re-pair / re-claim

## Versioning

`v1` is the contract. Breaking changes ship as `v2` and the worker keeps delivering both for one migration window. Event types follow the same rule (`order.created.v1` → `order.created.v2`).
