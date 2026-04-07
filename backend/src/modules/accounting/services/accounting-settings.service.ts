import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAccountingSettingsDto } from '../dto/accounting-settings.dto';

@Injectable()
export class AccountingSettingsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    return this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  }

  async update(tenantId: string, dto: UpdateAccountingSettingsDto) {
    return this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: dto,
      create: { tenantId, ...dto },
    });
  }

  sanitize(settings: any) {
    const {
      parasutClientSecret, parasutPassword,
      logoPassword, foribaPassword,
      ...safe
    } = settings;
    return {
      ...safe,
      hasParasutCredentials: !!(parasutClientSecret && settings.parasutUsername),
      hasLogoCredentials: !!(logoPassword && settings.logoUsername),
      hasForibaCredentials: !!(foribaPassword && settings.foribaUsername),
    };
  }

  async getNextInvoiceNumber(tenantId: string): Promise<string> {
    const settings = await this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: { nextInvoiceNumber: { increment: 1 } },
      create: { tenantId, nextInvoiceNumber: 2 },
    });

    const prefix = settings.invoicePrefix || 'FTR';
    const num = (settings.nextInvoiceNumber || 2) - 1; // We incremented, so subtract 1 to get current
    return `${prefix}-${String(num).padStart(6, '0')}`;
  }
}
