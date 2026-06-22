import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  Header,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../../auth/decorators/public.decorator";
import { verifyCallbackHash } from "./paytr-hash.util";
import { PaytrIpAllowlistGuard } from "./paytr-ip-allowlist.guard";
import { CustomerSelfPayService } from "../../customer-orders/services/customer-self-pay.service";
import { PaytrSettlementService } from "../services/paytr-settlement.service";
import { CheckoutSettlementService } from "../../checkout/checkout-settlement.service";

interface PaytrCallbackBody {
  merchant_oid?: string;
  status?: string;
  total_amount?: string;
  hash?: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  payment_type?: string;
  currency?: string;
  test_mode?: string;
}

/**
 * PayTR posts to this endpoint server-to-server after the user completes
 * (or fails) the hosted payment. The contract:
 *
 *   - Verify HMAC-SHA256 over `${merchant_oid}${salt}${status}${total_amount}`.
 *   - Always respond with plain text "OK" or "FAIL".
 *   - Be idempotent: the same callback may arrive multiple times.
 *   - Respond "OK" for unknown merchant_oids so PayTR doesn't keep
 *     retrying (and so we don't leak which OIDs exist).
 *
 * The IP allowlist guard is *defence in depth* — HMAC is still the
 * primary authentication. The guard quietly drops non-allowlisted IPs
 * with OK; the controller never sees them.
 *
 * Subscription settlement work (state machine, invoice creation, token
 * encryption, notifications, marketing commissions) is delegated to
 * `PaytrSettlementService` so the hourly inquiry-recovery sweeper can
 * reuse the exact same code path.
 */
@Controller("webhooks/paytr")
export class PaytrWebhookController {
  private readonly logger = new Logger(PaytrWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly selfPay: CustomerSelfPayService,
    private readonly settlement: PaytrSettlementService,
    // v2.8.85: "CK-" prefix lands here for the mixed-cart checkout flow.
    private readonly checkoutSettlement: CheckoutSettlementService,
  ) {}

  @Post()
  @Public()
  @UseGuards(PaytrIpAllowlistGuard)
  @HttpCode(200)
  @Header("Content-Type", "text/plain")
  async handle(@Body() body: PaytrCallbackBody): Promise<string> {
    const merchantOid = body.merchant_oid ?? "";
    const status = body.status ?? "";
    const totalAmount = body.total_amount ?? "";
    const providedHash = body.hash ?? "";

    const merchantKey = this.config.get<string>("PAYTR_MERCHANT_KEY");
    const merchantSalt = this.config.get<string>("PAYTR_MERCHANT_SALT");
    if (!merchantKey || !merchantSalt) {
      // v2.8.94 — when creds are missing we cannot verify the hash, so
      // the only honest answer is "FAIL". Pre-fix the controller
      // returned "OK" to avoid PayTR's retry storm — but a sustained
      // "OK" stream during a misconfig also silently acknowledges any
      // forged callback that lands while creds are down (the settlement
      // call is skipped, so it's mostly cosmetic, but ops loses the
      // strongest signal that something is wrong). PayTR retries (4×
      // over ~30min) are the loudest possible alert; ops should fix
      // creds before the window expires.
      this.logger.error(
        "PayTR credentials missing — refusing to acknowledge callback; ops MUST restore env before retry window expires",
      );
      return "FAIL";
    }

    if (
      !verifyCallbackHash({
        merchantOid,
        merchantSalt,
        status,
        totalAmount,
        merchantKey,
        providedHash,
      })
    ) {
      this.logger.warn(
        `Rejected PayTR callback with bad hash for oid=${merchantOid}`,
      );
      return "FAIL";
    }

    // Dispatch by merchantOid prefix:
    //   "SP" → customer self-pay (QR-menu restaurant-order flow)
    //   "CK-" → mixed-cart hardware/addon/plan checkout (v2.8.85)
    //   default → subscription settlement (the original path)
    if (merchantOid.startsWith("SP")) {
      try {
        if (status === "success") {
          await this.selfPay.handleWebhookSuccess(
            merchantOid,
            body.payment_type,
          );
        } else {
          await this.selfPay.handleWebhookFailure(
            merchantOid,
            body.failed_reason_msg ?? body.failed_reason_code,
          );
        }
      } catch (err) {
        // Mirror the CK- branch: a DB blip mid-settlement must NOT bubble to a
        // non-200 (PayTR would then retry 4×). The self-pay settlement is
        // idempotent + PARTIALLY_SETTLED-healing, so swallow + log and still
        // return "OK"; a sweeper / next retry reconciles.
        this.logger.error(
          `Self-pay settlement raised for oid=${merchantOid}: ${(err as Error).message}`,
        );
      }
      return "OK";
    }

    if (merchantOid.startsWith("CK-")) {
      try {
        if (status === "success") {
          await this.checkoutSettlement.handleSuccess(
            merchantOid,
            body.payment_type,
          );
        } else {
          await this.checkoutSettlement.handleFailure(
            merchantOid,
            body.failed_reason_msg ?? body.failed_reason_code,
          );
        }
      } catch (err) {
        // Provisioning errors throw so a manual retry / sweeper can pick
        // them up. PayTR still gets "OK" — if we returned "FAIL", PayTR
        // would retry up to 4× and each retry would re-attempt
        // provisioning. Better to surface a single failure in our logs
        // than to feedback-loop the gateway.
        this.logger.error(
          `Checkout settlement raised for oid=${merchantOid}: ${(err as Error).message}`,
        );
      }
      return "OK";
    }

    await this.settlement.settlePayment(
      merchantOid,
      status === "success"
        ? {
            kind: "success",
            paymentType: body.payment_type,
            totalAmount,
          }
        : {
            kind: "failure",
            failureCode: body.failed_reason_code,
            failureMessage: body.failed_reason_msg,
          },
    );

    return "OK";
  }
}
