import { Controller, Get, Post, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { WasteLogsService } from '../services/waste-logs.service';
import { CreateWasteLogDto } from '../dto/create-waste-log.dto';

@ApiTags('stock-management/waste-logs')
@ApiBearerAuth()
@Controller('stock-management/waste-logs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class WasteLogsController {
  constructor(private readonly service: WasteLogsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all waste logs' })
  @ApiQuery({ name: 'stockItemId', required: false })
  @ApiQuery({ name: 'reason', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  findAll(
    @Request() req,
    @Query('stockItemId') stockItemId?: string,
    @Query('reason') reason?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.findAll(req.tenantId, { stockItemId, reason, startDate, endDate });
  }

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get waste summary with totals by reason' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getSummary(@Request() req, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getSummary(req.tenantId, startDate, endDate);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Log waste' })
  create(@Body() dto: CreateWasteLogDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }
}
