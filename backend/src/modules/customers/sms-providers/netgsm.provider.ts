import { Logger } from '@nestjs/common';
import { SmsProvider, SmsSendResult } from './sms-provider.interface';

export class NetGsmProvider implements SmsProvider {
  readonly name = 'netgsm';
  private readonly logger = new Logger(NetGsmProvider.name);
  private readonly apiUrl = 'https://api.netgsm.com.tr/sms/send/get';
  private usercode: string;
  private password: string;
  private msgheader: string;

  constructor(usercode?: string, password?: string, msgheader?: string) {
    this.usercode = usercode || '';
    this.password = password || '';
    this.msgheader = msgheader || '';

    if (this.isConfigured()) {
      this.logger.log('NetGSM provider initialized');
    }
  }

  isConfigured(): boolean {
    return !!this.usercode && !!this.password && !!this.msgheader;
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'NetGSM not configured' };
    }

    // NetGSM expects Turkish format: 05xx or 5xx (strip +90 prefix)
    const normalizedPhone = this.normalizePhone(to);

    const params = new URLSearchParams({
      usercode: this.usercode,
      password: this.password,
      gsmno: normalizedPhone,
      message: message,
      msgheader: this.msgheader,
      dession: '0', // Immediate send
    });

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const responseText = await response.text();
      const resultCode = responseText.trim().split(' ')[0];

      // NetGSM success codes: 00, 01, 02 mean queued/sent
      if (['00', '01', '02'].includes(resultCode)) {
        const messageId = responseText.trim().split(' ')[1] || resultCode;
        this.logger.log(`SMS sent via NetGSM to ${normalizedPhone} (ID: ${messageId})`);
        return { success: true, messageId };
      }

      // Error codes
      const errorMap: Record<string, string> = {
        '20': 'Message text too long or empty',
        '30': 'Invalid credentials',
        '40': 'Sender ID (msgheader) not registered',
        '50': 'Recipient number invalid',
        '51': 'Recipient number incorrect format',
        '70': 'Invalid parameters',
        '80': 'Query limit exceeded',
        '85': 'Duplicate message within 15 minutes',
      };

      const errorMsg = errorMap[resultCode] || `NetGSM error code: ${resultCode}`;
      this.logger.error(`NetGSM SMS failed for ${normalizedPhone}: ${errorMsg}`);

      // Non-retryable errors
      if (['30', '40', '50', '51'].includes(resultCode)) {
        return { success: false, error: `Non-retryable: ${errorMsg}` };
      }

      throw new Error(errorMsg); // Let retry logic handle
    } catch (error) {
      if (error.message?.startsWith('Non-retryable:')) {
        return { success: false, error: error.message };
      }
      throw error; // Let retry logic in SmsService handle it
    }
  }

  private normalizePhone(phone: string): string {
    let normalized = phone.replace(/[\s\-\(\)]/g, '');

    // +905xxxxxxxxx → 5xxxxxxxxx
    if (normalized.startsWith('+90')) {
      normalized = normalized.slice(3);
    }
    // 905xxxxxxxxx → 5xxxxxxxxx
    if (normalized.startsWith('90') && normalized.length === 12) {
      normalized = normalized.slice(2);
    }
    // 05xxxxxxxxx → 5xxxxxxxxx
    if (normalized.startsWith('0') && normalized.length === 11) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }
}
