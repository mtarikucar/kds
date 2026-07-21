# Reservations overhaul: double-booking, future visibility, staff workflow

Date: 2026-07-22 · Branch: `feat/reservations-overhaul` · Status: approved for implementation

## Problems (owner-reported, verified in code)
1. "Aynı yere rezervasyon yapılabiliyor" — public wizard's table pick is optional; no-table requests skip the entire overlap check (`if (dto.tableId)` gate, reservations.service.ts:333) and `maxReservationsPerSlot` defaults NULL → unlimited same-slot PENDING pile-up. Table-assigned overlaps ARE blocked (Serializable+retry).
2. "İleri tarihteki rezervasyon isteklerini göremiyorum" — list is single-day (default today), no range params server-side, no pending inbox, no badge, no `reservation:*` socket, notification clicks navigate nowhere.
3. Staff cannot create reservations at all (no POST on the admin controller); general UX debt (22 admin + 13 public items catalogued in the audit).

## A. Port the three dangling fix commits (backend hardening)
Cherry-pick/port onto this branch (objects exist in the repo; files have NOT drifted):
- `d2cc0d3f` (fix/reservations-hold-and-tz): status-guarded updateMany claims on all 7 transitions (409 on race), remove()/update() hold release, seat() steal-guard, branch-scoped maxReservationsPerSlot count, UTC-anchored getStats + scheduler day keys, numeric-max reservation numbers, @Throttle on public /branches, + its 167-line hold-and-tz spec. NOTE: reservation-scheduler.service.spec.ts pins LOCAL-midnight fixtures — update them to UTC anchoring per the commit's own spec changes; keep the PR #306 advisory-lock mock pattern.
- `600b288f` (fix/self-pay-reservation-toctou): re-check reservations INSIDE the tx in self-pay createPayIntent + duplicate-orderItemId dedup (+spec).
- `09975c83` (fix/tables-review) — ONLY its 4 reservation hunks in tables.service.ts: startOfUtcToday for upcomingReservation annotation, reservationHoldId detach on manual OCCUPIED/AVAILABLE status writes (update + updateStatus), 409 guard on deleting a table with a live (PENDING/CONFIRMED/SEATED, date>=today) reservation. Do NOT port its unrelated tables-UI hunks.

## B. Backend features (API contract — frontend codes against this)

### B1. Close the no-table double-booking hole
In `createPublicReservation` (and the shared core used by staff create), when `tableId` is ABSENT:
- If the resolved branch has ≥1 table: inside the same Serializable tx, verify at least one capacity-fitting table remains free for `[startTime, endTime)` after accounting for overlapping PENDING/CONFIRMED/SEATED reservations (both table-assigned rows on that table AND enough spare tables for previously-accepted no-table rows at overlapping times — simplest correct rule: count overlapping no-table reservations + distinct occupied tables; reject when `freeFittingTables <= overlappingNoTableCount`). Error message key-able; guest sees a proper error (Lane C surfaces it).
- If the branch has 0 tables: enforce `maxReservationsPerSlot ?? 10` as the slot cap (code-level fallback; no schema default change).

### B2. Staff create endpoint
`POST /reservations` (ADMIN/MANAGER; branch-scoped like siblings). Body `CreateStaffReservationDto`: `date, startTime, endTime?, guestCount, customerName, customerPhone?, customerEmail?, notes?, adminNotes?, tableId?, branchId?, source ('PHONE'|'WALKIN', default 'PHONE'), autoSeat? (bool)`. Behavior: reuses the same conflict-checked transactional core as public create; SKIPS requireApproval (status starts CONFIRMED), SKIPS minAdvanceBooking/maxAdvanceDays/operating-closed-day gates (staff judgment), KEEPS end>start + capacity + all overlap checks. `endTime` defaults to `start + settings.defaultDuration`. `autoSeat=true` (walk-in): requires `tableId`, creates then immediately seats (same guarded claim as seat(), table→OCCUPIED, emits floor:layout-updated). No customer notification for WALKIN; PHONE sends the normal created/confirmed notification.

### B3. `source` column
Reversible hand-written migration (project convention, sqlx-style up/down pair per repo's prisma/migrations format): `ALTER TABLE reservations ADD COLUMN source TEXT NOT NULL DEFAULT 'ONLINE'` (+ index not needed) / down drops exactly that column. Prisma schema: `source String @default("ONLINE")`. Public create writes 'ONLINE'.

### B4. Range query + pending count
- `ReservationQueryDto` gains optional `dateFrom`, `dateTo` (YYYY-MM-DD, inclusive; combinable with status/search/tableId; `date` kept for back-compat; when both given, `date` wins). Sort stays `date asc, startTime asc`.
- `GET /reservations/pending-count` → `{ count }`: PENDING rows with `date >= today (UTC-anchored)`, branch-scoped exactly like findAll.

### B5. Live events + notification deep-link
- Emit socket events to the same tenant/branch rooms the existing gateway uses: `reservation:new` on create (any source) and `reservation:updated` on every lifecycle transition/edit. Payload: `{ reservationId, status, date }`.
- Admin notification rows for reservations get `data.action: 'view_reservations'` so the bell click can navigate (keep existing `data.type`).

## C. Admin UI overhaul (`ReservationsPage` + shell)
- **Three view tabs**: (1) **Gün** — default, today; date strip with prev/next + native picker + per-day flow unchanged; (2) **Bekleyenler** — cross-date inbox: `dateFrom=today`, `status=PENDING`, sorted soonest-first, each row one-tap Onayla / (reason-collecting) Reddet; tab label carries the pending count; (3) **Yaklaşan** — 14-day planning strip (per-day counts from a `dateFrom=today,dateTo=+14` fetch grouped client-side) + list of the selected day.
- Status tabs: add REJECTED and NO_SHOW. Stats cards become clickable filters. Search debounced 300ms.
- **Yeni Rezervasyon** button → modal: date, time (slots via existing public availability API or free HH:mm with visible conflict feedback), duration default, party size, table select showing ONLY free capacity-fitting tables for the window (via `GET /public/reservations/:tenantId/tables` equivalent — reuse `useAvailableTables`-style fetch through the staff-side availability endpoint if present, else the public one with tenantId from auth), contact fields (email/phone optional but at least one for PHONE; none required for WALKIN), source PHONE|WALKIN, WALKIN forces table + creates seated. Calls `POST /reservations`.
- Detail modal: full edit (date, start/end, guests, contact, notes, adminNotes, table) via existing PATCH; table picker disables conflicting tables (fetch availability for the window) with a tooltip; lifecycle action buttons INSIDE the modal; reject collects reason (also from row action).
- Live: new `useReservationsSocket` hook — on `reservation:new`/`reservation:updated` invalidate `['reservations']`, `['reservationStats']`, pending count. Sidebar reservations entry shows the pending-count badge (new `usePendingReservationCount` hook, refetch on socket + 60s poll fallback). NotificationCenter: RESERVATION icon case + navigate on `data.action==='view_reservations'` (fallback: `data.type==='new_reservation'`).
- 24h time everywhere (kill the 12h AM/PM formatter); dates via i18n locale.
- All new strings in all 5 locales (reservations.json / common.json as fitting).

## D. Public flow fixes (surgical)
- Submit errors SURFACED: mutation onError → toast + inline alert on the review step; on conflict/slot-full messages, offer "Saatleri yenile" that jumps to step 2 with slots refetched. Cancel flow: render deadline/disabled errors (keys `lookup.deadlinePassed` etc. exist); lookup distinguishes 429/500 from not-found.
- SuccessCard honors response status: CONFIRMED → confirmed copy (new key ×5), PENDING → current copy.
- 24h time in utils.ts formatTime; formatReservationDate uses the active i18n language.
- Step-2 empty state differentiates closed-day (from settings operating hours) vs no-slots.

## E. POS touches
- TableGrid card: small amber `HH:mm · Np` chip when `upcomingReservation` present.
- ReservationActionDialog: add Cancel and No-Show actions (confirm sub-step) beside Seat.
- `usePosSocket`: also listen `floor:layout-updated` → invalidate `['tables']` (scheduler auto-holds recolor live).

## Out of scope (documented deferrals)
DB exclusion constraint on (tableId, timerange) — app-level Serializable guard + single conflict-checked core is the current guarantee; full calendar/timeline grid view; waitlist; deposits/no-show fees; per-(tenant,phone) public throttle keying; per-branch ReservationSettings.

## Verify
Backend: full reservations+tables+self-pay spec suites (clock-pinned per convention), tsc, lint:ci. Frontend: vitest full, tsc, eslint, i18n parity, build. Adversarial review before merge. Migration up→down→up round-trip on a throwaway Postgres.
