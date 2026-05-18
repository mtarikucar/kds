import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReservationStatus } from '../constants/reservation-status.enum';
import { TableStatus } from '../../tables/dto/create-table.dto';

/**
 * Auto-RESERVED hold window: how many minutes before a CONFIRMED
 * reservation's startTime should the table be flipped to RESERVED so
 * a walk-in can't grab it. Matches the orders-service walk-in guard
 * so the two systems agree on "imminent".
 */
const HOLD_WINDOW_MINUTES = 30;

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

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'reservation-auto-hold' })
  async autoHoldUpcoming(): Promise<{ held: number }> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + HOLD_WINDOW_MINUTES * 60_000);

    // Reservations whose date is today (or tomorrow at the boundary)
    // and whose startTime falls inside [now, now+window]. SQL can't
    // compare the composed timestamp directly without a join+cast, so
    // we pull a small candidate set per day and filter in memory.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const candidates = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.CONFIRMED,
        date: { in: [today, tomorrow] },
        tableId: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        date: true,
        startTime: true,
        tableId: true,
      },
    });

    let held = 0;
    for (const r of candidates) {
      const [sh, sm] = r.startTime.split(':').map(Number);
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
      if (updated.count > 0) held += 1;
    }

    if (held > 0) {
      this.logger.log(`auto-hold: marked ${held} table(s) RESERVED for upcoming reservations`);
    }
    return { held };
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'reservation-release-holds' })
  async releaseExpiredHolds(): Promise<{ released: number }> {
    // Tables with a hold pointer. We pull the reservation alongside so
    // the eligibility check is one query, not N.
    const heldTables = await this.prisma.table.findMany({
      where: { reservationHoldId: { not: null } },
      include: { reservationHold: true },
    });

    if (heldTables.length === 0) return { released: 0 };

    const now = new Date();
    let released = 0;

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
        // Still PENDING/CONFIRMED. Released only if the end of the
        // window has passed (no-show without anyone flipping the row).
        const [eh, em] = r.endTime.split(':').map(Number);
        const endDt = new Date(r.date);
        endDt.setHours(eh, em, 0, 0);
        if (endDt < now) shouldRelease = true;
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
      if (updated.count > 0) released += 1;
    }

    if (released > 0) {
      this.logger.log(`release-holds: cleared ${released} stale RESERVED hold(s)`);
    }
    return { released };
  }
}
