import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { PlanFeatureGuard } from '../subscriptions/guards/plan-feature.guard';
import { RequiresFeature } from '../subscriptions/decorators/requires-feature.decorator';
import { PlanFeature } from '../../common/constants/subscription.enum';

@ApiTags('Branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  // List / one stay readable by any authenticated tenant user — staff
  // need to see which branches exist (waiter assigns an order to one).
  @Get()
  list(@Req() req: any) {
    return this.branches.list(req.user.tenantId);
  }

  @Get(':id')
  one(@Req() req: any, @Param('id') id: string) {
    return this.branches.findOrThrow(req.user.tenantId, id);
  }

  // Create / update / archive are ADMIN-only AND require the
  // MULTI_LOCATION feature (v2.8.88). Pre-v2.8.88 a FREE-plan tenant
  // could spin up unlimited branches via POST — the plan limit
  // (`maxBranches: 1`) was implicit and unenforced. The feature gate
  // routes through the engine, so an `extra_branch` add-on or PRO+
  // plan unlocks. Reads stay open for everyone (staff need to see
  // which branches exist to route orders).
  @Post()
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  @ApiOperation({ summary: 'Create a new branch (ADMIN only, MULTI_LOCATION feature)' })
  create(@Req() req: any, @Body() body: CreateBranchDto) {
    return this.branches.create(req.user.tenantId, body);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  update(@Req() req: any, @Param('id') id: string, @Body() body: UpdateBranchDto) {
    return this.branches.update(req.user.tenantId, id, body);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  archive(@Req() req: any, @Param('id') id: string) {
    return this.branches.archive(req.user.tenantId, id);
  }
}
