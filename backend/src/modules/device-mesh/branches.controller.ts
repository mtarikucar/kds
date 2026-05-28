import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
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

  // Create / update / archive are ADMIN-only. Before iter-73 the
  // controller only carried JwtAuthGuard, so any authenticated
  // role (WAITER, KITCHEN, CASHIER) could spin up new branches —
  // a privilege gap on what is effectively a top-level resource
  // (every Order / Device / Table FK-references a Branch).
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new branch (ADMIN only)' })
  create(@Req() req: any, @Body() body: CreateBranchDto) {
    return this.branches.create(req.user.tenantId, body);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Req() req: any, @Param('id') id: string, @Body() body: UpdateBranchDto) {
    return this.branches.update(req.user.tenantId, id, body);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  archive(@Req() req: any, @Param('id') id: string) {
    return this.branches.archive(req.user.tenantId, id);
  }
}
