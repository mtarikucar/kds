import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { ReservationStatus } from "../constants/reservation-status.enum";
import { TableStatus } from "../../tables/dto/create-table.dto";
import { KdsGateway } from "../../kds/kds.gateway";
// v2.8.95 — both autoHoldUpcoming and releaseExpiredHolds mutate
// shared table state on a 5-minute tick. Without a per-replica lock
// every replica double-flips tables and double-emits NO_SHOW events.
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";

/**
 * Default pre-start hold window when a tenant has no ReservationSettings
 * row yet (cold seed / brand-new tenant). Once the row exists the per-
 * tenant `holdOffsetMinutes` overrides this. Matches the original
 * hard-coded value so behavior is unchanged for stock tenants.
 */
const DEFAULT_HOLD_OFFSET_MINUTES = 30;

/**
 * After a confirmed reservation's startTime, how long we wait before
 * auto-flipping it to NO_SHOW and releasing the table. Hardcoded — the
 * user-facing setting controls the pre-start hold only; the post-start
 * grace is fixed at 30 minutes by product decision.
 */
const GRACE_AFTER_START_MINUTES = 30;

/**
 * Manages table-level holds for upcoming reservations.
 *
 * Cron #1 (auto-hold): every 5 min, for each CONFIRMED reservation
 * starting within the next {@link HOLD_WINDOW_MINUTES}, if the assigned
 * table is currently AVAILABLE, flip it to RESERVED and stamp
 * `reservationHoldId` so the release tick can later identify it.
 *
 * Cron #2 (release): every 5 min, for each table with a
 * `reservationHoldId`, check whether its reservation is still active
 * (CONFIRMED or PENDING within window). If not (CANCELLED / NO_SHOW /
 * REJECTED / COMPLETED / endTime passed without seating), drop the
 * hold: clear reservationHoldId and revert to AVAILABLE.
 *
 * SEAT (handled by ReservationsService.seat) takes the table to
 * OCCUPIED *and* clears reservationHoldId in the same transaction;
 * that path does not go through the cron.
 *
 * Manually-RESERVED tables (admin-set, status=RESERVED without
 * reservationHoldId) are never touched by these jobs because both
 * queries filter on the column being either AVAILABLE (auto-hold) or
 * non-null (release).
 */
@Injectable()
export class ReservationSchedulerService {
  private readonly logger = new Logger(ReservationSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Live floor-map refresh when the crons flip table status (auto-hold
    // AVAILABLE→RESERVED / release RESERVED→AVAILABLE). @Optional() so the
    // bare-constructed scheduler unit tests keep working (emit no-ops there).
    @Optional() private readonly kdsGateway?: KdsGateway,
  ) {}

  /**
   * Emit one floor:layout-updated per affected (tenant, branch) after a cron
   * batch so every open live map recolors. `touched` holds "tenantId|branchId"
   * keys. Null-safe + best-effort — an emit must never fail the cron.
   */
  private emitTouchedBranches(touched: Set<string>) {
    for (const key of touched) {
      const [tenantId, branchId] = key.split("|");
      this.kdsGateway?.emitFloorLayoutUpdated(tenantId, branchId, {});
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: "reservation-auto-hold" })
  async autoHoldUpcoming(): Promise<{ held: number }> {
    let outcome = { held: 0 };
    await withAdvisoryLock(
      this.prisma,
      "reservation-auto-hold",
      async () => {
        outcome = await this.autoHoldUpcomingInner();
      },
      this.logger,
    );
    return outcome;
  }

  private async autoHoldUpcomingInner(): Promise<{ held: number }> {
    const now = new Date();

    // Reservations whose date is today (or tomorrow at the boundary)
    // and whose startTime falls inside [now, now+offset]. SQL can't
    // compare the composed timestamp directly without a join+cast, so
    // we pull a small candidate set per day and filter in memory.
    // Key the candidate-date window at UTC midnight to match how reservations
    // are STORED: createPublicReservation writes new Date(dto.date) (UTC
    // midnight) into the @db.Date column. Building `today` via
    // new Date(y, m, d) (process-LOCAL midnight) serialized to the PREVIOUS
    // UTC date on a server east of UTC (e.g. Europe/Istanbul), shifting the
    // {today, tomorrow} `in` set off by one and dropping the real next-day
    // reservations this window is meant to cover. Take the server-local
    // calendar day, then anchor it at UTC midnight like storage does.
    const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const today = new Date(`${ymd}T00:00:00.000Z`);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const candidates = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.CONFIRMED,
        date: { in: [today, tomorrow] },
        tableId: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        date: true,
        startTime: true,
        tableId: true,
      },
    });

    // Batch-fetch per-tenant offset so we don't issue one query per
    // reservation. Tenants without a settings row fall back to the
    // default — matches the legacy hardcoded behavior.
    const offsetByTenant = await this.fetchOffsets(
      Array.from(new Set(candidates.map((r) => r.tenantId))),
    );

    let held = 0;
    const touched = new Set<string>();
    for (const r of candidates) {
      const offsetMin =
        offsetByTenant.get(r.tenantId) ?? DEFAULT_HOLD_OFFSET_MINUTES;
      const windowEnd = new Date(now.getTime() + offsetMin * 60_000);

      const [sh, sm] = r.startTime.split(":").map(Number);
      const startDt = new Date(r.date);
      startDt.setHours(sh, sm, 0, 0);

      if (startDt < now || startDt > windowEnd) continue;

      // Only flip if the table is currently AVAILABLE. If it's OCCUPIED
      // (active service) leave it — the reservation will run into a
      // collision the staff has to resolve. If it's already RESERVED,
      // someone (us or admin) already holds it.
      const updated = await this.prisma.table.updateMany({
        where: {
          id: r.tableId!,
          status: TableStatus.AVAILABLE,
          reservationHoldId: null,
        },
        data: {
          status: TableStatus.RESERVED,
          reservationHoldId: r.id,
        },
      });
      if (updated.count > 0) {
        held += 1;
        touched.add(`${r.tenantId}|${r.branchId}`);
      }
    }

    if (held > 0) {
      this.logger.log(
        `auto-hold: marked ${held} table(s) RESERVED for upcoming reservations`,
      );
    }
    this.emitTouchedBranches(touched);
    return { held };
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: "reservation-release-holds" })
  async releaseExpiredHolds(): Promise<{ released: number }> {
    let outcome = { released: 0 };
    await withAdvisoryLock(
      this.prisma,
      "reservation-release-holds",
      async () => {
        outcome = await this.releaseExpiredHoldsInner();
      },
      this.logger,
    );
    return outcome;
  }

  private async releaseExpiredHoldsInner(): Promise<{ released: number }> {
    // Tables with a hold pointer. We pull the reservation alongside so
    // the eligibility check is one query, not N.
    const heldTables = await this.prisma.table.findMany({
      where: { reservationHoldId: { not: null } },
      include: { reservationHold: true },
    });

    if (heldTables.length === 0) return { released: 0 };

    const now = new Date();
    let released = 0;
    const touched = new Set<string>();

    for (const table of heldTables) {
      const r = table.reservationHold;
      let shouldRelease = false;

      if (!r) {
        // Reservation was deleted (FK ON DELETE SET NULL would leave
        // reservationHoldId null, so this branch is only reachable mid-
        // race — but defensive cleanup never hurts).
        shouldRelease = true;
      } else if (
        r.status === ReservationStatus.CANCELLED ||
        r.status === ReservationStatus.NO_SHOW ||
        r.status === ReservationStatus.REJECTED ||
        r.status === ReservationStatus.COMPLETED
      ) {
        shouldRelease = true;
      } else if (r.status === ReservationStatus.SEATED) {
        // SEAT path should already have flipped table → OCCUPIED and
        // cleared the hold. If we see a still-held SEATED row,
        // something raced — drop the hold to converge.
        shouldRelease = true;
      } else {
        // Still PENDING/CONFIRMED. Two release triggers:
        //   (a) end of the reservation window has passed (legacy no-show).
        //   (b) start + GRACE_AFTER_START_MINUTES has passed without
        //       seating — auto-mark NO_SHOW and release the table so the
        //       waiter can use it for a walk-in. The dialog UX only
        //       exposes "seat" within this grace, after which the row
        //       has no actionable path anyway.
        const [eh, em] = r.endTime.split(":").map(Number);
        const endDt = new Date(r.date);
        endDt.setHours(eh, em, 0, 0);

        const [sh, sm] = r.startTime.split(":").map(Number);
        const startDt = new Date(r.date);
        startDt.setHours(sh, sm, 0, 0);
        const graceEnd = new Date(
          startDt.getTime() + GRACE_AFTER_START_MINUTES * 60_000,
        );

        if (endDt < now) {
          shouldRelease = true;
        } else if (graceEnd < now) {
          // Mark the reservation as NO_SHOW so the customer report and
          // history reflect what happened. Guarded by status filter so
          // a concurrent SEAT/CANCEL can't be overwritten.
          await this.prisma.reservation.updateMany({
            where: {
              id: r.id,
              status: {
                in: [ReservationStatus.CONFIRMED, ReservationStatus.PENDING],
              },
            },
            data: { status: ReservationStatus.NO_SHOW },
          });
          shouldRelease = true;
        }
      }

      if (!shouldRelease) continue;

      // Only revert if we still own the hold (status === RESERVED).
      // Defensive: if a transaction elsewhere already moved the table
      // (e.g. SEAT → OCCUPIED) we shouldn't stomp on it.
      const updated = await this.prisma.table.updateMany({
        where: {
          id: table.id,
          status: TableStatus.RESERVED,
          reservationHoldId: table.reservationHoldId,
        },
        data: {
          status: TableStatus.AVAILABLE,
          reservationHoldId: null,
        },
      });
      if (updated.count > 0) {
        released += 1;
        touched.add(`${table.tenantId}|${table.branchId}`);
      }
    }

    if (released > 0) {
      this.logger.log(
        `release-holds: cleared ${released} stale RESERVED hold(s)`,
      );
    }
    this.emitTouchedBranches(touched);
    return { released };
  }

  /**
   * Fetches per-tenant holdOffsetMinutes settings in one query. Tenants
   * without a settings row are absent from the map; callers fall back
   * to {@link DEFAULT_HOLD_OFFSET_MINUTES}.
   */
  private async fetchOffsets(
    tenantIds: string[],
  ): Promise<Map<string, number>> {
    if (tenantIds.length === 0) return new Map();
    const rows = await this.prisma.reservationSettings.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { tenantId: true, holdOffsetMinutes: true },
    });
    return new Map(rows.map((r) => [r.tenantId, r.holdOffsetMinutes]));
  }
}
