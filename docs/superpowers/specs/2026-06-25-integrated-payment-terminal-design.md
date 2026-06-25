# Integrated Card-Payment-Terminal — Design Spec

**Date:** 2026-06-25
**Goal:** "Ödemeye geç → KART" should drive a physical/integrated card terminal: send the amount, charge the card, wait for the bank result, and record the `Payment` **only on an APPROVED charge** — across all terminal models, behind one provider-agnostic abstraction.

**Decisions (user-approved):**
- **Activation model:** build the full software rail + a fail-closed **SimulatorTerminalProvider** + an honest `CONFIGURED_NOT_ACTIVE` gate. Real adapters activate only when certified hardware + bank/PSP credentials are connected (mirrors the dormant-yazarkasa + delivery-sandbox pattern). No real money can move without a real, registered, ACTIVE provider.
- **Scope ("hepsi"):** one `PaymentTerminal` abstraction with 3 real adapter shapes + simulator:
  1. **GMP-3 integrated Yazarkasa-POS** — one device charges the card AND prints the mali fiş (atomic sale+fiş). Extends the existing `fiscal-core` GMP-3.
  2. **External bank POS (ECR/OOS)** — separate bank terminal, charge-only; fiş via the existing yazarkasa/e-Fatura rail afterwards.
  3. **SoftPOS / PSP terminal API** — cloud/NFC terminal driven by a PSP HTTP API (no on-prem device).

---

## Money-safety contract (non-negotiable)

1. **Charge before record.** The `Payment` row is written ONLY after a confirmed `APPROVED` result, inside the order advisory lock. DECLINED / TIMEOUT / ERROR ⇒ no Payment, order stays open (SERVED/READY), error surfaced.
2. **No double-charge.** The `charge_card` device command is already `NON_RETRYABLE` (device-mesh) — a lost/timed-out ack terminates `failed`, never auto-redelivered. An operator retry uses a NEW idempotency key (explicit), never a silent retry.
3. **Crash recovery.** If the charge APPROVED but the Payment write didn't land (crash between), a reconciliation sweep matches the bank `approvalCode`/RRN to the order and records the Payment (or flags for the operator) — mirrors `self-pay-recovery`. Never charge twice; never lose an approved charge.
4. **Idempotency.** Charge attempt key is deterministic-per-attempt; the recorded `Payment.transactionId` = the bank approval reference (RRN/approvalCode), unique-guarded so the same approval can't be booked twice.
5. **Fail-closed.** Simulator is explicitly labelled SIMULATOR and can never be mistaken for real money; a provider in `CONFIGURED_NOT_ACTIVE` refuses to charge.

---

## Backend — `modules/payment-terminal` (mirrors `fiscal-core`)

- **`PaymentTerminalProvider` interface:** `id`, `capabilities` (`sale` | `void` | `refund` | `fiscal_coupled` | `query_last`), `buildSaleCommand(req)` → device-command payload, `mapResult(ack)` → `TerminalChargeResult { status: APPROVED|DECLINED|TIMEOUT|ERROR, approvalCode?, rrn?, cardBrand?, maskedPan?, fiscalNo?, error? }`. (`fiscal_coupled` providers also return `fiscalNo` — they printed the fiş.)
- **`PaymentTerminalProviderRegistry`** (copy of `FiscalProviderRegistry`): registers `gmp3_card`, `bank_ecr`, `softpos`, `simulator`.
- **`PaymentTerminalRecord`** (new Prisma model, mirrors `FiscalDeviceRecord`): `tenantId, branchId, providerId, deviceId? (FK Device), serial, model, config(Json encrypted), status, lastSeenAt`. Plus a `PAYMENT_TERMINAL` `IntegrationSettings` type (encrypted creds, redacted in responses, `CONFIGURED_NOT_ACTIVE` until a real provider+device is ACTIVE).
- **`PaymentTerminalService.charge(scope, orderId, amount, opts)`** — orchestrator:
  1. Resolve the branch's ACTIVE terminal record + provider (else: no terminal → caller falls back to manual-card).
  2. Acquire the order advisory lock; assert order payable + amount ≤ remaining (+tolerance).
  3. `provider.buildSaleCommand` → enqueue `charge_card` to device-mesh (priority, non-retryable) [or, for SoftPOS, a direct PSP HTTP call]; for the simulator, resolve synchronously by config.
  4. Return `{ commandId, status: PENDING }` (async).
- **`PaymentTerminalService.resolveResult(commandId)`** — read the device-command ack → `mapResult` → if `APPROVED`: in one tx (under the order lock) record the `Payment` (method=CARD, transactionId=rrn/approvalCode) + run the standard finalize (close order / table / loyalty / fiş). For `fiscal_coupled` (GMP-3) skip `maybeIssueYazarkasaReceipt` (the sale already printed the fiş); for charge-only providers, the existing fiş rail runs.
- **Endpoints:** `POST /orders/:id/terminal-charge` (start) → `{commandId, status}`; `GET /orders/:id/terminal-charge/:commandId` (poll) → `{status, approvalCode?, error?, paymentId?}`; `POST /orders/:id/terminal-charge/:commandId/cancel` (operator abort while PENDING).

## Bridge (Rust on-prem agent) — `charge_card` dispatcher

The bridge already claims/acks device commands. Add a `charge_card` handler that routes by `vendorProfile` to the vendor SDK (GMP-3 sale over serial/TCP, bank ECR socket, etc.) and acks `{approved, approvalCode, rrn, cardBrand, maskedPan, fiscalNo?, error}`. **The vendor SDK binding is hardware-side** — I deliver the command contract + a handler stub + the simulator; real SDK wiring happens when certified hardware is on-site.

## Frontend — proceed-payment async charge

`PaymentModal` CARD path, when an ACTIVE terminal exists for the branch:
- "Send to terminal" → `POST terminal-charge` → poll every ~2s (≤90s) with an "Insert/tap card…" spinner + Cancel.
- `APPROVED` → backend already recorded the Payment → refetch + close (auto-print/fiş as today).
- `DECLINED`/`TIMEOUT`/`ERROR` → error + Retry (new attempt key); order stays open.
- **No active terminal** → unchanged manual-card flow (record CARD payment manually) — zero regression for tenants without a terminal. A "manual card (no terminal)" choice always remains.

---

## Phasing (each ships branch→review→staging→prod)

- **P1 — Abstraction + Simulator + charge flow (fully testable now):** `payment-terminal` module, provider interface+registry, `SimulatorTerminalProvider` (deterministic approve/decline/timeout by config), `PaymentTerminalRecord` + migration, `PAYMENT_TERMINAL` integration type + gate, charge/poll/cancel endpoints + money-safety + order-lock + crash-recovery sweep, frontend async charge UX + manual-card fallback, full unit/e2e specs. End-to-end works against the simulator; real adapters scaffolded + gated.
- **P2 — GMP-3 integrated Yazarkasa-POS:** add the `sale` command to the GMP-3 base (charge+fiş atomic), `Gmp3CardTerminalProvider`, fiş double-print guard, payment-terminal provisioning UI (pair a `payment_terminal` device + register provider/serial/branch).
- **P3 — External bank POS (ECR/OOS) + SoftPOS/PSP adapters:** `BankEcrTerminalProvider` (charge-only, fiş via existing rail) + `SoftPosTerminalProvider` (PSP HTTP API). Scaffolded against the abstraction; activate on real creds.
- **P4 — Void/refund + reconciliation polish + bridge handler stub + i18n/UX/a11y.**

Quality bar per phase: backend tsc+jest (+ real-DB e2e for the charge/record/recover paths), frontend tsc+vitest+eslint, i18n parity+value-drift, contract-drift; adversarial money-review of the charge↔record↔fiş↔recovery logic before any prod tag.
