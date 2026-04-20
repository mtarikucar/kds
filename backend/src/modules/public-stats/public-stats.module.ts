import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicStatsController } from './public-stats.controller';
import { PublicStatsService } from './public-stats.service';
import { GeolocationService } from './geolocation.service';

@Module({
  imports: [
    PrismaModule,
  ],
  controllers: [PublicStatsController],
  providers: [
    PublicStatsService,
    GeolocationService,
  ],
  exports: [PublicStatsService, GeolocationService],
})
export class PublicStatsModule {}
