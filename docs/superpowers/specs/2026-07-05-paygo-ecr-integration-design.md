# Paygo SP630PRO ECR integration — design spec

**Date:** 2026-07-05
**Status:** Approved (design), Phase 0 in implementation
**Device:** Paygo SP630PRO ECR — a Turkish *Yeni Nesil ÖKC* (next-gen fiscal cash
register) by Token/Paygo that bundles a bank-card EFT-POS **+** a fiscal engine **+**
a thermal *mali fiş* printer in one box, reachable over **Ethernet (LAN) / USB / 4G**.
Driven over **GMP-3** (GİB Mesajlaşma Protokolü): the ÖKC is the fiscal master and
our POS software is the TCP client. Every financial message sits behind a
**mandatory certificate-based secure pairing** (DH + PÖKC cert → AES-CBC + HMAC),
so a socket cannot just send a sale.

## Goal

Integrate this specific device — and, by construction, the whole family of Turkish
GMP-3 ÖKCs (Beko, Hugin, Profilo, Ingenico, Verifone, Pavo, …) — into the existing
platform, doing the **most comprehensive, production-grade** engineering. Ship
**INERT / simulator-first**: everything is built and tested but cannot move real
money until certified hardware + the Token vendor artifacts land (Phase 1).

Two rails, because "every sale needs a fiş":
- **Card sale** → the SP630 charges the card **and** prints the fiş in one atomic
  op (`fiscal_coupled`) via the **payment-terminal** rail.
- **Cash / meal-card / non-card sale** → the SP630 prints the mali fiş via the
  **fiscal-core** rail.
Both command families land on the **same** on-prem Rust driver, because it is one
physical device.

## What already exists (grounding — verified against source)

- **payment-terminal module** (`backend/src/modules/payment-terminal/`) —
  `PaymentTerminalProvider` contract (`kind: bridge|in_process`, `buildSaleCommand`/
  `mapAck`, `activatable` gate, `TerminalCapability` incl. `fiscal_coupled`).
  Adapters: `simulator` (real, fake money), `gmp3_card` (scaffold, our template),
  `bank_ecr`, `softpos`. Full money-safety in `payment-terminal.service.ts`
  (charge-before-record, `recoverApprovedUnrecorded` cron, `NEEDS_REVIEW`, guarded
  `updateMany`, `void_card`). `resolveTerminal` matches only `ACTIVE|SIMULATOR`
  (`ACTIVE_STATES`) → registered rows default `CONFIGURED_NOT_ACTIVE` → **inert**.
- **fiscal-core module** (`backend/src/modules/fiscal-core/`) — `FiscalProvider`
  contract + `Gmp3FiscalProviderBase` that frames the full GMP-3 payload (dept A–H
  by KDV, tender codes, integer-kuruş lines) and **enqueues** `fiscal_receipt`/
  `fiscal_cancel`/`fiscal_report` onto the device-mesh queue. Thin brand subclasses:
  `fiscal_hugin`, `fiscal_beko` (our template), `mock`, `efatura`.
- **device-mesh + Rust local-bridge** — cloud→hardware via idempotent
  `DeviceCommand` rows; money/fiscal kinds are `NON_RETRYABLE` on both sides
  (`CommandQueueService.NON_RETRYABLE_KINDS`, Rust `MONEY_TOKENS`). Real TCP write
  exists for ESC/POS (`drivers/escpos.rs::write_tcp`, write-only). `LocalDriver`
  trait + `Registry` dispatch by `payload.target`. `Device.bridgeId →
  LocalBridgeAgent` relation already models "device behind a bridge".
- **Operator UI** — Branch Device Hub (pair the box), Settings→Card Terminals
  (`PaymentTerminalsSettingsPage.tsx`, register + `CONFIGURED_NOT_ACTIVE→ACTIVE`),
  Fiscal Devices (`FiscalRecoveryPage.tsx`). Adding a provider = module registration
  + one FE label. **No schema migration** (`PaymentTerminalRecord.providerId` is a
  free string, config rides in `config Json?`).

## The gaps this spec closes

1. **No real GMP-3 transport driver** in the bridge (card + fiscal paths dead-end).
2. **Dispatch routes by `payload.target`**, but the GMP-3 backend adapters emit
   `protocol:"GMP3"`+`vendorProfile` with **no `target`** → nothing routes.
3. **cloud↔bridge command loop is unwired**: the Rust bridge polls
   `GET /v1/bridges/:id/commands/next` (**404 — route absent**) and acks with
   `Authorization: Bridge` to a `Device`-guarded route (**401**). The `LocalBridge`
   controller serves only `claim` + `heartbeat`. A closed fiscal box can't
   self-poll, so the bridge must front it → this loop is required for real operation.
4. **No Paygo backend adapters, no vendor procurement artifact.**

## Architecture — vendor-neutral `gmp3` core + per-vendor profiles

Because GMP-3 is a GİB standard shared by every certified ÖKC, the Rust bridge is
built **protocol-first, not vendor-first**: one `gmp3` driver + a profile registry
keyed on `vendorProfile`. Paygo (`paygo.sp630`) is profile #1; Beko/Hugin/… are a
profile file each later. Engineering reuse is high; **certification is not** —
every brand still needs its own vendor SDK/cert/test-device/authorization.

## Contracts (pinned — do not drift)

### Command payloads (cloud → bridge)

**Coupled card** (`PaygoEcrTerminalProvider.buildSaleCommand`, `kind:"charge_card"`):
```jsonc
{
  "protocol": "GMP3",
  "vendorProfile": "paygo.sp630",   // overridable via terminal.config.vendorProfile
  "sdkVersion": "3.2.1",
  "fiscalSerial": "<terminal.serial>",
  "tenantId": "...", "branchId": "...|null", "orderId": "...",
  "amountCents": 12345, "currency": "TRY",
  "fiscal": { /* TerminalFiscalContext: lines/KDV/payments/customer */ } | null
}
```
**Fiscal** (`PaygoFiscalProvider` via base, kinds `fiscal_receipt|fiscal_cancel|fiscal_report`):
same `{protocol:"GMP3", vendorProfile:"paygo.sp630", fiscalSerial, …}` shape the base
already builds. Neither payload carries `target`.

### Ack result keys (bridge → cloud) — read by `mapAck` / `mapReceiptOutcome`
- Card: `{ approved: bool, approvalCode, rrn, cardBrand, maskedPan, fiscalNo }`
  (approve ONLY on `approved === true`; `fiscalNo` present ⇒ coupled fiş printed).
- Fiscal: `{ fiscalNo, fiscalZNo, zNo, openedAt, closedAt, totals, deviceStatus, error, raw }`.

### Bridge dispatch routing (`drivers/mod.rs`)
`payload.target` wins (existing: `escpos`). Else if `payload.protocol == "GMP3"` →
driver kind `"gmp3"`. Backward compatible; escpos unaffected.

### GMP-3 driver (Rust, `kind = "gmp3"`)
- Selects a `VendorProfile` from the profile registry by `vendorProfile`
  (`paygo.sp630` registered; unknown → honest error).
- Reads on-prem `gmp3.toml` (bridge `data_dir`): `fiscalSerial → { host, port,
  mode: "simulator"|"real", cert paths… }`. Absent/misconfigured → fail closed.
- `mode="simulator"` → deterministic outcome (APPROVED + `SIM-…` approval + fake
  `fiscalNo`), **no hardware** — mirrors the backend simulator so the whole rail is
  testable on the bridge without a device.
- `mode="real"` → **Phase 1** real handshake/TLV/AES-HMAC. **Phase 0: fail closed**
  with a clear "not certified — configure mode=simulator" error. NEVER a fake `done`.
- Handles `charge_card | void_card | fiscal_receipt | fiscal_cancel | fiscal_report
  | capability_probe`.
- Transport: a real bidirectional TCP client (connect-timeout + write + read-reply
  with timeout), loopback-tested — generalizes `escpos::write_tcp` with a read half.

### Bridge command fan-in loop (additive)
- **Backend** `LocalBridgeController` (BridgeTokenGuard):
  - `GET /v1/bridges/commands/next` → claim next queued command across the bridge's
    own devices (`Device.bridgeId = req.bridge.id`), return `[cmd]` or `[]`.
  - `POST /v1/bridges/commands/:commandId/ack` → resolve the command's device via
    the bridge, then the existing scoped `CommandQueueService.ack`.
  - `CommandQueueService.claimNextForBridge(bridgeId)` — same `FOR UPDATE SKIP
    LOCKED` claim, scoped `deviceId IN (SELECT id FROM devices WHERE bridgeId=$1)`.
- **Rust** `cloud_ws.rs`: `get_next_commands` → `GET /v1/bridges/commands/next`
  (bridge id from token, drop the path id); `post_ack` → `POST
  /v1/bridges/commands/{id}/ack`. Both keep `Authorization: Bridge`. Existing
  per-device `/v1/devices/*` loop is untouched (self-polling devices unaffected).

## Deliverables (Phase 0 — all INERT, all tested)

**Backend (TS)**
- `payment-terminal/providers/paygo-ecr-terminal.provider.ts` — `id="paygo_ecr"`,
  `vendorProfile="paygo.sp630"`, `activatable=false`, caps `[sale,void,
  fiscal_coupled,query_last]`; `buildSaleCommand`/`mapAck` (gmp3_card shape) + spec.
- `fiscal-core/adapters/paygo-fiscal-provider.ts` — extends `Gmp3FiscalProviderBase`,
  `id="fiscal_paygo"`, `vendorProfile="paygo.sp630"` + spec.
- Register both in their modules.
- `device-mesh/command-queue.service.ts` — `claimNextForBridge` + specs.
- `local-bridge/local-bridge.controller.ts` + `.service.ts` — fan-in routes + specs.

**Rust bridge (`apps/local-bridge-agent`)**
- `src/drivers/gmp3/mod.rs` (driver), `protocol.rs` (framing/TLV/seq + crypto trait,
  fail-closed default), `profiles.rs` (`VendorProfile` + registry + paygo), and a
  bidirectional `transport.rs` (or reuse) — plus a `gmp3.toml` loader. Registered in
  `drivers/mod.rs::Registry::init`.
- Dispatch protocol-routing in `drivers/mod.rs`.
- `cloud_ws.rs` URL swap to the bridge fan-in routes.
- Unit tests for: profile selection, simulator outcomes, fail-closed real mode,
  transport loopback round-trip, protocol routing.

**Frontend**
- `PaymentTerminalsSettingsPage.tsx` — `paygo_ecr` label.
- `FiscalRecoveryPage.tsx` — `fiscal_paygo` (Paygo) option.

**Docs**
- `docs/integrations/paygo-token-gmp3-onboarding.md` — the vendor procurement
  checklist (what to obtain from Token/Paygo) + the Phase-1 go-live runbook.

## The hard dependency (Phase 1 — from Token/Paygo)
1. SP630-correct **GMP-3 SDK + message-mapping doc** (confirm the language — the
   public portal SDK is C#/.NET+C++ for Android devices; the Linux SP630 may use the
   older SP-generation lib). We are Rust-first → either reimplement the handshake in
   Rust from the GİB spec (C1, chosen) or FFI/sidecar the vendor lib (C2).
2. **Test/dev SP630** (or vendor simulator) — cert pairing needs real hardware.
3. **GMP3 value-added service activation + TSM firma kodu** (merchant provisioning).
4. **Written pairing authorization** ("uyumlu hale getirme").
5. **PÖKC cert chain + handshake params** (DH group, AES/HMAC scheme, İşlem Sıra No,
   port).

## Non-goals (this pass)
- Real GMP-3 handshake/crypto (Phase 1). 4G/USB transport (LAN first). Android portal
  SDK FFI/sidecar (chose Rust-native). Real acquirer/PSP certification.

## Safety / INERT proof
- `paygo_ecr.activatable === false` → `setActivation("ACTIVE")` throws; `SIMULATOR`
  is simulator-provider-only → paygo_ecr can only sit `CONFIGURED_NOT_ACTIVE` →
  `resolveTerminal` never selects it. Real POS card flow unchanged.
- `fiscal_paygo` only issues when an operator registers a `fiscal_paygo` device AND
  links a mesh device; absent that, `resolveMeshDevice` throws. No tenant has one.
- Rust `gmp3` driver `mode="real"` fails closed (never fake `done`); money/fiscal
  kinds stay `NON_RETRYABLE` (no double-charge/double-fiş on a lost ack).
- Bridge fan-in routes are additive; the per-device loop is untouched.

## Reversibility
No DB migration is introduced (free-string providerId + existing `Device.bridgeId`).
If a migration becomes necessary during implementation it ships as a reversible
up/down pair per the repo rule. All new code is removable without data effects.
