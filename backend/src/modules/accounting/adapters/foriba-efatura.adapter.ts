import { Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import {
  AccountingAdapter,
  AccountingInvoiceData,
} from "./accounting-adapter.interface";

export class ForibaEfaturaAdapter implements AccountingAdapter {
  readonly name = "foriba";
  private readonly logger = new Logger(ForibaEfaturaAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({ timeout: 30000 });
  }

  async authenticate(
    credentials: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    const response = await this.httpClient.post(
      `${credentials.apiUrl}/token`,
      new URLSearchParams({
        grant_type: "password",
        username: credentials.username,
        password: credentials.password,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    return {
      accessToken: response.data.access_token,
      expiresAt: new Date(
        Date.now() + (response.data.expires_in || 3600) * 1000,
      ),
    };
  }

  async pushInvoice(
    token: string,
    _companyId: string,
    invoice: AccountingInvoiceData,
  ): Promise<{ externalId: string }> {
    const ublXml = this.generateUblTrXml(invoice);

    const response = await this.httpClient.post(
      `${this.httpClient.defaults.baseURL || "https://api.fitbulut.com/v2"}/dispatch-invoice`,
      { content: Buffer.from(ublXml).toString("base64") },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    // Honesty: only treat the dispatch as successful when the provider
    // actually returned an identifier. Minting a synthetic `foriba-<ts>`
    // id would mark the invoice SYNCED while nothing was accepted upstream
    // — silently masking a real failure. No id ⇒ throw so the sync path
    // records it as FAILED (with the error) instead.
    const externalId = response.data?.uuid || response.data?.id;
    if (!externalId) {
      this.logger.error(
        `e-Fatura dispatch returned no uuid/id for invoice ${invoice.invoiceNumber}; treating as failure`,
      );
      throw new Error(
        "Foriba e-Fatura dispatch returned no invoice id (uuid/id missing)",
      );
    }
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
    // Profile selection: e-Fatura (B2B) → TICARIFATURA, e-Arşiv (B2C) →
    // EARSIVFATURA. Was hardcoded to TICARIFATURA, which GİB rejects for a
    // final-consumer sale. Defaults to e-Arşiv when the type wasn't resolved.
    const profileId =
      invoice.eDocumentType === "EFATURA" ? "TICARIFATURA" : "EARSIVFATURA";

    // UBL-TR rejects XML where header totals don't match the line items
    // bit-for-bit. JS Number was accumulating rounding error across the
    // reduce + per-line calculations, so the tax authority bounced random
    // submissions back. Stay in Prisma.Decimal end-to-end and only call
    // toFixed(2) at serialization time.
    const lineTotals = invoice.items.map((i) => {
      const qty = new Prisma.Decimal(i.quantity);
      const unit = new Prisma.Decimal(i.unitPrice);
      const rate = new Prisma.Decimal(i.taxRate);
      const lineExt = unit.mul(qty);
      const lineTax = lineExt.mul(rate).div(100);
      return { lineExt, lineTax, rate, unit, qty, item: i };
    });

    const totalExcTax = lineTotals.reduce<Prisma.Decimal>(
      (s, l) => s.add(l.lineExt),
      new Prisma.Decimal(0),
    );
    const totalTax = lineTotals.reduce<Prisma.Decimal>(
      (s, l) => s.add(l.lineTax),
      new Prisma.Decimal(0),
    );

    // KDV tevkifatı — when the buyer withholds part of the VAT, emit a
    // WithholdingTaxTotal and reduce the payable by the withheld amount.
    const withheld =
      invoice.withholdingTaxAmount != null
        ? new Prisma.Decimal(invoice.withholdingTaxAmount)
        : new Prisma.Decimal(0);
    const payable = new Prisma.Decimal(invoice.totalAmount).sub(withheld);
    const withholdingXml = withheld.gt(0)
      ? `
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${withheld.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxAmount currencyID="${invoice.currency}">${withheld.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV Tevkifati</cbc:Name>
          <cbc:TaxTypeCode>${this.escapeXml(invoice.withholdingCode || "")}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>`
      : "";

    const lineItems = lineTotals
      .map(
        ({ lineExt, lineTax, rate, unit, qty, item }, index) => `
      <cac:InvoiceLine>
        <cbc:ID>${index + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="C62">${qty.toString()}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${invoice.currency}">${lineExt.toFixed(2)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="${invoice.currency}">${lineTax.toFixed(2)}</cbc:TaxAmount>
          <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${invoice.currency}">${lineExt.toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${invoice.currency}">${lineTax.toFixed(2)}</cbc:TaxAmount>
            <cbc:Percent>${rate.toString()}</cbc:Percent>
            <cac:TaxCategory>
              <cac:TaxScheme>
                <cbc:Name>KDV</cbc:Name>
                <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
              </cac:TaxScheme>
            </cac:TaxCategory>
          </cac:TaxSubtotal>
        </cac:TaxTotal>
        <cac:Item><cbc:Name>${this.escapeXml(item.description)}</cbc:Name></cac:Item>
        <cac:Price><cbc:PriceAmount currencyID="${invoice.currency}">${unit.toFixed(2)}</cbc:PriceAmount></cac:Price>
      </cac:InvoiceLine>`,
      )
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${profileId}</cbc:ProfileID>
  <cbc:ID>${invoice.invoiceNumber}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
${this.supplierPartyXml(invoice)}
${this.customerPartyXml(invoice)}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${totalTax.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>${withholdingXml}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${totalExcTax.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${totalExcTax.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${new Prisma.Decimal(invoice.totalAmount).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency}">${payable.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineItems}
</Invoice>`;
  }

  /**
   * cac:AccountingCustomerParty — the buyer (alıcı) block. e-Fatura (B2B)
   * REQUIRES a PartyTaxScheme carrying the buyer VKN/TCKN + tax office; the
   * pre-fix code emitted only a "Musteri" placeholder name, so GİB rejected
   * every B2B invoice. e-Arşiv (B2C, final consumer) can carry just the name.
   * The tax scheme is emitted only when a tax id is present.
   */
  private customerPartyXml(invoice: AccountingInvoiceData): string {
    const name = invoice.customerName?.trim() || "Musteri";
    const taxId = invoice.customerTaxId?.trim();
    const taxOffice = invoice.customerTaxOffice?.trim();
    const taxSchemeXml = taxId
      ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${this.escapeXml(taxId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:Name>${this.escapeXml(taxOffice || "")}</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>`
      : "";
    return `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${this.escapeXml(name)}</cbc:Name></cac:PartyName>${taxSchemeXml}
    </cac:Party>
  </cac:AccountingCustomerParty>`;
  }

  /**
   * cac:AccountingSupplierParty — the seller (satıcı) block. A valid UBL-TR
   * document REQUIRES a supplier party; pre-fix the issuer identity the
   * operator configured in Accounting "Company Info" was never emitted, so
   * the XML carried no seller at all. Built from the seller* fields
   * snapshotted onto the invoice. PartyTaxScheme/TaxScheme/Name carries the
   * tax office (vergi dairesi); CompanyID under PartyTaxScheme is the VKN.
   * Optional sub-elements are omitted when blank rather than emitting empty
   * tags. When no seller name/VKN is configured we emit a minimal party with
   * a "Satici" placeholder so the document still validates structurally.
   */
  private supplierPartyXml(invoice: AccountingInvoiceData): string {
    const name = invoice.sellerName?.trim();
    const vkn = invoice.sellerTaxId?.trim();
    const taxOffice = invoice.sellerTaxOffice?.trim();
    const address = invoice.sellerAddress?.trim();
    const phone = invoice.sellerPhone?.trim();
    const email = invoice.sellerEmail?.trim();

    const taxSchemeXml = vkn
      ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${this.escapeXml(vkn)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:Name>${this.escapeXml(taxOffice || "")}</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>`
      : "";
    const addressXml = address
      ? `
      <cac:PostalAddress><cbc:StreetName>${this.escapeXml(address)}</cbc:StreetName></cac:PostalAddress>`
      : "";
    const contactXml =
      phone || email
        ? `
      <cac:Contact>${
        phone ? `<cbc:Telephone>${this.escapeXml(phone)}</cbc:Telephone>` : ""
      }${
        email
          ? `<cbc:ElectronicMail>${this.escapeXml(email)}</cbc:ElectronicMail>`
          : ""
      }</cac:Contact>`
        : "";

    return `  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${this.escapeXml(name || "Satici")}</cbc:Name></cac:PartyName>${taxSchemeXml}${addressXml}${contactXml}
    </cac:Party>
  </cac:AccountingSupplierParty>`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
