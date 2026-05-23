import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { LocalBridgeService } from './local-bridge.service';
import { BridgeTokenGuard } from './bridge-token.guard';

@ApiTags('Local Bridge')
@Controller('v1/bridges')
export class LocalBridgeController {
  constructor(private readonly bridges: LocalBridgeService) {}

  // -- Admin (user-auth) endpoints -----------------------------------------

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get()
  list(@Req() req: any, @Query('branchId') branchId?: string) {
    return this.bridges.list(req.user.tenantId, branchId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Provision a new bridge slot — returns provisioning token (shown once)' })
  createSlot(
    @Req() req: any,
    @Body() body: { branchId: string; productSku?: string; hostname?: string },
  ) {
    return this.bridges.createSlot(req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete(':id')
  retire(@Req() req: any, @Param('id') id: string) {
    return this.bridges.retire(req.user.tenantId, id);
  }

  // -- Bridge-side endpoints ----------------------------------------------

  @Public()
  @Post('claim')
  @ApiOperation({ summary: 'Bridge exchanges provisioning token for a long-lived bearer token' })
  claim(@Body() body: { provisioningToken: string; hostname?: string; os?: string; agentVersion?: string }) {
    return this.bridges.claim(body);
  }

  @UseGuards(BridgeTokenGuard)
  @Post('heartbeat')
  @ApiOperation({ summary: 'Bridge heartbeat. Auth: Authorization: Bridge <token>' })
  heartbeat(
    @Req() req: any,
    @Body() body: { hostname?: string; os?: string; agentVersion?: string },
  ) {
    return this.bridges.heartbeat(req.bridge.id, body);
  }
}
