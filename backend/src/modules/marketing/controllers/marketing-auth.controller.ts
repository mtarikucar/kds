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
    @Body() data: { firstName?: string; lastName?: string; phone?: string },
  ) {
    return this.authService.updateProfile(user.id, data);
  }

  @Post('change-password')
  changePassword(
    @CurrentMarketingUser() user: any,
    @Body() data: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(
      user.id,
      data.currentPassword,
      data.newPassword,
    );
  }
}
