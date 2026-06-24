import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { UpdateReservationSettingsDto } from "../dto/update-reservation-settings.dto";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { isReservationFeatureEnabled } from "./reservation-entitlement.util";

@Injectable()
export class ReservationSettingsService {
  constructor(
    private prisma: PrismaService,
    // Public-surface plan gate. @Optional() so unit tests constructing the
    // service bare (prisma-only) keep working — when absent the entitlement
    // check is skipped (tests assert the field projection, not the gate).
    // Production DI always provides the global EntitlementService.
    @Optional() private readonly entitlements?: EntitlementService,
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

    // Plan-gate the PUBLIC surface server-side so it matches the admin gate
    // (PlanFeatureGuard + @RequiresFeature(RESERVATION_SYSTEM)). Without this,
    // a tenant whose plan excludes reservations still advertises isEnabled:true
    // and the wizard accepts bookings the operator can never see/manage. When
    // the feature is not granted, report disabled so the FE shows "reservations
    // unavailable" instead of taking a booking into a void. NOT coupled to
    // ReservationSettings.isEnabled (schema default true, never plan-linked).
    const featureEnabled = this.entitlements
      ? await isReservationFeatureEnabled(
          this.prisma,
          this.entitlements,
          tenantId,
        )
      : true;

    return {
      isEnabled: featureEnabled && settings.isEnabled,
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
