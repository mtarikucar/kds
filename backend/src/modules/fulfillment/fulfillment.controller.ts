import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { ShipmentService } from './shipment.service';
import { WarrantyService } from './warranty.service';
import { InstallationService } from './installation.service';

@ApiTags('Fulfillment · Installation')
@ApiBearerAuth()
@Controller('v1/installation')
export class InstallationController {
  constructor(private readonly installation: InstallationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  request(@Req() req: any, @Body() body: { branchId?: string; hwOrderId?: string; preferredDates?: string[]; notes?: string }) {
    return this.installation.create(req.user.tenantId, {
      ...body,
      preferredDates: body.preferredDates?.map((d) => new Date(d)),
    });
  }

  @UseGuards(JwtAuthGuard)
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
@ApiTags('SuperAdmin · Installation')
@ApiBearerAuth()
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
  schedule(
    @Param('id') id: string,
    @Body() body: { scheduledFor: string; assignedTo?: string; tenantId: string },
  ) {
    // tenantId is in the body rather than derived from req.user — the
    // SuperAdmin guard means the caller has no tenant of their own;
    // scheduling on behalf of a tenant needs the target tenant id.
    return this.installation.schedule(
      body.tenantId,
      id,
      new Date(body.scheduledFor),
      body.assignedTo,
    );
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark installation done with optional close-out note' })
  complete(
    @Param('id') id: string,
    @Body() body: { tenantId: string; notes?: string },
  ) {
    return this.installation.complete(body.tenantId, id, body.notes);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a non-terminal installation request' })
  cancel(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.installation.cancel(id, body.reason);
  }
}

@ApiTags('Fulfillment · Warranty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/warranties')
export class WarrantyController {
  constructor(private readonly warranty: WarrantyService) {}

  @Post(':id/claims')
  @ApiOperation({ summary: 'File a warranty claim against a serial' })
  file(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { issue: string; severity?: 'low' | 'medium' | 'high'; description?: string },
  ) {
    return this.warranty.fileClaim(req.user.tenantId, id, body);
  }
}

@ApiTags('SuperAdmin · Shipments')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('v1/superadmin/shipments')
export class SuperadminShipmentsController {
  constructor(private readonly shipment: ShipmentService) {}

  @Post(':orderId')
  create(
    @Param('orderId') orderId: string,
    @Body() body: { carrier: string; trackingNo?: string; meta?: Record<string, unknown> },
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
