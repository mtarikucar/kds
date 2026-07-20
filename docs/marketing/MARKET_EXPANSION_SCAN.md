# Next-Market Scan — "Fresh Fiscal Mandate = Forced Buying Event"

> **Purpose.** Companion to `UZ_EXPANSION_BENCHMARK.md`. Answers: *which other countries look like
> Uzbekistan* — a recent/imminent fiscal-receipt or e-invoice mandate that forces every restaurant to
> buy compliant POS/fiscal software — **and** are cheap for us to reach by reusing our TR/EN/RU/AR/UZ
> locales and the Uzbekistan CIS-style fiscal/payment build. 14 countries were researched in parallel
> and each country's core mandate-recency fact was **adversarially verified** (2024–2026 primary
> sources). Confidence + sources are in the run journal; key corrections are in §7.

| Field | Value |
|---|---|
| Status | **DRAFT — strategy input** |
| Created | 2026-07-15 |
| Scored on | `mandate_freshness` × `UZ-code-reuse` (heaviest), + market + reachability, each 0–5 (total /20) |

---

## 1. The thesis — and the refinement verification forced

**Your instinct is correct.** A newly-introduced fiscal-receipt / online-cash-register / e-invoice
mandate is a **forced buying event**: by the compliance deadline *every* restaurant must acquire
compliant POS/fiscal software, and the market is not yet saturated. That is exactly Uzbekistan's
profile (fiscalization 2019–2020, UzQR 2026).

**The refinement** (the reason this needed verification, not memory): most CIS and Balkan countries
**already fiscalized in 2019–2022**, so their greenfield window has *closed* — they are now
compliance-*refresh* markets (a displacement play against installed incumbents), not land-grabs. The
truly *fresh* restaurant-forcing mandates are fewer than the headlines suggest, and — critically —
**the freshest mandates and the highest UZ-code-reuse markets are mostly disjoint quadrants.** Only
one country lands in both.

```
                 UZ CODE-REUSE  (CIS-OFD fiscalization + RU locale + wallet-QR)
                 low ───────────────────────────────────────────────▶ high
   fresh  ▲   Egypt ● (e-Receipt, huge, AR)          ◀── Kyrgyzstan ★ (both!)
  MANDATE │   Jordan ● (JoFotara, AR/Turkey-UBL)
 FRESHNESS│   Croatia ○ (EU refresh)                     Tajikistan ○ (weak enforce)
          │   UAE ○ (B2C excluded)
   stale  ▼   Saudi ○ (window closed) · Romania ○         Kazakhstan ◆ (2026 refresh, big)
              Serbia ○ · Albania ○ · Armenia ○            Azerbaijan ◆ (mature, TR≈Azeri)
              Georgia ✗ (captured monopoly)
```

---

## 2. Recommendation — a barbell, with a clear first move

**Best next pick after Uzbekistan → Kyrgyzstan.** It is the *only* target that maxes **both** heavy
axes: `code_reuse 5` (essentially a locale+endpoint swap on the UZ build — same CIS/OFD online
fiscalization, same state-endorsed **virtual/software cash-register** a cloud POS can register as, same
state e-invoice pattern `esf.salyk.kg`, RU-locale drop-in, and **ELQR/MBANK/O!Dengi** wallets that
mirror Payme/Click) **and** a live, verified, restaurant-specific forcing motion (the STS/ГНС 2024–2026
enforcement campaign declaring the fiscal ККМ receipt the *only* valid document in cafés/restaurants;
canteens de-exempted 14 Sep 2024; 2025 tax reform + a fresh Cabinet draft tightening ККМ). Its only
knock — small market — is exactly why it's the right *first* step: it de-risks and validates the CIS
expansion engine at the **lowest possible engineering cost** before committing the warm codebase to a
bigger market.

**Suggested sequence:**

1. **Kyrgyzstan** — cheapest second deployment (~70–80% of the UZ build reused); proves the CIS playbook against a live restaurant-targeted enforcement campaign.
2. **Kazakhstan** — same code family (engine still warm); the largest high-reuse market, entered on the **2026 switching window** (National Catalog/НКТ + NTIN receipt fields to small business by 1 Jul 2026; ESF expansion Jan 2026) as a **displacement** play, not a first-time buy.
3. **Egypt** — pivot to MENA on the *freshest genuinely-forcing* mandate (penalty-backed B2C **e-Receipt** waves rolling through 2026); the UZ online-fiscalization module's `queue→sign→POST→QR` shape ports (new ETA adapter), and **AR locale already ships**.
4. **Jordan** — extend the MENA beachhead cheaply: fresh **JoFotara** mandate (mandatory since 1 Apr 2025, no sector exemption); **AR+EN reuse**, and JoFotara's **UBL 2.1 reuses the Turkey/Nilvera UBL builder** we already wrote.

**Why a barbell:** prosecute the **CIS-OFD family first (KG → KZ)** to amortize the UZ engine at near-
zero marginal cost, **then cross into MENA (Egypt, Jordan)** where mandate-freshness is highest but
reuse drops from "drop-in" to "same pattern, new adapter" and leans on the **AR locale + Turkey UBL
builder** rather than the UZ CIS code.

**Do not chase raw market size:** Saudi (market 5) and UAE (market 5) both **fail the forcing test at
the restaurant-POS layer** — Saudi's window has closed; UAE explicitly **excludes B2C**.

---

## 3. Comparison table (all 14, ranked by fit total)

| Country | Region | Fiscal-receipt mandate (system · since) | Restaurants? | Virtual reg.? | E-invoice (since) | Fresh forcing? | UZ reuse | Fit /20 | Tier |
|---|---|---|---|---|---|---|---|---|---|
| **Kyrgyzstan** | C. Asia | Online-ККМ (STS/Salyk) · Res.#193 **2022**, enforcement 2024–25 | yes | **yes** | ЭСФ `esf.salyk.kg` (live 2025) | **moderate ✓ live** | **5** | **15** | **1** |
| **Egypt** | MENA | ETA **e-Receipt (B2C)** · waves **2023→2026** | yes | yes | ETA e-Invoice (2023) | **strong ✓ fresh** | 3 | 14 | 2 |
| **Kazakhstan** | C. Asia | Online-KKM + ОФД · **2020**; NTIN/НКТ **Jul 2026** | yes | yes | IS ESF (2019; exp. 2026) | weak–mod (2026 refresh) | 4 | 13 | **1** |
| **Jordan** | MENA | **JoFotara** (receipt-level) · mand. **1 Apr 2025** | yes | yes | JoFotara (2023→2025) | **strong ✓ fresh** | 2 | 13 | 2 |
| UAE | MENA | **None** (no fiscal-device mandate) | no | no | e-Billing pilot Jul 2026 → **2027** | weak (B2C **excluded**) | 2 | 12 | 2 |
| Azerbaijan | Turkic | NKA online + E-Kassa · **2019–21** | yes | yes | e-qaimə (2017) | weak (mature) | 3 | 11 | 2 |
| Tajikistan | C. Asia | Online-KKM + virtual cashier · **~2022** | partial | yes | none confirmed | weak (soft enforce) | 4 | 11 | 2(watch) |
| Saudi Arabia | MENA | ZATCA Fatoora Ph.2 · Wave 24 **30 Jun 2026** | yes | yes | Fatoora UBL 2.1 (2023) | weak (**closing**) | 2 | 11 | 3 |
| Croatia | EU | Fiscalization 2.0 · **1 Jan 2026** (base 2013) | yes | yes | EN 16931 (Jan 2026) | moderate (refresh) | 3 | 11 | 3 |
| Georgia | Caucasus | Control cash registers · ~2010; **reform 1 Jan 2027** | yes | — | rs.ge e-invoice (~2011) | fresh but **captured** | 2 | 10 | **avoid** |
| Serbia | Balkans | SUF fiscalization · **1 May 2022** | yes | yes | SEF (B2B 2023) | weak (absorbed) | 3 | 10 | 3 |
| Romania | EU | Hardware AMEF + ANAF · 2021; **QR 2026** | yes | no | e-Factura B2C **Jan 2025** (dine-in <€100 **exempt**) | weak–mod | 1 | 10 | 3 |
| Armenia | Caucasus | HDM · mature; VCR **optional** (Art.380.1) | yes | yes(opt) | SRC e-invoice (2016) | weak (no window) | 3 | 9 | 3 |
| Albania | Balkans | Fiscalization (Law 87/2019) · **B2C Sep 2021** | yes | yes | Central Invoice Platform (2021) | weak (window passed) | 2 | 8 | 3 |

---

## 4. Tier 1 — go soon

- **Kyrgyzstan** — the decisive pick (see §2). Near-identical to the UZ build; live restaurant-targeted
  enforcement; small market is a *feature* for a first, cheap validation. New work: ГНС/Salyk +
  `esf.salyk.kg` endpoints, ELQR wallet adapter, KGS formatting, optional Kyrgyz locale.
- **Kazakhstan** — the biggest high-reuse prize; enter right after KG while the code is warm. Freshness
  is the weak spot (fiscalized 2019–20), but the **2026 refresh** (НКТ/NTIN + ESF expansion) opens a
  switching window to ride against incumbents (Webkassa/reKassa/iiko/rKeeper). New work: **Kaspi/Halyk**
  wallet adapters, IS ESF XML + СНТ, НКТ/NTIN receipt fields, Kazakh locale.

## 5. Tier 2 — watch / opportunistic

- **Egypt** — freshest genuinely-forcing mandate + huge market; **AR ships**. Frictions: reachability
  hard, and forcing is **list-by-list / district-by-district** (ETA taxpayer annexes), so GTM tracks
  wave lists, not one cliff. Medium reuse (new ETA JSON/e-seal adapter; same fiscalization *shape*).
- **Jordan** — fresh, hard, restaurant-covering; **AR+EN reuse** and **JoFotara UBL 2.1 reuses the
  Turkey/Nilvera UBL builder**. Tier 2 (not 1) because the reuse is against the *Turkey e-Belge* asset,
  not the UZ CIS build, and the sharpest first wave has passed — the live opportunity is the 2026
  SME/small-F&B tail.
- **Tajikistan** — maximum CIS-OFD reuse (single state FDO, virtual cashier, RU locale, Korti Milli/Alif
  ≈ Payme/Click), but **weak enforcement / no crisp restaurant deadline**. Framework just re-issued
  (Res. 638, Nov 2025); real catalyst = 1 Sep 2026 e-wallet/QR transaction tax. **Watch; enter if
  enforcement sharpens.**
- **Azerbaijan** — **best locale fit on the board** (TR ≈ Azerbaijani + RU + EN) and same architectural
  pattern, but the mandate is **mature/absorbed** (freshness 1). A relationship/affinity market to seed
  opportunistically, not a mandate-driven push.
- **UAE** — large + fresh e-invoicing rollout, **but B2C is explicitly excluded (Decision 244)** and
  there is **no fiscal cash-register mandate** — a restaurant's consumer POS faces no forcing event.
  **Monitor only** for a future B2C phase; AR/EN/RU make it cheap to activate if one is announced.

## 6. Tier 3 / avoid

- **Saudi Arabia** — biggest market + maximally-forcing, restaurant-covering mandate, **but the window
  has essentially closed** (Wave 24 threshold SAR 375k = the VAT-registration floor, deadline 30 Jun
  2026, no Wave 25; incumbents captured the spike). Low UZ reuse. Only a residual sub-375k tail.
- **Croatia** — Fiscalization 2.0 is real and imminent (1 Jan 2026), but restaurants have fiscalized
  since **2013** (~100% penetration) — a refresh, forced spend flows to e-invoicing intermediaries;
  zero locale/currency reuse (FINA certs, OIB, EUR). Not worth the EU-cert + new-locale lift.
- **Serbia / Romania / Albania / Armenia** — genuine mandates but **windows already fired** (Serbia
  2022, Albania 2021, Armenia's "fresh" VCR is *optional*, Romania's dine-in **<€100 is exempt** and
  the backbone is pre-existing hardware). Low reuse + net-new locale/currency. Disconfirm the thesis.
- **Georgia — AVOID despite a fresh mandate.** A real imminent forcing event exists (universal
  register live 1 Jan 2027, old devices dead 1 May 2028, restaurants in scope) — **but supply and
  servicing of the registers is centralized under a single government-appointed vendor**. The
  forced-buying window is a **state monopoly a foreign POS SaaS cannot sell into.** Unreachable at the
  point of forcing.

## 7. What verification changed (honesty log)

- **Georgia** — freshness *up* (real 2027 reform) but **reachability collapses** (captured monopoly).
- **UAE** — fresh e-invoicing **excludes B2C**; no fiscal-register mandate → no restaurant forcing.
- **Romania** — dine-in **<€100 exempt** from e-Factura; fiscal backbone is pre-existing hardware.
- **Armenia** — the "fresh" Virtual Cash Register is **optional** (Art. 380.1), not a mandate.
- **Saudi** — maximally forcing but **window closed** (Wave 24 passed, no Wave 25).
- **Kazakhstan** — the fresh 2026 item (NTIN/National Catalog) is goods-**marking** for traded retail
  products; its bite on a restaurant's prepared-meal lines is **narrower** than a restaurant-specific
  forcing event — don't overstate it.
- **Egypt** — "real-time" overstated (up-to-24h transmission); the "50k fine" is unconfirmed; forcing
  is incremental list-by-list, not one all-restaurants deadline.
- **Tajikistan** — mechanism confirmed but cited Res. 432 was superseded by **Res. 638 (Nov 2025)**;
  enforcement weak, catalyst (1 Sep 2026 QR tax) still a pilot.

## 8. Engineering reuse note

- **CIS-OFD family (KG, KZ, TJ, and UZ):** ~70–80% of the Uzbekistan build ports — the OFD/virtual-
  register fiscalization *shape*, RU locale, wallet-QR adapter pattern, XML e-invoice module. New work
  per country = tax-authority endpoints + local wallet adapters + receipt-catalog fields + local
  currency/locale. **This is the cheap lane — prosecute it first.**
- **MENA (Egypt, Jordan, Saudi, UAE):** the UZ *CIS code* does **not** drop in, but (a) the **AR locale
  ships**, and (b) UBL-based clearance systems (JoFotara, ZATCA, UAE PINT) **reuse the Turkey/Nilvera
  shared UBL builder**, and (c) the fiscalization *pipeline shape* (queue → sign → POST → store fiscal
  id/QR → offline buffer) is the same abstraction. Medium reuse, higher market freshness.
- **Carry-over lesson from the UZ program:** every new-country fiscal adapter is a **cross-language
  contract** (receipt schema, signing, wallet callback) — verify both sides against the *live*
  tax-authority sandbox, and ship **INERT until credentials are set**, exactly like the Nilvera/UZ
  adapters. Treat the virtual/software-register regime (what a cloud POS legally targets) as
  still-maturing in KG/TJ → gate go-live behind a real per-country sandbox e2e.

## 9. Method & sources

14 country agents (EN/RU/AR + local-language search of tax-authority portals, Big-4 / VATupdate /
EDICOM country guides, reputable local news), each adversarially fact-checked on its core
mandate-recency claim, then a portfolio strategist ranked the two thesis-heavy axes. Full per-country
sources + verification verdicts are in the workflow journal. Items in §7 are the corrections that
survived verification — treat them as the load-bearing caveats.
