import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/dto/create-notification.dto';
import { CreateReservationDto } from '../dto/create-reservation.dto';
import { UpdateReservationDto } from '../dto/update-reservation.dto';
import { ReservationQueryDto } from '../dto/reservation-query.dto';
import { ReservationSettingsService } from './reservation-settings.service';
import { ReservationStatus } from '../constants/reservation-status.enum';

@Injectable()
export class ReservationsService {
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
    if (tenant.status !== 'active') {
      throw new ForbiddenException('Tenant is not active');
    }
    return tenant;
  }

  private async generateReservationNumber(tenantId: string, date: string): Promise<string> {
    const dateStr = date.replace(/-/g, '').substring(0, 8);
    const prefix = `R-${dateStr}`;

    const lastReservation = await this.prisma.reservation.findFirst({
      where: {
        tenantId,
        reservationNumber: { startsWith: prefix },
      },
      orderBy: { reservationNumber: 'desc' },
    });

    let nextNum = 1;
    if (lastReservation) {
      const lastNum = parseInt(lastReservation.reservationNumber.split('-').pop() || '0', 10);
      nextNum = lastNum + 1;
    }

    return `${prefix}-${String(nextNum).padStart(3, '0')}`;
  }

  async createPublicReservation(tenantId: string, dto: CreateReservationDto) {
    await this.validateTenant(tenantId);

    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.isEnabled) {
      throw new BadRequestException('Reservation system is not enabled');
    }

    // Validate end time > start time
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    // Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reservationDate = new Date(dto.date);
    reservationDate.setHours(0, 0, 0, 0);

    if (reservationDate < today) {
      throw new BadRequestException('Cannot book past dates');
    }

    // Validate maxAdvanceDays
    if (settings.maxAdvanceDays) {
      const maxDate = new Date();
      maxDate.setHours(0, 0, 0, 0);
      maxDate.setDate(maxDate.getDate() + settings.maxAdvanceDays);
      if (reservationDate > maxDate) {
        throw new BadRequestException(`Cannot book more than ${settings.maxAdvanceDays} days in advance`);
      }
    }

    // Validate minAdvanceBooking (same day check)
    if (settings.minAdvanceBooking) {
      const now = new Date();
      const [h, m] = dto.startTime.split(':').map(Number);
      const slotDateTime = new Date(dto.date);
      slotDateTime.setHours(h, m, 0, 0);
      if (slotDateTime.getTime() - now.getTime() < settings.minAdvanceBooking * 60 * 1000) {
        throw new BadRequestException('Reservation time is too soon. Please book further in advance.');
      }
    }

    // Validate operating hours (closed day check)
    if (settings.operatingHours) {
      const dayOfWeek = new Date(dto.date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const hours = settings.operatingHours as any;
      if (hours[dayOfWeek]?.closed) {
        throw new BadRequestException('Restaurant is closed on this day');
      }
    }

    if (dto.guestCount > settings.maxGuestsPerReservation) {
      throw new BadRequestException(`Maximum guests per reservation is ${settings.maxGuestsPerReservation}`);
    }

    // Check table capacity if tableId provided
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
      });
      if (!table) {
        throw new NotFoundException('Table not found');
      }
      if (dto.guestCount > table.capacity) {
        throw new BadRequestException(`Table capacity is ${table.capacity}`);
      }
    }

    // Check slot availability
    if (settings.maxReservationsPerSlot) {
      const existingCount = await this.prisma.reservation.count({
        where: {
          tenantId,
          date: new Date(dto.date),
          startTime: dto.startTime,
          status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.SEATED] },
        },
      });

      if (existingCount >= settings.maxReservationsPerSlot) {
        throw new BadRequestException('This time slot is fully booked');
      }
    }

    // Duplicate reservation check: same phone + same day + overlapping time
    const existingDuplicate = await this.prisma.reservation.findFirst({
      where: {
        tenantId,
        customerPhone: dto.customerPhone,
        date: new Date(dto.date),
        startTime: dto.startTime,
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
      },
    });

    if (existingDuplicate) {
      throw new BadRequestException('You already have a reservation for this time slot');
    }

    const reservationNumber = await this.generateReservationNumber(tenantId, dto.date);

    const status = settings.requireApproval ? ReservationStatus.PENDING : ReservationStatus.CONFIRMED;
    const confirmedAt = settings.requireApproval ? undefined : new Date();

    const reservation = await this.prisma.reservation.create({
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
        confirmedAt,
      },
      include: { table: true },
    });

    // Notify admins
    try {
      await this.notificationsService.notifyAdmins(tenantId, {
        title: 'New Reservation',
        message: `${dto.customerName} - ${dto.guestCount} guests on ${dto.date} at ${dto.startTime}`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'new_reservation' },
      });
    } catch (e) {
      console.error('Failed to send reservation notification:', e.message);
    }

    return reservation;
  }

  async findAll(tenantId: string, query: ReservationQueryDto) {
    const where: any = { tenantId };

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
        { customerPhone: { contains: query.search } },
        { reservationNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 50;
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
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
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
    // Normalize to date only
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

    const reservations = await this.prisma.reservation.findMany({
      where: { tenantId, date: startOfDay },
    });

    return {
      total: reservations.length,
      pending: reservations.filter(r => r.status === ReservationStatus.PENDING).length,
      confirmed: reservations.filter(r => r.status === ReservationStatus.CONFIRMED).length,
      seated: reservations.filter(r => r.status === ReservationStatus.SEATED).length,
      completed: reservations.filter(r => r.status === ReservationStatus.COMPLETED).length,
      cancelled: reservations.filter(r => r.status === ReservationStatus.CANCELLED).length,
      noShow: reservations.filter(r => r.status === ReservationStatus.NO_SHOW).length,
      rejected: reservations.filter(r => r.status === ReservationStatus.REJECTED).length,
    };
  }

  async update(id: string, tenantId: string, dto: UpdateReservationDto) {
    const reservation = await this.findOne(id, tenantId);

    const data: any = { ...dto };
    if (dto.date) {
      data.date = new Date(dto.date);
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data,
      include: { table: true },
    });
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

    // Notify admins about confirmation
    try {
      await this.notificationsService.notifyAdmins(tenantId, {
        title: 'Reservation Confirmed',
        message: `${reservation.customerName}'s reservation for ${reservation.startTime} has been confirmed`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'reservation_confirmed' },
      });
    } catch (e) {
      console.error('Failed to send confirmation notification:', e.message);
    }

    return updated;
  }

  async reject(id: string, tenantId: string, rejectionReason?: string) {
    const reservation = await this.findOne(id, tenantId);

    if (![ReservationStatus.PENDING, ReservationStatus.CONFIRMED].includes(reservation.status as ReservationStatus)) {
      throw new BadRequestException('This reservation cannot be rejected');
    }

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
      await this.notificationsService.notifyAdmins(tenantId, {
        title: 'Reservation Rejected',
        message: `${reservation.customerName}'s reservation for ${reservation.startTime} has been rejected`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'reservation_rejected' },
      });
    } catch (e) {
      console.error('Failed to send rejection notification:', e.message);
    }

    return updated;
  }

  async seat(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    if (reservation.status !== ReservationStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed reservations can be seated');
    }

    const updateData: any = {
      status: ReservationStatus.SEATED,
      seatedAt: new Date(),
    };

    // Update table status if assigned
    if (reservation.tableId) {
      await this.prisma.table.update({
        where: { id: reservation.tableId },
        data: { status: 'RESERVED' },
      });
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: updateData,
      include: { table: true },
    });
  }

  async complete(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    if (reservation.status !== ReservationStatus.SEATED) {
      throw new BadRequestException('Only seated reservations can be completed');
    }

    // Free up the table
    if (reservation.tableId) {
      await this.prisma.table.update({
        where: { id: reservation.tableId },
        data: { status: 'AVAILABLE' },
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

  async noShow(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    if (![ReservationStatus.CONFIRMED, ReservationStatus.PENDING].includes(reservation.status as ReservationStatus)) {
      throw new BadRequestException('This reservation cannot be marked as no-show');
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.NO_SHOW },
      include: { table: true },
    });
  }

  async cancel(id: string, tenantId: string, cancelledBy?: string) {
    const reservation = await this.findOne(id, tenantId);

    if ([ReservationStatus.COMPLETED, ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW].includes(reservation.status as ReservationStatus)) {
      throw new BadRequestException('This reservation cannot be cancelled');
    }

    // Free up the table if seated
    if (reservation.status === ReservationStatus.SEATED && reservation.tableId) {
      await this.prisma.table.update({
        where: { id: reservation.tableId },
        data: { status: 'AVAILABLE' },
      });
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy,
      },
      include: { table: true },
    });
  }

  async cancelPublic(id: string, tenantId: string) {
    await this.validateTenant(tenantId);

    const reservation = await this.findOne(id, tenantId);
    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.allowCancellation) {
      throw new BadRequestException('Cancellation is not allowed');
    }

    if (![ReservationStatus.PENDING, ReservationStatus.CONFIRMED].includes(reservation.status as ReservationStatus)) {
      throw new BadRequestException('This reservation cannot be cancelled');
    }

    // Check cancellation deadline
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

    // Notify admins about customer cancellation
    try {
      await this.notificationsService.notifyAdmins(tenantId, {
        title: 'Reservation Cancelled by Customer',
        message: `${reservation.customerName} cancelled their reservation for ${reservation.startTime}`,
        type: NotificationType.RESERVATION,
        data: { reservationId: reservation.id, type: 'reservation_cancelled' },
      });
    } catch (e) {
      console.error('Failed to send cancellation notification:', e.message);
    }

    return updated;
  }

  async remove(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    return this.prisma.reservation.delete({
      where: { id: reservation.id },
    });
  }

  async getAvailableSlots(tenantId: string, date: string, guestCount?: number) {
    await this.validateTenant(tenantId);

    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.isEnabled) {
      return [];
    }

    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
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

    if (isClosed) {
      return [];
    }

    // Generate time slots
    const slots: { time: string; available: boolean }[] = [];
    const interval = settings.timeSlotInterval;
    const [openH, openM] = openTime.split(':').map(Number);
    const [closeH, closeM] = closeTime.split(':').map(Number);

    let currentMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    // Get existing reservations for this date
    const existingReservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        date: new Date(date),
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.SEATED] },
      },
    });

    while (currentMinutes + settings.defaultDuration <= closeMinutes) {
      const h = Math.floor(currentMinutes / 60);
      const m = currentMinutes % 60;
      const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      let available = true;

      // Check min advance booking
      const now = new Date();
      const slotDateTime = new Date(date);
      slotDateTime.setHours(h, m, 0, 0);
      if (slotDateTime.getTime() - now.getTime() < settings.minAdvanceBooking * 60 * 1000) {
        available = false;
      }

      // Check max reservations per slot
      if (available && settings.maxReservationsPerSlot) {
        const slotReservations = existingReservations.filter(r => r.startTime === timeStr);
        if (slotReservations.length >= settings.maxReservationsPerSlot) {
          available = false;
        }
      }

      slots.push({ time: timeStr, available });
      currentMinutes += interval;
    }

    return slots;
  }

  async getAvailableTables(tenantId: string, date: string, startTime: string, endTime: string, guestCount?: number) {
    await this.validateTenant(tenantId);

    // Get all tables for this tenant
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      orderBy: [{ section: 'asc' }, { number: 'asc' }],
    });

    // Get reservations that overlap with the requested time
    const existingReservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        date: new Date(date),
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.SEATED] },
        tableId: { not: null },
      },
    });

    // Filter out tables that are already reserved during the requested time
    const requestStart = this.timeToMinutes(startTime);
    const requestEnd = this.timeToMinutes(endTime);

    const availableTables = tables.filter(table => {
      // Check capacity
      if (guestCount && table.capacity < guestCount) {
        return false;
      }

      // Check for overlapping reservations
      const tableReservations = existingReservations.filter(r => r.tableId === table.id);
      for (const res of tableReservations) {
        const resStart = this.timeToMinutes(res.startTime);
        const resEnd = this.timeToMinutes(res.endTime);
        if (requestStart < resEnd && requestEnd > resStart) {
          return false; // Overlap
        }
      }

      return true;
    });

    return availableTables.map(t => ({
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
      include: { table: true },
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
