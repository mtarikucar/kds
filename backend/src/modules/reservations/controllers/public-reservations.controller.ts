import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { ReservationsService } from '../services/reservations.service';
import { ReservationSettingsService } from '../services/reservation-settings.service';
import { CreateReservationDto } from '../dto/create-reservation.dto';

@ApiTags('public-reservations')
@Controller('public/reservations')
export class PublicReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly settingsService: ReservationSettingsService,
  ) {}

  @Public()
  @Get(':tenantId/settings')
  @ApiOperation({ summary: 'Get public reservation settings' })
  @ApiParam({ name: 'tenantId' })
  getSettings(@Param('tenantId') tenantId: string) {
    return this.settingsService.getPublicSettings(tenantId);
  }

  @Public()
  @Get(':tenantId/available-slots')
  @ApiOperation({ summary: 'Get available time slots for a date' })
  getAvailableSlots(
    @Param('tenantId') tenantId: string,
    @Query('date') date: string,
    @Query('guestCount') guestCount?: string,
  ) {
    return this.reservationsService.getAvailableSlots(
      tenantId,
      date,
      guestCount ? parseInt(guestCount, 10) : undefined,
    );
  }

  @Public()
  @Get(':tenantId/tables')
  @ApiOperation({ summary: 'Get available tables' })
  getAvailableTables(
    @Param('tenantId') tenantId: string,
    @Query('date') date: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('guestCount') guestCount?: string,
  ) {
    return this.reservationsService.getAvailableTables(
      tenantId,
      date,
      startTime,
      endTime,
      guestCount ? parseInt(guestCount, 10) : undefined,
    );
  }

  @Public()
  @Post(':tenantId')
  @ApiOperation({ summary: 'Create a new reservation' })
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationsService.createPublicReservation(tenantId, dto);
  }

  @Public()
  @Get(':tenantId/lookup')
  @ApiOperation({ summary: 'Lookup reservation by phone and number' })
  lookup(
    @Param('tenantId') tenantId: string,
    @Query('phone') phone: string,
    @Query('reservationNumber') reservationNumber: string,
  ) {
    return this.reservationsService.lookupReservation(tenantId, phone, reservationNumber);
  }

  @Public()
  @Patch(':tenantId/:id/cancel')
  @ApiOperation({ summary: 'Customer cancellation' })
  cancelPublic(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.reservationsService.cancelPublic(id, tenantId);
  }
}
