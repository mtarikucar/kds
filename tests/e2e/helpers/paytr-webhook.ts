import { request } from '@playwright/test';
import * as crypto from 'crypto';
import { API_BASE } from './api';

/**
 * Mirror of `backend/src/modules/payments/webhooks/paytr-hash.util.ts`.
 * The keys must match the ones the backend booted with — that is,
 * whatever `playwright.config.ts` injected via `webServer.env`
 * (real PayTR sandbox creds when PAYTR_* is set in the shell env,
 * deterministic mock values otherwise). Reading from the same env
 * vars keeps the two sides aligned without duplicating the secret.
 */
const MERCHANT_KEY =
  process.env.PAYTR_MERCHANT_KEY || 'e2e-merchant-key-for-hmac-32-chars-long';
const MERCHANT_SALT =
  process.env.PAYTR_MERCHANT_SALT || 'e2e-merchant-salt-for-hmac-32-chars';

function sign(merchantOid: string, status: string, totalAmount: string): string {
  return crypto
    .createHmac('sha256', MERCHANT_KEY)
    .update(`${merchantOid}${MERCHANT_SALT}${status}${totalAmount}`)
    .digest('base64');
}

export type WebhookCommon = {
  merchantOid: string;
  /** Amount in kuruş (PayTR convention): 100 ₺ → "10000". */
  totalAmountKurus: string;
};

/**
 * Simulate a successful PayTR callback. Used by self-pay and
 * subscription specs to drive the post-charge code paths without
 * touching the real PayTR sandbox.
 */
export async function simulatePaytrSuccess(
  args: WebhookCommon & { paymentType?: string },
): Promise<string> {
  const body = {
    merchant_oid: args.merchantOid,
    status: 'success',
    total_amount: args.totalAmountKurus,
    payment_type: args.paymentType ?? 'card',
    hash: sign(args.merchantOid, 'success', args.totalAmountKurus),
  };
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.post('webhooks/paytr', { data: body });
    const text = await res.text();
    if (!res.ok())
      throw new Error(`simulatePaytrSuccess failed: ${res.status()} ${text}`);
    return text;
  } finally {
    await ctx.dispose();
  }
}

export async function simulatePaytrFailure(
  args: WebhookCommon & { reason?: string },
): Promise<string> {
  const body = {
    merchant_oid: args.merchantOid,
    status: 'failed',
    total_amount: args.totalAmountKurus,
    failed_reason_msg: args.reason ?? 'card declined',
    hash: sign(args.merchantOid, 'failed', args.totalAmountKurus),
  };
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.post('webhooks/paytr', { data: body });
    const text = await res.text();
    if (!res.ok())
      throw new Error(`simulatePaytrFailure failed: ${res.status()} ${text}`);
    return text;
  } finally {
    await ctx.dispose();
  }
}
