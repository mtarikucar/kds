import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsGateway } from './gateways/analytics.gateway';
import {
  MockDataGeneratorService,
  HeatmapService,
  TableAnalyticsService,
  InsightsService,
  CameraService,
} from './services';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is not configured');
        }
        return {
          secret,
          signOptions: { expiresIn: '7d', algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [AnalyticsController],
  providers: [
    MockDataGeneratorService,
    HeatmapService,
    TableAnalyticsService,
    InsightsService,
    CameraService,
    AnalyticsGateway,
  ],
  exports: [
    MockDataGeneratorService,
    HeatmapService,
    TableAnalyticsService,
    InsightsService,
    CameraService,
    AnalyticsGateway,
  ],
})
export class AnalyticsModule {}
