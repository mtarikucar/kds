# Restaurant 2D Floor-Plan Editor — Design Spec

**Date:** 2026-06-24
**Goal:** Turn the Tables ("masalar") page into a dynamic 2D map of the restaurant: an admin designs the floor (multiple **zones** — kat/bahçe/teras — each its own canvas, with tables + structural/decor elements), and the **same map runs live** in POS (real-time status, click-to-act) and a read-only Tables view. Rich table rendering (shape + auto seats + rotation + status/notification badges).

**Scope approved by user:** full live-integrated map · tables + structural/decor elements (+ optional per-zone background blueprint image) · rich table shapes. Backward-compat not required (no active users). Directive: `/goal` — build the most professional/comprehensive version and don't stop until shipped to prod.

**Engine:** `react-konva` (already installed). Purpose-built: `Stage`/`Layer`/`Transformer` (resize+rotate handles), drag, zoom/pan, hit-testing, snapping, perf.

---

## Data model (Prisma — branch-scoped)

### New `FloorZone` (a kat / bahçe / teras)
`id, name, sortOrder, kind(INDOOR|OUTDOOR), canvasWidth, canvasHeight, gridSize, backgroundImageUrl?, backgroundOpacity, tenantId, branchId, timestamps`.
Unique `(tenantId, branchId, name)`. `tables: Table[]`, `elements: FloorElement[]`. Branch onDelete Cascade (branch can't be deleted while tables exist anyway — Table.branch is Restrict).

### New `FloorElement` (non-table structure/decor)
`id, type(WALL|DOOR|BAR|KITCHEN|PLANT|DECOR|TEXT|RECT), x, y, width, height, rotation, points(Json — polyline walls), style(Json — fill/stroke/fontSize…), label?, zIndex, zoneId(FK Cascade), tenantId, branchId, timestamps`.

### `Table` additions (spatial)
`zoneId(FK SetNull, nullable) + zone`, `posX, posY (Float, default 0)`, `width(80) height(80)`, `rotation(0)`, `shape String default "ROUND" (ROUND|SQUARE|RECT)`.
- `zoneId = null` ⇒ table not yet placed → shown in the editor's "unplaced tray".
- **`section` String stays through P1–P2** (additive, harmless) and is **dropped in P3** when the admin page is rewritten — avoids throwaway edits to a page that gets replaced.
- Statuses unchanged: `AVAILABLE | OCCUPIED | RESERVED`. Seats render from existing `capacity`.

Strings (shape/type/kind) validated at the DTO layer via `@IsEnum`, matching the existing `Table.status` String convention (no Prisma enum churn).

---

## Backend (module `modules/tables`, new `FloorPlanService` + `FloorPlanController`)

Branch-scoped (`@CurrentScope`), ADMIN/MANAGER to edit, any authenticated role to read. New routes under `/floor-plan`:

| Method | Route | Notes |
|---|---|---|
| GET | `/floor-plan/zones` | zones (sorted) each with `elements` + `tables` (+ live order/request counts + `upcomingReservation`) + an `unplacedTables` list |
| POST | `/floor-plan/zones` | create zone |
| PATCH | `/floor-plan/zones/:id` | rename/resize/grid/background |
| DELETE | `/floor-plan/zones/:id` | SetNull its tables (→ unplaced), cascade-delete its elements |
| POST | `/floor-plan/zones/reorder` | `[{id, sortOrder}]` |
| POST | `/floor-plan/elements` / PATCH `:id` / DELETE `:id` | element CRUD |
| PATCH | `/floor-plan/layout` | **bulk** `{ tables:[{id,zoneId,posX,posY,width,height,rotation,shape}], elements?:[{id,x,y,width,height,rotation,points,style}] }` — one call to persist a drag session |

- Table create/update DTOs extended with optional spatial fields.
- Gateway: `emitFloorLayoutUpdated(tenantId, branchId, {zoneId?})` → `floor:layout-updated` to `pos-`/`kitchen-` rooms so open live maps refresh after a republish.
- Every write IDOR-guarded with compound `(tenantId, branchId)` WHERE (matches existing table mutations); bulk layout runs in one transaction.

---

## Frontend

Shared **`FloorMap`** Konva core (`features/floor-plan/`), two modes:

- **Edit mode** (`FloorPlanEditorPage`, admin): element palette (table ROUND/SQUARE/RECT, wall, door, bar, kitchen, plant, decor, text), drag + `Transformer` resize/rotate, snap-to-grid + grid overlay, marquee + shift multi-select, duplicate/copy-paste/delete, **undo/redo**, zoom/pan + fit-to-screen, per-table inspector, per-zone settings (rename, reorder via tabs, canvas size, upload background + opacity), "unplaced tables" tray, explicit Save + dirty indicator (debounced bulk `PATCH /floor-plan/layout`).
- **Live mode** (POS floor + read-only Tables map): same coords, tables colored by real-time status, badges (pending orders / waiter / bill — reuse `TableGrid` logic), reservation-hold badge, merged-group link, click → action sheet (open order / change status / transfer / merge). Zoom/pan + zone tabs + list fallback. Live via existing sockets + `floor:layout-updated`.

State: a `floorEditorStore` (zustand: selection, active tool, undo stack, dirty) for edit mode; react-query for persistence; live mode reuses the POS socket store.

Touch-points updated: `types/index.ts`, `tablesApi.ts` (+ `floorPlanApi.ts`), `tableStatus.ts`, POS `TableGrid`→live map, admin `TableManagementPage`→editor (+ keep a plain list for quick CRUD), reservations assign-on-map, QR `TableSelectionModal` (can show zone name), i18n (ar/en/ru/tr/uz). KDS unchanged (uses `number`).

---

## Phasing (each ships branch→PR→staging→prod)

- **P1 — Foundation (additive, safe):** schema (FloorZone, FloorElement, Table spatial fields) + idempotent migration + `FloorPlanService`/`Controller` + DTOs + bulk layout API + `floor:layout-updated` gateway event + backend tests. Nothing in the UI changes yet; `section` retained.
- **P2 — Editor:** the Konva edit-mode editor (zones, tables, structural/decor, background, undo/redo, snap, inspector) at a new admin route + `floorPlanApi.ts` + types + i18n + vitest.
- **P3 — Live integration:** live `FloorMap` in POS + read-only Tables map; wire real-time status/badges/click-actions; reservations assign-on-map; rewrite/replace `TableManagementPage`; **drop `section`** (migration + consumer cleanup); QR picker zone label.
- **P4 — Polish:** touch/mobile, animations, empty/loading states, full i18n sweep, accessibility, perf pass, completeness review.

Quality bar each phase: backend tsc+jest, frontend tsc+vitest+eslint, i18n parity+value-drift, contract-drift, cargo (if touched); adversarial-review workflow over the diff; fix blockers; then ship.
