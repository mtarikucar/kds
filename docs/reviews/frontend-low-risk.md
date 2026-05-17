# `voxel-world/` + UI primitives + hooks + SubscriptionContext — Tier-3 Brief Verdict (2026-05-11)

**Tier:** 3 (brief verdict — §1, §2, §7, §8 only)
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:**
- `frontend/src/features/voxel-world/` (architectural verdict only — 139 .ts/.tsx files)
- `frontend/src/components/ui/` (19 primitives)
- `frontend/src/hooks/` (12 hooks + 1 barrel)
- `frontend/src/contexts/SubscriptionContext.tsx`
- `frontend/src/App.tsx` (route-wiring verification only)

**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.4 (route wiring), §5.7 (voxel-world), §5.8 (hooks/UI/contexts)

---

## 1. Health & summary

🟢 **green** (one downgrade vs the §5.7 seed — see F-1)

The three surfaces in this review are independently small, low-coupling, and free of XSS / dangerous-render patterns. UI primitives (19 files, ~2360 LOC) are pure presentation wrappers around lucide-react icons and Tailwind utility classes; the 12 hooks (~1453 LOC) are mostly `Intl.*` formatters and `navigator.*` adapters; `SubscriptionContext` is a thin React-Query wrapper that exposes `hasFeature` / `checkLimit` helpers backed by server-resolved `effectiveFeatures`. None of these surfaces own state-machine state, money, or multi-tenant boundary checks.

A grep across all three directories (`grep -rn 'dangerouslySetInnerHTML\|innerHTML\|eval(\|new Function' frontend/src/components/ui/ frontend/src/hooks/ frontend/src/contexts/`) returned **zero matches** — i.e., no DOM injection surface anywhere in this scope. The §5.3 cross-cutting observation about `frontend/src` avoiding unsafe-render patterns continues to hold here.

The only meaningful finding is an **architectural correction to the §5.7 seed**: three.js / `@react-three/fiber` / `@react-three/drei` **are** present in the production bundle. They do NOT enter via the dev-only `FloorPlan3DPage` (correctly gated by `import.meta.env.DEV` — verified) — they enter via `AnalyticsPage` → `AnalyticsFloorPlan`, which imports voxel-world components directly. The analytics chunk is lazy-loaded with the rest of the analytics route, so the entry bundle is not penalized — but the §5.7 claim "Production bundle does not include three.js / shader code" is **false**. Downgraded from "no findings" to one Medium/Arch (F-1) plus three Info-level corrections to the seed (F-2, F-3, F-4).

Two seed counts were also re-verified:
- §5.8 claims "13 hooks" — actual is **12** (F-4). `frontend/src/hooks/index.ts` is a barrel, not a hook.
- §5.8 claims "19 UI primitives" — actual is **19**. Confirmed.
- §5.4 claims `DashboardPage` and `POSPage` are eagerly imported — **confirmed** at `App.tsx:54-55` (F-2 carries the perf note).
- §5.7 claims `FloorPlan3DPage` is dev-only-conditional and lazy-loaded — **confirmed** at `App.tsx:95-97` and `App.tsx:209-211`.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/contexts/SubscriptionContext.tsx` (135 LOC) — `SubscriptionProvider`, `useSubscription`, `useFeatureEnabled`, `useLimitCheck`. `hasFeature` / `checkLimit` precedence (effectiveFeatures > plan).
- `frontend/src/App.tsx` (281 LOC) — verified §5.4 seed claims about eager imports and dev-only gating.
- `frontend/src/pages/dev/FloorPlan3DPage.tsx` (58 LOC) — sole voxel-world entry from app routes.
- `frontend/src/features/voxel-world/index.ts` (259 LOC) — public barrel surface.
- `frontend/src/components/ui/Modal.tsx` (87 LOC) — spot-checked for unsafe escape/scroll handling; clean.

**Skimmed only (architectural / no per-file review):**

*`frontend/src/features/voxel-world/`* — 139 .ts/.tsx files across 14 subdirs (`engine/`, `command/`, `scenes/`, `plugins/`, `shaders/`, `store/`, `hooks/`, `components/` and its 9 sub-subdirs, `types/`, `utils/`, `data/`). Read only `index.ts` and grepped for three.js / `@react-three/*` imports across the tree (28 matches in voxel-world, plus 4 in `features/analytics/components/*` — the cross-feature leak). Spot-checked `HeatmapOverlay.tsx` (the cross-feature surface) and `AnalyticsFloorPlan.tsx` (the importer).

*`frontend/src/hooks/`* — 12 files. Spot-checked:
- `useAutoSave.ts` (debounce-save with mount/unmount safety),
- `useAutoUpdate.ts` (Tauri plugin dynamic-import pattern),
- `useGeolocation.ts` (navigator.geolocation wrapper).
The remaining 9 (`useCurrency`, `useFormatCurrency`, `useFormatDate`, `useFormatNumber`, `useFormatRelativeTime`, `useLocale`, `useOnlineStatus`, `usePageTracking`, `useResponsive`) are thin `Intl.*` / `window.matchMedia` / `navigator.onLine` wrappers — inventoried but not deep-read.

*`frontend/src/components/ui/`* — 19 primitives: `Badge`, `Button`, `Card`, `Checkbox`, `dialog`, `dropdown-menu`, `FormSelect`, `form`, `ImageUploadZone`, `Input`, `Modal`, `PasswordInput`, `PasswordStrength`, `SaveStatusIndicator`, `Select`, `SocialLoginButtons`, `Spinner`, `switch`, `tabs`. Listed all files, grepped for unsafe-render patterns (zero hits), spot-checked `Modal.tsx` end-to-end and `ImageUploadZone.tsx` first 30 LOC (background-removal pipeline pulls from `lib/backgroundRemoval`, which is out of this scope).

**Skipped (out of Tier-3 risk surface):**
- Internal voxel-world files: `engine/rules/`, `command/`, `scenes/`, `plugins/map2dPlugins.ts`, `shaders/StylizedMaterial.tsx`, `store/voxelStore.ts` (a 710-line Zustand store), all `components/editor/*`, `components/objects/*`, `components/interaction/*`, `components/map-2d/*`, `components/pos/*`, `components/mini-maps/*`, `utils/procedural/*`, `utils/worldSerializer.ts`, `utils/modelMemoryManager.ts`, `utils/snapEngine.ts`.
- Hook bodies of all but the three spot-checked above.
- Body code of 17 of 19 UI primitives.

---

## 7. Findings

### F-1 · Medium · Arch — three.js IS in the prod bundle (via analytics, not voxel-world)

**Location:** `frontend/src/features/analytics/components/AnalyticsFloorPlan.tsx:2-10`; `frontend/src/pages/admin/AnalyticsPage.tsx:14,601`; `frontend/src/features/voxel-world/components/HeatmapOverlay.tsx:2`.

`AnalyticsFloorPlan.tsx:2-10` statically imports `Canvas` from `@react-three/fiber`, `OrbitControls` and `PerspectiveCamera` from `@react-three/drei`, and `HeatmapOverlay`, `VoxelFloor`, `VoxelWalls`, `VoxelTableObject`, `useVoxelStore`, `DEFAULT_WORLD_DIMENSIONS` directly from `features/voxel-world/...`. `HeatmapOverlay.tsx:2` then has `import * as THREE from 'three'`. `AnalyticsPage.tsx:601` renders `<AnalyticsFloorPlan .../>` unconditionally inside the analytics heatmap tab. Production builds therefore ship three.js + react-three-fiber + drei in the `/admin/analytics` chunk.

The §5.7 statement "Production bundle does not include three.js / shader code" is **incorrect**. The §5.7 evidence — that `FloorPlan3DPage` is dev-only — is true (verified at `App.tsx:95-97`, `App.tsx:209-211`) but does not cover the analytics path.

**Mitigating factor:** `AnalyticsPage` is lazy (`App.tsx:63`), so three.js does not land in the entry bundle. Severity is Medium not High because (a) the chunk is code-split, (b) the feature is admin-only and infrequently visited from a cold cache. The cost lands on users who navigate to `/admin/analytics`.

**Fix:** Either (a) wrap `AnalyticsFloorPlan` itself in `React.lazy` inside `AnalyticsPage` so the heatmap tab loads three.js on demand, not on first analytics-page visit; or (b) update §5.7 in `docs/CODE_REVIEW.md` to acknowledge the analytics coupling. Option (a) is preferred.

### F-2 · Low · Perf — DashboardPage and POSPage are eagerly imported (§5.4 confirmed)

**Location:** `frontend/src/App.tsx:54-55`.

```
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/pos/POSPage';
```

Every other large protected route is lazy: `AnalyticsPage` (`App.tsx:63`), `MenuManagementPage` (`:58`), `ReportsPage` (`:62`), all 12 settings pages (`:73-84`), all superadmin pages (`:10-19`), all marketing pages (`:23-33`), all QR-menu pages (`:41-48`). `DashboardPage` and `POSPage` are the only two large protected routes in the entry chunk.

The surrounding `<Suspense fallback={null}>` at `App.tsx:142` and the existing `useState`/`useMemo` flow tolerate `lazy()` without other changes. Profile bundle sizes (`vite build --mode production`) and switch to `lazy()` if either exceeds ~100 kB after tree-shaking — POS in particular tends to be heavy.

### F-3 · Info · Arch — hook barrel is incomplete

**Location:** `frontend/src/hooks/index.ts:1-18`.

The barrel re-exports 8 hooks (`useLocale`, `useNumberFormat`, `useDateTimeFormat`, `useRelativeTimeFormat`, `useFormatDate`, `useFormatNumber`, `useFormatRelativeTime`, `useFormatCurrency`, `useFormatCurrencyExtended`, `useCurrency`, `useAutoUpdate`, `useResponsive`, `useGeolocation`). The four hooks **not** re-exported are `useAutoSave`, `useOnlineStatus`, `usePageTracking`, plus `useFormatRelativeTime` is present in both columns — net: consumers of those four must import by path. The barrel's own header comment claims "Import hooks from here for cleaner imports", which is misleading.

**Fix:** Add the four missing exports, or delete the barrel and standardise on path-imports. Low-priority cleanup.

### F-4 · Info · Doc — §5.8 hook count is wrong (13 → 12)

**Location:** `docs/CODE_REVIEW.md:366`.

The seed says "13 hooks". `ls frontend/src/hooks/*.ts | grep -v index.ts | wc -l` returns **12**. The 19-UI-primitive count is correct. Update §5.8.

### No security findings

- No XSS surface in scope (grep verified).
- No `localStorage`/`sessionStorage` token writes in scope (grep verified — only `useFormatCurrency` and `useLocale` touch `localStorage` and only for `i18n_language`, matching §5.9).
- No fetch/axios calls embedded in UI primitives or hooks of this scope (all I/O is delegated to feature-level `*Api.ts` files via React Query).

---

## 8. What's solid (positive findings)

### 8.1 Dev-only lazy-load + dead-code-elimination pattern

**`App.tsx:95-97` + `App.tsx:209-211`:**

```ts
const FloorPlan3DPage = import.meta.env.DEV
  ? lazy(() => import('./pages/dev/FloorPlan3DPage'))
  : null;
// ...
{import.meta.env.DEV && FloorPlan3DPage && (
  <Route path="/dev/floor-plan" element={<Suspense fallback={null}><FloorPlan3DPage /></Suspense>} />
)}
```

Vite statically inlines `import.meta.env.DEV` to `false` in production builds, so the ternary collapses to `null` at build time and Rollup tree-shakes the entire `lazy(() => import('./pages/dev/...'))` factory plus its transitive chunk. The route guard at `:209` further drops the `<Route>` from the rendered tree.

The result: the `pages/dev/FloorPlan3DPage` chunk is **truly absent from the prod build** — its 139-file voxel-world dependency does not enter through this path. Caveat: it DOES enter through a different path (see F-1). Pattern is reusable for any feature that should be DEV-only by build target rather than feature-flag.

### 8.2 Lazy named-export adapter

**`pages/dev/FloorPlan3DPage.tsx:7-11`:**

```ts
const VoxelWorldView = lazy(() =>
  import('../../features/voxel-world').then((mod) => ({
    default: mod.VoxelWorldView,
  }))
);
```

`features/voxel-world/index.ts` is a 259-line named-export barrel with no `default` export — naive `lazy(() => import(...))` would fail because `React.lazy` requires a default-export shape. The `.then(mod => ({ default: mod.VoxelWorldView }))` shim adapts a named export into the `{ default }` shape `lazy` needs. Reusable for any feature barrel.

### 8.3 SubscriptionContext: effectiveFeatures precedence + sentinel-value handling

**`contexts/SubscriptionContext.tsx:56-86`:**

`hasFeature(feature)` prefers server-resolved `effectiveFeatures.features[feature]` (which already includes per-tenant overrides) when present, and falls back to `plan.features[feature]` while the effective-features query is still loading. Both lookups default to `false` on absence, which is the safe-by-default failure mode for a gating helper.

`checkLimit(resource, currentCount)` correctly distinguishes three cases:
- limit is `undefined` / `null` (subscription not loaded, or feature unknown) — `{ allowed: false, current, limit: 0, remaining: 0 }` — deny.
- limit is `-1` (sentinel for unlimited) — `{ allowed: true, limit: -1, remaining: Infinity }`.
- limit is a finite number — `{ allowed: currentCount < limit, remaining: max(0, limit - currentCount) }`.

The shape lets UI gating components render disabled buttons + remaining-quota hints from a single hook call.

### 8.4 Companion narrow hooks

**`contexts/SubscriptionContext.tsx:122-132`:**

`useFeatureEnabled(feature)` and `useLimitCheck(resource, currentCount)` are thin wrappers that destructure only the needed slice of the context. Components that only need one feature flag don't pull the full `subscription` / `plan` / `isLoading` payload, which keeps the re-render fanout tight. Reusable pattern for any context with multiple narrow query helpers.

### 8.5 Tauri-aware web-fallback pattern

**`hooks/useAutoUpdate.ts:33-39, 110-116`:**

Tauri plugins are loaded via `await import('@tauri-apps/plugin-updater')` / `await import('@tauri-apps/plugin-process')` inside `try/catch`, so a web-only Vite build (no Tauri runtime) logs a warning and continues rather than throwing. Pattern other Tauri-conditional features should adopt (matches the desktop-app suite from Phase 1.3 plan).

### 8.6 Modal: escape + scroll lock with cleanup

**`components/ui/Modal.tsx:20-36`:**

Adds a `keydown` listener for Escape on open, removes it on close/unmount, sets `body.style.overflow = 'hidden'` on open and restores `'unset'` on cleanup. No leak, no double-listener. Trivial but consistently correct.

### 8.7 No unsafe-render surface

`grep -rn 'dangerouslySetInnerHTML\|innerHTML\|eval(\|new Function' frontend/src/components/ui/ frontend/src/hooks/ frontend/src/contexts/` returns no matches. The §5.3 finding that the whole `frontend/src` tree avoids these patterns continues to hold for this scope.
