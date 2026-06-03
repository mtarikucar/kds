import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { UpdateReservationSettingsDto } from "../dto/update-reservation-settings.dto";

@Injectable()
export class ReservationSettingsService {
  constructor(private prisma: PrismaService) {}

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

  // v3.0.1 — findFirst pattern. The compound-unique key includes
  // branchId which is nullable; Prisma's generated findUnique/upsert
  // reject `branchId: null` at runtime even when the underlying
  // constraint uses NULLS NOT DISTINCT. findFirst + opportunistic
  // create + P2002 race-catch is the canonical v3 pattern.
  async getOrCreate(tenantId: string) {
    const existing = await this.prisma.reservationSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.reservationSettings.create({
        data: { tenantId },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const row = await this.prisma.reservationSettings.findFirst({
          where: { tenantId, branchId: null },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  async update(tenantId: string, dto: UpdateReservationSettingsDto) {
    // Read-then-update with race fallback. See getOrCreate note.
    const existing = await this.prisma.reservationSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) {
      const updated = await this.prisma.reservationSettings.updateMany({
        where: { tenantId, branchId: null },
        data: dto,
      });
      if (updated.count > 0) {
        return this.prisma.reservationSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
    }
    try {
      return await this.prisma.reservationSettings.create({
        data: { tenantId, ...dto },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        await this.prisma.reservationSettings.updateMany({
          where: { tenantId, branchId: null },
          data: dto,
        });
        return this.prisma.reservationSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
      throw e;
    }
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
