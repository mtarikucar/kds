import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto, UpdateEmailDto } from './dto/update-profile.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SubscriptionLimitsGuard } from '../../common/guards/subscription-limits.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CheckLimit } from '../../common/decorators/check-limit.decorator';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * JwtAuthGuard, TenantGuard, and RolesGuard are registered globally via
 * APP_GUARD in AuthModule — controller-level @UseGuards for them would
 * only cause the same guards to run twice.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
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
  create(
    @Body() createUserDto: CreateUserDto,
    @Request() req,
    @CurrentUser() actor: { id: string; role: string },
  ) {
    return this.usersService.create(createUserDto, req.tenantId, actor);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all users (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  findAll(
    @Request() req,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.findAll(req.tenantId, {
      status,
      role,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a user by ID (ADMIN, MANAGER)' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.usersService.findOne(id, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a user (ADMIN, MANAGER; role changes ADMIN-only)' })
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req,
    @CurrentUser() actor: { id: string; role: string },
  ) {
    return this.usersService.update(id, updateUserDto, req.tenantId, actor);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Soft delete a user (ADMIN, MANAGER)' })
  remove(
    @Param('id') id: string,
    @Request() req,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.remove(id, req.tenantId, actorId);
  }

  // Profile endpoints (all authenticated users)
  @Get('me/profile')
  @ApiOperation({ summary: 'Get current user profile' })
  getMyProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getMyProfile(userId);
  }

  @Patch('me/profile')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMyProfile(
    @CurrentUser('id') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Patch('me/email')
  @ApiOperation({ summary: 'Update user email (requires password)' })
  updateMyEmail(
    @CurrentUser('id') userId: string,
    @Body() updateEmailDto: UpdateEmailDto,
  ) {
    return this.usersService.updateEmail(userId, updateEmailDto);
  }

  @Patch(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Approve a pending user (ADMIN, MANAGER)' })
  approveUser(
    @Param('id') id: string,
    @CurrentUser('id') approverId: string,
    @Request() req,
  ) {
    return this.usersService.approveUser(id, approverId, req.tenantId);
  }

  @Patch(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reject a pending user (ADMIN, MANAGER)' })
  rejectUser(@Param('id') id: string, @Request() req) {
    return this.usersService.rejectUser(id, req.tenantId);
  }

  @Patch(':id/reactivate')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @UseGuards(SubscriptionLimitsGuard)
  @CheckLimit({ resource: 'users', action: 'create' })
  @ApiOperation({ summary: 'Reactivate an inactive user (ADMIN, MANAGER)' })
  reactivateUser(
    @Param('id') id: string,
    @Request() req,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.reactivateUser(id, req.tenantId, actorId);
  }

  // Onboarding endpoints
  @Get('me/onboarding')
  @ApiOperation({ summary: 'Get current user onboarding data' })
  getMyOnboarding(@CurrentUser('id') userId: string) {
    return this.usersService.getOnboarding(userId);
  }

  @Patch('me/onboarding')
  @ApiOperation({ summary: 'Update current user onboarding data' })
  updateMyOnboarding(
    @CurrentUser('id') userId: string,
    @Body() updateOnboardingDto: UpdateOnboardingDto,
  ) {
    return this.usersService.updateOnboarding(userId, updateOnboardingDto);
  }
}
