import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { LayoutsService } from './layouts.service';
import { UpdateLayoutDto } from './dto/update-layout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('layouts')
@ApiBearerAuth()
@Controller('layouts')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class LayoutsController {
  constructor(private readonly layoutsService: LayoutsService) {}

  @Get()
  @ApiOperation({ summary: 'Get restaurant floor plan layout' })
  @ApiResponse({ status: 200, description: 'Layout retrieved successfully' })
  findByTenant(@Request() req) {
    return this.layoutsService.findByTenant(req.tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update restaurant floor plan layout (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Layout updated successfully' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(@Body() updateLayoutDto: UpdateLayoutDto, @Request() req) {
    return this.layoutsService.update(req.tenantId, updateLayoutDto);
  }

  @Patch('tables/:tableId/position')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update table position in voxel world (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Table position updated' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateTablePosition(
    @Param('tableId') tableId: string,
    @Body() position: { x: number; y: number; z: number; rotation: number },
    @Request() req,
  ) {
    return this.layoutsService.updateTablePosition(req.tenantId, tableId, position);
  }

  @Get('tables/positions')
  @ApiOperation({ summary: 'Get all tables with their voxel positions' })
  @ApiResponse({ status: 200, description: 'Tables with positions retrieved' })
  getTablesWithPositions(@Request() req) {
    return this.layoutsService.getTablesWithPositions(req.tenantId);
  }
}
