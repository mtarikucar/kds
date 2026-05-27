import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HardwareOrdersService } from './hardware-orders.service';
import { ListHardwareOrdersQueryDto } from './dto/list-hardware-orders.dto';

@ApiTags('Hardware Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/hardware-orders')
export class HardwareOrdersController {
  constructor(private readonly orders: HardwareOrdersService) {}

  @Get()
  @ApiOperation({ summary: "Tenant's own hardware orders (most recent first)" })
  // `query` is validated through the global ValidationPipe — an unknown
  // status now returns 400 instead of silently mapping to an empty list,
  // which used to let clients fuzz arbitrary values into the Prisma
  // `where`. Whitelist lives in ListHardwareOrdersQueryDto.
  listMine(@Req() req: any, @Query() query: ListHardwareOrdersQueryDto) {
    return this.orders.listMine(req.user.tenantId, query.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One order — items, shipments, installation requests' })
  getMine(@Req() req: any, @Param('id') id: string) {
    return this.orders.getMine(req.user.tenantId, id);
  }
}
