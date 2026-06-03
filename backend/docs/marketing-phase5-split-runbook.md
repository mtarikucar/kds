# Marketing Microservice — Phase 5 Physical Split Runbook

Phases 1–4 made the marketing module a self-contained bounded context. This
runbook is the **mechanical** extraction into a separate deployable service with
its own database. No application redesign is required — only transport wiring +
infra. The invariants that make this safe are asserted by
`marketing-decoupling.arch.spec.ts` (run it before starting).

> Status: Phases 1–4 are merged on `feat/marketing-decoupling-phase1`. The steps
> below are **ops/infra execution** — they provision a service + DB and flip
> transport flags. They cannot be done from a code session.

## What is already in place (the seams)

- **No cross-context FKs.** The 4 links (`leads.convertedTenantId`,
  `commissions.tenantId`, `lead_offers.planId`,
  `subscription_payments.referredByMarketingUserId`) are plain indexed soft
  references + snapshots — no DB-level FK crosses the boundary.
- **Two core-owned ports** (`src/core-contracts/`): `CoreProvisioningPort`
  (marketing → core: tenant provisioning) and `ReferralDirectoryPort`
  (core → marketing: referral resolve). Bound in-process today by
  `ProvisioningModule`.
- **Two business events** over the outbox: `payment.succeeded.v1`
  (core → marketing commission consumer) and `marketing.lead.converted.v1`
  (marketing → installation consumer).
- **Independent auth** (`MARKETING_JWT_SECRET`), independent service layer, and
  a marketing-owned table set.

## Marketing-owned tables (move to the marketing DB)

```
marketing_users, leads, lead_activities, marketing_tasks, lead_offers,
commissions, marketing_notifications, marketing_distribution_config,
sales_calls, installation_crews, installation_jobs, installation_tasks,
sales_targets
```

Core-owned (stay): everything else, plus `tenant_provisioning_log` (the
provisioning ledger is core's idempotency anchor).

Cross-context soft-ref columns that become "dangling but meaningful" after the
split (carry snapshots so no join is needed):
`leads.convertedTenantId`, `commissions.tenantId`/`sourcePaymentId`,
`lead_offers.planId` (+ `planCode/planName/planMonthlyPrice/planCurrency`),
`subscription_payments.referredByMarketingUserId` (+ `referralCode`).

## Steps

### 1. Split the database

1. Create a `marketing` database (or Postgres schema).
2. Migrate the marketing-owned tables into it (dump/restore the table list above;
   they have no inbound FKs from core, so this is a clean cut).
3. Point the marketing service's `DATABASE_URL` at the marketing DB; core keeps
   its own. The soft-ref columns + snapshots mean neither side needs a
   cross-database join.

### 2. Stand up the marketing service

1. New NestJS app that imports `MarketingModule` + the two port impls it owns
   (`ReferralDirectoryService`, and the marketing event consumers).
2. Keep `OutboxModule` for durable eventing (now relayed to a real broker —
   step 4).

### 3. Wire the network transport (flip the ports to HTTP/gRPC)

The ports were designed for exactly this — serializable DTOs, no Prisma types,
explicit idempotency keys. Add, on each consuming side, a network client that
implements the same interface, and expose the impl over an internal endpoint:

| Port | Server (exposes) | Client (consumes) |
| --- | --- | --- |
| `CoreProvisioningPort` | core: `POST /internal/provisioning/*` wrapping `TenantProvisioningService` | marketing: `HttpCoreProvisioningClient implements CoreProvisioningPort` |
| `ReferralDirectoryPort` | marketing: `POST /internal/referral/resolve` wrapping `ReferralDirectoryService` | core: `HttpReferralDirectoryClient implements ReferralDirectoryPort` |

- Map the port-local errors (`CoreProvisioningEmailInUseError`, …) to/from HTTP
  status + a structured `code`, so callers stay framework-neutral.
- Guard internal endpoints with a shared service token (mirror
  `IngestTokenGuard`).
- Select transport by env in the binding module: in-process impl when the peer
  URL is unset, HTTP client when `CORE_SERVICE_URL` / `MARKETING_SERVICE_URL` is
  set. No call site changes — they inject the token, not the impl.

### 4. Replace the in-process event bus with a broker

- Today `OutboxWorkerService` drains the outbox onto the in-process
  `DomainEventBus`. Add a relay that publishes drained rows to a real broker
  (NATS/Kafka/SQS); the peer service's consumer subscribes there.
- `payment.succeeded.v1` (core → marketing) and `marketing.*` (marketing →
  installation/analytics) cross the broker; consumers keep their existing
  idempotency (`sourcePaymentId`, Serializable SIGNUP guard, `lead-converted:{id}`).

### 5. Cutover

1. Deploy marketing service (transport flags still pointing in-process / shared
   DB) → verify green.
2. Flip `DATABASE_URL` to the marketing DB; flip the port transport flags; point
   the outbox relay at the broker.
3. Smoke test: convert a lead (marketing → core provisioning over HTTP), drive a
   PayTR settlement (core → marketing commission over the broker), create a
   sales call, auto-create + schedule an installation.

## Verification

- `npx jest marketing-decoupling.arch.spec.ts` — the cross-context invariants.
- The migrations `20260602000000…20260603000200` capture every schema change.
- Full backend suite stays green throughout (the split changes transport, not
  logic).
