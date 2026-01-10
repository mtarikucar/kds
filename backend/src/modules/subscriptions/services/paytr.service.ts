import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';

interface PaytrLinkParams {
  merchantOid: string;
  email: string;
  amount: number;
  userName: string;
  userPhone: string;
  userAddress: string;
  description: string;
  successUrl: string;
  failUrl: string;
  maxInstallment?: number;
  expiryDuration?: number;
}

interface PaytrLinkResponse {
  status: 'success' | 'failed';
  link?: string;
  token?: string;
  reason?: string;
}

export interface PaytrCallbackPayload {
  merchant_oid: string;
  status: string;
  total_amount: string;
  hash: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  test_mode?: string;
  payment_type?: string;
  currency?: string;
  payment_amount?: string;
}

@Injectable()
export class PaytrService {
  private readonly logger = new Logger(PaytrService.name);
  private merchantId: string;
  private merchantKey: string;
  private merchantSalt: string;
  private baseUrl: string;
  private testMode: boolean;

  constructor(private configService: ConfigService) {
    this.merchantId = this.configService.get<string>('PAYTR_MERCHANT_ID') || '';
    this.merchantKey = this.configService.get<string>('PAYTR_MERCHANT_KEY') || '';
    this.merchantSalt = this.configService.get<string>('PAYTR_MERCHANT_SALT') || '';
    this.baseUrl = this.configService.get<string>('PAYTR_BASE_URL', 'https://www.paytr.com');
    this.testMode = this.configService.get<string>('PAYTR_TEST_MODE', 'true') === 'true';

    if (!this.merchantId || !this.merchantKey || !this.merchantSalt) {
      this.logger.warn('PayTR credentials not configured. PayTR payments will be disabled.');
    }
  }

  /**
   * Create PayTR Link API payment link
   */
  async createPaymentLink(params: PaytrLinkParams): Promise<PaytrLinkResponse> {
    if (!this.merchantId || !this.merchantKey || !this.merchantSalt) {
      throw new BadRequestException('PayTR payment service is not configured');
    }

    const amountKurus = Math.round(params.amount * 100); // Convert TRY to kurus
    const expiryDuration = params.expiryDuration || 30; // Default 30 minutes
    const maxInstallment = params.maxInstallment || 0; // 0 = no installment

    // Prepare user basket (JSON format)
    const userBasket = JSON.stringify([
      [params.description, '1', amountKurus.toString()]
    ]);
    const userBasketBase64 = Buffer.from(userBasket).toString('base64');

    // Create hash token for Link API
    // Hash formula: merchant_id + user_ip + merchant_oid + email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode + merchant_salt
    const userIp = '127.0.0.1'; // Will be replaced with actual IP in controller
    const noInstallment = maxInstallment === 1 ? '1' : '0';
    const currency = 'TL';
    const testModeStr = this.testMode ? '1' : '0';

    const hashStr = `${this.merchantId}${userIp}${params.merchantOid}${params.email}${amountKurus}${userBasketBase64}${noInstallment}${maxInstallment}${currency}${testModeStr}${this.merchantSalt}`;
    const token = this.generateHash(hashStr);

    const postData = {
      merchant_id: this.merchantId,
      user_ip: userIp,
      merchant_oid: params.merchantOid,
      email: params.email,
      payment_amount: amountKurus.toString(),
      paytr_token: token,
      user_name: params.userName,
      user_address: params.userAddress,
      user_phone: params.userPhone,
      user_basket: userBasketBase64,
      debug_on: this.testMode ? '1' : '0',
      test_mode: testModeStr,
      no_installment: noInstallment,
      max_installment: maxInstallment.toString(),
      currency: currency,
      lang: 'tr',
      merchant_ok_url: params.successUrl,
      merchant_fail_url: params.failUrl,
      timeout_limit: expiryDuration.toString(),
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/odeme/api/get-token`,
        new URLSearchParams(postData as Record<string, string>).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      if (response.data.status === 'success') {
        this.logger.log(`PayTR payment token created: ${params.merchantOid}`);
        return {
          status: 'success',
          link: `${this.baseUrl}/odeme/guvenli/${response.data.token}`,
          token: response.data.token,
        };
      } else {
        this.logger.error(`PayTR token creation failed: ${response.data.reason}`);
        return {
          status: 'failed',
          reason: response.data.reason,
        };
      }
    } catch (error) {
      this.logger.error(`PayTR API error: ${error.message}`);
      throw new BadRequestException('Failed to create payment link');
    }
  }

  /**
   * Verify PayTR callback hash
   */
  verifyCallback(payload: PaytrCallbackPayload): boolean {
    // Hash formula: merchant_oid + merchant_salt + status + total_amount
    const hashStr = `${payload.merchant_oid}${this.merchantSalt}${payload.status}${payload.total_amount}`;
    const expectedHash = this.generateHash(hashStr);
    const isValid = payload.hash === expectedHash;

    if (!isValid) {
      this.logger.error(`PayTR callback hash mismatch. Expected: ${expectedHash}, Received: ${payload.hash}`);
    }

    return isValid;
  }

  /**
   * Generate HMAC-SHA256 hash in base64
   */
  private generateHash(data: string): string {
    return crypto
      .createHmac('sha256', this.merchantKey)
      .update(data)
      .digest('base64');
  }

  /**
   * Parse callback payload
   */
  parseCallback(payload: PaytrCallbackPayload) {
    return {
      merchantOid: payload.merchant_oid,
      status: payload.status === 'success' ? 'success' : 'failed',
      totalAmount: parseInt(payload.total_amount) / 100, // Convert kurus to TRY
      failedReason: payload.failed_reason_msg,
      paymentType: payload.payment_type,
      currency: payload.currency || 'TRY',
      isTestMode: payload.test_mode === '1',
    };
  }

  /**
   * Check if PayTR is configured
   */
  isConfigured(): boolean {
    return !!(this.merchantId && this.merchantKey && this.merchantSalt);
  }
}
