import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { SuperAdminAuthService } from '../services/superadmin-auth.service';
import { SuperAdminLoginDto } from '../dto/login.dto';
import {
  Verify2FADto,
  Enable2FADto,
  Disable2FADto,
  RegenerateBackupCodesDto,
} from '../dto/verify-2fa.dto';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminPublic, SuperAdminRoute } from '../decorators/superadmin.decorator';
import { CurrentSuperAdmin } from '../decorators/current-superadmin.decorator';

// Aggressive per-endpoint throttle budgets. Superadmin routes are the
// highest-privilege surface in the product — treating them tighter than
// tenant auth is appropriate.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const VERIFY_2FA_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('SuperAdmin Auth')
@Controller('superadmin/auth')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
export class SuperAdminAuthController {
  constructor(private readonly authService: SuperAdminAuthService) {}

  @Post('login')
  @SuperAdminPublic()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SuperAdmin login (requires 2FA already enrolled)' })
  async login(@Body() loginDto: SuperAdminLoginDto, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    return this.authService.login(loginDto, ip, userAgent);
  }

  @Post('verify-2fa')
  @SuperAdminPublic()
  @Throttle(VERIFY_2FA_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify 2FA code or backup code' })
  async verify2FA(@Body() verify2FADto: Verify2FADto, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    return this.authService.verify2FA(verify2FADto, ip, userAgent);
  }

  // 2FA lifecycle is fully authenticated now. The prior
  // setup-with-token / enable-with-token endpoints were removed because
  // they let anyone with the password self-enroll 2FA and log in.
  @Get('2fa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Begin 2FA setup (authenticated)' })
  async setup2FA(@CurrentSuperAdmin('id') superAdminId: string) {
    return this.authService.setup2FA(superAdminId);
  }

  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm 2FA setup; returns one-time backup codes' })
  async enable2FA(
    @CurrentSuperAdmin('id') superAdminId: string,
    @Body() enable2FADto: Enable2FADto,
  ) {
    return this.authService.enable2FA(superAdminId, enable2FADto);
  }

  @Post('2fa/disable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA (requires current password + TOTP)' })
  async disable2FA(
    @CurrentSuperAdmin('id') superAdminId: string,
    @Body() dto: Disable2FADto,
  ) {
    return this.authService.disable2FA(superAdminId, dto.currentPassword, dto.code);
  }

  @Post('2fa/regenerate-backup-codes')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate 2FA backup codes (invalidates old ones)' })
  async regenerateBackupCodes(
    @CurrentSuperAdmin('id') superAdminId: string,
    @Body() dto: RegenerateBackupCodesDto,
  ) {
    return this.authService.regenerateBackupCodes(superAdminId, dto.code);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SuperAdmin logout (revokes all tokens)' })
  async logout(@CurrentSuperAdmin('id') superAdminId: string, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    return this.authService.logout(superAdminId, ip, userAgent);
  }

  @Post('refresh')
  @SuperAdminPublic()
  @Throttle(REFRESH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current SuperAdmin profile' })
  async getProfile(@CurrentSuperAdmin() superAdmin: any) {
    return superAdmin;
  }
}
