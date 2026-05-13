# `frontend/features/marketing` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/features/marketing/` (10 files, 944 LOC) + `frontend/src/store/marketingAuthStore.ts` (68 LOC) referenced
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.6 — seed row · [`./marketing.md`](./marketing.md) — backend counterpart (I-1..I-CT, §6 races, §8 patterns)

---

## 1. Health & summary

🟡 **yellow** — The marketing feature folder is **structurally clean and realm-isolated** (no cross-imports from `lib/api`, `store/authStore`, or `store/superAdminAuthStore` — verified by repo-wide grep). The SALES_REP role gate is consistent and centralized at `useMarketingAuthStore().user.role`, and the sidebar / dashboard / commissions UI all branch identically on `'SALES_MANAGER'`. The risk concentrates in **one file**: `features/marketing/api/marketingApi.ts` (56 LOC) is a hand-rolled axios instance that diverges from the hardened `lib/api.ts` (commit `9b9eee4`) on **four** of the five hardening fixes that already shipped for the tenant realm — no single-flight refresh, refresh-token rotation not honored, no timeout, and silent `localhost` fallback on missing `VITE_API_URL`. None of these are exploitable, but every one is a UX cliff that the tenant realm already paid to remove. Plus, the store's "re-auth via /api/marketing/auth/refresh on reload" comment (`marketingAuthStore.ts:61`) is **aspirational** — the refresh flow exists only inside the 401 interceptor, which fails immediately on reload because `refreshToken` is wiped from memory. Health is yellow rather than red because the realm-separation invariant *is* upheld and the role gate is consistently applied; the API client just hasn't received the hardening pass that `lib/api.ts` did.

---

## 2. Scope of this review

**Read end-to-end:**
- `features/marketing/api/marketingApi.ts` (56) — axios instance + 401 interceptor.
- `features/marketing/types.ts` (223) — `LeadStatus`, `OfferStatus`, `MarketingRole` enums + label/color maps.
- `features/marketing/components/MarketingProtectedRoute.tsx` (26) — route gate.
- `features/marketing/components/MarketingLayout.tsx` (55) — shell.
- `features/marketing/components/MarketingSidebar.tsx` (103) — nav + role-gated "Sales Team" item.
- `features/marketing/components/MarketingHeader.tsx` (321) — notifications, profile menu, change-password modal.
- `features/marketing/components/ActivityTimeline.tsx` (94) — read-only render.
- `features/marketing/components/LeadStatusBadge.tsx` (16) — read-only render.
- `features/marketing/components/StatsCard.tsx` (43) — read-only render.
- `features/marketing/components/index.ts` (7) — barrel.
- `store/marketingAuthStore.ts` (68) — zustand store, persist + partialize.

**Skimmed (cross-link only, not in folder scope):**
- `pages/marketing/LeadDetailPage.tsx` (641), `CommissionsPage.tsx` (~200), `MarketingLoginPage.tsx` (96) — sampled to verify the SALES_REP role gate and lead-status UI use the same primitives.
- `lib/api.ts` (87) — diff source for the API-client divergence.
- `store/authStore.ts` (78) — same-pattern reference for memory-only access token comment.

**Skipped:**
- `pages/marketing/*` full review — covered by a separate pages review.
- WebSocket/realtime — no marketing socket exists.

---

## 3. Business-logic invariants

Same shape as `marketing.md §3`, but **frontend-side** — these are the invariants the UI is responsible for upholding *in addition to* the backend guards (the backend is the actual authority). Each row is testable by RTL or Playwright.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-F1 | Marketing realm uses a **separate axios instance** from tenant `lib/api` — its baseURL is `${API_URL}/marketing`, its interceptors read/write `useMarketingAuthStore` only, and it never touches `useAuthStore` or its httpOnly refresh cookie. | `features/marketing/api/marketingApi.ts:6-9, 13, 29` (only `useMarketingAuthStore`); cross-imports = **none** (verified by grep) | ❌ none | A tenant access token leaks into a marketing request, or vice versa — backend `marketing.guard.ts:48-50` (`payload.type !== 'marketing'`) rejects it, but the UX cost is silent 401 → logout on every request. |
| I-F2 | Marketing realm uses a **separate auth store** from tenant `useAuthStore` and superadmin `useSuperAdminAuthStore`. Each store's `persist` key is unique (`'marketing-auth-storage'`). | `store/marketingAuthStore.ts:56`; tenant `'auth-storage'` at `store/authStore.ts:69` | ❌ none | Two realm sessions in one browser collide (same localStorage key) → impersonation or session-mix on reload. |
| I-F3 | Marketing access token + refresh token are **memory-only** — neither is persisted to localStorage. Only `user` + `isAuthenticated` survive reload (used to render the shell). | `store/marketingAuthStore.ts:62-65` (partialize), comment `:57-61` | ❌ none | XSS on the marketing origin drains a 30-day refresh from localStorage → session takeover. |
| I-F4 | Marketing `<Outlet/>` is only mounted when `isAuthenticated === true`; otherwise → `<Navigate to="/marketing/login">`. | `features/marketing/components/MarketingProtectedRoute.tsx:21-23` | ❌ none | An unauthenticated user sees marketing UI flicker. |
| I-F5 | Manager-only sidebar items ("Sales Team") render **iff** `user.role === 'SALES_MANAGER'`. SALES_REP sees only the seven shared items. | `features/marketing/components/MarketingSidebar.tsx:25-27, 31, 59-73` | ❌ none | SALES_REP discovers and navigates to manager-only URLs. (Backend `MarketingRolesGuard` still blocks; this is UX-clarity, not auth.) |
| I-F6 | Lead status transitions go through **only one mutation site** (`PATCH /leads/:id/status`) — the UI does not invent an offline status state machine. The `LeadStatus` enum is the single source of truth. | `features/marketing/types.ts:6-16`; consumer: `pages/marketing/LeadDetailPage.tsx:108-112, 331-342` | ❌ none | Drift between UI-displayed status and backend `ALLOWED_TRANSITIONS` table (`marketing.md` I-8). |
| I-F7 | `WON` is **not** a button in the status flip-grid for direct transitions — the only path to WON is `Convert to Customer`, which appears iff `status ∈ {OFFER_SENT, WAITING} ∧ convertedTenantId == null`. | `pages/marketing/LeadDetailPage.tsx:198` (`canConvert`), `:228-232` (button gate) | ❌ none | Rep clicks WON in the status grid, backend rejects with `marketing-leads.service.ts:295-299`, user sees a 400. **Currently violated** — see F-2 below: the status grid renders *every* `LeadStatus` value including WON. |
| I-F8 | A converted lead (`convertedTenantId != null`) shows a sealed-state banner; the convert button disappears; status flip still posts to the backend (which will 400). | `pages/marketing/LeadDetailPage.tsx:198, 247-251` | ❌ none | UI claims the lead is still mutable when the backend has sealed it. |
| I-F9 | Commission **write** actions (`Approve`, `Mark Paid`) are gated by `isManager`. SALES_REP sees commissions but no actions column. | `pages/marketing/CommissionsPage.tsx:16, 143, 172-195` | ❌ none | SALES_REP sees buttons that return 403 — the backend `MarketingRolesGuard` is the authority, but the UI shouldn't offer the action. Verified: column is conditional, buttons are inside `isManager &&`. |
| I-F10 | Commission **amount** is displayed read-only on `CommissionsPage` for *all* roles — no inline-edit UI exists in this folder. | `pages/marketing/CommissionsPage.tsx:160` (raw `${Number(c.amount).toFixed(2)}` cell, no `<input>`) | ❌ none | A rep edits their own commission amount before submit. The backend `marketing-commissions.service.ts:125-127` immutable-after-PENDING check would still reject, but a UI that *offered* the field would be misleading. |
| I-F11 | The `Assign Lead` panel (manager-side reassignment) is gated by `isManager`. | `pages/marketing/LeadDetailPage.tsx:302, 104` (rep-list fetch is `enabled: isManager`) | ❌ none | SALES_REP sees a panel that returns 403. |
| I-F12 | On reload, `accessToken` and `refreshToken` are null (memory-only by `partialize`). The store's comment promises a refresh-on-mount flow; the UI's actual behavior is to render the shell and **lazy-bounce** on the first 401. | `store/marketingAuthStore.ts:62-65`; comment claim at `:61`; actual flow only at `features/marketing/api/marketingApi.ts:26-49` | ❌ none | UI flicker + double-fetch on every reload — see F-3. The comment overstates what the code does. |

Invariants are not invented — each is a contract the existing UI is already trying to keep, written down so a test can assert it.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**

- `features/marketing/api/marketingApi.ts:21-53` — **token refresh on 401**. No single-flight gate. If N parallel queries 401 (typical on reload because the dashboard page fans out into 4-5 simultaneous `useQuery` calls), the interceptor fires N parallel `POST /marketing/auth/refresh` calls. The backend issues a fresh access+refresh pair on every call (`marketing-auth.service.ts:122-125`, full token-pair rotation per backend `marketing.md` I-20) — so the *first* response sets a token, the second response sets a different token over it, etc. The losing tokens are invalidated server-side at the moment the next refresh begins via `tokenVersion`-style rotation; client retries against the original axios instance may fire with whichever `accessToken` happens to be in the store at retry time. **Severity:** Medium — likely manifests as occasional logout on slow networks; not a security finding.

- `features/marketing/components/MarketingProtectedRoute.tsx:8-19` — **JWT expiry preflight**. The `useEffect` decodes the JWT and calls `logout()` if `exp` has passed. Runs on every `accessToken` change. Safe because `logout` is sync/local (matches the `authStore.ts:20-25` comment), but it does NOT clear the React Query cache — stale lead data from the previous session could flash if `<Outlet>` re-mounts before the navigate completes. **Severity:** Low.

**Race windows still open** (each with a reproduction sketch):

- *Sketch (lead-update race):* SALES_REP A and SALES_MANAGER M both have the same lead open in `LeadDetailPage`. A clicks `CONTACTED → MEETING_DONE` (fires `PATCH /leads/:id/status`); M concurrently clicks `Convert to Customer` (fires `POST /leads/:id/convert`). Both `useMutation` calls succeed at the client; React Query optimistically invalidates after each `onSuccess`. The cross-link to `marketing.md` F-2 documents that the **backend** race can leave the lead with `status: OFFER_SENT, convertedTenantId: <set>` for one read cycle. On the UI side, A's `onSuccess` toast says "Status updated" even when the backend has actually written WON via M's convert. **Where (frontend):** `pages/marketing/LeadDetailPage.tsx:108-112` (`statusMutation`) — the `onSuccess` does not re-read the lead before toasting.
  *Severity:* Low Cor — purely a misleading toast; the next `invalidate()` corrects the display.
  *Fix:* Have `onSuccess` read the mutation response (if backend returns the updated lead) and reflect actual `status` in the toast — or drop the success toast in favor of letting the badge re-render.

- *Sketch (status-flip-while-converting):* SALES_MANAGER opens `LeadDetailPage` for a lead at `OFFER_SENT`. They click `Convert to Customer`, the modal opens, they enter form data. While the modal is open (no spinner blocks the page), the status flip-grid at `:328-344` is still interactive — manager clicks `LOST` by accident. Both mutations fire. **Outcome:** the convert mutation reads `lead.status === 'OFFER_SENT'` from cached state but the backend may have already accepted `LOST`; if so, backend `marketing-leads.service.ts:289-294` (`ALLOWED_TRANSITIONS[LOST] === []`) seals the lead and `convert()` then fails on the convertedTenantId-null check or surfaces 400. UX-wise the manager sees both a "Lead lost" toast and a "Failed to convert lead" toast.
  *Severity:* Low Cor — the backend protects the invariant; UI just shows two conflicting toasts.
  *Fix:* Disable the status flip-grid when `showConvertModal === true`, or wrap the convert button in a confirm dialog and gate the grid on `!showConvertModal`.

- *Sketch (status-flip-while-converting, terminal):* Lead at `WAITING`. Rep clicks `LOST` and concurrently manager clicks `Convert`. The convert TX wins → `WON`. The rep's `LOST` mutation reaches the backend after `WON` is set; `marketing-leads.service.ts:300-304` rejects because `convertedTenantId != null`. **Outcome:** safe (backend invariant); but the UI's optimistic-state caching could briefly show LOST then snap to WON when `invalidate()` runs. **Where:** same as above.
  *Severity:* Info — transient flicker only.

- *Sketch (concurrent 401 refresh, frontend-side):* Dashboard mount fans out `useQuery(['leads']) + useQuery(['tasks']) + useQuery(['offers']) + useQuery(['commissions'])` — four parallel requests. All have stale token, all 401, all enter the interceptor, all read `refreshToken` from store, all `POST /auth/refresh` simultaneously. Backend rotates the refresh on each — the third one to commit may see the second-rotated refresh as already-replayed and 401-revoke. **Where:** `features/marketing/api/marketingApi.ts:36-49`.
  *Severity:* Medium Cor — see F-1.
  *Fix:* Port the single-flight pattern from `lib/api.ts:31-58`.

**Idempotency keys:**
- Marketing UI mutations don't carry client-side idempotency keys. The backend's `convert()` gates re-submission via `lead.convertedTenantId @unique` (per `marketing.md §6`), so a double-clicked Convert button is safe server-side. The `convertMutation` does not disable its trigger button between click and `onSuccess` — `pages/marketing/LeadDetailPage.tsx:620-636` has no `disabled={convertMutation.isPending}` guard on the submit. Backend protects the invariant, but a fast double-click produces two HTTP requests and the user sees one "Lead converted successfully!" toast plus a 409-translated "tenant already created" error toast.
  Severity: Low UX — fix by adding `disabled={convertMutation.isPending}` to the convert submit button.

---

## 7. Findings

Same format as `docs/CODE_REVIEW.md`. Verified findings unmarked; unverified flagged `*(unverified)*`.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `features/marketing/api/marketingApi.ts:21-53` | **No single-flight refresh.** Tenant `lib/api.ts:31-58` documents (and shipped in `9b9eee4`) that N parallel 401s must coalesce onto one refresh; the marketing client has not received that fix. With backend marketing refresh rotating both tokens (`marketing-auth.service.ts:122-125`), N concurrent refreshes race and at least N-1 of them write tokens that are immediately revoked by the next-arriving rotation. | Lift the `refreshInFlight` pattern from `lib/api.ts:38-58` verbatim. Also persist the **new** refreshToken returned at line 42 — currently only the access token is captured (`:42-43`); after a refresh, the stale refresh stays in the store and the *next* refresh will fail. |
| F-2 | High | Cor | `pages/marketing/LeadDetailPage.tsx:331-342` (cross-link, not in folder scope but lets I-F7 fail) | The status flip-grid renders **every** member of the `LeadStatus` enum, including `WON`. Backend `marketing-leads.service.ts:295-299` explicitly forbids `PATCH .../status { status: 'WON' }` and returns 400 with a message pointing the user at `/convert`. So a manager who clicks `WON` in the grid gets a backend 400 toast instead of being guided to the modal. The frontend `LeadStatus` enum at `features/marketing/types.ts:14` is the source of values; the grid does not filter it. | Filter the grid: `Object.values(LeadStatus).filter(s => s !== LeadStatus.WON)`. Or move `WON` rendering to a disabled-styled chip with a tooltip "Use Convert to Customer". |
| F-3 | High | Cor | `store/marketingAuthStore.ts:57-61` + `features/marketing/components/MarketingProtectedRoute.tsx:21-23` | The store's comment promises "on reload we rely on the persisted `user` flag to show the shell and re-auth via /api/marketing/auth/refresh." **The re-auth never runs on reload.** `partialize` drops `accessToken` and `refreshToken`; the only `/auth/refresh` caller is the 401 interceptor at `features/marketing/api/marketingApi.ts:26-49`, which reads `refreshToken` from the store and *immediately* falls into the `!refreshToken → logout()` branch. Net effect: reload → `isAuthenticated` rehydrates true → ProtectedRoute mounts `<Outlet>` → first dashboard fetch 401s → interceptor sees no refresh token → `logout()` → bounce to `/marketing/login`. The UI flickers the authenticated shell for ~one render cycle before logout fires. This is the marketing-realm twin of `CODE_REVIEW.md §F2` (and the comment is doubly misleading because, unlike the tenant realm, marketing has no httpOnly cookie to fall back on — the refresh token is bearer-in-JSON-body, see F-7). | Either (a) drop the misleading comment and accept "reload = re-login" as the documented model, or (b) actually implement on-mount refresh by persisting the refresh token to httpOnly cookies server-side (mirror tenant `lib/api.ts`'s `withCredentials: true`), or (c) make `ProtectedRoute` block render until a `/auth/refresh` resolves. Option (b) is the strategically correct one — it brings marketing in line with the tenant realm's defense-in-depth. |
| F-4 | Medium | Cor | `features/marketing/api/marketingApi.ts:38-43` | **No timeout on refresh.** If `/auth/refresh` hangs (DNS, gateway 504, network blip), every queued request blocks indefinitely behind the interceptor await. Direct analog of `CODE_REVIEW.md §F3`, which lists the tenant-side equivalent as Medium and still un-fixed. | `Promise.race([axios.post(...), new Promise((_, r) => setTimeout(() => r(new Error('refresh-timeout')), 10000))])`. |
| F-5 | Medium | Arch | `features/marketing/api/marketingApi.ts:4` | `const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';` — silent localhost fallback. Commit `5154c2e` deliberately removed this pattern from `lib/env.ts` because it masked misconfiguration in production builds. The marketing client never received the fix. | Import from `lib/env.ts` (which throws if `VITE_API_URL` is missing). One-liner. |
| F-6 | Medium | Sec | `store/marketingAuthStore.ts:33-39` + `pages/marketing/MarketingLoginPage.tsx:25` | The login response delivers `refreshToken` in the JSON body and the UI hands it to `login()`, which stores it in zustand state (memory only — good). But during the request flight, the token sits in `data.refreshToken` (line 25) and in axios's response object, both visible to any XSS that lands during the same tick. The tenant realm avoids this by setting the refresh in an httpOnly cookie on the server and never letting JavaScript touch it (`lib/api.ts:7-8`, `withCredentials: true`). Marketing's posture is "memory-only is good enough" — defensible for a 30-day token but inferior to the tenant realm's posture. | Migrate marketing-auth to httpOnly cookie + `withCredentials`. Defense-in-depth; pair with F-3 fix (b). |
| F-7 | Medium | Cor | `features/marketing/api/marketingApi.ts:42` | After refresh, only `accessToken` is captured: `const { accessToken } = response.data; setAccessToken(accessToken);`. The store has no `setRefreshToken`, and the backend rotates the refresh token on every refresh (`marketing-auth.service.ts:122-125`, "full token-pair rotation"). So after refresh #1 the in-memory refresh token is stale; refresh #2 will 401-revoke. Symptom: the marketing session survives exactly one 401-recovery before forcing a re-login, regardless of token TTLs. | Add `setRefreshToken` to the store (or fold both into `setTokens`), capture both on refresh: `const { accessToken, refreshToken } = response.data; setTokens(accessToken, refreshToken);`. |
| F-8 | Medium | Cor | `features/marketing/components/MarketingProtectedRoute.tsx:10-19` | JWT exp check uses `atob(accessToken.split('.')[1])` and reads `payload.exp * 1000 < Date.now()`. (1) `atob` will reject base64url characters (`-`, `_`) in some JWT signing libs — JWTs strictly use base64url, not standard base64. Today the backend uses Node's `jsonwebtoken` which pads/converts internally, but a future signer switch breaks this silently and the route stops detecting expiry. (2) `JSON.parse` on a tampered token would throw and the catch correctly `logout()`s — fine. (3) The check has no clock-skew tolerance — a 1-second-fast client logs out one second before the token actually expires. | Use a JWT decode helper or `atob(... .replace(/-/g, '+').replace(/_/g, '/'))`. Add a ~30s skew tolerance: `payload.exp * 1000 + 30_000 < Date.now()`. |
| F-9 | Low | Sec | `features/marketing/components/MarketingHeader.tsx:9-15` | `Notification` interface declares `message: string` and renders it inline at `:186` (`{n.message}`) via React's escaping — safe from XSS *as long as* the backend never includes raw HTML. No `dangerouslySetInnerHTML` anywhere in the folder (verified — grep returns 0). Note for completeness. | None. |
| F-10 | Low | Arch | `features/marketing/api/marketingApi.ts:3` + `pages/marketing/LeadDetailPage.tsx:173-181` | `marketingApi` is a default export and a singleton. Several mutations type their `mutationFn` as `(data: any) => marketingApi.post(...)` — the `any` defeats DTO-shape typing. The shapes do exist in `features/marketing/types.ts` (`Lead`, `LeadOffer`, `Commission`). | Type each mutation: `useMutation<Lead, AxiosError, ConvertLeadDto>({...})`. |
| F-11 | Low | UX | `features/marketing/components/MarketingProtectedRoute.tsx:21-23` | On the unauthenticated → authenticated transition, `<Outlet>` mounts before the first data fetch resolves; on the reverse (logout), `<Navigate>` runs after a render cycle — there's a one-frame flash of the authenticated shell. Same pattern as `CODE_REVIEW.md §F2`. | Mirror the tenant `ProtectedRoute` fix when it lands (P1 in the master action plan). |
| F-12 | Info | Arch | `features/marketing/components/index.ts:1-7` | Barrel re-exports 7 modules. All are default-exported components — fine. No re-export of `types.ts`, so callers in `pages/marketing/*` import enums directly from `features/marketing/types`. Consistent. | None. |
| F-13 | Info | Sec | `features/marketing/components/MarketingHeader.tsx:269` | WhatsApp link uses `target="_blank"` + `rel="noopener noreferrer"` — checked at `pages/marketing/LeadDetailPage.tsx:269` (the only `target="_blank"` in the marketing surface). Compare to `CODE_REVIEW.md §11.2`, which catalogs two tenant-side `target="_blank"` without rel. Marketing realm is clean. | None — flag as positive in §8. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/quality) · Perf (performance/reliability).

---

## 8. What's solid (positive findings)

Patterns that already work — call them out so future readers know what to keep, and so other realms know what to copy.

- **`store/marketingAuthStore.ts:55-66` — separate-store-per-realm.** Each realm (tenant, marketing, superadmin) has its own zustand store with a distinct `persist` name (`'auth-storage'`, `'marketing-auth-storage'`, the superadmin one). No shared state. Combined with each realm's own axios instance (`lib/api.ts` for tenant, `features/marketing/api/marketingApi.ts` for marketing), there is **no path for tokens to leak across realms in the client**. Three stores with parallel shapes is more code than one polymorphic store, but it's structurally safer — a refactor that broke realm-isolation in a polymorphic store would silently route tenant tokens through marketing requests; with the current design that mistake doesn't compile (you'd have to import the wrong store from the wrong feature, and `grep -rn 'useAuthStore' features/marketing/` returns zero). **Cross-link to backend** `marketing.md §I-18`: the backend enforces realm separation by signing with `MARKETING_JWT_REFRESH_SECRET` and gating on `payload.type === 'marketing'`. The frontend's separate-store pattern is the symmetric client-side enforcement. **Candidates that should keep using this:** future panels (e.g., partner portal, analyst dashboard) should follow the same pattern — never extend `useAuthStore` to carry a `realm` discriminator.

- **`features/marketing/api/marketingApi.ts:6-9, 13, 29` — realm-locked axios baseURL.** The baseURL is `${API_URL}/marketing` — any accidental call to a tenant route would 404, not silently succeed. Combined with the interceptor reading `useMarketingAuthStore` only (not `useAuthStore`), this means a developer who copy-pastes a tenant query into a marketing page will get a fast failure mode. **Candidates:** keep this pattern for every realm-scoped client.

- **`features/marketing/components/MarketingSidebar.tsx:25-31, 59-73` — role-gate is one expression.** `const isManager = user?.role === 'SALES_MANAGER'` is computed once and used for both the "Management" section header and the manager-only items. Verified the same pattern at `pages/marketing/CommissionsPage.tsx:16, 143, 172`, `pages/marketing/LeadDetailPage.tsx:54, 104, 236, 302`, `pages/marketing/MarketingDashboardPage.tsx:17`, `pages/marketing/ReportsPage.tsx:8`. **Five separate components, identical expression** — that's the kind of consistency that survives feature growth. The optional chaining (`user?.role`) safely handles the brief "rehydrating from persist" window. **Candidates:** every role-gated UI should adopt the single-expression rule.

- **`features/marketing/components/MarketingProtectedRoute.tsx:11-12` — pre-emptive JWT exp check.** Decoding the JWT to detect expiry *before* firing a doomed request is a UX win — saves one 401 round-trip on a stale tab. Worth porting to tenant `ProtectedRoute` (tenant currently relies entirely on the 401 interceptor). Caveats listed at F-8.

- **`store/marketingAuthStore.ts:62-65` — strict partialize.** Only `user` and `isAuthenticated` survive reload. The comment at `:57-61` correctly identifies the threat model ("XSS as session-takeover primitive for a long-term 30-day stolen refresh"). The implementation matches the comment for *what is persisted* — the comment overstates only what happens *on reload* (F-3 covers that).

- **`features/marketing/types.ts:1-70` — enums as single source of truth.** All status / role / source / type values are typed enums, not ad-hoc string unions. Status badge + label maps live alongside (`:182-204`). The `LEAD_STATUS_LABELS` and `LEAD_STATUS_COLORS` maps are `Record<LeadStatus, string>` — TypeScript will fail compilation if a new status enum value is added without a label. **Candidates:** every status-displaying feature should mirror this `Record<Enum, string>` style.

- **`features/marketing/components/LeadStatusBadge.tsx:7-15` — defensive fallthrough on unknown status.** `LEAD_STATUS_LABELS[status as LeadStatus] || status` and `... || 'bg-gray-100 text-gray-800'`. If the backend ever introduces a new status without a frontend deploy, the badge renders the raw value in gray — degraded UX, not a crash. Good resilience posture.

- **Cross-link to backend `marketing.md §8`:** the patterns the backend marks as gold (deterministic Decimal commission math, allowed-transitions table, `convertedTenantId @unique` idempotency, no-fallback refresh secret) are all *backend* responsibilities — the frontend's contribution to those invariants is to **not duplicate them** in the client. Verified: the marketing UI never computes commission amounts client-side; never maintains an offline status state machine (I-F6); never tries to assign a `convertedTenantId` (it's read-only on the lead object). Frontend correctly delegates authority.

---

## 9. Spot-checks performed

What was opened and end-to-end verified vs what stayed at "agent-reported".

**Verified:**
- I-F1 (separate axios instance): grep confirmed zero imports of `lib/api`, `useAuthStore`, or `useSuperAdminAuthStore` from `features/marketing/` or `pages/marketing/`. Marketing realm is import-isolated.
- I-F3 (memory-only tokens): `store/marketingAuthStore.ts:62-65` partialize confirmed; reading the function literal — only `user` and `isAuthenticated` returned.
- I-F5 (role gate in sidebar): `MarketingSidebar.tsx:31, 59-73` confirmed; `isManager &&` wraps the entire `managerOnlyItems` block.
- I-F7 violation (F-2): `LeadDetailPage.tsx:331` reads `Object.values(LeadStatus)` unfiltered; WON is present at `types.ts:14`. The flip-grid does include WON. **Confirmed.**
- F-3 (reload aspirational): traced the entire `/marketing/auth/refresh` call chain — only one caller at `marketingApi.ts:38`, only invoked from the 401 interceptor. No mount-time refresh. The store's comment promises a reload-refresh that does not exist.
- F-7 (refresh-token rotation not honored): destructuring at line 42 is `const { accessToken } = response.data;` — `refreshToken` from the response is dropped on the floor.
- F-13 dropped: `target="_blank"` audit on the folder turned up only the WhatsApp link (`LeadDetailPage.tsx:269`), already with `rel="noopener noreferrer"`. Compare with `CODE_REVIEW.md §11.2` cross-cutting grep.
- F-5 (localhost fallback): line 4 `|| 'http://localhost:3000/api'` matches the anti-pattern removed by commit `5154c2e` from `lib/env.ts`. The marketing client never received that fix.

**Dropped (initial scan was wrong):**
- "Marketing components leak tenant tokens": searched `features/marketing/` for `useAuthStore`, `lib/api`, `withCredentials` — zero matches. The realm is genuinely isolated at the import boundary. Drop.
- "MarketingProtectedRoute has no children-blocking loading state and renders an unauth shell": verified at `:21-23` — the `!isAuthenticated` check fires *before* `<Outlet>` is rendered. The flicker concern at F-11 is real but minor; the original "renders unauth shell" framing was wrong. Downgraded to Low UX.
- "Commission amount is editable for reps": searched `pages/marketing/CommissionsPage.tsx` for `<input>` near commission cells — none. The amount is a `<td>` text cell at `:160`. Drop. (See I-F10.)

**Downgraded:**
- F-1 from Critical to High: backend's `tokenVersion` rotation makes the worst-case "two reps share a session" impossible — the failure mode is unintended logout, not unauthorized access.
- F-6 from High to Medium: refresh-in-body posture is defensible for a memory-only zustand store; the upgrade to httpOnly cookie is defense-in-depth, not a correctness fix.

---

## 10. Recommended tests

The 3–10 integration tests that would catch the §3 invariants and §6 race risks. Skeletons only; not full implementations.

```ts
// frontend/src/features/marketing/__tests__/marketing-isolation.spec.tsx

describe('marketing realm isolation', () => {
  it('I-F1 cross-realm leakage: tenant axios never sees marketing tokens (and vice versa)', async () => {
    // arrange: login as tenant admin (populates useAuthStore.accessToken = TENANT_TOKEN)
    //          login as marketing manager in same browser session
    //            (populates useMarketingAuthStore.accessToken = MARKETING_TOKEN)
    // act: api.get('/orders')                 // tenant axios
    //      marketingApi.get('/leads')         // marketing axios
    // assert: the tenant request's Authorization header === `Bearer ${TENANT_TOKEN}`
    //         the marketing request's Authorization header === `Bearer ${MARKETING_TOKEN}`
    //         localStorage['auth-storage'].state.accessToken === undefined  (memory-only)
    //         localStorage['marketing-auth-storage'].state.accessToken === undefined
    //         localStorage keys are exactly: ['auth-storage', 'marketing-auth-storage', 'i18n_language', ...non-token]
  });

  it('I-F2 storage-key collision: tenant and marketing partialize keys are distinct and do not overwrite', async () => {
    // arrange: login tenant, capture localStorage['auth-storage']
    //          login marketing, capture localStorage['marketing-auth-storage']
    // act: reload
    // assert: both persisted user records survive; neither stomped the other.
  });

  it('I-F5 role gate: SALES_REP does not see manager-only nav, even with a forged user.role in devtools', async () => {
    // arrange: useMarketingAuthStore.setState({ user: { ..., role: 'SALES_REP' } })
    // act: render MarketingSidebar
    // assert: queryByText('Sales Team') === null
    //         queryByText('Management') === null
    // act: setState({ user: { ..., role: 'SALES_MANAGER' } })
    // assert: getByText('Sales Team') visible
  });

  it('I-F7 forbidden WON in status grid (currently FAILS — F-2 violation)', async () => {
    // arrange: render LeadDetailPage with a lead at status=OFFER_SENT
    // assert (intended): queryByRole('button', { name: /^Won$/i }) === null
    //                    getByRole('button', { name: /Convert to Customer/i }) visible
    // assert (current behavior — bug): WON button is rendered and clickable.
  });

  it('I-F9 commission action gate: SALES_REP sees commissions list but no Approve/Pay buttons', async () => {
    // arrange: setState role=SALES_REP, mock GET /commissions response with mixed-status rows
    // act: render CommissionsPage
    // assert: queryByText('Actions') (column header) === null
    //         queryByRole('button', { name: 'Approve' }) === null
    //         queryByRole('button', { name: 'Mark Paid' }) === null
  });

  it('F-1 single-flight refresh: 5 parallel 401s coalesce to 1 /auth/refresh call', async () => {
    // arrange: prime msw to 401-then-200 on the first marketing endpoint, and to
    //          200 (with a new accessToken+refreshToken pair) on /marketing/auth/refresh.
    // act: Promise.all([leads(), tasks(), offers(), commissions(), users()])
    // assert: msw.handlers.find('POST /marketing/auth/refresh').callCount === 1
    //         (currently FAILS — callCount === 5)
  });

  it('F-3 reload re-auth: persisted user with no in-memory refresh token bounces to /login', async () => {
    // arrange: localStorage['marketing-auth-storage'] = { state: { user: U, isAuthenticated: true } }
    //          fresh memory: accessToken=null, refreshToken=null
    // act: render <BrowserRouter><MarketingProtectedRoute /></BrowserRouter> at /marketing/dashboard
    //      fire any data fetch
    // assert: within one tick, location === '/marketing/login'
    //         OR (intended fix) the Protected Route blocks render until a refresh succeeds.
  });

  it('F-7 refresh-rotation: after refresh #1, store.refreshToken === new value from response', async () => {
    // arrange: state.refreshToken = R_old; mock /auth/refresh to return { accessToken: A_new, refreshToken: R_new }
    // act: fire a request that 401s once, then succeeds after refresh
    // assert: useMarketingAuthStore.getState().refreshToken === R_new
    //         (currently FAILS — still R_old, will 401-revoke on refresh #2)
  });

  it('status-flip-while-converting race: status grid is disabled while convert modal is open', async () => {
    // arrange: render LeadDetailPage at OFFER_SENT, open convert modal
    // assert (intended): all buttons in the "Change Status" grid have aria-disabled
    // assert (current behavior): buttons remain enabled — see §6 sketch 2.
  });

  it('I-F12 lead-update race: stale toast on concurrent status+convert', async () => {
    // arrange: lead at OFFER_SENT in UI; mock PATCH /status to return 200 *after* a manager's POST /convert has committed WON
    // act: fire statusMutation('CONTACTED'); concurrently fire convertMutation(...)
    // assert (intended): the success toast reflects the final state (WON), not the optimistic CONTACTED
    // assert (current): two toasts, one misleading — see §6 sketch 1.
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`.

**For this folder, the canonical isolation test is the cross-realm test** (I-F1 / I-F2) — two parallel logins in the same browser, attempt to leak tokens from one realm's axios into the other, assert zero leakage. Pair with the cross-link to backend `marketing.md §10`'s **I-18 cross-realm token rejection** test (which asserts the server-side guard fires) — together they prove realm separation from both sides.
