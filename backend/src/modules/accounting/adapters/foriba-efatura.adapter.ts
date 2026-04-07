import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AccountingAdapter, AccountingInvoiceData } from './accounting-adapter.interface';

export class ForibaEfaturaAdapter implements AccountingAdapter {
  readonly name = 'foriba';
  private readonly logger = new Logger(ForibaEfaturaAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({ timeout: 30000 });
  }

  async authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }> {
    const response = await this.httpClient.post(
      `${credentials.apiUrl}/token`,
      new URLSearchParams({
        grant_type: 'password',
        username: credentials.username,
        password: credentials.password,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return {
      accessToken: response.data.access_token,
      expiresAt: new Date(Date.now() + (response.data.expires_in || 3600) * 1000),
    };
  }

  async pushInvoice(token: string, _companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }> {
    const ublXml = this.generateUblTrXml(invoice);

    const response = await this.httpClient.post(
      `${this.httpClient.defaults.baseURL || 'https://api.fitbulut.com/v2'}/dispatch-invoice`,
      { content: Buffer.from(ublXml).toString('base64') },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const externalId = response.data?.uuid || response.data?.id || `foriba-${Date.now()}`;
    this.logger.log(`e-Fatura dispatched: ${externalId}`);
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

  private generateUblTrXml(invoice: AccountingInvoiceData): string {
    const uuid = crypto.randomUUID();
    const totalExcTax = invoice.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const totalTax = invoice.items.reduce((s, i) => s + (i.unitPrice * i.quantity * i.taxRate) / 100, 0);

    const lineItems = invoice.items
      .map(
        (item, index) => `
      <cac:InvoiceLine>
        <cbc:ID>${index + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${invoice.currency}">${(item.unitPrice * item.quantity).toFixed(2)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="${invoice.currency}">${((item.unitPrice * item.quantity * item.taxRate) / 100).toFixed(2)}</cbc:TaxAmount>
          <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${invoice.currency}">${(item.unitPrice * item.quantity).toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${invoice.currency}">${((item.unitPrice * item.quantity * item.taxRate) / 100).toFixed(2)}</cbc:TaxAmount>
            <cbc:Percent>${item.taxRate}</cbc:Percent>
            <cac:TaxCategory>
              <cac:TaxScheme>
                <cbc:Name>KDV</cbc:Name>
                <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
              </cac:TaxScheme>
            </cac:TaxCategory>
          </cac:TaxSubtotal>
        </cac:TaxTotal>
        <cac:Item><cbc:Name>${this.escapeXml(item.description)}</cbc:Name></cac:Item>
        <cac:Price><cbc:PriceAmount currencyID="${invoice.currency}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount></cac:Price>
      </cac:InvoiceLine>`,
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>${invoice.invoiceNumber}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${this.escapeXml(invoice.customerName || 'Musteri')}</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${totalTax.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${totalExcTax.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${totalExcTax.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${invoice.totalAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency}">${invoice.totalAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineItems}
</Invoice>`;
  }

  private escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
}
