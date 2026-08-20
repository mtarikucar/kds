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
  "features": {
    "feature.posAccess": true, "feature.kdsIntegration": true,
    "feature.customBranding": true, "feature.multiLocation": true,
    "feature.license": true, "feature.advancedReports": false
  },
  "limits": {
    "limit.maxBranches": 1, "limit.maxTables": -1, "limit.maxUsers": -1,
    "limit.maxProducts": -1, "limit.maxCategories": -1,
    "limit.maxMonthlyOrders": -1
  },
  "integrations": { "integration.delivery": ["yemeksepeti", "getir"] },
  "computedAt":   "2026-05-23T08:00:00Z"
}
```

`-1` in any `limit.*` value means **unlimited**.

Two things the shape implies, both load-bearing for clients:

- **The free core is in the data, not in a plan.** `posAccess`,
  `kdsIntegration`, `customBranding` and `multiLocation` are granted to every
  tenant unconditionally and forever, and every retired cap
  (`maxUsers`/`maxTables`/`maxProducts`/`maxCategories`/`maxMonthlyOrders`)
  folds in as `-1`. Clients must read the set rather than infer capability from
  any account attribute — there is no plan/tier field to branch on. See
  `backend/src/modules/entitlements/free-baseline.const.ts`.
- **`limit.maxBranches` is the one priced cap.** 1 free; each purchased
  `extra_branch` unit SUMs +1 on top (ceiling 100).
- **`feature.license`** means an active annual licence. While it is absent the
  projector suppresses the grants of every `requiresLicense` product, so a
  lapsed licence darkens the whole paid surface at once without deleting
  anything — pay and the same set comes back.

Prepaid balances are deliberately **not** entitlements (they are consumed, not
folded); read them from `GET /v1/credits/me`.

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

## Marketplace (à-la-carte catalog)

The catalog is one flat product list — no plans, no tiers. Every row has a
`kind`: `license` | `module` | `integration` | `capacity` | `credit` |
`service`, and a `billing` of `annual` or `oneTime`. Products with
`requiresLicense: true` need an active `license_annual` before they can be
bought *or used*. Source of truth:
`backend/src/modules/marketplace/alacarte-catalog.const.ts`.

```
# Public
GET    /v1/marketplace/addons?kind=
GET    /v1/catalog/pricing                      # public price list

# Tenant
GET    /v1/marketplace/addons/mine              (ADMIN, MANAGER)
GET    /v1/marketplace/addons/available?kind=   (ADMIN, MANAGER) — annotated with purchasability
DELETE /v1/marketplace/addons/:tenantAddOnId?immediate=true|false   (ADMIN)

# Super-admin
GET    /v1/superadmin/marketplace/addons
POST   /v1/superadmin/marketplace/addons        { code, name, kind, billing, priceCents, grants, deps?, ... }
PATCH  /v1/superadmin/marketplace/addons/:id
DELETE /v1/superadmin/marketplace/addons/:id    -> archive
```

> **There is no tenant-facing purchase endpoint.** `POST /v1/marketplace/addons/purchase`
> was removed: it was gated only by `@Roles(ADMIN)` — an ordinary tenant-realm
> role — and activated paid products with no `paymentRef`, so any restaurant
> owner could grant themselves a paid product via curl. Tenant-initiated
> purchases go **only** through `POST /v1/checkout/intent` → PayTR webhook →
> `CheckoutSettlementService` → `tenant.purchase(paymentRef)`, and
> `tenant.purchase()` refuses any `priceCents > 0` grant that arrives without
> one. Operator comps live on the super-admin surface.

`grants` is a JSON object whose keys are entitlement keys, validated against the
vocabulary in `backend/src/modules/entitlements/entitlement-keys.const.ts` — a
key outside it is rejected at publish time, because a typo like
`feature.advancedReport` would otherwise validate, sell, and grant nothing. Real
catalog rows:

```json
{ "feature.advancedReports": true }                          // advanced_reports (module)
{ "limit.maxBranches": 1, "feature.multiLocation": true }     // extra_branch (capacity)
{ "integration.delivery": ["yemeksepeti","getir","trendyol_yemek","migros"],
  "feature.deliveryIntegration": true }                       // delivery_platforms (integration)
```

Numeric grants are multiplied by `quantity` at projection time. `-1` propagates as unlimited.

## Licensing + renewal

```
GET    /v1/me/licensing?locale=tr    licence state, owned products, credits, offers, purchasability
GET    /v1/me/invoices               itemized à-la-carte invoices
GET    /v1/credits/me                prepaid balances (PHOTO / VIDEO / MODEL3D / SMS)
```

`/v1/me/licensing` is the one read a billing UI needs. It returns
`license.status` — `none` | `active` | `grace` | `expired` — alongside
`anchorAt` / `anniversaryAt` / `daysRemaining`, the `owned` rows (each with the
`chargedCents` actually paid and the `renewalCents` it will cost at full list),
the open `renewal` cycle if one has been materialized, per-key `offers`, and
`purchasability` computed by the *same* function the pre-payment guard uses — so
the store never shows a Buy button checkout would refuse.

The billing model behind those fields:

- **The day the licence is bought becomes the account's immutable anniversary.**
  Every annual line bought later is charged only for the days left until that
  date, so the whole account renews on ONE date with ONE itemized invoice.
  Buying within **14 days** of the anniversary rolls the item into the next full
  cycle instead of selling a stub, and no line is ever priced below ₺1.
  (`backend/src/modules/licensing/anniversary.ts`)
- **Renewal is manual.** There is no card on file and no automatic charge. The
  renewal cart is materialized ~30 days ahead at live catalog prices and then
  frozen, so the tenant pays exactly what the reminder quoted. Reminders go out
  at **30 / 7 / 1** days; after the anniversary a **7-day grace window** keeps
  the entitlements live; then access darkens. **Nothing is deleted** — paying
  restores the same set.
  (`renewal-cycle.service.ts`, `renewal-scheduler.service.ts`, `ADDON_GRACE_DAYS`)

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
POST   /v1/checkout/quote                    cart -> priced lines (any tenant role)
POST   /v1/checkout/start                    cart -> re-quote (no DB writes)      (ADMIN, MANAGER)
POST   /v1/checkout/intent                   { cart, buyer, acceptedDocumentIds, … }
                                             -> PayTR iframe token + paymentRef   (ADMIN, MANAGER)
POST   /v1/checkout/confirm                  { cart, paymentRef } -> provisions everything (ADMIN, MANAGER)
```

Cart shape (mix-and-match). Three line types — `addon`, `hardware`, `service`.
There is **no `plan` line type**: plans were retired, so what used to be a tier
purchase is now one or more `addon` lines drawn from the à-la-carte catalog
(`kind`: `license` | `module` | `integration` | `capacity` | `credit`). See
`backend/src/modules/checkout/checkout.types.ts`.

Note which identifier each line takes: `addon.code` is a `MarketplaceAddOn`
code, while **both** `hardware.sku` and `service.code` resolve against
`HardwareProduct` — services are `HardwareProduct` rows with
`category: 'service'`, so `type: "service"` takes a **SKU**, not a marketplace
code. `model` fields (e.g. `BOX-LITE-01`) never resolve.

```json
{
  "items": [
    { "type": "addon",    "code": "license_annual" },
    { "type": "addon",    "code": "advanced_reports" },
    { "type": "addon",    "code": "extra_branch", "qty": 2, "branchId": "b_1" },
    { "type": "hardware", "sku": "hummybox-lite", "qty": 1 },
    { "type": "service",  "code": "install-full-pos", "branchId": "b_1",
      "preferredDates": ["2026-09-01"], "notes": "arka giriş" }
  ],
  "shippingAddress": {...},
  "billingAddress":  {...},
  "branchId": "b_1",
  "couponCode": "..."
}
```

The paid rail is `POST /v1/checkout/intent` → PayTR iframe → PayTR webhook
(`CK-` prefixed `merchant_oid`) → `CheckoutSettlementService` →
`confirmAndProvision`. `/intent` additionally requires `buyer` (email, name,
E.164 phone) and `acceptedDocumentIds` — exactly 3 ids for the current KVKK /
Mesafeli Satış / İade Politikası documents, read from
`/legal/documents/:kind/current`. Collection is **PayTR, TRY only**; there is no
Stripe or Iyzico rail and no stored card.

Quote response includes line-by-line pricing, currency, tax, shipping, and
warnings for unbuyable items. Line prices are **KDV-inclusive (gross)**;
`subtotalCents` is the derived NET and `taxCents` the KDV already embedded in the
lines — never add tax on top. Annual lines are **day-prorated** to the tenant's
licence anniversary, so `unitCents` is the prorated slice and
`meta.annualPriceCents` the full-cycle list price (see
`backend/src/modules/licensing/anniversary.ts`).

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
| `renewal.reminder.v1` | RenewalSchedulerService | tenantId, renewalCycleId, anniversaryAt, daysLeft, totalCents, currency — fired at 30 / 7 / 1 days out |
| `addon.past_due.v1` | TenantAddOnSweeperService | tenantId, addOnId, addOnCode, branchId?, graceEndsAt |
| `payment.succeeded.v1` | CheckoutService (PayTR settlement) | tenantId, tenantName, paymentId, kind (`signup`/`renewal`/`upsell`), amount, currency, referralCode?, occurredAt |
| `tenant.overrides_changed.v1` | SuperadminTenantsService | tenantId |
| `addon.purchased.v1` / `addon.cancelled.v1` | TenantMarketplaceService | tenantId, addOnId, addOnCode, branchId?, quantity? |
| `subscription.activated.v1` / `.cancelled.v1` / `.downgraded.v1` | SubscriptionService | tenantId, subscriptionId, planCode?, periodStart, periodEnd — **plan-era, retired**; see note below |
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

> **On the `subscription.*` family.** These names are still registered in
> `backend/src/modules/outbox/event-types.ts` and the entitlement projector
> still listens for them, so they are documented rather than deleted. But they
> belong to the retired plan rail: `planCode` is optional and carries a legacy
> tier name, and `subscription.upgraded.v1` has no producer at all. **Do not
> build new consumers on them.** The events that describe billing today are
> `checkout.completed.v1` and `payment.succeeded.v1` (money in),
> `addon.purchased.v1` / `.cancelled.v1` / `.past_due.v1` (what the tenant
> owns), `renewal.reminder.v1` (the manual annual renewal), and
> `feature.entitlement.changed.v1` (the resulting capability set).

## Idempotency rules

- Order creation: `Idempotency-Key` header (UUIDv7 recommended).
- Fiscal receipts: `idempotencyKey` in the body. Unique on `(tenantId, idempotencyKey)`.
- Device commands: `idempotencyKey` in the body. Unique on `(deviceId, idempotencyKey)`.
- Webhook delivery: each outbox event id is delivered at-most-once per subscription (unique on `(subscriptionId, eventId)`).
- Add-on purchases: dedupe via `paymentRef` once payment is wired.

## Errors

Standard NestJS shape — `{ statusCode, message, error? }`. Notable codes:

- `403 Forbidden` from `EntitlementGuard` → `EntitlementRequiredException`, which carries the fix on the error body rather than a bare message, so the client never has to map a feature key back to something purchasable:

  ```json
  {
    "statusCode":  403,
    "error":       "Entitlement Required",
    "errorCode":   "ENTITLEMENT_REQUIRED",
    "message":     "Bu özellik hesabınızda etkin değil.",
    "requirement": { "type": "feature", "key": "feature.advancedReports" },
    "offer": {
      "code": "advanced_reports", "name": "Gelişmiş Rapor & Analitik",
      "kind": "module", "annualPriceCents": 129000,
      "proratedCents": 61234, "currency": "TRY",
      "periodEnd": "2027-03-10"
    },
    "licenseRequired": false,
    "reason":          "not_owned"
  }
  ```

  `requirement.type` is `feature` | `limit` | `integration` (limit requirements also carry `usage` / `cap`). `reason` separates `not_owned` (render **Buy**) from `lapsed` (render **Renew**). `licenseRequired: true` means the blocker is the missing annual licence itself, not the product — the resolved `offer` is then the licence, because every `requiresLicense` product stays dark until one is active. `proratedCents` is what the purchase costs *today*, day-prorated to the tenant's anniversary; it is produced by the same catalog read the checkout quote uses, so the advertised price equals the charged price.

- `409 Conflict` from `AddonPurchasabilityService.assertPurchasable` (runs on `POST /v1/checkout/intent`) → the cart line cannot be bought. Body is `{ code, message, addOnCode }`, where `code` is one of:

  | `code` | Meaning |
  |---|---|
  | `LICENSE_REQUIRED` | The product is `requiresLicense` and the tenant has no active licence — add `license_annual` to the same cart |
  | `ADDON_REQUIRES_DEPENDENCY` | A catalog `deps` entry is neither owned nor in the cart |
  | `ADDON_ALREADY_GRANTED` | The tenant's effective entitlements already cover it (paying buys nothing) |
  | `ADDON_ALREADY_OWNED` | An active row for this product already exists |
  | `ADDON_LIMIT_REDUNDANT` | The `limit.*` it grants is already unlimited (`-1`) |
  | `ADDON_MAX_QUANTITY` | Over the catalog ceiling (e.g. `extra_branch` caps at 100) |

  A rejected line fails the **whole** cart. Renewal carts are exempt from the ownership/redundancy rules — re-buying what you hold is what a renewal is. Source: `backend/src/modules/checkout/addon-purchasability.rules.ts`.
- `401 Unauthorized` from `DeviceTokenGuard` / `BridgeTokenGuard` → typically means the bearer expired and the device should re-pair / re-claim

## Versioning

`v1` is the contract. Breaking changes ship as `v2` and the worker keeps delivering both for one migration window. Event types follow the same rule (`order.created.v1` → `order.created.v2`).
