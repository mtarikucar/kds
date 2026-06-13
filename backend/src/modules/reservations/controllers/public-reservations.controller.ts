import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../auth/decorators/public.decorator";
import { ReservationsService } from "../services/reservations.service";
import { ReservationAvailabilityService } from "../services/reservation-availability.service";
import { ReservationSettingsService } from "../services/reservation-settings.service";
import {
  CreateReservationDto,
  CancelPublicReservationDto,
} from "../dto/create-reservation.dto";
import { LookupReservationDto } from "../dto/lookup-reservation.dto";

// Aggressive throttles on the guest-facing endpoints: the global ThrottlerModule
// default of 100/min/IP is not enough for a booking form where PII-by-enumeration
// via /lookup is a realistic threat and where bots can fill the admin
// notification feed with junk in minutes. IP-scoped; paired with phone-matching
// proof on cancel and a bounded field set on lookup for defense-in-depth.
@ApiTags("public-reservations")
@Controller("public/reservations")
export class PublicReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly availabilityService: ReservationAvailabilityService,
    private readonly settingsService: ReservationSettingsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(":tenantId/settings")
  @ApiOperation({ summary: "Get public reservation settings" })
  @ApiParam({ name: "tenantId" })
  getSettings(@Param("tenantId") tenantId: string) {
    return this.settingsService.getPublicSettings(tenantId);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":tenantId/available-slots")
  @ApiOperation({ summary: "Get available time slots for a date" })
  getAvailableSlots(
    @Param("tenantId") tenantId: string,
    @Query("date") date: string,
    @Query("guestCount") guestCount?: string,
    // Optional explicit branch selector. Omitted → service falls back to
    // the tenant's oldest-active branch (same default as createReservation),
    // so single-branch callers are unaffected. Multi-branch tenants pass
    // it to scope availability to one location.
    @Query("branchId") branchId?: string,
  ) {
    const parsed = guestCount ? parseInt(guestCount, 10) : undefined;
    return this.availabilityService.getAvailableSlots(
      tenantId,
      date,
      Number.isFinite(parsed as number) ? parsed : undefined,
      branchId,
    );
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":tenantId/tables")
  @ApiOperation({ summary: "Get available tables" })
  getAvailableTables(
    @Param("tenantId") tenantId: string,
    @Query("date") date: string,
    @Query("startTime") startTime: string,
    @Query("endTime") endTime: string,
    @Query("guestCount") guestCount?: string,
    // Optional explicit branch selector. Omitted → service falls back to
    // the tenant's oldest-active branch (same default as createReservation),
    // so single-branch callers are unaffected. Multi-branch tenants pass
    // it to scope availability to one location.
    @Query("branchId") branchId?: string,
  ) {
    const parsed = guestCount ? parseInt(guestCount, 10) : undefined;
    return this.availabilityService.getAvailableTables(
      tenantId,
      date,
      startTime,
      endTime,
      Number.isFinite(parsed as number) ? parsed : undefined,
      branchId,
    );
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post(":tenantId")
  @ApiOperation({ summary: "Create a new reservation" })
  create(
    @Param("tenantId") tenantId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationsService.createPublicReservation(tenantId, dto);
  }

  @Public()
  @Get(":tenantId/branches")
  @ApiOperation({
    summary:
      "List a tenant's bookable (active) branches for the public reservation branch picker",
  })
  listBranches(@Param("tenantId") tenantId: string) {
    return this.availabilityService.listPublicBranches(tenantId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(":tenantId/lookup")
  @ApiOperation({ summary: "Lookup reservation by phone and number" })
  lookup(
    @Param("tenantId") tenantId: string,
    @Query() dto: LookupReservationDto,
  ) {
    return this.reservationsService.lookupReservation(
      tenantId,
      dto.phone,
      dto.reservationNumber,
    );
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Patch(":tenantId/:id/cancel")
  @ApiOperation({
    summary: "Customer cancellation (requires phone + reservation number)",
  })
  cancelPublic(
    @Param("tenantId") tenantId: string,
    @Param("id") id: string,
    @Body() dto: CancelPublicReservationDto,
  ) {
    return this.reservationsService.cancelPublic(tenantId, id, {
      customerPhone: dto.customerPhone,
      reservationNumber: dto.reservationNumber,
    });
  }
}
