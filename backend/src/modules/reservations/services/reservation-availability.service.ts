import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { ReservationSettingsService } from "./reservation-settings.service";
import { ReservationStatus } from "../constants/reservation-status.enum";

/**
 * Pure string→minutes helper shared between the availability reads here and
 * the overlap checks that remain in ReservationsService. Module-level so
 * both files import the single definition (no duplication, no class
 * back-dependency).
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Public-availability computation extracted out of ReservationsService
 * (god-file split). Owns the guest-facing, @Public() availability reads
 * (getAvailableTables / getAvailableSlots) plus the shared public branch
 * resolver, which createPublicReservation (still in ReservationsService)
 * also calls.
 */
@Injectable()
export class ReservationAvailabilityService {
  constructor(
    private prisma: PrismaService,
    private settingsService: ReservationSettingsService,
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
  async resolvePublicBranchId(
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
    const requestStart = timeToMinutes(startTime);
    const requestEnd = timeToMinutes(endTime);

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
        const resStart = timeToMinutes(res.startTime);
        const resEnd = timeToMinutes(res.endTime);
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
}
