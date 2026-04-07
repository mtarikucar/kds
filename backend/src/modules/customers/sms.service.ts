import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider, SmsSendResult } from './sms-providers/sms-provider.interface';
import { TwilioProvider } from './sms-providers/twilio.provider';
import { NetGsmProvider } from './sms-providers/netgsm.provider';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private provider: SmsProvider | null = null;
  private mockMode: boolean;

  constructor(private configService: ConfigService) {
    this.provider = this.initializeProvider();
    this.mockMode = !this.provider;

    if (this.mockMode) {
      this.logger.warn('No SMS provider configured - SMS will be mocked');
    }
  }

  private initializeProvider(): SmsProvider | null {
    const providerName = (this.configService.get<string>('SMS_PROVIDER') || '').toLowerCase();

    // Explicit provider selection
    if (providerName === 'netgsm') {
      const provider = new NetGsmProvider(
        this.configService.get<string>('NETGSM_USERCODE'),
        this.configService.get<string>('NETGSM_PASSWORD'),
        this.configService.get<string>('NETGSM_MSGHEADER'),
      );
      if (provider.isConfigured()) return provider;
      this.logger.warn('NetGSM selected but credentials missing');
      return null;
    }

    if (providerName === 'twilio') {
      const provider = new TwilioProvider(
        this.configService.get<string>('TWILIO_ACCOUNT_SID'),
        this.configService.get<string>('TWILIO_AUTH_TOKEN'),
        this.configService.get<string>('TWILIO_PHONE_NUMBER'),
      );
      if (provider.isConfigured()) return provider;
      this.logger.warn('Twilio selected but credentials missing');
      return null;
    }

    // Auto-detect: try NetGSM first (cheaper for TR), then Twilio
    const netgsm = new NetGsmProvider(
      this.configService.get<string>('NETGSM_USERCODE'),
      this.configService.get<string>('NETGSM_PASSWORD'),
      this.configService.get<string>('NETGSM_MSGHEADER'),
    );
    if (netgsm.isConfigured()) return netgsm;

    const twilio = new TwilioProvider(
      this.configService.get<string>('TWILIO_ACCOUNT_SID'),
      this.configService.get<string>('TWILIO_AUTH_TOKEN'),
      this.configService.get<string>('TWILIO_PHONE_NUMBER'),
    );
    if (twilio.isConfigured()) return twilio;

    return null;
  }

  /**
   * Send SMS with retry logic
   */
  async send(
    to: string,
    message: string,
    maxRetries: number = 3,
  ): Promise<SmsSendResult> {
    if (this.mockMode || !this.provider) {
      this.logger.log(`[MOCK SMS] To: ${to}, Message: ${message}`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.provider.send(to, message);

        // Provider returned a non-retryable error
        if (!result.success && result.error?.startsWith('Non-retryable:')) {
          this.logger.error(`${this.provider.name} non-retryable error for ${to}: ${result.error}`);
          return result;
        }

        if (result.success) return result;

        // Unexpected failure without throw
        lastError = new Error(result.error || 'Unknown error');
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `SMS send attempt ${attempt}/${maxRetries} failed for ${to} via ${this.provider.name}: ${error.message}`,
        );
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.logger.error(
      `Failed to send SMS to ${to} via ${this.provider.name} after ${maxRetries} attempts: ${lastError?.message}`,
    );

    return { success: false, error: lastError?.message || 'Unknown error' };
  }

  /**
   * Send verification code SMS
   */
  async sendVerificationCode(phone: string, code: string): Promise<boolean> {
    const message = `Your verification code is: ${code}. This code will expire in 10 minutes.`;
    const result = await this.send(phone, message);
    return result.success;
  }

  /**
   * Send custom message
   */
  async sendMessage(phone: string, message: string): Promise<boolean> {
    const result = await this.send(phone, message);
    return result.success;
  }

  /**
   * Check if SMS service is enabled
   */
  isServiceEnabled(): boolean {
    return !this.mockMode;
  }

  /**
   * Get active provider name
   */
  getProviderName(): string {
    return this.provider?.name || 'mock';
  }
}
