import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { KdsModule } from '../kds/kds.module';
import { AttendanceController } from './controllers/attendance.controller';
import { ShiftTemplatesController } from './controllers/shift-templates.controller';
import { ScheduleController } from './controllers/schedule.controller';
import { ShiftSwapController } from './controllers/shift-swap.controller';
import { PerformanceController } from './controllers/performance.controller';
import { AttendanceService } from './services/attendance.service';
import { ShiftTemplatesService } from './services/shift-templates.service';
import { ScheduleService } from './services/schedule.service';
import { ShiftSwapService } from './services/shift-swap.service';
import { PerformanceService } from './services/performance.service';

@Module({
  imports: [PrismaModule, SubscriptionsModule, KdsModule],
  controllers: [
    AttendanceController,
    ShiftTemplatesController,
    ScheduleController,
    ShiftSwapController,
    PerformanceController,
  ],
  providers: [
    AttendanceService,
    ShiftTemplatesService,
    ScheduleService,
    ShiftSwapService,
    PerformanceService,
  ],
  exports: [
    AttendanceService,
    ShiftTemplatesService,
    ScheduleService,
    ShiftSwapService,
    PerformanceService,
  ],
})
export class PersonnelModule {}
