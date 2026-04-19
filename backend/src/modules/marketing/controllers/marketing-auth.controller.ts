import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingPublic, MarketingRoute } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingAuthService } from '../services/marketing-auth.service';
import { MarketingLoginDto } from '../dto/login.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { MarketingUserPayload } from '../types';

// Marketing realm carries platform-wide sales data; treating its auth
// surface as tightly as the superadmin realm is appropriate.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

@Controller('marketing/auth')
@UseGuards(MarketingGuard)
@MarketingRoute()
export class MarketingAuthController {
  constructor(private readonly authService: MarketingAuthService) {}

  @Post('login')
  @MarketingPublic()
  @Throttle(LOGIN_THROTTLE)
  login(@Body() dto: MarketingLoginDto, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    return this.authService.login(dto, ip);
  }

  @Post('refresh')
  @MarketingPublic()
  @Throttle(REFRESH_THROTTLE)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('logout')
  logout(@CurrentMarketingUser() user: MarketingUserPayload) {
    return this.authService.logout(user.id);
  }

  @Get('profile')
  getProfile(@CurrentMarketingUser() user: MarketingUserPayload) {
    return this.authService.getProfile(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentMarketingUser() user: MarketingUserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentMarketingUser() user: MarketingUserPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
