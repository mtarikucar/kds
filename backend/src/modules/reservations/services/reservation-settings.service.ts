import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateReservationSettingsDto } from '../dto/update-reservation-settings.dto';

@Injectable()
export class ReservationSettingsService {
  constructor(private prisma: PrismaService) {}

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

  async getOrCreate(tenantId: string) {
    let settings = await this.prisma.reservationSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      settings = await this.prisma.reservationSettings.create({
        data: { tenantId },
      });
    }

    return settings;
  }

  async update(tenantId: string, dto: UpdateReservationSettingsDto) {
    let settings = await this.prisma.reservationSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      settings = await this.prisma.reservationSettings.create({
        data: { tenantId, ...dto },
      });
    } else {
      settings = await this.prisma.reservationSettings.update({
        where: { tenantId },
        data: dto,
      });
    }

    return settings;
  }

  async getPublicSettings(tenantId: string) {
    await this.validateTenant(tenantId);

    const settings = await this.getOrCreate(tenantId);
    return {
      isEnabled: settings.isEnabled,
      timeSlotInterval: settings.timeSlotInterval,
      minAdvanceBooking: settings.minAdvanceBooking,
      maxAdvanceDays: settings.maxAdvanceDays,
      defaultDuration: settings.defaultDuration,
      operatingHours: settings.operatingHours,
      maxGuestsPerReservation: settings.maxGuestsPerReservation,
      bannerImageUrl: settings.bannerImageUrl,
      bannerTitle: settings.bannerTitle,
      bannerDescription: settings.bannerDescription,
      customMessage: settings.customMessage,
      allowCancellation: settings.allowCancellation,
      cancellationDeadline: settings.cancellationDeadline,
    };
  }
}
