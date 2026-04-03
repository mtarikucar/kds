import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingPublic } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingAuthService } from '../services/marketing-auth.service';
import { MarketingLoginDto } from '../dto/login.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';

@Controller('marketing/auth')
@UseGuards(MarketingGuard)
export class MarketingAuthController {
  constructor(private readonly authService: MarketingAuthService) {}

  @Post('login')
  @MarketingPublic()
  login(@Body() dto: MarketingLoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @MarketingPublic()
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('profile')
  getProfile(@CurrentMarketingUser() user: any) {
    return this.authService.getProfile(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentMarketingUser() user: any,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentMarketingUser() user: any,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
