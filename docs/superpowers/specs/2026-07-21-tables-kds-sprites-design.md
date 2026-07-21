# Tables UX + KDS compact header + system-wide pixel-art floor sprites

Date: 2026-07-21 · Branch: `feat/tables-kds-sprites` · Status: approved for implementation

## Goals (from product owner)

1. **Masalar** (Tables) section: make it more usable — improve the *editing steps* and the *live* (plan) mode.
2. **Mutfak ekranı** (KDS): remove the top stat cards (Aktif Siparişler / Ort. Bekleme / Acil) and embed those signals into the titles; improve overall KDS UX (more vertical space for orders).
3. **Pixel-art sprites**: generate a single, system-wide, style-consistent 2D pixel-art object set via the fal.ai API (owner supplies `FAL_KEY`) and render it on the floor plan. Not per-tenant — one asset set for the whole product, committed to the repo. Art direction chosen so later 2D→3D conversion is easy (consistent ¾ top-down angle, fixed palette).

## Part 1 — KDS compact header

- `KitchenStatsHeader.tsx`: delete the 3-card stats grid. The header becomes a single compact row:
  - Left: existing h1 (`kioskHeadingText` classes unchanged — pinned by `kioskTheme.test.ts`) plus small inline meta chips: total active orders, overall avg wait (ticks 1 s), urgent count (red, pulse, only when > 0). Chips carry `aria-label`/`title` from the existing `kitchen.stats.*` keys. The `realtimeTracking` subtitle line is dropped (space).
  - Right: unchanged — connection pill, refresh, kiosk toggle. Disconnect banner unchanged.
  - The 1 s ticker lives in a small chip subcomponent so only chips re-render.
- `OrderQueue.tsx`: column header gains a per-column live wait chip (avg wait of that column's orders, 1 s tick, isolated subcomponent). Existing count badge and PENDING urgent badge stay.
- Mobile tabs: unchanged (already have counts + urgent dot).
- **Contracts that must survive**: `data-tour="kitchen-stats"` wrapper in the page; `KitchenStatsHeader` default export + props `{orders, isConnected, onRefresh, isLoading, kiosk?, onToggleKiosk?}`; `kitchen.stats.urgent` key (OrderQueue badge); kiosk light-mode visual parity.
- i18n: backfill the 10 keys that today exist only as inline TR fallbacks (`socketDownBanner`, `enterKiosk`, `exitKiosk`, `cancelConfirm`, `confirmYes`, `confirmNo`, `cancellingToast`, `undo`, `cancelStale`, `loadError`) into all 5 locales (ar/en/ru/tr/uz), translated properly.

## Part 2 — Tables (Masalar)

### Plan (live) mode — the default view
- Occupancy stats strip (total / available / occupied / reserved / %) shown above the live map (today list-only).
- Table action sheet gains: capacity + zone info line, and an **Edit** action opening the existing edit modal (status actions stay). Delete stays list-only.
- View mode (`plan|edit|list`) persisted in the URL as `?view=` — back/refresh/deep-link safe.

### Edit mode (embedded floor-plan editor)
- **Keyboard**: Delete/Backspace = delete selection (tables → unplace), Ctrl+Z / Ctrl+Shift+Z (+Ctrl+Y) = undo/redo, arrows = nudge by grid step (Shift = fine 1-unit), Esc = clear selection. Disabled while typing in inputs/modals.
- **Click-to-place**: palette buttons arm a pending element type; the next canvas click places it there (wire the existing unused `onCanvasClick` hook). Esc/second click on the button disarms. Table-add keeps its modal but places at the click point when armed, else zone center. Repeated center drops get a +24 px cascade offset so items never stack invisibly.
- **Inspector below `lg`**: render as a collapsible bottom sheet when something is selected (delete/shape/label finally reachable on tablets).
- **Inspector numeric fields**: X/Y/W/H/rotation inputs + a Duplicate button for elements.
- **Move table to zone**: single dropdown in the Inspector's table section (replaces the 8-step unplace/re-place dance).
- **Zone delete**: styled confirm modal (replaces the app's last `window.confirm`).
- **Dirty guard**: unsaved-changes chip near Save + `beforeunload` guard + confirm when leaving edit view dirty.

### Page-level fixes
- Page "Masa Ekle" modal gains a zone selector (default: first zone) so new tables land **placed** on the default plan view; capacity clamped 1–200 to match the editor; number `maxLength=32`. No-zones case keeps unplaced behavior with a hint.
- Remove the dead DEV sidebar link `/dev/floor-plan`.
- i18n: add the 5 missing `admin.*` keys (`totalTables`, `occupancy`, `deleteTable`, `deleteOccupiedWarning`, `deleteReservationWarning`) + a correct tables limit-banner string (today reuses user-count copy) to all 5 locales.

## Part 3 — Pixel-art floor sprites (system-wide)

- **Assets**: `frontend/public/floor-sprites/v1/<key>.png` (RGBA, 256 px box, pixel art, transparent background). Filenames are immutable (nginx 1 y immutable cache on .png) — content changes bump the version dir.
- **Manifest**: `src/features/floor-plan/sprites.ts` — typed keys, `null` = no sprite yet → renderer falls back to today's vector look. `sprites.test.ts` guards existence of non-null entries (clone of `marketing/data/images.test.ts` pattern).
- **Rendering**:
  - `FloorElementNode.tsx`: PLANT, BAR, KITCHEN, DOOR, DECOR render a Konva `<Image>` (module-cached loader hook, `imageSmoothingEnabled: false`) sized to the element box; colored Rect stays as loading/no-sprite fallback; selection becomes a separate outline rect. WALL, RECT, TEXT stay vector (structural/stretchable).
  - `TableShapeNode.tsx`: sprite per `tableShape` (round/square/rect) with live status shown as a colored ring + soft tint overlay; seat dots, number, order badge unchanged. Vector fallback preserved.
- **Aspect rule**: sprites are authored at each type's default footprint aspect (PLANT 1:1, BAR 11:3, KITCHEN 10:7, DOOR 1:1 — DOOR default footprint becomes 60×60 top-down swing-arc) so default placements are undistorted; user resize stretches (accepted).
- **Generation script**: `scripts/generate-floor-sprites.mjs` (Node 18+, no new runtime deps; `FAL_KEY` env). Pipeline per object: Recraft V3 `digital_illustration/pixel_art` (queue API, fixed shared color palette + one prompt skeleton, N candidates) → BiRefNet v2 background removal → `image2pixel` (`fixed_palette`, `snap_grid`, `transparent_background`) → save PNG candidates under `scratch/` for curation; chosen files copied to `public/floor-sprites/v1/`. Re-runnable for future variants. ~$0.04/image.
- **nginx**: add `webp` to both cache-control regexes (existing gap) — sprites themselves are .png and already covered.

## Out of scope
Bulk table actions, QR cross-link, merge/split UI on the admin page, polyline wall tool, zone reorder UI, per-tenant sprite customization, 3D conversion.

## Test/verify plan
Lane-level vitest (updated + new specs: store nudge/shortcut logic, sprite manifest guard, page URL-mode), then full `vitest run`, `tsc`, `npm run lint:ci`, production build. Adversarial multi-agent review of the combined diff before merge; sprite set visually QA'd for consistency before commit.
