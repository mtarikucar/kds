import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { CardShiftService } from "../services/card-shift.service";
import { AssignCardDto } from "../dto/card-shift.dto";

/**
 * Staff-card enrolment. Both flags are listed at CLASS level and no method
 * carries an entitlement decorator: the guard reads
 * getAllAndOverride([handler, class]) (entitlement.guard.ts:62-66), so a
 * method-level @RequiresFeature would OVERRIDE this pair rather than add to it.
 */
@ApiTags("personnel/cards")
@ApiBearerAuth()
@Controller("personnel/cards")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT, PlanFeature.CARD_SHIFT)
export class CardShiftController {
  constructor(private readonly cardShift: CardShiftService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Staff card assignments (last 4 digits only)" })
  list(@Request() req) {
    return this.cardShift.list(req.tenantId);
  }

  @Post(":userId")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  // Enrolment is a handful of taps per shift at most; 20/min leaves room for a
  // fumbled card and none for scanning a UID space.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Assign (or replace) a staff card" })
  assign(
    @Request() req,
    @Param("userId") userId: string,
    @Body() dto: AssignCardDto,
  ) {
    return this.cardShift.assign(req.tenantId, userId, req.user.id, dto);
  }

  @Delete(":userId")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Revoke a staff card (attendance history is kept)" })
  revoke(@Request() req, @Param("userId") userId: string) {
    return this.cardShift.revoke(req.tenantId, userId);
  }
}
