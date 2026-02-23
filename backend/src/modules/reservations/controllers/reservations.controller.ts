import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { ReservationsService } from '../services/reservations.service';
import { ReservationSettingsService } from '../services/reservation-settings.service';
import { UpdateReservationDto } from '../dto/update-reservation.dto';
import { RejectReservationDto } from '../dto/update-reservation.dto';
import { UpdateReservationSettingsDto } from '../dto/update-reservation-settings.dto';
import { ReservationQueryDto } from '../dto/reservation-query.dto';

@ApiTags('reservations')
@ApiBearerAuth()
@Controller('reservations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly settingsService: ReservationSettingsService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get all reservations with filters' })
  findAll(@Request() req, @Query() query: ReservationQueryDto) {
    return this.reservationsService.findAll(req.tenantId, query);
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get reservation statistics' })
  getStats(@Request() req, @Query('date') date?: string) {
    return this.reservationsService.getStats(req.tenantId, date);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get reservation by ID' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.reservationsService.findOne(id, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update reservation' })
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.reservationsService.update(id, req.tenantId, dto);
  }

  @Patch(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Confirm reservation' })
  confirm(@Request() req, @Param('id') id: string) {
    return this.reservationsService.confirm(id, req.tenantId, req.user.id);
  }

  @Patch(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reject reservation' })
  reject(@Request() req, @Param('id') id: string, @Body() dto: RejectReservationDto) {
    return this.reservationsService.reject(id, req.tenantId, dto.rejectionReason);
  }

  @Patch(':id/seat')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Mark reservation as seated' })
  seat(@Request() req, @Param('id') id: string) {
    return this.reservationsService.seat(id, req.tenantId);
  }

  @Patch(':id/complete')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Complete reservation' })
  complete(@Request() req, @Param('id') id: string) {
    return this.reservationsService.complete(id, req.tenantId);
  }

  @Patch(':id/no-show')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mark reservation as no-show' })
  noShow(@Request() req, @Param('id') id: string) {
    return this.reservationsService.noShow(id, req.tenantId);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Cancel reservation' })
  cancelAdmin(@Request() req, @Param('id') id: string) {
    return this.reservationsService.cancel(id, req.tenantId, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete reservation' })
  remove(@Request() req, @Param('id') id: string) {
    return this.reservationsService.remove(id, req.tenantId);
  }

  // Settings endpoints
  @Get('settings/current')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get reservation settings' })
  getSettings(@Request() req) {
    return this.settingsService.getOrCreate(req.tenantId);
  }

  @Patch('settings/current')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update reservation settings' })
  updateSettings(@Request() req, @Body() dto: UpdateReservationSettingsDto) {
    return this.settingsService.update(req.tenantId, dto);
  }
}
