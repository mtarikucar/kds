import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { AccountingAdapter, AccountingInvoiceData } from '../adapters/accounting-adapter.interface';
import { ParasutAdapter } from '../adapters/parasut.adapter';
import { ForibaEfaturaAdapter } from '../adapters/foriba-efatura.adapter';
import { LogoAdapter } from '../adapters/logo.adapter';
import { AccountingProvider } from '../constants/accounting.enum';

@Injectable()
export class AccountingSyncService {
  private readonly logger = new Logger(AccountingSyncService.name);
  private tokenCache = new Map<string, { token: string; expiresAt: Date }>();

  constructor(
    private prisma: PrismaService,
    private settingsService: AccountingSettingsService,
  ) {}

  async syncInvoice(invoiceId: string, tenantId: string): Promise<void> {
    const settings = await this.settingsService.findByTenant(tenantId);
    if (settings.provider === AccountingProvider.NONE) return;

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { items: true },
    });
    if (!invoice) return;
    if (invoice.externalId) return;

    try {
      const adapter = this.getAdapter(settings.provider);
      if (!adapter) return;

      const token = await this.getToken(tenantId, settings, adapter);
      const companyId = this.getCompanyId(settings);

      const invoiceData: AccountingInvoiceData = {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate.toISOString().split('T')[0],
        dueDate: invoice.dueDate?.toISOString().split('T')[0],
        customerName: invoice.customerName || undefined,
        customerTaxId: invoice.customerTaxId || undefined,
        customerTaxOffice: invoice.customerTaxOffice || undefined,
        currency: invoice.currency,
        paymentMethod: invoice.paymentMethod || undefined,
        totalAmount: Number(invoice.totalAmount),
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          taxRate: item.taxRate,
        })),
      };

      const result = await adapter.pushInvoice(token, companyId, invoiceData);

      await this.prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          externalId: result.externalId,
          externalProvider: settings.provider,
          externalStatus: 'SYNCED',
          syncedAt: new Date(),
          syncError: null,
        },
      });

      this.logger.log(`Invoice ${invoice.invoiceNumber} synced to ${settings.provider}`);
    } catch (err) {
      this.logger.error(`Sync failed for invoice ${invoiceId}: ${err.message}`);
      await this.prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: { syncError: err.message, externalStatus: 'FAILED' },
      });
    }
  }

  async testConnection(tenantId: string): Promise<{ success: boolean; error?: string }> {
    const settings = await this.settingsService.findByTenant(tenantId);
    const adapter = this.getAdapter(settings.provider);
    if (!adapter) return { success: false, error: 'No provider configured' };

    try {
      const credentials = this.getCredentials(settings);
      const success = await adapter.testConnection(credentials);
      return { success };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  private getAdapter(provider: string): AccountingAdapter | null {
    switch (provider) {
      case AccountingProvider.PARASUT: return new ParasutAdapter();
      case AccountingProvider.FORIBA: return new ForibaEfaturaAdapter();
      case AccountingProvider.LOGO: return new LogoAdapter();
      default: return null;
    }
  }

  private async getToken(tenantId: string, settings: any, adapter: AccountingAdapter): Promise<string> {
    const cached = this.tokenCache.get(tenantId);
    if (cached && cached.expiresAt > new Date()) return cached.token;

    const credentials = this.getCredentials(settings);
    const result = await adapter.authenticate(credentials);
    this.tokenCache.set(tenantId, {
      token: result.accessToken,
      expiresAt: result.expiresAt || new Date(Date.now() + 7200000),
    });
    return result.accessToken;
  }

  private getCredentials(settings: any): Record<string, string> {
    switch (settings.provider) {
      case AccountingProvider.PARASUT:
        return {
          clientId: settings.parasutClientId || '',
          clientSecret: settings.parasutClientSecret || '',
          username: settings.parasutUsername || '',
          password: settings.parasutPassword || '',
        };
      case AccountingProvider.LOGO:
        return {
          apiUrl: settings.logoApiUrl || '',
          username: settings.logoUsername || '',
          password: settings.logoPassword || '',
          firmNumber: settings.logoFirmNumber || '',
        };
      case AccountingProvider.FORIBA:
        return {
          apiUrl: settings.foribaApiUrl || '',
          username: settings.foribaUsername || '',
          password: settings.foribaPassword || '',
        };
      default: return {};
    }
  }

  private getCompanyId(settings: any): string {
    switch (settings.provider) {
      case AccountingProvider.PARASUT: return settings.parasutCompanyId || '';
      case AccountingProvider.LOGO: return settings.logoFirmNumber || '';
      default: return '';
    }
  }
}
