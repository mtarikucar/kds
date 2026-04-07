import { Logger } from '@nestjs/common';
import * as Twilio from 'twilio';
import { SmsProvider, SmsSendResult } from './sms-provider.interface';

export class TwilioProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger(TwilioProvider.name);
  private client: Twilio.Twilio | null = null;
  private from: string;

  constructor(accountSid?: string, authToken?: string, phoneNumber?: string) {
    this.from = phoneNumber || '';

    if (accountSid && authToken) {
      this.client = Twilio.default(accountSid, authToken);
      this.logger.log('Twilio provider initialized');
    }
  }

  isConfigured(): boolean {
    return !!this.client && !!this.from;
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (!this.client || !this.from) {
      return { success: false, error: 'Twilio not configured' };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.from,
        to,
      });

      this.logger.log(`SMS sent via Twilio to ${to} (SID: ${result.sid})`);
      return { success: true, messageId: result.sid };
    } catch (error) {
      // Non-retryable errors
      if (
        error.code === 21211 || // Invalid phone number
        error.code === 21408 || // Permission denied
        error.code === 21610    // Unsubscribed recipient
      ) {
        return { success: false, error: `Non-retryable: ${error.message}` };
      }
      throw error; // Let retry logic in SmsService handle it
    }
  }
}
