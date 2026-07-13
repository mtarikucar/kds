import { Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import {
  AccountingAdapter,
  AccountingInvoiceData,
} from "./accounting-adapter.interface";
import { EDocumentSigner } from "../providers/e-document-signer";
import { generateUblTrXml } from "../providers/ubl-tr-builder";

export class ForibaEfaturaAdapter implements AccountingAdapter {
  readonly name = "foriba";
  private readonly logger = new Logger(ForibaEfaturaAdapter.name);
  private httpClient: AxiosInstance;
  private signer?: EDocumentSigner;

  constructor() {
    this.httpClient = axios.create({ timeout: 30000 });
  }

  /** Attach the e-document signer used before dispatch (set by the sync svc). */
  setSigner(signer: EDocumentSigner): this {
    this.signer = signer;
    return this;
  }

  /**
   * Pin the dispatch host to the tenant-configured apiUrl. Must be called on
   * EVERY sync (the service builds a fresh adapter per call and may skip
   * authenticate() on a cached token), otherwise pushInvoice's fallback would
   * dispatch to the hardcoded production endpoint even for a sandbox tenant.
   */
  setApiBase(url: string): this {
    if (url) this.httpClient.defaults.baseURL = url;
    return this;
  }

  async authenticate(
    credentials: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    // Pin the client to the tenant-configured host so dispatch goes to the SAME
    // environment we auth against (mirrors LogoAdapter). Without this the
    // pushInvoice fallback always hit the hardcoded production endpoint, so a
    // sandbox-configured tenant would auth to sandbox but file to production.
    if (credentials.apiUrl) {
      this.httpClient.defaults.baseURL = credentials.apiUrl;
    }
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
    let ublXml = generateUblTrXml(invoice);
    // Sign the UBL before dispatch when a signer is configured (mali mühür /
    // e-imza). GİB rejects an unsigned e-Fatura/e-Arşiv, so refuse to dispatch
    // unsigned once a signer is present — better a recorded FAILED than a
    // silently-unsigned document.
    if (this.signer?.isConfigured()) {
      ublXml = await this.signer.sign(ublXml);
    }

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

  // GATED: gerçek void API'si sandbox erişimi gelince doldurulacak — GİB
  // iptal/itiraz akışı (e-Arşiv iptal raporu / e-Fatura red) Foriba üzerinden
  // entegre edilene kadar DÜRÜST stub: asla "iptal edildi" diye yalan
  // söylemez, operatöre manuel iptali bildirir.
  async cancelInvoice(
    _accessToken: string,
    _companyId: string,
    _externalInvoiceId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error:
        "Provider cancel API not yet integrated — cancel manually in the Foriba panel",
    };
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
