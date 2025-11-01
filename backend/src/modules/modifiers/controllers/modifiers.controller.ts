import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseBoolPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { ModifiersService } from '../services/modifiers.service';
import { CreateModifierGroupDto } from '../dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from '../dto/update-modifier-group.dto';
import { CreateModifierDto } from '../dto/create-modifier.dto';
import { UpdateModifierDto } from '../dto/update-modifier.dto';
import { AssignModifiersToProductDto } from '../dto/assign-modifiers.dto';

@ApiTags('Modifiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('modifiers')
export class ModifiersController {
  constructor(private readonly modifiersService: ModifiersService) {}

  // ========================================
  // MODIFIER GROUPS
  // ========================================

  @Post('groups')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new modifier group' })
  async createGroup(@Body() dto: CreateModifierGroupDto, @Request() req) {
    return this.modifiersService.createGroup(dto, req.user.tenantId);
  }

  @Get('groups')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all modifier groups' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  async findAllGroups(
    @Request() req,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean
  ) {
    return this.modifiersService.findAllGroups(req.user.tenantId, includeInactive);
  }

  @Get('groups/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get a modifier group by ID' })
  async findOneGroup(@Param('id') id: string, @Request() req) {
    return this.modifiersService.findOneGroup(id, req.user.tenantId);
  }

  @Put('groups/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a modifier group' })
  async updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateModifierGroupDto,
    @Request() req
  ) {
    return this.modifiersService.updateGroup(id, dto, req.user.tenantId);
  }

  @Delete('groups/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a modifier group' })
  async deleteGroup(@Param('id') id: string, @Request() req) {
    return this.modifiersService.deleteGroup(id, req.user.tenantId);
  }

  // ========================================
  // MODIFIERS
  // ========================================

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new modifier' })
  async createModifier(@Body() dto: CreateModifierDto, @Request() req) {
    return this.modifiersService.createModifier(dto, req.user.tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all modifiers' })
  @ApiQuery({ name: 'groupId', required: false, type: String })
  @ApiQuery({ name: 'includeUnavailable', required: false, type: Boolean })
  async findAllModifiers(
    @Request() req,
    @Query('groupId') groupId?: string,
    @Query('includeUnavailable', new ParseBoolPipe({ optional: true })) includeUnavailable?: boolean
  ) {
    return this.modifiersService.findAllModifiers(req.user.tenantId, groupId, includeUnavailable);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get a modifier by ID' })
  async findOneModifier(@Param('id') id: string, @Request() req) {
    return this.modifiersService.findOneModifier(id, req.user.tenantId);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a modifier' })
  async updateModifier(
    @Param('id') id: string,
    @Body() dto: UpdateModifierDto,
    @Request() req
  ) {
    return this.modifiersService.updateModifier(id, dto, req.user.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a modifier' })
  async deleteModifier(@Param('id') id: string, @Request() req) {
    return this.modifiersService.deleteModifier(id, req.user.tenantId);
  }

  // ========================================
  // PRODUCT-MODIFIER ASSIGNMENTS
  // ========================================

  @Post('products/:productId/assign')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Assign modifier groups to a product' })
  async assignModifiersToProduct(
    @Param('productId') productId: string,
    @Body() dto: AssignModifiersToProductDto,
    @Request() req
  ) {
    return this.modifiersService.assignModifiersToProduct(productId, dto, req.user.tenantId);
  }

  @Get('products/:productId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get modifiers for a product' })
  async getProductModifiers(@Param('productId') productId: string, @Request() req) {
    return this.modifiersService.getProductModifiers(productId, req.user.tenantId);
  }

  @Delete('products/:productId/groups/:groupId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Remove a modifier group from a product' })
  async removeModifierGroupFromProduct(
    @Param('productId') productId: string,
    @Param('groupId') groupId: string,
    @Request() req
  ) {
    return this.modifiersService.removeModifierGroupFromProduct(
      productId,
      groupId,
      req.user.tenantId
    );
  }
}
