import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Twilio from "twilio";
import { SmsProvider, SmsSendResult } from "../sms-provider.interface";
import { SmsProviderRegistry } from "../sms-provider.registry";
import { maskPhone } from "../../../common/helpers/pii-mask.helper";

/**
 * Task 11: moved from customers/sms-providers/ into sms-core/adapters/,
 * mirroring payments-core/adapters + fiscal-core/adapters. See
 * netgsm.provider.ts's header comment for the shape rationale.
 */
@Injectable()
export class TwilioProvider implements SmsProvider, OnModuleInit {
  readonly name = "twilio";
  private readonly logger = new Logger(TwilioProvider.name);
  private readonly client: Twilio.Twilio | null;
  private readonly from: string;

  constructor(
    private readonly registry: SmsProviderRegistry,
    config: ConfigService,
  ) {
    const accountSid = config.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = config.get<string>("TWILIO_AUTH_TOKEN");
    this.from = config.get<string>("TWILIO_PHONE_NUMBER") || "";
    this.client =
      accountSid && authToken ? Twilio.default(accountSid, authToken) : null;
  }

  /** Only registers when real credentials are present — see NetGsmProvider. */
  onModuleInit(): void {
    if (this.isConfigured()) {
      this.logger.log("Twilio provider initialized");
      this.registry.register(this);
    } else {
      this.logger.warn("Twilio credentials missing — provider not registered");
    }
  }

  isConfigured(): boolean {
    return !!this.client && !!this.from;
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (!this.client || !this.from) {
      return { success: false, error: "Twilio not configured" };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.from,
        to,
      });

      this.logger.log(
        `SMS sent via Twilio to ${maskPhone(to)} (SID: ${result.sid})`,
      );
      return { success: true, messageId: result.sid };
    } catch (error) {
      // Non-retryable errors
      if (
        error.code === 21211 || // Invalid phone number
        error.code === 21408 || // Permission denied
        error.code === 21610 // Unsubscribed recipient
      ) {
        return { success: false, error: `Non-retryable: ${error.message}` };
      }
      throw error; // Let retry logic in SmsService handle it
    }
  }
}
