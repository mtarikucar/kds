import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import axios from "axios";
import { Prisma } from "@prisma/client";
import { decryptString } from "../../../common/helpers/encryption.helper";

/**
 * PayTR's TR merchant account only supports collecting TRY. The adapter
 * itself emits the wire-format string "TL" — PayTR's internal label —
 * but every caller MUST pass "TRY" (or, for parity with PayTR's own
 * label, "TL"). Anything else (USD, EUR, ...) would otherwise silently
 * collect the same numeric amount in TL because PayTR ignores the
 * currency field for non-TR accounts. The user-reported incident
 * ("199 $ olan şey 199 TL olarak satın alınıyor") was exactly this
 * shape: a plan priced in USD displayed as $199 on the storefront,
 * adapter posted `payment_amount=19900 currency=TL`, customer paid
 * 199 TL.
 *
 * Refuse the call here at the boundary — every higher-level caller
 * (PaymentsService.createIntent, CustomerSelfPayService.createPayIntent,
 * PaytrPaymentProvider.createIntent) now passes the source currency
 * explicitly so the failure surfaces as a 400 before any SubscriptionPayment
 * / PendingSelfPayment row is reserved.
 */
const PAYTR_SUPPORTED_CURRENCIES = new Set(["TRY", "TL"]);
const PAYTR_WIRE_CURRENCY = "TL";

function assertPaytrCurrency(currency: string): void {
  if (!PAYTR_SUPPORTED_CURRENCIES.has(currency)) {
    throw new BadRequestException(
      `PayTR yalnızca TRY desteklemektedir — istenen para birimi: ${currency}. ` +
        "Planı/siparişi TRY ile fiyatlandırın veya başka bir ödeme sağlayıcısı seçin.",
    );
  }
}

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

export function amountToKurus(
  amount: number | string | Prisma.Decimal,
): string {
  const decimal = new Prisma.Decimal(amount);
  if (decimal.isNegative()) {
    throw new Error("PayTR amount must be non-negative");
  }
  return decimal
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(0);
}

export function encodeUserBasket(
  basket: Array<[string, string, number]>,
): string {
  return Buffer.from(JSON.stringify(basket), "utf-8").toString("base64");
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
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
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
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
}

export interface RefundPayload {
  merchantId: string;
  merchantOid: string;
  returnAmount: string; // kuruş
}

export function buildRefundSignature(
  payload: RefundPayload,
  creds: PaytrCredentials,
): string {
  const concat =
    payload.merchantId + payload.merchantOid + payload.returnAmount;
  return crypto
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
}

export interface InquiryPayload {
  merchantId: string;
  merchantOid: string;
}

export function buildInquirySignature(
  payload: InquiryPayload,
  creds: PaytrCredentials,
): string {
  const concat = payload.merchantId + payload.merchantOid;
  return crypto
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
}

export interface RecurringCancelPayload {
  merchantId: string;
  utoken: string;
}

export function buildRecurringCancelSignature(
  payload: RecurringCancelPayload,
  creds: PaytrCredentials,
): string {
  const concat = payload.merchantId + payload.utoken;
  return crypto
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
}

export interface BinDetailPayload {
  merchantId: string;
  binNumber: string;
}

export function buildBinDetailSignature(
  payload: BinDetailPayload,
  creds: PaytrCredentials,
): string {
  const concat = payload.merchantId + payload.binNumber;
  return crypto
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
}

export interface InstallmentTablePayload {
  merchantId: string;
  amount: string; // kuruş
}

export function buildInstallmentTableSignature(
  payload: InstallmentTablePayload,
  creds: PaytrCredentials,
): string {
  const concat = payload.merchantId + payload.amount;
  return crypto
    .createHmac("sha256", creds.merchantKey)
    .update(concat + creds.merchantSalt)
    .digest("base64");
}

export function buildPaymentUrl(token: string): string {
  return `https://www.paytr.com/odeme/guvenli/${token}`;
}

/* ------------------------------------------------------------------ */
/* Injectable HTTP adapter                                             */
/* ------------------------------------------------------------------ */

const PAYTR_TOKEN_ENDPOINT = "https://www.paytr.com/odeme/api/get-token";
const PAYTR_RECURRING_ENDPOINT =
  "https://www.paytr.com/odeme/api/recurring-payment";
const PAYTR_REFUND_ENDPOINT = "https://www.paytr.com/odeme/api/iade";
const PAYTR_INQUIRY_ENDPOINT = "https://www.paytr.com/odeme/api/durum-sorgu";
const PAYTR_RECURRING_CANCEL_ENDPOINT =
  "https://www.paytr.com/odeme/api/recurring-payment-cancel";
const PAYTR_BIN_DETAIL_ENDPOINT = "https://www.paytr.com/odeme/api/bin-detail";
const PAYTR_INSTALLMENT_TABLE_ENDPOINT =
  "https://www.paytr.com/odeme/api/taksit-orani";

export interface GetIframeTokenInput {
  merchantOid: string;
  amount: Prisma.Decimal | number | string;
  /**
   * Source currency code from the plan/order. Validated against PayTR's
   * supported set at the adapter boundary — anything other than TRY/TL
   * throws BadRequestException before the get-token HTTP call fires.
   * Callers MUST pass the actual currency (do NOT hardcode 'TRY' just
   * to satisfy this check — that recreates the original bug).
   */
  currency: string;
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
  currency: "TL";
}

export interface ChargeRecurringInput {
  merchantOid: string;
  amount: Prisma.Decimal | number | string;
  /** Source currency — same validation rules as GetIframeTokenInput.currency. */
  currency: string;
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
  status: "success" | "failed";
  reason?: string;
  raw: unknown;
}

export interface RefundInput {
  merchantOid: string;
  /** Full or partial refund amount. `undefined` means full payment refund. */
  amount: Prisma.Decimal | number | string;
  /** Optional internal reference, echoed back in audit log only. */
  referenceNo?: string;
}

export interface RefundResult {
  status: "success" | "failed";
  reason?: string;
  raw: unknown;
}

export interface InquiryResult {
  /**
   * Normalised status. PayTR's raw response shape varies, so we map it
   * to a closed set the caller can switch on safely.
   */
  status: "success" | "failed" | "pending" | "unknown";
  paymentAmount?: string;
  paymentType?: string;
  failedReasonCode?: string;
  failedReasonMsg?: string;
  raw: unknown;
}

export interface CancelRecurringTokenResult {
  status: "success" | "failed";
  reason?: string;
  raw: unknown;
}

export interface BinDetailResult {
  cardBrand?: string;
  cardType?: string;
  cardFamily?: string;
  bankName?: string;
  raw: unknown;
}

export interface InstallmentRateRow {
  installmentCount: number;
  rate: string;
  totalAmount: string;
}

export interface InstallmentTableResult {
  rates: InstallmentRateRow[];
  raw: unknown;
}

@Injectable()
export class PaytrAdapter {
  private readonly logger = new Logger(PaytrAdapter.name);

  constructor(private readonly config: ConfigService) {
    // PAYTR_USE_FAKE_ADAPTER is an E2E-only short-circuit that mints
    // synthetic "successful" tokens without hitting PayTR — useful for
    // CI / dev. In production the flag MUST be off; leaving it on means
    // every payment attempt looks successful while no real money moves,
    // and worse, the webhook callback would arrive carrying the
    // synthetic OID and the settlement service would treat it as a
    // genuine paid invoice. Fail loud at startup rather than silently
    // accept the misconfig.
    const fake = this.config.get<string>("PAYTR_USE_FAKE_ADAPTER");
    const env = this.config.get<string>("NODE_ENV");
    if (env === "production" && fake === "true") {
      throw new Error(
        "PAYTR_USE_FAKE_ADAPTER=true is forbidden in production — refusing to boot",
      );
    }
  }

  private get credentials(): PaytrCredentials & {
    merchantId: string;
    testMode: string;
  } {
    const merchantId = this.config.get<string>("PAYTR_MERCHANT_ID");
    const merchantKey = this.config.get<string>("PAYTR_MERCHANT_KEY");
    const merchantSalt = this.config.get<string>("PAYTR_MERCHANT_SALT");
    const testMode = this.config.get<string>("PAYTR_TEST_MODE") ?? "1";
    if (!merchantId || !merchantKey || !merchantSalt) {
      throw new Error("PayTR credentials are not configured");
    }
    return { merchantId, merchantKey, merchantSalt, testMode };
  }

  async getIframeToken(
    input: GetIframeTokenInput,
  ): Promise<GetIframeTokenResult> {
    // Fail loud + early: refuse non-TRY at the boundary so the higher-
    // level caller never reserves a SubscriptionPayment / PendingSelfPayment
    // row that the adapter then silently collects in TL.
    assertPaytrCurrency(input.currency);

    const { merchantId, merchantKey, merchantSalt, testMode } =
      this.credentials;

    const paymentAmount = amountToKurus(input.amount);

    // E2E-only short-circuit: when the harness sets PAYTR_USE_FAKE_ADAPTER=true
    // skip the real paytr.com HTTP call and return a deterministic synthetic
    // token. The test runner can then drive the webhook (`/webhooks/paytr`)
    // with a hash signed by the same `MERCHANT_KEY/SALT` the backend booted
    // with, exercising the full create-intent → webhook → state-change chain
    // without depending on PayTR sandbox reachability. The flag is gated on
    // a dedicated env var (not on test_mode or merchant_id format) so a misconfigured
    // production env can never accidentally mint fake tokens.
    if (this.config.get<string>("PAYTR_USE_FAKE_ADAPTER") === "true") {
      const synthetic = `e2e-token-${input.merchantOid}`;
      return {
        token: synthetic,
        paymentLink: buildPaymentUrl(synthetic),
        merchantOid: input.merchantOid,
        amount: paymentAmount,
        currency: "TL",
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
      noInstallment: "0",
      maxInstallment: "0",
      currency: "TL",
      testMode,
    };
    const paytrToken = buildIframeTokenSignature(payload, {
      merchantKey,
      merchantSalt,
    });

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
      debug_on: testMode === "1" ? "1" : "0",
      no_installment: "0",
      max_installment: "0",
      user_name: input.userName,
      user_address: input.userAddress,
      user_phone: input.userPhone,
      merchant_ok_url: input.okUrl,
      merchant_fail_url: input.failUrl,
      timeout_limit: "30",
      currency: "TL",
      test_mode: testMode,
    });

    let response;
    try {
      response = await axios.post(PAYTR_TOKEN_ENDPOINT, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR get-token HTTP failure: ${err?.message}`);
      throw new BadGatewayException("PayTR is currently unreachable");
    }

    const body = response.data;
    if (body?.status !== "success" || !body?.token) {
      this.logger.error(`PayTR get-token rejected: ${JSON.stringify(body)}`);
      // PayTR is inconsistent about the error field — sometimes `reason`,
      // sometimes `err_msg`, sometimes `errors`. Fall through all of them.
      const msg =
        body?.reason ??
        body?.err_msg ??
        body?.errors ??
        "PayTR rejected the payment intent";
      throw new BadGatewayException(msg);
    }

    return {
      token: body.token,
      paymentLink: buildPaymentUrl(body.token),
      merchantOid: input.merchantOid,
      amount: paymentAmount,
      currency: "TL",
    };
  }

  async chargeRecurring(
    input: ChargeRecurringInput,
  ): Promise<ChargeRecurringResult> {
    assertPaytrCurrency(input.currency);

    const { merchantId, merchantKey, merchantSalt } = this.credentials;
    const total = amountToKurus(input.amount);
    // The token is stored encrypted at rest; the recurring API needs the
    // raw value. decryptString accepts plaintext for backwards compat.
    const rawToken = decryptString(input.utoken);
    const payload: RecurringPaymentPayload = {
      merchantId,
      utoken: rawToken,
      total,
      currency: "TL",
      merchantOid: input.merchantOid,
    };
    const paytrToken = buildRecurringPaymentSignature(payload, {
      merchantKey,
      merchantSalt,
    });

    const form = new URLSearchParams({
      merchant_id: merchantId,
      utoken: rawToken,
      total,
      currency: "TL",
      merchant_oid: input.merchantOid,
      paytr_token: paytrToken,
      product_name: input.productName ?? "Subscription renewal",
    });

    let response;
    try {
      response = await axios.post(PAYTR_RECURRING_ENDPOINT, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR recurring HTTP failure: ${err?.message}`);
      return {
        status: "failed",
        reason: "paytr_unreachable",
        raw: err?.message,
      };
    }
    const body = response.data;
    if (body?.status === "success") {
      return { status: "success", raw: body };
    }
    return {
      status: "failed",
      reason: body?.err_msg ?? body?.reason ?? "unknown",
      raw: body,
    };
  }

  /**
   * Issue a refund against a previously-settled merchantOid. PayTR's
   * iade endpoint accepts both full and partial refunds — the caller
   * decides which by passing `amount`. Failures return `{ status: 'failed' }`
   * rather than throwing so the ops endpoint can surface the reason to
   * the support agent without unwinding a transaction.
   *
   * E2E short-circuit: when `PAYTR_USE_FAKE_ADAPTER=true` returns a
   * deterministic success without touching paytr.com.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    const { merchantId, merchantKey, merchantSalt } = this.credentials;
    const returnAmount = amountToKurus(input.amount);

    if (this.config.get<string>("PAYTR_USE_FAKE_ADAPTER") === "true") {
      return {
        status: "success",
        raw: { fake: true, merchantOid: input.merchantOid, returnAmount },
      };
    }

    const paytrToken = buildRefundSignature(
      { merchantId, merchantOid: input.merchantOid, returnAmount },
      { merchantKey, merchantSalt },
    );

    const form = new URLSearchParams({
      merchant_id: merchantId,
      merchant_oid: input.merchantOid,
      return_amount: returnAmount,
      paytr_token: paytrToken,
      ...(input.referenceNo ? { reference_no: input.referenceNo } : {}),
    });

    let response;
    try {
      response = await axios.post(PAYTR_REFUND_ENDPOINT, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR refund HTTP failure: ${err?.message}`);
      return {
        status: "failed",
        reason: "paytr_unreachable",
        raw: err?.message,
      };
    }
    const body = response.data;
    if (body?.status === "success") {
      return { status: "success", raw: body };
    }
    return {
      status: "failed",
      reason: body?.err_msg ?? body?.reason ?? "unknown",
      raw: body,
    };
  }

  /**
   * Ask PayTR what the real status of a merchantOid is. Used by the
   * hourly webhook-recovery sweeper when a callback failed to land but
   * the user's card may already have been charged.
   *
   * Mapping from PayTR's `payment_status` / `status` fields:
   *   - 'success' / 'PAID'      → 'success'
   *   - 'failed'  / 'FAILED'    → 'failed'
   *   - 'waiting' / 'PENDING'   → 'pending'
   *   - anything else            → 'unknown' (caller leaves it alone)
   *
   * Never throws — returns 'unknown' on network errors so the sweeper
   * can just retry next hour.
   */
  async inquiryStatus(merchantOid: string): Promise<InquiryResult> {
    const { merchantId, merchantKey, merchantSalt } = this.credentials;

    if (this.config.get<string>("PAYTR_USE_FAKE_ADAPTER") === "true") {
      // E2E helper: the test harness can override the synthetic result by
      // setting PAYTR_FAKE_INQUIRY_STATUS to 'success' | 'failed' | 'pending'.
      // Defaults to 'success' so the happy path needs no extra config.
      const forced = this.config.get<string>("PAYTR_FAKE_INQUIRY_STATUS");
      const status = (forced as InquiryResult["status"]) ?? "success";
      return { status, raw: { fake: true, merchantOid, status } };
    }

    const paytrToken = buildInquirySignature(
      { merchantId, merchantOid },
      { merchantKey, merchantSalt },
    );
    const form = new URLSearchParams({
      merchant_id: merchantId,
      merchant_oid: merchantOid,
      paytr_token: paytrToken,
    });

    let response;
    try {
      response = await axios.post(PAYTR_INQUIRY_ENDPOINT, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR inquiry HTTP failure: ${err?.message}`);
      return { status: "unknown", raw: err?.message };
    }
    const body = response.data ?? {};
    const rawStatus = String(
      body.payment_status ?? body.status ?? "",
    ).toLowerCase();
    let normalised: InquiryResult["status"];
    if (rawStatus === "success" || rawStatus === "paid") normalised = "success";
    else if (rawStatus === "failed" || rawStatus === "fail")
      normalised = "failed";
    else if (rawStatus === "waiting" || rawStatus === "pending")
      normalised = "pending";
    else normalised = "unknown";

    return {
      status: normalised,
      paymentAmount: body.payment_total ?? body.payment_amount,
      paymentType: body.payment_type,
      failedReasonCode: body.failed_reason_code,
      failedReasonMsg: body.failed_reason_msg,
      raw: body,
    };
  }

  /**
   * Revoke a stored recurring token on PayTR's side. Currently not
   * wired into any flow — the codebase moved to manual-renewal model
   * (PayTR's Kart Saklama / Tekrarlayan Ödeme yetkisi closed), so no
   * tokens are ever stored. Kept as a thin adapter wrapper for the
   * day PayTR enables the yetki and we re-introduce stored-card flows.
   *
   * Best-effort: returns `{ status: 'failed' }` on errors rather than
   * throwing.
   */
  async cancelRecurringToken(
    encryptedUtoken: string,
  ): Promise<CancelRecurringTokenResult> {
    const { merchantId, merchantKey, merchantSalt } = this.credentials;

    if (this.config.get<string>("PAYTR_USE_FAKE_ADAPTER") === "true") {
      return { status: "success", raw: { fake: true } };
    }

    // Stored encrypted at rest; PayTR needs the plaintext token.
    // decryptString accepts plaintext too for legacy compat.
    const rawToken = decryptString(encryptedUtoken);
    const paytrToken = buildRecurringCancelSignature(
      { merchantId, utoken: rawToken },
      { merchantKey, merchantSalt },
    );
    const form = new URLSearchParams({
      merchant_id: merchantId,
      utoken: rawToken,
      paytr_token: paytrToken,
    });

    let response;
    try {
      response = await axios.post(
        PAYTR_RECURRING_CANCEL_ENDPOINT,
        form.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15_000,
        },
      );
    } catch (err: any) {
      this.logger.error(`PayTR recurring-cancel HTTP failure: ${err?.message}`);
      return {
        status: "failed",
        reason: "paytr_unreachable",
        raw: err?.message,
      };
    }
    const body = response.data;
    if (body?.status === "success") {
      return { status: "success", raw: body };
    }
    return {
      status: "failed",
      reason: body?.err_msg ?? body?.reason ?? "unknown",
      raw: body,
    };
  }

  /**
   * Look up card metadata by BIN (first 6 digits). Useful for showing
   * the card brand/bank logo before the user types the rest of the
   * number, or for fraud heuristics. Currently no caller in the
   * codebase — exposed for future UX work.
   */
  async binDetail(binNumber: string): Promise<BinDetailResult> {
    const { merchantId, merchantKey, merchantSalt } = this.credentials;

    if (this.config.get<string>("PAYTR_USE_FAKE_ADAPTER") === "true") {
      return {
        cardBrand: "visa",
        cardType: "credit",
        bankName: "Fake Bank",
        raw: { fake: true, binNumber },
      };
    }

    const paytrToken = buildBinDetailSignature(
      { merchantId, binNumber },
      { merchantKey, merchantSalt },
    );
    const form = new URLSearchParams({
      merchant_id: merchantId,
      bin_number: binNumber,
      paytr_token: paytrToken,
    });

    let response;
    try {
      response = await axios.post(PAYTR_BIN_DETAIL_ENDPOINT, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
      });
    } catch (err: any) {
      this.logger.error(`PayTR bin-detail HTTP failure: ${err?.message}`);
      // Read-only lookup — return empty result instead of throwing so the
      // caller (UX nicety, not a billing path) can render a card without
      // the brand badge.
      return { raw: err?.message };
    }
    const body = response.data ?? {};
    return {
      cardBrand: body.brand ?? body.card_brand,
      cardType: body.type ?? body.card_type,
      cardFamily: body.family ?? body.card_family,
      bankName: body.bank ?? body.bank_name,
      raw: body,
    };
  }

  /**
   * Fetch the installment-rate table PayTR would apply for a given
   * amount. Currently no caller in the codebase — exposed for future
   * checkout UX work where the user picks the installment count
   * before the iframe redirect.
   */
  async installmentRates(
    amount: Prisma.Decimal | number | string,
  ): Promise<InstallmentTableResult> {
    const { merchantId, merchantKey, merchantSalt } = this.credentials;
    const amountKurus = amountToKurus(amount);

    if (this.config.get<string>("PAYTR_USE_FAKE_ADAPTER") === "true") {
      return {
        rates: [
          { installmentCount: 1, rate: "0", totalAmount: amountKurus },
          { installmentCount: 3, rate: "0.02", totalAmount: amountKurus },
        ],
        raw: { fake: true, amountKurus },
      };
    }

    const paytrToken = buildInstallmentTableSignature(
      { merchantId, amount: amountKurus },
      { merchantKey, merchantSalt },
    );
    const form = new URLSearchParams({
      merchant_id: merchantId,
      amount: amountKurus,
      paytr_token: paytrToken,
    });

    let response;
    try {
      response = await axios.post(
        PAYTR_INSTALLMENT_TABLE_ENDPOINT,
        form.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15_000,
        },
      );
    } catch (err: any) {
      this.logger.error(`PayTR taksit-orani HTTP failure: ${err?.message}`);
      // UX-only endpoint — failing back to "no installment options" is
      // safer than throwing and breaking the checkout page render.
      return { rates: [], raw: err?.message };
    }
    const body = response.data ?? {};
    // PayTR returns the table under varying keys depending on the
    // product configuration. Look for the common ones, fall back to
    // empty list so a misconfigured response doesn't crash callers.
    const rawRates = body.installments ?? body.taksitler ?? body.rates ?? [];
    const rates: InstallmentRateRow[] = Array.isArray(rawRates)
      ? rawRates.map((r: any) => ({
          installmentCount: Number(r.installment ?? r.taksit ?? r.count ?? 0),
          rate: String(r.rate ?? r.oran ?? "0"),
          totalAmount: String(r.total ?? r.tutar ?? r.amount ?? amountKurus),
        }))
      : [];
    return { rates, raw: body };
  }
}
