# Onboarding Trial Plan — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorming)
**Author:** deep-review follow-up (Claude)

## Problem

Today registration grants a 14-day **BUSINESS** trial: the trial experience is
coupled to a real paid tier. Two classes of logic error fall out of that:

1. The trial's existence depends on `BUSINESS.trialDays > 0`. A BUSINESS row
   created with the schema default (`trialDays = 0`) hard-blocks **all**
   signups (`loadBusinessPlanOrThrow` throws "BUSINESS plan has no trialDays
   configured"). This actually happened.
2. At expiry the system **silently** transitions `TRIALING(BUSINESS) → ACTIVE(FREE)`.
   That implicit transition is the source of edge-case bugs (e.g. the
   concurrent-clobber where a just-paid subscription is overwritten back to
   FREE), plus per-plan trial bookkeeping (`usedTrialPlanIds`) that adds more
   state to get wrong.

The system is **not yet in production use** — there is no live tenant/trial/FREE
data to migrate. We can redesign cleanly.

## Goal

Decouple the trial from any paid tier by introducing a dedicated, non-purchasable
**onboarding trial plan**. New tenants start on it; it expires; the tenant is then
**forced to pick a paid plan** before continuing. No silent transitions, no
trial↔paid-tier coupling.

## Decisions (from brainstorming)

- **Trial length:** 7 days.
- **At expiry:** lock the tenant to a plan-selection screen — they cannot use
  the app until they activate a paid plan. No silent auto-downgrade.
- **Post-trial choices:** paid only — BASIC / PRO / BUSINESS. No FREE landing.
- **Trial feature grant:** full premium (BUSINESS-equivalent feature set).
- **Per-plan trials removed:** one trial concept only. Drop `usedTrialPlanIds`,
  per-plan `trialDays` trial flows, and `startTrialFromIntent`.
- **FREE plan:** retired entirely (no FREE landing, no existing FREE users).
- **Lock screen:** read-only summary + plan selection (not a full blackout) to
  maximize conversion; only ADMIN can pick/pay, other roles see "ask your admin".

## Plan model

| Plan      | Purchasable | Role |
|-----------|-------------|------|
| `TRIAL`   | No (`isPublic=false`, `isActive=true`) | 7-day onboarding; full premium grant via the existing entitlement projection |
| `BASIC`   | Yes | paid |
| `PRO`     | Yes | paid |
| `BUSINESS`| Yes | paid |
| `FREE`    | **Removed** | — |

`TRIAL` grants the same feature/limit set as BUSINESS (everything open) so the
tenant experiences the full product. It is never shown on the public pricing grid
and cannot be selected/purchased.

## Subscription state machine

```
register ──> TRIALING (plan=TRIAL, trialEnd = now + 7d)
                 │
                 │ expireTrials cron, trialEnd <= now
                 ▼
            TRIAL_ENDED  ── (locked: app gated to /choose-plan) ──┐
                 │                                                 │
                 │ ADMIN picks BASIC/PRO/BUSINESS                  │
                 ▼                                                 │
            PayTR checkout ── webhook settlement ──> ACTIVE (paid) ┘ (unlocked)
```

- New status value **`TRIAL_ENDED`** added to the subscription-status enum.
- `expireTrials` uses an atomic conditional claim (`updateMany WHERE status=TRIALING`)
  so a concurrently-activated subscription is never clobbered. It only flips the
  status to `TRIAL_ENDED`; **the plan does not change** (no FREE).

## Enforcement

**Backend** — `PlanFeatureGuard` treats `TRIAL_ENDED` as **not live**. While in
`TRIAL_ENDED`, all tenant routes return 403 **except** an allowlist needed to
recover:
- `/auth/*`, `/me`
- `/subscriptions` (plan list + `current`)
- `/checkout/intent` (+ the PayTR webhook, which is `@Public`)
- read-only summary endpoints the lock screen needs (tenant/branch counts) —
  scoped to the minimum.

**Frontend** — a global `SubscriptionGate` reads the current subscription; when
status is `TRIAL_ENDED` it redirects to `/choose-plan` and blocks all other
in-app routes. The choose-plan screen shows a read-only summary (e.g. "you have
N branches / M products — pick a plan to continue") + the paid plans. Only ADMIN
sees the purchase actions; other roles see "ask your admin to choose a plan".

## Activation (unlock)

`/choose-plan` → select BASIC/PRO/BUSINESS → existing PayTR checkout rail
(`POST /v1/checkout/intent` → `CK-` webhook → `CheckoutSettlementService` /
subscription settlement). The settlement transition is extended to activate from
**`TRIAL_ENDED`** (today it activates from `TRIALING`/`PENDING`). On success the
subscription becomes `ACTIVE` on the chosen paid plan and the gate releases.

## Removed (legacy / logic-error sources)

- `FREE` plan: removed from seed; all `→ FREE` fallbacks replaced by the
  `TRIAL_ENDED` lock. Enum value may remain as a tombstone but is unused.
- `usedTrialPlanIds` per-plan trial registry + per-plan `trialDays` trial logic.
- `startTrialFromIntent` (card-free paid-plan trial) and the "ücretsiz dene"
  per-plan CTAs in the SPA.
- `loadBusinessPlanOrThrow` → `loadTrialPlanOrThrow` (loads the TRIAL plan;
  no BUSINESS coupling).
- `createSubscription` public ADMIN endpoint no longer needed for trials
  (register auto-creates the TRIAL sub; paid activation goes through settlement).
  Keep only if another caller needs it; otherwise restrict/remove.

## Testing

- Seed: `TRIAL` plan exists (full premium, isPublic=false), no `FREE`.
- `register()` → subscription `{ plan: TRIAL, status: TRIALING, trialEnd ≈ +7d }`,
  Main branch + admin primaryBranchId seeded (provisioning parity preserved).
- `expireTrials`: `TRIALING` past `trialEnd` → `TRIAL_ENDED`; a concurrently
  ACTIVE-paid row is skipped (not clobbered).
- `PlanFeatureGuard`: `TRIAL_ENDED` → 403 on a gated route, 200 on the allowlist.
- Settlement: `TRIAL_ENDED` + paid checkout → `ACTIVE` on the chosen plan.
- Frontend: `SubscriptionGate` redirects `TRIAL_ENDED` to `/choose-plan`; ADMIN
  sees purchase actions, non-admin sees the ask-admin message.

## Out of scope / notes

- No data migration (system not in use). A seed change + `prisma migrate deploy`
  schema migration for the new enum value is sufficient.
- The pending `hotfix/business-trialdays-signup` (BUSINESS.trialDays backfill)
  is **superseded** by this redesign and will be abandoned.
- Dunning / proration for paid renewals is unchanged and out of scope here.
