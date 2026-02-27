import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { ShiftTemplatesService } from '../services/shift-templates.service';
import { CreateShiftTemplateDto } from '../dto/create-shift-template.dto';
import { UpdateShiftTemplateDto } from '../dto/update-shift-template.dto';

@ApiTags('personnel/shift-templates')
@ApiBearerAuth()
@Controller('personnel/shift-templates')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class ShiftTemplatesController {
  constructor(private readonly shiftTemplatesService: ShiftTemplatesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create shift template' })
  create(@Request() req, @Body() dto: CreateShiftTemplateDto) {
    return this.shiftTemplatesService.create(req.tenantId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List all shift templates' })
  findAll(@Request() req) {
    return this.shiftTemplatesService.findAll(req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update shift template' })
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateShiftTemplateDto) {
    return this.shiftTemplatesService.update(id, req.tenantId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete shift template' })
  remove(@Request() req, @Param('id') id: string) {
    return this.shiftTemplatesService.remove(id, req.tenantId);
  }
}
