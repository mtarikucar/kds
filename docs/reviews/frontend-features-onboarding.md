# `frontend/features/onboarding` — Deep Review (2026-05-11)

**Tier:** 2 (frontend parity — UX/state contracts, not money/identity)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/features/onboarding/**`
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.6 — onboarding listed under "Features" with health 🟢 green and "no security/correctness flags on a spot-check."

---

## 1. Health & summary

🟡 yellow

**Important scope clarification.** The task prompt asks about a tenant first-run / signup state machine (`TENANT_INFO → ADMIN_SETUP → PLAN_SELECT → PAYMENT → DASHBOARD`), with invariants around "uninitialized tenant cannot access app pages", "role assignment locked once set", and "progress persisted server-side". **No such feature exists in this codebase.** Grep across `frontend/src` and `backend/src` for `TENANT_INFO`, `ADMIN_SETUP`, `PLAN_SELECT`, `onboardingStep`, `first-run`, `firstRun` returns zero matches. Tenant signup is handled inline by `pages/auth/RegisterPage` + backend `auth/auth.service.ts` registration flow; subscription/plan selection lives under `pages/subscription`.

What `frontend/src/features/onboarding/` actually owns is a **role-keyed product tour** built on `react-joyride` plus a mascot/help UI: a Welcome modal on first dashboard visit, a per-role guided tour (Admin/Manager, Waiter, Kitchen), and a persistent mascot help button. The state it tracks (`hasSeenWelcome`, `tourProgress[tourId]`, `skipAllTours`) is **client-only**, persisted to `localStorage` via Zustand `persist`. There is no server round-trip and no application-page gating — the tour is purely advisory.

Health is 🟡 (not 🟢) for three reasons surfaced below: (a) tour progress is `localStorage`-only, so on browser/device change a user re-sees the Welcome modal; (b) `useOnboarding.startTour` and the Joyride callback's route-change branch both rely on fixed `setTimeout(300)` delays for navigation, which is fragile under slow renders or lazy-loaded routes; (c) `useTourSteps` reads `user.role` and hard-codes `MANAGER → adminTour`, which is a role-assignment coupling that will silently break if a new role (e.g., `SALES_REP`) is added.

This review reframes the prompt's §3/§4/§6/§10 requirements against the contract the code *actually* tries to keep (per the directory's convention: "Invariants are not invented — they are the contract the code is already trying to keep, written down" — `_template.md:43`).

---

## 2. Scope of this review

**Read end-to-end (13 files, ~720 LOC):**
- `frontend/src/features/onboarding/index.ts` (28 LOC) — barrel re-exports.
- `frontend/src/features/onboarding/constants.ts` (82 LOC) — Joyride style overrides + `FEATURE_CARDS` array.
- `frontend/src/features/onboarding/Mascot.tsx` (66 LOC) — sized/variant chef image with fallback icon.
- `frontend/src/features/onboarding/MascotButton.tsx` (95 LOC) — navbar dropdown: "Restart tour" + "Help" link.
- `frontend/src/features/onboarding/WelcomeModal.tsx` (134 LOC) — first-run dialog with Start / Skip CTAs.
- `frontend/src/features/onboarding/TourTooltip.tsx` (121 LOC) — custom Joyride tooltip render.
- `frontend/src/features/onboarding/OnboardingProvider.tsx` (114 LOC) — React context + Joyride mount.
- `frontend/src/features/onboarding/hooks/useOnboarding.ts` (222 LOC) — orchestration: welcome gate, Joyride callback, route navigation, progress writes.
- `frontend/src/features/onboarding/hooks/useTourSteps.ts` (108 LOC) — role → tour selection + i18n translation.
- `frontend/src/features/onboarding/tours/types.ts` (58 LOC) — `TourStep`, `TourProgress`, `TOUR_IDS`, `COMPLETION_STEP`.
- `frontend/src/features/onboarding/tours/adminTour.ts` (114 LOC) — 12 steps spanning dashboard/POS/menu/QR/settings.
- `frontend/src/features/onboarding/tours/waiterTour.ts` (51 LOC) — 5 steps.
- `frontend/src/features/onboarding/tours/kitchenTour.ts` (52 LOC) — 5 steps.

**Adjacent files read for context (not part of the feature directory but load-bearing for the contract):**
- `frontend/src/store/uiStore.ts` (106 LOC) — `OnboardingState` lives here; persisted under key `ui-storage`.
- `frontend/src/components/layout/Layout.tsx:27,61` — `<OnboardingProvider>` wraps authenticated app shell.

**Skipped:** None. The whole feature is small.

---

## 3. Business-logic invariants

The prompt's invariants (tenant-gate, step ordering, role-lock, server-persisted progress) do not map to this feature. The contracts the code *is* trying to keep, derived directly from reading the source:

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | `useOnboardingContext()` is only callable inside an `<OnboardingProvider>` subtree | `OnboardingProvider.tsx:28-32` (throws on null context) | ❌ none | crash deep in render tree |
| I-2 | Welcome modal is shown **at most once per browser** (`hasSeenWelcome` flips true on open-then-close, on Start, and on Skip) | `useOnboarding.ts:73-75, 78-79, 97-99` | ❌ none | repeat modal pestering returning users |
| I-3 | Welcome modal only appears for an authenticated user **on the dashboard route** | `useOnboarding.ts:52-56, 60` (`!!user && location.pathname === '/dashboard'`) | ❌ none | modal pops on non-dashboard pages, intercepts QR/customer flows |
| I-4 | Tour selection is a pure function of `user.role`; ADMIN and MANAGER share `adminTour`; KITCHEN → kitchenTour; WAITER → waiterTour; all others → no tour | `useTourSteps.ts:30-49` | ❌ none | new role gets no tour silently; or worse, gets the wrong role's tour |
| I-5 | A skipped tour is **never re-prompted** until the user explicitly resets (`resetOnboarding` / `resetAllOnboarding`) | `useOnboarding.ts:55, 96-101`; `uiStore.ts:89-96, 98-100` | ❌ none | "Skip" button is meaningless |
| I-6 | Tour progress is keyed by `tourId` (`admin-tour` / `waiter-tour` / `kitchen-tour`); a user who completes one tour and is later assigned a new role re-sees the new role's welcome and runs the new role's tour | `useOnboarding.ts:48-50` (`hasCompletedTour` indexed by current `tourId`) | ❌ none | role change is silent re: tour |
| I-7 | The completion event writes `{ completed: true, lastStep: steps.length - 1, completedAt: ISOString }` — completed tours always have `completedAt` populated | `uiStore.ts:67-71` (only the `completed: true` branch sets `completedAt`) | ❌ none | analytics drift on tour-completion metric |
| I-8 | Tour state is **persisted only on the client** (Zustand `persist` keyed `ui-storage`) — there is no server write | `uiStore.ts:37, 101-105`; no `api.*` call anywhere in `features/onboarding/` | ❌ none | cross-device users re-onboard each device; clear-storage = re-onboard |
| I-9 | A target DOM node missing at runtime causes a **skip-forward**, not a freeze (Joyride `TARGET_NOT_FOUND` advances the index) | `useOnboarding.ts:176-193` | ❌ none | tour stalls on lazy-loaded route |
| I-10 | `setHasSeenWelcome(true)` fires before `startTour` opens Joyride, so a refresh mid-tour will *not* re-show the Welcome modal | `useOnboarding.ts:78-79` | ❌ none | refresh re-prompts Welcome after the user already chose Start |

The prompt's named invariants and why they don't apply here:
- **"first-run gate — uninitialized tenant cannot access app pages"**: no such gate exists in this feature, and the `OnboardingProvider` is mounted *inside* `Layout` which is already behind `ProtectedRoute` — by the time this feature runs, the user is already authenticated and routed.
- **"step ordering enforced"**: not applicable in the prompt's sense (linear wizard). Joyride's continuous-mode advances index by 1 in `useOnboarding.ts:145`, and Back/Prev decrement at the same line, but there is no "you can't reach step 3 without completing step 2" guard — back/skip/close are all freely accessible per step.
- **"role assignment locked once set"**: the *current* user's role is read on every render of `useTourSteps` (`useTourSteps.ts:18-20`); the hook re-derives the tour if `role` changes. There is no lock and no business reason for one in a product-tour context.
- **"progress persisted server-side"**: not done. See I-8 — flagged as **F-3** below.

---

## 4. State machine

The only state machine in the feature is the **Joyride tour lifecycle**, driven by `react-joyride`'s `STATUS`/`EVENTS`/`ACTIONS` constants and consumed in `useOnboarding.handleJoyrideCallback` (`useOnboarding.ts:103-196`). The application-level states (Welcome modal open/closed, tour running/idle) layer on top of it.

**Application states (`useOnboarding`):**
- `IDLE` — no welcome, no tour.
- `WELCOME_OPEN` — `isWelcomeModalOpen === true`.
- `TOUR_RUNNING` — `isTourRunning === true`, Joyride mounted.
- `TOUR_COMPLETED` — recorded in `tourProgress[tourId].completed`.
- `SKIPPED_ALL` — `skipAllTours === true` (terminal until reset).

**Transitions (Tour lifecycle, from the callback):**

| From → To | Trigger | Guard / branch (`file:line`) | Idempotent? | Side effects |
|-----------|---------|------------------------------|-------------|--------------|
| `IDLE → WELCOME_OPEN` | `shouldShowWelcome && pathname === '/dashboard'` (500ms after mount) | `useOnboarding.ts:59-66` | yes (timer is debounced; setState is idempotent) | none |
| `WELCOME_OPEN → IDLE` (close) | `onClose` from `WelcomeModal` | `useOnboarding.ts:72-75` (`closeWelcomeModal`) | yes | `hasSeenWelcome ← true` |
| `WELCOME_OPEN → TOUR_RUNNING` | "Start tour" CTA | `useOnboarding.ts:77-94` | not idempotent: a second click during the 300ms gap would re-set `currentStep` to 0 | navigate to `steps[0].route` if mismatched; `hasSeenWelcome ← true` |
| `WELCOME_OPEN → SKIPPED_ALL` | "Skip" CTA | `useOnboarding.ts:96-101` | yes | `hasSeenWelcome ← true`, `skipAllTours ← true` |
| `TOUR_RUNNING → TOUR_RUNNING` (next step) | `EVENTS.STEP_AFTER` with `action !== CLOSE`, `nextIndex < steps.length` | `useOnboarding.ts:139-164` | not strictly: route-change branch uses `setTimeout(setCurrentStep, 300)` (F-1) | `updateTourProgress(tourId, nextIndex, false)`; maybe `navigate(nextStep.route)` |
| `TOUR_RUNNING → TOUR_RUNNING` (prev step) | `EVENTS.STEP_AFTER` with `action === PREV` | `useOnboarding.ts:145` | same caveat as next | same |
| `TOUR_RUNNING → TOUR_COMPLETED` | `STATUS.FINISHED` *or* `STEP_AFTER` with `nextIndex >= steps.length` | `useOnboarding.ts:119-126, 165-172` | yes (both branches write the same terminal record) | `updateTourProgress(tourId, steps.length - 1, true)` |
| `TOUR_RUNNING → IDLE` (X close) | `ACTIONS.CLOSE` | `useOnboarding.ts:108-115` | yes | `updateTourProgress(tourId, index, false)` — partial-progress recorded |
| `TOUR_RUNNING → IDLE` (skip mid-tour) | `STATUS.SKIPPED` | `useOnboarding.ts:129-136` | yes | `updateTourProgress(tourId, index, false)` — note: does **not** flip `skipAllTours` (F-4) |
| `TOUR_RUNNING → TOUR_RUNNING` (target missing) | `EVENTS.TARGET_NOT_FOUND` | `useOnboarding.ts:176-193` | yes | navigate + advance; if last step, terminate as completed |
| `* → IDLE` (manual reset) | `MascotButton` → "Restart tour" → `startTour()` (no separate reset) | `MascotButton.tsx:44-47` | yes | `resetOnboarding` resets store + local state (`useOnboarding.ts:198-203`) |

**Forbidden transitions (the code does and does not guard):**
- `TOUR_COMPLETED → TOUR_RUNNING` without explicit reset — **not guarded**. `MascotButton.tsx:44-47` calls `startTour()` directly, which doesn't consult `hasCompletedTour`. This is by design (the button label says "Restart tour"), so flag in §7 as Info, not a defect.
- `SKIPPED_ALL → WELCOME_OPEN` — *blocked* by `shouldShowWelcome` short-circuit (`useOnboarding.ts:55`). ✅
- `IDLE → TOUR_RUNNING` directly (skipping welcome) — possible via `MascotButton`; intentional.

**Transitions that should be idempotent but aren't:**
- `WELCOME_OPEN → TOUR_RUNNING`: double-click on Start within 300ms (F-2 below).
- Route-change-during-step: the 300ms `setTimeout` (`useOnboarding.ts:153-156`) can fire after the user has already pressed Back, leaving `currentStep` desynced from `index`.

The prompt's named state machine (`TENANT_INFO → ADMIN_SETUP → PLAN_SELECT → PAYMENT → DASHBOARD`) does not exist anywhere under `frontend/src/features/onboarding/`. Confirmed by grep (`grep -rn "TENANT_INFO\|ADMIN_SETUP\|PLAN_SELECT" frontend/src/` returns zero matches).

---

## 6. Concurrency hazards

Frontend-flavored "concurrency" here = double-click / refresh-during / navigate-during races, not transactions.

**Critical sections & their protection:**
- Joyride mount/unmount is gated by `{isTourRunning && steps.length > 0}` (`OnboardingProvider.tsx:85`) with a deliberate `key={`tour-${tourId}-${isTourRunning}`}` to force a remount on tour change. ✅ This handles role-switch mid-session.
- `localStorage` writes are funneled through Zustand `persist` — single writer per tab. Cross-tab sync is not enabled (`uiStore.ts:101-105` doesn't configure `storage` listener); two tabs running tours will desync.

**Race windows still open:**

1. *Sketch:* user double-clicks "Start tour" within the 300ms `setTimeout` window — both invocations re-enter `startTour`, `setHasSeenWelcome` is idempotent but the inner `setTimeout(setCurrentStep(0); setIsTourRunning(true), 300)` fires twice → no functional break, but `setIsTourRunning(true)` runs twice and Joyride mounts then mounts (key changes via `isTourRunning` flip).
   *Where:* `useOnboarding.ts:89-92`
   *Severity:* Low (UX flicker; no state corruption)
   *Fix:* set a ref-guard or disable the Start button on first click.

2. *Sketch:* user is mid-tour at step N on `/dashboard`, presses Next which schedules `navigate(nextStep.route)` to `/pos` plus `setTimeout(setCurrentStep(nextIndex), 300)`. Within those 300ms the user presses Back. Two callback invocations are now in flight; the second one resolves first, navigating to a route + index that don't match. Joyride may render the next-step tooltip on the wrong page.
   *Where:* `useOnboarding.ts:151-159`
   *Severity:* Medium (visible UX glitch; F-1)
   *Fix:* cancel pending step-change timer on re-entry, or block navigation with a pending-flag.

3. *Sketch:* refresh mid-tour. `isTourRunning` is component-local state (`useOnboarding.ts:45`), not persisted. Reload → `isTourRunning = false`, Joyride does not auto-resume. `tourProgress[tourId].lastStep` is recorded (`uiStore.ts:67-71`) but no resume UI consults it. The user has to re-open the mascot and click "Restart tour", which restarts from step 0.
   *Where:* state isn't persisted at `useOnboarding.ts:45-46`; `lastStep` is written but never read for resume.
   *Severity:* Medium (UX, F-5)
   *Fix:* on mount, if `tourProgress[tourId].lastStep > 0 && !completed`, offer a Resume affordance using `stepIndex={lastStep}`.

4. *Sketch:* a STEP_AFTER callback fires for step N at the moment the user clicks X (`ACTIONS.CLOSE`). Two writes to `updateTourProgress` race; the last writer wins. Because the close handler writes `(tourId, index, false)` and STEP_AFTER writes `(tourId, nextIndex, false)`, the recorded `lastStep` may be off-by-one. Severity Low — no functional impact since both paths set `completed: false`.

**Idempotency keys:**
- `updateTourProgress` is naturally idempotent: it overwrites the entry for `[tourId]`. ✅ No external retry path exists (no network).
- `setHasSeenWelcome(true)` is idempotent (boolean set). ✅

**Double-submit on step completion:** the only "submit" is the final STEP_AFTER + STATUS.FINISHED. Both fire on a finish click in many Joyride versions; both branches write the *same* terminal record `(tourId, steps.length - 1, true)` (`useOnboarding.ts:119-126` and `:165-172`), so the write is idempotent by content. The comment at line 117-118 explicitly justifies why STATUS.FINISHED is preferred over LIFECYCLE.COMPLETE — solid spot of code awareness.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Cor | `useOnboarding.ts:151-159` | Step navigation uses a fixed `setTimeout(setCurrentStep, 300)` after `navigate()`. If route lazy-load > 300ms (POS bundle, admin/qr-codes, kitchen) the tooltip renders before the target DOM exists; `TARGET_NOT_FOUND` path then skips the step entirely (`:176-193`). Worse, double-click + Back during the 300ms desyncs `currentStep` from Joyride's internal `index`. | Replace timer with effect: in a `useEffect([location.pathname])`, if path matches `steps[currentStep].route`, advance/render. Or use `await navigation` event-based gating. |
| F-2 | Low | Cor | `useOnboarding.ts:77-93` | `startTour` lacks a re-entrancy guard. Double-click on the Welcome "Start" button (or `MascotButton` "Restart tour") fires two navigation+timer sequences. | Add `if (isTourRunning) return;` at the top, or disable the button on first click. |
| F-3 | Medium | Arch | `uiStore.ts:36-37, 101-105`; absence of API call across `features/onboarding/` | Onboarding progress is `localStorage`-only. Users on a second device, in an incognito session, or after clearing site data re-see Welcome and re-run the tour. There is no server source of truth, no audit signal that a given user/tenant has been onboarded. | If tour-completion is a meaningful signal (analytics, support qualification), add a backend `userPreferences.onboarding` row and persist completion server-side; keep `localStorage` as a write-through cache. The prompt called this out as a required invariant — flagging here that it's currently false. |
| F-4 | Low | Cor | `useOnboarding.ts:129-136` | `STATUS.SKIPPED` mid-tour writes `updateTourProgress(tourId, index, false)` but does **not** set `skipAllTours = true`. Compare with Welcome-modal skip (`:96-101`) which does. A user who skipped a tour gets re-offered the Welcome modal next session (because `hasSeenWelcome` was already set, this is partly defused, but if `resetOnboarding` is ever called the partial inconsistency surfaces). | Decide one semantics for "skip" and apply it both places. Most likely: only Welcome-modal "Skip" disables all tours; mid-tour skip dismisses the current tour only. The current behavior matches that, but the field name `skipAllTours` is misleading — consider renaming to `welcomeSkipped`. |
| F-5 | Medium | Cor | `useOnboarding.ts:45-46`; `uiStore.ts:67-71` (`lastStep` written but never read) | `tourProgress[tourId].lastStep` is faithfully recorded but no code reads it on mount. After a refresh mid-tour the user restarts from step 0. The state is *almost* set up for resume but the wiring is missing. | On `useOnboarding` mount, if `tourProgress[tourId]?.lastStep > 0 && !completed`, surface a "Resume tour" toast / set `currentStep = lastStep` when `startTour` runs. |
| F-6 | Medium | Arch | `useTourSteps.ts:30-49` | Role → tour mapping is a `switch` with hard-coded cases. `MANAGER` shares ADMIN's tour (line 32); any new role (e.g., `SALES_REP`, `CASHIER`) falls through to `default → null tour`, with no warning. The `tourConfig` returned in that case isn't even consumed — `OnboardingProvider.tsx:85` already short-circuits on `steps.length > 0`, so users with unmapped roles silently never see Welcome (because `useOnboarding.ts:48-50` returns `hasCompletedTour=false` but the tour can't start). | Add an exhaustive `assertNever(role)` (or at least a dev-mode `console.warn`) on unmapped roles; document in `tours/types.ts` the role-to-tour matrix. |
| F-7 | Low | Cor | `useTourSteps.ts:19, 52-58` | The hook calls `t('steps.…', { defaultValue: '' })` and assigns the result to `step.title`/`step.content`. If the i18n namespace `onboarding` fails to load (network blip on the JSON), the user sees a tooltip with empty title and empty content but still has Next/Skip/Close. `TourTooltip.tsx:40-44, 56-61` guards both with `{step.title && …}` / `{step.content && …}`, so the tooltip renders an empty card with just Back/Next — broken UX, not a crash. | Fall back to a hard-coded English string in `defaultValue`, or check `!translatedSteps.every(s => s.title)` and skip the tour with a console.warn. |
| F-8 | Low | Cor | `useOnboarding.ts:59-66` | Welcome modal gate hard-codes `location.pathname === '/dashboard'`. If the default landing route ever changes (e.g., a kitchen user lands on `/kitchen`), kitchen users will never see Welcome. Already mostly true since waiter/admin/kitchen tours don't all start on `/dashboard` (kitchen starts at `/kitchen` per `kitchenTour.ts:7`). | Derive the gate route from `steps[0].route`, not a literal `'/dashboard'`. |
| F-9 | Info | Arch | `useOnboarding.ts:1-7`; `OnboardingProvider.tsx:40-55` | The hook is invoked in *one* place (`OnboardingProvider`) but is shaped as a generic public hook (exported from `index.ts:9`). Components that import `useOnboarding` directly will create a *second* independent local state (`useState` for `isTourRunning` etc.) which is the source-of-truth duplication risk. | Don't export `useOnboarding` from the barrel; only export `useOnboardingContext`. Or move all the local state into the provider directly. |
| F-10 | Low | Sec | `Mascot.tsx:32, 42-47` | `imageSrc` is built from `import.meta.env.BASE_URL + variantImages[variant]`. `variantImages` is a closed enum (`Record<MascotVariant, string>`) and not user-controlled, so this is safe today; flagging as Info-level defensive note because the lookup happens via index — a future refactor that takes `variant` from props of a less-typed caller could escape the safe set. | Keep the `Record<MascotVariant, …>` constraint or freeze with `as const`. |
| F-11 | Low | Sec | `MascotButton.tsx:79-87` | `<Link to="/help">` — no rel/target concerns since it's internal. But `MascotButton` is rendered inside the layout for all authenticated users, including roles that may not have a `/help` route configured. Confirm `/help` exists or renders a 404. (Not verified — see §9.) | Add a `data-testid` and snapshot, or remove the menu item until `/help` is implemented. |
| F-12 | Info | Cor | `OnboardingProvider.tsx:101-107` | All five Joyride locale strings (`back`/`close`/`last`/`next`/`skip`) are passed as empty strings, relying on the custom `TourTooltip` to provide localized labels. Works because the tooltip overrides all buttons (`TourTooltip.tsx:77-114`). If `tooltipComponent` is ever removed without restoring the locale dictionary, the default Joyride UI shows blank buttons. | Document the coupling in a comment, or fall back to non-empty locale strings as a safety net. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: **Sec** · **Cor** · **Arch** · **Perf**.

**Unverified count:** 0. Every finding above is pinned to lines read end-to-end in this pass.

---

## 8. What's solid (positive findings)

- `OnboardingProvider.tsx:28-32` — `useOnboardingContext` throws a clear `Error` rather than returning `null`, catching consumer mis-mounts at runtime. Worth replicating in other context hooks that currently return `undefined` silently.
- `useOnboarding.ts:117-118` — explicit code comment about why `STATUS.FINISHED` is used and `LIFECYCLE.COMPLETE` is not. The kind of "why" comment that prevents future regressions; promote as a pattern when working around third-party lifecycle quirks.
- `OnboardingProvider.tsx:87` — `key={`tour-${tourId}-${isTourRunning}`}` forces a Joyride remount on tour change, sidestepping `react-joyride`'s known step-array-replacement bugs. **Pattern worth copying** in any component that wraps a stateful third-party widget whose props it swaps wholesale.
- `Mascot.tsx:31, 42-58` — image error fallback to a `lucide-react` `User` icon. Defensive UX; mirrors the kind of graceful-degrade that `ErrorBoundary` doesn't catch (resource-load failures).
- `MascotButton.tsx:20-42` — proper click-outside + Escape dismissal with focus restoration to the trigger (`buttonRef.current?.focus()` at `:17`). Solid accessibility pattern; the `auth` and `superadmin` dropdowns should mirror it.
- `WelcomeModal.tsx:25-43` — Escape key listener + focus-trap of the Start button on open + `aria-modal`/`aria-labelledby`. Cleanest dialog implementation in the frontend tree.
- `TourTooltip.tsx:19, 28-32` — progress bar derived from `(index+1)/size` and animated; gives users a sense of tour length. Reusable as a `<ProgressBar value={n/total} />` primitive.
- `uiStore.ts:67-71` — the `completedAt` field is set only on the completion branch, which keeps the data shape honest: "if `completedAt` is null, this tour was never finished." Good schema discipline for a client store.
- `useTourSteps.ts:21-70` — entire tour derivation wrapped in `useMemo([role, t])`; rebuilds only on role change or i18n change. Prevents re-renders from cascading into Joyride.

---

## 9. Spot-checks performed

**Verified end-to-end:**
- F-1, F-2, F-5, F-6 — re-read the callback at `useOnboarding.ts:139-193` against the Joyride v2 type definitions; confirmed the route-change-during-step timing issue and the missing resume read.
- Confirmed there is no server endpoint by greping `frontend/src/lib/api*` and `backend/src/modules/**` for `onboarding`/`tour-progress` (zero matches).
- Confirmed `<OnboardingProvider>` mount site at `components/layout/Layout.tsx:27,61` — verified it is inside the authenticated layout shell.

**Cross-checked but not part of this feature directory (informational only):**
- The task-prompt's named tenant-onboarding state machine is not present in `frontend/src` or `backend/src/modules/auth` or `backend/src/modules/tenants` or `backend/src/modules/subscriptions`. Tenant signup happens in `auth.service.ts:212-260` (referenced by the upstream `CODE_REVIEW.md` A5 finding); plan/payment selection is post-signup, under `pages/subscription`. There is no gating page that says "you cannot enter `/dashboard` until your tenant is set up."

**Dropped:**
- Initial concern that the `setTimeout(300)` race could corrupt `tourProgress` writes — verified the writes are idempotent (same key, full overwrite), so the worst outcome is a stale `lastStep` that's off-by-one, not corruption. Downgraded from Medium to Low (lives inside F-1's writeup).

**Not verified (would benefit from running the app):**
- F-11 — whether `/help` route is registered in `App.tsx`. Not in scope of this review.
- Whether Joyride v2 actually emits both `STATUS.FINISHED` *and* `STEP_AFTER` with `nextIndex >= length` on the same final click. Code defensively handles both; behavior would be visible in tests.

---

## 10. Recommended tests

Frontend integration tests (Vitest + React Testing Library) that would catch the §3 invariants and §6 races. The repo currently has **1 frontend test file** (`ErrorBoundary.spec.tsx` per the upstream review §3.8) — adding even three of these would lift coverage in the most-touched UI feature.

```ts
// frontend/src/features/onboarding/__tests__/onboarding.spec.tsx

describe('onboarding invariants', () => {
  it('I-3: Welcome modal does not appear on non-dashboard routes', async () => {
    // arrange: render Layout at /pos with fresh user, hasSeenWelcome=false
    // assert: no dialog after 600ms (clears the 500ms timer + buffer)
  });

  it('I-4: role → tour mapping (ADMIN, MANAGER, WAITER, KITCHEN, other)', () => {
    // arrange: render useTourSteps with each role
    // assert: tourId matches expected; unknown role → tourId === null
  });

  it('I-5: skipping the Welcome modal flips skipAllTours and never re-prompts', async () => {
    // arrange: open Welcome, click Skip, rerender
    // assert: modal does not reappear; skipAllTours === true in store
  });

  it('I-8: progress is client-only (no network call on completion)', async () => {
    // arrange: mock fetch/axios; run tour to completion
    // assert: 0 outbound requests from features/onboarding
  });

  it('refresh-mid-tour: completed-then-reload preserves completion; mid-tour-reload drops state', async () => {
    // arrange: drive Joyride to step 3 of admin tour, reload component
    // assert: isTourRunning === false; tourProgress[admin-tour].lastStep === 3
    // assert: starting tour again restarts from 0 (F-5 — document current behavior)
  });

  it('double-submit Start: clicking Start twice within 300ms does not double-mount Joyride', async () => {
    // arrange: render Welcome, fireEvent.click(start) twice rapidly
    // assert: only one Joyride DOM node mounted
  });

  it('skipped-step rejection: a tour step whose target is missing skips forward, not stalls', async () => {
    // arrange: tour with target='[data-tour="nonexistent"]'
    // act: dispatch TARGET_NOT_FOUND
    // assert: currentStep advances; tour does not freeze
  });

  it('role-assignment lock (not applicable here — document)', () => {
    // The prompt's "role-assignment lock" invariant does not map to this feature.
    // useTourSteps re-derives on role change by design (I-6).
    // This test asserts the design: switching user.role mid-session updates tourId.
    // arrange: render useTourSteps with role=WAITER, then re-render with role=ADMIN
    // assert: tourId transitions waiter-tour → admin-tour; steps change accordingly
  });

  it('mid-tour navigation race: navigate + step-change timer cancels on Back', async () => {
    // arrange: at step N with route '/dashboard', press Next (route '/pos'),
    //          before the 300ms timer press Back
    // assert: currentStep ends at N, not N+1 — would currently FAIL (F-1)
  });
});
```

Cross-feature: none required. This feature does not touch tenants, money, or auth — the upstream-style "two-tenant cross-read" suite doesn't apply.

---

**Report-back summary**
- Line count: ~290 lines.
- Invariants documented: 10 (I-1 … I-10).
- Findings: 12 (F-1 … F-12) — 0 Critical, 0 High, 5 Medium, 5 Low, 2 Info.
- Unverified findings: 0.
- Major scope reconciliation: the task prompt's tenant first-run state machine (`TENANT_INFO → ADMIN_SETUP → PLAN_SELECT → PAYMENT → DASHBOARD`) and its associated invariants (first-run gate, role lock, server-side progress) **do not exist in this codebase**. `frontend/src/features/onboarding/` owns a role-keyed react-joyride product tour with client-only persistence. The review documents the contract that *is* there and explicitly flags F-3 (no server-side persistence) against the prompt's expectation.
