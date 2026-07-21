# Kyrgyzstan Expansion — Full-System Integration Benchmark (delta from Uzbekistan)

> **Purpose.** The single source of truth + scorecard for launching the KDS restaurant POS/KDS platform
> in **Kyrgyzstan**, the recommended *first market after Uzbekistan* (see `MARKET_EXPANSION_SCAN.md`).
> Written as a **delta from the Uzbekistan build** (`../uzbekistan/UZ_EXPANSION_BENCHMARK.md`): the
> architecture, adapter/registry seams, and `Tenant.region` policy layer are shared; this doc records
> what **carries over** vs what is **new/different** for KG. Grounded in 7 parallel research agents
> (RU/KY/EN primary sources) with adversarial fact-verification.
>
> **Verification status (honest):** the e-invoice, delivery/SMS, currency/i18n and market/competition
> dimensions completed their adversarial-verify pass. The **fiscal/tax, payments, and legal/residency**
> verify pass was cut short by a session limit — their findings are high-confidence and primary-sourced
> but marked **⚠ verify** where a claim is load-bearing. Re-run the verify pass before go-live.

| Field | Value |
|---|---|
| Status | **DRAFT — awaiting review** |
| Created | 2026-07-15 |
| Sequence | Market **#2** after Uzbekistan (highest UZ-code-reuse × live restaurant-forcing motion) |
| Deployment | **No separate in-country region required** — KG has **no data-localization law** (see WS4); KG tenants can run on the existing multi-tenant stack via the `region` seam. *Simpler than UZ.* |
| Legal model | Local partner **ОсОО** (LLC) reseller; **ФПО-operator** route is the strategic fiscal gate |
| Codebase baseline | prod v3.2.125 · shared adapter/registry architecture; `Tenant.region` seam introduced by the UZ program |

---

## 1. Executive summary — the deltas that matter

Kyrgyzstan is the **cheapest possible second deployment** (~70–80% of the UZ build reuses) *and* has a
**live, restaurant-specific forcing motion**. But it is not a copy of Uzbekistan — seven differences
drive the plan:

1. **ФПО = your POS *becomes* the fiscal channel (blocker AND entry door).** Under the ФПО pilot
   (Cabinet order №767-т of 08.09.2025 + ГНС order №510 of 11.09.2025), restaurants/bars **>100 m²** in
   Bishkek/Osh/Jalal-Abad **must run "fiscal software"** — the POS/accounting system itself —
   integrated with a **state-issued smart-card fiscal module** and transmitting **directly to ИС ГНС**,
   and (from 1 Feb 2026) uploading **monthly deep operational data**: per-check lines with
   waiter/table/service-%/discount, purchases, write-offs, inventory, even payroll. This is a
   **tailor-made door for a restaurant SaaS** (a foreign vendor operates through a local *оператор
   ФПО*). ⚠ **The pilot is a *Temporary Regulation* expiring 31 Jul 2026** (expanded to chain fast-food
   by disp. №136-т of 05.03.2026); ГНС reports +60% tax receipts → continuation likely but **not yet
   permanent** — confirm status.
2. **Dual tax on every receipt breaks the single-`taxRate` model.** A KG restaurant receipt carries
   **two** taxes per line — **НДС 12%** *and* **налог с продаж (НсП)** — with НсП rate driven by tax
   regime × VAT status × region × payment form. The UZ money engine has one VAT rail; **KG needs a
   second per-line tax rail + regime-aware rate resolution** (schema + pricing-calculator change).
3. **Payments are *easier* than UZ: one national QR (ELQR) reaches everyone.** ELQR (NBKR standard,
   operated by МПЦ/Elcart, live 2022) makes **one merchant QR payable from ~20 banks + 14 payment orgs
   via 32–34 apps** (MBANK, O!Dengi, Optima24, …). **One aggregator integration (Finik)** replaces the
   3+ per-wallet adapters UZ needed. Finik even embeds an online-KKM → **payment and fiscal are fused**;
   design them together to avoid double receipts.
4. **e-Invoice (ЭСФ) is *simpler* than UZ — no client-side signing.** Single government system
   (`esf.salyk.kg`), **no licensed-operator market**. Programmatic access is a **taxpayer-issued bearer
   "access token"** (`cabinet.salyk.kg` → Токены доступа) scoped to an accredited aggregator → **the
   server acts unattended, no per-document E-IMZO key ceremony** (the UZ blocker vanishes). One live
   aggregator: **Tumar App**. But B2C is **not** fully exempt like UZ Art.47 — a VAT-payer restaurant
   must file **one consolidated monthly ЭСФ** over KKM sales (new scheduled job).
5. **No data-localization law → no separate in-country region needed.** Neither the old Law 58 nor the
   new **Digital Code** (No. 178, in force 6 Feb 2026) requires KG servers; database registration was
   **abolished**. **Existing hosting stays** (opposite of the UZ separate-region decision). *Caveat:* a
   **DPIA is mandatory for the camera-occupancy feature** (Digital Code Art. 82).
6. **Kyrgyz (Cyrillic) locale is a *legal* requirement.** Constitutional Law No. 140 (2023, amended
   2025): software UI sold in KG **must have a Kyrgyz interface**; receipts/menus/price-lists Kyrgyz +
   optional Russian (**Russian-alone is not sufficient**). We ship `ru` but **no `ky`** — and Kyrgyz is
   **Cyrillic**, so the `uz` (Latin) set gives nothing to reuse. New locale required.
7. **Competition is Russian heavyweights + a free bank KKM.** Incumbents are **R-Keeper, iiko, Poster**
   (per the ГНС ФПО-operator registry), and **MBANK MKassa gives a free software-KKM + POS**. Compete on
   **restaurant workflow value (KDS, floor plan, combos, delivery)**, not on fiscal compliance alone.

**Bottom line:** engineering is ~**M/L** (less than UZ — no residency infra, one payment adapter, no
client-side signing, no IKPU catalog), but with **two genuinely new subsystems**: the **НсП second-tax
rail** and the **ФПО operational-data-upload reporting** track. The commercial gate is a **ФПО-operator
agreement with ГНС** via the local partner.

---

## 2. Market & commercial case

| Signal | Value | Source/conf. |
|---|---|---|
| Population | **7.28M** (Bishkek 1.32M) | Нацстатком, high |
| HoReCa count (proxy) | **~3,440 Bishkek + 885 Osh** catering points (2GIS, +53–57% in 2024) | verified; official series stale (2015: 4,120) |
| Restaurant sector revenue | **13.2 bn KGS (2024), +58% y/y**; tourism +45% (2025) | high |
| KKM installed base | 71k (2023) → 118k (2024) → **~131k (2025)** | high |
| Fiscal-forcing window | **LIVE** — ФПО pilot for catering (Sep 2025), expanded to chains (Mar 2026); ⚠ pilot **expires 31 Jul 2026**, extension likely-unconfirmed | verified (partially-correct: time-boxed) |
| Receipt lottery | ⚠ "Требуй чек" was a **2023 one-time** campaign, now **dormant** (site dead) — do **not** market against a live lottery | verified |
| QR payments boom | H1 2025: **167M QR payments, 274.9 bn KGS** (12–20× y/y); MBANK >3M users | NBKR, high |
| **Competition** | **R-Keeper, iiko, Poster** (+ Paloma365, EvoResto, Dodo IS, 1С); **MBANK MKassa = free KKM+POS** | verified from ГНС registry |
| Price anchor | Poster KG **$14–54/mo** + $19/extra terminal; MKassa **$0** bare fiscal | high |
| Channel | Dealer/franchise + **bank/telco bundling** (MBANK, Beeline); entry ≈ become/partner with a **ФПО operator** (ГНС interaction agreement) | high |

**Positioning:** above the free-KKM commodity floor, on **workflow depth** (KDS/floor-plan/combos/
delivery/analytics) — exactly the data the ФПО regime now *requires* restaurants to report, which we
already hold. Turkish origin + the UZ Elcart–HUMO/CIS knowledge is a sales asset.

---

## 3. Verified fact base (KG-specific)

### 3.1 Fiscalization & tax  ⚠ *verify pass pending (session limit) — primary-sourced, high-confidence*
| Fact | Value | Conf. |
|---|---|---|
| VAT (НДС) | **12%**; VAT-registration threshold 30M KGS / 12 mo | high |
| **Sales tax (НсП)** — 2nd receipt tax | VAT payers **1%** (trade/prod) / **2%** (other incl. catering); VAT-exempt 2–3%; mobile 5%. Cashless-0% incentive **expired 1 Jan 2023** | high ⚠ |
| Both taxes per line on receipt | ФФД tag 1003 = 1006 НДС + 1007 НсП; each item (1059) carries its own НДС+НсП rate codes | high |
| Unified tax (единый налог) — catering | Bishkek/Osh **6% cash / 4% cashless**; rest **4% cash / 2% cashless** (Tax Code art. 423) | high ⚠ |
| Fiscal data architecture | **Dual channel** — direct to ГНС **and/or** via **~6 accredited OFDs** (Нур Телеком/O!, Альфа/MegaCom, Скай Мобайл/Beeline, Telemedia…) — unlike UZ's single OFD | high |
| Software/virtual KKM | Legal; state cloud ФМ; commercial software-KKM APIs: **eKassa** (~500 KGS/mo/KKM), O!Kassa, MegaKassa, WebKassa, SMARTUCHET | high |
| **ФПО pilot** | POS-as-fiscal-software for restaurants **>100 m²** (Bishkek/Osh/Jalal-Abad), + monthly operational-data upload from 1 Feb 2026; **Temporary Regulation → 31 Jul 2026** | high (⚠ end-date/permanence) |
| Per-line catalog code | **No UZ-IKPU-style universal code**; tag 1162 conditional (ТН ВЭД/ГКЭД/EAN/GS1 DataMatrix); marking codes (alcohol/tobacco/dairy — Текшер) on receipts since 1 Apr 2024 | high |
| Wire format | ФФД Приказ №440 — **binary TLV** (Russia-style tags); relevant only at wire-level (commercial APIs abstract it) | high |
| Receipt QR | Verify at `kkm.gov.kg` / app "Проверка чеков ГНС КР"; exact QR URL params not published | medium |
| Offline | Real-time except outage (buffering); paper бланки backup; clock drift ≤5 min | high |

### 3.2 Payments  ⚠ *verify pass pending — primary-sourced*
| Fact | Value | Conf. |
|---|---|---|
| **ELQR** | Single interoperable national QR (NBKR, operator МПЦ/Elcart, live 2022); one QR ← ~20 banks + 14 payment orgs, 32–34 apps | high |
| Integration path | Not direct with МПЦ; via a participant. Best-documented: **Finik** (QuickPay) — API-key auth, static/dynamic QR, webhooks, refunds, split, Visa PayFac, SDKs, **built-in online-KKM**. Fallback: **Freedom Pay KG** (`docs.freedompay.kz`). **MBANK MKassa** / **O!Dengi** = partnership-gated, no public docs | high |
| Cashless mandate | **From 1 Jan 2026** businesses must accept cashless (cards/e-money/national QR); **personal/third-party QR for business banned** (fines) — cash not abolished | high ⚠ |
| Elsom | **Dead** (merged into KICB app, Feb 2025) | high |
| Card scheme | **Elcart** via МПЦ (+ Visa/MC acquiring ~1.5–2.5%); **Elcart–HUMO bridge** = UZ knowledge asset | high |
| Wire minor units | **UNCONFIRMED** — ELQR payload is decimal som; **do not assume Payme ×100**; per-adapter `wireUnit` config, confirm at onboarding | low |

### 3.3 e-Invoice (ЭСФ)  ✅ *verified*
| Fact | Value | Conf. |
|---|---|---|
| System | Single govt IS ЭСФ (`esf.salyk.kg`, test `testesf.salyk.kg`), ГНС/Салык Сервис; **no operator market** | high |
| Mandatory | All VAT payers since 1 Jul 2020; **issue within 5 working days** (since 1 May 2025, Res. #146) | high ✓ |
| B2C rule | **Not** UZ-Art.47 full exemption — VAT-payer restaurant files **one consolidated monthly ЭСФ** over KKM sales (buyer «ККМ», ИНН = 14×`9`) within **10 working days** after month-end | high ✓ |
| Programmatic access | **Taxpayer bearer "access token"** (`cabinet.salyk.kg` → Токены доступа), scoped to accredited aggregator, 30d–1y; live aggregator **Tumar App** (REST). No public govt REST docs (XML/XLSX batch) | high |
| **Signing** | **Server acts unattended via the aggregator token — no per-document E-IMZO ceremony** (UZ blocker gone). Cloud ЭЦП exists (Инфоком/KYZMAT) but **no public per-document signing API** — do not architect around DSS | high |
| ЭТТН (waybills) | Narrow — oil/alcohol/tobacco since 1 Jan 2025; restaurant relevance = **supplier-side alcohol only** | high |

### 3.4 Delivery + SMS  ✅ *verified*
| Fact | Value | Conf. |
|---|---|---|
| Delivery duopoly | **Glovo** (since Nov 2020; real **Partners API** — menu upload + order webhooks; `partner.integrationseu@glovoapp.com`) + **Yandex Eats** (Bishkek since 14 Mar 2024; acquired Namba Food Jul 2024; vendor API `yandex.ru/dev/eda-vendor`, **partner-hosted PULL** model). **Namba Food defunct** | high ✓ |
| Yandex reuse | If a Yandex Eats adapter was built for UZ (same platform), it **carries over** — only KG credentials/currency differ | high ✓ |
| SMS/OTP | **Nikita** (`smspro.nikita.kg`) default; JSON OTP API (`X-API-KEY`, `/api/otp/send`+`/verify`, idempotent `transaction_id`≤32); ~**1.24–1.45 KGS/SMS** | high ✓ |
| Alpha-name | Register in cabinet + email `names@nikita.kg`; **up to 10 business days** national approval; no fee; contract for accounting/non-cash | high ✓ (corrected from "~1 day") |

### 3.5 Legal / residency / language  ⚠ *verify pass pending — primary-sourced*
| Fact | Value | Conf. |
|---|---|---|
| **Data localization** | **NONE** — neither Law 58 nor Digital Code (No. 178, in force 6 Feb 2026) requires KG servers; foreign hosting lawful (cross-border = consent/contract until DPA adequacy list published) | high |
| DB registration | **Abolished** with the Digital Code | high |
| DPIA | **Mandatory for systematic automated monitoring of public places (Art. 82) → camera-occupancy feature** | high |
| **Language** | Constitutional Law No. 140 (2023, am. 2025): software UI **must have Kyrgyz**; receipts/menus/price-lists Kyrgyz + optional Russian (**Russian-alone insufficient**); fines 17,000 KGS/legal entity | high ⚠ |
| Entity | ОсОО (LLC, no min capital, 2–7 day Minjust); единый налог **4–6%** services / 2% software dev | medium |
| Royalty WHT | **10%** to Turkish licensor (Tax Code Art. 249(2)(3)); **Türkiye–KG DTT (1999) caps 10%** — apply via residency certificate | high |
| Direct-sales VAT | **12% "Google-tax"** on cross-border SaaS (`vat.salyk.kg`) → **avoid via local partner** | high |
| Currency control | **Liberal** — free repatriation, no capital controls | high |

### 3.6 Currency / i18n / geo  ✅ *verified*
| Fact | Value | Conf. |
|---|---|---|
| Currency | **KGS**, ISO 417, exponent 2; **tyiyn LIVE** (100/som) → store **integer tyiyn ×100** (UZ money core reuses) | high ✓ |
| **Cash rounding** | Cash tenders round to **nearest 50 tyiyn** (Gov/NBKR 631/35/10, 2011); **non-cash NOT rounded** → new cash-rounding rail | high ✓ |
| Display | `12 345,50 сом` (NBSP group, comma decimal, currency after); use **`сом`** (⃀ U+20C0 poor font support); use **`ru-KG`** explicitly | high ✓ |
| **Language script** | Kyrgyz = **Cyrillic** (not Latin like `uz`) → **new `ky` translation set**; `ru`→`ru-KG` tag/symbol override | high |
| Phone | **+996**, 9-digit NSN; libphonenumber region **KG** → PhoneInput/@NormalizePhone reuse (just enable KG) | high ✓ |
| Timezone / geo | **Asia/Bishkek UTC+6, no DST**; 7 oblasts + Bishkek/Osh (⚠ watch Apr-2026 okrug reform) | high ✓ |

---

## 4. Architecture — the KG delta on the shared seam

Reuse the `Tenant.region` seam from the UZ program; add `"KG"`. Because there is **no data-localization
law**, KG tenants can run on the **existing multi-tenant stack** — **no separate region/DB/hosting
workstream** (the single biggest UZ cost, gone). The region flag drives:

```
Tenant.region ("KG")
  ├─▶ currency policy → KGS {minorUnits ×100, cashRounding: 50-tiyin, wireUnit: per-adapter, taxes:[НДС, НсП]}
  ├─▶ i18n default    → ru-KG  (+ NEW ky Cyrillic locale, legally required)
  ├─▶ TAX ENGINE      → NEW second per-line tax (НсП) + regime×VAT×region×payment-form rate resolution
  ├─▶ fiscal registry → providerId "fiscal_kg_ofd" (software-KKM API)  OR  "fiscal_kg_fpo" (ФПО operator)
  ├─▶ payments        → providerId "elqr_finik" (one adapter reaches all wallets)  [+ card acquiring]
  ├─▶ e-invoice       → ЭСФ aggregator (Tumar / self-accredited), bearer-token unattended
  ├─▶ delivery        → GLOVO (+ YANDEX_EATS, likely reused from UZ)
  └─▶ SMS             → Nikita (per-tenant provider resolution)
```

**The one change that is NOT just a new adapter:** the **dual-tax (НсП) rail**. Everything else plugs
into an existing seam; НсП touches the Prisma money model, `order-pricing.calculator`,
`fiscal-line-builder`, receipt-snapshot, Z-report and analytics — plan it as a first-class WS.

> **Reversible migrations:** the НсП column(s), region config, and any KG-specific fields ship as
> reversible **up/down** pairs, backfilled and round-trip-verified, per repo rule.

---

## 5. What carries over vs new work (reuse map)

| Area | ✅ Reuse from UZ build | 🆕 New / different for KG |
|---|---|---|
| Region seam | `Tenant.region` flag + per-region policy table | `region='KG'` config values |
| Money core | integer minor-unit (tyiyn ×100), Decimal discipline | **cash-rounding to 50 tyiyn** (non-cash exact); **per-adapter `wireUnit`** (don't assume ×100) |
| **Tax** | VAT-inclusive extraction, per-line `taxRate` | **SECOND per-line tax (НсП)** + regime×VAT×region×payment-form resolution — **schema + calculator change** |
| Fiscal | `FiscalProvider` interface, registry, **INERT** pattern, shift/Z-report, refund-by-original idempotency, offline queue | KG driver (software-KKM API e.g. eKassa/Finik) **or become a ФПО operator**; **ФПО monthly operational-data upload subsystem**; dual-channel OFD/direct; ФФД TLV only at wire-level; **drop IKPU/MXIK entirely** |
| Payments | wallet-adapter shape, charge-before-record, NON_RETRYABLE/NEEDS_REVIEW, PaymentTerminal | **ELQR via Finik/Freedom Pay** (1–2 adapters vs 3+); payment↔fiscal **fused** (avoid double receipts) |
| e-Invoice | provider-adapter abstraction, INERT, outbox/retry/deadline-alerting, consolidated-invoice concept | **ЭСФ via ГНС bearer token** (Tumar or self-accredit); **unattended — no client-side signing** (UZ E-IMZO blocker gone); **monthly consolidated ЭСФ job** |
| Delivery | delivery-platforms adapters, **Yandex Eats adapter** (if built for UZ) | **Glovo Partners API adapter** |
| SMS | SMS provider abstraction, OTP flow | **Nikita** JSON-OTP adapter; alpha-name ops (~10 business days) |
| Legal/infra | local-partner reseller playbook, royalty **10% WHT + DTT**, consent artifacts ~70% | **NO data-localization → no separate region/DB** (big saving); **DPIA for camera feature**; Digital-Code consent/DPIA artifacts |
| i18n | `ru`→`ru-KG` tag/symbol override; phone infra (enable KG) | **`ky` Cyrillic locale — legal requirement** (uz Latin gives nothing) |
| Geo | two-level admin hierarchy, single-tz no-DST model | Asia/Bishkek UTC+6; 7 oblasts + Bishkek/Osh seed |

---

## 6. Workstreams

- **WS0 — Foundation delta (M):** `region='KG'`; KGS currency + **cash-rounding (50 tyiyn, cash-only)** + per-adapter `wireUnit`; `ru-KG`; phone KG; timezone Asia/Bishkek. *No residency/hosting WS.*
- **WS1 — Dual-tax engine (L, new):** add **НсП** as a second per-line tax; regime×VAT×region×payment-form rate resolution; surface both tax lines on receipt/Z-report/analytics/ЭСФ. **Blocks correct money** — non-negotiable, breaks the carried-over single-`taxRate` assumption.
- **WS2 — Fiscalization + ФПО (L):** KG fiscal adapter via a registered **software-KKM API** (fastest: eKassa/Finik) *or* pursue **ФПО-operator** status (ГНС interaction agreement) for >100 m² restaurants; **ФПО monthly operational-data upload** (per-check waiter/table/service%/discount, purchases, write-offs, inventory, payroll) — a reporting subsystem fed by data we already hold. Marking-code (Текшер) scan for alcohol/tobacco/dairy lines. INERT until credentials.
- **WS3 — Payments ELQR (M):** **Finik** adapter (create-invoice → QR/deeplink → signed webhook → idempotent match → poll fallback); **fuse with fiscal** so Finik's embedded KKM doesn't double-fiscalize; encode the **1 Jan 2026 cashless-acceptance mandate + personal-QR ban** in onboarding. Freedom Pay KG as fallback; Elcart/Visa/MC acquiring optional.
- **WS4 — e-Invoice ЭСФ (M):** ГНС **bearer-token** integration (contract **Tumar** or self-accredit as aggregator); **unattended signing** (no E-IMZO); **monthly consolidated ЭСФ** scheduled job (buyer «ККМ», 14×`9`, ≤10 working days); 5-working-day B2B rule.
- **WS5 — Delivery + SMS (M):** **Glovo Partners API** adapter (new); **Yandex Eats** (reuse UZ adapter, KG credentials); **Nikita** SMS/OTP adapter + alpha-name ops.
- **WS6 — Localization + legal (M):** **`ky` (Cyrillic) locale** (legal requirement) + bilingual KY/RU receipts; **DPIA** for camera-occupancy; Digital-Code consent artifacts; local **ОсОО** + reseller contract (10% WHT + DTT residency cert).

---

## 7. Sequenced roadmap

```
Phase A (partner, weeks) ── Local ОсОО + ФПО-operator agreement (ГНС) + ЭСФ aggregator (Tumar) +
                            software-KKM/Finik contracts + Nikita alpha-name (~10 business days)
        │  (master dependency — start now; lighter than UZ: no EDS-token ceremony, no PD-DB registration)
        ▼
Phase B (no creds) ── WS0 foundation + WS1 DUAL-TAX ENGINE + WS6 ky locale/DPIA   [start immediately]
        ▼
Phase C (creds-gated) ── WS2 fiscal/ФПО ── WS3 ELQR payments (fused) ── WS4 ЭСФ ── WS5 delivery/SMS
        ▼
Phase D ── Pilot go-live: 1 Bishkek restaurant, full day, ФПО-compliant, dual-tax-correct receipts
```

**Critical-path notes:** ФПО-operator agreement + software-KKM contract gate fiscal; **dual-tax (WS1)
must land before any KG receipt** (money-correctness); Nikita alpha-name ~10 business days; **no
data-residency, EDS-token, or PD-registration lead times** (all UZ blockers absent). ⚠ ФПО pilot legal
basis expires **31 Jul 2026** — confirm the successor/permanent regime before committing the fiscal
adapter shape.

---

## 8. Benchmark scorecard (go/no-go gates)

| # | Workstream | Acceptance gate | Status |
|---|---|---|---|
| WS0 | Foundation | KG tenant: KGS `сом` 2-decimal, **cash rounds to 50 tyiyn (cash only)**, ru-KG, +996, Asia/Bishkek; no PayTR path | ☐ |
| WS1 | Dual tax | Receipt/Z-report/ЭСФ show **both НДС 12% + НсП** per line; НсП rate correct per regime×VAT×region×payment-form | ☐ |
| WS2 | Fiscal + ФПО | Real fiscal receipt verifiable in ГНС app; **ФПО monthly operational-data upload** validated; marking-code lines handled; INERT until certified | ☐ |
| WS3 | Payments ELQR | Finik QR intent → verified webhook → refund; **no double fiscal receipt** (payment↔fiscal fused); cashless-mandate messaging | ☐ |
| WS4 | e-Invoice ЭСФ | B2B ЭСФ via bearer token (unattended) in 5 wd; **consolidated monthly ЭСФ** job runs (buyer «ККМ») | ☐ |
| WS5 | Delivery + SMS | Glovo Partners API live; Yandex Eats (reused) live; Nikita OTP with approved alpha-name | ☐ |
| WS6 | Localization/legal | **ky Cyrillic UI + bilingual receipts**; DPIA filed for camera; ОсОО + reseller contract (WHT/DTT) | ☐ |
| GO | Pilot | 1 Bishkek restaurant, full day: ФПО-compliant fiscalization + ELQR payments + dual-tax receipts + ЭСФ, zero money/tax defects | ☐ |

---

## 9. Open questions & risks

**Open questions (owner):**
1. **ФПО permanence** — does the pilot (expires 31 Jul 2026) become the permanent regime, and do we integrate as a **ФПО operator** (become one / partner) vs a **software-KKM API** (eKassa/Finik)? *This defines the fiscal adapter.* (Platform + Partner)
2. **НсП rate matrix** — exact catering НсП + unified-tax rates by regime × VAT status × region × payment form, for 2026. ⚠ verify with a KG accountant. (Finance)
3. **ЭСФ**: contract **Tumar** vs self-accredit as aggregator; token lifecycle (≤1y, rotation). (Platform + Partner)
4. **Payment wire units** — confirm Finik/ELQR som-vs-tyiyn per adapter at onboarding (don't assume ×100). (Platform)
5. **Payment↔fiscal fusion** — does Finik/MKassa's embedded KKM replace or duplicate our fiscal receipt? Define the boundary. (Platform)
6. **Re-run the adversarial verify pass** on fiscal/tax, payments, legal (cut by session limit). (PM)

**Top risks:**
- **Dual-tax miss** → every KG receipt mis-taxed (money-correctness). *Mitigate:* WS1 before any KG order; exhaustive tax tests.
- **ФПО pilot expiry / regime change** → adapter built to a lapsing spec. *Mitigate:* confirm permanence; keep the fiscal driver behind the existing abstraction.
- **Double fiscal receipt** (payment embeds KKM). *Mitigate:* design WS2+WS3 together.
- **Missing ky locale** → illegal + fines (17k KGS). *Mitigate:* WS6 before pilot; add ky to the i18n CI parity gate.
- **Competition (R-Keeper/iiko/Poster + free MKassa)** → commodity squeeze. *Mitigate:* workflow-value positioning (KDS/floor/combo/delivery + the ФПО operational data we already produce).

## 10. Method & confidence

7 research agents (RU-first, then KY/EN; primary sources sti.gov.kg, cbd.minjust.gov.kg, nbkr.kg,
provider docs, local media), framed as a delta from the UZ build. **e-invoice, delivery/SMS,
currency/i18n, market/competition** completed adversarial verification; **fiscal/tax, payments,
legal/residency** did not (session limit) — marked ⚠ and to be re-verified before go-live. Sources +
verdicts are in the workflow journal.
