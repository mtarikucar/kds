import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { HardwareOrdersService } from './hardware-orders.service';
import { ListHardwareOrdersQueryDto } from './dto/list-hardware-orders.dto';

// v2.8.89 — order list + detail expose buyer email + phone + shipping
// address; ADMIN/MANAGER only. Pre-v2.8.89 any authenticated tenant
// role could enumerate the order list.
@ApiTags('Hardware Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
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
