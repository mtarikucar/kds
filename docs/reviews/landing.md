# `landing` — Deep Review (2026-05-11)

**Tier:** 2 (small surface, no money / state machine; single file per README convention)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `landing/` (Next.js 16 marketing site, App Router, next-intl, Sentry)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §6 — seeds F1 (missing CSP at `landing/next.config.ts:23-40`).

---

## 1. Health & summary

🟡 yellow

This is the public marketing surface: five-locale next-intl site (`en`, `tr`, `ru`, `uz`, `ar`), pricing page driven by ISR from the backend, plus a thin `/api/health` route. There is no auth, no money write, no PII intake beyond the SEO/`og` metadata. Risk concentrates in three places: (a) the response-header policy — `X-Frame-Options` and `X-Content-Type-Options` are present but `Content-Security-Policy` is not (seed F1, still unfixed at `next.config.ts:23-43`); (b) both error pages render `error.message` / `error.digest` / `error.stack` unconditionally, including in production (`global-error.tsx:117-129`, `[locale]/error.tsx:61-67`) — the CODE_REVIEW.md §6 note that this surface "shows generic message in prod" is inaccurate at the source; (c) the API base URL silently falls back to a hard-coded production host when env vars are missing (`lib/api.ts:115`), the same pattern the frontend explicitly fixed in commit `5154c2e`. Otherwise the surface is small and clean — Sentry redaction is wired on both client and server, source maps are hidden from the public bundle (`next.config.ts:62`), the `[locale]` route guard validates against the locale whitelist, and the next-intl middleware excludes `_next` / static assets correctly.

---

## 2. Scope of this review

**Read end-to-end:**
- `landing/next.config.ts` (73 LOC) — header policy, image remotePatterns, Sentry plugin wiring.
- `landing/src/lib/api.ts` (128 LOC) — static stats, `getPlans()` ISR fetch from backend, raw-plan flattener.
- `landing/src/middleware.ts` (15 LOC) — next-intl locale routing + matcher.
- `landing/src/i18n/config.ts` (20 LOC) — locale enum + RTL/hreflang map.
- `landing/src/i18n/request.ts` (15 LOC) — next-intl request-scoped locale + message loader.
- `landing/src/i18n/routing.ts` (12 LOC) — next-intl routing + navigation helpers.
- `landing/sentry.client.config.ts` (63 LOC) — replay (masked), `beforeSend` breadcrumb redaction, ignoreErrors allow-list.
- `landing/sentry.server.config.ts` (29 LOC) — request-header strip (`authorization` / `cookie` / `x-api-key`).
- `landing/sentry.edge.config.ts` (17 LOC) — DSN + release tagging only.
- `landing/src/app/global-error.tsx` (136 LOC) — outer error fallback (rendered when the locale layout itself errors).
- `landing/src/app/api/health/route.ts` (9 LOC) — JSON 200 health probe.
- `landing/src/app/[locale]/layout.tsx` (107 LOC) — locale guard, metadata, NextIntlClientProvider.

**Skimmed only:**
- `landing/src/app/[locale]/error.tsx` (73 LOC) — segment error boundary; same prod-leak pattern as `global-error.tsx`.
- `landing/src/components/FloatingMascot.tsx:7-32` — only file in scope that touches `localStorage` (key `hummytummy_first_visit`); not a token, but contradicts the seed's "no localStorage writes" claim for this surface.
- `landing/src/app/sitemap.ts`, `robots.ts`, `globals.css`, page bodies under `[locale]/{terms,privacy}/page.tsx` — static / SEO; no runtime branch.

**Skipped:**
- All section components under `src/components/{sections,mockups,layout,animations,ui}` — read-only presentational, no fetch/auth/storage surface; full per-file review is out of risk surface for this tier.

---

## 3. Business-logic invariants

The contract this surface is responsible for keeping. Each row is a property an integration / header test could assert.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Every public response carries `X-Frame-Options: SAMEORIGIN` + `X-Content-Type-Options: nosniff`. | `next.config.ts:33-39` (verified per §6) | ❌ none (no landing tests) | Clickjacking via iframe-embed of pricing/auth pages; MIME sniffing turning a misconfigured upload into an XSS. |
| I-2 | A baseline `Content-Security-Policy` header is sent on every response (seed F1: **NOT enforced**). | *missing* — would belong at `next.config.ts:27-40` | ❌ none | XSS payload from a future content-bug / third-party script has no additional gate. **Track as F-1 below.** |
| I-3 | Source maps are uploaded to Sentry but not exposed in the public client bundle. | `next.config.ts:62` (`hideSourceMaps: true`) | ❌ none | Original TS / line-numbers leak to anyone curling `.js.map`. |
| I-4 | Sentry redacts `authorization`, `cookie`, `x-api-key` from request headers before send. | `sentry.server.config.ts:21-25` | ❌ none | Auth cookies and API keys leak to Sentry SaaS. |
| I-5 | Sentry redacts `password`, `token`, `apiKey`, `secret`, `authorization` from breadcrumb data on the client. | `sentry.client.config.ts:30-48` | ❌ none | Form-field values surface in breadcrumbs (Sentry replay already masks DOM, but breadcrumb `data` is the secondary leak channel). |
| I-6 | Replay masks all text and blocks all media. | `sentry.client.config.ts:23-26` (`maskAllText: true`, `blockAllMedia: true`) | ❌ none | Customer PII visible in Sentry replay timeline. |
| I-7 | Locale must be one of `en`, `tr`, `ru`, `uz`, `ar`; anything else falls back to `en` server-side and 404s in the layout. | `i18n/request.ts:7-9` (server fallback) + `[locale]/layout.tsx:84-86` (`notFound()`) | ❌ none | Arbitrary `/[locale]/...` segment value reaches the message loader → 500 on missing import, or unbounded dynamic-import surface. |
| I-8 | next-intl middleware excludes `_next`, `_vercel`, and any file with an extension (`.*\\..*.`) from locale rewriting. | `middleware.ts:8-13` | ❌ none | `/favicon.ico` and `/_next/static/*` would 308-redirect through the i18n matcher; static asset cache breaks. |
| I-9 | `getPlans()` failure is non-fatal — caller gets `[]` and the page still renders. | `lib/api.ts:122,125-127` (both `!res.ok` and `catch` return `[]`) | ❌ none | Backend 500 takes down the marketing pricing page. |
| I-10 | No `eval` / `new Function` / `dangerouslySetInnerHTML` anywhere in the landing source. | `grep` over `landing/src/` — 0 matches (verified §9) | ❌ none | XSS via templated HTML; CSP bypass via `'unsafe-eval'`. |
| I-11 | `localStorage` writes are limited to non-PII / non-token UX state. | `components/FloatingMascot.tsx:17,21` (single key `hummytummy_first_visit`) | ❌ none | A future addition could write tokens / form drafts to `localStorage` and inherit the XSS exfiltration surface. |
| I-12 | API base URL is read from `NEXT_PUBLIC_API_URL` (with `API_URL` fallback). | `lib/api.ts:115` | ❌ none | Build/deploy with missing env silently targets a hard-coded host (`https://api.hummytummy.com.tr`) — see F-2 below. |

Invariants are not invented — each row is a property the existing code is already trying to keep (or in I-2's case, *should* be keeping per the seed).

---

## 6. Concurrency hazards

**Critical sections + lock strategy:** none. The only stateful read is `getPlans()` (ISR-cached fetch with `revalidate: 300` at `lib/api.ts:120`). No DB writes, no shared in-memory counters, no scheduler. The two `useEffect` calls in the error pages (`global-error.tsx:12-14`, `[locale]/error.tsx:12-14`) capture to Sentry exactly once per mount.

**Race windows still open:**

- *Sketch:* `getPlans()` is fetched at build time *and* every 300 s thereafter. If the backend serves a `200` with a malformed payload (missing `limits` / `features` / `discount`), the cache holds bad shape for up to 5 minutes.
  *Where:* `lib/api.ts:119-124` — `res.ok` is the only validation; there is no schema check on `RawPlanFromAPI`. `flattenPlan` uses `??` defaults on every nested field so the page won't crash, but it silently flattens partial data.
  *Severity:* Low (Cor) — marketing page degrades silently rather than crashes. Flagged at F-3.
  *Fix:* validate with `zod` (or a 5-line shape check) before flattening; on validation failure, return `[]` and the page renders the static "contact us for pricing" copy that the empty branch already supports.

- *Sketch:* `global-error.tsx` mounts → `useEffect` fires → `Sentry.captureException(error)`. If the same error also bubbled to `[locale]/error.tsx` (segment boundary) and that one mounted first, the same error is captured twice.
  *Where:* `global-error.tsx:12-14` and `[locale]/error.tsx:12-14` — both call `Sentry.captureException` unconditionally with no fingerprint dedupe.
  *Severity:* Info — Sentry's own client-side dedupe (`event.exception.values[0].stacktrace`) usually catches this within a session, but cross-boundary double-capture wastes quota.
  *Fix:* attach a stable `event_id` on the segment boundary and `tags: { boundary: 'segment' | 'root' }` on the root, or rely on Sentry's `dedupeIntegration` (enabled by default — verify it's not disabled). Flagged at F-4.

**ISR fallback pattern:** `getPlans()` returning `[]` on both `!res.ok` (status fail) and `catch` (network fail) is the right shape — every consumer treats `[]` as "render the static fallback UI". This is the pattern other parts of the site should copy for any future backend fetch (see §8).

**Idempotency keys:** N/A — read-only surface; no client-driven writes.

---

## 7. Findings

Verified findings unmarked; unverified flagged `*(unverified)*` with the line they came from.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Sec | `landing/next.config.ts:23-43` | **No `Content-Security-Policy` header.** `headers()` returns only `X-DNS-Prefetch-Control`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff` (all verified present per §6). Seeded by `CODE_REVIEW.md §2 F1`. | Add a starter CSP block in the same `headers()` array. Minimum viable for a Next.js + Sentry + next-intl + Google Fonts site: `default-src 'self'; script-src 'self' 'unsafe-inline' https://*.sentry.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://hummytummy.com https://staging.hummytummy.com; connect-src 'self' https://*.sentry.io https://api.hummytummy.com.tr; frame-ancestors 'self';`. Tighten `'unsafe-inline'` once nonce support is wired through `app/[locale]/layout.tsx`. |
| F-2 | Medium | Cor | `landing/src/lib/api.ts:115` | **Silent fallback to hard-coded prod host when env vars are missing.** `const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.hummytummy.com.tr'`. This is the exact pattern that was just fixed for the frontend in commit `5154c2e` ("surface missing VITE_API_URL instead of silently falling back to localhost"). A staging deploy with an unset `NEXT_PUBLIC_API_URL` would silently point the pricing page at production. | Drop the third arm; throw at module load if neither env var is set, or fall back only when `NODE_ENV !== 'production'`. |
| F-3 | Medium | Cor | `landing/src/app/global-error.tsx:117-129` and `landing/src/app/[locale]/error.tsx:61-67` | **Error fallback renders `error.message`, `error.digest`, and `error.stack` unconditionally — in production too.** There is no `NODE_ENV` guard around the details block. `CODE_REVIEW.md §6.2` claimed "dev shows details, prod shows generic message" — verified at the source, this is **not** the case. A stack trace can include internal module paths, environment variable names (if interpolated into an Error message upstream), and minified function names that aid an attacker mapping the bundle. | Wrap the details block in `{process.env.NODE_ENV !== 'production' && ( ... )}`. Both files need the change. |
| F-4 | Low | Cor | `landing/src/app/global-error.tsx:12-14`, `landing/src/app/[locale]/error.tsx:12-14` | **Sentry capture races between root and segment error boundaries.** Both call `Sentry.captureException(error)` unconditionally in `useEffect`. An error that propagates through both (segment first → root second) is captured twice unless Sentry's `dedupeIntegration` catches it. The replay integration is added explicitly at `sentry.client.config.ts:22-27` but `dedupeIntegration` is not — Sentry includes it by default, but a future migration that swaps `Sentry.replayIntegration(...)` for the full `integrations: [ ... ]` array would need to add `dedupeIntegration()` back manually. | Either set `tags: { boundary: 'root' | 'segment' }` and accept the double-count, or pass `event_id` through to dedupe explicitly. Document the dependency on `dedupeIntegration` near the `integrations` array. |
| F-5 | Low | Sec | `landing/src/components/FloatingMascot.tsx:7,17,21` | **`localStorage` write in this surface** — key `hummytummy_first_visit`. Not a token, not PII, and wrapped in `try/catch` for private-browsing. Flagged only because the previous review (`CODE_REVIEW.md §11.2`) recorded "localStorage writes: only `i18n_language` (no tokens)" for *frontend* and the wording was loose enough to be read as applying to landing too. The actual landing surface has this one extra key. | Either move to `sessionStorage` (the welcome animation only matters for the current session anyway) or add this key to the documented allow-list when CSP rolls out. |
| F-6 | Low | Arch | `landing/sentry.client.config.ts:51-62` | **`ignoreErrors` swallows `Failed to fetch` / `NetworkError`** — both common, but also the exact symptoms of a real CORS / CSP misconfiguration after F-1 lands. | Once CSP is added, remove or tighten the `Failed to fetch` entry so genuine CSP-blocked-request errors are visible during rollout. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec (security / multi-tenant) · Cor (correctness / business logic) · Arch (architecture / quality) · Perf (performance / reliability).

---

## 8. What's solid (positive findings)

Patterns to keep, and pointers to other parts of the repo that should copy them.

- `landing/next.config.ts:23-43` — **header-config block lives in one place.** The `async headers()` array is the right shape for a Next.js policy file: one source pattern (`/:path*`), one ordered list of headers. Adding CSP (F-1) is a single-row edit, not a refactor. Pattern to keep when ALLOWED_HOSTS / CORP / COEP follow.
- `landing/next.config.ts:62` — **`hideSourceMaps: true`** strips `.map` files from the public bundle while still uploading them to Sentry via `SENTRY_AUTH_TOKEN`. The conditional disable at `:68-69` correctly skips upload when the token is absent (local dev / CI without secrets), avoiding the common Sentry-plugin failure mode.
- `landing/src/lib/api.ts:119-127` — **ISR fallback pattern.** Two-armed graceful degradation: `!res.ok → []` and `catch → []`. Combined with `next: { revalidate: 300 }` this gives a stale-tolerant pricing page that survives backend outages. **Other surfaces that fetch from the backend should copy this exact shape** — particularly any future "stats from API" widget that today reads from `src/data/stats.json` (static).
- `landing/src/i18n/request.ts:7-9` + `landing/src/app/[locale]/layout.tsx:84-86` — **double locale guard.** Server-side request config falls back to `'en'` (so the message import never throws); the layout independently calls `notFound()` for any non-whitelist locale (so the URL surface is correct). One layer would be sufficient for safety; having both means a future refactor to either side can't accidentally break locale validation.
- `landing/sentry.server.config.ts:21-25` — **header-strip via simple `delete`** on `event.request.headers`. Three lines, three named headers (`authorization`, `cookie`, `x-api-key`), no regex surface area to get wrong. Easy to audit.
- `landing/sentry.client.config.ts:23-26` — **replay masks all text and blocks all media** by default. The right posture for a marketing site that may carry contact-form / signup-form interactions in the future.
- `landing/src/middleware.ts:6-14` — **matcher explicitly excludes `_next`, `_vercel`, and any file with a dot.** The negative-lookahead `(?!api|_next|_vercel|.*\\..*)` is the recommended next-intl shape; static assets stay on the cache-fast path.
- `landing/src/app/api/health/route.ts:3-8` — **9-line probe.** No DB call, no auth, no env-var read. Liveness only. The right shape — keep readiness separate if/when it's needed.

---

## 9. Spot-checks performed

**Verified:**
- F-1 confirmed at `landing/next.config.ts:23-43` — the `headers()` array returns exactly three headers; no `Content-Security-Policy` row exists.
- F-3 confirmed at `landing/src/app/global-error.tsx:117-129` and `landing/src/app/[locale]/error.tsx:61-67` — both error pages render `error.message`, `error.digest`, and `error.stack` inside a `<div>` / `<pre>` with no env guard. CODE_REVIEW.md §6.2's "prod shows generic message" claim is **inaccurate** at the source; corrected here.
- I-3 (`hideSourceMaps: true`) verified at `landing/next.config.ts:62`.
- I-4 (Sentry server header strip) verified at `landing/sentry.server.config.ts:21-25`.
- I-5 (Sentry client breadcrumb redaction) verified at `landing/sentry.client.config.ts:30-48`.
- I-6 (replay `maskAllText` + `blockAllMedia`) verified at `landing/sentry.client.config.ts:23-26`.
- I-7 (locale double-guard) verified at `landing/src/i18n/request.ts:7-9` and `landing/src/app/[locale]/layout.tsx:84-86`.
- I-9 (`getPlans()` returns `[]` on failure) verified at `landing/src/lib/api.ts:122,125-127`.
- I-10 (no `eval` / `new Function` / `dangerouslySetInnerHTML`) — `grep -rn 'eval(\|new Function\|dangerouslySetInnerHTML' landing/src` returned 0 matches.

**Dropped (initial report was wrong):**
- *"No `localStorage` writes anywhere in landing"* — initial seed wording (`CODE_REVIEW.md §11.2`, "localStorage writes: only `i18n_language` (no tokens)") was framed as a repo-wide grep result. Re-verified at `landing/src/components/FloatingMascot.tsx:17,21`: one write exists, key `hummytummy_first_visit`, non-token, try/caught. Downgraded to F-5 (Low) rather than dropped, because the invariant ("no token / no PII in localStorage") still holds and the new write is in scope of the same documented policy.
- *"Landing has zero tests"* — `CODE_REVIEW.md §3.8` says "Acceptable given it's mostly static." Confirmed: `find landing -name '*.spec.*' -o -name '*.test.*'` outside `node_modules` returns 0 files. Still acceptable for this surface; the §10 recommendations below are the minimum smoke tests, not a coverage push.

**Downgraded:**
- F-4 (Sentry double-capture race) was initially scoped as a Medium because the seed flagged a generic "Sentry capture race"; on reading, the practical impact is duplicate events that Sentry's default `dedupeIntegration` filters server-side. Downgraded to Low.

---

## 10. Recommended tests

The 3–5 tests that would catch the §3 invariants. Skeletons only.

```ts
// landing/__tests__/headers.spec.ts
import { describe, it, expect } from 'vitest';

describe('landing response headers', () => {
  it('I-1: sends X-Frame-Options: SAMEORIGIN and X-Content-Type-Options: nosniff on every route', async () => {
    // arrange: spin up next build output via @next/test-runner or hit a deployed preview URL
    // act: HEAD requests against '/', '/en', '/tr', '/api/health'
    // assert: response.headers['x-frame-options'] === 'SAMEORIGIN'
    //         response.headers['x-content-type-options'] === 'nosniff'
  });

  it('I-2: sends a Content-Security-Policy header on every route (currently FAILING — see F-1)', async () => {
    // act: HEAD '/'
    // assert: response.headers['content-security-policy'] is a non-empty string
    //         that contains "default-src" and does not contain "'unsafe-eval'"
  });
});
```

```ts
// landing/__tests__/i18n-locale-guard.spec.ts
import { describe, it, expect } from 'vitest';
import { locales } from '@/i18n/config';

describe('i18n locale guard (I-7)', () => {
  it('every whitelisted locale returns 200 at /[locale]', async () => {
    // act: for each locale of ['en','tr','ru','uz','ar'], GET `/${locale}`
    // assert: status === 200
  });

  it('unknown locale returns 404 (not 500 from a bad import)', async () => {
    // arrange: pick a value not in locales — e.g., 'de', 'zz', '../../../etc/passwd'
    // act: GET `/${value}`
    // assert: status === 404
    //         response body does not contain any module-resolution error string
  });
});
```

```ts
// landing/__tests__/sentry-redaction.spec.ts
import { describe, it, expect } from 'vitest';
// import the beforeSend handler directly from sentry.client.config.ts if exported,
// or refactor it into a pure helper so it can be tested without booting Sentry

describe('Sentry redaction (I-4, I-5)', () => {
  it('I-5: breadcrumb data has password / token / apiKey / secret / authorization replaced with [REDACTED]', () => {
    // arrange: build a fake event with breadcrumbs[0].data = { password: 'hunter2', other: 'ok' }
    // act: const sanitized = beforeSend(event)
    // assert: sanitized.breadcrumbs[0].data.password === '[REDACTED]'
    //         sanitized.breadcrumbs[0].data.other === 'ok'
  });

  it('I-4: server beforeSend strips authorization / cookie / x-api-key from request headers', () => {
    // arrange: fake event with event.request.headers = { authorization: 'Bearer x', host: 'h' }
    // act: const sanitized = serverBeforeSend(event)
    // assert: !('authorization' in sanitized.request.headers)
    //         sanitized.request.headers.host === 'h'
  });
});
```

```ts
// landing/__tests__/getPlans-fallback.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { getPlans } from '@/lib/api';

describe('getPlans ISR fallback (I-9)', () => {
  it('returns [] on non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false } as Response);
    expect(await getPlans()).toEqual([]);
  });

  it('returns [] when fetch throws (network down)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await getPlans()).toEqual([]);
  });
});
```

These four files are sufficient to lock in the §3 invariants that have any runtime branch. Pure-config invariants (`hideSourceMaps`, header presence) are best asserted at the deployed-URL level (header-presence test above); pure-static invariants (`I-10: no eval`) are best asserted by a `grep` step in CI rather than a test runner.
