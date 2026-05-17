import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { SuperAdminUsersService } from '../services/superadmin-users.service';
import { UserFilterDto, UserActivityFilterDto } from '../dto/user-filter.dto';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminRoute } from '../decorators/superadmin.decorator';

class SetEmailVerifiedDto {
  @IsBoolean()
  emailVerified!: boolean;
}

@ApiTags('SuperAdmin Users')
@Controller('superadmin/users')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminUsersController {
  constructor(private readonly usersService: SuperAdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users across tenants' })
  async findAll(@Query() filters: UserFilterDto) {
    return this.usersService.findAll(filters);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Get user activity logs (login/logout)' })
  async getActivity(@Query() filters: UserActivityFilterDto) {
    return this.usersService.getActivity(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user details' })
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id/email-verification')
  @ApiOperation({
    summary:
      'Toggle a user\'s emailVerified flag. Used by support to bypass the email-verify step ' +
      'when a tenant\'s mail relay is broken, and by E2E tests to satisfy the payments-intent gate.',
  })
  async setEmailVerified(@Param('id') id: string, @Body() dto: SetEmailVerifiedDto) {
    return this.usersService.setEmailVerified(id, dto.emailVerified);
  }
}
