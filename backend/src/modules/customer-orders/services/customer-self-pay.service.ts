import { Injectable } from "@nestjs/common";
import { CreatePayIntentDto } from "../dto/pay-intent.dto";
import { SelfPayQueryService } from "./self-pay-query.service";
import { SelfPayIntentService } from "./self-pay-intent.service";
import { SelfPayWebhookService } from "./self-pay-webhook.service";
import { SelfPaySweeperService } from "./self-pay-sweeper.service";

// Re-exported for backwards compatibility: PaymentsService.payByItems
// consults the reservation map to block staff cash collection during an
// in-flight customer PayTR session. The implementation now lives in
// self-pay-reservation.service.ts.
export { fetchOrderItemReservations } from "./self-pay-reservation.service";

/**
 * Thin facade over the customer self-pay flow. The implementation was
 * split (v-refactor) into focused collaborators:
 *   - SelfPayQueryService    — payable-items view + status poll
 *   - SelfPayIntentService   — createPayIntent (FOR-UPDATE txn + PayTR)
 *   - SelfPayWebhookService  — PayTR success/failure settlement
 *   - SelfPaySweeperService  — the @Cron TTL expire
 *
 * This class keeps the original public surface 100% unchanged so
 * CustomerSelfPayController and PaytrWebhookController need ZERO edits.
 * Every method below is a pure delegation; no logic lives here.
 */
@Injectable()
export class CustomerSelfPayService {
  constructor(
    private readonly queryService: SelfPayQueryService,
    private readonly intentService: SelfPayIntentService,
    private readonly webhookService: SelfPayWebhookService,
    private readonly sweeperService: SelfPaySweeperService,
  ) {}

  expireStaleIntents(): Promise<void> {
    return this.sweeperService.expireStaleIntents();
  }

  getPayableItemsForSession(sessionId: string) {
    return this.queryService.getPayableItemsForSession(sessionId);
  }

  createPayIntent(
    sessionId: string,
    dto: CreatePayIntentDto,
    userIp: string,
    returnOrigin?: string,
  ) {
    return this.intentService.createPayIntent(
      sessionId,
      dto,
      userIp,
      returnOrigin,
    );
  }

  getPayStatus(sessionId: string, merchantOid: string) {
    return this.queryService.getPayStatus(sessionId, merchantOid);
  }

  handleWebhookSuccess(
    merchantOid: string,
    paytrPaymentType?: string,
  ): Promise<void> {
    return this.webhookService.handleWebhookSuccess(
      merchantOid,
      paytrPaymentType,
    );
  }

  handleWebhookFailure(
    merchantOid: string,
    reason: string | undefined,
  ): Promise<void> {
    return this.webhookService.handleWebhookFailure(merchantOid, reason);
  }
}
