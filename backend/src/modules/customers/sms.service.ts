import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SmsProvider, SmsSendResult } from "../sms-core/sms-provider.interface";
import { SmsProviderRegistry } from "../sms-core/sms-provider.registry";
import { CountryCapabilityResolver } from "../../common/country/country-capability.resolver";
import { RequestContext } from "../../common/context/request-context";
import { maskPhone } from "../../common/helpers/pii-mask.helper";

/**
 * Task 11: SMS provider selection moves from process-once to per-tenant.
 *
 * Before this, the constructor picked ONE provider off a single
 * process-wide SMS_PROVIDER env var (initializeProvider(), now gone) and
 * `send()` had no tenant parameter at all — so a single deployment could
 * never route Turkish tenants to NetGSM and another country's tenants to a
 * different provider. NetGsmProvider/TwilioProvider now live in
 * sms-core/adapters, self-register into the shared SmsProviderRegistry
 * (conditional on real credentials — see their onModuleInit()), and
 * `send()` resolves WHICH provider to use per call, via
 * CountryCapabilityResolver.smsProviderIdFor(tenantId).
 *
 * TENANT RESOLUTION ORDER (see resolveProviderForSend()):
 *   1. An explicit `tenantId` argument, when the caller has one (works
 *      outside a request — cron, event listeners).
 *   2. The ambient RequestContext.get()?.tenantId, populated per-request by
 *      Task 3's RequestContextInterceptor.
 *   3. Neither present: falls back to the process-wide DEFAULT provider
 *      (the legacy SMS_PROVIDER env / auto-detect selection, sourced from
 *      the registry instead of constructing a provider directly) — a
 *      deliberate, documented fallback for a caller that genuinely has no
 *      tenant to resolve. Every current caller in this codebase DOES have a
 *      tenantId in scope and passes it explicitly (phone-verification's
 *      sendOTP, sms-notification's sendIfEnabled) — this branch exists for
 *      future non-request callers that don't.
 *
 * LOUD FAILURE, NEVER SILENT MOCK, once a tenant is known:
 *   - A country with no SMS provider at all (UZ today) makes
 *     smsProviderIdFor() throw — that rejection propagates out of send()
 *     unchanged. It must never be swallowed into a fake "sent" mock
 *     response; see the resolver's own class comment for why (rule 1).
 *   - A country names a provider id that IS legal but isn't actually
 *     registered in THIS process (credentials missing/typo'd — e.g.
 *     SMS_PROVIDER names netgsm but NETGSM_PASSWORD is unset) is likewise a
 *     loud throw, distinct from mock mode, as long as at least one OTHER
 *     provider exists somewhere in the process (see resolveRegistered()).
 *     Only a COMPLETELY empty registry (nothing configured anywhere in this
 *     process — dev/test) falls through to the dev-only mock echo, and
 *     onApplicationBootstrap() below refuses to let that state reach
 *     production. This preserves the exact security property the
 *     pre-refactor constructor enforced: a config typo can no longer fall
 *     through to mockMode and log a real customer's OTP in plaintext.
 *
 * WHY THE PROD REFUSAL MOVED TO onApplicationBootstrap(), NOT THE
 * CONSTRUCTOR: the constructor ran synchronously, before Nest resolves
 * anything else, and could safely inspect `this.provider` because IT built
 * that provider itself. Now provider availability lives in
 * SmsProviderRegistry, populated by NetGsmProvider/TwilioProvider's OWN
 * onModuleInit() hooks — and Nest does not guarantee onModuleInit()
 * ordering ACROSS modules/providers, only that onApplicationBootstrap()
 * fires for every provider after EVERY module's onModuleInit() in the whole
 * graph has completed (same guarantee EntitlementsModule's bootstrap
 * backfill relies on). Checking in the constructor would race the
 * adapters' registration and could refuse to boot even when NetGSM/Twilio
 * ARE configured, depending on module init order.
 */
@Injectable()
export class SmsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly smsRegistry: SmsProviderRegistry,
    private readonly countryCapability: CountryCapabilityResolver,
  ) {}

  /**
   * Refuse to boot in production with NO SMS provider registered anywhere
   * in this process, unless ALLOW_MOCK_SMS_IN_PROD=true. A config typo
   * dropping every provider's env vars previously fell through to mockMode
   * SILENTLY — the `send` path then logs the full OTP + phone in plaintext.
   * Fail loudly at boot so the operator notices, instead of leaking
   * customer OTPs at runtime. ALLOW_MOCK_SMS_IN_PROD=true is an explicit
   * escape hatch for the rare "we genuinely want to silence outbound SMS in
   * prod" case (e.g. a dry-run window).
   *
   * Deliberately process-wide, not country-aware: "at least one provider is
   * registered somewhere" is enough to boot even though a SPECIFIC tenant
   * might still hit the send-time "provider named but not registered"
   * throw above. Task 12 adds a DEPLOYMENT_COUNTRIES env var that will make
   * this check country-aware; this method does not anticipate its shape,
   * only leaves room for it.
   */
  onApplicationBootstrap(): void {
    if (this.smsRegistry.list().length > 0) return;

    if (
      process.env.NODE_ENV === "production" &&
      process.env.ALLOW_MOCK_SMS_IN_PROD !== "true"
    ) {
      throw new Error(
        "SMS provider not configured in production. Set SMS_PROVIDER + the corresponding " +
          "*_USERCODE / *_AUTH_TOKEN credentials, or set ALLOW_MOCK_SMS_IN_PROD=true to " +
          "explicitly silence customer OTP delivery.",
      );
    }
    this.logger.warn(
      "No SMS provider configured - SMS will be mocked (NON-PRODUCTION ONLY)",
    );
  }

  /**
   * Send SMS with retry logic. `tenantId` is optional — see the class
   * comment's TENANT RESOLUTION ORDER. Do not add tenantId as a required
   * parameter; several callers (sms-notification's fire-and-forget path)
   * are one .catch() away from user-visible flows and must keep working
   * even from contexts this signature can't see into.
   */
  async send(
    to: string,
    message: string,
    tenantId?: string,
    maxRetries: number = 3,
  ): Promise<SmsSendResult> {
    const provider = await this.resolveProviderForSend(tenantId);

    if (!provider) {
      // Dev-only echo: mask phone but keep the OTP visible so local
      // development can actually verify the flow without a real
      // provider. mockMode is refused in production at
      // onApplicationBootstrap(), so this branch never fires there.
      this.logger.log(`[MOCK SMS] To: ${maskPhone(to)}, Message: ${message}`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    let lastError: Error | null = null;
    const masked = maskPhone(to);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await provider.send(to, message);

        // Provider returned a non-retryable error
        if (!result.success && result.error?.startsWith("Non-retryable:")) {
          this.logger.error(
            `${provider.name} non-retryable error for ${masked}: ${result.error}`,
          );
          return result;
        }

        if (result.success) return result;

        // Unexpected failure without throw
        lastError = new Error(result.error || "Unknown error");
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `SMS send attempt ${attempt}/${maxRetries} failed for ${masked} via ${provider.name}: ${error.message}`,
        );
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.logger.error(
      `Failed to send SMS to ${masked} via ${provider.name} after ${maxRetries} attempts: ${lastError?.message}`,
    );

    return { success: false, error: lastError?.message || "Unknown error" };
  }

  /**
   * Resolves which SmsProvider a given send() call should use — the heart
   * of Task 11. See the class comment for the full resolution order and the
   * loud-failure guarantees.
   */
  private async resolveProviderForSend(
    explicitTenantId?: string,
  ): Promise<SmsProvider | null> {
    const tenantId = explicitTenantId || RequestContext.get()?.tenantId;

    if (tenantId) {
      // Throws for a country with no SMS provider at all (UZ today) — an
      // explicit, permanent refusal. Propagate it: never swallow into mock.
      const id = await this.countryCapability.smsProviderIdFor(tenantId);
      return this.resolveRegistered(id);
    }

    // No tenant resolvable at all — documented fallback to the process-wide
    // default (legacy SMS_PROVIDER env selection / auto-detect).
    const defaultId = this.resolveDefaultProviderId();
    return defaultId ? this.resolveRegistered(defaultId) : null;
  }

  /**
   * Looks `id` up in the registry. An empty registry (nothing configured
   * anywhere in this process — dev/test; onApplicationBootstrap() refuses
   * to let this state reach production) mocks, matching the pre-refactor
   * global mockMode. A NON-empty registry missing this SPECIFIC id is a
   * genuine config problem (credentials missing, or a typo'd country
   * profile) and must fail loudly instead — never silently pretend to send.
   */
  private resolveRegistered(id: string): SmsProvider | null {
    try {
      return this.smsRegistry.get(id);
    } catch {
      if (this.smsRegistry.list().length === 0) return null;
      throw new Error(
        `SMS provider '${id}' is not registered in this process — check its ` +
          "credentials (NETGSM_USERCODE/NETGSM_PASSWORD/NETGSM_MSGHEADER or " +
          "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER). This is a " +
          "configuration problem, not mock mode — the message was NOT sent.",
      );
    }
  }

  /**
   * The process-wide default provider id, used only when no tenant is
   * resolvable (see resolveProviderForSend()). Ported verbatim from the
   * pre-refactor initializeProvider(): an explicit SMS_PROVIDER wins if
   * registered, otherwise auto-detect prefers netgsm (cheaper for TR) then
   * twilio. Sourced from the registry (i.e. only ever returns an id that IS
   * actually configured) instead of constructing a provider and checking
   * isConfigured() directly.
   */
  private resolveDefaultProviderId(): string | null {
    const providerName = (
      this.configService.get<string>("SMS_PROVIDER") || ""
    ).toLowerCase();
    const registered = new Set(this.smsRegistry.list().map((p) => p.name));

    if (providerName === "netgsm" || providerName === "twilio") {
      return registered.has(providerName) ? providerName : null;
    }

    if (registered.has("netgsm")) return "netgsm";
    if (registered.has("twilio")) return "twilio";
    return null;
  }

  /**
   * Send verification code SMS. `tenantId` optional — see send().
   */
  async sendVerificationCode(
    phone: string,
    code: string,
    tenantId?: string,
  ): Promise<boolean> {
    const message = `Your verification code is: ${code}. This code will expire in 10 minutes.`;
    const result = await this.send(phone, message, tenantId);
    return result.success;
  }

  /**
   * Send custom message. `tenantId` optional — see send().
   */
  async sendMessage(
    phone: string,
    message: string,
    tenantId?: string,
  ): Promise<boolean> {
    const result = await this.send(phone, message, tenantId);
    return result.success;
  }

  /**
   * Process-wide "is SOME provider registered" signal — true unless the
   * registry is completely empty. Used by PhoneVerificationService purely
   * to decide whether to log the OTP for local dev visibility, not to gate
   * an actual send decision (send()/resolveProviderForSend() make that call
   * per-tenant).
   */
  isServiceEnabled(): boolean {
    return this.smsRegistry.list().length > 0;
  }

  /**
   * Diagnostic only — nothing depends on this today. Reflects the
   * process-wide DEFAULT provider (the one used when no tenant is in
   * scope), not any particular tenant's resolved provider.
   */
  getProviderName(): string {
    return this.resolveDefaultProviderId() || "mock";
  }
}
