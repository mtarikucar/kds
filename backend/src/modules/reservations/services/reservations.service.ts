import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/dto/create-notification.dto';
import { CreateReservationDto } from '../dto/create-reservation.dto';
import { UpdateReservationDto } from '../dto/update-reservation.dto';
import { ReservationQueryDto } from '../dto/reservation-query.dto';
import { ReservationSettingsService } from './reservation-settings.service';
import { ReservationStatus } from '../constants/reservation-status.enum';
import { PlanFeature } from '../../../common/constants/subscription.enum';

// Statuses that hold a reservation slot / seat a table. Anything not in this
// list is effectively "released" (CANCELLED, REJECTED, NO_SHOW, COMPLETED).
const ACTIVE_RESERVATION_STATUSES = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.SEATED,
] as const;

const PUBLIC_LOOKUP_FIELDS = {
  id: true,
  reservationNumber: true,
  date: true,
  startTime: true,
  endTime: true,
  guestCount: true,
  customerName: true,
  customerPhone: true,
  status: true,
  table: { select: { id: true, number: true, section: true } },
  createdAt: true,
} as const;

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private settingsService: ReservationSettingsService,
  ) {}

  private async validateTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('Tenant is not active');
    }
    return tenant;
  }

  /**
   * Ensure the tenant's current plan allows the reservation system. The
   * PlanFeatureGuard short-circuits on @Public routes, so the public booking
   * endpoint needs an explicit check or free-tier tenants can silently
   * accept bookings against their QR menu subdomain.
   */
  private async assertReservationsFeature(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'ACTIVE') throw new ForbiddenException('Tenant is not active');
    if (!tenant.currentPlan) {
      throw new ForbiddenException('Reservation system is not available on this plan');
    }
    const overrides = tenant.featureOverrides as Record<string, boolean> | null;
    const planValue = (tenant.currentPlan as any)[PlanFeature.RESERVATION_SYSTEM];
    const enabled = overrides?.[PlanFeature.RESERVATION_SYSTEM] ?? planValue;
    if (!enabled) {
      throw new ForbiddenException('Reservation system is not available on this plan');
    }
  }

  private async generateReservationNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    date: string,
  ): Promise<string> {
    const dateStr = date.replace(/-/g, '').substring(0, 8);
    const prefix = `R-${dateStr}`;
    const last = await tx.reservation.findFirst({
      where: { tenantId, reservationNumber: { startsWith: prefix } },
      orderBy: { reservationNumber: 'desc' },
      select: { reservationNumber: true },
    });
    let nextNum = 1;
    if (last) {
      const parsed = parseInt(last.reservationNumber.split('-').pop() || '0', 10);
      if (!Number.isNaN(parsed)) nextNum = parsed + 1;
    }
    return `${prefix}-${String(nextNum).padStart(3, '0')}`;
  }

  async createPublicReservation(tenantId: string, dto: CreateReservationDto) {
    await this.assertReservationsFeature(tenantId);

    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.isEnabled) {
      throw new BadRequestException('Reservation system is not enabled');
    }

    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reservationDate = new Date(dto.date);
    reservationDate.setHours(0, 0, 0, 0);
    if (reservationDate < today) {
      throw new BadRequestException('Cannot book past dates');
    }

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

    if (settings.minAdvanceBooking) {
      const now = new Date();
      const [h, m] = dto.startTime.split(':').map(Number);
      const slotDateTime = new Date(dto.date);
      slotDateTime.setHours(h, m, 0, 0);
      if (slotDateTime.getTime() - now.getTime() < settings.minAdvanceBooking * 60 * 1000) {
        throw new BadRequestException(
          'Reservation time is too soon. Please book further in advance.',
        );
      }
    }

    if (settings.operatingHours) {
      const dayOfWeek = new Date(dto.date)
        .toLocaleDateString('en-US', { weekday: 'long' })
        .toLowerCase();
      const hours = settings.operatingHours as any;
      if (hours[dayOfWeek]?.closed) {
        throw new BadRequestException('Restaurant is closed on this day');
      }
    }

    if (dto.guestCount > settings.maxGuestsPerReservation) {
      throw new BadRequestException(
        `Maximum guests per reservation is ${settings.maxGuestsPerReservation}`,
      );
    }

    const status = settings.requireApproval
      ? ReservationStatus.PENDING
      : ReservationStatus.CONFIRMED;

    // Wrap the overlap check + insert in Serializable isolation so two
    // concurrent bookings on the same table/time cannot both pass validation.
    // P2002 on reservationNumber collision (clock + sequence race) is retried
    // up to three times; genuine overlap throws ConflictException which the
    // client can present as "slot just got booked — please pick another".
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (dto.tableId) {
              const table = await tx.table.findFirst({
                where: { id: dto.tableId, tenantId },
                select: { id: true, capacity: true },
              });
              if (!table) {
                throw new NotFoundException('Table not found');
              }
              if (dto.guestCount > table.capacity) {
                throw new BadRequestException(`Table capacity is ${table.capacity}`);
              }

              const overlapping = await tx.reservation.findMany({
                where: {
                  tenantId,
                  tableId: dto.tableId,
                  date: new Date(dto.date),
                  status: { in: [...ACTIVE_RESERVATION_STATUSES] },
                },
                select: { startTime: true, endTime: true },
              });

              const requestStart = this.timeToMinutes(dto.startTime);
              const requestEnd = this.timeToMinutes(dto.endTime);
              for (const r of overlapping) {
                const resStart = this.timeToMinutes(r.startTime);
                const resEnd = this.timeToMinutes(r.endTime);
                if (requestStart < resEnd && requestEnd > resStart) {
                  throw new ConflictException(
                    'This table is already reserved for the selected time period',
                  );
                }
              }
            }

            if (settings.maxReservationsPerSlot) {
              const existingCount = await tx.reservation.count({
                where: {
                  tenantId,
                  date: new Date(dto.date),
                  startTime: dto.startTime,
                  status: { in: [...ACTIVE_RESERVATION_STATUSES] },
                },
              });
              if (existingCount >= settings.maxReservationsPerSlot) {
                throw new ConflictException('This time slot is fully booked');
              }
            }

            const duplicate = await tx.reservation.findFirst({
              where: {
                tenantId,
                customerPhone: dto.customerPhone,
                date: new Date(dto.date),
                startTime: dto.startTime,
                status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
              },
              select: { id: true },
            });
            if (duplicate) {
              throw new ConflictException('You already have a reservation for this time slot');
            }

            const reservationNumber = await this.generateReservationNumber(
              tx,
              tenantId,
              dto.date,
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
                status,
                confirmedAt: settings.requireApproval ? undefined : new Date(),
              },
              include: { table: { select: { id: true, number: true, section: true } } },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ).then((reservation) => {
          // Fire-and-forget notification outside the transaction
          this.notificationsService
            .notifyAdmins(tenantId, {
              title: 'New Reservation',
              message: `${dto.customerName} - ${dto.guestCount} guests on ${dto.date} at ${dto.startTime}`,
              type: NotificationType.RESERVATION,
              data: { reservationId: reservation.id, type: 'new_reservation' },
            })
            .catch((e) =>
              this.logger.warn(`Reservation notification failed: ${e.message}`),
            );
          return reservation;
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          Array.isArray((err.meta as any)?.target) &&
          (err.meta as any).target.includes('reservationNumber')
        ) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    this.logger.error(`Reservation number generation exhausted retries: ${lastError}`);
    throw new ConflictException('Could not allocate a reservation number — please retry');
  }

  async findAll(tenantId: string, query: ReservationQueryDto) {
    const where: Prisma.ReservationWhereInput = { tenantId };

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
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { customerPhone: { contains: query.search, mode: 'insensitive' } },
        { reservationNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = Math.min(query.limit || 50, 100);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        include: { table: true },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.reservation.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, tenantId },
      include: { table: true },
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  async getStats(tenantId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
    );

    const reservations = await this.prisma.reservation.findMany({
      where: { tenantId, date: startOfDay },
      select: { status: true },
    });

    return {
      total: reservations.length,
      pending: reservations.filter((r) => r.status === ReservationStatus.PENDING).length,
      confirmed: reservations.filter((r) => r.status === ReservationStatus.CONFIRMED).length,
      seated: reservations.filter((r) => r.status === ReservationStatus.SEATED).length,
      completed: reservations.filter((r) => r.status === ReservationStatus.COMPLETED).length,
      cancelled: reservations.filter((r) => r.status === ReservationStatus.CANCELLED).length,
      noShow: reservations.filter((r) => r.status === ReservationStatus.NO_SHOW).length,
      rejected: reservations.filter((r) => r.status === ReservationStatus.REJECTED).length,
    };
  }

  async update(id: string, tenantId: string, dto: UpdateReservationDto) {
    const reservation = await this.findOne(id, tenantId);

    const effectiveTableId = dto.tableId ?? reservation.tableId;
    const effectiveDate = dto.date ?? reservation.date.toISOString().split('T')[0];
    const effectiveStartTime = dto.startTime ?? reservation.startTime;
    const effectiveEndTime = dto.endTime ?? reservation.endTime;

    if (effectiveEndTime <= effectiveStartTime) {
      throw new BadRequestException('End time must be after start time');
    }

    const updated = await this.prisma.$transaction(
      async (tx) => {
        if (
          effectiveTableId &&
          (dto.tableId !== undefined ||
            dto.date !== undefined ||
            dto.startTime !== undefined ||
            dto.endTime !== undefined)
        ) {
          const existing = await tx.reservation.findMany({
            where: {
              tenantId,
              tableId: effectiveTableId,
              date: new Date(effectiveDate),
              status: { in: [...ACTIVE_RESERVATION_STATUSES] },
              id: { not: id },
            },
            select: { startTime: true, endTime: true },
          });

          const requestStart = this.timeToMinutes(effectiveStartTime);
          const requestEnd = this.timeToMinutes(effectiveEndTime);
          for (const r of existing) {
            const resStart = this.timeToMinutes(r.startTime);
            const resEnd = this.timeToMinutes(r.endTime);
            if (requestStart < resEnd && requestEnd > resStart) {
              throw new ConflictException(
                'This table is already reserved for the selected time period',
              );
            }
          }
        }

        const data: Prisma.ReservationUpdateInput = {
          date: dto.date !== undefined ? new Date(dto.date) : undefined,
          startTime: dto.startTime,
          endTime: dto.endTime,
          guestCount: dto.guestCount,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          notes: dto.notes,
          adminNotes: dto.adminNotes,
          table:
            dto.tableId !== undefined
              ? dto.tableId === null
                ? { disconnect: true }
                : { connect: { id: dto.tableId } }
              : undefined,
        };

        const result = await tx.reservation.updateMany({
          where: { id, tenantId },
          data: {
            ...(dto.date !== undefined && { date: new Date(dto.date) }),
            ...(dto.startTime !== undefined && { startTime: dto.startTime }),
            ...(dto.endTime !== undefined && { endTime: dto.endTime }),
            ...(dto.guestCount !== undefined && { guestCount: dto.guestCount }),
            ...(dto.customerName !== undefined && { customerName: dto.customerName }),
            ...(dto.customerPhone !== undefined && { customerPhone: dto.customerPhone }),
            ...(dto.customerEmail !== undefined && { customerEmail: dto.customerEmail }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.adminNotes !== undefined && { adminNotes: dto.adminNotes }),
            ...(dto.tableId !== undefined && { tableId: dto.tableId }),
          },
        });
        if (result.count !== 1) {
          throw new NotFoundException('Reservation not found');
        }

        return tx.reservation.findFirstOrThrow({
          where: { id, tenantId },
          include: { table: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return updated;
  }

  async confirm(id: string, tenantId: string, userId: string) {
    const reservation = await this.findOne(id, tenantId);
    if (reservation.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Only pending reservations can be confirmed');
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

    this.notificationsService
      .notifyAdmins(tenantId, {
        title: 'Reservation Confirmed',
        message: `${reservation.customerName}'s reservation for ${reservation.startTime} has been confirmed`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'reservation_confirmed' },
      })
      .catch((e) => this.logger.warn(`Reservation notification failed: ${e.message}`));

    return updated;
  }

  async reject(id: string, tenantId: string, rejectionReason?: string) {
    const reservation = await this.findOne(id, tenantId);
    if (
      ![ReservationStatus.PENDING, ReservationStatus.CONFIRMED].includes(
        reservation.status as ReservationStatus,
      )
    ) {
      throw new BadRequestException('This reservation cannot be rejected');
    }

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.REJECTED, rejectionReason },
      include: { table: true },
    });

    this.notificationsService
      .notifyAdmins(tenantId, {
        title: 'Reservation Rejected',
        message: `${reservation.customerName}'s reservation for ${reservation.startTime} has been rejected`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'reservation_rejected' },
      })
      .catch((e) => this.logger.warn(`Reservation notification failed: ${e.message}`));

    return updated;
  }

  async seat(id: string, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id, tenantId },
        include: { table: true },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      if (reservation.status !== ReservationStatus.CONFIRMED) {
        throw new BadRequestException('Only confirmed reservations can be seated');
      }

      if (reservation.tableId) {
        // Don't clobber a table already occupied by a different customer.
        // AVAILABLE / RESERVED are fine to flip to OCCUPIED; anything else
        // means POS is using it and this should fail loudly.
        const table = await tx.table.findFirst({
          where: { id: reservation.tableId, tenantId },
          select: { status: true },
        });
        if (!table) {
          throw new BadRequestException('Reserved table no longer exists');
        }
        if (table.status !== 'AVAILABLE' && table.status !== 'RESERVED') {
          throw new ConflictException(
            `Table is currently ${table.status} and cannot be seated`,
          );
        }
        await tx.table.updateMany({
          where: { id: reservation.tableId, tenantId },
          data: { status: 'OCCUPIED' },
        });
      }

      return tx.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.SEATED, seatedAt: new Date() },
        include: { table: true },
      });
    });
  }

  async complete(id: string, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id, tenantId },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      if (reservation.status !== ReservationStatus.SEATED) {
        throw new BadRequestException('Only seated reservations can be completed');
      }

      if (reservation.tableId) {
        await this.freeTableIfUnused(tx, reservation.tableId, tenantId, reservation.id);
      }

      return tx.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.COMPLETED, completedAt: new Date() },
        include: { table: true },
      });
    });
  }

  async noShow(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);
    // Tightened: only CONFIRMED can transition to NO_SHOW. PENDING means the
    // admin never confirmed and should REJECT instead.
    if (reservation.status !== ReservationStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed reservations can be marked as no-show');
    }
    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.NO_SHOW },
      include: { table: true },
    });
  }

  async cancel(id: string, tenantId: string, cancelledBy?: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id, tenantId },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      if (
        [
          ReservationStatus.COMPLETED,
          ReservationStatus.CANCELLED,
          ReservationStatus.NO_SHOW,
        ].includes(reservation.status as ReservationStatus)
      ) {
        throw new BadRequestException('This reservation cannot be cancelled');
      }

      if (reservation.status === ReservationStatus.SEATED && reservation.tableId) {
        await this.freeTableIfUnused(tx, reservation.tableId, tenantId, reservation.id);
      }

      return tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: ReservationStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy,
        },
        include: { table: true },
      });
    });
  }

  async cancelPublic(
    tenantId: string,
    id: string,
    proof: { customerPhone: string; reservationNumber: string },
  ) {
    await this.validateTenant(tenantId);

    const reservation = await this.prisma.reservation.findFirst({
      where: {
        id,
        tenantId,
        customerPhone: proof.customerPhone,
        reservationNumber: proof.reservationNumber,
      },
    });
    if (!reservation) {
      // Uniform not-found to avoid leaking which of (id/phone/number) mismatched.
      throw new NotFoundException('Reservation not found');
    }

    const settings = await this.settingsService.getOrCreate(tenantId);
    if (!settings.allowCancellation) {
      throw new BadRequestException('Cancellation is not allowed');
    }
    if (
      ![ReservationStatus.PENDING, ReservationStatus.CONFIRMED].includes(
        reservation.status as ReservationStatus,
      )
    ) {
      throw new BadRequestException('This reservation cannot be cancelled');
    }

    const reservationDateTime = new Date(reservation.date);
    const [hours, minutes] = reservation.startTime.split(':').map(Number);
    reservationDateTime.setHours(hours, minutes, 0, 0);

    const deadlineMs = settings.cancellationDeadline * 60 * 1000;
    const now = new Date();
    if (reservationDateTime.getTime() - now.getTime() < deadlineMs) {
      throw new BadRequestException('Cancellation deadline has passed');
    }

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: 'CUSTOMER',
      },
      include: { table: true },
    });

    this.notificationsService
      .notifyAdmins(tenantId, {
        title: 'Reservation Cancelled by Customer',
        message: `${reservation.customerName} cancelled their reservation for ${reservation.startTime}`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'reservation_cancelled' },
      })
      .catch((e) => this.logger.warn(`Reservation notification failed: ${e.message}`));

    return { id: updated.id, status: updated.status, cancelledAt: updated.cancelledAt };
  }

  async remove(id: string, tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id, tenantId },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');

      // If the reservation was holding a table OCCUPIED, release it if no
      // other active reservation or order needs it. Previously remove() left
      // the table stuck OCCUPIED.
      if (
        reservation.status === ReservationStatus.SEATED &&
        reservation.tableId
      ) {
        await this.freeTableIfUnused(tx, reservation.tableId, tenantId, reservation.id);
      }

      return tx.reservation.delete({ where: { id: reservation.id } });
    });
  }

  /**
   * Mark a table AVAILABLE only when no other active reservation or active
   * order references it. Caller is responsible for doing this inside a
   * transaction.
   */
  private async freeTableIfUnused(
    tx: Prisma.TransactionClient,
    tableId: string,
    tenantId: string,
    excludeReservationId: string,
  ) {
    const otherSeated = await tx.reservation.count({
      where: {
        tenantId,
        tableId,
        id: { not: excludeReservationId },
        status: ReservationStatus.SEATED,
      },
    });
    if (otherSeated > 0) return;

    const activeOrders = await tx.order.count({
      where: {
        tenantId,
        tableId,
        status: { in: ['PENDING', 'PREPARING', 'READY', 'SERVED'] as any },
      },
    });
    if (activeOrders > 0) return;

    await tx.table.updateMany({
      where: { id: tableId, tenantId, status: 'OCCUPIED' },
      data: { status: 'AVAILABLE' },
    });
  }

  async getAvailableSlots(tenantId: string, date: string, _guestCount?: number) {
    await this.validateTenant(tenantId);

    const settings = await this.settingsService.getOrCreate(tenantId);
    if (!settings.isEnabled) return [];

    const dayOfWeek = new Date(date)
      .toLocaleDateString('en-US', { weekday: 'long' })
      .toLowerCase();
    let openTime = '09:00';
    let closeTime = '22:00';
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
    if (isClosed) return [];

    const interval = Math.max(5, settings.timeSlotInterval || 30);
    const [openH, openM] = openTime.split(':').map(Number);
    const [closeH, closeM] = closeTime.split(':').map(Number);
    let currentMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    const existingReservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        date: new Date(date),
        status: { in: [...ACTIVE_RESERVATION_STATUSES] },
      },
      select: { startTime: true },
    });

    const slots: { time: string; available: boolean }[] = [];
    while (currentMinutes + settings.defaultDuration <= closeMinutes) {
      const h = Math.floor(currentMinutes / 60);
      const m = currentMinutes % 60;
      const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      let available = true;
      const now = new Date();
      const slotDateTime = new Date(date);
      slotDateTime.setHours(h, m, 0, 0);
      if (slotDateTime.getTime() - now.getTime() < settings.minAdvanceBooking * 60 * 1000) {
        available = false;
      }
      if (available && settings.maxReservationsPerSlot) {
        const count = existingReservations.filter((r) => r.startTime === timeStr).length;
        if (count >= settings.maxReservationsPerSlot) available = false;
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
  ) {
    await this.validateTenant(tenantId);

    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      orderBy: [{ section: 'asc' }, { number: 'asc' }],
      select: { id: true, number: true, capacity: true, section: true },
    });

    const existingReservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        date: new Date(date),
        status: { in: [...ACTIVE_RESERVATION_STATUSES] },
        tableId: { not: null },
      },
      select: { tableId: true, startTime: true, endTime: true },
    });

    const requestStart = this.timeToMinutes(startTime);
    const requestEnd = this.timeToMinutes(endTime);

    const availableTables = tables.filter((table) => {
      if (guestCount && table.capacity < guestCount) return false;
      const tableReservations = existingReservations.filter((r) => r.tableId === table.id);
      for (const res of tableReservations) {
        const resStart = this.timeToMinutes(res.startTime);
        const resEnd = this.timeToMinutes(res.endTime);
        if (requestStart < resEnd && requestEnd > resStart) return false;
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

  async lookupReservation(tenantId: string, phone: string, reservationNumber: string) {
    await this.validateTenant(tenantId);

    const reservation = await this.prisma.reservation.findFirst({
      where: {
        tenantId,
        customerPhone: phone,
        reservationNumber,
      },
      select: PUBLIC_LOOKUP_FIELDS,
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }
}
