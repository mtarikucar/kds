import { Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  AccountingAdapter,
  AccountingInvoiceData,
} from "./accounting-adapter.interface";
import { EDocumentSigner } from "../providers/e-document-signer";
import { generateUblTrXml } from "../providers/ubl-tr-builder";

/**
 * Nilvera özel entegratör adapter'ı — e-Arşiv (B2C, birincil) + e-Fatura (B2B).
 *
 * Auth modeli Foriba/Logo'dan farklı: Nilvera "Persisted Access Token" kullanır
 * — panelden üretilen STATİK bir API anahtarı her isteğe `Bearer` olarak konur;
 * ayrı bir token uç noktası YOKTUR. authenticate() bu yüzden ağa çıkmaz,
 * anahtarı doğrudan access token olarak döndürür (ağ doğrulaması
 * testConnection()'da).
 *
 * INERT-until-credentials: sandbox anahtarı henüz yok. Uç nokta yolları
 * developer.nilvera.com public dokümanına göre sabitlendi ve tek yerde
 * (aşağıdaki sabitler) toplandı — aktivasyon günü bir sapma çıkarsa düzeltme
 * tek-sabit değişikliğidir. Yanıt ayrıştırma bilinçli savunmacıdır.
 *
 * Doküman referansları:
 *   - e-Arşiv API:  https://developer.nilvera.com/api/e-arsiv-api
 *   - VKN sorgu:    https://developer.nilvera.com/api/genel-api/mukellef-islemleri/vkn-ile-sorgular
 */
const EARCHIVE_SEND_XML_PATH = "/earchive/Send/Xml";
const EINVOICE_SEND_XML_PATH = "/einvoice/Send/Xml";
// e-Arşiv iptali: gövdede iptal edilecek fatura UUID listesi taşınır.
const EARCHIVE_CANCEL_PATH = "/earchive/Cancel";
// Kendi şirket bilgisi — testConnection için en ucuz auth-doğrulama ucu.
const GENERAL_COMPANY_PATH = "/general/Company";
// Bir VKN'nin kayıtlı e-Fatura kullanıcısı olup olmadığı (mükellef sorgusu).
const CHECK_TAXNUMBER_PATH = "/general/GlobalCompany/Check/TaxNumber";

export class NilveraAdapter implements AccountingAdapter {
  readonly name = "Nilvera";
  private readonly logger = new Logger(NilveraAdapter.name);
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
   * EVERY sync/cancel (mirrors ForibaEfaturaAdapter.setApiBase): the sync
   * service builds a fresh adapter per call and getToken() skips
   * authenticate() on a warm token cache — authenticate() is otherwise the
   * only place baseURL gets set, so without this pin every call after the
   * first would fail "apiUrl is not configured" for the whole 24h token TTL.
   */
  setApiBase(url: string): this {
    if (url) this.httpClient.defaults.baseURL = url;
    return this;
  }

  private authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  private requireBaseUrl(credentialsOrUrl?: string): string {
    const url = credentialsOrUrl || this.httpClient.defaults.baseURL;
    if (!url) {
      // Bilinçli fail-closed: Nilvera'nın canlı/test host'ları tenant'ın
      // panelinden teyit edilmeli (apiUrl ayarı) — yanlış host'a mali belge
      // POST'lamaktansa net hata ver.
      throw new Error(
        "Nilvera apiUrl is not configured — set it in accounting settings (from your Nilvera panel)",
      );
    }
    return url.replace(/\/+$/, "");
  }

  async authenticate(
    credentials: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    const apiKey = credentials.apiKey;
    if (!apiKey) {
      throw new Error("Nilvera API key missing (accounting settings)");
    }
    if (credentials.apiUrl) {
      this.httpClient.defaults.baseURL = credentials.apiUrl;
    }
    // Statik anahtar modeli: ayrı token ucu yok; anahtar = access token.
    // 24h sahte-expiry token-cache'in makul aralıklarla bu yolu yeniden
    // çalıştırması için (anahtar rotasyonunda taze ayarın alınması).
    return {
      accessToken: apiKey,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    };
  }

  async pushInvoice(
    token: string,
    _companyId: string,
    invoice: AccountingInvoiceData,
  ): Promise<{ externalId: string }> {
    const base = this.requireBaseUrl();
    let ublXml = generateUblTrXml(invoice);
    // Foriba ile aynı sözleşme: imzacı YAPILANDIRILMIŞSA imzasız belge asla
    // gönderilmez; yapılandırılmamışsa entegratörün kendi mali mührüyle
    // mühürlemesi beklenir (Nilvera bunu destekler).
    if (this.signer?.isConfigured()) {
      ublXml = await this.signer.sign(ublXml);
    }

    const path =
      invoice.eDocumentType === "EFATURA"
        ? EINVOICE_SEND_XML_PATH
        : EARCHIVE_SEND_XML_PATH;

    // Send/Xml multipart dosya bekler (doküman: form-data "file"). Node 18+
    // global FormData/Blob kullanılır — ek bağımlılık yok.
    const form = new FormData();
    form.append(
      "file",
      new Blob([ublXml], { type: "application/xml" }),
      `${invoice.invoiceNumber || "invoice"}.xml`,
    );

    const response = await this.httpClient.post(`${base}${path}`, form, {
      headers: this.authHeaders(token),
    });

    // Savunmacı ayrıştırma: dokümandaki alan adı UUID; olası varyantları da
    // kabul et. Dizi dönerse (toplu gönderim yanıtı) ilk öğeye bak.
    const d = response.data;
    const first = Array.isArray(d) ? d[0] : d;
    const externalId =
      first?.UUID ?? first?.uuid ?? first?.InvoiceUUID ?? first?.id ?? null;
    if (!externalId) {
      this.logger.error(
        `Nilvera dispatch returned no UUID — response: ${JSON.stringify(d).slice(0, 500)}`,
      );
      throw new Error("Nilvera dispatch returned no invoice UUID");
    }
    this.logger.log(`Nilvera ${path} dispatched: ${externalId}`);
    return { externalId: String(externalId) };
  }

  /**
   * GERÇEK iptal denemesi (A3'ün Foriba/Logo/Parasut'taki GATED stub'ından
   * farklı olarak Nilvera'nın public e-Arşiv Cancel ucu belgeli). Sözleşme
   * gereği ASLA throw etmez — sağlayıcı reddi/ağ hatası `{ success:false,
   * error }` olarak döner ve fatura CANCEL_PENDING'e düşer.
   *
   * Not: Bu uç e-ARŞİV iptali içindir. B2B e-Fatura'da iptal GİB itiraz/red
   * akışıdır; Nilvera bu isteği reddederse hata mesajı operatöre aynen
   * taşınır ("manuel iptal gerekli").
   */
  async cancelInvoice(
    accessToken: string,
    _companyId: string,
    externalInvoiceId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const base = this.requireBaseUrl();
      await this.httpClient.delete(`${base}${EARCHIVE_CANCEL_PATH}`, {
        headers: this.authHeaders(accessToken),
        data: [externalInvoiceId],
      });
      this.logger.log(`Nilvera e-Arşiv cancelled: ${externalInvoiceId}`);
      return { success: true };
    } catch (err: any) {
      const detail =
        err?.response?.data?.Message ??
        err?.response?.data?.message ??
        (err?.response?.status
          ? `HTTP ${err.response.status}`
          : (err?.message ?? "unknown error"));
      return {
        success: false,
        error: `Nilvera cancel failed: ${detail} — cancel manually in the Nilvera panel`,
      };
    }
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    try {
      const { accessToken } = await this.authenticate(credentials);
      const base = this.requireBaseUrl(credentials.apiUrl);
      await this.httpClient.get(`${base}${GENERAL_COMPANY_PATH}`, {
        headers: this.authHeaders(accessToken),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * VKN mükellef sorgusu — MukellefQueryProvider'ın HTTP-destekli hali.
   * `true`/`false` kesin yanıttır; `null` = sorgu yapılamadı (çağıran güvenli
   * varsayılana düşer: e-Arşiv). Yanıt şeması savunmacı okunur.
   */
  async isRegisteredEFaturaUser(
    accessToken: string,
    apiUrl: string,
    taxId: string,
  ): Promise<boolean | null> {
    try {
      const base = this.requireBaseUrl(apiUrl);
      const response = await this.httpClient.get(
        `${base}${CHECK_TAXNUMBER_PATH}/${encodeURIComponent(taxId)}`,
        { headers: this.authHeaders(accessToken) },
      );
      const d = response.data;
      if (typeof d === "boolean") return d;
      if (typeof d?.IsUser === "boolean") return d.IsUser;
      if (typeof d?.isUser === "boolean") return d.isUser;
      if (typeof d?.Exist === "boolean") return d.Exist;
      if (Array.isArray(d)) return d.length > 0;
      if (Array.isArray(d?.Aliases)) return d.Aliases.length > 0;
      this.logger.warn(
        `Nilvera VKN check: unrecognized response shape for ${taxId} — falling back`,
      );
      return null;
    } catch (err: any) {
      // 404 = kayıtlı e-Fatura kullanıcısı değil (kesin yanıt).
      if (err?.response?.status === 404) return false;
      this.logger.warn(
        `Nilvera VKN check failed for ${taxId}: ${err?.message ?? err}`,
      );
      return null;
    }
  }
}
