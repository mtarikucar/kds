import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { AccountingSettingsService } from "./accounting-settings.service";
import {
  AccountingAdapter,
  AccountingInvoiceData,
} from "../adapters/accounting-adapter.interface";
import { ParasutAdapter } from "../adapters/parasut.adapter";
import { ForibaEfaturaAdapter } from "../adapters/foriba-efatura.adapter";
import { LogoAdapter } from "../adapters/logo.adapter";
import { AccountingProvider } from "../constants/accounting.enum";

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

    // M4: only skip when the existing externalId is for the SAME provider.
    // After a provider swap (e.g. Parasut → Logo) the old externalId is
    // a foreign key to a different system; re-sync must run.
    if (invoice.externalId && invoice.externalProvider === settings.provider) {
      return;
    }

    // F-Acc-7: mark SYNCING before the push. If pushInvoice succeeds but
    // the local UPDATE that records externalId fails (network blip, DB
    // hiccup), the remote system has the invoice but the local row
    // doesn't know it. A retry would push a DUPLICATE invoice to the
    // remote. The SYNCING marker tells operator tooling "we already
    // initiated a push — recover the externalId from the remote rather
    // than pushing again".
    // Atomic claim — the comment below says "loser sees count===0 and
    // skips" but the original code didn't actually check `count`, so two
    // concurrent syncInvoice calls both proceeded to push and produced
    // duplicate invoices in Foriba. Honour the claim by short-circuiting
    // when the row wasn't transitioned (because another worker already
    // owned it or it's already SYNCED).
    const claim = await this.prisma.salesInvoice.updateMany({
      where: {
        id: invoiceId,
        tenantId,
        // Don't re-claim a row already mid-flight: SYNCING is itself a
        // serializing marker. If two `syncInvoice` calls race, the loser
        // sees count===0 here and skips. We also re-claim FAILED rows.
        externalStatus: { in: [null as any, "FAILED", "PENDING"] },
      },
      data: { externalStatus: "SYNCING", syncError: null },
    });
    if (claim.count === 0) {
      this.logger.debug(
        `Invoice ${invoiceId} already SYNCING/SYNCED; skipping duplicate push`,
      );
      return;
    }

    try {
      const adapter = this.getAdapter(settings.provider);
      if (!adapter) return;

      // The secret credential fields (parasutClientSecret/parasutPassword/
      // logoPassword/foribaPassword) are stored AES-256-GCM encrypted (`v1:…`).
      // findByTenant returns them encrypted; we MUST decrypt before handing
      // them to the adapter or every authenticate() fails and the invoice
      // never reaches the provider. Non-secret fields (companyId/firmNumber/
      // apiUrl) pass through unchanged.
      const creds =
        await this.settingsService.getDecryptedCredentials(tenantId);
      const token = await this.getToken(tenantId, creds ?? settings, adapter);
      const companyId = this.getCompanyId(creds ?? settings);

      const invoiceData: AccountingInvoiceData = {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate.toISOString().split("T")[0],
        dueDate: invoice.dueDate?.toISOString().split("T")[0],
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

      // Defence-in-depth: tenantId in the WHERE so a regression of the
      // SYNCING claim can't write cross-tenant.
      await this.prisma.salesInvoice.updateMany({
        where: { id: invoiceId, tenantId },
        data: {
          externalId: result.externalId,
          externalProvider: settings.provider,
          externalStatus: "SYNCED",
          syncedAt: new Date(),
          syncError: null,
        },
      });

      this.logger.log(
        `Invoice ${invoice.invoiceNumber} synced to ${settings.provider}`,
      );
    } catch (err) {
      this.logger.error(`Sync failed for invoice ${invoiceId}: ${err.message}`);
      await this.prisma.salesInvoice.updateMany({
        where: { id: invoiceId, tenantId },
        data: { syncError: err.message, externalStatus: "FAILED" },
      });
    }
  }

  async testConnection(
    tenantId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Decrypt the stored secrets before testing — testing with the raw `v1:…`
    // blob would always fail even when the operator entered correct creds.
    const settings =
      (await this.settingsService.getDecryptedCredentials(tenantId)) ??
      (await this.settingsService.findByTenant(tenantId));
    const adapter = this.getAdapter(settings.provider);
    if (!adapter) return { success: false, error: "No provider configured" };

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
      case AccountingProvider.PARASUT:
        return new ParasutAdapter();
      case AccountingProvider.FORIBA:
        return new ForibaEfaturaAdapter();
      case AccountingProvider.LOGO:
        return new LogoAdapter();
      default:
        return null;
    }
  }

  private async getToken(
    tenantId: string,
    settings: any,
    adapter: AccountingAdapter,
  ): Promise<string> {
    const cacheKey = `${tenantId}:${adapter.name}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) return cached.token;

    const credentials = this.getCredentials(settings);
    const result = await adapter.authenticate(credentials);
    this.tokenCache.set(cacheKey, {
      token: result.accessToken,
      expiresAt: result.expiresAt || new Date(Date.now() + 7200000),
    });
    return result.accessToken;
  }

  private getCredentials(settings: any): Record<string, string> {
    switch (settings.provider) {
      case AccountingProvider.PARASUT:
        return {
          clientId: settings.parasutClientId || "",
          clientSecret: settings.parasutClientSecret || "",
          username: settings.parasutUsername || "",
          password: settings.parasutPassword || "",
        };
      case AccountingProvider.LOGO:
        return {
          apiUrl: settings.logoApiUrl || "",
          username: settings.logoUsername || "",
          password: settings.logoPassword || "",
          firmNumber: settings.logoFirmNumber || "",
        };
      case AccountingProvider.FORIBA:
        return {
          apiUrl: settings.foribaApiUrl || "",
          username: settings.foribaUsername || "",
          password: settings.foribaPassword || "",
        };
      default:
        return {};
    }
  }

  private getCompanyId(settings: any): string {
    switch (settings.provider) {
      case AccountingProvider.PARASUT:
        return settings.parasutCompanyId || "";
      case AccountingProvider.LOGO:
        return settings.logoFirmNumber || "";
      default:
        return "";
    }
  }
}
