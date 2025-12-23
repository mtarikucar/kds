import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ZReportsController } from './z-reports.controller';
import { ZReportsService } from './z-reports.service';
import { ZReportSchedulerService } from './services/z-report-scheduler.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), CommonModule],
  controllers: [ZReportsController],
  providers: [ZReportsService, ZReportSchedulerService],
  exports: [ZReportsService],
})
export class ZReportsModule {}
