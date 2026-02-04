import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
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
