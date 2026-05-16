# `frontend/features/analytics/` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `frontend/src/features/analytics/...` + consumer `frontend/src/pages/admin/AnalyticsPage.tsx`
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §5.6 — features (one-line green verdict); cross-link [`./analytics.md`](./analytics.md) — backend gateway + services (F-1 type-check, F-2 burst, F-3 window cap)

---

## 1. Health & summary

🟡 yellow

This feature owns the analytics admin surface: three heatmap modes (occupancy / traffic / dwell-time) rendered onto a R3F floor-plan, an insights / table-utilization / customer-behavior / camera-management dashboard, and a 4-point homography calibration flow that streams the camera feed straight to a `<video>` element. The feature is purely **read-side over HTTP** — there is no socket subscription on the frontend side (verified by `grep -rn "socket\|io(\|Socket"` over `features/analytics/`, only stray substring hits in `useMutation` / `useQuery`), so the gateway-isolation invariant from `analytics.md` §3 I-1/I-2 is enforced exclusively server-side via the controller guard chain and the gateway handshake. Tenant scoping at the frontend layer therefore reduces to "every call rides `lib/api.ts` and the access-token-bearing `Authorization` header" — verified at `frontend/src/lib/api.ts:18-29`. The risk concentrates in three places: (a) every heatmap, traffic, congestion, insight, and camera query auto-fires with `enabled: true` (`analyticsApi.ts:55, 67, 79, 93, 105, 119, 131, 145, 157, 180, 192, 204, 268, 280`) and the React-Query keys include unstable JS objects, causing thrash on every parent-state poke; (b) the heatmap query window flows raw from a free-text `<input type="date">` (`AnalyticsPage.tsx:236-247`) into the URL with no client-side bound (cross-link: backend `analytics.md` F-3 admits there is also no server cap); (c) `CameraCalibration.tsx:297-308` bypasses the configured Axios instance and calls `fetch('/api/...')` directly, dropping the auth header, the refresh-on-401 retry, and the configured baseURL. Health is set to yellow rather than green (the upstream review's spot-check verdict at §5.6) because items (b) and (c) are net-new findings against the same code, and item (a) interacts adversarially with the backend F-3 hazard.

---

## 2. Scope of this review

**Read end-to-end:**
- `frontend/src/features/analytics/analyticsApi.ts` (372 LOC) — 22 React-Query hooks: heatmaps × 3, traffic-flow + congestion, table utilization/trends/underutilized, customer-behavior, insights × 6, cameras × 5, mock-data × 2.
- `frontend/src/features/analytics/types.ts` (269 LOC) — 8 enums + 16 DTO interfaces; mirrors backend `analytics/dto/*` and `prisma/schema.prisma:1866-1926`.
- `frontend/src/features/analytics/components/AnalyticsFloorPlan.tsx` (217 LOC) — R3F `<Canvas>` + `OrbitControls`, lighting, walls, voxel-tables overlay, `HeatmapOverlay` consuming all three heatmap hooks in parallel.
- `frontend/src/features/analytics/components/CameraCalibration.tsx` (583 LOC) — 4-step homography calibration: video frame capture → click points → floor-plane click points → preview → POST to backend.
- `frontend/src/features/analytics/components/HeatmapControls.tsx` (143 LOC) — controlled inputs for type / color-scheme / opacity, plus a `<HeatmapLegend>`.
- `frontend/src/features/analytics/components/HeatmapLegend.tsx` (64 LOC) — pure presentational gradient strip, 5 color schemes.
- `frontend/src/features/analytics/components/index.ts` (4 LOC) and `frontend/src/features/analytics/index.ts` (3 LOC) — barrel re-exports.

**Skimmed only:**
- `frontend/src/pages/admin/AnalyticsPage.tsx` (833 LOC) — the only consumer; verified at `:15-16` it pulls from `../../features/analytics`, mounts at `/admin/analytics` (`App.tsx:186`), and is the host for the dashboards / heatmap embed. Skim because not in the feature folder, but the date-range form at `:234-250` is the input boundary for §3 I-5 and §6.
- `frontend/src/components/ProtectedRoute.tsx` (29 LOC) — verified the role gate for `/admin/analytics`.
- `frontend/src/components/layout/Sidebar.tsx:132-137` — sidebar role gate for the analytics link.
- `frontend/src/lib/api.ts` (87 LOC) and `frontend/src/lib/socket.ts` (146 LOC) — confirmed analytics does not initialize a third gateway namespace.

**Skipped:**
- `frontend/src/features/voxel-world/components/HeatmapOverlay.tsx`, `VoxelFloor`, `VoxelWalls`, `VoxelTableObject`, `store/voxelStore.ts` — imported by `AnalyticsFloorPlan.tsx:4-10` but live under the `voxel-world` feature; out of scope (voxel-world reviewed separately per upstream §5.7).
- i18n strings / Tailwind utility classes / lucide icons — no risk surface.

---

## 3. Business-logic invariants

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Socket subscription is tenant-scoped only — **trivially held**: analytics frontend opens no socket at all. The only socket-bearing tabs in this app (KDS, notifications) are wired in `lib/socket.ts:31, 92`; analytics uses HTTP polling via React Query exclusively. | `frontend/src/features/analytics/**` — zero `io()` / `socket.io-client` imports (verified by grep). Cross-link: backend `analytics.md` I-1 (server gateway is the actual subscription enforcement point). | ❌ none | If a future commit adds `io('/analytics-edge')` here, the gateway-side handshake gap (backend `analytics.md` F-1) becomes reachable from this realm's bearer token. Add a comment in `lib/socket.ts` and a lint rule (`no-restricted-imports` on `socket.io-client` outside `lib/socket.ts`) to keep the invariant explicit. |
| I-2 | Heatmap query window respects server caps. **NOT ENFORCED frontend-side, and not enforced server-side either** (backend `analytics.md` F-3): `analytics.controller.ts:75-76` accepts any caller-supplied ISO date. Frontend default at `AnalyticsPage.tsx:50, 53-56` is `subDays(today, 7)` → today, but the form at `:234-250` is a raw `<input type="date" {...register('startDate')}>` with no `min` / `max` / `validate`, and the query string is interpolated directly into `useTableUtilization` / `useCongestionAnalysis` / `useCustomerBehavior` / `AnalyticsFloorPlan`'s heatmap calls. | `AnalyticsPage.tsx:58-63` (form defaults), `:77-79` (submit handler — `setDateRange(data)` with no clamp), `AnalyticsFloorPlan.tsx:120-124` (params pass-through, hard-codes `HOURLY` granularity which is the most expensive). | ❌ none — single frontend test (`ErrorBoundary.spec.tsx`) per upstream §3.8. | Multi-year `HOURLY` window: backend OOMs (backend `analytics.md` F-3 reproduction sketch); frontend then tries to render an `n×m` `data: number[][]` over R3F geometry. See F-3 below. |
| I-3 | Role gate on dashboards — `/admin/analytics` reachable only by `ADMIN` / `MANAGER`. | `frontend/src/App.tsx:180-186` wraps `<AnalyticsPage />` in `<ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}>`. `ProtectedRoute.tsx:18-24` redirects to `/dashboard` if `user.role` not in the list. Sidebar entry at `Sidebar.tsx:132-137` filters with the same role array (`:146-149`). | ❌ none | A WAITER / KITCHEN / COURIER role typing `/admin/analytics` directly would be redirected — verified the only failure path is "user is authenticated but wrong role" → `Navigate to="/dashboard"`. **Held.** Backend `RolesGuard` + `PlanFeatureGuard` (backend `analytics.md` scope row §2 `:48-49, :62-63`) is the actual server-side enforcement; the frontend gate is UX only. |
| I-4 | Camera-calibration writes use the auth-enriched HTTP client so the cookie / bearer / refresh-on-401 contract holds. | **NOT ENFORCED** — `CameraCalibration.tsx:297-308` uses raw `fetch('/api/analytics/cameras/${cameraId}/calibration', ...)`. The configured Axios instance at `lib/api.ts:9-15` is bypassed. `withCredentials` defaults to `same-origin` on `fetch`, the auth bearer isn't set, the 401 → refresh interceptor doesn't fire. | ❌ none | A logged-in admin on the calibration screen whose access token has expired mid-session will hit a silent 401, the mutation surfaces `"Failed to save calibration"` (`:303-305`) with no recovery — the configured retry path is bypassed. See F-1 below. |
| I-5 | React-Query keys are stable across re-renders so identical params don't refetch on every parent state change. | **PARTIALLY ENFORCED** — `analyticsApi.ts:24-44` defines the key registry; the keys themselves are pure `as const` tuples (stable). But the `params` objects are inlined at call-sites: `AnalyticsFloorPlan.tsx:120-124` constructs a fresh `queryParams` object on every render. The key `[..., type, params]` (`analyticsApi.ts:27`) compares the object by reference internally — TanStack actually does deep-equal on keys, so referential instability is benign here, but downstream `enabled: true` (`:55, 67, 79, 93, 105, 119, 131`) means three heatmap queries (occupancy + traffic + dwell-time) fire even though only one is rendered at a time (`AnalyticsFloorPlan.tsx:127-129, 137-148`). | ❌ none | Three unbounded `findMany` queries hit the backend per heatmap-tab render instead of one. See F-4. |
| I-6 | Mock-data dev tools are unreachable in production. | `AnalyticsPage.tsx:182-204` wraps the "Generate Mock Data" / "Clear Data" buttons in `{import.meta.env.DEV && (...)}`. Hooks themselves (`useGenerateMockData`, `useClearMockData` at `analyticsApi.ts:345-372`) are always exported, but with no UI surface they're unreachable from a prod build. Backend still has to enforce its own env check (out of scope here). | ❌ none | If a future page imports these hooks unconditionally, they ship to prod. Acceptable risk given the gate is at the call-site. |
| I-7 | Camera stream URL is safe to bind into `<video src={streamUrl}>`. | `CameraCalibration.tsx:342-349` binds `streamUrl` directly into `<video src={...}>`. `streamUrl` is a prop typed `string` (`:21`); the only call path is via `useCamera`/`Camera.streamUrl` from `types.ts:241`. Browsers only resolve `http(s):` / `blob:` / `data:` for `<video src>`, and a `javascript:` URL is not executable through this attribute — but a hostile `streamUrl` could still point at an attacker-controlled origin and be auto-played. | ❌ none | Low: requires write access to the camera row (tenant-scoped) to inject. Defense-in-depth: validate scheme is `http`/`https`/`rtsp` (and only allow `rtsp` if the upstream proxy supports it). |

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- Single-flight refresh in `lib/api.ts:38-58` (verified at the source): all 401s from analytics queries that fire in parallel on `/admin/analytics` mount join one in-flight `/auth/refresh` promise. This is the right shape — without it, the 22 hooks here would have produced 22 concurrent refreshes and tripped the backend's refresh-reuse revocation (per the upstream §3.2 note). **Solid; keep.**
- Socket-token replay in `lib/socket.ts:40-47` — not exercised by analytics (I-1) but worth noting since `AnalyticsPage.tsx` shares a Layout with KDS/POS which do hold sockets.

**Race windows still open:**

- *Sketch — socket reconnect storm on analytics gateway (cross-link backend `analytics.md` F-2):* this frontend doesn't open the `/analytics-edge` socket, so the storm cannot originate here. **However**, if a future feature adds a customer-facing live-occupancy widget that calls `io('/analytics-edge')` from this folder, the gateway's heartbeat handler at `analytics.gateway.ts:308-315` is unthrottled (per backend `analytics.md` F-2). The structural mitigation lives in `lib/socket.ts:14, 31-34, 60-66`: shared refcounted singleton, websocket-preferred transport, force-disconnect on logout. Any new analytics socket **must** route through `initializeSocket`-style refcounting rather than `useEffect(() => { const s = io(...); return () => s.disconnect() }, [])` per component — otherwise React-strict-mode double-mount creates a real reconnect storm on every tab switch.
  *Where:* not currently in tree; gap is "no enforcement to prevent it."
  *Severity:* Low Sec / Medium Perf (future risk)
  *Fix:* add `eslint-plugin-import` rule `no-restricted-imports: { paths: [{ name: 'socket.io-client', message: 'Use lib/socket.ts singleton' }] }`. Or move all socket instantiation into a generic factory.

- *Sketch — heatmap query thrash:* the admin lands on `/admin/analytics`. `AnalyticsPage.tsx` mounts and fires `useTableUtilization` (`:66`), `useActionableInsights` (`:67`), `useInsightSummary` (`:68`), `useCustomerBehavior` (`:69`), `useCongestionAnalysis` (`:70`) — 5 queries on first paint, all `enabled: true`. Tabs to "Traffic" → `AnalyticsFloorPlan` mounts at `:601-605` → fires `useOccupancyHeatmap` + `useTrafficHeatmap` + `useDwellTimeHeatmap` (`AnalyticsFloorPlan.tsx:127-129`) regardless of which one is selected (only the selected one is rendered in the `useMemo` at `:137-148`). Tabs back to Overview, then back to Traffic — `staleTime: 5 * 60 * 1000` (`analyticsApi.ts:56, 68, 80`) prevents refetch *within* 5min, but if the user opens the date-range form and submits, `dateRange` changes (`AnalyticsPage.tsx:53, 78`) → new query key → **all three heatmaps refetch in parallel**, each running the unbounded `findMany` documented in backend `analytics.md` F-3. Two admins each clicking "Apply" with different ranges = 6 simultaneous unbounded heatmap reads on the Prisma pool.
  *Where:* `AnalyticsFloorPlan.tsx:127-129` (unconditional fan-out) interacting with `analyticsApi.ts:48-82` (no `enabled` gate).
  *Severity:* High Perf (backend pool starvation), Medium Sec (admin-side DoS amplifier)
  *Fix:* gate the unselected heatmap hooks on `heatmapType`: `useOccupancyHeatmap(queryParams, { enabled: heatmapType === 'occupancy' })`. Bonus: bound `startDate` / `endDate` client-side to the same window the server should be enforcing (see F-3).

**Idempotency keys:**
- All HTTP mutations in this feature (`useUpdateInsightStatus`, `useGenerateInsights`, `useCreateCamera`, `useUpdateCamera`, `useDeleteCamera`, `useGenerateMockData`, `useClearMockData`) are issued without client-supplied idempotency keys. For analytics this is acceptable — none of these write to money paths; the worst case is a double insight-status update (last-write-wins, no audit drift). Mock-data generate/clear are dev-only.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Medium | Sec | `frontend/src/features/analytics/components/CameraCalibration.tsx:297-308` | The save-calibration mutation uses raw `fetch('/api/analytics/cameras/${cameraId}/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })` instead of the configured Axios client at `lib/api.ts:9-15`. Consequences: (a) no `Authorization: Bearer ${accessToken}` header (the interceptor at `lib/api.ts:18-29` only fires on the Axios instance) — the request will fail 401 against the backend `JwtAuthGuard` unless the cookie auth path catches it; (b) the single-flight refresh-on-401 retry at `lib/api.ts:63-84` is bypassed, so an expired access token on this screen surfaces as a generic "Failed to save calibration" (`:303-305, 314-316`) and the user must log out and back in; (c) the hard-coded `/api/...` path ignores `VITE_API_URL` (`lib/env.ts`), breaking any env that doesn't reverse-proxy under `/api`. | Replace with `api.post(\`/analytics/cameras/${cameraId}/calibration\`, data)` from `lib/api.ts`. While editing, lift this into `analyticsApi.ts` as a `useUpdateCameraCalibration` hook for consistency with the other 21 mutations. |
| F-2 | Medium | Perf | `frontend/src/features/analytics/components/AnalyticsFloorPlan.tsx:127-129` | All three heatmap queries (`useOccupancyHeatmap`, `useTrafficHeatmap`, `useDwellTimeHeatmap`) fire unconditionally on mount, but only one is rendered at a time (`:137-148`). Each query hits an unbounded `findMany` on the backend (cross-link `analytics.md` F-3). The user sees the loading state from the *selected* heatmap (`:131-134`) but the other two churn the backend silently. | Pass `enabled` to each hook: `useOccupancyHeatmap(queryParams, { enabled: heatmapType === 'occupancy' })`. Requires extending the hook signatures at `analyticsApi.ts:48-82` to accept React-Query options, which is also a prerequisite for fixing F-4. |
| F-3 | Medium | Sec | `frontend/src/pages/admin/AnalyticsPage.tsx:234-250`, `:53-56`, `analyticsApi.ts:48-82` | The date-range form is a pair of raw `<input type="date" {...register('startDate' / 'endDate')}>` with no `min`, no `max`, no `validate` rules in `useForm()` (`:58-63`). The submitted values flow unchecked into every analytics hook via `dateRange` (`:78`) and through `AnalyticsFloorPlan`'s `startDate` / `endDate` props. Cross-link: backend `analytics.md` F-3 admits the controller (`analytics.controller.ts:75-76`) accepts the values raw — meaning **neither side bounds the window**. An admin who types `2020-01-01` → today triggers a 6-year `HOURLY` heatmap query, which backend `analytics.md` §6 sketches as ~hundreds of millions of `OccupancyRecord` rows into Node memory. | Add `min={subDays(today, 365).toISOString().slice(0,10)}` to both inputs; add a `useForm` `validate` rule that rejects ranges wider than 90 days for HOURLY granularity (the granularity at `AnalyticsFloorPlan.tsx:123` is hard-coded `HOURLY`). Surface a toast "Range too wide — try DAILY granularity" rather than letting the request fly. This must be paired with the server-side cap from backend `analytics.md` F-3 — the frontend bound alone is bypassable by anyone scripting against the API. |
| F-4 | Low | Perf | `frontend/src/features/analytics/analyticsApi.ts:55, 67, 79, 93, 105, 119, 131, 145, 157, 180, 192, 204, 268, 280` | 14 hooks default to `enabled: true` and rely on the call-site to gate. Only `useInsight(id)` and `useCamera(id)` gate via `enabled: !!id` (`:216, :292`). Combined with `AnalyticsPage.tsx`'s top-level mount firing 5 of these and `AnalyticsFloorPlan` firing 3 more (per F-2), the analytics route triggers 8 backend queries on first paint before the user has chosen a tab. Some have `staleTime: 5 * 60 * 1000` (`:56, 68, 80, 94, 120`) which mitigates *refetch* but not *first-mount*. | Restructure: remove `enabled: true` defaults (it's the React-Query default already), and let each consumer pass `{ enabled }` so the Traffic-tab heatmaps don't fire until the user opens that tab. Mirrors the lazy-load pattern used for `FloorPlan3DPage` in upstream §5.4. |
| F-5 | Low | Sec | `frontend/src/features/analytics/components/CameraCalibration.tsx:342-349` | `<video src={streamUrl} autoPlay muted playsInline>` binds an attacker-controllable URL (camera row writers are tenant-scoped admins, so this is admin-on-admin only) directly to the browser's media loader. `javascript:` URLs are inert in `<video src>`, but a `data:` URL or a third-party origin can still autoplay and exfiltrate the admin's network via Referer or timing. | Validate `streamUrl` scheme is in an allowlist (`http`, `https`, `rtsp` only) before render. Add a `crossorigin="anonymous"` attribute so cross-origin streams cannot poison the canvas at `:64-77` (the canvas is used to crop a calibration frame; a cross-origin video taints the canvas and `toDataURL()` at `:76` will throw, currently silently — see F-7). |
| F-6 | Low | Cor | `frontend/src/features/analytics/components/CameraCalibration.tsx:79-117` | Click handlers cap selected points at `REQUIRED_POINTS=4` (`:82, :102`), but the canvas-coordinate math at `:88-92, :108-112` assumes the canvas was already sized at `CANVAS_WIDTH × CANVAS_HEIGHT`. If a user clicks before `captureFrame` runs (i.e., before `:72-73` sets `canvas.width`/`height`), the `getBoundingClientRect()` returns the un-sized layout box and the scale factor inverts. Result: a point clicked at (50, 50) on a 320×240 layout becomes (100, 100) in the persisted homography. | Disable the canvas `onClick` (`:354`) until `previewFrame !== null`. Same for the floor canvas — it has a fixed `width={400} height={400}` on the element (`:409-410`) but the click math at `:108-109` divides by `floorPlanWidth` / `floorPlanHeight` props that the caller must supply correctly. |
| F-7 | Low | Cor | `frontend/src/features/analytics/components/CameraCalibration.tsx:64-77` | `canvas.toDataURL('image/jpeg')` at `:76` throws `SecurityError` if the video element is cross-origin and not `crossorigin="anonymous"`. There is no try/catch, no error state — the calibration step just silently fails to capture a frame, and the user clicks "Capture" with no feedback. | Wrap in try/catch; on `SecurityError`, surface `setError('Camera stream is cross-origin — add CORS headers')`. Pair with the `crossorigin="anonymous"` attribute from F-5. |
| F-8 | Low | Arch | `frontend/src/features/analytics/analyticsApi.ts:48-82` | `useOccupancyHeatmap`, `useTrafficHeatmap`, `useDwellTimeHeatmap` are three near-identical copy-pastes (only the URL path differs). | Factor: `function makeHeatmapHook(metric: 'occupancy' \| 'traffic' \| 'dwell-time')`. Same applies to `useCameras` / `useCameraHealth` / `useCamera` (three trivial GETs). |
| F-9 | Info | Arch | `frontend/src/features/analytics/index.ts:1-3` | Barrel re-exports `* from './types'`, `* from './analyticsApi'`, `* from './components'`. `types.ts` exports `HeatmapMetric`, but the API hooks expose `metric: HeatmapMetric` only through `HeatmapResponse.metric` (`types.ts:78`). The enum has 4 values (`OCCUPANCY`, `DWELL_TIME`, `TRAFFIC`, `REVENUE`) but no `REVENUE` heatmap hook is implemented. | Either implement `useRevenueHeatmap` or drop `REVENUE` from the enum to keep type/API surface in sync. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **Tenant scoping deferred to a single auth boundary.** `analyticsApi.ts` makes 27 distinct HTTP calls; every one routes through `import api from '../../lib/api'` (`:2`). The request interceptor at `lib/api.ts:18-29` attaches the bearer from `useAuthStore.accessToken` (memory-only, per upstream §3.2), the backend's `JwtAuthGuard + TenantGuard + RolesGuard + PlanFeatureGuard` chain (backend `analytics.md` §2 `:48-49, :62-63`) does the actual tenant filter. There is **no tenant id leakage through query keys** — `analyticsKeys.heatmap(type, params)` (`analyticsApi.ts:27`) does not include a tenantId, which means cross-tenant cache pollution would be possible *if* the same React-Query client were ever shared across two tenants. In this app the React-Query client is one-per-tab (`App.tsx`), and logout calls `forceDisconnectSocket` and `useAuthStore.logout()` which would not invalidate the cache. **Candidates that should adopt this:** none — pattern is already minimal; just be aware that on a same-tab tenant switch (currently not possible) the React-Query cache would carry tenant-A's heatmaps into tenant-B's session. Add `queryClient.clear()` to logout if multi-tenant tab-sharing is ever introduced.

- **React-Query key registry.** `analyticsApi.ts:24-44` centralizes 13 key constructors as `as const` tuples. Compared to scattered `['analytics', 'heatmap', type, params]` literals, this catches typos at compile time and makes `invalidateQueries({ queryKey: analyticsKeys.insights() })` (`:240, 254`) refactor-safe. **Candidates that should adopt this:** every other React-Query feature folder — `frontend/src/features/marketing/api/*`, `features/stock-management/api/*` per upstream §5.6.

- **Dev-tool gate at the UI seam.** `AnalyticsPage.tsx:182-204` gates "Generate Mock Data" / "Clear Data" buttons on `import.meta.env.DEV`. The underlying hooks at `analyticsApi.ts:345-372` are unconditionally exported, but with no UI call-site in prod they're unreachable. Matches the `FloorPlan3DPage` DEV-conditional pattern from upstream §5.4.

- **Grid-dimension presentation parity with backend.** `HeatmapLegend.tsx:13-19` and `HeatmapOverlay`'s color schemes line up with the 100×100 clamp documented at backend `analytics.md` §8 "Grid-dimension clamp" — frontend can never request a heatmap render larger than the server can produce, so OOM on render is bounded by the same `MAX_GRID_DIMENSION = 100` (backend `heatmap.service.ts:22-29`).

- **Cross-link — backend `analytics.md` §8 is the gateway exemplar; frontend `lib/api.ts:38-58` is the HTTP exemplar.** The single-flight refresh pattern in `lib/api.ts` is what makes 22 analytics hooks safe to fire on first paint. The pattern is documented with an in-source comment (`:31-37`) explaining the race window it closes; copy to any new React-Query-heavy feature.

---

## 9. Spot-checks performed

**Verified:**
- I-1 (no socket subscription) confirmed by `grep -rn "io(\|socket.io-client\|Socket"` over `frontend/src/features/analytics/` — zero hits. The only matches in the components are substring noise (`useMutation`, `useQuery`).
- I-3 (role gate) confirmed at three sites: `App.tsx:180-186`, `ProtectedRoute.tsx:10-24`, `Sidebar.tsx:132-137, 146-149`. All three use `[UserRole.ADMIN, UserRole.MANAGER]`; no drift.
- F-1 confirmed at `CameraCalibration.tsx:297-308` — raw `fetch` call, no `Authorization` header, hard-coded `/api/...` path. Compared side-by-side with the Axios pattern at `analyticsApi.ts:300-302` (same payload shape would have been `api.post('/analytics/cameras/${cameraId}/calibration', data)`).
- F-2 confirmed at `AnalyticsFloorPlan.tsx:127-129` — three hook calls, no conditional `enabled`. Cross-checked against the render at `:137-148` which only consumes one.
- F-3 confirmed at `AnalyticsPage.tsx:236-247` — `<Input type="date" {...register('startDate')} />` with no validator. `register` is from `useForm<DateRangeForm>({ defaultValues: { startDate: lastWeek, endDate: today } })` at `:58-63`, no `rules` arg. Backend `analytics.controller.ts:75-76` admits the matching gap on the receive side (cross-link backend `analytics.md` F-3).

**Dropped (initial scope was wrong):**
- "Heatmap React-Query cache may leak across tenants on logout" — verified that React-Query cache *would* persist across an in-tab tenant switch, but `useAuthStore.logout()` redirects via `window.location.href` (`lib/api.ts:77`), which is a full page reload — the cache is wiped. Not a real defect under the current logout flow. Drop. (Note: if any future "switch tenant without logout" feature is added, F-x = "clear React-Query cache on tenant change" becomes a real finding.)
- "Insight status mutation lacks optimistic update" — looked at `useUpdateInsightStatus` (`analyticsApi.ts:220-243`); it invalidates on success but doesn't `setQueryData` for an optimistic UI. That's a UX preference, not a defect. Drop.

**Downgraded:**
- F-1 — held at Medium (not High) because the most likely failure mode (no bearer header) actually results in a clean 401 from the backend `JwtAuthGuard`, surfacing as the existing error toast. The risk is "calibration save silently fails when access token has expired" rather than "auth bypass."
- F-3 — held at Medium (not High) because the route is `@Roles(ADMIN, MANAGER) + @RequiresFeature(ADVANCED_REPORTS)` (backend `analytics.md` §2), so an admin-on-self DoS, not externally exploitable.

---

## 10. Recommended tests

```ts
// frontend/src/features/analytics/__tests__/subscription-isolation.spec.tsx
describe('Analytics subscription isolation (I-1, I-3)', () => {
  it('does not open any socket.io-client connection on /admin/analytics mount', async () => {
    // arrange: mock socket.io-client; render <AnalyticsPage /> inside MemoryRouter
    // act: wait for all React-Query queries to settle
    // assert: io() was called 0 times; no `/analytics-edge` or `/analytics` namespace touched
  });

  it('redirects a WAITER role away from /admin/analytics to /dashboard', async () => {
    // arrange: useAuthStore.setState({ user: { role: UserRole.WAITER }, isAuthenticated: true })
    // act: render <App /> at initial path /admin/analytics
    // assert: history.location.pathname === '/dashboard'; AnalyticsPage never rendered
  });

  it('the sidebar entry for /admin/analytics is filtered out for KITCHEN role', async () => {
    // arrange: useAuthStore.setState({ user: { role: UserRole.KITCHEN } })
    // act: render <Sidebar isOpen={true} onClose={noop} />
    // assert: queryByText('Analytics') === null
  });
});

// frontend/src/features/analytics/__tests__/query-window-cap.spec.tsx
describe('Heatmap query window cap (I-2, F-3)', () => {
  it('refuses to submit a date range wider than 90 days at HOURLY granularity', async () => {
    // arrange: render <AnalyticsPage />; programmatically set startDate=2020-01-01, endDate=today
    // act: click "Apply"
    // assert: a toast surfaces 'Range too wide'; api.get('/analytics/heatmap/occupancy') NOT called
  });

  it('passes a 7-day default window through to the heatmap hook unchanged', async () => {
    // arrange: spy on lib/api.ts get; render <AnalyticsPage />; navigate to Traffic tab
    // act: wait for queries to settle
    // assert: api.get called with params.startDate === subDays(today, 7); granularity === 'HOURLY'
  });

  it('only fires the selected heatmap hook on the Traffic tab (F-2)', async () => {
    // arrange: spy on lib/api.ts get; render <AnalyticsPage />; navigate to Traffic
    // act: heatmapType defaults to 'occupancy'
    // assert: api.get('/analytics/heatmap/occupancy') called 1x;
    //         api.get('/analytics/heatmap/traffic') called 0x;
    //         api.get('/analytics/heatmap/dwell-time') called 0x
  });

  it('camera calibration save routes through lib/api.ts (F-1)', async () => {
    // arrange: spy on lib/api.ts post; spy on global.fetch
    // act: render <CameraCalibration />, walk all 4 steps, click Save
    // assert: api.post called once; global.fetch NOT called
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`: in this frontend's case, render `<AnalyticsPage />` under one tenant's `useAuthStore`, unmount, swap the store to a second tenant, remount, and assert that the React-Query cache returns no rows from tenant-A's keys for tenant-B's queries (today this is enforced only by the full-page reload on logout — make it explicit if "switch tenant in-tab" is ever introduced).
