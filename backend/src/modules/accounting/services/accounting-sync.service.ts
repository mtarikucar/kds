import { Injectable, Logger, Inject } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { AccountingSettingsService } from "./accounting-settings.service";
import { resolveEDocumentType, validateBuyerFor } from "../e-document-routing";
import {
  MUKELLEF_QUERY,
  MukellefQueryProvider,
} from "../providers/mukellef-query.provider";
import {
  E_DOCUMENT_SIGNER,
  EDocumentSigner,
} from "../providers/e-document-signer";
import {
  AccountingAdapter,
  AccountingInvoiceData,
} from "../adapters/accounting-adapter.interface";
import { ParasutAdapter } from "../adapters/parasut.adapter";
import { ForibaEfaturaAdapter } from "../adapters/foriba-efatura.adapter";
import { LogoAdapter } from "../adapters/logo.adapter";
import { NilveraAdapter } from "../adapters/nilvera.adapter";
import {
  AccountingProvider,
  STUCK_SYNCING_THRESHOLD_MS,
} from "../constants/accounting.enum";

@Injectable()
export class AccountingSyncService {
  private readonly logger = new Logger(AccountingSyncService.name);
  private tokenCache = new Map<string, { token: string; expiresAt: Date }>();

  constructor(
    private prisma: PrismaService,
    private settingsService: AccountingSettingsService,
    @Inject(MUKELLEF_QUERY) private mukellefQuery: MukellefQueryProvider,
    @Inject(E_DOCUMENT_SIGNER) private signer: EDocumentSigner,
  ) {}

  /** External-provisioning readiness for going live with e-document issuance. */
  eDocumentReadiness() {
    return {
      mukellefQuery: this.mukellefQuery.name,
      signer: this.signer.name,
      signerConfigured: this.signer.isConfigured(),
    };
  }

  /**
   * Re-sync invoices the provider previously rejected (externalStatus=FAILED),
   * plus crash-stuck SYNCING rows past the staleness threshold (audit A6).
   * Bounded batch; each retried independently so one failure doesn't stop the
   * rest. Driven by a scheduler + callable on demand.
   */
  async resyncFailedInvoices(tenantId: string, limit = 50): Promise<number> {
    // A6: release crash-stuck SYNCING claims first. A worker that died
    // between the SYNCING claim and the outcome write leaves the row
    // unclaimable forever (the claim allow-list deliberately excludes
    // SYNCING). Past the staleness threshold we flip it back to FAILED —
    // with an explicit syncError — so the ordinary FAILED retry below
    // re-claims it. `updatedAt` in the WHERE means a genuinely in-flight
    // sync (fresh SYNCING) is never touched. Residual risk, accepted by the
    // A6 audit decision: if the crash happened AFTER the provider accepted
    // the push but BEFORE the local SYNCED write (F-Acc-7), the retry can
    // duplicate the document at the provider — the syncError text records
    // the recovery so provider-side reconciliation can spot it.
    const stuckBefore = new Date(Date.now() - STUCK_SYNCING_THRESHOLD_MS);
    const released = await this.prisma.salesInvoice.updateMany({
      where: {
        tenantId,
        externalStatus: "SYNCING",
        updatedAt: { lt: stuckBefore },
      },
      data: {
        externalStatus: "FAILED",
        syncError:
          "Recovered from stuck SYNCING (worker crashed mid-sync); queued for retry — verify at the provider that no duplicate was pushed",
      },
    });
    if (released.count > 0) {
      this.logger.warn(
        `Released ${released.count} crash-stuck SYNCING invoice(s) for tenant ${tenantId} back to FAILED for retry`,
      );
    }

    const failed = await this.prisma.salesInvoice.findMany({
      where: { tenantId, externalStatus: "FAILED" },
      select: { id: true },
      take: Math.min(limit, 200),
    });
    let retried = 0;
    for (const inv of failed) {
      try {
        await this.syncInvoice(inv.id, tenantId);
        retried += 1;
      } catch (err: any) {
        this.logger.warn(`Re-sync failed for ${inv.id}: ${err?.message}`);
      }
    }
    return retried;
  }

  async syncInvoice(invoiceId: string, tenantId: string): Promise<void> {
    const settings = await this.settingsService.findByTenant(tenantId);
    if (settings.provider === AccountingProvider.NONE) return;

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { items: true },
    });
    if (!invoice) return;

    // Do NOT transmit a credit note (İade Faturası) through the sale path — the
    // adapters emit it as a positive SATIS with no İade/return marker, so the
    // provider would book it as another sale. Until a dedicated İade payload
    // exists, credit notes stay local documents.
    if (invoice.type === "REFUND") {
      this.logger.log(
        `Invoice ${invoiceId} is a credit note (REFUND); skipping provider sync (no İade transmission yet).`,
      );
      return;
    }

    // M4 (revised): an externalId means the document was ALREADY issued at an
    // integrator. Same provider → plain dedupe skip. DIFFERENT provider (after
    // a swap, e.g. Foriba → Nilvera) → deliberately NOT re-issued either:
    // pushing it again would create a duplicate legal e-belge at a second
    // integrator. Only rows that never reached a provider (externalId null —
    // i.e. null/FAILED/PENDING states) sync after a swap; migrated documents
    // need a manual/provider-side move. (Previously this branch fell through
    // to the claim, which rejected SYNCED rows anyway — the re-sync promise
    // was dead code with a misleading "duplicate push" debug line.)
    if (invoice.externalId) {
      if (invoice.externalProvider !== settings.provider) {
        this.logger.warn(
          `Invoice ${invoiceId} already issued at ${invoice.externalProvider}; NOT re-issuing at ${settings.provider} — manual/provider-side migration required`,
        );
      }
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
        // NOTE: `null` may NOT appear inside an `in` list — Prisma rejects it
        // at runtime (PrismaClientValidationError), which silently killed
        // every sync. The null state needs its own OR branch.
        OR: [
          { externalStatus: null },
          { externalStatus: { in: ["FAILED", "PENDING"] } },
        ],
      },
      data: { externalStatus: "SYNCING", syncError: null },
    });
    if (claim.count === 0) {
      this.logger.debug(
        `Invoice ${invoiceId} already SYNCING/SYNCED; skipping duplicate push`,
      );
      return;
    }

    let result: { externalId: string };
    try {
      const adapter = this.getAdapter(settings.provider);
      if (!adapter) return;

      // The secret credential fields (parasutClientSecret/parasutPassword/
      // logoPassword/foribaPassword/nilveraApiKey) are stored AES-256-GCM
      // encrypted (`v1:…`). findByTenant returns them encrypted; we MUST
      // decrypt BEFORE the mükellef bridge below — otherwise Nilvera receives
      // the ciphertext as its Bearer key, 401s, and every B2B buyer silently
      // misroutes to e-Arşiv. Non-secret fields (companyId/firmNumber/apiUrl)
      // pass through unchanged.
      const creds =
        await this.settingsService.getDecryptedCredentials(tenantId);

      // Route e-Fatura (B2B) vs e-Arşiv (B2C). isRegisteredEFaturaUser comes
      // from a GİB mükellef query via the pluggable provider (mock in dev,
      // HTTP in prod). Registered VKN → e-Fatura, otherwise e-Arşiv — the
      // safe final-consumer default that never wrongly issues a B2B e-Fatura
      // the buyer can't receive.
      //
      // Nilvera bridge: when the tenant's provider is Nilvera, its own
      // GlobalCompany/Check endpoint IS the authoritative mükellef query —
      // prefer it over the injected (mock/null) provider. `null` means the
      // HTTP check couldn't answer; fall back to the injected provider so
      // behaviour degrades to the pre-Nilvera path instead of guessing.
      const registered = invoice.customerTaxId
        ? ((await this.nilveraMukellefCheck(
            adapter,
            creds ?? settings,
            invoice.customerTaxId,
          )) ??
          (await this.mukellefQuery.isRegisteredEFaturaUser(
            invoice.customerTaxId,
          )))
        : false;
      const eDocumentType = resolveEDocumentType({
        taxId: invoice.customerTaxId,
        taxOffice: invoice.customerTaxOffice,
        isRegisteredEFaturaUser: registered,
      });

      // A5: validate the buyer party for the chosen document type BEFORE any
      // provider traffic. An e-Fatura with an incomplete
      // AccountingCustomerParty produces invalid XML that GİB rejects — fail
      // the sync locally (the throw lands in the FAILED + syncError catch
      // below, the same re-claimable path as an adapter error) instead of
      // transmitting a document we already know is bad.
      const buyerProblems = validateBuyerFor(eDocumentType, {
        taxId: invoice.customerTaxId,
        taxOffice: invoice.customerTaxOffice,
      });
      if (buyerProblems.length > 0) {
        throw new Error(`Buyer validation failed: ${buyerProblems.join("; ")}`);
      }

      // Pin the dispatch host to the configured apiUrl on EVERY sync — the
      // adapter is freshly constructed per call and getToken() may skip
      // authenticate() on a cached token, so the baseURL set inside
      // authenticate wouldn't be applied to this instance. Foriba would fall
      // back to its hardcoded prod host; Nilvera has NO fallback and would
      // fail closed ("apiUrl is not configured") for the whole 24h token TTL.
      if (adapter instanceof ForibaEfaturaAdapter) {
        adapter.setApiBase(((creds ?? settings) as any).foribaApiUrl || "");
      } else if (adapter instanceof NilveraAdapter) {
        adapter.setApiBase(((creds ?? settings) as any).nilveraApiUrl || "");
      }
      const token = await this.getToken(tenantId, creds ?? settings, adapter);
      const companyId = this.getCompanyId(creds ?? settings);

      const invoiceData: AccountingInvoiceData = {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate.toISOString().split("T")[0],
        dueDate: invoice.dueDate?.toISOString().split("T")[0],
        customerName: invoice.customerName || undefined,
        customerTaxId: invoice.customerTaxId || undefined,
        customerTaxOffice: invoice.customerTaxOffice || undefined,
        // Resolved + buyer-validated above (A5) before any provider traffic.
        eDocumentType,
        withholdingTaxAmount:
          invoice.withholdingTaxAmount != null
            ? Number(invoice.withholdingTaxAmount)
            : undefined,
        withholdingCode: invoice.withholdingCode || undefined,
        // Issuer/seller identity snapshotted on the invoice at build time
        // (fake-working sweep #3). Falls back to the tenant's current
        // Company Info for legacy rows written before the seller columns
        // existed, so historical invoices still carry a supplier party.
        sellerName: invoice.sellerName || settings.companyName || undefined,
        sellerTaxId: invoice.sellerTaxId || settings.companyTaxId || undefined,
        sellerTaxOffice:
          invoice.sellerTaxOffice || settings.companyTaxOffice || undefined,
        sellerAddress:
          invoice.sellerAddress || settings.companyAddress || undefined,
        sellerPhone: invoice.sellerPhone || settings.companyPhone || undefined,
        sellerEmail: invoice.sellerEmail || settings.companyEmail || undefined,
        currency: invoice.currency,
        paymentMethod: invoice.paymentMethod || undefined,
        totalAmount: Number(invoice.totalAmount),
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          taxRate: item.taxRate,
          // Forward the stored net subtotal + tax so the UBL reconciles with the
          // order total instead of recomputing from the 2-dp unit price.
          lineSubtotal:
            item.subtotal != null ? Number(item.subtotal) : undefined,
          lineTax: item.taxAmount != null ? Number(item.taxAmount) : undefined,
        })),
      };

      result = await adapter.pushInvoice(token, companyId, invoiceData);
    } catch (err) {
      // The push (or the auth/setup preceding it) FAILED — the remote does
      // NOT have this invoice, so marking FAILED is safe: a later re-claim
      // (FAILED is in the claim allow-list) re-pushes without duplicating.
      this.logger.error(`Sync failed for invoice ${invoiceId}: ${err.message}`);
      await this.prisma.salesInvoice.updateMany({
        where: { id: invoiceId, tenantId },
        data: { syncError: err.message, externalStatus: "FAILED" },
      });
      return;
    }

    // Push SUCCEEDED — the remote provider now holds this legal invoice.
    // Recording externalId + SYNCED is a SEPARATE try: if THIS local write
    // fails we must NOT flip the row to FAILED, because FAILED is re-claimable
    // and a retry would push a DUPLICATE e-fatura to the tax authority (a
    // compliance violation). Leave the row in its SYNCING marker state — the
    // exact F-Acc-7 recovery path documented above — and log the externalId so
    // an operator/reconcile can confirm it. (The previous single try/catch
    // caught a post-push DB hiccup straight to FAILED, silently defeating that
    // protection.)
    try {
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
    } catch (recordErr: any) {
      this.logger.error(
        `Invoice ${invoice.invoiceNumber} was PUSHED to ${settings.provider} ` +
          `(externalId=${result.externalId}) but the local SYNCED write failed; ` +
          `leaving the row SYNCING to avoid a duplicate push — recover/confirm ` +
          `the externalId from the provider. ${recordErr?.message ?? recordErr}`,
      );
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

  /**
   * A3 — best-effort provider-side void of a locally cancelled invoice.
   * Locally cancelling a fatura that was already SYNCED leaves the provider
   * (and thus GİB) holding it as a live document; this pushes the cancel to
   * the provider it was synced to. Never throws for a provider refusal:
   * on failure the row is flagged externalStatus=CANCEL_PENDING with a
   * "Manuel iptal gerekli" syncError so the operator cancels it in the
   * provider panel. CANCEL_PENDING is deliberately NOT in the sync claim
   * allow-list, so the resync loop can never re-push a cancelled invoice.
   *
   * NOTE: all current adapters ship an honest GATED stub (success:false),
   * so today every synced cancel lands in CANCEL_PENDING — by design, until
   * the providers' real void APIs are integrated.
   */
  async cancelInvoiceAtProvider(
    invoiceId: string,
    tenantId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) return { success: false, error: "Invoice not found" };
    // Never reached a provider — nothing external to void.
    if (!invoice.externalId || !invoice.externalProvider) {
      return { success: true };
    }

    // The document lives at the provider it was SYNCED to — which after a
    // provider swap may differ from the tenant's CURRENT settings.provider —
    // so the adapter + credentials resolve from the invoice's own
    // externalProvider, not the settings row's active one.
    const provider = invoice.externalProvider;
    const adapter = this.getAdapter(provider);
    let outcome: { success: boolean; error?: string };
    if (!adapter) {
      outcome = {
        success: false,
        error: `No adapter available for provider ${provider}`,
      };
    } else {
      try {
        const settings = await this.settingsService.findByTenant(tenantId);
        const creds =
          await this.settingsService.getDecryptedCredentials(tenantId);
        if (adapter instanceof ForibaEfaturaAdapter) {
          adapter.setApiBase(((creds ?? settings) as any).foribaApiUrl || "");
        } else if (adapter instanceof NilveraAdapter) {
          adapter.setApiBase(((creds ?? settings) as any).nilveraApiUrl || "");
        }
        const token = await this.getToken(
          tenantId,
          creds ?? settings,
          adapter,
          provider,
        );
        const companyId = this.getCompanyId(creds ?? settings, provider);
        outcome = await adapter.cancelInvoice(
          token,
          companyId,
          invoice.externalId,
        );
      } catch (err: any) {
        // Auth/setup failure — the provider still holds the document, so it
        // needs the same manual-cancel flag as an explicit refusal.
        outcome = { success: false, error: err?.message ?? String(err) };
      }
    }

    if (!outcome.success) {
      this.logger.warn(
        `Provider-side cancel failed for invoice ${invoice.invoiceNumber} at ${provider}: ${outcome.error}`,
      );
      await this.prisma.salesInvoice.updateMany({
        where: { id: invoiceId, tenantId },
        data: {
          externalStatus: "CANCEL_PENDING",
          syncError: `Manuel iptal gerekli: ${outcome.error ?? "unknown provider error"}`,
        },
      });
      return outcome;
    }

    await this.prisma.salesInvoice.updateMany({
      where: { id: invoiceId, tenantId },
      data: { externalStatus: "CANCELLED", syncError: null },
    });
    this.logger.log(
      `Invoice ${invoice.invoiceNumber} cancelled at ${provider}`,
    );
    return outcome;
  }

  private getAdapter(provider: string): AccountingAdapter | null {
    switch (provider) {
      case AccountingProvider.PARASUT:
        return new ParasutAdapter();
      case AccountingProvider.FORIBA:
        // Attach the signer so the UBL is XAdES-signed before dispatch.
        return new ForibaEfaturaAdapter().setSigner(this.signer);
      case AccountingProvider.LOGO:
        return new LogoAdapter();
      case AccountingProvider.NILVERA:
        // Per-provider signing policy: Nilvera seals server-side with its OWN
        // mali mühür, so the local signer is deliberately NOT attached. When
        // one IS configured (e.g. EBELGE_PROVIDER=mock on a staging box, or a
        // future cert-backed Foriba signer), attaching it here would inject a
        // local signature into the dispatch — the mock even emits an
        // undeclared-namespace element that corrupts the XML — and a real one
        // would double-sign what Nilvera seals itself.
        return new NilveraAdapter();
      default:
        return null;
    }
  }

  /**
   * Nilvera-backed mükellef (VKN) query. Returns null (= "couldn't answer")
   * unless the active provider is Nilvera with usable credentials — the
   * caller then falls back to the injected MukellefQueryProvider. Never
   * throws: a lookup hiccup must not fail the sync, only degrade routing to
   * the safe e-Arşiv default.
   */
  private async nilveraMukellefCheck(
    adapter: AccountingAdapter | null,
    settings: any,
    taxId: string,
  ): Promise<boolean | null> {
    if (!(adapter instanceof NilveraAdapter)) return null;
    try {
      const credentials = this.getCredentials(
        settings,
        AccountingProvider.NILVERA,
      );
      if (!credentials.apiKey || !credentials.apiUrl) return null;
      return await adapter.isRegisteredEFaturaUser(
        credentials.apiKey,
        credentials.apiUrl,
        taxId,
      );
    } catch {
      return null;
    }
  }

  /**
   * Drop cached provider tokens for a tenant. Called on accounting-settings
   * updates so a corrected/rotated credential takes effect immediately —
   * without this, Nilvera's 24h static-key cache keeps replaying the OLD key
   * (a wrong first entry keeps failing, a rotated key keeps leaking) until
   * the fake expiry lapses.
   */
  clearTokenCache(tenantId: string): void {
    for (const key of this.tokenCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) this.tokenCache.delete(key);
    }
  }

  private async getToken(
    tenantId: string,
    settings: any,
    adapter: AccountingAdapter,
    // Which provider's credentials to read off the settings row; defaults to
    // the active settings.provider. cancelInvoiceAtProvider passes the
    // invoice's own externalProvider (may differ after a provider swap).
    provider?: string,
  ): Promise<string> {
    const cacheKey = `${tenantId}:${adapter.name}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) return cached.token;

    const credentials = this.getCredentials(settings, provider);
    const result = await adapter.authenticate(credentials);
    this.tokenCache.set(cacheKey, {
      token: result.accessToken,
      expiresAt: result.expiresAt || new Date(Date.now() + 7200000),
    });
    return result.accessToken;
  }

  private getCredentials(
    settings: any,
    provider: string = settings?.provider,
  ): Record<string, string> {
    switch (provider) {
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
      case AccountingProvider.NILVERA:
        return {
          apiUrl: settings.nilveraApiUrl || "",
          apiKey: settings.nilveraApiKey || "",
        };
      default:
        return {};
    }
  }

  private getCompanyId(
    settings: any,
    provider: string = settings?.provider,
  ): string {
    switch (provider) {
      case AccountingProvider.PARASUT:
        return settings.parasutCompanyId || "";
      case AccountingProvider.LOGO:
        return settings.logoFirmNumber || "";
      default:
        return "";
    }
  }
}
