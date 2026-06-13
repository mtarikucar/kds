import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { NotificationType } from "../../notifications/dto/create-notification.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { UpdateReservationDto } from "../dto/update-reservation.dto";
import { ReservationQueryDto } from "../dto/reservation-query.dto";
import { ReservationSettingsService } from "./reservation-settings.service";
import { ReservationStatus } from "../constants/reservation-status.enum";
import { ReservationNotificationService } from "./reservation-notification.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

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
  ) {}

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
    const lastReservation = await client.reservation.findFirst({
      where: {
        tenantId,
        reservationNumber: { startsWith: prefix },
      },
      orderBy: { reservationNumber: "desc" },
    });

    let nextNum = 1;
    if (lastReservation) {
      const lastNum = parseInt(
        lastReservation.reservationNumber.split("-").pop() || "0",
        10,
      );
      // Defensive: parseInt returns NaN for empty/garbled strings;
      // `NaN + 1 === NaN` would pad to the literal "NaN" and collide
      // forever. Treat an unparseable tail as "start a new sequence".
      nextNum = Number.isFinite(lastNum) ? lastNum + 1 : 1;
    }

    return `${prefix}-${String(nextNum).padStart(3, "0")}`;
  }

  /**
   * Resolve the single branch a PUBLIC (@SkipBranchScope / anonymous)
   * reservation flow should operate on. There is no @CurrentScope on the
   * guest-facing endpoints, so the branch is derived rather than asserted.
   *
   *  - branchId provided  → validate it exists, belongs to THIS tenant, and
   *    is active. A foreign / archived / unknown id is rejected so a guest
   *    can't enumerate another tenant's (or an archived) branch.
   *  - branchId omitted    → fall back to the tenant's oldest ACTIVE branch
   *    (the "Main" branch created at bootstrap). `status: 'active'` excludes
   *    archived branches so a freshly-archived "Main" doesn't trap bookings.
   *
   * This is the ONE place the public branch resolution lives — both the
   * availability reads (getAvailableTables / getAvailableSlots) and the
   * createPublicReservation walk-in fallback route through it (DRY), so
   * what the guest sees as "available" matches the branch the booking
   * actually lands on.
   */
  private async resolvePublicBranchId(
    tenantId: string,
    branchId?: string,
  ): Promise<string> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId, status: "active" },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException("Branch not found");
      }
      return branch.id;
    }

    const defaultBranch = await this.prisma.branch.findFirst({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!defaultBranch) {
      throw new BadRequestException("No branch configured for this tenant");
    }
    return defaultBranch.id;
  }

  async createPublicReservation(tenantId: string, dto: CreateReservationDto) {
    await this.validateTenant(tenantId);

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
    // v3.0.1 audit follow-up: the no-branchId fallback dumps every
    // anonymous walk-in onto whichever branch was created first, which is
    // surprising for chains with several locations. The DTO doesn't yet
    // carry a branch selector; once it does, resolvePublicBranchId already
    // honors it (no further change here). Track in
    // backlog/reservations-multi-branch-public.md.
    if (!resolvedBranchId) {
      resolvedBranchId = await this.resolvePublicBranchId(
        tenantId,
        (dto as any).branchId,
      );
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

              const requestStart = this.timeToMinutes(dto.startTime);
              const requestEnd = this.timeToMinutes(dto.endTime);

              for (const res of existingTableReservations) {
                const resStart = this.timeToMinutes(res.startTime);
                const resEnd = this.timeToMinutes(res.endTime);
                if (requestStart < resEnd && requestEnd > resStart) {
                  throw new BadRequestException(
                    "This table is already reserved for the selected time period",
                  );
                }
              }
            }

            // Check slot availability inside transaction
            if (settings.maxReservationsPerSlot) {
              const existingCount = await tx.reservation.count({
                where: {
                  tenantId,
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
    this.reservationNotificationService.notify(tenantId, "created", {
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
    const targetDate = date ? new Date(date) : new Date();
    // Normalize to date only
    const startOfDay = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
    );

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

    const data: any = { ...dto };
    if (dto.date) {
      data.date = new Date(dto.date);
    }

    // Check table time overlap if relevant fields are changing
    const effectiveTableId = dto.tableId ?? reservation.tableId;
    const effectiveDate = dto.date ?? reservation.date;
    const effectiveStartTime = dto.startTime ?? reservation.startTime;
    const effectiveEndTime = dto.endTime ?? reservation.endTime;

    if (
      effectiveTableId &&
      (dto.tableId !== undefined ||
        dto.date !== undefined ||
        dto.startTime !== undefined ||
        dto.endTime !== undefined)
    ) {
      const existingTableReservations = await this.prisma.reservation.findMany({
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

      const requestStart = this.timeToMinutes(effectiveStartTime);
      const requestEnd = this.timeToMinutes(effectiveEndTime);

      for (const res of existingTableReservations) {
        const resStart = this.timeToMinutes(res.startTime);
        const resEnd = this.timeToMinutes(res.endTime);
        if (requestStart < resEnd && requestEnd > resStart) {
          throw new BadRequestException(
            "This table is already reserved for the selected time period",
          );
        }
      }
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data,
      include: { table: true },
    });
  }

  async confirm(scope: BranchScope, id: string, userId: string) {
    const reservation = await this.findOne(scope, id);

    if (reservation.status !== ReservationStatus.PENDING) {
      throw new BadRequestException(
        "Only pending reservations can be confirmed",
      );
    }

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedById: userId,
      },
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
    this.reservationNotificationService.notify(scope.tenantId, "confirmed", {
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

    // If the scheduler already auto-held the table for this reservation
    // (CONFIRMED rejections within the 30-min window), release it now
    // so a walk-in can use the table immediately.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.REJECTED,
        rejectionReason,
      },
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
    this.reservationNotificationService.notify(scope.tenantId, "rejected", {
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

    const updateData: any = {
      status: ReservationStatus.SEATED,
      seatedAt: new Date(),
    };

    // Update table status if assigned: clear any auto-hold this row
    // owned (scheduler may have set status=RESERVED + reservationHoldId
    // in the 30-min pre-window) and flip to OCCUPIED in the same write.
    // Compound WHERE — IDOR guard (B41-B45 pattern). Branch-scope on
    // the table write so a manager can't cross-flip a sister-branch
    // table even via a coercion of tableId.
    if (reservation.tableId) {
      await this.prisma.table.updateMany({
        where: { id: reservation.tableId, ...branchScope(scope) },
        data: { status: "OCCUPIED", reservationHoldId: null },
      });
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: updateData,
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

    // Free up the table. SEATED reservations already had any hold
    // cleared in seat(), so the explicit hold revert in releaseHoldIfOwned
    // would be a no-op here — we just flip the status directly.
    // Compound WHERE — IDOR guard (B41-B45 pattern), now branch-scoped.
    if (reservation.tableId) {
      await this.prisma.table.updateMany({
        where: { id: reservation.tableId, ...branchScope(scope) },
        data: { status: "AVAILABLE", reservationHoldId: null },
      });
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.COMPLETED,
        completedAt: new Date(),
      },
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

    // Release any auto-hold so the table is back to AVAILABLE for the
    // next sitting / walk-in. release-holds cron would catch this too
    // but doing it inline keeps the staff-visible state in sync with
    // the action they just took.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.NO_SHOW },
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

    const cancelled = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy,
      },
      include: { table: true },
    });

    // Notify customer (email-first, SMS-fallback).
    const cancelDateStr =
      reservation.date instanceof Date
        ? reservation.date.toISOString().split("T")[0]
        : String(reservation.date);
    this.reservationNotificationService.notify(scope.tenantId, "cancelled", {
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

    // Release the table-hold if the scheduler already auto-RESERVED
    // this row's assigned table — staff/customers shouldn't have to
    // wait for the next cron tick for the table to free up.
    await this.releaseHoldIfOwned(reservation.id, reservation.tableId);

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: "CUSTOMER",
      },
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
    this.reservationNotificationService.notify(tenantId, "cancelled", {
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

    return this.prisma.reservation.delete({
      where: { id: reservation.id },
    });
  }

  async getAvailableSlots(
    tenantId: string,
    date: string,
    guestCount?: number,
    branchId?: string,
  ) {
    await this.validateTenant(tenantId);

    // PUBLIC read — no @CurrentScope. Resolve the single branch this
    // availability view is for (explicit branchId when valid, else the
    // tenant's oldest-active branch) so we don't leak slot occupancy
    // aggregated across every branch of a multi-branch tenant.
    const resolvedBranchId = await this.resolvePublicBranchId(
      tenantId,
      branchId,
    );

    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.isEnabled) {
      return [];
    }

    const dayOfWeek = new Date(date)
      .toLocaleDateString("en-US", { weekday: "long" })
      .toLowerCase();
    let openTime = "09:00";
    let closeTime = "22:00";
    let isClosed = false;

    if (settings.operatingHours) {
      const hours = settings.operatingHours as any;
      if (hours[dayOfWeek]) {
        if (hours[dayOfWeek].closed) {
          isClosed = true;
        } else {
          openTime = hours[dayOfWeek].open || openTime;
          closeTime = hours[dayOfWeek].close || closeTime;
        }
      }
    }

    if (isClosed) {
      return [];
    }

    // Generate time slots
    const slots: { time: string; available: boolean }[] = [];
    const interval = settings.timeSlotInterval;
    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);

    let currentMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    // Get existing reservations for this date (branch-scoped so slot
    // occupancy reflects only the resolved branch, not the whole tenant).
    const existingReservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        branchId: resolvedBranchId,
        date: new Date(date),
        status: {
          in: [
            ReservationStatus.PENDING,
            ReservationStatus.CONFIRMED,
            ReservationStatus.SEATED,
          ],
        },
      },
    });

    while (currentMinutes + settings.defaultDuration <= closeMinutes) {
      const h = Math.floor(currentMinutes / 60);
      const m = currentMinutes % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

      let available = true;

      // Check min advance booking
      const now = new Date();
      const slotDateTime = new Date(date);
      slotDateTime.setHours(h, m, 0, 0);
      if (
        slotDateTime.getTime() - now.getTime() <
        settings.minAdvanceBooking * 60 * 1000
      ) {
        available = false;
      }

      // Check max reservations per slot
      if (available && settings.maxReservationsPerSlot) {
        const slotReservations = existingReservations.filter(
          (r) => r.startTime === timeStr,
        );
        if (slotReservations.length >= settings.maxReservationsPerSlot) {
          available = false;
        }
      }

      slots.push({ time: timeStr, available });
      currentMinutes += interval;
    }

    return slots;
  }

  async getAvailableTables(
    tenantId: string,
    date: string,
    startTime: string,
    endTime: string,
    guestCount?: number,
    branchId?: string,
  ) {
    await this.validateTenant(tenantId);

    // PUBLIC read — no @CurrentScope. Resolve the single branch this
    // availability view is for (explicit branchId when valid, else the
    // tenant's oldest-active branch) BEFORE any read, so an anonymous
    // caller of a multi-branch tenant sees exactly the tables the booking
    // will target — not every branch's tables.
    const resolvedBranchId = await this.resolvePublicBranchId(
      tenantId,
      branchId,
    );

    // Get all tables for the resolved branch
    const tables = await this.prisma.table.findMany({
      where: { tenantId, branchId: resolvedBranchId },
      orderBy: [{ section: "asc" }, { number: "asc" }],
    });

    // Get reservations that overlap with the requested time (same branch)
    const existingReservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        branchId: resolvedBranchId,
        date: new Date(date),
        status: {
          in: [
            ReservationStatus.PENDING,
            ReservationStatus.CONFIRMED,
            ReservationStatus.SEATED,
          ],
        },
        tableId: { not: null },
      },
    });

    // Filter out tables that are already reserved during the requested time
    const requestStart = this.timeToMinutes(startTime);
    const requestEnd = this.timeToMinutes(endTime);

    const availableTables = tables.filter((table) => {
      // Check capacity
      if (guestCount && table.capacity < guestCount) {
        return false;
      }

      // Check for overlapping reservations
      const tableReservations = existingReservations.filter(
        (r) => r.tableId === table.id,
      );
      for (const res of tableReservations) {
        const resStart = this.timeToMinutes(res.startTime);
        const resEnd = this.timeToMinutes(res.endTime);
        if (requestStart < resEnd && requestEnd > resStart) {
          return false; // Overlap
        }
      }

      return true;
    });

    return availableTables.map((t) => ({
      id: t.id,
      number: t.number,
      capacity: t.capacity,
      section: t.section,
    }));
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

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }
}
