# Paygo SP630PRO ECR (GMP-3 ÖKC) — onboarding & go-live runbook

This is the operator/integrator checklist for taking the Paygo **SP630PRO ECR**
(and any other Turkish *Yeni Nesil ÖKC*) from the shipped INERT skeleton to a
certified, money-moving integration.

The engineering is built and tested (Phase 0, ships INERT). What remains before a
real device can charge a card or print a fiş is a **vendor dependency** on
Token/Paygo — the certificate-based GMP-3 pairing is a hard gate that public GİB
docs alone cannot bypass. This document lists exactly what to obtain and the
order to do it in.

## What the device is

Token/Paygo SP630PRO ECR — one box that is a **bank-card EFT-POS + fiscal engine
+ mali-fiş thermal printer**, on **Ethernet / USB / 4G**. Driven over **GMP-3**
(GİB Mesajlaşma Protokolü): our software is the TCP client, the ÖKC is the fiscal
master. Every financial message is behind a **certificate-based secure pairing**
(Diffie-Hellman + PÖKC cert validation → AES-CBC + HMAC, sequence-numbered).

## What is already built (Phase 0 — INERT, tested)

- **Backend** — `paygo_ecr` payment-terminal provider (coupled card + fiş,
  `activatable=false`) and `fiscal_paygo` fiscal-core provider (cash/non-card
  fiş). No DB migration; provider ids are free strings.
- **Bridge** — vendor-neutral `gmp3` driver (`apps/local-bridge-agent/src/drivers/gmp3/`)
  with the Paygo profile, a real bidirectional TCP transport, and a simulator
  mode; protocol-based command routing; the cloud↔bridge command fan-in loop.
- **Operator UI** — Paygo appears in Settings→Card Terminals and the Fiscal
  Devices panel.
- **Safety** — `paygo_ecr` cannot be activated (`activatable=false`) and the
  bridge's real mode fails closed, so nothing moves real money until Phase 1.

You can exercise the ENTIRE flow today with the simulator (see "Testing now").

## What to obtain from Token/Paygo (the hard dependency)

Request these from Token/Paygo (Koç fintech / Token Finansal Teknolojiler),
ideally via your acquiring bank or the Token integration/partner desk:

1. **GMP-3 SDK + integration/message-mapping document for the SP630
   specifically.** Confirm the delivery: the public Token developer-portal SDK
   (`IntegrationHub`, C#/.NET + a C++ lib) targets the newer **Android** devices;
   the Linux **SP-generation** SP630 may need the older SP-family library. Ask
   which one applies and in what language. *(Why: this defines the wire framing,
   the handshake, and the crypto we must implement in the Rust bridge.)*
2. **A test / development SP630 unit** (or a vendor simulator, if offered). The
   certificate pairing needs real hardware to validate. *(Why: we cannot certify
   a handshake we cannot run.)*
3. **GMP-3 value-added service activation + TSM firma kodu** (merchant/firm
   provisioning on the device and the TSM). *(Why: the device won't accept a
   pairing until the GMP-3 service is enabled and the merchant is provisioned.)*
4. **Written pairing authorization ("uyumlu hale getirme").** Token must formally
   authorize our application to pair with their devices. *(Why: the cert
   handshake is a closed gate; authorization is prerequisite, not optional.)*
5. **PÖKC certificate chain + handshake parameters** — the DH group, the AES/HMAC
   scheme, the İşlem Sıra No (transaction sequence number) rules, and the TCP
   port the device's GMP-3 server listens on. *(Why: these are the exact inputs
   the Rust handshake needs; without them the transport stays fail-closed.)*

Architectural note: Token's SDK is C#/.NET or C++, which does **not** drop into
our Rust bridge. Two options once #1–#5 land:
- **C1 (chosen):** reimplement the GMP-3 handshake/TLV/crypto natively in Rust
  from the GİB spec + Token's message doc. Max control, no extra runtime, fits
  our Rust-first stack; needs the PÖKC cert chain and a real device to validate.
- **C2 (fallback):** FFI-wrap Token's C++ lib or run a thin sidecar in the SDK's
  language on the bridge box. Faster to a certified handshake, but adds a non-Rust
  runtime dependency to the bridge.

## Phase 1 — implementation checklist (once #1–#5 are in hand)

1. In `drivers/gmp3/protocol.rs`, implement the real GMP-3 framing (TLV / STX-ETX),
   the DH + PÖKC cert handshake, and AES-CBC + HMAC with the İşlem Sıra No, on top
   of the existing `transport::TcpEndpoint`.
2. Wire the real path in `drivers/gmp3/mod.rs` (`execute` → build request →
   `request_reply` → parse → outcome) and flip `paygo.sp630`'s
   `real_impl_ready = true` in `profiles.rs`.
3. Thread the acquirer `idempotencyKey` end-to-end so a retry is safe (the queue
   parks-not-retries money kinds until this is proven).
4. Certify on the test SP630: run charge / void / cash-fiş / Z-report against the
   real device; verify the mali fiş prints and the `fiscalNo`/RRN come back.
5. Flip `paygo_ecr`'s `activatable` (remove the `= false`) once certified.

## Go-live runbook (per branch, on certified hardware)

1. **Pair the box** in the Branch Device Hub (`/admin/branches/:id` → Cihazlar),
   creating a device slot of kind `yazarkasa` / `pos_terminal`.
2. **Register the terminal** in Settings→Card Terminals with provider
   `paygo_ecr`, the device serial, and link the paired device. It starts
   `CONFIGURED_NOT_ACTIVE`.
3. **Register the fiscal device** in the Fiscal Devices panel with provider
   `fiscal_paygo` (for cash/non-card fiş), linked to the same mesh device.
4. **Configure the bridge** — add a `[[device]]` to `gmp3.toml` on the on-prem
   bridge with `mode = "real"`, the ÖKC's LAN `host`/`port`, and the cert paths.
5. **Activate** — once the Phase-1 handshake is certified and `activatable` is
   flipped, set the terminal `ACTIVE` in Settings→Card Terminals. `resolveTerminal`
   now selects it and POS "Ödemeye geç → KART" drives the real device.
6. **Verify** — run one live card sale (card charged + fiş printed) and one cash
   sale (fiş printed), and confirm a Z report.

## Testing now (no vendor dependency)

- **End-to-end POS flow:** use the existing `simulator` payment-terminal provider
  (register + set `SIMULATOR`) to exercise charge → record → recovery.
- **Bridge GMP-3 rail:** add a `gmp3.toml` `[[device]]` with `mode = "simulator"`
  (see `gmp3.toml.example`). The `gmp3` driver returns deterministic, clearly
  `SIM-`/`SIMFIS-`-prefixed approvals and fiş numbers — no hardware, no real money.
- **Unit tests:** `cargo test` in `apps/local-bridge-agent` and the backend
  `paygo-ecr-terminal.provider.spec.ts` / `paygo-fiscal-provider.spec.ts` cover
  the adapters, routing, simulator outcomes, and fail-closed real mode.

## Adding another ÖKC brand later

Because every certified Turkish ÖKC speaks GMP-3, a new brand (Beko, Hugin,
Profilo, Ingenico, Verifone, Pavo, …) is a small delta: one `VendorProfile` entry
in `profiles.rs` (+ its cert/handshake quirks in `protocol.rs`), a thin backend
adapter (clone `paygo_ecr` / `fiscal_paygo`), and one FE label. The GMP-3 core is
reused. **Certification is not reusable, though** — each brand needs its own
vendor SDK, cert chain, test device, and written authorization, exactly like the
list above.
