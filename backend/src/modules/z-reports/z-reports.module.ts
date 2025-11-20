import { Module } from '@nestjs/common';
import { ZReportsController } from './z-reports.controller';
import { ZReportsService } from './z-reports.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ZReportsController],
  providers: [ZReportsService],
  exports: [ZReportsService],
})
export class ZReportsModule {}
