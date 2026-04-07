import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxCalculationService } from './services/tax-calculation.service';
import { AccountingSettingsService } from './services/accounting-settings.service';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { AccountingSettingsController } from './controllers/accounting-settings.controller';
import { SalesInvoiceController } from './controllers/sales-invoice.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AccountingSettingsController, SalesInvoiceController],
  providers: [TaxCalculationService, AccountingSettingsService, SalesInvoiceService],
  exports: [TaxCalculationService, AccountingSettingsService, SalesInvoiceService],
})
export class AccountingModule {}
