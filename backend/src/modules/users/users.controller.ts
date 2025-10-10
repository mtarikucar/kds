import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { SubscriptionLimitsGuard } from '../../common/guards/subscription-limits.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CheckLimit } from '../../common/decorators/check-limit.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @UseGuards(SubscriptionLimitsGuard)
  @CheckLimit({ resource: 'users', action: 'create' })
  @ApiOperation({ summary: 'Create a new user (ADMIN, MANAGER)' })
  @ApiResponse({ status: 201, description: 'User successfully created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions or limit reached' })
  create(@Body() createUserDto: CreateUserDto, @Request() req) {
    return this.usersService.create(createUserDto, req.tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all users (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'List of all users' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findAll(@Request() req) {
    return this.usersService.findAll(req.tenantId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a user by ID (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.usersService.findOne(id, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a user (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'User successfully updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Request() req) {
    return this.usersService.update(id, updateUserDto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a user (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'User successfully deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    return this.usersService.remove(id, req.tenantId);
  }
}
