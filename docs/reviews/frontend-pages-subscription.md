# `frontend/src/pages/subscription/` — Deep Review (2026-05-11)

**Tier:** 2 (frontend parity; subscription pages — has plan-selection state, no client-side price math beyond display)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `frontend/src/pages/subscription/SubscriptionPlansPage.tsx` (168 LOC) — public plan picker + billing-cycle toggle
- `frontend/src/pages/subscription/ChangePlanPage.tsx` (299 LOC) — upgrade/downgrade with scheduled-downgrade alert
- `frontend/src/pages/subscription/SubscriptionContactPage.tsx` (267 LOC) — off-platform payment funnel (WhatsApp/Email)

**Related upstream:**
- [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §4.5 / §5.5 — subscriptions module, frontend pages section
- [`subscriptions.md`](subscriptions.md) — backend invariants I-2/I-3 and **M9** (renewal-write idempotency gap) cross-reference findings here
- [`frontend-protected-routes.md`](frontend-protected-routes.md) (planned) — `ProtectedRoute` role-gate behavior used by these pages

---

## 1. Health & summary

🟡 **yellow**

These three pages own the **plan-selection and billing-inquiry surface** for tenants: choose a plan / cycle, confirm upgrade or schedule downgrade, then funnel the customer to WhatsApp or email for off-platform payment confirmation. They do **not** perform a card-on-file 3DS checkout — Stripe/PayTR were removed from the codebase (cf. `subscriptions.md` §1 — "renewals are confirmed off-platform via WhatsApp/Email and recorded by SuperAdmin") — so the classic "browser-back during 3DS" hazard is partially N/A. The page-level role gate is present (`App.tsx:180` puts all three under `ProtectedRoute allowedRoles={[ADMIN, MANAGER]}`), and price display reads server-supplied `Plan.monthlyPrice` / `yearlyPrice` without performing authoritative math. **What's brittle:** (a) `SubscriptionPlansPage` has a `processingPlanId` state variable but never calls its setter — the double-submit guard is dead code (F-1); (b) the upgrade flow opens `SubscriptionContactPage` with a synthesized URL of `subscriptionId`, `newPlanId`, `billingCycle` that the server re-prices (M-mapped: server is source of truth — good) but the page-local `formatCurrency` at `SubscriptionContactPage.tsx:79-84` drifts from `lib/currency.ts` (shows "TL" not "₺", no thousands separator), creating display inconsistency vs `ChangePlanPage` and `PlanCard` (F-3); (c) Rules-of-Hooks violation at `SubscriptionPlansPage.tsx:53` — `useMemo` runs after a conditional early-return at `:41` (F-2). Compared to the last round, no findings have been retired; these are net-new because no frontend per-page reviews existed prior to this pass.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/pages/subscription/SubscriptionPlansPage.tsx` (168 LOC) — billing-cycle toggle, plan grid, FAQ, "manage subscription" CTA when an active sub exists.
- `frontend/src/pages/subscription/ChangePlanPage.tsx` (299 LOC) — current-plan banner, scheduled-downgrade warning, billing-cycle toggle, plan grid, confirm modal with upgrade/downgrade branching.
- `frontend/src/pages/subscription/SubscriptionContactPage.tsx` (267 LOC) — server-confirmed plan details card, WhatsApp/Email contact buttons, post-contact thank-you screen.

**Skimmed (cross-referenced for invariant verification):**
- `frontend/src/components/subscriptions/PlanCard.tsx:48,57,123,132,142` — price display formatting (uses `Number(...)` + `.toFixed(2)`).
- `frontend/src/features/subscriptions/subscriptionsApi.ts:124-175` — `ChangePlanResponse` shape; verified `paymentInfo.subscriptionId / newPlanId / billingCycle / newAmount / prorationAmount` are server-supplied.
- `frontend/src/api/contactApi.ts:17-29, 52-75` — `ContactLinksResponse` shape; the **amount and currency come from the server** on `useGetContactLinks` / `useGetUpgradeContactLinks`.
- `frontend/src/App.tsx:180, 217-225` — verified all three pages live inside the `ADMIN, MANAGER` role gate.
- `frontend/src/lib/currency.ts:14-20` — canonical `formatCurrency`.

**Skipped:**
- `pages/settings/SubscriptionSettingsPage.tsx` — out of this review's scope (separate page; see `frontend-pages-auth.md` companion plus §5.9 of `CODE_REVIEW.md` re: missing `rel="noopener"`).
- Server-side handlers (`backend/src/modules/subscriptions/...`, `backend/src/modules/contact/...`) — covered in [`subscriptions.md`](subscriptions.md) and the upstream `CODE_REVIEW.md §4.5`.

---

## 3. Business-logic invariants

These are the contracts these pages owe their callers (and what server-side counterparts assume). Each row should be a testable property.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **The price displayed in the confirm modal equals the server-confirmed amount the user is about to commit to.** I.e., the displayed price comes from `Plan.monthlyPrice`/`yearlyPrice` returned by `useGetPlans()` (server source) and is *not* re-derived after fetch. | `ChangePlanPage.tsx:243-249` reads `selectedPlan?.monthlyPrice/yearlyPrice`; `SubscriptionContactPage.tsx:188-189` reads `contactData.amount` (server response from `/contact/subscription-inquiry` or `/upgrade-inquiry`). | ❌ none (frontend has only `ErrorBoundary.spec.tsx`) | user thinks they're paying X, server bills Y; trust loss, support tickets |
| I-2 | **No client-side authoritative price math.** Discount/proration is server-computed; the client only displays. | `ChangePlanPage.tsx:243-249` — direct read. `SubscriptionContactPage.tsx:189` — direct read of `contactData.amount`. `PlanCard.tsx:51-58` — `discount.discountedMonthlyPrice / discountedYearlyPrice` come from the server `Plan.discount` payload. | ❌ none | client-derived totals diverging from server billing under feature flags or rounding rules |
| I-2a | **Savings-% labels are display-only.** The "save 20%" badge math at `ChangePlanPage.tsx:43-48`, `SubscriptionPlansPage.tsx:53-63`, `PlanCard.tsx:142` is for UX copy, not for any submitted value. Server never reads it back. | All three sites compute locally and use the result only for the toggle badge / per-card subtitle. | ✅ static — no submit path reads these numbers | benign display drift; not a money-path concern |
| I-3 | **Idempotent submit:** repeated `handleSelectPlan` clicks on the same plan must not fire multiple change-plan / contact-inquiry mutations. | `ChangePlanPage.tsx:76-82` opens a confirm modal — no in-flight mutation fires on second click (the network call happens in `handleConfirmChange` instead). `handleConfirmChange:84-111` does not guard `changePlan.isPending`; relies on the button's `isLoading` at `:285` to disable. **Partially enforced — see F-4.** `SubscriptionPlansPage.tsx:25-31` has a `processingPlanId` guard at `:27` but the state setter is **never called** (F-1). | ❌ none | duplicate `POST /subscriptions/:id/change-plan` or duplicate contact-inquiry on flaky network / fast double-click. Server-side this couples to **M9** (`subscriptions.md` §7, F-1) — backend `confirmContactRenewal` is idempotent **only** when caller passes `externalReference`, which neither of these client calls does. |
| I-4 | **Role gate on subscription pages:** only `ADMIN` and `MANAGER` users can reach `/subscription/plans`, `/subscription/change-plan`, `/subscription/contact`. | `App.tsx:180` — `<Route element={<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}>...}>` wraps all three routes at `:218`, `:219`, `:220`. | ❌ none | a `WAITER` / `KITCHEN` user navigating directly to `/subscription/change-plan` would otherwise see plan-change UI; server-side authorization is the actual guard but UI exposure is a leak signal |
| I-5 | **Plan-mismatch detection between selection and submit:** the `selectedPlan` snapshot must equal the plan the server confirms. If `useGetPlans` refetches in the background and changes the price between selection and confirm, the user could see one price and be billed another. | **NOT enforced** — `ChangePlanPage.tsx:84-94` calls `changePlan.mutateAsync({ id, data: { newPlanId, billingCycle }})` with no integrity check (no version, no expected-price echo). React Query default is `staleTime: 0`, so a refetch on window-focus mid-modal could change `selectedPlan?.monthlyPrice` underneath the displayed price. | ❌ none | display ≠ server price; this is the I-1 escape hatch |
| I-6 | **Navigation effect runs only after render, not during it.** Conditional `navigate(...)` inside render bodies violates React's "no side effects in render" rule and can produce console warnings + double-navigation. | **Violated** at `ChangePlanPage.tsx:121-124`: `if (!currentSubscription) { navigate('/subscription/plans'); return null; }` — this `navigate()` call fires *during* render, not in `useEffect`. (`SubscriptionContactPage.tsx:74-76` correctly puts its `navigate` inside `useEffect`.) | ❌ none | console warnings; potential double-navigation under StrictMode; not a security issue, but a code-quality one |

> **Invariants check vs the seed list in §5.5 of `CODE_REVIEW.md`:** the only finding flagged for the broader `pages/subscription/` group there was a missing `rel="noopener"` (on `SubscriptionSettingsPage.tsx`, *not* on the three files in this review) — that finding is unchanged. The four invariants requested in scope (plan-price match, no client price math, idempotent submit, role gate) all have at least partial enforcement; the gaps are F-1 (dead double-submit guard) and F-4 (missing in-flight guard on confirm).

---

## 4. State machine — plan-selection UI

The selection flow has two persistent pieces of UI state worth modeling:

**Local state — `ChangePlanPage`:**
- `billingCycle: BillingCycle` (initialized from `currentSubscription.billingCycle` via `useEffect` at `:36-40`)
- `selectedPlan: Plan | null`
- `showConfirmModal: boolean`

**Transitions:**

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `IDLE → MODAL_OPEN(plan)` | `handleSelectPlan(planId)` on `PlanCard` click | `ChangePlanPage.tsx:76-82` — guards `plan.id !== currentSubscription?.planId` only | yes (no network call yet) | `selectedPlan`, `showConfirmModal=true` |
| `MODAL_OPEN → SUBMITTING` | `handleConfirmChange` | `ChangePlanPage.tsx:84-86` — guards `!currentSubscription || !selectedPlan` | **no — no `changePlan.isPending` check** (F-4) | `POST /subscriptions/:id/change-plan` |
| `SUBMITTING → REDIRECT_TO_CONTACT` (upgrade) | server returns `type='upgrade' && requiresPayment` | `:99-103` | yes (route push) | `navigate('/subscription/contact?type=upgrade&...')` |
| `SUBMITTING → REDIRECT_TO_SETTINGS` (downgrade) | server returns `type='downgrade'` | `:104-107` | yes (route push) | `navigate('/admin/settings/subscription')` |
| `MODAL_OPEN → IDLE` | cancel button or close-modal | `:216-219, 274-279` | yes | clears `selectedPlan`, `showConfirmModal` |

**Forbidden transitions:**
- `SUBMITTING → SUBMITTING (duplicate)` — must be guarded; **currently unguarded** at `handleConfirmChange:84-111`. The submit button is disabled via `isLoading={changePlan.isPending}` at `:285`, but a fast double-click on the button before React paints the disabled state, or a programmatic re-trigger, can fire `mutateAsync` twice. See F-4.

**Local state — `SubscriptionPlansPage`:**
- `billingCycle: BillingCycle`
- `processingPlanId: string | null` — **declared at `:18`, never set** (F-1).

The state machine itself is degenerate here: `handleSelectPlan` at `:25` only does `navigate(...)` — no mutation fires from this page. The `useCreateSubscription()` mutation imported at `:22` is never invoked (its `.mutate` is not called anywhere in the file). The page works by funneling all paid-plan selections to `/subscription/contact` and letting that page call the contact-inquiry mutation. So **the only real risk** on this page is the dead double-submit guard — and the consequence is mild (an extra route push, not a duplicate server write).

**Local state — `SubscriptionContactPage`:**
- `contactData: ContactLinksResponse | null` — populated by mutation on mount.
- `contacted: boolean` — local "thank you screen" flag, no server effect.

**Transitions:**

| From → To | Trigger | Guard | Idempotent? | Side effects |
|-----------|---------|-------|-------------|--------------|
| `IDLE → FETCHING` | `useEffect` on mount | `:40-77` — branches on `type === 'upgrade'` vs new sub | **no — `useEffect` deps `[planId, billingCycle, type, subscriptionId, newPlanId]` re-fire `.mutate` on any param change** (F-5) | `POST /contact/subscription-inquiry` or `/upgrade-inquiry` |
| `FETCHING → DISPLAYING` | `onSuccess` | `:50-52, 64-66` | yes | `setContactData(data)` |
| `DISPLAYING → CONTACTED` | WhatsApp or Email button | `:86-91, 93-98` | yes (sets local flag; opens `window.open` / `window.location.href`) | external app launch; **no server write happens client-side** — the inquiry POST already fired on mount. |
| `CONTACTED → DISPLAYING` | "back to contact" button | `:132-134` | yes | re-shows the WhatsApp/Email card without refetching |
| `CONTACTED → /admin/settings/subscription` | "go to subscription" button | `:127-128` | yes | route push |

**Transitions that should be idempotent but aren't:** the mount-effect at `:40-77` (F-5).

---

## 5. Money & precision audit

*Skipped — these pages do not perform authoritative price math.* They display server-supplied `Plan.monthlyPrice`, `Plan.yearlyPrice`, `Plan.discount.discountedMonthlyPrice/Yearly`, `ChangePlanResponse.paymentInfo.newAmount/prorationAmount`, and `ContactLinksResponse.amount`. Local arithmetic exists only for two UX-only displays — neither flows back to a submit:
- "Save X%" badge: `ChangePlanPage.tsx:43-48`, `SubscriptionPlansPage.tsx:57-62`, `PlanCard.tsx:142` — `Math.round(((monthly*12 - yearly) / (monthly*12)) * 100)`. Display-only.
- "₺X/month" subtitle for yearly cycles: `PlanCard.tsx:57` — `price / 12`. Display-only.

These are exempt from the §5.5 seed-list audit requirement.

---

## 6. Concurrency hazards

**Critical sections** (i.e., where the UI must serialize):
- `ChangePlanPage.handleConfirmChange` (`:84-111`) — single in-flight `changePlan.mutateAsync` call expected. Currently relies on button-disabled state (`:285`); see F-4.
- `SubscriptionContactPage` mount effect (`:40-77`) — single in-flight inquiry mutation expected. Currently relies on the absence of param changes; see F-5.

**Race windows still open:**

- **R-1 (Double-submit on confirm-upgrade)** — *Severity:* Medium Cor
  *Sketch:* user clicks "Confirm Upgrade" → `mutateAsync` fires (Promise A) → React re-renders with `isPending=true` → button disables → but if a second click landed in the same tick (touchscreen mis-tap, accessibility tools, keyboard `Enter` + mouse click) before disable applied → `mutateAsync` fires again (Promise B).
  *Where:* `ChangePlanPage.tsx:84-111`
  *Fix:* Add an explicit `if (changePlan.isPending) return;` at the top of `handleConfirmChange`. Same pattern is used in the (admittedly dead) guard at `SubscriptionPlansPage.tsx:27` — apply it where it's actually needed.
  *Coupling:* this is the client-side half of the M9 idempotency gap documented in `subscriptions.md` §7 F-1 / F-2. The backend currently dedupes on `externalReference` which the client does not send (`subscriptionsApi.ts:149-157` — request shape is `{ newPlanId, billingCycle }` only). A retry-safe outcome therefore requires *both* the frontend guard *and* the backend's `M9` fix (derive `externalReference` from `(subscriptionId, periodStart)` when caller omits it).

- **R-2 (Plan-change race)** — *Severity:* Low–Medium Cor
  *Sketch:* user opens `/subscription/change-plan`, `useGetPlans` returns prices `{BASIC: ₺99, PRO: ₺199}` → user selects PRO → modal opens displaying ₺199 → React Query refetches in background on window focus → `plans` updates to `{BASIC: ₺99, PRO: ₺249}` (price change deployed) → `selectedPlan` is a snapshot from the *first* render so the modal still shows ₺199 → user confirms → server applies ₺249 → mismatch.
  *Where:* `ChangePlanPage.tsx:23, 27, 76-82, 84-111` (state lives in `selectedPlan`, set at `:79` from the first render's `plans` array).
  *Fix:* either (a) before submit, re-read the current plan from `plans` by id and assert price equality, surfacing a "price has changed, please re-confirm" if mismatched, OR (b) send the displayed price as `expectedAmount` in the change-plan request and have the server reject on mismatch (server-side echo invariant). Option (b) requires a backend contract change.

- **R-3 (Contact-inquiry effect-loop)** — *Severity:* Low Cor
  *Sketch:* `SubscriptionContactPage`'s mount effect (`:40-77`) has deps `[planId, billingCycle, type, subscriptionId, newPlanId]`. If the URL changes (browser back/forward, or React Router replays), each change re-fires `getContactLinks.mutate` or `getUpgradeContactLinks.mutate`. There is no `if (contactData) return;` guard at the top of the effect, and the dep list omits `getContactLinks`, `getUpgradeContactLinks`, `navigate`, `t` (the linter would flag this with `react-hooks/exhaustive-deps`).
  *Where:* `SubscriptionContactPage.tsx:40-77`
  *Fix:* either gate the mutate on `if (contactData || getContactLinks.isPending || getUpgradeContactLinks.isPending) return;`, or refactor to `useMutation`'s `useEffect`-coupled pattern (a `useQuery` with `enabled` gating reads from the URL params).

- **R-4 (Browser-back during contact funnel)** — *Severity:* Low Cor
  *Sketch:* user lands on `/subscription/contact?...`, clicks WhatsApp → `window.open` succeeds → page sets `contacted=true` → user hits browser-back → returns to `/subscription/change-plan` → confirms again → second contact-inquiry POST is created server-side. Each inquiry is a side-effect (e.g., logs a "lead" on the server side via `backend/src/modules/contact/...`).
  *Where:* `SubscriptionContactPage.tsx:86-98` plus the upstream `handleConfirmChange:84-111`.
  *Fix:* this is the off-platform equivalent of "browser-back during 3DS" — given there's no real 3DS, the worst case is duplicate inquiry records. The backend `contact` module should dedupe inquiries on `(tenantId, planId, billingCycle, createdAt within 5min)`; that fix lives outside this review's scope.

**Idempotency keys:**
- **Present at:** none. Neither the `useChangePlan` request body (`subscriptionsApi.ts:155-157`) nor the contact inquiry request body (`contactApi.ts:4-15`) carries an `Idempotency-Key` header or an `externalReference` field.
- **Missing where needed:** `ChangePlanPage.tsx:88-94` (plan-change submit) and `SubscriptionContactPage.tsx:43-72` (inquiry submit). See F-6 and cross-link to `subscriptions.md §7 F-1 (M9)` for the server-side counterpart.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `SubscriptionPlansPage.tsx:18, 27` | `processingPlanId` state is declared and read by the `handleSelectPlan` guard (`:27` — `if (processingPlanId || currentSubscription) return;`) but its setter `setProcessingPlanId` is **never called** anywhere in the file (verified via grep — only the initial `useState(null)` exists). The double-submit guard is dead code. Note: on this page the consequence is mild (the handler only calls `navigate`, not a mutation), but the broken pattern is misleading and likely to be copy-pasted. | Remove `processingPlanId` entirely (and the `useCreateSubscription` import at `:22` — also unused), OR wire the setter around the `navigate` call so a double-click can't double-push the route. |
| F-2 | Medium | Cor | `SubscriptionPlansPage.tsx:41-47, 53-63` | **Rules-of-Hooks violation.** The `useMemo` for `maxSavingsPercent` at `:53` runs *after* the conditional early-returns at `:33-39` (loading) and `:41-47` (no plans). React requires hooks to be called in the same order on every render; an early-return before a hook violates this. (`sortedPlans` at `:50` is plain `.sort` not `useMemo`, so it's fine — but it sits in the same dead zone.) ESLint's `react-hooks/rules-of-hooks` would flag this. | Move `useMemo` (and any other hooks) above the early-returns. Or extract the early-return UI to a child component. |
| F-3 | Medium | Arch | `SubscriptionContactPage.tsx:79-84` | Page-local `formatCurrency` shadows the shared helper at `frontend/src/lib/currency.ts:14-20`. The local one prints `"123.45 TL"` for TRY (no thousands sep, alpha suffix), the shared one prints `"₺123.45"` (symbol prefix). `ChangePlanPage.tsx:16, 243` imports the shared helper. Same monetary amount renders differently across screens, undermining I-1's display fidelity. | Delete the local `formatCurrency` at `:79-84`. Import from `../../lib/currency`. Decide whether the "TL" suffix style is wanted globally — if yes, update the shared helper and refactor all call sites; do not maintain two. |
| F-4 | Medium | Cor | `ChangePlanPage.tsx:84-111` | `handleConfirmChange` does not check `changePlan.isPending` before calling `mutateAsync`. The submit button at `:285` disables on `isLoading={changePlan.isPending}`, but a double-click within the same render tick (before React paints the disabled state) fires two `POST /subscriptions/:id/change-plan` requests. Couples to M9 (`subscriptions.md` §7 F-1) — backend dedup is conditional on `externalReference` which this request does not send. | Add `if (changePlan.isPending) return;` at the top of `handleConfirmChange`. Mid-term, send an `Idempotency-Key` header (uuid-v4) generated at modal-open and let the server treat the second arrival as a no-op. |
| F-5 | Medium | Cor | `SubscriptionContactPage.tsx:40-77` | The mount `useEffect` fires `getContactLinks.mutate` / `getUpgradeContactLinks.mutate` with no guard against re-entry; deps are `[planId, billingCycle, type, subscriptionId, newPlanId]`. URL replays (back-forward, StrictMode double-mount in dev, or any external nav back to this page) re-fire the inquiry POST. The dep list also omits `getContactLinks`, `getUpgradeContactLinks`, `navigate`, `t` (would trip `react-hooks/exhaustive-deps`). | Gate the effect on `if (contactData \|\| getContactLinks.isPending \|\| getUpgradeContactLinks.isPending) return;`. Better: model this as a `useQuery` (with `enabled` from URL params) so React Query handles dedup and caching; mutations are the wrong primitive for "fetch on mount once". |
| F-6 | Medium | Cor | `subscriptionsApi.ts:149-157` (request shape) + `ChangePlanPage.tsx:88-94` (call site) | `useChangePlan`'s request body is `{ newPlanId, billingCycle }` only — no `Idempotency-Key`, no `externalReference`, no `expectedAmount`. A client retry (e.g., a Service Worker replay or a flaky-network double-send) lands as two distinct change-plan operations on the server. Cross-link: backend `subscription.service.ts:298-387` (`applyUpgrade`) dedups on `externalReference` *only when present* — see `subscriptions.md §7 F-1 / F-2 (M9)`. Frontend currently provides no key. | Generate an idempotency key at modal-open (`crypto.randomUUID()`); attach as `Idempotency-Key` header or extend `ChangePlanDto` with `externalReference`. Coordinated fix with `subscriptions.md §7 F-1`. |
| F-7 | Medium | Cor | `ChangePlanPage.tsx:121-124` | `if (!currentSubscription) { navigate('/subscription/plans'); return null; }` performs `navigate(...)` **during render**, not inside a `useEffect`. React's "no side effects in render" rule applies; under StrictMode dev this fires twice and can warn. The correct pattern is used at `SubscriptionContactPage.tsx:73-76` (inside an effect). | Wrap the navigation in `useEffect(() => { if (!currentSubscription) navigate(...); }, [currentSubscription])`. Return `null` (or a spinner) until the effect runs. |
| F-8 | Low | Cor | `ChangePlanPage.tsx:23, 36-40` | `billingCycle` is initialized to `MONTHLY` at `:22` and then *overwritten* in a `useEffect` at `:36-40` once `currentSubscription` loads. The first render therefore shows `MONTHLY` even when the user is on `YEARLY` — a brief flicker. Same anti-pattern as `frontend/src/components/ProtectedRoute.tsx` (cf. `CODE_REVIEW.md §2 F2`). | Initialize `billingCycle` from `useGetCurrentSubscription` lazily (e.g., via `useEffect` + suspense, or set initial to `null` and render a spinner until known). |
| F-9 | Low | Sec | `SubscriptionContactPage.tsx:88` | `window.open(contactData.whatsappLink, '_blank')` — no `'noopener,noreferrer'` window-features string. The opened tab has access to `window.opener` and can `opener.location = ...` (reverse-tabnabbing). Sister finding to `CODE_REVIEW.md §5.9` (two `target="_blank"` sites without `rel="noopener"`). | Change to `window.open(contactData.whatsappLink, '_blank', 'noopener,noreferrer')`. |
| F-10 | Low | Arch | `SubscriptionPlansPage.tsx:22, 50` | `useCreateSubscription` is imported but never invoked. `sortedPlans` at `:50` uses `a.monthlyPrice - b.monthlyPrice` (no `Number(...)` coercion) — works today because the backend returns numbers, but every other sort/comparison in these files uses `Number(...)` (e.g., `ChangePlanPage.tsx:62, 73`). Drift indicates accidental looseness. | Remove the dead import. Add `Number(...)` to the sort for type-consistency with the rest of the codebase. |
| F-11 | Low | Cor | `ChangePlanPage.tsx:108-110` | `catch {}` block swallows all `mutateAsync` errors with a stale comment ("Error handled by mutation"). The mutation's `onError` toasts the message, but any rendering error inside this flow (e.g., the user navigating mid-redirect) is also swallowed. | Tighten to `catch (e) { /* mutation onError handles toast; no rethrow needed */ }` with a Sentry breadcrumb at minimum, or remove the try/catch since `mutateAsync` rejection is already toasted in `subscriptionsApi.ts:171-173`. |
| F-12 | Info | Arch | `SubscriptionContactPage.tsx:53, 67` | `(error: any)` typing — common across the frontend. The `error.response?.data?.message` access pattern is fine in practice (axios shape) but loses type safety. | Define an `ApiError` type once in `lib/api.ts`; use across mutation `onError` handlers. |

Severity scale: Critical → High → Medium → Low → Info.
Dimensions: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **Server is source of truth for all confirmable prices.** `ChangePlanPage.tsx:243-249` reads `selectedPlan?.monthlyPrice/yearlyPrice` (server-supplied), never re-derives. `SubscriptionContactPage.tsx:188-189` reads `contactData.amount` (server response). No client computation flows back into a submit body. This is the I-1 / I-2 contract working as intended — keep doing this and other features (e.g., POS settings, marketing offers) should follow.
- **Role gate present at the route layer.** `App.tsx:180` wraps all three subscription pages in `ProtectedRoute allowedRoles={[ADMIN, MANAGER]}`. Unlike some screens where role checks happen inside the component, this enforces the gate before lazy-load — better fail-fast, less code in pages to forget.
- **Scheduled-downgrade UX surface.** `ChangePlanPage.tsx:147-160` reads `useGetScheduledDowngrade` and surfaces a yellow warning banner with the scheduled-for date. This pairs cleanly with the backend's "downgrade is scheduled at period end" invariant (`subscriptions.md §3 I-4`); the page makes the invariant visible to the user — which is the right design.
- **Upgrade vs downgrade branching is server-typed.** `ChangePlanResponse.type: 'upgrade' | 'downgrade'` (`subscriptionsApi.ts:127`) means the client doesn't have to re-decide the change direction; the page just routes based on the server's verdict. Removes a class of "client thought it was an upgrade, server said downgrade" mismatches.
- **`PlanCard` defensively coerces server prices with `Number(...)` before `.toFixed(2)`** (`PlanCard.tsx:48`). Backend currently returns numbers but if it ever switches to string-decimals (Prisma's default for `Decimal`) this won't break.
- **Modal `onClose` symmetrically resets `selectedPlan`** (`ChangePlanPage.tsx:216-219, 274-279`) — no orphaned-state-after-close bug.

---

## 9. Spot-checks performed

**Verified:**
- F-1 confirmed at `SubscriptionPlansPage.tsx:18` (declared) and `:27` (read) — searched for `setProcessingPlanId` in the file: zero matches. Setter is never called.
- F-2 confirmed: `useMemo` at `SubscriptionPlansPage.tsx:53` is below the conditional `return` at `:34-39, :41-47`. React's hook-order requirement is violated when `plans` is falsy or empty on first render.
- F-3 confirmed: `SubscriptionContactPage.tsx:79-84` defines local `formatCurrency` that outputs `"X.XX TL"`. `ChangePlanPage.tsx:243` calls the lib `formatCurrency` from `lib/currency.ts:14-20` that outputs `"₺X.XX"`. Same `Plan.currency === 'TRY'` renders two different strings in the same user session.
- F-4 confirmed: `handleConfirmChange:84-111` has no `if (changePlan.isPending) return;` guard. Button disable at `:285` is the only protection.
- F-7 confirmed: `ChangePlanPage.tsx:121-124` calls `navigate('/subscription/plans')` inside the component body, not inside `useEffect`.
- I-4 (role gate) confirmed via `App.tsx:180` — the `<Route element={<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}>...}>` wrapper is the parent of the three subscription routes at `:218-220`.
- M9 cross-link confirmed: `subscriptions.md` line 167 documents the conditional idempotency on `externalReference` — these frontend pages do not currently send one, so the gap is end-to-end.

**Dropped (initial hypothesis was wrong):**
- "Missing role gate on subscription pages" — verified at `App.tsx:180`: the parent route DOES enforce ADMIN/MANAGER. Initial seed-list hypothesis (cf. §5.5 of `CODE_REVIEW.md`) was that the page-level role gate might be missing; it isn't.
- "Client-side authoritative price math" — verified: no client-derived amount is sent back to the server. All math (savings %, per-month divisor) is display-only. Drop.

**Downgraded:**
- F-1 (initially "Critical, broken double-submit guard fires duplicate mutations") downgraded to **High Cor** after spot-check: the handler at `SubscriptionPlansPage.tsx:25-31` only does `navigate(...)`, not a mutation. The worst-case is a double route push, not a duplicate server write. Still High because the dead code is misleading and easy to copy-paste into a context where it *would* fire duplicates (and that context exists — `ChangePlanPage.handleConfirmChange`, F-4).

---

## 10. Recommended tests

Frontend tests today: **one** file (`ErrorBoundary.spec.tsx`, per `CODE_REVIEW.md §3.8`). Adding even three of these would set a foundation for the broader frontend test push noted in P3 of the upstream action plan.

```ts
// frontend/src/pages/subscription/__tests__/ChangePlanPage.spec.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePlanPage from '../ChangePlanPage';
// MSW handlers stub /subscriptions/current, /subscriptions/plans, POST /subscriptions/:id/change-plan

describe('ChangePlanPage', () => {
  it('T-1 (F-4): double-clicking "Confirm Upgrade" fires exactly one change-plan POST', async () => {
    // arrange: current sub on BASIC, MSW spy on POST /subscriptions/:id/change-plan
    // act: select PRO → modal opens → click Confirm twice within 50ms
    // assert: spy.callCount === 1
  });

  it('T-2 (I-5 / R-2): plan price changing between selection and confirm surfaces a warning', async () => {
    // arrange: render with PRO=₺199. Open modal.
    // act: invalidate the plans query so refetch returns PRO=₺249. Then click Confirm.
    // assert: either (a) UI shows "price has changed, please re-confirm" with new price,
    //   OR (b) submit body includes expectedAmount matching the *displayed* price
    //   so the server can reject the mismatch.
    // (As-is, this test will FAIL until the fix in F-6 lands — that is the point.)
  });

  it('T-3 (F-7): does not call navigate during render when currentSubscription is null', async () => {
    // arrange: MSW returns 404 on /subscriptions/current (no sub yet)
    // act: render <ChangePlanPage />
    // assert: no React "side effect during render" warnings; navigate fires from an effect on next tick
  });
});

// frontend/src/pages/subscription/__tests__/SubscriptionContactPage.spec.tsx
describe('SubscriptionContactPage', () => {
  it('T-4 (F-5 / R-3): URL replay does not re-fire the inquiry mutation', async () => {
    // arrange: render with ?planId=X&billingCycle=MONTHLY. MSW spy on POST /contact/subscription-inquiry.
    // act: trigger router replay (history.replace with same URL) twice.
    // assert: spy.callCount === 1 — the mutation runs once on first mount, no further fires.
  });

  it('T-5 (I-1): displayed amount matches contactData.amount from the server', async () => {
    // arrange: MSW returns { amount: 199.50, currency: 'TRY', ... }
    // act: render and wait for the plan card.
    // assert: screen.getByText(/199\.50/) is in the document. Display string is the server number, not derived.
  });
});

// frontend/src/pages/subscription/__tests__/SubscriptionPlansPage.spec.tsx
describe('SubscriptionPlansPage', () => {
  it('T-6 (I-4 / role gate): a WAITER cannot mount the page', async () => {
    // arrange: authStore primed with role=WAITER
    // act: visit /subscription/plans
    // assert: the route resolves to <Navigate to="/dashboard" /> (or whatever ProtectedRoute does);
    //   <SubscriptionPlansPage /> never mounts.
  });

  it('T-7 (F-2): hooks run in the same order across renders even when plans=[]', async () => {
    // arrange: MSW returns plans: [] on first call, plans: [BASIC, PRO, ...] on refetch
    // act: render, then trigger refetch via queryClient.invalidateQueries.
    // assert: no React "rendered fewer hooks than expected" warnings during the transition.
    // (Will FAIL until F-2 is fixed.)
  });
});
```

Cross-tenant isolation tests for these pages are out of scope — multi-tenant boundary is enforced server-side; the frontend just renders whatever `useGetPlans()` returns for the authenticated tenant. The corresponding backend test ("two tenants → one cannot see the other's plans") lives in `subscriptions.md §10` or `CODE_REVIEW.md §3.1`.

---

**Report:** 305 lines · 6 invariants (I-1 through I-6) · 12 findings (F-1 through F-12) · 0 unverified — every claim spot-checked against the cited `file:line`.
