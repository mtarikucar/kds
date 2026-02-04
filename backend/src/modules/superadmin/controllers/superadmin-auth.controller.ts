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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { SuperAdminAuthService } from '../services/superadmin-auth.service';
import { SuperAdminLoginDto } from '../dto/login.dto';
import { Verify2FADto, Enable2FADto } from '../dto/verify-2fa.dto';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminPublic, SuperAdminRoute } from '../decorators/superadmin.decorator';
import { CurrentSuperAdmin } from '../decorators/current-superadmin.decorator';

@ApiTags('SuperAdmin Auth')
@Controller('superadmin/auth')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
export class SuperAdminAuthController {
  constructor(private readonly authService: SuperAdminAuthService) {}

  @Post('login')
  @SuperAdminPublic()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SuperAdmin login' })
  async login(@Body() loginDto: SuperAdminLoginDto, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    return this.authService.login(loginDto, ip, userAgent);
  }

  @Post('verify-2fa')
  @SuperAdminPublic()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify 2FA code' })
  async verify2FA(@Body() verify2FADto: Verify2FADto, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    return this.authService.verify2FA(verify2FADto, ip, userAgent);
  }

  @Get('2fa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get 2FA setup QR code (authenticated)' })
  async setup2FA(@CurrentSuperAdmin('id') superAdminId: string) {
    return this.authService.setup2FA(superAdminId);
  }

  @Post('2fa/setup-with-token')
  @SuperAdminPublic()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get 2FA setup QR code using temp token' })
  async setup2FAWithToken(@Body('tempToken') tempToken: string) {
    return this.authService.setup2FAWithToken(tempToken);
  }

  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable 2FA with verification code (authenticated)' })
  async enable2FA(
    @CurrentSuperAdmin('id') superAdminId: string,
    @Body() enable2FADto: Enable2FADto,
  ) {
    return this.authService.enable2FA(superAdminId, enable2FADto);
  }

  @Post('2fa/enable-with-token')
  @SuperAdminPublic()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable 2FA with verification code using temp token' })
  async enable2FAWithToken(
    @Body('tempToken') tempToken: string,
    @Body('code') code: string,
  ) {
    return this.authService.enable2FAWithToken(tempToken, code);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SuperAdmin logout' })
  async logout(@CurrentSuperAdmin('id') superAdminId: string, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    return this.authService.logout(superAdminId, ip, userAgent);
  }

  @Post('refresh')
  @SuperAdminPublic()
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
