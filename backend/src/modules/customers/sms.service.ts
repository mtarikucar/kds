import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private twilioClient: Twilio.Twilio | null = null;
  private isEnabled: boolean;

  constructor(private configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

    if (accountSid && authToken) {
      this.twilioClient = Twilio.default(accountSid, authToken);
      this.isEnabled = true;
      this.logger.log('Twilio SMS service initialized');
    } else {
      this.isEnabled = false;
      this.logger.warn(
        'Twilio credentials not configured - SMS will be mocked',
      );
    }
  }

  /**
   * Send SMS with retry logic
   */
  async send(
    to: string,
    message: string,
    maxRetries: number = 3,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isEnabled || !this.twilioClient) {
      // Mock mode for development
      this.logger.log(`[MOCK SMS] To: ${to}, Message: ${message}`);
      return {
        success: true,
        messageId: `mock-${Date.now()}`,
      };
    }

    const from = this.configService.get<string>('TWILIO_PHONE_NUMBER');

    if (!from) {
      this.logger.error('TWILIO_PHONE_NUMBER not configured');
      return {
        success: false,
        error: 'SMS service not properly configured',
      };
    }

    let lastError: Error | null = null;

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.twilioClient.messages.create({
          body: message,
          from,
          to,
        });

        this.logger.log(
          `SMS sent successfully to ${to} (SID: ${result.sid})`,
        );

        return {
          success: true,
          messageId: result.sid,
        };
      } catch (error) {
        lastError = error as Error;

        this.logger.warn(
          `SMS send attempt ${attempt}/${maxRetries} failed for ${to}: ${error.message}`,
        );

        // Don't retry on certain errors
        if (
          error.code === 21211 || // Invalid phone number
          error.code === 21408 || // Permission denied
          error.code === 21610    // Unsubscribed recipient
        ) {
          this.logger.error(`Non-retryable error for ${to}: ${error.message}`);
          break;
        }

        // Wait before retry (exponential backoff: 1s, 2s, 4s)
        if (attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt - 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries failed
    this.logger.error(
      `Failed to send SMS to ${to} after ${maxRetries} attempts: ${lastError?.message}`,
    );

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
    };
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
    return this.isEnabled;
  }
}
