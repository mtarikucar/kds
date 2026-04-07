import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomersModule } from '../customers/customers.module';
import { SmsSettingsController } from './sms-settings.controller';
import { SmsSettingsService } from './sms-settings.service';
import { SmsNotificationService } from './sms-notification.service';

@Module({
  imports: [PrismaModule, CustomersModule],
  controllers: [SmsSettingsController],
  providers: [SmsSettingsService, SmsNotificationService],
  exports: [SmsSettingsService, SmsNotificationService],
})
export class SmsSettingsModule {}
