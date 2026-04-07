import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AccountingAdapter, AccountingInvoiceData } from './accounting-adapter.interface';

export class ParasutAdapter implements AccountingAdapter {
  readonly name = 'parasut';
  private readonly logger = new Logger(ParasutAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: 'https://api.parasut.com',
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }> {
    const response = await this.httpClient.post('/oauth/token', {
      grant_type: 'password',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      username: credentials.username,
      password: credentials.password,
    });

    const expiresAt = new Date(Date.now() + (response.data.expires_in || 7200) * 1000);
    return { accessToken: response.data.access_token, expiresAt };
  }

  async pushInvoice(token: string, companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }> {
    const invoiceData: any = {
      data: {
        type: 'sales_invoices',
        attributes: {
          item_type: 'invoice',
          description: `Siparis Faturasi - ${invoice.invoiceNumber}`,
          issue_date: invoice.issueDate,
          due_date: invoice.dueDate || invoice.issueDate,
          invoice_series: invoice.invoiceNumber.split('-')[0] || 'FTR',
          invoice_id: parseInt(invoice.invoiceNumber.replace(/\D/g, '')) || 1,
          currency: invoice.currency || 'TRY',
          payment_status: invoice.paymentMethod ? 'paid' : 'unpaid',
        },
        relationships: {},
      },
    };

    // Create or find contact
    if (invoice.customerName) {
      try {
        const contactId = await this.findOrCreateContact(token, companyId, {
          name: invoice.customerName,
          taxNumber: invoice.customerTaxId,
          taxOffice: invoice.customerTaxOffice,
        });
        if (contactId) {
          invoiceData.data.relationships.contact = {
            data: { id: contactId, type: 'contacts' },
          };
        }
      } catch (err) {
        this.logger.warn(`Contact creation failed: ${err.message}`);
      }
    }

    const response = await this.httpClient.post(
      `/v4/${companyId}/sales_invoices`,
      invoiceData,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const salesInvoiceId = response.data.data.id;

    // Add line items
    for (const item of invoice.items) {
      await this.httpClient.post(
        `/v4/${companyId}/sales_invoices/${salesInvoiceId}/relationships/details`,
        {
          data: {
            type: 'sales_invoice_details',
            attributes: {
              quantity: item.quantity,
              unit_price: item.unitPrice,
              vat_rate: item.taxRate,
              description: item.description,
            },
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    }

    this.logger.log(`Parasut invoice created: ${salesInvoiceId}`);
    return { externalId: salesInvoiceId };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    try {
      await this.authenticate(credentials);
      return true;
    } catch {
      return false;
    }
  }

  private async findOrCreateContact(
    token: string, companyId: string,
    contact: { name: string; taxNumber?: string; taxOffice?: string },
  ): Promise<string | undefined> {
    try {
      const searchResponse = await this.httpClient.get(
        `/v4/${companyId}/contacts?filter[name]=${encodeURIComponent(contact.name)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (searchResponse.data.data?.length > 0) {
        return searchResponse.data.data[0].id;
      }

      const createResponse = await this.httpClient.post(
        `/v4/${companyId}/contacts`,
        {
          data: {
            type: 'contacts',
            attributes: {
              name: contact.name,
              contact_type: 'customer',
              tax_number: contact.taxNumber,
              tax_office: contact.taxOffice,
            },
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      return createResponse.data.data.id;
    } catch (err) {
      this.logger.warn(`Contact operation failed: ${err.message}`);
      return undefined;
    }
  }
}
