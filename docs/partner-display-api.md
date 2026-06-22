# Partner Display API — Integration Guide

Run your own screens/apps (e.g. a table tablet) that do what the built-in QR
menu does — browse the menu, place orders, self-pay, call a waiter / request
the bill, and watch order status live — against a HummyTummy restaurant.

All routes are under the global prefix `/api`. Base URL: `https://<host>/api`.

## Concepts

- **Partner API key** — issued by the restaurant ADMIN (Settings → API &
  Integrations). A `keyId` (`pk_live_…`, safe to log) + a `secret` shown **once**.
  Held only by your **backend**. Requires the restaurant's plan to include the
  `externalDisplay` feature.
- **Screen session token** — a short-lived, scoped token your backend mints per
  screen, bound to a branch (and optionally a table). The device holds only this
  token, never the API secret.
- **Scopes** — `menu:read`, `orders:write`, `orders:read`, `payments:write`,
  `requests:write`, `realtime:subscribe`. A screen's scopes are a subset of the
  key's.

## 1. Issue an API key (restaurant ADMIN, one-time, in-app)

The restaurant owner creates a key in the dashboard and hands you the `keyId` +
`secret`. Store the secret securely on your **server** — it is never shown again.

## 2. Mint a screen token (your backend → us)

Authenticate with your key over TLS:

```
POST /api/v1/partner/screen-sessions
X-Partner-Key:    pk_live_xxxxx
X-Partner-Secret: pk_live_secret_xxxxx
Content-Type: application/json

{ "branchId": "<branch-uuid>", "tableId": "<table-uuid?>", "scopes": ["menu:read","orders:write","realtime:subscribe"] }
```

Response (tokens shown once):

```json
{
  "id": "…", "screenToken": "<uuidv7>.<secret>", "refreshToken": "<uuidv7>.<secret>",
  "expiresAt": "…(≈1h)", "refreshExpiresAt": "…(≈30d)",
  "scopes": ["…"], "tenantId": "…", "branchId": "…", "tableId": "…",
  "orderingSessionId": "…"
}
```

Ship `screenToken` (and keep `refreshToken` server-side) to the device. Before
expiry, rotate:

```
POST /api/v1/partner/screen-sessions/refresh
X-Partner-Key / X-Partner-Secret
{ "refreshToken": "…" }   →   new { screenToken, refreshToken, … }
```

Revoke a single screen: `DELETE /api/v1/partner/screen-sessions/:id` (key auth).
Revoking the **API key** in the dashboard cascades — all its screen tokens die.

## 3. Drive the screen (device → us)

Every `/display` call presents the screen token:

```
Authorization: Screen <screenToken>
```

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/display/menu` | `menu:read` | Branding + categories/products/modifiers + feature flags |
| POST | `/api/v1/display/orders` | `orders:write` | Place an order `{ items:[{ productId, quantity, modifiers?, notes? }], type?, notes? }` |
| GET | `/api/v1/display/orders` | `orders:read` | This screen's orders + statuses |
| POST | `/api/v1/display/waiter-requests` | `requests:write` | `{ message? }` (requires the screen be table-bound) |
| POST | `/api/v1/display/bill-requests` | `requests:write` | `{ message? }` |
| GET | `/api/v1/display/payable-items` | `payments:write` | Unpaid items for the table |
| POST | `/api/v1/display/pay-intent` | `payments:write` | PayTR hosted-payment intent `{ items:[{ orderItemId, quantity }], customerPhone? }` |
| GET | `/api/v1/display/pay-status?oid=…` | `payments:write` | Poll a payment's status |

The screen's tenant/branch/table are taken from its token — never sent in the
body. Self-pay is TR/TRY + PayTR; open the returned `paymentLink` in a WebView
and register your return origin via the key's `allowedReturnOrigins`.

## 4. Live updates (device → us, WebSocket)

Connect Socket.IO to the `/kds` namespace with the screen token; requires the
`realtime:subscribe` scope:

```js
io("https://<host>/kds", { auth: { screenToken: "<screenToken>" } });
```

Events: `customer:order-created`, `customer:order-approved`,
`customer:order-status-updated`, `customer:payment-settled`. If the socket
drops, fall back to polling `GET /display/orders` and `GET /display/pay-status`.

## Conventions

- **Errors:** standard envelope `{ statusCode, message, error, errorCode?, … }`.
  `401` = bad/expired token, `403` = missing scope or the tenant lacks the
  `externalDisplay` feature, `429` = rate limited.
- **Rate limits** are per key / per screen token (not per IP), so a venue of
  tablets behind one NAT IP is fine.
- **Token TTLs** (configurable by the operator): access ≈ 1h, refresh ≈ 30d.
