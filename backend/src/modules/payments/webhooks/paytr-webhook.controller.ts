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
      // Misconfigured deploy — we can't verify the hash. Return "OK" so
      // PayTR stops retrying (which would otherwise cascade into a
      // 30-minute retry storm), and surface a critical error so ops
      // notices and fixes env. Recovery sweeper will reconcile the
      // stuck PENDING rows once creds are restored.
      this.logger.error(
        "PayTR credentials missing — acknowledging callback to stop retries; ops alert raised",
      );
      return "OK";
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

    // Dispatch by merchantOid prefix: "SP" → customer self-pay
    // (QR-menu restaurant-order flow), default → subscription flow.
    if (merchantOid.startsWith("SP")) {
      if (status === "success") {
        await this.selfPay.handleWebhookSuccess(merchantOid, body.payment_type);
      } else {
        await this.selfPay.handleWebhookFailure(
          merchantOid,
          body.failed_reason_msg ?? body.failed_reason_code,
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
