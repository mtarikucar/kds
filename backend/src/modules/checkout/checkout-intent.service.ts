import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymentsFacadeService } from "../payments-core/payments-facade.service";
import { Cart, CartQuote } from "./checkout.types";
import { QuoteService } from "./quote.service";
import { CheckoutBuyerDto } from "./dto/create-intent.dto";

// v2.8.85 — turns a mixed cart into a PayTR iframe token.
//
// The flow:
//   1. Re-price the cart server-side (don't trust client totals).
//   2. Mint a CheckoutIntent row with a stable paymentRef = "CK-<uuid7>".
//      The cart shape is frozen at this row so the webhook callback —
//      which only carries merchant_oid + total_amount — can recover the
//      original lines and run CheckoutService.confirmAndProvision.
//   3. Build a multi-line PayTR basket from the quote so the buyer sees
//      each item on the hosted payment page (one of the must-haves the
//      single-line legacy createIntent quietly broke).
//   4. Call PaymentsFacade.createIntent → returns the iframe token +
//      paymentLink. Return both to the frontend.
//
// Idempotency: the controller doesn't expose paymentRef to the caller
// (it's minted internally per request), so each /intent click creates a
// new row. The webhook side is the one that has to be idempotent (PayTR
// retries are aggressive); CheckoutService.confirmAndProvision already
// guards on (tenant, paymentRef) and the CheckoutIntent.status check
// short-circuits a second provisioning pass.

// PayTR's merchant_oid limit is 64 chars. "CK-" + 36-char uuid = 39 chars,
// well under the cap.
const PAYMENT_REF_PREFIX = "CK-";

export interface CreateIntentResult {
  paymentRef: string;
  iframeToken: string;
  paymentLink: string;
  amountCents: number;
  currency: string;
  quote: CartQuote;
}

@Injectable()
export class CheckoutIntentService {
  private readonly logger = new Logger(CheckoutIntentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteSvc: QuoteService,
    private readonly payments: PaymentsFacadeService,
  ) {}

  async createIntent(args: {
    tenantId: string;
    cart: Cart;
    buyer: CheckoutBuyerDto;
    buyerIp: string;
    returnUrl?: string;
  }): Promise<CreateIntentResult> {
    const { tenantId, cart, buyer, buyerIp, returnUrl } = args;
    const quote = await this.quoteSvc.quote(cart);

    if (quote.totalCents <= 0) {
      // PayTR rejects amount=0; surface a clean BadRequest instead of a
      // gateway 400 (which would be cached as a generic failure).
      throw new BadRequestException(
        "Cart total is 0 — nothing to charge. Use the admin-comp path for free provisioning.",
      );
    }

    const paymentRef = `${PAYMENT_REF_PREFIX}${uuidv7()}`;

    // Build the buyer-facing basket from priced lines. PayTR sums
    // (price * qty) across the basket and rejects any mismatch with
    // amountCents — which means per-unit pricing for a line with qty>1
    // can fail to round-trip (lineTotal/qty * qty != lineTotal whenever
    // the division has a remainder). Collapse every cart line to a
    // single qty=1 basket entry and fold the original qty into the name
    // ("Yazarkasa Hugin Tiger T300 x2"). The buyer still sees the
    // multiplicity; we get a clean basket sum.
    // Line prices are KDV-inclusive (gross), so the only overhead to spread
    // across the basket is shipping. Use the GROSS line sum (not quote.subtotal,
    // which is now NET) so basket entries sum exactly to totalCents.
    const grossLineSum = quote.lines.reduce((a, l) => a + l.subtotalCents, 0);
    const overhead = quote.totalCents - grossLineSum; // shipping only
    const lineOverheads = this.distributeOverhead(
      quote.lines.map((l) => l.subtotalCents),
      overhead,
    );
    const basket = quote.lines.map((line, i) => {
      const cadenceSuffix =
        line.cadence === "oneTime"
          ? ""
          : ` (${line.cadence === "yearly" ? "yıllık" : "aylık"})`;
      const qtySuffix = line.qty > 1 ? ` x${line.qty}` : "";
      return {
        name: `${line.name}${qtySuffix}${cadenceSuffix}`,
        priceCents: line.subtotalCents + lineOverheads[i],
        qty: 1,
      };
    });

    // Persist the intent row BEFORE calling PayTR. If PayTR rejects the
    // token request, the row stays in 'pending' and a sweeper can mark
    // it 'failed' later; if we'd called PayTR first and the DB write
    // failed, the buyer would see a working iframe but we'd have no
    // server-side record to settle against.
    await this.prisma.checkoutIntent.create({
      data: {
        id: uuidv7(),
        tenantId,
        paymentRef,
        cartJson: cart as any,
        amountCents: quote.totalCents,
        currency: quote.currency,
        providerId: "paytr",
        status: "pending",
      },
    });

    const intent = await this.payments.createIntent("paytr", {
      tenantId,
      externalRef: paymentRef,
      idempotencyKey: paymentRef,
      amountCents: quote.totalCents,
      currency: quote.currency,
      purpose: "mixed-cart-checkout",
      buyer: {
        email: buyer.email,
        name: buyer.name,
        phone: buyer.phone,
        address: buyer.address,
      },
      buyerIp,
      returnUrl,
      basket,
    });

    const clientAction = (intent.clientAction ?? {}) as Record<string, unknown>;
    const iframeToken = String(clientAction.iframeToken ?? "");
    const paymentLink = String(clientAction.paymentLink ?? "");

    return {
      paymentRef,
      iframeToken,
      paymentLink,
      amountCents: quote.totalCents,
      currency: quote.currency,
      quote,
    };
  }

  /**
   * Distribute tax + shipping (overhead) across cart lines proportionally
   * to each line's subtotal. Returns the per-line overhead share in
   * cents; the caller adds it to the line subtotal to build the basket
   * entry. We round per-line and drop the rounding remainder on the
   * largest-subtotal line so `sum(returned) === overhead` exactly.
   *
   * This is purely for the buyer-facing basket display; the persisted
   * CheckoutIntent.amountCents is the authoritative number.
   */
  private distributeOverhead(subtotals: number[], overhead: number): number[] {
    if (subtotals.length === 0) return [];
    const subtotalSum = subtotals.reduce((a, s) => a + s, 0);
    if (subtotalSum === 0) {
      // Degenerate case — split overhead evenly across lines, with the
      // rounding remainder on line 0.
      const each = Math.floor(overhead / subtotals.length);
      const out = subtotals.map(() => each);
      out[0] += overhead - each * subtotals.length;
      return out;
    }
    let allocated = 0;
    const perLine: number[] = [];
    for (let i = 0; i < subtotals.length; i++) {
      const share = Math.floor((overhead * subtotals[i]) / subtotalSum);
      perLine.push(share);
      allocated += share;
    }
    let largest = 0;
    for (let i = 1; i < subtotals.length; i++) {
      if (subtotals[i] > subtotals[largest]) largest = i;
    }
    perLine[largest] += overhead - allocated;
    return perLine;
  }
}
