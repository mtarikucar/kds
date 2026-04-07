import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxCalculationService } from './services/tax-calculation.service';

@Module({
  imports: [PrismaModule],
  providers: [TaxCalculationService],
  exports: [TaxCalculationService],
})
export class AccountingModule {}
