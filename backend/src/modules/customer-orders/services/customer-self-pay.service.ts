import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentsService } from '../../orders/services/payments.service';
import { PaytrAdapter } from '../../payments/adapters/paytr.adapter';
import { CustomerSessionService } from '../../customers/customer-session.service';
import { CreatePayIntentDto } from '../dto/pay-intent.dto';
import { OrderStatus, PaymentStatus } from '../../../common/constants/order-status.enum';

const INTENT_TTL_MINUTES = 60;
const MERCHANT_OID_PREFIX = 'SP'; // "SP" — Self-Pay (subscription is "SUB")

interface ItemsByOrderShape {
  orderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
}

@Injectable()
export class CustomerSelfPayService {
  private readonly logger = new Logger(CustomerSelfPayService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
    private paytrAdapter: PaytrAdapter,
    private customerSessionService: CustomerSessionService,
    private config: ConfigService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  // READ: table-wide payable items for the session's table
  // ──────────────────────────────────────────────────────────────────

  async getPayableItemsForSession(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);

    if (!session.tableId) {
      // Self-pay only makes sense for dine-in (a table-scoped bill).
      // Takeaway/QR-counter orders aren't supported in v1.
      return {
        sessionId,
        tableId: null,
        orders: [],
        summary: {
          totalAmount: '0.00',
          paidAmount: '0.00',
          remainingAmount: '0.00',
          remainingQuantity: 0,
        },
      };
    }

    const orders = await this.prisma.order.findMany({
      where: {
        tableId: session.tableId,
        tenantId: session.tenantId,
        status: {
          notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
        },
      },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: true } },
            orderItemPayments: {
              where: { payment: { status: PaymentStatus.COMPLETED } },
            },
          },
        },
        payments: {
          where: { status: PaymentStatus.COMPLETED },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let grandTotal = new Prisma.Decimal(0);
    let grandPaid = new Prisma.Decimal(0);
    let grandRemainingQty = 0;

    const orderViews = orders.map((o) => {
      const finalAmount = new Prisma.Decimal(o.finalAmount);
      const paidAmount = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      grandTotal = grandTotal.add(finalAmount);
      grandPaid = grandPaid.add(paidAmount);

      const items = o.orderItems.map((item) => {
        const paidQuantity = item.orderItemPayments.reduce(
          (s, a) => s + a.quantity,
          0,
        );
        const remainingQuantity = item.quantity - paidQuantity;
        grandRemainingQty += remainingQuantity;
        const perUnit = this.paymentsService.derivePerUnitNet(item, o);
        const itemTotal = perUnit.mul(item.quantity);
        return {
          orderItemId: item.id,
          productName: item.product?.name ?? null,
          quantity: item.quantity,
          paidQuantity,
          remainingQuantity,
          unitTotal: perUnit.toFixed(2),
          itemTotal: itemTotal.toFixed(2),
          modifierLabels: (item.modifiers || [])
            .map((m) => m.modifier?.displayName || m.modifier?.name || '')
            .filter(Boolean),
        };
      });

      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        finalAmount: finalAmount.toFixed(2),
        paidAmount: paidAmount.toFixed(2),
        remainingAmount: finalAmount.sub(paidAmount).toFixed(2),
        items,
      };
    });

    return {
      sessionId,
      tableId: session.tableId,
      orders: orderViews,
      summary: {
        totalAmount: grandTotal.toFixed(2),
        paidAmount: grandPaid.toFixed(2),
        remainingAmount: grandTotal.sub(grandPaid).toFixed(2),
        remainingQuantity: grandRemainingQty,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // WRITE: PayTR intent
  // ──────────────────────────────────────────────────────────────────

  async createPayIntent(sessionId: string, dto: CreatePayIntentDto, userIp: string) {
    const session = await this.customerSessionService.requireSession(sessionId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: session.tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.paymentRegion !== 'TURKEY') {
      throw new BadRequestException(
        'Self-pay is currently available for Turkey-region tenants only.',
      );
    }
    if (!session.tableId) {
      throw new BadRequestException('Self-pay requires a dine-in session.');
    }

    // Validate items: each orderItemId must (a) belong to an order
    // on the same table + tenant, (b) have enough remaining units.
    // Group by orderId for the per-order payByItems calls.
    const requested = await this.prisma.orderItem.findMany({
      where: {
        id: { in: dto.items.map((i) => i.orderItemId) },
        order: {
          tableId: session.tableId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      },
      include: {
        order: true,
        product: true,
        orderItemPayments: {
          where: { payment: { status: PaymentStatus.COMPLETED } },
        },
      },
    });

    const foundIds = new Set(requested.map((i) => i.id));
    for (const entry of dto.items) {
      if (!foundIds.has(entry.orderItemId)) {
        throw new BadRequestException(
          `Item ${entry.orderItemId} is not payable for this session`,
        );
      }
    }

    // Compute total + per-order groupings (server-derived; client can't override).
    let totalAmount = new Prisma.Decimal(0);
    const itemsByOrder = new Map<string, ItemsByOrderShape>();
    for (const entry of dto.items) {
      const item = requested.find((i) => i.id === entry.orderItemId)!;
      const alreadyPaid = item.orderItemPayments.reduce(
        (s, a) => s + a.quantity,
        0,
      );
      const remaining = item.quantity - alreadyPaid;
      if (entry.quantity > remaining) {
        throw new BadRequestException(
          `Item ${entry.orderItemId} has ${remaining} units remaining, cannot pay ${entry.quantity}`,
        );
      }

      const perUnit = this.paymentsService.derivePerUnitNet(item, item.order);
      const lineAmount = perUnit.mul(entry.quantity);
      totalAmount = totalAmount.add(lineAmount);

      const bucket = itemsByOrder.get(item.orderId) ?? {
        orderId: item.orderId,
        items: [],
      };
      bucket.items.push({ orderItemId: entry.orderItemId, quantity: entry.quantity });
      itemsByOrder.set(item.orderId, bucket);
    }
    totalAmount = totalAmount.toDecimalPlaces(2);

    if (totalAmount.lte(0)) {
      throw new BadRequestException('Nothing to pay');
    }

    const merchantOid = this.generateMerchantOid(session.tenantId);
    const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60_000);

    // Persist intent BEFORE PayTR call so the webhook can find it
    // even if the response races back faster than our DB write.
    const intent = await this.prisma.pendingSelfPayment.create({
      data: {
        merchantOid,
        sessionId,
        tenantId: session.tenantId,
        itemsByOrder: Array.from(itemsByOrder.values()) as any,
        amount: totalAmount,
        status: 'PENDING',
        customerPhone: dto.customerPhone,
        expiresAt,
      },
    });

    // Build PayTR token request.
    const okUrl =
      this.config.get<string>('PAYTR_OK_URL_POS') ??
      this.config.get<string>('PAYTR_OK_URL') ??
      'http://localhost:5173/payment-result';
    const failUrl =
      this.config.get<string>('PAYTR_FAIL_URL_POS') ??
      this.config.get<string>('PAYTR_FAIL_URL') ??
      'http://localhost:5173/payment-result';

    // Basket: one line per item entry.
    const basket: Array<[string, string, number]> = [];
    for (const entry of dto.items) {
      const item = requested.find((i) => i.id === entry.orderItemId)!;
      const perUnit = this.paymentsService.derivePerUnitNet(item, item.order);
      basket.push([
        (item.product as any)?.name?.slice(0, 80) || 'Ürün',
        perUnit.toFixed(2),
        entry.quantity,
      ]);
    }

    try {
      const result = await this.paytrAdapter.getIframeToken({
        merchantOid,
        amount: totalAmount,
        email: dto.customerPhone
          ? `${dto.customerPhone.replace(/\D/g, '')}@self-pay.local`
          : `${sessionId.slice(0, 8)}@self-pay.local`,
        userName: 'Müşteri',
        userAddress: 'Masa',
        userPhone: dto.customerPhone || '0000000000',
        userBasket: basket,
        userIp,
        okUrl: `${okUrl}?oid=${merchantOid}`,
        failUrl: `${failUrl}?oid=${merchantOid}&status=failed`,
      });

      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
        data: { paytrToken: result.token },
      });

      return {
        merchantOid,
        paymentLink: result.paymentLink,
        amount: totalAmount.toFixed(2),
        currency: 'TRY',
      };
    } catch (err: any) {
      // PayTR couldn't issue a token — mark the intent failed so a
      // stuck-PENDING row doesn't haunt the sweeper.
      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
        data: {
          status: 'FAILED',
          failureReason: `paytr_token_error: ${err?.message ?? String(err)}`,
        },
      });
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // READ: poll for status after PayTR redirect
  // ──────────────────────────────────────────────────────────────────

  async getPayStatus(sessionId: string, merchantOid: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    const intent = await this.prisma.pendingSelfPayment.findUnique({
      where: { merchantOid },
    });
    if (!intent || intent.sessionId !== sessionId || intent.tenantId !== session.tenantId) {
      throw new NotFoundException('Payment intent not found for this session');
    }
    const remaining = await this.getPayableItemsForSession(sessionId);
    return {
      merchantOid,
      status: intent.status,
      amount: intent.amount.toFixed(2),
      failureReason: intent.failureReason,
      remaining,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // WEBHOOK: PayTR called us back; settle the intent
  // ──────────────────────────────────────────────────────────────────

  /**
   * Called by PaytrWebhookController when the merchantOid prefix is
   * "SP". Settles every order in the intent's itemsByOrder snapshot
   * via the regular payByItems path (with the merchantOid acting as
   * the idempotency key, so a PayTR retry never double-charges).
   *
   * Always resolves; never throws — the webhook contract is to
   * return plain "OK" to PayTR even on failure, so we log + Sentry.
   */
  async handleWebhookSuccess(
    merchantOid: string,
    paytrPaymentType?: string,
  ): Promise<void> {
    const intent = await this.prisma.pendingSelfPayment.findUnique({
      where: { merchantOid },
    });
    if (!intent) {
      // Unknown — return silently (mirrors subscription-side behaviour)
      this.logger.warn(`self-pay webhook: unknown merchantOid=${merchantOid}`);
      return;
    }
    if (intent.status !== 'PENDING') {
      // Idempotent — PayTR retried; we already settled.
      return;
    }

    const itemsByOrder = intent.itemsByOrder as unknown as ItemsByOrderShape[];

    try {
      for (const bucket of itemsByOrder) {
        await this.paymentsService.payByItems(
          bucket.orderId,
          {
            items: bucket.items,
            method: 'CARD' as any,
            transactionId: merchantOid,
            customerPhone: intent.customerPhone || undefined,
            // Per-order idempotency key — PayTR retry returns the same
            // Payment instead of duplicating. Suffix with orderId so a
            // multi-order intent doesn't collide.
            idempotencyKey: `selfpay:${merchantOid}:${bucket.orderId}`,
            notes: paytrPaymentType
              ? `Self-pay via PayTR (${paytrPaymentType})`
              : 'Self-pay via PayTR',
          },
          intent.tenantId,
        );
      }
      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
        data: { status: 'SUCCEEDED', succeededAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(
        `self-pay settlement failed for ${merchantOid}: ${err?.message ?? err}`,
        err?.stack,
      );
      Sentry.captureException(err, {
        tags: { event: 'SELF_PAY_SETTLEMENT_FAILED', tenantId: intent.tenantId },
        extra: { merchantOid, sessionId: intent.sessionId },
      });
      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
        data: {
          status: 'FAILED',
          failureReason: `settlement_error: ${err?.message ?? String(err)}`,
        },
      });
    }
  }

  async handleWebhookFailure(
    merchantOid: string,
    reason: string | undefined,
  ): Promise<void> {
    await this.prisma.pendingSelfPayment.updateMany({
      where: { merchantOid, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failureReason: reason ?? 'paytr_reported_failure',
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────

  private generateMerchantOid(tenantId: string): string {
    const tenantHex = tenantId.replace(/-/g, '').slice(0, 12);
    const ts = Date.now().toString(36);
    const rand = randomBytes(3).toString('hex');
    return `${MERCHANT_OID_PREFIX}${tenantHex}${ts}${rand}`;
  }
}
