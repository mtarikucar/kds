# Uzbekistan Expansion — Full-System Integration Benchmark

> **Purpose.** This document is the single source of truth and the *scorecard* ("benchmark")
> for taking the KDS restaurant POS/KDS platform live in Uzbekistan. It is grounded in (a) an
> adversarially fact-verified research pass on Uzbek fiscal/payment/e-invoice/legal/currency rules
> (sources + confidence inline) and (b) a file-level map of the exact code seams that must change.
> Treat the **Benchmark Scorecard** (§12) as the go/no-go gate: a workstream is "done" only when
> its acceptance criteria pass.

| Field | Value |
|---|---|
| Status | **DRAFT — awaiting review** |
| Created | 2026-07-15 |
| Owner (platform) | _TBD_ |
| Owner (UZ partner / legal) | _TBD_ |
| Locked decisions | 1) **Separate in-country UZ region** · 2) **Local partner / reseller** operating model · 3) **Full-parity MVP** (fiscal receipt + local payments + UZS/language + e-invoice) |
| Codebase baseline | prod v3.2.117 · single-region (Turkey), TRY-locked, adapter/registry architecture already in place |

---

## 1. Executive summary

The platform is **architecturally ready** for a new country: fiscal, online-payment, card-terminal
and delivery integrations already sit behind provider **interfaces + registries** (adapters
self-register by a free-form `providerId` string — no enum/migration to add one), and `uz` + `ru`
locales already ship. The expansion is therefore **new adapters + a per-region policy layer + legal/
ops setup**, not a rewrite.

The hard part is **not the code seams — it is Uzbekistan's compliance surface and its lead-time
dependencies**, which must be booked in parallel from day one:

- **Fiscalization is mandatory and centralized.** Every cash/card settlement with the public must be
  captured by a fiscal module and transmitted online to the **single state OFD** (SUE "Yangi
  Texnologiyalar", `ofd.uz`/`ofd.soliq.uz`); the receipt carries a fiscal sign + a
  `https://ofd.soliq.uz/check?...` QR. There is **no open self-serve fiscal API**; the exact
  virtual-cash-register transport is the #1 open question.
- **UzQR is already live and mandatory** (since **2026-07-01**, Decree PF-246; operator **MUNIS**,
  0.65% merchant fee). Any UZ tenant operating a till without QR acceptance is in a fine-exposed
  window **today**. This cannot be a post-MVP follow-up.
- **Every menu line needs an IKPU/MXIK national catalog code** on both the fiscal receipt and the
  e-invoice. The `Product` model has no such field — this is a mandatory data workstream that blocks
  the first legal receipt.
- **e-Invoices (ЭСФ) require an E-IMZO PKCS#7 signature whose private key lives on the client
  device.** A cloud SaaS cannot sign unattended without either (a) delegating to a licensed operator
  (Didox / Faktura.uz) or (b) custodying each tenant's key — an explicit architecture decision.
- **Money is a 100× trap.** UZS displays with **0 decimals** but the wallet APIs (Payme, Uzum)
  transact in **tiyin (amount × 100)**. The money layer is TRY/2-decimal today. A single minor-unit
  policy must land before any amount crosses a payment or fiscal wire.
- **Data-residency law was *narrowed* on 2026-03-27** (Law ZRU-1125): only **biometric, genetic and
  telecom-user** data must stay in Uzbekistan; ordinary customer/staff data may now be offshore under
  conditions. This *relaxes* the residency rationale — but the personnel module's **biometric
  clock-in** data still hard-requires in-country storage, which validates the separate-region choice.
- **The local legal entity is the master dependency.** Fiscal/KKM registration, ЭСФ-operator
  onboarding, payment-merchant accounts, EDS token issuance, SMS alpha-name (legal-entity-only) and
  the personal-data-DB registration **all** require the resident entity/partner to exist first.

**Bottom line:** engineering is ~**L/XL across 8 workstreams**, but the critical path is set by
partner/ops lead times (entity → EDS → merchant/OFD/operator certification → alpha-name), so those
must start **now**, in parallel with the region/money/i18n platform foundation (which needs no
external credentials).

---

## 2. Operating model & the three locked decisions

### 2.1 Deployment — separate in-country UZ region
One codebase, per-region configuration. A **new UZ deployment hosted in Uzbekistan** with its own DB
and its own fiscal/payment stack, isolated from the Turkey region.

- **Still the right call**, even though the 2026-03 law change means most data *could* be offshore:
  it (a) trivially satisfies the **biometric** in-country requirement, (b) minimizes latency to UZ
  fiscal/payment APIs, (c) isolates the blast radius from Turkey, and (d) aligns with the local
  partner holding UZ infra/relationships.
- **Note (honest):** a lighter *hybrid* (app shared, only biometric + regulated data in UZ) is now
  *legally* permissible. We are **not** choosing it — but record it as a fallback if UZ ops cost is
  prohibitive.

### 2.2 Legal model — local partner / reseller
A **UZ-resident partner** holds the fiscal registration, ЭСФ-operator client account, payment-merchant
agreements, settlement bank account, EDS tokens and SMS alpha-name. We **license the platform** and
**integrate to their credentials**. Implications:

- The **partner (or the restaurant tenant) is the data controller/operator of record** and the
  taxpayer; the platform is a processor/software supplier.
- **Withholding tax:** royalties from the UZ entity to the platform vendor are **20% WHT** (Tax Code
  Art. 353), reducible under the **Türkiye–Uzbekistan double-tax treaty** with a valid tax-residency
  certificate. Build this into the reseller contract. _(confidence: high; treaty rate to confirm)_
- Every provider credential is **per-tenant/per-partner**, stored **encrypted** (reuse the existing
  `ENCRYPTION_MASTER_KEY` pattern) in `FiscalDeviceRecord.config` / `PaymentTerminalRecord.config`.

### 2.3 Scope — full-parity MVP (phased by dependency)
All four launch blockers are in scope: **fiscal receipt, local payments, UZS + language, e-invoice**.
Because their lead times differ, they are **sequenced** (§11), not shipped simultaneously.

---

## 3. Verified regulatory & market fact base

Confidence and primary sources per fact. **Verify items marked ⚠ against final Uzbek-language
primary text before go-live.**

### 3.1 Tax (QQS / VAT)
| Fact | Value | Conf. | Source |
|---|---|---|---|
| Standard VAT (QQS) | **12%** (since 2023, frozen through 2028) | High | PwC UZ tax summary; gazeta.uz 2024-12-31 |
| Voluntary simplified regime | **6%** for catering/trade/services, 2026-06-01 → 2029-12-31; **no input-VAT credit**, exempt from profit tax | High | spot.uz 2026-05-27/06-01; gazeta.uz 2026-05-26 |
| Zero rate | **0%** for exports & defined list (Tax Code Ch. 36, Arts. 260–264) | High | lex.uz 4674893; nrm.uz |
| Prices are **VAT-inclusive** (extract tax component) | matches existing `TaxCalculationService.extractTax()` | High | codebase |

> **Decision needed:** does each restaurant tenant elect **12%** (standard, with input credit) or the
> **6%** simplified regime? This drives the per-tenant tax rate. Default assumption: **12%**.

### 3.2 Fiscalization (OFD / online-KKM / virtual cash register)
| Fact | Value | Conf. | Source |
|---|---|---|---|
| OFD routing mandatory | Cash/card settlements with the public must transmit fiscal docs online to the state OFD | High | PKM No. **943** (23.11.2019); Decree **UP-5813** (06.09.2019); Tax Code **227-1** |
| Single state OFD | SUE "**Yangi Texnologiyalar**" (Scientific-Information Center) under the State Tax Committee; `ofd.uz` / `ofd.soliq.uz`; fiscal module distributed **free** (no Russia-style competitive OFD market) | High | soliq.uz; norma.uz |
| Receipt QR format | `https://ofd.soliq.uz/check?t=<TerminalID>&r=<ReceiptSeq>&c=<YYYYMMDDHHMMSS>&s=<FiscalSign>` (variant path `/epi`); **fiscal sign = `s`** | High | github abdullo211/fiscal_document; docs.bmms.uz; regos docs |
| Software usable via hardware **online-KKM** or software **virtual cash register (virtualnaya kassa)** | either is legal; a cloud POS targets the **virtual register** | High | PKM 943 |
| **IKPU / MXIK** catalog code per line | ⚠ Every fiscal-receipt line **and** ЭСФ line must carry a national catalog code (ИКПУ/MXIK) + package/unit + VAT attribute | Med (verify) | domain + critic; verify on soliq/lex |
| **Exact virtual-register API contract** (transport/auth/schema, shift open-close, Z-report) | **UNVERIFIED — open question #1** | Low | — |

### 3.3 Payments
| Provider | What / flow | API | Conf. | Source |
|---|---|---|---|---|
| **Payme (Paycom)** | wallet/QR + Uzcard/HUMO; **provider-calls-merchant JSON-RPC 2.0** | `developer.help.paycom.uz`; methods `CheckPerformTransaction/CreateTransaction/PerformTransaction/CancelTransaction/CheckTransaction/GetStatement` + `SetFiscalData`; Basic auth `base64("Paycom:KEY")`; **amounts in tiyin** | High | developer.help.paycom.uz |
| **Click** | wallet + **Click Pass** (customer-presented QR, merchant-scanned) | `docs.click.uz`; Shop API `Prepare`+`Complete` (md5 `sign_string`); Click Pass `POST api.click.uz/v2/merchant/click_pass/payment` (`otp_data`), auth `merchant_user_id:sha1(ts+secret_key):ts`; fiscalization supported | High | docs.click.uz |
| **Uzum Bank** | S2S REST + webhooks (Checkout / Merchant API / FastPay / Dynamic QR) | `developer.uzumbank.uz`; ops `check/create/confirm/reverse/status`; Basic auth + `serviceId`; **tiyin** | High | developer.uzumbank.uz |
| **UzQR (national)** | **MANDATORY since 2026-07-01** for all trade/service; static or dynamic QR interoperable across all bank apps + Humo/Uzcard | operator **MUNIS** (CBU interbank clearing); merchant fee **0.65%** (MUNIS 0.20%), buyer pays 0 | High | Decree **PF-246** (2025-12-10); CBU reg. Apr 2026; kun.uz/gazeta.uz Jun 2026 |
| Market reality | Trio ≠ 90%. 2024 shares ≈ **Click 33% · Paynet 15% · Payme 12%**, Uzum lower. Underlying rails = **UzCard + HUMO**. **Paynet** is top-3 and omitted by the trio | High (refutes "90%") | kapital.uz / pulbek.uz (Humo 2024) |
| Payment↔fiscal coupling | Payme `SetFiscalData` / Click fiscalization ⇒ wallet auth and fiscal-receipt data are **coupled**, legally required | High | provider docs |

### 3.4 e-Invoice (ЭСФ / elektron hisob-faktura)
| Fact | Value | Conf. | Source |
|---|---|---|---|
| Mandatory since | **2020-01-01** for VAT payers; buyer VAT offset **only** via electronic invoice | High | Cab. Decision **489** (2020-08-14) App.2 §10 |
| No open government API | Integrate via a **licensed operator** (~27 operators; roaming via E-Faktura/`rouming.uz`) — Cab. Res. **522** (2019-06-25) | High | edicom; vatupdate; buxgalter |
| Operator APIs (documented) | **Faktura.uz** (`api.faktura.uz/help`, Bearer via `/Token`; `ImportDocumentRegister`, `SignDocument`, `GetDocuments`, `SendDocument`, `VerifySignature`) · **Didox.uz** (`api-docs.didox.uz`; prod `api-partners.didox.uz`, test `testapi3.didox.uz`; `POST /v1/documents/{docId}/sign`, partner token) | High | api.faktura.uz/help; api-docs.didox.uz |
| **EDS signature (E-IMZO)** | **PKCS#7 mandatory**; private key on **client device** (`.pfx` in `C:\DSKEYS` or ID-card/USB token); signed client-side via E-IMZO desktop app + CAPIWS loopback WS (`127.0.0.1`); **server cannot sign** without holding the tenant's key+PIN | High (port `64443` low-conf) | github qo0p/e-imzo-doc; crpt-turon |
| Chek vs ЭСФ split | Tax Code **Art. 47**: no счёт-фактура to buyer when a KKM/virtual-cash **chek** is given for cash/individual-card retail; corporate-card sale → invoice on demand; seller still forms a **monthly one-sided consolidated ЭСФ** (⚠ whether required when cheki cover retail is **unsettled**) | High / Med | lex.uz; bss.uz; norma.uz |

### 3.5 Legal / data residency / language
| Fact | Value | Conf. | Source |
|---|---|---|---|
| Personal-data law | Law **ZRU-547** "On Personal Data" (2019-07-02) | High | dlapiper; cis-legislation |
| **Localization NARROWED** | Law **ZRU-1125** (in force **2026-03-27**) rewrote Art. **27-1**: only **biometric, genetic, telecom-user** data must stay in-country; other data may be offshore if 3 conditions met — **info-security requirements + international-standards compliance + oversight by Uzbek state bodies remains possible** (⚠ **not** EU SCC/BCR/adequacy — don't design to GDPR shape) | High | gazeta.uz/kursiv 2026-03-27; Dentons 2026-03-31 |
| Biometric exception | Personnel **face/fingerprint clock-in** data **must** be stored on UZ soil | High | kursiv.media 2026-03-27 |
| PD-database registration | Register in State Register via **pd.gov.uz** (Personalization Agency, MoJ); **~15-day** review before processing | High | dlapiper; azizovpartners |
| Penalties | Admin **Art. 46-2** (officials 50 BCV ≈ $1,250–1,400); repeat → criminal **Art. 141-2** (100–200 BCV, up to 3 yrs); website blocking + violators' register | High | gratanet; kun.uz; loc.gov |
| Receipt/label language | **Uzbek (state language) mandatory** on receipts/price tags; may duplicate in Russian; **receipt mandatory on every sale** | High (article #s Med) | State Language Law; Consumer Protection Law **221-I** (1996-04-26) |

### 3.6 Currency / i18n / geo
| Fact | Value | Conf. | Source |
|---|---|---|---|
| Currency | **UZS**, ISO 4217 numeric **860**; minor unit **tiyin** (100/som, **defunct** in circulation) | High | iban.com; Mastercard ISO 4217 |
| Display precision | **0 decimals** in practice (CLDR default is 2 → deliberate override); format `15 000 so'm` (space thousands, comma decimal, **currency word after**) | High | CLDR uz |
| **Wire precision** | Payme/Uzum transact in **tiyin (×100)** — display ≠ wire | High | provider docs |
| Language/script | Default **uz-Latn** (Latin mandate from 2023-01-01), **ru** strong alternate, **en** common; Cyrillic legacy-but-present | High | thediplomat; lex.uz |
| Phone | **+998**, NSN **9 digits** (2-digit area/operator + 7 subscriber), E.164 12 digits, region **UZ** | High | ITU E.164; Wikipedia |
| Timezone | **Asia/Tashkent**, UTC+5, **no DST** | High | timeanddate; IANA |

---

## 4. Target architecture — the per-region seam

Today the app is **hard-wired to Turkey**: there is **no `region`/`country` flag** on `Tenant`/`Branch`
(the `country`/`region` columns in schema are only on analytics models `PageView`/`Lead` and never
touch tenant behavior). Currency, tax, phone, fiscal, delivery and SMS are all chosen by **hardcoded
TR constants or the `currency === "TRY"` literal**.

**The seam we introduce:** a single `Tenant.region` flag (`"TR" | "UZ"`) as the source of truth,
threaded through the existing extension points:

```
Tenant.region ("UZ")
      │
      ├─▶ currency policy table  → UZS {taxRate 0.12, minorUnitDigits 0, wireMinorUnits 100, paymentProvider payme|click}
      ├─▶ i18n default locale    → uz-Latn / ru (getInitialLanguage)
      ├─▶ tax rate at write-time → Product.taxRate = 12 (QQS)   [column @default(10) is TR; set on create]
      ├─▶ phone region           → @NormalizePhone("UZ") / PhoneInput defaultCountry
      ├─▶ fiscal-core registry   → providerId "fiscal_uz_ofd"  (FiscalProvider, cloud-HTTP shape)
      ├─▶ payments-core registry → providerId "payme"/"click"/"uzum"  (PaymentProvider)
      ├─▶ payment-terminal reg.  → providerId "uz_qr" (in_process, activatable=false until certified)
      ├─▶ delivery AdapterFactory→ UZUM_TEZKOR / YANDEX_EATS   (PlatformAdapter)
      └─▶ SMS provider resolver  → Eskiz  (per-tenant, not process-global env)
```

**Adapter mechanics (verified from code):** all three provider subsystems (`fiscal-core`,
`payments-core`, `payment-terminal`) use *interface + `Map` registry + adapters that self-register on
`onModuleInit`*; `providerId` is a **free-form `String`** on every record (`FiscalDeviceRecord`,
`PaymentTerminalRecord`, `FiscalReceipt`). **A new provider needs no enum and no migration** — only a
new adapter class, an entry in the module's `providers[]`, and `registry.register(this)`. The façade
dispatches by the **literal `providerId`**, so registering an adapter is *necessary but not
sufficient*: the caller (`CheckoutIntentService`, self-pay, fiscal path) must **select** the UZ
provider by region, or the adapter is never dispatched. _(Memory: registered-but-never-dispatched
providers were deleted once — don't repeat that.)_

> **Reversible migrations:** every schema change below (region column, money-column widening, new
> UZ-specific columns, IKPU field) ships as a reversible **up/down** pair, backfilled and
> round-trip-verified (up → down → up), per the repo rule. No up-only migrations.

---

## 5. Workstream WS0 — Platform foundation (region + money + i18n + tax + phone)

**Needs no external credentials — start immediately, in parallel with legal setup.** Effort: **L**
(money) + **XL** (region/i18n/tax/phone/delivery/SMS seams).

### Code seams (verified files)
- **Region flag:** add `Tenant.region String @default("TR")` (+ optional `country`, `defaultLocale`)
  in `backend/prisma/schema.prisma`; reversible migration; backfill `'TR'`; set `region='UZ'`,
  `currency='UZS'`, `timezone='Asia/Tashkent'` in `auth-provisioning.service` for UZ signups.
- **Money / currency policy table (NEW):** central `Record<Currency, {taxRate, minorUnitDigits,
  wireMinorUnitFactor, paymentProvider}>`. Replace the three TRY literals:
  `quote.service.ts:241` (`currency === "TRY" ? TR_KDV_RATE : 0`), `billing.service.ts:79`
  (`isTurkish`), `kdv.helper.ts` default.
- **Currency allowlists (double-source!):** add `UZS` to **both** `frontend/src/hooks/useCurrency.ts`
  (`SUPPORTED_CURRENCIES`, currently locked to `['TRY']`) **and**
  `backend/src/common/constants/currencies.const.ts`, **plus** symbol maps in `lib/currency.ts` and
  `z-reports/currency-symbols.ts`. Update the tests pinning `['TRY']`.
- **Minor-unit formatting:** every hardcoded `minimumFractionDigits:2` / `toFixed(2)`
  (`lib/currency.ts`, escpos `money()`, `invoice-pdf.service.ts`, receipt-snapshot `fmt()`) must
  derive digits from the policy table (UZS = 0). **Two divergent formatter families exist**
  (`useFormatCurrency`/Intl is correct; the manual family is not) — fix both or screens ≠ receipts.
- **Tax:** `Product.taxRate`/`OrderItem.taxRate`/`SalesInvoiceItem.taxRate` all `@default(10)` (TR).
  Column defaults can't be region-conditional → **write `taxRate=12` at product create/seed time** and
  make the `?? 10` fallbacks region-aware (`combo-pricing.ts:203`, `fiscal-line-builder.ts`).
- **Phone:** `@NormalizePhone("TR")` is a **static literal across ~14 DTOs**; add region→country
  resolution and switch UZ call sites to `"UZ"`; `PhoneInput` `defaultCountry`/`buildCountryOptions`
  → `'UZ'`.
- **i18n default:** `getInitialLanguage()` (`frontend/src/i18n/config.ts`) is client-only; make it
  prefer `uz`/`ru` for UZ tenants (deliver region/defaultLocale with the session). `uz` namespaces
  are fully imported — **audit the 27 `uz/*.json` for translation completeness** ("wired" ≠
  "translated").

### ⚠ Money gotchas (money-correctness, not cosmetic)
- **Tiyin ×100 wire policy:** display 0 decimals **but** Payme/Uzum wire tiyin. Define one
  **conversion boundary** (store integer tiyin internally; convert at the adapter edge). Off-by-100×
  is the classic UZ money bug.
- **`Decimal(10,2)` overflow:** menu/order money caps at 99,999,999.99 — in UZS ≈ $8k. Catering or
  monthly subscription totals in som can overflow → widen to `Decimal(14,2)` (reversible migration)
  and store tiyin as integers where amounts cross wires.
- **Non-TRY currency currently gets 0% tax** — shipping UZS without the tax-policy change **silently
  under-taxes** UZ orders. Blocker.
- **ESC/POS code page:** thermal builder encodes **CP857 (Turkish)** and maps `₺`→`T`; Uzbek
  Latin/Cyrillic + `so'm` have no CP857 codepoint → **mojibake receipts**. Needs a code-page switch or
  transliteration (see WS7).

### Acceptance (benchmark)
A UZS tenant, end-to-end: settings save UZS; menu prices render `0-decimal so'm`; order + receipt
snapshot + Z-report + subscription invoice compute **12% QQS**; internal amounts are integer tiyin;
PayTR-backed flows fail **cleanly** with a UZ-appropriate message; no Decimal overflow at catering
magnitudes.

---

## 6. Workstream WS1 — Fiscalization (OFD virtual cash register) + IKPU/MXIK + UzQR

**The #1 blocker. Legally you cannot operate a till without it, and UzQR is already overdue.**
Effort: **L** (adapter) + **L** (IKPU data) + **M** (UzQR), gated on entity + OFD registration +
API-contract discovery + certification.

### 6.1 OFD fiscal adapter
- **NEW** `backend/src/modules/fiscal-core/adapters/uz-ofd-fiscal-provider.ts` implementing
  `FiscalProvider`, id `fiscal_uz_ofd`, capabilities `['receipt','cancel','z_report']`.
- **Cloud-HTTP shape** (model on the stateless `EfaturaFiscalProvider` *structure*, **not** its refusal
  behavior) — a UZ OFD is an online API, **not** a serial device on the local bridge, so do **not**
  use `Gmp3FiscalProviderBase` (unless a physical fiscal module is later bridged). Omit mesh
  `deviceId` (`FiscalService.registerDevice` allows it).
- `issueReceipt`: build fiscal check from `req.lines` (**integer tiyin**), submit to the OFD/virtual-
  register API keyed by `idempotencyKey`, return `fiscalNo` + attach the `ofd.soliq.uz/check?...` QR
  into `raw`. Honor the **3-state** result — a synchronous cloud OFD returns **`issued`** (or
  `failed`), never leaves it `queued` (that waits for a bridge ack that never comes).
- Add to `fiscal-core.module.ts` `providers[]`; **ship INERT** (fail-closed with an actionable
  message) until API key + certification; creds **encrypted** in `FiscalDeviceRecord.config`.
- `fiscal-line-builder.ts` default `?? 10` is TR KDV → UZ lines must carry **explicit 12%**.

> **OPEN QUESTION #1 (blocks this WS):** virtual-register software API vs certified hardware
> online-KKM — and the exact transport/auth/message schema + shift open-close + Z-report to Yangi
> Texnologiyalar/`ofd.uz`. **Resolve before coding the adapter body.** Likely fastest path: integrate
> a local fiscal-module SDK / an OFD-certified middleware the partner already uses.

### 6.2 IKPU / MXIK product classification (mandatory data workstream)
- ⚠ Add an **IKPU/MXIK code** (+ package/unit code + VAT attribute) field to `Product` (reversible
  migration) and to the fiscal-line + ЭСФ-line builders.
- Build **code-assignment tooling** (admin UI + bulk mapping) and **source the catalog**; validate
  codes against the tax catalog. **Blocks the first legal receipt** — every menu item needs a code.

### 6.3 UzQR / MUNIS (already mandatory)
- Integrate national **UzQR** acceptance (static + dynamic QR) via the **MUNIS** operating API;
  handle the **0.65%** merchant fee/settlement. Model the POS-present flow as a `payment-terminal`
  `uz_qr` provider (see WS2) **or** the payments-core QR mode.
- **OPEN QUESTION #2:** MUNIS operating-regulation/API, credential issuance, exact fine amount.

### Acceptance
A UZ order issues a **real fiscal check** with a scannable `ofd.soliq.uz/check` QR that verifies in
the Soliq app; each line carries a valid IKPU/MXIK; **UzQR** payment is accepted and fiscalized;
cancel + Z-report/day-close work; adapter is fail-closed until certified.

---

## 7. Workstream WS2 — Local payments (Payme / Click / Uzum + UzQR) + fiscal coupling

Effort: **L**, gated on merchant accounts (partner) + WS1 fiscal path.

### Code seams
- **NEW** `payments-core/adapters/payme-payment-provider.ts` (+ `click-`, `uzum-`) implementing
  `PaymentProvider`, ids `payme`/`click`/`uzum`, modes `['online','qr']`. **Env-gated registration**
  like `PaytrPaymentProvider` (register only if creds present).
- `createIntent`: **do NOT copy PayTR's `req.currency !== 'TRY'` reject** — accept **UZS**; return
  `clientAction {paymentUrl | qrPng | deeplink}`. `refund` → provider cancel/reverse.
- `parseWebhook` / callback — **each provider differs, verify precisely, don't assume PayTR's HMAC:**
  - **Payme** = server-to-server **JSON-RPC** the aggregator *calls into us* (`CheckPerformTransaction`
    /`CreateTransaction`/`PerformTransaction`/`CancelTransaction`), HTTP **Basic** `base64("Paycom:KEY")`,
    **tiyin** → likely needs a **dedicated controller route + small state machine**, verification in
    the adapter.
  - **Click** = `Prepare`/`Complete` with **md5 `sign_string`**; Click Pass = merchant-scanned
    customer QR, `sha1(ts+secret)` auth.
  - **Uzum** = `check/create/confirm/reverse/status`, Basic auth + `serviceId`, tiyin.
- **Thread provider selection by region** into `CheckoutIntentService`/self-pay (TR→`paytr`,
  UZ→`payme`/`click`) — the lone live caller passes the literal `'paytr'` today.
- **Payment↔fiscal coupling (legal):** wire the payment adapter to the WS1 fiscal rail so the wallet
  transaction carries the required fiscal data (Payme `SetFiscalData` / Click fiscalization). Not
  optional.

### Optional POS-present terminal
- **NEW** `payment-terminal/providers/uz-qr-terminal.provider.ts` modeled on
  `SoftPosTerminalProvider`: id `uz_qr`, `kind:'in_process'`, `activatable=false` (fail-closed) until
  certified; `charge()` calls the aggregator/UzQR dynamic-QR endpoint, polls, maps
  `APPROVED|DECLINED|TIMEOUT|ERROR`; **not** `fiscal_coupled` (the OFD rail issues the check).

### Scope note
- MVP payment set: **Payme + Click + Uzum + UzQR**. **Consider Paynet** (top-3, ~15%, omitted by the
  trio) and confirm **UzCard/HUMO** acquiring/settlement/refund/reconciliation with the partner's bank.

### Acceptance
UZS payment via each enabled rail creates an intent, confirms via verified callback, refunds, and
**attaches fiscal data**; provider is selected by tenant region; adapters register only with creds;
no PayTR path is reachable for UZ.

---

## 8. Workstream WS3 — e-Invoice (ЭСФ) via licensed operator + E-IMZO signing

Effort: **L–XL**, gated on operator contract (partner) + EDS tokens.

- **Integrate a licensed operator** (Didox **or** Faktura.uz — pick one, on commercial terms) via its
  documented REST API (Faktura: Bearer via `/Token`, `ImportDocumentRegister`/`SignDocument`; Didox:
  partner token, `POST /v1/documents/{docId}/sign`). Do **not** build against the government portal
  (no open third-party API).
- **Signing architecture — DECISION REQUIRED (open question #3):**
  - **(a) Operator-side signing** — delegate to Didox/Faktura if they support **unattended** signing
    on the tenant's behalf (⚠ confirm — the E-IMZO key is client-side by design). *Preferred if
    available* (no custodial key risk).
  - **(b) Custodial signing** — store each tenant's `.pfx` + PIN server-side and generate the PKCS#7
    ourselves (E-IMZO). Heavier security/compliance burden; only if (a) is impossible.
- Implement the **chek↔ЭСФ split** (Tax Code Art. 47): no per-buyer invoice for cash/individual-card
  retail; corporate-card → invoice on demand; **monthly one-sided consolidated ЭСФ** generation
  (⚠ confirm whether required when cheki already cover retail — open item).
- Build in the **Accounting module** (where e-documents already issue on order PAID for Turkey), region-gated.

### Acceptance
A B2B UZ order issues a valid EDS-signed ЭСФ via the operator that appears in `my.soliq.uz`; B2C cash
sales correctly issue **only** a fiscal chek; consolidated monthly ЭСФ generated per the confirmed rule.

---

## 9. Workstream WS4 — In-country hosting, data residency & PD registration

Effort: **L–XL** (infra), partner-gated (hosting + registration).

- **Stand up the UZ region** in an **in-country** data center/cloud (partner-selected UZ hosting).
  Own DB, own secrets, own fiscal/payment stack, isolated from Turkey.
- **Biometric data split (hard requirement):** the personnel module captures **face/fingerprint
  clock-in** (`clock-in.dto.ts`) — that biometric data **must** reside on UZ soil. Ensure the UZ
  region stores it locally; never replicate it to Turkey. Genetic + telecom-user data likewise (n/a
  here).
- **Ordinary data** (names, phones, orders, payroll basics) *may* be offshore under the 3 statutory
  conditions — but with a separate UZ region it's moot; keep it in UZ.
- **Personal-data-database registration:** register the UZ personal-data DB via **pd.gov.uz**
  (Personalization Agency); **~15-day** review **before** processing real UZ personal data. Blocks the
  first live tenant → start early.
- **Secrets hygiene:** a fresh region = fresh secrets. Do **not** reuse the Turkey secrets;
  ⚠ resolve the outstanding public-repo leaked-secrets risk before/with standing up UZ prod
  (see the existing security runbook).
- ⚠ **Obtain and read the final Uzbek-language ZRU-1125 / Art. 27-1 text** to confirm the 3
  cross-border conditions and registration exemptions — do **not** design the compliance layer on a
  GDPR-shaped misread (open question #10).

### Acceptance
UZ prod runs in-country; biometric clock-in data provably stays in UZ; PD-DB registered; UZ secrets
independent of TR; residency design signed off against primary law text.

---

## 10. Workstreams WS5–WS7

### WS5 — Delivery + SMS/OTP + telephony (Effort: L)
- **SMS/OTP:** NEW `EskizProvider implements SmsProvider` + case in
  `SmsService.initializeProvider()`. **Selection is process-global env today** → make it
  **per-tenant** (or run UZ as a separate deployment with `SMS_PROVIDER=eskiz`). Eskiz: JWT REST
  `notify.eskiz.uz/api` (`/auth/login`→Bearer, `POST /message/sms/send`). **Alpha-name: 300k UZS
  one-time, 1–2 month operator approval, legal-entities-only, one per company → start at kickoff**
  (gates all OTP/customer-verification). Play Mobile as secondary (`send.smsxabar.uz/broker-api/send`,
  Basic auth). ⚠ Eskiz text-moderation gate is uncertain — confirm.
- **Delivery:** add `UZUM_TEZKOR` + `YANDEX_EATS` to the `DeliveryPlatform` enum, implement each
  against `PlatformAdapter` (extend `base.adapter.ts`), add `AdapterFactory` switch cases, register in
  `delivery-platforms.module.ts`; ship **INERT** until creds. **Wolt is dead** (exited 2026-03-05) —
  not an adapter. Both remaining platforms are **partner-gated** (Yandex publishes readable docs at
  `yandex.ru/dev/eda-vendor` but credentials are gated; Uzum Tezkor = Client ID+Secret+EndPoint).
  **Decision:** direct adapters vs **middleware** (Delever / iiko / JOWi / r_keeper / REGOS).

### WS6 — Legal entity / reseller / tax structure (Partner-led — the master dependency)
- Stand up the **UZ-resident entity/partner** (data controller/operator of record, taxpayer).
- **VAT registration** of the entity; decide **12% vs 6%** regime for the restaurant tenants **and**
  the SaaS entity separately.
- **Reseller/licensing contract** with **WHT (20%, treaty-reducible)** and currency-control terms;
  obtain the **tax-residency certificate** for treaty relief.
- Provision **EDS/E-IMZO tokens** (in-person, lead time), **fiscal-module/KKM registration**,
  **payment-merchant accounts** (Payme/Click/Uzum/UzQR), **ЭСФ-operator client onboarding**.

### WS7 — Localization of fiscal artifacts (Effort: M)
- Guarantee **Uzbek (uz-Latn)** text on receipts/price tags/product names (legal); Russian optional
  duplicate.
- Solve the **ESC/POS CP857** problem (code-page switch or transliteration) so `so'm` + Uzbek glyphs
  print correctly on thermal printers.
- Ensure receipt-snapshot + escpos + invoice-pdf render UZS 0-decimal `so'm` and Uzbek strings.

---

## 11. Sequenced roadmap (dependency-ordered)

```
        ┌─────────────────────────────────────────────────────────────────────┐
Phase A │ MASTER DEPENDENCY — Local entity/partner (WS6)                       │  (partner, weeks)
START   │   → EDS tokens · fiscal/KKM registration · merchant accounts        │
NOW     │   → ЭСФ-operator onboarding · SMS alpha-name · PD-DB registration   │
        └───────────────┬─────────────────────────────────────────────────────┘
                        │ (these gate everything; long lead times)
   ┌────────────────────┴───────────────────┐
   ▼ (no creds needed — parallel)            ▼ (creds-gated)
┌────────────────────────────┐   ┌────────────────────────────────────────────┐
│ Phase B — Platform          │   │ Phase C — Fiscal + IKPU + UzQR (WS1)        │
│ foundation (WS0, WS4 infra, │   │  ⚠ overdue: UzQR mandatory since 2026-07-01 │
│ WS7 localization)           │   │ Phase D — Payments (WS2)  ── coupled to C   │
│  region · tiyin money ·     │   │ Phase E — ЭСФ (WS3)                          │
│  UZS · i18n · tax12 · phone │   │ Phase F — Delivery + SMS (WS5)               │
└────────────────────────────┘   └───────────────────┬────────────────────────┘
                                                      ▼
                                        ┌──────────────────────────────┐
                                        │ Phase G — Pilot go-live       │
                                        │  1st restaurant · compliance  │
                                        │  sign-off · Benchmark §12 pass │
                                        └──────────────────────────────┘
```

**Critical-path facts:**
- **Local entity (WS6) blocks EDS, fiscal/KKM reg, merchant accounts, ЭСФ operator, alpha-name,
  PD-DB reg** — start immediately.
- **Alpha-name = 1–2 months** operator approval → start at kickoff or OTP onboarding slips.
- **PD-DB registration = ~15 days** before any real UZ personal data in prod.
- **IKPU/MXIK coding of the full menu** blocks the first fiscal receipt regardless of code readiness.
- **Tiyin money refactor (WS0) must land before any amount crosses a fiscal/payment wire** —
  foundational, not incremental.
- **UzQR is already mandatory** — treat as Phase C, not a follow-up.

---

## 12. Benchmark scorecard (go/no-go gates)

A workstream counts only when **all** its criteria pass. This table *is* the benchmark.

| # | Workstream | Acceptance gate | Status |
|---|---|---|---|
| WS0 | Foundation | UZS tenant end-to-end: 0-decimal `so'm`, integer-tiyin internally, 12% QQS on order/receipt/Z-report/subscription, no Decimal overflow, PayTR flows fail cleanly | ☐ |
| WS1 | Fiscal + IKPU + UzQR | Real fiscal chek w/ verifiable `ofd.soliq.uz/check` QR; every line has valid IKPU/MXIK; UzQR accepted + fiscalized; cancel + Z-report work; adapter fail-closed until certified | ☐ |
| WS2 | Payments | Each rail (Payme/Click/Uzum/UzQR) creates intent, confirms via **verified** callback, refunds, **attaches fiscal data**; region-selected; env-gated | ☐ |
| WS3 | e-Invoice ЭСФ | B2B order issues EDS-signed ЭСФ via operator (visible in my.soliq.uz); B2C issues chek only; consolidated monthly ЭСФ per confirmed rule | ☐ |
| WS4 | Residency/hosting | UZ prod in-country; biometric clock-in provably UZ-only; PD-DB registered; UZ secrets independent; law text signed off | ☐ |
| WS5 | Delivery + SMS | Eskiz OTP live w/ approved alpha-name; ≥1 delivery platform integrated (or middleware) and INERT-until-creds | ☐ |
| WS6 | Legal/entity | Resident entity live; VAT regime chosen; reseller contract w/ WHT/treaty; EDS + merchant + operator + KKM + alpha-name + PD-DB all provisioned | ☐ |
| WS7 | Localization | Uzbek receipts/price tags/product names print correctly (ESC/POS code-page solved); UZS 0-decimal `so'm` everywhere | ☐ |
| GO | Pilot | One real restaurant runs a full day: fiscalized sales + UzQR + wallet payments + e-invoice (B2B) + compliant receipts, zero money/tax defects | ☐ |

---

## 13. Open questions & decisions required (owner + due)

| # | Question | Owner | Blocks |
|---|---|---|---|
| 1 | Fiscal path: **virtual-register software API vs hardware online-KKM**, and its exact transport/auth/schema (shift, Z-report) to Yangi Texnologiyalar/`ofd.uz`? | Platform + Partner | WS1 |
| 2 | **UzQR/MUNIS** operating-API, credential issuance, exact fine amount? | Partner | WS1/WS2 |
| 3 | **ЭСФ signing**: operator-side unattended (Didox/Faktura — which, terms) vs custodial `.pfx`+PIN? | Platform + Legal | WS3 |
| 4 | **IKPU/MXIK**: catalog source, per-item assignment UI, data migration — verify it is a hard blocker on lex.uz/soliq | Platform | WS1 |
| 5 | **Data-residency architecture** confirmed (separate UZ DB) + biometric store location + UZ hosting provider | Infra + Partner | WS4 |
| 6 | **Payment rails in MVP** (add Paynet? UzCard/HUMO acquiring via which bank?) + payment↔fiscal attach mechanism | Product + Partner | WS2 |
| 7 | **Tax regime** per tenant: **12% standard vs 6% simplified**; entity VAT registration; WHT treaty-cert process | Legal | WS0/WS6 |
| 8 | **Money policy**: single minor-unit boundary (store tiyin integer; convert at adapter edge) confirmed | Platform | WS0 |
| 9 | **Delivery**: direct adapters vs middleware (Delever/iiko/JOWi/r_keeper/REGOS); onboarding timeline | Product + Partner | WS5 |
| 10 | Read **final ZRU-1125 / Art. 27-1 Uzbek text** — confirm 3 conditions (not SCC/BCR) + registration exemptions | Legal | WS4 |
| 11 | **Sandbox/certification lead times & costs** for OFD module, ЭСФ operator, EDS, alpha-name, each merchant — the real critical path | PM | all |

---

## 14. Risk register (top)

| Risk | Impact | Mitigation |
|---|---|---|
| **UzQR already mandatory (2026-07-01 passed)** | Admin fines from day one | Prioritize UzQR into Phase C MVP; no live UZ tenant without it |
| **Tiyin ×100 confusion** | Every txn off by 100× (money bug) | Single conversion boundary; integer-tiyin storage; adapter-edge conversion; exhaustive money tests |
| **Non-TRY = 0% tax today** | Silent under-taxation of UZ orders | WS0 tax-policy table before any UZS order |
| **Registered-but-undispatched provider** | UZ adapter never runs | Thread region→provider selection into every caller; integration test dispatch |
| **E-IMZO client-side key** | Can't sign ЭСФ unattended | Prefer operator-side signing; custodial only as fallback w/ security review |
| **Entity lead times serial** | Go-live compresses/slips | Start WS6 now; book all certifications/sandboxes early |
| **ESC/POS CP857** | Mojibake Uzbek receipts (illegal) | Code-page/transliteration in WS7 before pilot |
| **Multi-mirror config drift** (currency ×3+, phone ×14) | Partial rollout bugs | Enumerate every mirror + its test; per memory this is where drift hides |
| **Decimal(10,2) overflow in UZS** | Failed large orders/invoices | Widen columns (reversible) + tiyin integers |
| **Leaked-secrets risk into new region** | Compromise of fresh UZ prod | Resolve runbook before/with UZ prod; independent UZ secrets |

---

## 15. Appendix — method notes & source confidence

- Facts above were produced by 6 parallel research agents (EN/RU/UZ sources) and **adversarially
  verified** claim-by-claim; each row carries confidence + primary source. Items marked **⚠** are
  explicitly *not fully settled* and must be confirmed against Uzbek-language primary text
  (lex.uz / soliq / provider docs) before go-live.
- **Under-verified (do before relying on them):** exact virtual-register/OFD machine API; UzQR/MUNIS
  API + fine amount; whether operators sign ЭСФ unattended; IKPU/MXIK legal basis; the monthly
  consolidated-ЭСФ requirement for retail; the precise Art. 27-1 cross-border conditions; Eskiz
  content-moderation gate; real combined wallet market share (the "90%" claim was **refuted**).
- **Codebase map** was produced by 3 agents reading the actual repo (`fiscal-core`, `payments-core`,
  `payment-terminal`, currency/tax/phone/i18n/delivery/SMS seams); file paths and line references are
  from prod v3.2.117.
- **Migration rule:** every schema/seed change here is a reversible **up/down** pair, backfilled and
  round-trip-verified, per repo policy.
