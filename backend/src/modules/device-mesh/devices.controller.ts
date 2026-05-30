import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { Public } from '../auth/decorators/public.decorator';
import { DeviceService } from './device.service';
import { CommandQueueService } from './command-queue.service';
import { DeviceTokenGuard } from './device-token.guard';
import {
  CreateDeviceSlotDto,
  PairDeviceDto,
  HeartbeatDto,
  EnqueueCommandDto,
  AckCommandDto,
} from './dto/device.dto';

/**
 * Two distinct surfaces in one controller for now:
 *   /admin/*    user-token: tenant admins manage their devices
 *   /agent/*    device-token: the device itself talks here
 *
 * Splitting later is trivial; keeping them co-located right now keeps the
 * mental model coherent ("everything device-mesh is under /v1/devices/...").
 */
@ApiTags('Device Mesh')
@Controller('v1/devices')
export class DevicesController {
  constructor(
    private readonly devices: DeviceService,
    private readonly queue: CommandQueueService,
  ) {}

  // -- Admin (user-auth) endpoints -----------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List devices for the authenticated tenant' })
  list(
    @Req() req: any,
    @Query('branchId') branchId?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
  ) {
    return this.devices.list(req.user.tenantId, { branchId, kind, status });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a device slot — returns a pair code to type into the device' })
  create(@Req() req: any, @Body() dto: CreateDeviceSlotDto) {
    return this.devices.createSlot(req.user.tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Retire a device (ADMIN only)' })
  retire(@Req() req: any, @Param('id') id: string) {
    return this.devices.retire(req.user.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Post(':id/commands')
  @ApiOperation({ summary: 'Enqueue a command to a device' })
  enqueueCommand(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: EnqueueCommandDto,
  ) {
    return this.queue.enqueue(req.user.tenantId, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get(':id/commands')
  @ApiOperation({ summary: 'Inspect a device command queue (admin view)' })
  listCommands(
    @Req() req: any,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.queue.listForDevice(req.user.tenantId, id, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // -- Device-side (device-token auth) endpoints ---------------------------

  @Public()
  @Post('pair')
  @ApiOperation({ summary: 'Device pairs using the pair code shown in the admin UI' })
  pair(@Body() dto: PairDeviceDto) {
    return this.devices.pair(dto);
  }

  @UseGuards(DeviceTokenGuard)
  @Post('heartbeat')
  @ApiOperation({ summary: 'Device-side heartbeat. Auth: Authorization: Device <token>' })
  heartbeat(@Req() req: any, @Body() dto: HeartbeatDto) {
    return this.devices.heartbeat(req.device.id, dto);
  }

  @UseGuards(DeviceTokenGuard)
  @Get('next-command')
  @ApiOperation({ summary: 'Device claims the next queued command (returns null if none)' })
  nextCommand(@Req() req: any) {
    return this.queue.claimNext(req.device.id);
  }

  @UseGuards(DeviceTokenGuard)
  @Post('commands/:commandId/ack')
  @ApiOperation({ summary: 'Device acks a command outcome' })
  ack(@Req() req: any, @Param('commandId') commandId: string, @Body() dto: AckCommandDto) {
    return this.queue.ack(req.device.id, commandId, dto);
  }
}
