import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../../subscriptions/guards/plan-feature.guard';
import { RequiresFeature } from '../../subscriptions/decorators/requires-feature.decorator';
import { PlanFeature } from '../../../common/constants/subscription.enum';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { ShiftSwapService } from '../services/shift-swap.service';
import { CreateSwapRequestDto } from '../dto/create-swap-request.dto';

@ApiTags('personnel/shift-swap')
@ApiBearerAuth()
@Controller('personnel/shift-swap')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class ShiftSwapController {
  constructor(private readonly shiftSwapService: ShiftSwapService) {}

  @Post('request')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'Request a shift swap' })
  createRequest(@Request() req, @Body() dto: CreateSwapRequestDto) {
    return this.shiftSwapService.createRequest(req.tenantId, req.user.id, dto);
  }

  @Patch(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Approve shift swap' })
  approve(@Request() req, @Param('id') id: string) {
    return this.shiftSwapService.approve(id, req.tenantId, req.user.id);
  }

  @Patch(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reject shift swap' })
  reject(@Request() req, @Param('id') id: string) {
    return this.shiftSwapService.reject(id, req.tenantId, req.user.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List swap requests' })
  findAll(@Request() req) {
    return this.shiftSwapService.findAll(req.tenantId);
  }
}
