import { Controller, Get, Post, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { IngredientMovementsService } from '../services/ingredient-movements.service';
import { CreateIngredientMovementDto } from '../dto/create-ingredient-movement.dto';

@ApiTags('stock-management/movements')
@ApiBearerAuth()
@Controller('stock-management/movements')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class IngredientMovementsController {
  constructor(private readonly service: IngredientMovementsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all ingredient movements' })
  @ApiQuery({ name: 'stockItemId', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  findAll(
    @Request() req,
    @Query('stockItemId') stockItemId?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.findAll(req.tenantId, { stockItemId, type, startDate, endDate });
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a manual ingredient movement' })
  create(@Body() dto: CreateIngredientMovementDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }
}
