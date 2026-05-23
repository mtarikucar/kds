import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BranchesService } from './branches.service';

@ApiTags('Branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list(@Req() req: any) {
    return this.branches.list(req.user.tenantId);
  }

  @Get(':id')
  one(@Req() req: any, @Param('id') id: string) {
    return this.branches.findOrThrow(req.user.tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new branch (chain-only — gated by entitlements at the UI level)' })
  create(
    @Req() req: any,
    @Body() body: { name?: string; code?: string; timezone?: string; address?: Record<string, unknown> },
  ) {
    return this.branches.create(req.user.tenantId, body);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; timezone?: string; address?: Record<string, unknown>; status?: string },
  ) {
    return this.branches.update(req.user.tenantId, id, body);
  }

  @Delete(':id')
  archive(@Req() req: any, @Param('id') id: string) {
    return this.branches.archive(req.user.tenantId, id);
  }
}
