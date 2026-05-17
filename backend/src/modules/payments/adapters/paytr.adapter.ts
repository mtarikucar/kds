import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { decryptString } from '../../../common/helpers/encryption.helper';

/**
 * PayTR iFrame Token API adapter.
 *
 * Three primitives are exported as pure functions (and unit-tested) so the
 * cryptographic shape can be verified without spinning up a Nest container
 * or stubbing axios. The injectable {@link PaytrAdapter} composes them
 * with HTTP I/O.
 *
 * Hash formulas come from PayTR's "iFrame API" and "Tekrarlı Ödeme"
 * (recurring payment) documentation. The callback-side hash lives in
 * `../webhooks/paytr-hash.util.ts` since the webhook controller owns
 * verification.
 */

export interface PaytrCredentials {
  merchantKey: string;
  merchantSalt: string;
}

export interface IframeTokenPayload {
  merchantId: string;
  userIp: string;
  merchantOid: string;
  email: string;
  paymentAmount: string; // kuruş, as string
  userBasketBase64: string;
  noInstallment: string; // "0" or "1"
  maxInstallment: string; // "0" = no limit
  currency: string; // "TL" for TRY
  testMode: string; // "0" or "1"
}

export interface RecurringPaymentPayload {
  merchantId: string;
  utoken: string; // recurring token stored on the tenant
  total: string; // kuruş
  currency: string;
  merchantOid: string;
}

export function amountToKurus(amount: number | string | Prisma.Decimal): string {
  const decimal = new Prisma.Decimal(amount);
  if (decimal.isNegative()) {
    throw new Error('PayTR amount must be non-negative');
  }
  return decimal
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(0);
}

export function encodeUserBasket(
  basket: Array<[string, string, number]>,
): string {
  return Buffer.from(JSON.stringify(basket), 'utf-8').toString('base64');
}

export function buildIframeTokenSignature(
  payload: IframeTokenPayload,
  creds: PaytrCredentials,
): string {
  const concat =
    payload.merchantId +
    payload.userIp +
    payload.merchantOid +
    payload.email +
    payload.paymentAmount +
    payload.userBasketBase64 +
    payload.noInstallment +
    payload.maxInstallment +
    payload.currency +
    payload.testMode;
  return crypto
    .createHmac('sha256', creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest('base64');
}

export function buildRecurringPaymentSignature(
  payload: RecurringPaymentPayload,
  creds: PaytrCredentials,
): string {
  const concat =
    payload.merchantId +
    payload.utoken +
    payload.total +
    payload.currency +
    payload.merchantOid;
  return crypto
    .createHmac('sha256', creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest('base64');
}

export function buildPaymentUrl(token: string): string {
  return `https://www.paytr.com/odeme/guvenli/${token}`;
}

/* ------------------------------------------------------------------ */
/* Injectable HTTP adapter                                             */
/* ------------------------------------------------------------------ */

const PAYTR_TOKEN_ENDPOINT = 'https://www.paytr.com/odeme/api/get-token';
const PAYTR_RECURRING_ENDPOINT = 'https://www.paytr.com/odeme/api/recurring-payment';

export interface GetIframeTokenInput {
  merchantOid: string;
  amount: Prisma.Decimal | number | string;
  email: string;
  userName: string;
  userAddress: string;
  userPhone: string;
  userBasket: Array<[string, string, number]>;
  userIp: string;
  okUrl: string;
  failUrl: string;
}

export interface GetIframeTokenResult {
  token: string;
  paymentLink: string;
  merchantOid: string;
  amount: string; // kuruş
  currency: 'TL';
}

export interface ChargeRecurringInput {
  merchantOid: string;
  amount: Prisma.Decimal | number | string;
  /**
   * Stored PayTR recurring token. Pass it as written to
   * `Tenant.paytrRecurringToken` (encrypted with `encryptString`); the
   * adapter decrypts internally. Legacy/plaintext tokens still work
   * because `decryptString` accepts both formats.
   */
  utoken: string;
  productName?: string;
}

export interface ChargeRecurringResult {
  status: 'success' | 'failed';
  reason?: string;
  raw: unknown;
}

@Injectable()
export class PaytrAdapter {
  private readonly logger = new Logger(PaytrAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get credentials(): PaytrCredentials & { merchantId: string; testMode: string } {
    const merchantId = this.config.get<string>('PAYTR_MERCHANT_ID');
    const merchantKey = this.config.get<string>('PAYTR_MERCHANT_KEY');
    const merchantSalt = this.config.get<string>('PAYTR_MERCHANT_SALT');
    const testMode = this.config.get<string>('PAYTR_TEST_MODE') ?? '1';
    if (!merchantId || !merchantKey || !merchantSalt) {
      throw new Error('PayTR credentials are not configured');
    }
    return { merchantId, merchantKey, merchantSalt, testMode };
  }

  async getIframeToken(input: GetIframeTokenInput): Promise<GetIframeTokenResult> {
    const { merchantId, merchantKey, merchantSalt, testMode } = this.credentials;

    const paymentAmount = amountToKurus(input.amount);

    // E2E-only short-circuit: when the harness sets PAYTR_USE_FAKE_ADAPTER=true
    // skip the real paytr.com HTTP call and return a deterministic synthetic
    // token. The test runner can then drive the webhook (`/webhooks/paytr`)
    // with a hash signed by the same `MERCHANT_KEY/SALT` the backend booted
    // with, exercising the full create-intent → webhook → state-change chain
    // without depending on PayTR sandbox reachability. The flag is gated on
    // a dedicated env var (not on test_mode or merchant_id format) so a misconfigured
    // production env can never accidentally mint fake tokens.
    if (this.config.get<string>('PAYTR_USE_FAKE_ADAPTER') === 'true') {
      const synthetic = `e2e-token-${input.merchantOid}`;
      return {
        token: synthetic,
        paymentLink: buildPaymentUrl(synthetic),
        merchantOid: input.merchantOid,
        amount: paymentAmount,
        currency: 'TL',
      };
    }

    const userBasketBase64 = encodeUserBasket(input.userBasket);
    const payload: IframeTokenPayload = {
      merchantId,
      userIp: input.userIp,
      merchantOid: input.merchantOid,
      email: input.email,
      paymentAmount,
      userBasketBase64,
      noInstallment: '0',
      maxInstallment: '0',
      currency: 'TL',
      testMode,
    };
    const paytrToken = buildIframeTokenSignature(payload, { merchantKey, merchantSalt });

    const form = new URLSearchParams({
      merchant_id: merchantId,
      user_ip: input.userIp,
      merchant_oid: input.merchantOid,
      email: input.email,
      payment_amount: paymentAmount,
      paytr_token: paytrToken,
      user_basket: userBasketBase64,
      // debug_on follows test_mode — verbose PayTR-side logging in test
      // mode, off in production so PayTR doesn't echo back full payload
      // details with every response.
      debug_on: testMode === '1' ? '1' : '0',
      no_installment: '0',
      max_installment: '0',
      user_name: input.userName,
      user_address: input.userAddress,
      user_phone: input.userPhone,
      merchant_ok_url: input.okUrl,
      merchant_fail_url: input.failUrl,
      timeout_limit: '30',
      currency: 'TL',
      test_mode: testMode,
    });

    let response;
    try {
      response = await axios.post(PAYTR_TOKEN_ENDPOINT, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR get-token HTTP failure: ${err?.message}`);
      throw new BadGatewayException('PayTR is currently unreachable');
    }

    const body = response.data;
    if (body?.status !== 'success' || !body?.token) {
      this.logger.error(`PayTR get-token rejected: ${JSON.stringify(body)}`);
      // PayTR is inconsistent about the error field — sometimes `reason`,
      // sometimes `err_msg`, sometimes `errors`. Fall through all of them.
      const msg =
        body?.reason ?? body?.err_msg ?? body?.errors ?? 'PayTR rejected the payment intent';
      throw new BadGatewayException(msg);
    }

    return {
      token: body.token,
      paymentLink: buildPaymentUrl(body.token),
      merchantOid: input.merchantOid,
      amount: paymentAmount,
      currency: 'TL',
    };
  }

  async chargeRecurring(input: ChargeRecurringInput): Promise<ChargeRecurringResult> {
    const { merchantId, merchantKey, merchantSalt } = this.credentials;
    const total = amountToKurus(input.amount);
    // The token is stored encrypted at rest; the recurring API needs the
    // raw value. decryptString accepts plaintext for backwards compat.
    const rawToken = decryptString(input.utoken);
    const payload: RecurringPaymentPayload = {
      merchantId,
      utoken: rawToken,
      total,
      currency: 'TL',
      merchantOid: input.merchantOid,
    };
    const paytrToken = buildRecurringPaymentSignature(payload, { merchantKey, merchantSalt });

    const form = new URLSearchParams({
      merchant_id: merchantId,
      utoken: rawToken,
      total,
      currency: 'TL',
      merchant_oid: input.merchantOid,
      paytr_token: paytrToken,
      product_name: input.productName ?? 'Subscription renewal',
    });

    let response;
    try {
      response = await axios.post(PAYTR_RECURRING_ENDPOINT, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR recurring HTTP failure: ${err?.message}`);
      return { status: 'failed', reason: 'paytr_unreachable', raw: err?.message };
    }
    const body = response.data;
    if (body?.status === 'success') {
      return { status: 'success', raw: body };
    }
    return { status: 'failed', reason: body?.err_msg ?? body?.reason ?? 'unknown', raw: body };
  }
}
