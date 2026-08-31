# AI Answer-Engine Visibility Program — Design

**Date:** 2026-08-25
**Status:** Implemented on `feat/aeo-visibility-program` (11 commits). Phases 0–3 complete;
Phase 4 is the owner checklist at `docs/marketing/AEO_OWNER_CHECKLIST.md`.

Two things changed during implementation and are recorded here rather than left
in commit messages:

1. **The truth audit was wider than this spec assumed.** It found 5 blocker and
   6 high-severity claims, not the 4 listed below. Also corrected: blanket
   at-rest encryption (in the privacy policy), "tam uyumluluk", multi-currency,
   custom domain, tip *distribution*, multilingual menu *content*, and legal
   documents stamped "Ocak 2025". The camera heat map surfaced later still, in
   the ported SPA copy — see 3.

2. **Two research claims in this spec were wrong and are corrected.** The TCMB
   instrument is "Ödeme Hizmetlerinde TR Karekodun Üretilmesi ve Kullanılması
   Hakkında Yönetmelik", not "Ödemelerde Karekod Kullanımı Hakkında Yönetmelik";
   and it does **not** bind a POS software vendor directly — generation is
   reserved to licensed PSPs, and the 6493 md.27 fine reaches only system
   operators and payment service providers. The date and number (RG 21/8/2020,
   31220) were right.

3. **The port carried a false claim across, exactly as this spec warned.** The
   `analitik` module page is 985 words about a camera-fed table-occupancy heat
   map gated behind `CAMERA_ANALYTICS_ENABLED`, which is set in no environment
   file. The same claim had also leaked into `raporlar` and `stok-envanter`.
   The module is not published, the leaks are removed, and claims-check has a
   rule for it. This is the single best argument for the guard existing.
**Branch:** `feat/aeo-visibility-program`

## Goal

When someone in Türkiye asks ChatGPT, Perplexity, Gemini or Google AI Overviews about restaurant
software — "adisyon programı", "karekod menü", "mutfak ekranı", "e-Adisyon zorunlu mu" — HummyTummy
should be among the sources the answer is built from.

## What this is not

This is a **gate to pass, not a strategy that wins on its own**. Research (Muck Rack, 25M+ links)
puts ~84% of AI citations on earned media; a brand's own domain is realistically 10–18% of its
citation surface. With zero live customers the largest levers — reviews, case studies, press,
inclusion in third-party listicles — are gated on a business event, not on a commit. The repo work
below is necessary because the properties are currently unciteable for structural reasons.

Two positions taken deliberately:

- **We do not target the head term "adisyon programı."** It is Adisyo's brand moat — the query is
  effectively the competitor's company name. We target the fan-out queries around it, where the
  measured correlation with AI citation is strongest (ρ=0.77, +161% citation odds for ranking across
  fan-out queries vs. the head term alone).
- **We budget nothing further on `llms.txt` or on schema.org as an AI-citation lever.** 97% of
  `llms.txt` files across 137K domains were never fetched in a month and Google states in writing
  that it ignores them; the only causal test of JSON-LD on AI citation measured −4.6%/+2.4%/+2.2%.
  The existing `llms.txt` stays (zero cost). Schema.org work is justified by Google rich results
  and Merchant surfaces, not by AI citation — the two must not be conflated in prioritisation.

## Verified starting state

All of the following were confirmed live or in-source on 2026-08-25, not taken
from a report.

Several of the files cited below no longer exist: this change deleted them.
`landing/src/data/stats.json`, `landing/src/data/features.ts` and
`landing/scripts/fetch-stats.js` were removed in the truth-remediation commit,
and `help/public/robots.txt` and `developer/public/robots.txt` in the
discoverability one. Their contents are quoted inline here so the evidence
survives without them, and `git show 4d077abd:<path>` still opens the originals.
Saying so matters: a record that names evidence a reader cannot open reads as
verifiable while being nothing of the kind.

| # | Finding | Evidence |
|---|---|---|
| 1 | 95 of 110 sitemap URLs canonicalise to the locale homepage | `/tr/store` and `/tr/contact` emit `<link rel="canonical" href="https://landing.hummytummy.com/tr">`; root cause is `alternates` declared on `landing/src/app/[locale]/layout.tsx:42-47` and inherited by every child that does not override it |
| 2 | ~23,400 words of Turkish marketing copy are invisible to crawlers | 17 module pages (`frontend/src/marketing/data/modules.ts`, 16,310 words) + sector pages (7,084 words) live behind `/ozellikler/:slug` and `/cozumler/:slug` in a client-rendered SPA; `hummytummy.com/ozellikler` returns the same 5,392-byte shell as every other path. No major AI crawler executes JavaScript. |
| 3 | `help.` and `developer.` are undiscoverable | `sitemap.xml` and `robots.txt` both 404 on both hosts; 122 pages / ~73,700 words; `landing/src/components/sections/Footer.tsx` has 3 `href="#"` where those links belong |
| 4 | `/og-image.jpg` and `/apple-touch-icon.png` return HTTP 500 | every page, every locale — all social and AI preview cards are broken |
| 5 | Fabricated statistics ship to production | `landing/src/data/stats.json` = `{"restaurantCount":"500+","totalRevenue":"₺1M+","fallback":true}`; `landing/scripts/fetch-stats.js:70` returns `'500+'` **when the real value is 0** |
| 6 | "Sınırsız şube" is false | `backend/src/modules/entitlements/free-baseline.const.ts` sets `maxBranches: 1` — "the one surviving numeric limit"; extra branches are a ₺3.990/yr SKU. Claimed in 4+ strings × 5 locales. |
| 7 | Allergen support is claimed and does not exist | `grep -ci allergen` over `backend/prisma/schema.prisma`, `backend/src` and `frontend/src` returns 0; `tr.json:652-653` answers the FAQ "Alerjen bilgisi ekleyebilir miyim?" with "Evet." |
| 8 | "%99.9 Uptime SLA" claimed in 5 locales | contract seeds %99,5; no uptime measurement and no status page exist |
| 9 | Türkiye-first product defaults to English | `landing/src/i18n/config.ts:4` → `defaultLocale: 'en'`; the bare domain 307s to `/en`; no `x-default` anywhere |
| 10 | No verified Search Console property | `GOOGLE_SITE_VERIFICATION` is unset in `docker-compose.prod.yml`; the sitemap has never been submitted |
| 11 | Brand entity is declared on a subdomain nothing links to | `Organization` JSON-LD says `"url": "https://landing.hummytummy.com"`; the apex emits none; `grep -rn 'landing\.hummytummy' frontend/src help/ developer/` returns nothing |
| 12 | Apex serves a fake sitemap | `hummytummy.com/sitemap.xml` → `200 text/html 5392b` (the SPA shell). `robots.txt` → 404. |

**Resolved before this work started:** Cloudflare's managed robots.txt block (which disallowed
`GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Amazonbot`,
`meta-externalagent`, `Bytespider` and set `Content-Signal: ai-train=no`) was removed by the owner
on 2026-08-25. Re-verified: 4 hosts × 7 crawler user-agents, zero 403s, `Google-Extended` now
allowed. That was the one documented binary loss — Gemini API / Vertex grounding explicitly excludes
pages disallowing `Google-Extended`.

**Regression risk to note:** from 15 Sept 2026 Cloudflare blocks mixed-use AI crawlers by default
for existing free customers. This setting can regress without a commit and must be re-checked.

## Design

### Phase 0 — Truth remediation (prerequisite for everything else)

Publishing a "verifiable, sourced price index" (Phase 3) from a site whose own statistics are
fabricated is not merely ineffective, it is self-defeating. The house is cleaned first.

- **Fabricated statistics.** Delete `landing/src/data/stats.json` fabrications and the
  `formatNumber`/`formatCurrency` zero-fallbacks in `landing/scripts/fetch-stats.js`. A statistic
  with no real value renders **nothing** — never a placeholder. The `StatBand` is rebuilt on facts
  that are true and verifiable: the core is free and unlimited, five interface languages, cloud
  (all 81 provinces). Delete the dead `landing/src/data/features.ts` still carrying 40%/85%/25%/99.9%.
- **Branch limit.** All "sınırsız şube" / "unlimited branches" strings across 5 locales become an
  explicit statement: first branch free, additional branches ₺3.990/yr. This is not damage control —
  it is the raw material for the honest-"ücretsiz" page in Phase 3, a query family where every
  competitor answer is evasive.
- **Allergen.** The feature bullet and the FAQ Q&A are removed from all 5 locales. Owner chose copy
  correction over building the feature. This is food-safety exposure, not marketing exaggeration.
- **SLA.** The "%99.9 Uptime SLA" badge is removed outright in all 5 locales (owner-approved
  judgment call (a)). It is replaced with statements that are measurable and true. Publishing the
  contractual %99,5 as a marketing badge was rejected: without uptime measurement or a status page,
  no availability number should be carried as a badge.
- The two pending `help/pages/{en,tr}/plans/trial-and-billing.mdx` edits (VAT breakdown corrected to
  ₺4.083,33 + ₺816,67 for the ₺4.900 price) belong to this phase and are folded in.

`landing/scripts/i18n-check.mjs` runs as `prebuild`, so all 5 locales are forced to change together.
That guardrail is kept and relied on.

### Phase 1 — Structural indexability

**1a. Break the canonical inheritance.** Remove `alternates` from `[locale]/layout.tsx`. Introduce
`landing/src/lib/seo.ts` exporting a single `buildPageMetadata({ locale, path, meta })` helper that
returns a self-referencing canonical, 5-locale `hreflang`, `x-default → /tr`, and a **complete**
`openGraph`/`twitter` block. Every page uses it.

The helper is not a style preference — it closes a second live bug: Next.js does not deep-merge
`openGraph`, so `/qr-menu` and `/bulut-mutfak`, which override `openGraph` with only title and
description, currently drop `og:image`, `og:url` and `og:type` and stamp the homepage's text on
their Twitter cards.

A regression test fetches every URL in the sitemap and asserts `canonical === self`. This bug must
not be able to return silently.

**1b. Broken plumbing.** Real `opengraph-image` generation per locale (fixes the 500);
`apple-touch-icon.png`; `setRequestLocale` on `/store` (without it the page is dynamically rendered
on every request and its `revalidate = 300` is dead code); the `| HummyTummy | HummyTummy` doubling
in SKU titles.

**1c. Türkiye becomes the default.** `defaultLocale: 'tr'`, `x-default → /tr`, sitemap priority 1.0
moves to `/tr`.

**1d. Un-orphan `help.` and `developer.`** Sitemap route, `robots.txt`, canonical + hreflang in
`theme.config.tsx`, and real footer links replacing the 3 `href="#"`. 122 pages and ~73,700 words —
the richest citable corpus the company owns — are invisible for want of a link.

**1e. Apex bridges (decision D1-B).** The apex keeps serving the SPA, but gains:
- a real `/robots.txt` and `/sitemap.xml` from origin (today: 404 and a 5,392-byte HTML shell
  masquerading as a sitemap, which is worse than a 404),
- 301s from apex marketing paths (`/ozellikler*`, `/cozumler*`, `/qr-menu`, `/karekod-menu`,
  `/bulut-mutfak`) to their landing equivalents,
- `Organization` JSON-LD in the apex `index.html` head with `"url": "https://hummytummy.com"` and
  `sameAs` covering landing/help/developer, so the brand entity is declared where authority accrues,
- `www.` → apex permanent redirect (today it only bounces via JavaScript).

> `ops/nginx/hummytummy.com.conf` carries a self-declared "RECONSTRUCTED" note and is never applied
> by deploys. Capture `nginx -T` from the production box and diff against it before touching
> anything there. Do not edit that file on the assumption it reflects production.

### Phase 2 — Port the 23,400-word corpus

17 module pages move to `landing/src/app/[locale]/ozellikler/[slug]`, sector pages to
`/cozumler/[slug]`, statically generated, with canonical/hreflang and sitemap entries.

- **Collision rule.** Where a ported module duplicates an existing landing page (`qr-menu`, and
  likely `e-fatura`), the existing landing page wins and the module slug 301s to it. Two pages are
  never allowed to compete for the same query.
- **Locale scope.** These routes are **tr-only** (owner-approved judgment call (b)): `hreflang`
  declares `tr` only, and they are excluded from the other four locales. Machine-translating 23,400
  words would ship thin content in four languages and do net harm. Other locales are a later round.
- **Every ported string passes the Phase 0 truth filter.** Re-importing corrected claims through the
  port is the single most likely way for this work to undo itself.

### Phase 3 — Fan-out pages

`/qr-menu` is already the correct template — per-locale metadata, self-referencing canonical, static
in all locales, and FAQPage JSON-LD mirroring the visible `<details>` list 1:1. It is replicated.

| Page | Slug | Rationale |
|---|---|---|
| e-Adisyon zorunlu mu? (2026) | `/e-adisyon-zorunlu-mu` | akinsoft, vrest, faturaport and robotpos all publish "2025 itibariyle mecburi hale geldi". A scan of the ebelge.gib.gov.tr duyuru archive found no duyuru imposing e-Adisyon on any taxpayer group; VUK 509 IV.12.2 says so explicitly and IV.12.4 reserves the power to mandate it with ≥3 months' notice. VUK 573 (RG 12/11/2024) repealed IV.12.3(d) and no competitor article reflects it. The whole market publishes the opposite of the truth. |
| Restoran yazılımı fiyatları | `/restoran-yazilimi-fiyatlari` | robotPOS's 17,160-word comparison contains zero ₺ figures; Karekodgarson's flagship contains zero; every published comparison silently mixes KDV-included and KDV-excluded numbers. A dated, sourced, VAT-normalised table is a position nobody holds. |
| Mutfak ekranı (KDS) | `/ozellikler/mutfak-ekrani-kds` | **Not a new page** — the module page ported in Phase 2 is promoted to the definitive page on the topic. Adisyo has no KDS page at all; the field is micro-vendors repeating an unsourced "5 kat verimlilik". We never open a second page on a topic we already have. |
| Karekod rehberi | `/karekod-rehberi` | Separates the three unrelated things Turkish speakers call "karekod": the menu QR, the GİB e-Belge karekod (VUK 509, mandatory on 8 document types since 1/9/2023, encodes JSON — not a URL — and sits in the top-right corner), and TR Karekod payment (TCMB Yönetmelik RG 21/08/2020 no. 31220). Authority, not conversion. |

Writing rules, derived from how the engines actually retrieve:
- **Self-contained passages.** Perplexity decomposes documents into spans that are individually
  retrieved and ranked; a sentence that depends on the paragraph above it loses at rerank.
- **Natural-language slugs** (measured 89.78% vs 81.11% citation rate).
- **Title + ~202-character snippet engineering** — in roughly 9 of 10 ChatGPT answers a page reaches
  the model as title plus snippet only.

Two honesty gates on this phase:
- The price index publishes competitors' prices. Every row carries a source URL and a capture date;
  a row without a source is not published. The data file stores `sourcedAt` per row and the build
  emits a staleness warning, so the page cannot rot silently.
- The e-Adisyon page makes a regulatory claim against the entire market. **Primary sources are
  re-verified first-hand (gib.gov.tr, resmigazete.gov.tr) — not taken from the research agent.**
  Separately: describing the mandate accurately is fine; implying that we issue karekodlu e-Belge
  today is not. `backend/src/modules/fiscal-core/adapters/efatura-fiscal-provider.ts` returns
  `failed` by design and the `gmp3` driver fails closed.

### Phase 4 — Measurement and off-site enablement

In-repo: wire `GOOGLE_SITE_VERIFICATION` through `docker-compose.prod.yml`; add IndexNow submission.

Delivered as an owner checklist, because it cannot be done from the repo: Search Console and Bing
Webmaster verification (Bing gates Copilot and its AI Performance report is the only place AI
citations are visible), Google Business Profile, claiming the Şikayetvar profile before the first
complaint arrives, and third-party listicle outreach.

**Explicitly excluded, permanently:** no purchased or incentivised reviews, and no
`aggregateRating`/`Review` JSON-LD until real reviews exist. With zero customers, emitting one would
be fabricated review data.

## Testing

- Sitemap-wide canonical self-reference assertion (new; guards the highest-value fix).
- `landing/scripts/i18n-check.mjs` locale parity, already `prebuild`-enforced.
- Build-time staleness check on the price index data file.
- A claims test that fails the build if a removed claim ("sınırsız şube", allergen, %99.9) reappears
  in any locale catalogue.
- Live crawler-access probe re-run after deploy (4 hosts × 7 user-agents, expect zero 403s).

## Expectations

Structural fixes surface in Google in 2–6 weeks, and only once a verified Search Console property
exists. Ranking in the low-competition families takes 3–6 months. Meaningful presence in AI answers
takes 6–12 months and will mostly not come from our own domain.

Citations are not business value: one documented case showed a 1,900% MoM jump in ChatGPT citations
with little-to-no business impact. Pew found users click a traditional result in 8% of AI-summary
searches versus 15% without. The objective is **being named in the answer**; referral-traffic
expectations should be set accordingly.
