import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/dto/create-notification.dto';
import { CreateReservationDto } from '../dto/create-reservation.dto';
import { UpdateReservationDto } from '../dto/update-reservation.dto';
import { ReservationQueryDto } from '../dto/reservation-query.dto';
import { ReservationSettingsService } from './reservation-settings.service';

@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private settingsService: ReservationSettingsService,
  ) {}

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
    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.isEnabled) {
      throw new BadRequestException('Reservation system is not enabled');
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
          status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
        },
      });

      if (existingCount >= settings.maxReservationsPerSlot) {
        throw new BadRequestException('This time slot is fully booked');
      }
    }

    const reservationNumber = await this.generateReservationNumber(tenantId, dto.date);

    const status = settings.requireApproval ? 'PENDING' : 'CONFIRMED';
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
      // Don't fail reservation creation if notification fails
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

    return this.prisma.reservation.findMany({
      where,
      include: { table: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
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
      pending: reservations.filter(r => r.status === 'PENDING').length,
      confirmed: reservations.filter(r => r.status === 'CONFIRMED').length,
      seated: reservations.filter(r => r.status === 'SEATED').length,
      completed: reservations.filter(r => r.status === 'COMPLETED').length,
      cancelled: reservations.filter(r => r.status === 'CANCELLED').length,
      noShow: reservations.filter(r => r.status === 'NO_SHOW').length,
      rejected: reservations.filter(r => r.status === 'REJECTED').length,
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

    if (reservation.status !== 'PENDING') {
      throw new BadRequestException('Only pending reservations can be confirmed');
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedById: userId,
      },
      include: { table: true },
    });
  }

  async reject(id: string, tenantId: string, rejectionReason?: string) {
    const reservation = await this.findOne(id, tenantId);

    if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
      throw new BadRequestException('This reservation cannot be rejected');
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'REJECTED',
        rejectionReason,
      },
      include: { table: true },
    });
  }

  async seat(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    if (reservation.status !== 'CONFIRMED') {
      throw new BadRequestException('Only confirmed reservations can be seated');
    }

    const updateData: any = {
      status: 'SEATED',
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

    if (reservation.status !== 'SEATED') {
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
        status: 'COMPLETED',
        completedAt: new Date(),
      },
      include: { table: true },
    });
  }

  async noShow(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    if (!['CONFIRMED', 'PENDING'].includes(reservation.status)) {
      throw new BadRequestException('This reservation cannot be marked as no-show');
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: 'NO_SHOW' },
      include: { table: true },
    });
  }

  async cancel(id: string, tenantId: string, cancelledBy?: string) {
    const reservation = await this.findOne(id, tenantId);

    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(reservation.status)) {
      throw new BadRequestException('This reservation cannot be cancelled');
    }

    // Free up the table if seated
    if (reservation.status === 'SEATED' && reservation.tableId) {
      await this.prisma.table.update({
        where: { id: reservation.tableId },
        data: { status: 'AVAILABLE' },
      });
    }

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy,
      },
      include: { table: true },
    });
  }

  async cancelPublic(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);
    const settings = await this.settingsService.getOrCreate(tenantId);

    if (!settings.allowCancellation) {
      throw new BadRequestException('Cancellation is not allowed');
    }

    if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
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

    return this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: 'CUSTOMER',
      },
      include: { table: true },
    });
  }

  async remove(id: string, tenantId: string) {
    const reservation = await this.findOne(id, tenantId);

    return this.prisma.reservation.delete({
      where: { id: reservation.id },
    });
  }

  async getAvailableSlots(tenantId: string, date: string, guestCount?: number) {
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
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
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
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
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
