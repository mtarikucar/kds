# Billing & Entitlements

> **This file used to document a subscription system that no longer exists**
> — dual Stripe/Iyzico providers, four tiers (FREE/BASIC/PRO/BUSINESS), 14-day
> trials, monthly/yearly cycles, auto-renewal, plan upgrade/downgrade and
> `@RequiresPlan` guards. All of it is retired.
>
> It has been **rewritten rather than archived behind a banner**, deliberately.
> The old content was not merely out of date, it was a set of *instructions* —
> run this migration, seed from `src/common/constants/subscription-plans.const`,
> set `STRIPE_SECRET_KEY`, gate your controller with `@RequiresPlan(PRO)` — and
> every one of those files, env vars and decorators is gone. A banner does not
> protect the reader who lands mid-file from a repo grep for "how do I gate a
> feature"; only deleting the wrong answer does. The history the banner would
> have preserved is in git, with dates and rationale a flattened archive cannot
> match. What a `SUBSCRIPTION_SYSTEM.md` in `backend/` owes a new developer is
> a correct answer to "how does billing work here", so that is what this is.
>
> Retired-name index, so a grep for any of these lands here:
> FREE / BASIC / PRO / BUSINESS · `SubscriptionPlanType` · TRIAL / TRIAL_ENDED ·
> `@RequiresPlan` · `@CheckLimit` · `PlanFeatureGuard` · `SubscriptionGuard` ·
> `POST /subscriptions/:id/change-plan` · `POST /payments/create-intent` ·
> `POST /v1/marketplace/addons/purchase` · Stripe · Iyzico · monthly billing ·
> trial periods · auto-renewal · stored cards · hardware rental.

---

## The model in one paragraph

The core product is **free, forever, unlimited** — no card, no trial clock, no
tier. Everything beyond the core is sold **à la carte** as individual annual
products, gated behind one annual **licence**. The day the licence is bought
becomes the account's immutable **anniversary**; anything bought later is
day-prorated to it, so the whole account renews on one date with one itemized
invoice. **Renewal is manual** — there is no stored card and nothing is charged
automatically. Collection is **PayTR, TRY only**.

## Source of truth

Documentation drifts; these files do not. When this page and the code disagree,
the code wins.

| Question | File |
|---|---|
| What is free? | `src/modules/entitlements/free-baseline.const.ts` |
| What is for sale, and for how much? | `src/modules/marketplace/alacarte-catalog.const.ts` |
| Which keys may a grant use? | `src/modules/entitlements/entitlement-keys.const.ts` |
| How is a mid-year purchase priced? | `src/modules/licensing/anniversary.ts` |
| How does renewal / grace / lapse work? | `src/modules/licensing/renewal-cycle.service.ts`, `renewal-scheduler.service.ts` |
| How is a cart priced and settled? | `src/modules/checkout/quote.service.ts`, `checkout-intent.service.ts`, `checkout-settlement.service.ts` |
| Can this tenant buy this right now? | `src/modules/checkout/addon-purchasability.rules.ts` |
| How is money collected? | `src/modules/payments/adapters/paytr.adapter.ts` |

---

## 1. The free core

Granted to **every** tenant, unconditionally and with no expiry, from
`FREE_BASELINE_GRANTS`:

```ts
feature.posAccess       true     // POS + adisyon
feature.kdsIntegration  true     // kitchen display
feature.customBranding  true     // own brand + domain
feature.multiLocation   true     // the branch hub / picker UI

limit.maxUsers          -1       // -1 == unlimited
limit.maxTables         -1
limit.maxProducts       -1
limit.maxCategories     -1
limit.maxMonthlyOrders  -1

limit.maxBranches        1       // the ONE priced cap: first branch free
```

Two design notes worth keeping in mind before "fixing" anything here:

- **The baseline is data, not an allowlist in a guard.** `feature.*` folds with
  OR and `-1` dominates the `limit.*` SUM, so the baseline composes with paid
  grants automatically — there is no precedence rule to get wrong, and any stale
  `plan:*` row surviving from the old world folds in harmlessly. The failure
  mode is "still free", never "suddenly limited".
- **Multi-branch is free; the second branch is not.** `feature.multiLocation`
  (hub, picker, switcher) is baseline; `limit.maxBranches` is 1. That is exactly
  why the `extra_branch` product grants both keys.

The retired limit keys survive *only* so the `-1` sentinel can dominate. Nothing
enforces them any more — the decorators that did were deleted along with
`@CheckLimit`.

Anyone can try the product without registering at all, via the shared demo
restaurant behind `POST /auth/demo-session`.

## 2. The paid catalog

One flat list. No bundles, no tiers. Each row has a `kind` and a `billing` of
`annual` or `oneTime`. Prices are **kuruş, KDV-inclusive**, and are
superadmin-editable at runtime — the constants file holds the launch defaults.

| kind | codes |
|---|---|
| `license` | `license_annual` — the singleton prerequisite |
| `module` | `advanced_reports`, `module_inventory`, `module_reservations`, `module_personnel`, `module_ai_studio`, `api_access`, `module_external_display`, `priority_support` |
| `integration` | `delivery_platforms` (v3.6.8: üç `delivery_*` SKU'sunun yerini aldı), `fiscal_hugin`, `caller_id_integration`, `sms_integration` |
| `capacity` | `extra_branch` (quantity-based, ceiling 100) |
| `credit` | `credit_ai_photo_100`, `credit_ai_video_20`, `credit_ai_3d_10`, `credit_sms_500` |
| `service` | `onsite_install_full` |

A cart line's identifier depends on its type: `{ type: 'addon', code }` resolves
against `MarketplaceAddOn`, while **both** `{ type: 'hardware', sku }` and
`{ type: 'service', code }` resolve against `HardwareProduct` — on-site services
are `HardwareProduct` rows with `category: 'service'`, which is what lets them
reuse the cart / quote / checkout pipeline instead of needing a
`ServiceOffering` model. There is no `plan` line type.

Rules the catalog validator and the projector enforce:

- **`requiresLicense: true` gates both buying and using.** While
  `feature.license` is absent the projector *suppresses* the grants of every
  such product. That is what makes a lapsed licence darken the entire paid
  surface at once without deleting a row — pay, and the same set comes back.
- **Credit packs are consumable, not entitlements.** `credit.*` never reaches
  the entitlement fold; balances are read live inside an advisory-locked claim
  transaction, because a 30-second-stale balance during a burst is a real money
  bug. AI credits additionally require `module_ai_studio`, SMS credits
  `sms_integration`. They are one-time, never expire, and last until consumed.
- **Codes are immutable and never reused.** Retired products are archived, never
  deleted — `TenantAddOn.addOnId` is `onDelete: Restrict`.
- **Grant keys are validated against `entitlement-keys.const.ts`.** A typo like
  `feature.advancedReport` would otherwise validate, publish, sell, and grant
  nothing.

## 3. Anniversary + proration

`src/modules/licensing/anniversary.ts` — pure arithmetic, no Nest or Prisma
imports, so the quote engine, the renewal generator, a UI mirror and the unit
tests all share one implementation.

- Buying the licence sets an **immutable anchor**: the tenant-local calendar
  date of the purchase. Every later annual line is billed only for the days
  remaining until the next anniversary.
- `ROLL_FORWARD_THRESHOLD_DAYS = 14` — buying inside the last 14 days rolls the
  item into the **next full cycle** instead of selling a stub that would land on
  the renewal cart 48 hours later.
- `MIN_LINE_CENTS = 100` — no priced line is ever emitted below ₺1.
- Cycles are 365 **or 366** days; never hardcode.
- Dates are UTC-midnight **calendar dates**, never wall instants. Türkiye is
  UTC+3 with no DST, so a 10 Mar 01:00 TRT purchase is 09 Mar 22:00 UTC —
  storing the raw instant would put the anniversary on the 9th forever.
  `anchorDateFor` collapses an instant to the tenant-local calendar date exactly
  once, at write time.
- **Rounding is per unit, then multiplied**: `unitCents * qty === subtotalCents`
  must hold exactly. The PayTR basket builder, the invoice PDF and
  `CheckoutService`'s 1-kuruş re-quote tolerance all depend on it.

## 4. Renewal, grace, lapse

**Manual. No card is stored and nothing is charged automatically.**

| Constant | Value | Meaning |
|---|---|---|
| `RENEWAL_LEAD_DAYS` | 30 | how far ahead the renewal cart is materialized |
| `REMINDER_DAYS` | 30 / 7 / 1 | days before the anniversary a reminder fires |
| `ADDON_GRACE_DAYS` | 7 | days past the anniversary the entitlement stays live |

Crons (each behind a Postgres advisory lock, so it is safe on every replica):

| Schedule | Job | What it does |
|---|---|---|
| `0 6 * * *` | `renewal-generate` | freeze next cycle's cart, one line per owned product |
| `0 9 * * *` | `renewal-reminders` | emit `renewal.reminder.v1` at 30 / 7 / 1 days out |
| `30 0 * * *` | `renewal-lapse` | expire cycles still unpaid after `graceEndsAt` |

The renewal is **one cart with one line per owned product**, priced at full list
(quoting as of the anniversary makes `remainingDays == cycleDays`, so proration
returns the whole price — no special "skip proration" flag). Prices are read
live from the catalog at generation time and then **frozen**, so the tenant pays
exactly what the reminder quoted even if an operator re-prices the catalog the
next day.

`markReminderSent` appends to `RenewalCycle.remindersSent` inside the same
statement that filters on it, so two replicas in the same minute cannot both
send. Cycles are idempotent on `(tenantId, anniversaryAt)` — one per year.

When grace ends, **access darkens and nothing is deleted.** Paying reopens the
account exactly as it was.

## 5. Money

**PayTR only, TRY only.** There is no Stripe rail, no Iyzico rail, no stored
card, no recurring charge, and the plan-era manual bank-transfer (havale) flow
went with plans. Hardware **rental** was closed in July 2026 (`rentalMonthlyCents`
NULLed across the catalog) for the same structural reason: PayTR settles
one-time charges, so there was no monthly rail behind "rent" — a buyer who chose
it paid once and was never billed again.

Line prices are **gross (KDV-inclusive)**. The quote derives tax *out* for the
invoice breakdown and never adds it on top; adding 20% on top here once
overcharged every card purchase by 20% relative to the displayed price.

### The purchase path — the only one

```
POST /v1/checkout/quote     price a cart, no writes          any tenant role
POST /v1/checkout/intent    -> PayTR iframe token + CK- ref  ADMIN, MANAGER
     PayTR hosted iframe
POST /webhooks/paytr        CK- prefix -> CheckoutSettlementService
                            -> CheckoutService.confirmAndProvision
```

`/intent` requires real `buyer` details (PayTR fraud-scores them) and exactly
three `acceptedDocumentIds` — the current KVKK / Mesafeli Satış / İade Politikası
documents, read from `/legal/documents/:kind/current`. Three `Consent` rows with
IP and user-agent are written **before** a token is minted, so a sale always has
evidence of the terms in the version that was live at the time.

`confirmAndProvision` is idempotent on `(tenantId, paymentRef)` and **requires a
settled `CheckoutIntent`** for that pair before it provisions anything. The
`@Roles(ADMIN, MANAGER)` gate on `/confirm` is not a payment control —
ADMIN/MANAGER are ordinary tenant-realm roles every restaurant owner holds. The
intent lookup is the control.

There is **no tenant-facing free-grant endpoint**.
`POST /v1/marketplace/addons/purchase` was removed for exactly that reason, and
`tenant.purchase()` refuses any `priceCents > 0` grant arriving without a
`paymentRef` as defence in depth. Operator comps live on the super-admin surface
(`POST /v1/superadmin/marketplace/comp`).

### Invoices

One invoice per settled payment, written to `tenant_invoices` **inside** the
provisioning transaction and idempotent on `paymentRef` — a webhook replay
returns the existing invoice rather than minting a second number for the same
money. Numbering shares the legacy `InvoiceCounter` through
`invoice-number.helper`, because two independent sequences over the same
`INV-{YYYYMM}-{seq}-{hex}` format would eventually collide inside settlement,
after the card had been charged.

The legacy `invoices` table still exists and is **not** the same thing: it holds
tax records behind a `NOT NULL subscriptionId` that Turkish VUK requires
retaining for years.

## 6. Gating a route

One decorator. `@RequiresPlan` and `@CheckLimit` are gone.

```ts
@RequireEntitlement('feature.kdsIntegration')                       // boolean feature
@RequireEntitlement({ feature: 'feature.advancedReports' })
@RequireEntitlement({ limit: 'limit.maxBranches', usage: (req) => countBranches(req) })
@RequireEntitlement({ integration: 'integration.delivery', provider: 'yemeksepeti' })
```

`@RequiresFeature` and `@RequiresIntegration` still exist as **thin aliases**
over it — the mapping is an identity, which is what let ~85 call sites across
~40 controllers migrate by editing two files instead of producing ~1,500 lines
of mechanical diff through modules with no relationship to billing.

On denial `EntitlementGuard` throws `EntitlementRequiredException` — a 403 that
carries the fix:

```json
{
  "statusCode": 403,
  "errorCode":  "ENTITLEMENT_REQUIRED",
  "requirement": { "type": "feature", "key": "feature.advancedReports" },
  "offer": { "code": "advanced_reports", "annualPriceCents": 129000,
             "proratedCents": 61234, "currency": "TRY", "periodEnd": "2027-03-10" },
  "licenseRequired": false,
  "reason": "not_owned"
}
```

`reason` separates `not_owned` (render **Buy**) from `lapsed` (render **Renew**)
— the distinction that turns a dead end into one click. `licenseRequired: true`
means the blocker is the missing licence itself, so the resolved offer is the
licence. `proratedCents` comes from the same catalog read the checkout quote
uses, so the advertised price provably equals the charged price. The old rail
returned a bare `"Feature not enabled: advancedReports"` and left the SPA to map
it through a hardcoded feature→plan table — a second source of pricing truth
that nothing kept in sync, and which could only ever say "upgrade to PRO".

## 7. Reading entitlements

```
GET /v1/entitlements/me            folded feature / limit / integration set
GET /v1/me/licensing?locale=tr     licence state, owned rows, credits, offers, purchasability
GET /v1/me/invoices                itemized à-la-carte invoices
GET /v1/credits/me                 prepaid balances
GET /v1/catalog/pricing            public price list (no auth)
```

`GET /v1/entitlements/me` returns the folded set the guards themselves read, so
the SPA needs zero special-casing for the free baseline. Grant sources are
visible in `EntitlementGrant.source`: `free:baseline`, `addon:<code>:<id>`,
`override:admin`, `grace:past-due`.

`GET /v1/me/licensing` is the one read a billing UI needs. `license.status` is
`none` | `active` | `grace` | `expired`, derived from the **live entitlement**
rather than the anchor — a tenant holding a live licence with no anchor was once
reported unlicensed, so the store added a second licence to the cart, which
checkout refused with `ADDON_ALREADY_OWNED`, failing the whole basket including
the module the customer actually wanted. The anchor answers "when is the
anniversary", never "is there a licence". The same response carries
`purchasability`, computed by the **same function the pre-payment guard uses**,
so the store cannot show a Buy button checkout will refuse.

Marketing pages consume `/v1/catalog/pricing` rather than a hardcoded table, so
a price change in the superadmin panel cannot leave the website advertising an
amount checkout will not honour.

## 8. Purchasability

`evaluatePurchasability` in `addon-purchasability.rules.ts` — pure, no IO —
answers "can this tenant buy this right now, and if not why" for **both** the
pre-payment guard and the storefront. It rejects with a `409` carrying
`{ code, message, addOnCode }`:

| `code` | Meaning |
|---|---|
| `LICENSE_REQUIRED` | `requiresLicense` product with no active licence, and none in the cart |
| `ADDON_REQUIRES_DEPENDENCY` | a `deps` entry is neither owned nor in the cart |
| `ADDON_ALREADY_GRANTED` | effective entitlements already cover it — paying buys nothing |
| `ADDON_ALREADY_OWNED` | an active row already exists |
| `ADDON_LIMIT_REDUNDANT` | the `limit.*` it grants is already `-1` |
| `ADDON_MAX_QUANTITY` | over the catalog ceiling |

A rejected line fails the **whole** cart. A sibling line in the same cart can
satisfy the licence prerequisite, and a **renewal** is exempt from the ownership
and redundancy rules — re-buying what you already hold is what a renewal is.

## 9. Events

Emitted through the outbox; consumers must be idempotent on the event `id`.

| Event | Meaning |
|---|---|
| `checkout.completed.v1` | a cart was provisioned |
| `payment.succeeded.v1` | money settled — carries `kind`: `signup` / `renewal` / `upsell` |
| `addon.purchased.v1` / `addon.cancelled.v1` | ownership changed |
| `addon.past_due.v1` | paid period ended unpaid; carries `graceEndsAt` |
| `renewal.reminder.v1` | 30 / 7 / 1 days before the anniversary |
| `feature.entitlement.changed.v1` | the projector wrote a new set |

The `subscription.*` family is still registered in `outbox/event-types.ts` and
the projector still listens for it, but it belongs to the retired rail —
`planCode` is a legacy tier name and `subscription.upgraded.v1` has no producer
at all. **Do not build new consumers on it.**

## 10. Residual plan-era code

Being honest about what is still in the tree, so nobody mistakes it for the
model:

- `src/modules/subscriptions/` still exists. `GET /subscriptions/plans` will
  return whatever `SubscriptionPlan` rows a database happens to hold, and
  `subscription.service.ts` still emits the lifecycle events above. The
  plan-changing routes are gone (`POST /subscriptions/:id/change-plan`,
  `GET /subscriptions/usage/snapshot`).
- `src/common/constants/subscription.enum.ts` still defines
  `SubscriptionPlanType` and `PlanFeature`. `PlanFeature`'s values are the
  entitlement key names verbatim — that identity is load-bearing for the
  decorator aliases and is pinned by `entitlement-keys.spec.ts`. The tier enum
  is not.
- `HardwareProduct.rentalMonthlyCents`, its DTO field, and `QuoteService`'s
  `acquisition === 'rent'` branch are retained for a possible future rental
  project. The catalog does not offer rent, so the storefront never sends it.
- `Device.ownership` still accepts `rented`; nothing produces it any more.

None of this is the billing model. Sections 1–9 are.
