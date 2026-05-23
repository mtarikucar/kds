# HummyTummy Outbound Webhooks — Receiver Guide

This doc is for integrators receiving HummyTummy webhooks on their own server.

## Signature spec

Every delivery carries an `X-HummyTummy-Signature` header in the form:

```
X-HummyTummy-Signature: t=1763600000000,v1=68b8a47a…hexhmac
```

Where:

- `t` is the delivery timestamp in **milliseconds since Unix epoch**.
- `v1` is `hex(HMAC_SHA256(secret, t + "." + body))`.

The header also includes `X-HummyTummy-Event-Id` (UUIDv7) and `X-HummyTummy-Event-Type` (e.g. `order.completed.v1`).

## Verification recipe

1. Reject if `|now - t| > 5 minutes` (replay window).
2. Recompute `v1` with your stored secret.
3. Compare with **constant-time** equality.
4. Dedupe on `X-HummyTummy-Event-Id` — every event is delivered **at least once**.

## Node + Express (20 lines)

```js
import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.HUMMYTUMMY_SECRET; // 'whs_...' returned at subscribe time
const TOLERANCE_MS = 5 * 60 * 1000;

const app = express();

// Capture the raw body for HMAC.
app.use(express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); }
}));

app.post('/hummytummy-webhook', (req, res) => {
  const header = String(req.headers['x-hummytummy-signature'] ?? '');
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const ts = Number(parts.t);
  const v1 = String(parts.v1 ?? '');
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOLERANCE_MS) {
    return res.status(401).send('stale');
  }
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(`${ts}.${(req as any).rawBody}`)
    .digest('hex');
  if (expected.length !== v1.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) {
    return res.status(401).send('bad signature');
  }

  // Dedupe on the event id — at-least-once delivery.
  const id = req.headers['x-hummytummy-event-id'];
  if (alreadyProcessed(id)) return res.status(200).send('ok');

  handle(req.body);    // your business logic
  res.status(200).send('ok');
});
```

## Python (FastAPI / Flask)

```python
import hmac, hashlib, time
SECRET = b"whs_..."

def verify(header: str, body_bytes: bytes) -> bool:
    parts = dict(p.split("=") for p in header.split(","))
    ts = int(parts.get("t", "0"))
    if abs(int(time.time() * 1000) - ts) > 5 * 60 * 1000:
        return False
    expected = hmac.new(SECRET, f"{ts}.".encode() + body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Delivery semantics

- **At least once.** Always dedupe on `X-HummyTummy-Event-Id`.
- **Ordered? No.** Use the event's own timestamp/version field if you need an ordering relation.
- **Retries.** A non-2xx response triggers retries at 30s, 2m, 10m, 1h, 6h. After 5 attempts the delivery is marked `failed`. After 20 consecutive failures across deliveries, the subscription is auto-paused.
- **Pause / resume.** Paused subscriptions stop delivery but keep receiving fan-out rows; resuming flushes the backlog.

## Subscribing

```http
POST /v1/webhooks/subscriptions
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "url": "https://your-server.example.com/hummytummy-webhook",
  "events": ["order.created.v1", "order.completed.v1", "fiscal.receipt.printed.v1"] }
```

Response includes a `secret` field — store it once, securely. We cannot show it again.

```json
{
  "id": "01HXY...",
  "tenantId": "01HX...",
  "url": "https://your-server.example.com/hummytummy-webhook",
  "events": ["order.created.v1", "order.completed.v1", "fiscal.receipt.printed.v1"],
  "status": "active",
  "secret": "whs_abc123..."
}
```

## Event types you can subscribe to

See `docs/api/hummytummy-v1.md → Event Catalog`. Common picks:

- `order.created.v1` / `order.updated.v1` / `order.completed.v1` / `order.cancelled.v1`
- `payment.intent_created.v1` / `payment.refund_completed.v1`
- `fiscal.receipt.printed.v1` / `fiscal.receipt.failed.v1`
- `device.command.failed.v1` (for ops dashboards)
- `subscription.activated.v1` / `subscription.cancelled.v1`
- `addon.purchased.v1` / `feature.entitlement.changed.v1`

Subscribe to `"*"` to receive everything (rate-limit yourself accordingly).
