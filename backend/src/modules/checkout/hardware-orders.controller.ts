import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HardwareOrdersService } from './hardware-orders.service';

@ApiTags('Hardware Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/hardware-orders')
export class HardwareOrdersController {
  constructor(private readonly orders: HardwareOrdersService) {}

  @Get()
  @ApiOperation({ summary: "Tenant's own hardware orders (most recent first)" })
  listMine(@Req() req: any, @Query('status') status?: string) {
    return this.orders.listMine(req.user.tenantId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One order — items, shipments, installation requests' })
  getMine(@Req() req: any, @Param('id') id: string) {
    return this.orders.getMine(req.user.tenantId, id);
  }
}
