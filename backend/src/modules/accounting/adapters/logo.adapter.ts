import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AccountingAdapter, AccountingInvoiceData } from './accounting-adapter.interface';

export class LogoAdapter implements AccountingAdapter {
  readonly name = 'logo';
  private readonly logger = new Logger(LogoAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({ timeout: 15000 });
  }

  async authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }> {
    this.httpClient.defaults.baseURL = credentials.apiUrl;
    const response = await this.httpClient.post('/api/v1/token', {
      username: credentials.username,
      password: credentials.password,
      firmNumber: parseInt(credentials.firmNumber) || 1,
    });

    return {
      accessToken: response.data.token || response.data.access_token,
      expiresAt: new Date(Date.now() + 3600000),
    };
  }

  async pushInvoice(token: string, _companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }> {
    const logoInvoice = {
      TYPE: 7,
      NUMBER: invoice.invoiceNumber,
      DATE: invoice.issueDate,
      DOC_NUMBER: invoice.invoiceNumber,
      ARP_CODE: invoice.customerTaxId || '',
      TOTAL_NET: invoice.totalAmount,
      TRANSACTIONS: {
        items: invoice.items.map((item, index) => ({
          TYPE: 0,
          QUANTITY: item.quantity,
          PRICE: item.unitPrice,
          VAT_RATE: item.taxRate,
          DESCRIPTION: item.description,
          SOURCEINDEX: index,
        })),
      },
    };

    const response = await this.httpClient.post('/api/v1/salesInvoices', logoInvoice, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const externalId = response.data?.INTERNAL_REFERENCE?.toString() || `logo-${Date.now()}`;
    this.logger.log(`Logo invoice created: ${externalId}`);
    return { externalId };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    try {
      await this.authenticate(credentials);
      return true;
    } catch {
      return false;
    }
  }
}
