import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Controllers
import {
  MarketingAuthController,
  MarketingLeadsController,
  MarketingActivitiesController,
  MarketingTasksController,
  MarketingOffersController,
  MarketingDashboardController,
  MarketingReportsController,
  MarketingUsersController,
  MarketingCommissionsController,
  MarketingNotificationsController,
} from './controllers';

// Services
import {
  MarketingAuthService,
  MarketingLeadsService,
  MarketingActivitiesService,
  MarketingTasksService,
  MarketingOffersService,
  MarketingDashboardService,
  MarketingReportsService,
  MarketingUsersService,
  MarketingCommissionsService,
  MarketingNotificationsService,
} from './services';

// Guards
import { MarketingGuard } from './guards/marketing.guard';
import { MarketingRolesGuard } from './guards/marketing-roles.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('MARKETING_JWT_SECRET');
        const refresh = configService.get<string>('MARKETING_JWT_REFRESH_SECRET');
        const tenant = configService.get<string>('JWT_SECRET');
        const tenantRefresh = configService.get<string>('JWT_REFRESH_SECRET');
        const superadmin = configService.get<string>('SUPERADMIN_JWT_SECRET');
        if (!secret || !refresh) {
          throw new Error(
            'MARKETING_JWT_SECRET and MARKETING_JWT_REFRESH_SECRET must be configured',
          );
        }
        if (secret.length < 32 || refresh.length < 32) {
          throw new Error(
            'MARKETING_JWT_SECRET / MARKETING_JWT_REFRESH_SECRET must be at least 32 chars',
          );
        }
        const others = [tenant, tenantRefresh, superadmin].filter(Boolean);
        if (secret === refresh || others.includes(secret) || others.includes(refresh)) {
          throw new Error(
            'MARKETING_JWT_SECRET / REFRESH must differ from each other and from other realms',
          );
        }
        return {
          secret,
          signOptions: { expiresIn: '8h', algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [
    MarketingAuthController,
    MarketingLeadsController,
    MarketingActivitiesController,
    MarketingTasksController,
    MarketingOffersController,
    MarketingDashboardController,
    MarketingReportsController,
    MarketingUsersController,
    MarketingCommissionsController,
    MarketingNotificationsController,
  ],
  providers: [
    // Services
    MarketingAuthService,
    MarketingLeadsService,
    MarketingActivitiesService,
    MarketingTasksService,
    MarketingOffersService,
    MarketingDashboardService,
    MarketingReportsService,
    MarketingUsersService,
    MarketingCommissionsService,
    MarketingNotificationsService,
    // Guards
    MarketingGuard,
    MarketingRolesGuard,
  ],
  exports: [
    MarketingAuthService,
    MarketingUsersService,
  ],
})
export class MarketingModule {}
