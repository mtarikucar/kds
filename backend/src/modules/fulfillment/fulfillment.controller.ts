import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { SuperAdminRoute } from '../superadmin/decorators/superadmin.decorator';
import { ShipmentService } from './shipment.service';
import { WarrantyService } from './warranty.service';
import { InstallationService } from './installation.service';
import {
  CancelInstallationDto,
  CompleteInstallationDto,
  CreateInstallationRequestDto,
  CreateShipmentDto,
  FileWarrantyClaimDto,
  ScheduleInstallationDto,
} from './dto/installation-ops.dto';

// v2.8.89 — installation request creates a scheduling obligation +
// exposes tenant address + contact data. ADMIN/MANAGER only.
@ApiTags('Fulfillment · Installation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('v1/installation')
export class InstallationController {
  constructor(private readonly installation: InstallationService) {}

  @Post()
  request(@Req() req: any, @Body() body: CreateInstallationRequestDto) {
    return this.installation.create(req.user.tenantId, {
      ...body,
      preferredDates: body.preferredDates?.map((d) => new Date(d)),
    });
  }

  @Get()
  list(@Req() req: any, @Query('status') status?: string) {
    return this.installation.list(req.user.tenantId, status);
  }
}

/**
 * SuperAdmin-side installation ops queue. Operators here schedule a
 * technician, mark visits complete, or cancel obsolete requests.
 * Tenant-side controller above only creates + lists their own; the
 * lifecycle transitions live here.
 */
// v2.8.90 — @SuperAdminRoute() skips global tenant-realm guards;
// SuperAdmin tokens are signed with a different key and don't carry
// a tenantId.
@ApiTags('SuperAdmin · Installation')
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller('v1/superadmin/installation')
export class SuperadminInstallationController {
  constructor(private readonly installation: InstallationService) {}

  @Get()
  @ApiOperation({ summary: 'Ops queue across all tenants (status / assignedTo filter optional)' })
  list(@Query('status') status?: string, @Query('assignedTo') assignedTo?: string) {
    return this.installation.listAll(status, assignedTo);
  }

  @Patch(':id/schedule')
  @ApiOperation({ summary: 'Assign technician + scheduled date' })
  schedule(@Param('id') id: string, @Body() body: ScheduleInstallationDto) {
    // tenantId derived from the row inside the service — the SuperAdmin
    // guard means the caller has no tenant of their own. Passing it in
    // the body invites the operator to type the wrong tenant id; deriving
    // it from the row is the single source of truth.
    return this.installation.scheduleByOps(id, new Date(body.scheduledFor), body.assignedTo);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark installation done with optional close-out note' })
  complete(@Param('id') id: string, @Body() body: CompleteInstallationDto) {
    return this.installation.completeByOps(id, body.notes);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a non-terminal installation request' })
  cancel(@Param('id') id: string, @Body() body: CancelInstallationDto) {
    return this.installation.cancel(id, body.reason);
  }
}

// v2.8.89 — warranty claim asserts a tenant defect against a serial;
// ADMIN/MANAGER only (sets a financial/SLA expectation on us).
@ApiTags('Fulfillment · Warranty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('v1/warranties')
export class WarrantyController {
  constructor(private readonly warranty: WarrantyService) {}

  @Post(':id/claims')
  @ApiOperation({ summary: 'File a warranty claim against a serial (ADMIN/MANAGER)' })
  file(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: FileWarrantyClaimDto,
  ) {
    return this.warranty.fileClaim(req.user.tenantId, id, body);
  }
}

// v2.8.90 — @SuperAdminRoute() (same reasoning as SuperadminInstallationController).
@ApiTags('SuperAdmin · Shipments')
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller('v1/superadmin/shipments')
export class SuperadminShipmentsController {
  constructor(private readonly shipment: ShipmentService) {}

  @Post(':orderId')
  create(
    @Param('orderId') orderId: string,
    @Body() body: CreateShipmentDto,
  ) {
    return this.shipment.createShipment(orderId, body);
  }

  @Patch(':shipmentId/delivered')
  markDelivered(@Param('shipmentId') shipmentId: string) {
    return this.shipment.markDelivered(shipmentId);
  }

  @Get(':orderId')
  list(@Param('orderId') orderId: string) {
    return this.shipment.listForOrder(orderId);
  }
}
