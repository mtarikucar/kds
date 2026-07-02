import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { ReservationSettingsService } from "./reservation-settings.service";
import { ReservationStatus } from "../constants/reservation-status.enum";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { isReservationFeatureEnabled } from "./reservation-entitlement.util";

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
    // Public-surface plan gate (mirrors PlanFeatureGuard on the admin path).
    // @Optional() so bare-constructed unit-test instances keep working; when
    // absent the availability reads are not feature-gated (tests cover the
    // algorithm, not the gate). Production DI always provides it.
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

  /**
   * Public list of a tenant's bookable branches for the reservation branch
   * picker. Active-only (a suspended branch can't take bookings) and
   * oldest-first so the first entry matches the default resolvePublicBranchId
   * falls back to. Projection is intentionally minimal (id + name) — this is
   * an anonymous, unauthenticated surface, so it must never leak operational
   * branch fields (address internals, status flags, settings, etc.).
   */
  async listPublicBranches(
    tenantId: string,
  ): Promise<{ id: string; name: string }[]> {
    // Plan-gate this PUBLIC, anonymous read so it matches the sibling public
    // surfaces (getPublicSettings / getAvailableSlots / getAvailableTables) and
    // the admin gate. Without it, a tenant whose plan excludes reservations
    // still leaks its branch roster (id + name) on the booking branch-picker —
    // an info leak the pre-prod audit flagged. Return [] when not granted, the
    // same shape as a tenant with no active branches. @Optional() entitlements
    // ⇒ ungated for bare-constructed unit-test instances (prod DI always sets).
    if (this.entitlements) {
      const featureEnabled = await isReservationFeatureEnabled(
        this.prisma,
        this.entitlements,
        tenantId,
      );
      if (!featureEnabled) {
        return [];
      }
    }

    return this.prisma.branch.findMany({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
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

    // Plan-gate the PUBLIC availability read so it matches the admin gate and
    // the public create path — a tenant whose plan excludes reservations must
    // not see bookable slots. Returning [] makes the wizard show no slots.
    if (this.entitlements) {
      const featureEnabled = await isReservationFeatureEnabled(
        this.prisma,
        this.entitlements,
        tenantId,
      );
      if (!featureEnabled) {
        return [];
      }
    }

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
    // Defend the loop below against a non-positive interval: the generator does
    // `currentMinutes += interval`, so interval <= 0 (or NaN) never advances —
    // the `while` never terminates and the availability request HANGS the
    // worker (a DoS reachable via a mis-set timeSlotInterval). The DTO now
    // enforces @Min at the write boundary; this clamp additionally covers any
    // legacy row already persisted with a bad value, falling back to 30 min.
    const rawInterval = settings.timeSlotInterval;
    const interval =
      Number.isInteger(rawInterval) && rawInterval > 0 ? rawInterval : 30;
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

    // When the caller passes a party size, a slot must only be "available" if
    // at least one table that can SEAT the party is free for that slot's
    // window — otherwise the wizard shows a slot that can never be honored
    // (e.g. a party of 50 at a venue whose biggest table seats 8). Load the
    // branch's tables once (capacity-filtered) and compute per-slot freeness
    // using the same overlap math getAvailableTables uses. Guarded on
    // guestCount so the no-party-size view (and existing callers) are
    // unchanged.
    //
    // BUT: only apply the capacity gate when the branch ACTUALLY HAS tables.
    // A reservation-enabled tenant that never defined tables would otherwise
    // produce an empty capableTables array → every slot forced
    // available:false → the whole day greyed out, bricking the no-table /
    // walk-in flow. A branch with zero tables means "table management is not
    // in use here", so leave capableTables=null (the per-slot gate below is
    // skipped) and let slots stay bookable on capacity grounds; the
    // createPublicReservation path bounds party size by
    // settings.maxGuestsPerReservation instead.
    let capableTables: { id: string; capacity: number }[] | null = null;
    if (guestCount) {
      const tables =
        (await this.prisma.table.findMany({
          where: { tenantId, branchId: resolvedBranchId },
          select: { id: true, capacity: true },
        })) ?? [];
      // Only gate on capacity when tables exist for this branch. Zero tables
      // ⇒ table management not in use ⇒ don't force slots unavailable.
      if (tables.length > 0) {
        capableTables = tables.filter((t) => t.capacity >= guestCount);
      }
    }

    // Reservations that hold a specific table (for the per-table freeness
    // check above). Reservations with no table don't block a specific table.
    const tableReservations = existingReservations.filter(
      (r) => r.tableId != null,
    );

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

      // Party-size capacity: a slot is only bookable if at least one table
      // that can seat the party is free for [slotStart, slotStart+duration).
      // capableTables is non-null only when guestCount was supplied; when the
      // venue has no table big enough it is empty → every slot is unavailable.
      if (available && capableTables !== null) {
        const slotStart = currentMinutes;
        const slotEnd = currentMinutes + settings.defaultDuration;
        const hasFreeTable = capableTables.some((table) => {
          for (const res of tableReservations) {
            if (res.tableId !== table.id) continue;
            const resStart = timeToMinutes(res.startTime);
            const resEnd = timeToMinutes(res.endTime);
            // Strict overlap (boundary-touch is not an overlap), same as
            // getAvailableTables.
            if (slotStart < resEnd && slotEnd > resStart) {
              return false; // this table is busy for the slot window
            }
          }
          return true; // table can seat the party and is free
        });
        if (!hasFreeTable) {
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

    // Plan-gate the PUBLIC table read so it matches the admin gate and the
    // public create/slots paths — a tenant whose plan excludes reservations
    // must not surface bookable tables.
    if (this.entitlements) {
      const featureEnabled = await isReservationFeatureEnabled(
        this.prisma,
        this.entitlements,
        tenantId,
      );
      if (!featureEnabled) {
        return [];
      }
    }

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
