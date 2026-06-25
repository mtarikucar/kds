import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MetricsService } from "../../../common/metrics/metrics.service";
import { captureException } from "../../../sentry.config";
import { NotificationsService } from "../../notifications/notifications.service";
import { NotificationType } from "../../notifications/dto/create-notification.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { UpdateReservationDto } from "../dto/update-reservation.dto";
import { ReservationQueryDto } from "../dto/reservation-query.dto";
import { ReservationSettingsService } from "./reservation-settings.service";
import { ReservationStatus } from "../constants/reservation-status.enum";
import { ReservationNotificationService } from "./reservation-notification.service";
import { KdsGateway } from "../../kds/kds.gateway";
import {
  ReservationAvailabilityService,
  timeToMinutes,
} from "./reservation-availability.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { isReservationFeatureEnabled } from "./reservation-entitlement.util";

@Injectable()
export class ReservationsService {
  // Structured-logger consistency (see iter-25 commit message for context).
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private settingsService: ReservationSettingsService,
    // Email-first / SMS-fallback abstraction. Still calls into the
    // SMS service under the hood when phone is the live channel.
    private reservationNotificationService: ReservationNotificationService,
    // Public-availability reads + shared public branch resolver, extracted
    // into their own service (god-file split). createPublicReservation here
    // still calls resolvePublicBranchId through it.
    private availability: ReservationAvailabilityService,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
    // Public-surface plan gate (mirrors PlanFeatureGuard on the admin path).
    // @Optional() so bare-constructed test instances keep working; production
    // DI always provides the global EntitlementService.
    @Optional() private readonly entitlements?: EntitlementService,
    // Live floor-plan map refresh on reservation-driven table status flips.
    // @Optional() so bare-constructed unit tests keep working (the emit is then
    // a no-op); production DI provides it via KdsModule.
    @Optional() private readonly kdsGateway?: KdsGateway,
  ) {}

  /**
   * Recolor every open live floor map after a reservation changed a table's
   * status (seat → OCCUPIED, complete/cancel/no-show/reject → AVAILABLE).
   * Best-effort + null-safe: a socket hiccup or a bare-constructed test
   * instance must never fail the reservation write.
   */
  private emitFloorRefresh(tenantId: string, branchId: string) {
    this.kdsGateway?.emitFloorLayoutUpdated(tenantId, branchId, {});
  }

  private countReservation(status: string): void {
    this.metrics?.incCounter(
      "reservations_total",
      "Reservations by lifecycle event (created|confirmed|rejected|cancelled)",
      { status },
    );
  }

  /**
   * Fire-and-forget customer notify, but with the failure surfaced to Sentry
   * (correlation id auto-attached) instead of silently lost — the audit
   * flagged these unawaited notify() calls as dropping send failures.
   */
  private notifyCustomer(
    tenantId: string,
    event: "created" | "confirmed" | "rejected" | "cancelled",
    payload: Parameters<ReservationNotificationService["notify"]>[2],
  ): void {
    this.countReservation(event);
    void this.reservationNotificationService
      .notify(tenantId, event, payload)
      .catch((e) =>
        captureException(e as Error, {
          module: "reservations",
          op: "notifyCustomer",
          event,
          tenantId,
        }),
      );
  }

  private async validateTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException("Tenant not found");
    }
    if (tenant.status !== "ACTIVE") {
      throw new ForbiddenException("Tenant is not active");
    }
    return tenant;
  }

  private async generateReservationNumber(
    tenantId: string,
    date: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const dateStr = date.replace(/-/g, "").substring(0, 8);
    const prefix = `R-${dateStr}`;

    const client = tx ?? this.prisma;
    // Take the max numeric suffix among this (tenant, date) prefix. We must
    // NOT rely on `orderBy: { reservationNumber: 'desc' }` + take-first: that
    // sorts LEXICOGRAPHICALLY, so once a day exceeds 999 reservations
    // "...-1000" sorts BELOW "...-999" and the scan returns 999 → next=1000
    // again → P2002 collision every retry → bookings fail. Scan the day's
    // numbers and reduce to the true numeric max instead (set is bounded by
    // the day's reservation count). Width is padded to 4 for headroom; the
    // numeric reduce stays correct regardless of stored width.
    const sameDay = await client.reservation.findMany({
      where: {
        tenantId,
        reservationNumber: { startsWith: prefix },
      },
      select: { reservationNumber: true },
    });

    let maxNum = 0;
    for (const r of sameDay) {
      const n = parseInt(r.reservationNumber.split("-").pop() || "0", 10);
      // Defensive: parseInt returns NaN for empty/garbled tails; ignore those
      // rather than letting NaN poison the max.
      if (Number.isFinite(n) && n > maxNum) {
        maxNum = n;
      }
    }

    return `${prefix}-${String(maxNum + 1).padStart(4, "0")}`;
  }

  async createPublicReservation(tenantId: string, dto: CreateReservationDto) {
    await this.validateTenant(tenantId);

    // Plan-gate the PUBLIC create path server-side BEFORE persisting, matching
    // the admin gate (PlanFeatureGuard + @RequiresFeature(RESERVATION_SYSTEM)).
    // This is the @Public() surface the guard short-circuits past, so without
    // this a tenant whose plan excludes reservations would accept a booking the
    // operator can never see/confirm/manage (book-into-a-void).
    if (this.entitlements) {
      const featureEnabled = await isReservationFeatureEnabled(
        this.prisma,
        this.entitlements,
        tenantId,
      );
      if (!featureEnabled) {
        throw new ForbiddenException("Reservation system is not enabled");
      }
    }

    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.isEnabled) {
      throw new BadRequestException("Reservation system is not enabled");
    }

    // Validate end time > start time
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException("End time must be after start time");
    }

    // Validate date is not in the past. `new Date("YYYY-MM-DD")` parses
    // as UTC midnight; calling setHours(0,0,0,0) on it then shifts to
    // *local* midnight. In Turkey (UTC+3) that crosses the day boundary
    // and a "tomorrow" reservation can read as "past" between 21:00 and
    // 23:59 local. Parsing the components as local-time avoids the drift.
    const parseLocalDate = (s: string) => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const reservationDate = parseLocalDate(dto.date);

    if (reservationDate < today) {
      throw new BadRequestException("Cannot book past dates");
    }

    // Validate maxAdvanceDays
    if (settings.maxAdvanceDays) {
      const maxDate = new Date();
      maxDate.setHours(0, 0, 0, 0);
      maxDate.setDate(maxDate.getDate() + settings.maxAdvanceDays);
      if (reservationDate > maxDate) {
        throw new BadRequestException(
          `Cannot book more than ${settings.maxAdvanceDays} days in advance`,
        );
      }
    }

    // Validate slot time against now. The earlier `reservationDate <
    // today` check rejects past *dates* but a today-with-past-time
    // slot (e.g. 09:00 booked at 13:00) slips past it — so this is a
    // separate, always-on check. The minAdvanceBooking buffer below
    // is layered on top.
    const [startHour, startMinute] = dto.startTime.split(":").map(Number);
    const slotDateTime = new Date(dto.date);
    slotDateTime.setHours(startHour, startMinute, 0, 0);
    if (slotDateTime.getTime() < now.getTime()) {
      throw new BadRequestException("Reservation time is in the past");
    }

    // Validate minAdvanceBooking (additional buffer beyond "not past").
    // Guarded by truthy because 0 means "no buffer required" — the
    // past-time check above already covers the floor.
    if (settings.minAdvanceBooking) {
      if (
        slotDateTime.getTime() - now.getTime() <
        settings.minAdvanceBooking * 60 * 1000
      ) {
        throw new BadRequestException(
          "Reservation time is too soon. Please book further in advance.",
        );
      }
    }

    // Validate operating hours (closed day check). Use parseLocalDate
    // — `new Date(dto.date)` is UTC-midnight, and on UTC+3 a Monday
    // booking could read as Sunday's day-of-week and trigger a false
    // "restaurant is closed" reject. parseLocalDate keeps the day in
    // tenant-local time.
    if (settings.operatingHours) {
      const dayOfWeek = parseLocalDate(dto.date)
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();
      const hours = settings.operatingHours as any;
      if (hours[dayOfWeek]?.closed) {
        throw new BadRequestException("Restaurant is closed on this day");
      }
    }

    if (dto.guestCount > settings.maxGuestsPerReservation) {
      throw new BadRequestException(
        `Maximum guests per reservation is ${settings.maxGuestsPerReservation}`,
      );
    }

    // Check table capacity if tableId provided. We also load the table's
    // branchId so the new reservation row can inherit it (v3.0.0 strict).
    let resolvedBranchId: string | null = null;
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
      });
      if (!table) {
        throw new NotFoundException("Table not found");
      }
      if (dto.guestCount > table.capacity) {
        throw new BadRequestException(`Table capacity is ${table.capacity}`);
      }
      resolvedBranchId = table.branchId;
    }

    // Walk-in / no-table reservations still need a branchId (v3.0.0 strict
    // schema). This endpoint is @Public(), so there's no @CurrentScope —
    // resolvePublicBranchId() honors an explicit branchId on the DTO when
    // present (validated against THIS tenant + active) and otherwise falls
    // back to the tenant's oldest ACTIVE branch (the "Main" branch created
    // at tenant bootstrap). This is the SAME resolver the public
    // availability reads use, so what the guest saw as available matches
    // the branch the booking lands on.
    //
    // v3.0.1 audit follow-up (now resolved): a walk-in / no-table booking
    // honors an explicit dto.branchId (multi-branch picker), falling back to
    // the oldest-active branch only when none is supplied. The DTO now
    // declares branchId so the whitelisting ValidationPipe keeps it.
    if (!resolvedBranchId) {
      resolvedBranchId = await this.availability.resolvePublicBranchId(
        tenantId,
        dto.branchId,
      );

      // No explicit table assigned: the table-pick step is optional in the
      // public wizard, so a guest can submit a no-table booking for a party
      // larger than ANY physical table. Reject when guestCount exceeds the
      // branch's largest table capacity — no single table could ever seat the
      // party (mirrors the per-table capacity check above for assigned tables).
      //
      // BUT: only enforce this when the branch ACTUALLY HAS tables. A
      // reservation-enabled tenant that never defined tables (new tenants are
      // NOT auto-seeded any) reports maxCapacity=0, and guestCount is @Min(1) —
      // so an unconditional `guestCount > maxCapacity` guard rejects EVERY
      // no-table public booking, bricking the established walk-in / no-table
      // flow. When maxCapacity===0 (zero tables defined) table management is
      // not in use here, so fall back to prior behavior: the party size is
      // bounded only by settings.maxGuestsPerReservation, already enforced
      // above. The "no single table can seat this party" guard only applies
      // when tables exist and the party exceeds the largest.
      const largest = await this.prisma.table.aggregate({
        where: { tenantId, branchId: resolvedBranchId },
        _max: { capacity: true },
      });
      const maxCapacity = largest._max.capacity ?? 0;
      if (maxCapacity > 0 && dto.guestCount > maxCapacity) {
        throw new BadRequestException(
          `No table can seat a party of ${dto.guestCount}. The largest table seats ${maxCapacity}.`,
        );
      }
    }

    const status = settings.requireApproval
      ? ReservationStatus.PENDING
      : ReservationStatus.CONFIRMED;
    const confirmedAt = settings.requireApproval ? undefined : new Date();

    // Serializable isolation so the overlap-check + insert is effectively
    // atomic: two concurrent requests for the same table/time block each
    // other via the SERIALIZABLE guarantee, and we only accept the first.
    // The reservation-number allocation is ALSO a hot race, so we retry
    // on the (tenantId, reservationNumber) unique index via a small loop —
    // between findFirst's max-seen and our insert another row can land.
    const MAX_NUMBER_RETRIES = 5;
    let reservation: any;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
      try {
        reservation = await this.prisma.$transaction(
          async (tx) => {
            // Check table time overlap inside transaction
            if (dto.tableId) {
              const existingTableReservations = await tx.reservation.findMany({
                where: {
                  tenantId,
                  tableId: dto.tableId,
                  date: new Date(dto.date),
                  status: {
                    in: [
                      ReservationStatus.PENDING,
                      ReservationStatus.CONFIRMED,
                      ReservationStatus.SEATED,
                    ],
                  },
                },
              });

              const requestStart = timeToMinutes(dto.startTime);
              const requestEnd = timeToMinutes(dto.endTime);

              for (const res of existingTableReservations) {
                const resStart = timeToMinutes(res.startTime);
                const resEnd = timeToMinutes(res.endTime);
                if (requestStart < resEnd && requestEnd > resStart) {
                  throw new BadRequestException(
                    "This table is already reserved for the selected time period",
                  );
                }
              }
            }

            // Check slot availability inside transaction. Branch-scope the
            // count to match getAvailableSlots, which counts per resolved
            // branch — without branchId here the cap was enforced TENANT-wide
            // at booking while shown PER-BRANCH in availability, so a slot
            // could read "available" yet the booking reject as "fully booked".
            if (settings.maxReservationsPerSlot) {
              const existingCount = await tx.reservation.count({
                where: {
                  tenantId,
                  branchId: resolvedBranchId,
                  date: new Date(dto.date),
                  startTime: dto.startTime,
                  status: {
                    in: [
                      ReservationStatus.PENDING,
                      ReservationStatus.CONFIRMED,
                      ReservationStatus.SEATED,
                    ],
                  },
                },
              });

              if (existingCount >= settings.maxReservationsPerSlot) {
                throw new BadRequestException("This time slot is fully booked");
              }
            }

            // Duplicate reservation check inside transaction: same
            // customer + same day + overlapping time. Bucket by the
            // contact channel actually supplied — phone is now
            // optional (email-only bookings allowed), and passing
            // `customerPhone: undefined` to Prisma would drop the
            // filter entirely and match every concurrent booking at
            // that slot (the bug that caused 400s for email-only
            // walk-ins). Phone wins when both are present so existing
            // phone-based dedup behavior is preserved.
            const customerKey = dto.customerPhone
              ? { customerPhone: dto.customerPhone }
              : dto.customerEmail
                ? { customerEmail: dto.customerEmail }
                : null;
            if (customerKey) {
              const existingDuplicate = await tx.reservation.findFirst({
                where: {
                  tenantId,
                  ...customerKey,
                  date: new Date(dto.date),
                  startTime: dto.startTime,
                  status: {
                    in: [
                      ReservationStatus.PENDING,
                      ReservationStatus.CONFIRMED,
                    ],
                  },
                },
              });
              if (existingDuplicate) {
                throw new BadRequestException(
                  "You already have a reservation for this time slot",
                );
              }
            }

            // Allocate number INSIDE the tx so our "max seen" scan sees
            // concurrent inserts that haven't committed yet (under
            // SERIALIZABLE isolation, the loser aborts).
            const reservationNumber = await this.generateReservationNumber(
              tenantId,
              dto.date,
              tx,
            );

            return tx.reservation.create({
              data: {
                reservationNumber,
                date: new Date(dto.date),
                startTime: dto.startTime,
                endTime: dto.endTime,
                guestCount: dto.guestCount,
                customerName: dto.customerName,
                customerPhone: dto.customerPhone,
                customerEmail: dto.customerEmail,
                notes: dto.notes,
                tableId: dto.tableId,
                tenantId,
                // v3.0.0 — strict branch scope. Derived from the assigned
                // table when present, else falls back to the tenant's
                // default (first-created) branch.
                branchId: resolvedBranchId!,
                status,
                confirmedAt,
              },
              include: { table: true },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (err) {
        // P2002 on reservationNumber OR Postgres SERIALIZATION_FAILURE
        // (40001 via P2034 in Prisma) — retry with a fresh sequence.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === "P2002" || err.code === "P2034")
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (!reservation) {
      throw new ConflictException(
        "Could not allocate a reservation number — please retry",
      );
    }

    // Notify admins
    try {
      await this.notificationsService.notifyAdmins(tenantId, {
        title: "New Reservation",
        message: `${dto.customerName} - ${dto.guestCount} guests on ${dto.date} at ${dto.startTime}`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: "new_reservation" },
      });
    } catch (e) {
      this.logger.error(
        `Failed to send reservation notification: ${e.message}`,
      );
    }

    // Notify customer. Channel chosen at call time: email if the
    // customer left one and the emailOnReservationCreated toggle is on;
    // SMS otherwise (or as fallback when email send fails).
    this.notifyCustomer(tenantId, "created", {
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      date: dto.date,
      startTime: dto.startTime,
      reservationNumber: reservation.reservationNumber,
    });

    return reservation;
  }

  async findAll(scope: BranchScope, query: ReservationQueryDto) {
    // v3.0.0 — branchScope(scope) spreads `{ tenantId, branchId }`. Pre-v3
    // this filtered by tenantId only; MANAGER on branch A could read
    // branch B's reservation list, which the v3 audit flagged.
    const where: any = { ...branchScope(scope) };

    if (query.date) {
      where.date = new Date(query.date);
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.tableId) {
      where.tableId = query.tableId;
    }

    if (query.search) {
      where.OR = [
        { customerName: { contains: query.search, mode: "insensitive" } },
        { customerPhone: { contains: query.search } },
        { reservationNumber: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        include: { table: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        skip,
        take: limit,
      }),
      this.prisma.reservation.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(scope: BranchScope, id: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, ...branchScope(scope) },
      include: { table: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }

    return reservation;
  }

  async getStats(scope: BranchScope, date?: string) {
    // Anchor the day key at UTC midnight to match how reservations are
    // STORED — createPublicReservation/update/findAll all write/read the
    // @db.Date column via `new Date(dateStr)` = UTC midnight. The previous
    // `new Date(targetDate.getFullYear(), getMonth(), getDate())` used
    // process-LOCAL midnight, which on a server east of UTC (e.g.
    // Europe/Istanbul, the primary market) serialized to the PREVIOUS UTC
    // calendar date — so getStats(date) returned the day-BEFORE's counts and
    // disagreed with the reservation list. (personnel H6/M7 @db.Date class.)
    let ymd: string;
    if (date) {
      ymd = date.slice(0, 10);
    } else {
      // Default "today" from the server's local calendar day (prior
      // behavior), then key it at UTC midnight like storage does.
      const n = new Date();
      ymd = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    }
    const startOfDay = new Date(`${ymd}T00:00:00.000Z`);
    if (Number.isNaN(startOfDay.getTime())) {
      throw new BadRequestException("Invalid date");
    }

    const reservations = await this.prisma.reservation.findMany({
      where: { ...branchScope(scope), date: startOfDay },
    });

    return {
      total: reservations.length,
      pending: reservations.filter(
        (r) => r.status === ReservationStatus.PENDING,
      ).length,
      confirmed: reservations.filter(
        (r) => r.status === ReservationStatus.CONFIRMED,
      ).length,
      seated: reservations.filter((r) => r.status === ReservationStatus.SEATED)
        .length,
      completed: reservations.filter(
        (r) => r.status === ReservationStatus.COMPLETED,
      ).length,
      cancelled: reservations.filter(
        (r) => r.status === ReservationStatus.CANCELLED,
      ).length,
      noShow: reservations.filter((r) => r.status === ReservationStatus.NO_SHOW)
        .length,
      rejected: reservations.filter(
        (r) => r.status === ReservationStatus.REJECTED,
      ).length,
    };
  }

  async update(scope: BranchScope, id: string, dto: UpdateReservationDto) {
    const reservation = await this.findOne(scope, id);

    // [M22] Validate any incoming tableId against the caller's scope before
    // writing, mirroring createPublicReservation. The table FK is
    // tenant-agnostic, so without this an ADMIN/MANAGER scoped to branch A
    // could PATCH tableId to a table belonging to branch B / another tenant —
    // the write would succeed (leaving branchId stale/inconsistent) and the
    // include:{table:true} response would leak the foreign table's fields.
    // branchScope(scope) pins (tenantId, branchId), so a found table is
    // guaranteed in the SAME tenant AND branch as the reservation — no
    // branchId rewrite is needed (and must NOT be allowed, lest a foreign
    // branchId leak in). This also keeps the overlap query (which already
    // filters by branchScope) accurate.
    if (dto.tableId && dto.tableId !== reservation.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, ...branchScope(scope) },
      });
      if (!table) {
        throw new NotFoundException("Table not found");
      }
      // Keep guestCount within the new table's capacity, using the effective
      // guest count (incoming dto value, else the existing row).
      const effectiveGuestCount = dto.guestCount ?? reservation.guestCount;
      if (effectiveGuestCount > table.capacity) {
        throw new BadRequestException(`Table capacity is ${table.capacity}`);
      }
    }

    const data: any = { ...dto };
    if (dto.date) {
      data.date = new Date(dto.date);
    }

    // Check table time overlap if relevant fields are changing
    const effectiveTableId = dto.tableId ?? reservation.tableId;
    const effectiveDate = dto.date ?? reservation.date;
    const effectiveStartTime = dto.startTime ?? reservation.startTime;
    const effectiveEndTime = dto.endTime ?? reservation.endTime;

    const needsOverlapCheck =
      !!effectiveTableId &&
      (dto.tableId !== undefined ||
        dto.date !== undefined ||
        dto.startTime !== undefined ||
        dto.endTime !== undefined);

    // Serializable so the overlap-check + update is atomic — mirrors
    // createPublicReservation. Without it two concurrent PATCHes onto the same
    // table/time both read "no conflict" and both commit (double-booking).
    // Retry on the 40001/P2034 serialization failure a conflict raises.
    const MAX_RETRIES = 5;
    let lastErr: unknown;
    let result: any;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        result = await this.prisma.$transaction(
          async (tx) => {
            if (needsOverlapCheck) {
              const existingTableReservations = await tx.reservation.findMany({
                where: {
                  ...branchScope(scope),
                  tableId: effectiveTableId,
                  date: new Date(
                    effectiveDate instanceof Date
                      ? effectiveDate.toISOString().split("T")[0]
                      : effectiveDate,
                  ),
                  status: {
                    in: [
                      ReservationStatus.PENDING,
                      ReservationStatus.CONFIRMED,
                      ReservationStatus.SEATED,
                    ],
                  },
                  id: { not: id },
                },
              });

              const requestStart = timeToMinutes(effectiveStartTime);
              const requestEnd = timeToMinutes(effectiveEndTime);

              for (const res of existingTableReservations) {
                const resStart = timeToMinutes(res.startTime);
                const resEnd = timeToMinutes(res.endTime);
                if (requestStart < resEnd && requestEnd > resStart) {
                  throw new BadRequestException(
                    "This table is already reserved for the selected time period",
                  );
                }
              }
            }

            return tx.reservation.update({
              where: { id: reservation.id },
              data,
              include: { table: true },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2034"
        ) {
          lastErr = err;
          continue; // serialization conflict — retry with a fresh read
        }
        throw err;
      }
    }
    if (!result) throw lastErr;

    // If the table was REASSIGNED, the OLD table may still carry this
    // reservation's auto-hold (status=RESERVED, reservationHoldId=this id) set
    // by the scheduler in the pre-window — the row now points at the NEW table,
    // so the release cron (which frees the table the hold points to) never
    // touches the old one and it is stranded RESERVED. Release the OLD table's
    // hold here and refresh the floor map.
    if (dto.tableId !== undefined && dto.tableId !== reservation.tableId) {
      await this.releaseHoldIfOwned(reservation.id, reservation.tableId);
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }
    return result;
  }

  async confirm(scope: BranchScope, id: string, userId: string) {
    const reservation = await this.findOne(scope, id);

    if (reservation.status !== ReservationStatus.PENDING) {
      throw new BadRequestException(
        "Only pending reservations can be confirmed",
      );
    }

    // Status-guarded claim: a concurrent reject/cancel that already moved the
    // row out of PENDING makes this a no-op (count 0) → 409, instead of a
    // read-then-write that would silently resurrect a rejected booking as
    // CONFIRMED.
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        ...branchScope(scope),
        status: ReservationStatus.PENDING,
      },
      data: {
        status: ReservationStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedById: userId,
      },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }
    const updated = await this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, ...branchScope(scope) },
      include: { table: true },
    });

    // Notify admins about confirmation
    try {
      await this.notificationsService.notifyAdmins(scope.tenantId, {
        title: "Reservation Confirmed",
        message: `${reservation.customerName}'s reservation for ${reservation.startTime} has been confirmed`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: "reservation_confirmed" },
      });
    } catch (e) {
      this.logger.error(
        `Failed to send confirmation notification: ${e.message}`,
      );
    }

    // Notify customer (email-first, SMS-fallback).
    const dateStr =
      reservation.date instanceof Date
        ? reservation.date.toISOString().split("T")[0]
        : String(reservation.date);
    this.notifyCustomer(scope.tenantId, "confirmed", {
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      date: dateStr,
      startTime: reservation.startTime,
      reservationNumber: reservation.reservationNumber,
    });

    return updated;
  }

  async reject(scope: BranchScope, id: string, rejectionReason?: string) {
    const reservation = await this.findOne(scope, id);

    if (
      ![ReservationStatus.PENDING, ReservationStatus.CONFIRMED].includes(
        reservation.status as ReservationStatus,
      )
    ) {
      throw new BadRequestException("This reservation cannot be rejected");
    }

    // Status-guarded claim first, so a concurrent confirm/seat/cancel can't be
    // clobbered (count 0 → 409). Only the winner then frees the table.
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        ...branchScope(scope),
        status: {
          in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED],
        },
      },
      data: { status: ReservationStatus.REJECTED, rejectionReason },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }

    // If the scheduler already auto-held the table for this reservation
    // (CONFIRMED rejections within the 30-min window), release it now
    // so a walk-in can use the table immediately.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);
    if (reservation.tableId) {
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }

    const updated = await this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, ...branchScope(scope) },
      include: { table: true },
    });

    // Notify admins about rejection
    try {
      await this.notificationsService.notifyAdmins(scope.tenantId, {
        title: "Reservation Rejected",
        message: `${reservation.customerName}'s reservation for ${reservation.startTime} has been rejected`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: "reservation_rejected" },
      });
    } catch (e) {
      this.logger.error(`Failed to send rejection notification: ${e.message}`);
    }

    // Notify customer (email-first, SMS-fallback). reservationNumber
    // is required by the email template even though the legacy SMS
    // string doesn't use it; passing both keeps both channels happy.
    const rejectDateStr =
      reservation.date instanceof Date
        ? reservation.date.toISOString().split("T")[0]
        : String(reservation.date);
    this.notifyCustomer(scope.tenantId, "rejected", {
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      date: rejectDateStr,
      startTime: reservation.startTime,
      reservationNumber: reservation.reservationNumber,
      reason: rejectionReason,
    });

    return updated;
  }

  async seat(scope: BranchScope, id: string) {
    const reservation = await this.findOne(scope, id);

    if (reservation.status !== ReservationStatus.CONFIRMED) {
      throw new BadRequestException(
        "Only confirmed reservations can be seated",
      );
    }

    // Status-guarded claim FIRST: only the caller that still sees CONFIRMED
    // wins (count 1); a concurrent cancel/seat makes this a no-op → 409. We
    // claim before touching the table so a loser never flips it to OCCUPIED.
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        ...branchScope(scope),
        status: ReservationStatus.CONFIRMED,
      },
      data: { status: ReservationStatus.SEATED, seatedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }

    // Occupy the assigned table — but only if it is AVAILABLE or held for THIS
    // reservation. The OR/status guard prevents stealing a table actively held
    // or occupied by a DIFFERENT reservation (the prior unconditional flip
    // stomped a sister hold). Branch-scope is the B41-B45 IDOR guard.
    if (reservation.tableId) {
      await this.prisma.table.updateMany({
        where: {
          id: reservation.tableId,
          ...branchScope(scope),
          status: { in: ["AVAILABLE", "RESERVED"] },
          OR: [
            { reservationHoldId: null },
            { reservationHoldId: reservation.id },
          ],
        },
        data: { status: "OCCUPIED", reservationHoldId: null },
      });
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }

    return this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, ...branchScope(scope) },
      include: { table: true },
    });
  }

  /**
   * Drop the auto-RESERVED hold (if any) that this reservation owns
   * on its assigned table, returning the table to AVAILABLE. Called
   * from terminal transitions (reject / no-show / cancel) so the table
   * is freed for walk-ins or other reservations immediately rather
   * than waiting for the release-holds cron.
   *
   * Filter on `reservationHoldId` ensures we only revert tables we
   * actually hold — manually-RESERVED tables (admin lock) keep their
   * status, and tables flipped to OCCUPIED in the meantime aren't
   * stomped.
   */
  private async releaseHoldIfOwned(
    reservationId: string,
    tableId: string | null,
  ) {
    if (!tableId) return;
    await this.prisma.table.updateMany({
      where: {
        id: tableId,
        reservationHoldId: reservationId,
      },
      data: {
        status: "AVAILABLE",
        reservationHoldId: null,
      },
    });
  }

  async complete(scope: BranchScope, id: string) {
    const reservation = await this.findOne(scope, id);

    if (reservation.status !== ReservationStatus.SEATED) {
      throw new BadRequestException(
        "Only seated reservations can be completed",
      );
    }

    // Status-guarded claim first (count 0 → 409 on a concurrent transition),
    // then free the table — only the winner touches it.
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        ...branchScope(scope),
        status: ReservationStatus.SEATED,
      },
      data: {
        status: ReservationStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }

    // Free up the table. SEATED reservations already had any hold
    // cleared in seat(), so the explicit hold revert in releaseHoldIfOwned
    // would be a no-op here — we just flip the status directly.
    // Compound WHERE — IDOR guard (B41-B45 pattern), now branch-scoped.
    if (reservation.tableId) {
      await this.prisma.table.updateMany({
        where: { id: reservation.tableId, ...branchScope(scope) },
        data: { status: "AVAILABLE", reservationHoldId: null },
      });
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }

    return this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, ...branchScope(scope) },
      include: { table: true },
    });
  }

  async noShow(scope: BranchScope, id: string) {
    const reservation = await this.findOne(scope, id);

    if (
      ![ReservationStatus.CONFIRMED, ReservationStatus.PENDING].includes(
        reservation.status as ReservationStatus,
      )
    ) {
      throw new BadRequestException(
        "This reservation cannot be marked as no-show",
      );
    }

    // Status-guarded claim first so a concurrent seat/cancel can't be
    // clobbered (count 0 → 409); only the winner then releases the hold.
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        ...branchScope(scope),
        status: {
          in: [ReservationStatus.CONFIRMED, ReservationStatus.PENDING],
        },
      },
      data: { status: ReservationStatus.NO_SHOW },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }

    // Release any auto-hold so the table is back to AVAILABLE for the
    // next sitting / walk-in. release-holds cron would catch this too
    // but doing it inline keeps the staff-visible state in sync with
    // the action they just took.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);
    if (reservation.tableId) {
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }

    return this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, ...branchScope(scope) },
      include: { table: true },
    });
  }

  async cancel(scope: BranchScope, id: string, cancelledBy?: string) {
    const reservation = await this.findOne(scope, id);

    if (
      [
        ReservationStatus.COMPLETED,
        ReservationStatus.CANCELLED,
        ReservationStatus.NO_SHOW,
      ].includes(reservation.status as ReservationStatus)
    ) {
      throw new BadRequestException("This reservation cannot be cancelled");
    }

    // Status-guarded claim first (count 0 → 409 if a concurrent
    // seat/complete/no-show/cancel already moved the row), so the cancel can't
    // clobber another transition and only the winner frees the table.
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        ...branchScope(scope),
        status: {
          in: [
            ReservationStatus.PENDING,
            ReservationStatus.CONFIRMED,
            ReservationStatus.SEATED,
          ],
        },
      },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy,
      },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }

    // Free up the table if currently SEATED (explicit AVAILABLE flip)
    // OR if the scheduler had auto-held it for this reservation
    // (PENDING/CONFIRMED inside the 30-min window). The two paths
    // converge — both end with status=AVAILABLE, reservationHoldId=null.
    // Compound WHERE on the SEATED branch — IDOR guard (B41-B45);
    // releaseHoldIfOwned already runs an updateMany filtered by
    // reservationHoldId so it's tenant-safe by construction.
    if (
      reservation.status === ReservationStatus.SEATED &&
      reservation.tableId
    ) {
      await this.prisma.table.updateMany({
        where: { id: reservation.tableId, ...branchScope(scope) },
        data: { status: "AVAILABLE", reservationHoldId: null },
      });
    } else {
      await this.releaseHoldIfOwned(reservation.id, reservation.tableId);
    }
    if (reservation.tableId) {
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }

    const cancelled = await this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, ...branchScope(scope) },
      include: { table: true },
    });

    // Notify customer (email-first, SMS-fallback).
    const cancelDateStr =
      reservation.date instanceof Date
        ? reservation.date.toISOString().split("T")[0]
        : String(reservation.date);
    this.notifyCustomer(scope.tenantId, "cancelled", {
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      date: cancelDateStr,
      startTime: reservation.startTime,
      reservationNumber: reservation.reservationNumber,
    });

    return cancelled;
  }

  async cancelPublic(
    tenantId: string,
    id: string,
    proof: { customerPhone: string; reservationNumber: string },
  ) {
    await this.validateTenant(tenantId);

    const matched = await this.prisma.reservation.findFirst({
      where: {
        id,
        tenantId,
        customerPhone: proof.customerPhone,
        reservationNumber: proof.reservationNumber,
      },
    });
    if (!matched) {
      throw new NotFoundException("Reservation not found");
    }

    // Customer-facing cancel path — no BranchScope (anonymous caller).
    // The (id, tenantId, phone, reservationNumber) compound above
    // already proves the customer owns this row; re-loading by
    // (id, tenantId) is sufficient.
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, tenantId },
      include: { table: true },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }
    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.allowCancellation) {
      throw new BadRequestException("Cancellation is not allowed");
    }

    if (
      ![ReservationStatus.PENDING, ReservationStatus.CONFIRMED].includes(
        reservation.status as ReservationStatus,
      )
    ) {
      throw new BadRequestException("This reservation cannot be cancelled");
    }

    // Check cancellation deadline
    const reservationDateTime = new Date(reservation.date);
    const [hours, minutes] = reservation.startTime.split(":").map(Number);
    reservationDateTime.setHours(hours, minutes, 0, 0);

    const deadlineMs = settings.cancellationDeadline * 60 * 1000;
    const now = new Date();

    if (reservationDateTime.getTime() - now.getTime() < deadlineMs) {
      throw new BadRequestException("Cancellation deadline has passed");
    }

    // Status-guarded claim first (count 0 → 409) so a customer cancel racing a
    // staff confirm/seat/cancel can't clobber it; only the winner frees the
    // table. Scoped by tenantId (anonymous path — ownership already proven by
    // the phone + reservationNumber match above).
    const claim = await this.prisma.reservation.updateMany({
      where: {
        id: reservation.id,
        tenantId,
        status: {
          in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED],
        },
      },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: "CUSTOMER",
      },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        "Reservation was already updated; please refresh",
      );
    }

    // Release the table-hold if the scheduler already auto-RESERVED
    // this row's assigned table — staff/customers shouldn't have to
    // wait for the next cron tick for the table to free up.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);
    if (reservation.tableId) {
      this.emitFloorRefresh(tenantId, reservation.branchId);
    }

    const updated = await this.prisma.reservation.findFirstOrThrow({
      where: { id: reservation.id, tenantId },
      include: { table: true },
    });

    // Notify admins about customer cancellation
    try {
      await this.notificationsService.notifyAdmins(tenantId, {
        title: "Reservation Cancelled by Customer",
        message: `${reservation.customerName} cancelled their reservation for ${reservation.startTime}`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: "reservation_cancelled" },
      });
    } catch (e) {
      this.logger.error(
        `Failed to send cancellation notification: ${e.message}`,
      );
    }

    // Notify customer (email-first, SMS-fallback).
    const publicCancelDateStr =
      reservation.date instanceof Date
        ? reservation.date.toISOString().split("T")[0]
        : String(reservation.date);
    this.notifyCustomer(tenantId, "cancelled", {
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      date: publicCancelDateStr,
      startTime: reservation.startTime,
      reservationNumber: reservation.reservationNumber,
    });

    return updated;
  }

  async remove(scope: BranchScope, id: string) {
    const reservation = await this.findOne(scope, id);

    // Release any auto-RESERVED hold this reservation owns BEFORE deleting.
    // The Table.reservationHoldId FK is onDelete:SetNull, which nulls the
    // pointer but leaves Table.status=RESERVED — and then NEITHER cron can
    // reclaim it (release-holds filters reservationHoldId NOT NULL; auto-hold
    // filters status=AVAILABLE), so the table is stranded RESERVED forever.
    // Mirror the sibling terminal transitions (reject/cancel/noShow), which
    // all release the hold first.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);
    if (reservation.tableId) {
      this.emitFloorRefresh(scope.tenantId, scope.branchId);
    }

    return this.prisma.reservation.delete({
      where: { id: reservation.id },
    });
  }

  async lookupReservation(
    tenantId: string,
    phone: string,
    reservationNumber: string,
  ) {
    await this.validateTenant(tenantId);

    const reservation = await this.prisma.reservation.findFirst({
      where: {
        tenantId,
        customerPhone: phone,
        reservationNumber,
      },
      include: { table: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }

    return reservation;
  }
}
