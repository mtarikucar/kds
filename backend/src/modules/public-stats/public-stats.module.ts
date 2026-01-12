import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicStatsController } from './public-stats.controller';
import { PublicStatsService } from './public-stats.service';
import { GeolocationService } from './geolocation.service';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [PublicStatsController],
  providers: [
    PublicStatsService,
    GeolocationService,
  ],
  exports: [PublicStatsService, GeolocationService],
})
export class PublicStatsModule {}
