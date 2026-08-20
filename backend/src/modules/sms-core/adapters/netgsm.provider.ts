import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SmsProvider, SmsSendResult } from "../sms-provider.interface";
import { SmsProviderRegistry } from "../sms-provider.registry";
import { maskPhone } from "../../../common/helpers/pii-mask.helper";

/**
 * Task 11: moved from customers/sms-providers/ into sms-core/adapters/,
 * mirroring payments-core/adapters + fiscal-core/adapters. Credentials are
 * now read from ConfigService in the constructor (DI, singleton) instead of
 * being passed positionally by a caller that constructed a fresh instance
 * per selection attempt — the wire behaviour of send() is unchanged.
 */
@Injectable()
export class NetGsmProvider implements SmsProvider, OnModuleInit {
  readonly name = "netgsm";
  private readonly logger = new Logger(NetGsmProvider.name);
  private readonly apiUrl = "https://api.netgsm.com.tr/sms/send/get";
  private readonly usercode: string;
  private readonly password: string;
  private readonly msgheader: string;

  constructor(
    private readonly registry: SmsProviderRegistry,
    config: ConfigService,
  ) {
    this.usercode = config.get<string>("NETGSM_USERCODE") || "";
    this.password = config.get<string>("NETGSM_PASSWORD") || "";
    this.msgheader = config.get<string>("NETGSM_MSGHEADER") || "";
  }

  /**
   * Only registers into the shared registry when real credentials are
   * present — mirrors PaytrPaymentProvider.onModuleInit(). An unconfigured
   * NetGsmProvider simply never becomes selectable; it does NOT throw here
   * (a dev box with no NetGSM account still needs to boot).
   */
  onModuleInit(): void {
    if (this.isConfigured()) {
      this.logger.log("NetGSM provider initialized");
      this.registry.register(this);
    } else {
      this.logger.warn("NetGSM credentials missing — provider not registered");
    }
  }

  isConfigured(): boolean {
    return !!this.usercode && !!this.password && !!this.msgheader;
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "NetGSM not configured" };
    }

    // NetGSM expects Turkish format: 05xx or 5xx (strip +90 prefix)
    const normalizedPhone = this.normalizePhone(to);

    const params = new URLSearchParams({
      usercode: this.usercode,
      password: this.password,
      gsmno: normalizedPhone,
      message: message,
      msgheader: this.msgheader,
      dession: "0", // Immediate send
    });

    try {
      // 10s cap on the upstream. NetGSM outages shouldn't pin a Node
      // socket indefinitely — the caller treats SMS as fire-and-forget
      // but we still pay CPU / file descriptors for every open request.
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const responseText = await response.text();
      const resultCode = responseText.trim().split(" ")[0];

      // NetGSM success codes: 00, 01, 02 mean queued/sent
      if (["00", "01", "02"].includes(resultCode)) {
        const messageId = responseText.trim().split(" ")[1] || resultCode;
        this.logger.log(
          `SMS sent via NetGSM to ${maskPhone(normalizedPhone)} (ID: ${messageId})`,
        );
        return { success: true, messageId };
      }

      // Error codes
      const errorMap: Record<string, string> = {
        "20": "Message text too long or empty",
        "30": "Invalid credentials",
        "40": "Sender ID (msgheader) not registered",
        "50": "Recipient number invalid",
        "51": "Recipient number incorrect format",
        "70": "Invalid parameters",
        "80": "Query limit exceeded",
        "85": "Duplicate message within 15 minutes",
      };

      const errorMsg =
        errorMap[resultCode] || `NetGSM error code: ${resultCode}`;
      this.logger.error(
        `NetGSM SMS failed for ${maskPhone(normalizedPhone)}: ${errorMsg}`,
      );

      // Non-retryable errors
      if (["30", "40", "50", "51"].includes(resultCode)) {
        return { success: false, error: `Non-retryable: ${errorMsg}` };
      }

      throw new Error(errorMsg); // Let retry logic handle
    } catch (error) {
      if (error.message?.startsWith("Non-retryable:")) {
        return { success: false, error: error.message };
      }
      throw error; // Let retry logic in SmsService handle it
    }
  }

  private normalizePhone(phone: string): string {
    let normalized = phone.replace(/[\s\-\(\)]/g, "");

    // +905xxxxxxxxx → 5xxxxxxxxx
    if (normalized.startsWith("+90")) {
      normalized = normalized.slice(3);
    }
    // 905xxxxxxxxx → 5xxxxxxxxx
    if (normalized.startsWith("90") && normalized.length === 12) {
      normalized = normalized.slice(2);
    }
    // 05xxxxxxxxx → 5xxxxxxxxx
    if (normalized.startsWith("0") && normalized.length === 11) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }
}
