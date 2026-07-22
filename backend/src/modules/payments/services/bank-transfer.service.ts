import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { addHours, addMonths, addYears } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import { resolvePlanAmount } from "../../subscriptions/plan-pricing.helper";
import { BillingService } from "../../subscriptions/services/billing.service";
import { ConsentService } from "../../legal/services/consent.service";
import { OutboxService } from "../../outbox/outbox.service";
import { EventTypes } from "../../outbox/event-types";
import { DemoGuardService } from "../../demo/demo-guard.service";
import {
  BillingCycle,
  PaymentProvider,
  PaymentStatus,
  SubscriptionPlanType,
  SubscriptionStatus,
} from "../../../common/constants/subscription.enum";

const BANK_TRANSFER_METHOD = "bank_transfer";
// Manual transfers take days to arrive + be confirmed; the upgrade target must
// survive that window (vs the 1h PayTR intent TTL).
const HAVALE_PENDING_TTL_HOURS = 24 * 14;

export interface BankTransferIntentResult {
  provider: "BANK_TRANSFER";
  reference: string;
  amount: number;
  currency: string;
  planName: string;
  bankDetails: {
    bankName: string | null;
    accountHolder: string | null;
    iban: string | null;
    instructions: string | null;
  };
}

/**
 * Manual bank-transfer (havale/EFT) subscription payments.
 *
 * PayTR collects TRY only, so a non-TRY plan can't be charged by card. This
 * service is the alternative: the tenant gets the platform's bank details +
 * a unique reference, a PENDING SubscriptionPayment is reserved, and the
 * superadmin CONFIRMS once the money lands — which activates the subscription
 * via the SAME finalization contract as PayTR (claim PENDING→SUCCEEDED,
 * subscription→ACTIVE, invoice, and the `subscription.activated.v1` outbox
 * event so the entitlement projector reprojects). Upgrades reuse the existing
 * `pendingPlanChange` mechanism, keyed by the havale reference.
 */
@Injectable()
export class BankTransferService {
  private readonly logger = new Logger(BankTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly consents: ConsentService,
    private readonly outbox: OutboxService,
    // Demo-tenant real-money block. @Optional so unit tests constructing the
    // service bare keep working — BankTransferModule imports DemoGuardModule
    // so production DI always supplies a real instance; the call site below
    // is `?.`-guarded so a bare-constructed test that never wires this in
    // doesn't perform a real Prisma call it didn't ask for.
    @Optional() private readonly demoGuard?: DemoGuardService,
  ) {}

  // ---- settings (singleton, superadmin) ------------------------------------

  async getSettings() {
    const existing = await this.prisma.bankTransferSettings.findUnique({
      where: { id: "default" },
    });
    if (existing) return existing;
    return this.prisma.bankTransferSettings.create({ data: { id: "default" } });
  }

  async updateSettings(
    dto: {
      enabled?: boolean;
      bankName?: string | null;
      accountHolder?: string | null;
      iban?: string | null;
      instructions?: string | null;
    },
    actorEmail?: string,
  ) {
    // Enabling havale must not leave a half-configured account live — a tenant
    // would otherwise reach the checkout havale screen with no IBAN to pay to.
    // When `enabled` is being flipped on, every account field the tenant needs
    // (bankName, accountHolder, iban) must resolve to a non-empty value, taking
    // the incoming dto first and the already-persisted settings as fallback.
    if (dto.enabled === true) {
      const current = await this.getSettings();
      const resolve = (
        incoming: string | null | undefined,
        stored: string | null,
      ) => (incoming !== undefined ? incoming : stored)?.trim() || "";
      const bankName = resolve(dto.bankName, current.bankName);
      const accountHolder = resolve(dto.accountHolder, current.accountHolder);
      const iban = resolve(dto.iban, current.iban);
      const missing: string[] = [];
      if (!bankName) missing.push("bankName");
      if (!accountHolder) missing.push("accountHolder");
      if (!iban) missing.push("iban");
      if (missing.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          error: "Bad Request",
          errorCode: "INCOMPLETE_BANK_TRANSFER_CONFIG",
          message:
            "Havale ile ödemeyi açmadan önce banka adı, hesap sahibi ve IBAN " +
            `alanlarını doldurun. Eksik: ${missing.join(", ")}.`,
        });
      }
    }

    return this.prisma.bankTransferSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...dto, updatedByEmail: actorEmail },
      update: { ...dto, updatedByEmail: actorEmail },
    });
  }

  /** Public-facing details a paying tenant sees on the checkout havale screen. */
  async getPublicDetails() {
    const s = await this.getSettings();
    return {
      enabled: s.enabled && !!s.iban,
      bankName: s.bankName,
      accountHolder: s.accountHolder,
      iban: s.iban,
      instructions: s.instructions,
    };
  }

  // ---- create a havale intent (tenant) -------------------------------------

  async createIntent(params: {
    tenantId: string;
    userId: string;
    planId: string;
    billingCycle: BillingCycle;
    acceptedDocumentIds: string[];
    userIp?: string;
    userAgent?: string;
  }): Promise<BankTransferIntentResult> {
    // Demo-tenant real-money block — the shared "explore demo" tenant must
    // never reserve a havale payment. First statement, before any DB write.
    await this.demoGuard?.assertNotDemo(params.tenantId);

    const settings = await this.getSettings();
    if (!settings.enabled || !settings.iban) {
      throw new BadRequestException(
        "Havale ile ödeme şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.",
      );
    }

    const [tenant, callingUser, plan] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: params.tenantId },
        include: {
          subscriptions: {
            where: {
              status: {
                in: [
                  SubscriptionStatus.ACTIVE,
                  SubscriptionStatus.TRIALING,
                  SubscriptionStatus.PAST_DUE,
                  SubscriptionStatus.PENDING,
                ],
              },
            },
            include: { plan: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: params.userId },
        select: { email: true, emailVerified: true },
      }),
      this.prisma.subscriptionPlan.findUnique({ where: { id: params.planId } }),
    ]);

    if (!tenant) throw new NotFoundException("Tenant not found");
    if (!callingUser) throw new BadRequestException("Calling user not found");
    if (!callingUser.emailVerified) {
      throw new BadRequestException(
        "Devam etmeden önce e-postanızı doğrulayın. Gelen kutunuzdaki doğrulama kodunu kontrol edin.",
      );
    }
    if (!plan || !plan.isActive) {
      throw new NotFoundException("Plan not found or inactive");
    }
    if (plan.name === SubscriptionPlanType.FREE) {
      throw new BadRequestException("FREE plan için ödeme oluşturulamaz.");
    }

    // Same-plan-while-ACTIVE guard (mirrors payments.service.ts's PayTR
    // rail). `isUpgrade` below is derived from `existingSub.planId !==
    // plan.id` — when the tenant re-selects their CURRENT plan while
    // ACTIVE, isUpgrade is false but createIntent would otherwise still
    // reserve a full-price PENDING SubscriptionPayment. Confirming it
    // writes `currentPeriodStart: now`, which RESETS (not extends) the
    // billing period — burning whatever paid days the tenant had left.
    // Reject before any DB write. PAST_DUE is exempt: that's the
    // legitimate "Şimdi yenile" (renew now) flow — the period already
    // lapsed there, so there's nothing to burn.
    const existingSub = tenant.subscriptions[0];
    if (
      existingSub?.status === SubscriptionStatus.ACTIVE &&
      existingSub.planId === plan.id
    ) {
      throw new ConflictException({
        code: "SAME_PLAN_ACTIVE",
        message:
          "Zaten bu plana abonesiniz. Aynı planı tekrar satın almak yerine faturalandırma döneminizin bitmesini bekleyin.",
      });
    }

    // Same legal gate as the PayTR flow (KVKK + Mesafeli Satış + İade).
    await this.consents.verifyAndRecord(params.acceptedDocumentIds, {
      userId: params.userId,
      ipAddress: params.userIp,
      userAgent: params.userAgent,
    });

    // Honor any active promotional discount — the price the buyer was shown.
    const amount = resolvePlanAmount(plan, params.billingCycle);
    // `existingSub` declared above (same-plan-active guard).
    const isUpgrade = !!existingSub && existingSub.planId !== plan.id;
    const reference = this.generateReference();

    await this.prisma.$transaction(async (tx) => {
      const subscriptionId =
        existingSub?.id ??
        (await this.preCreatePendingSubscription(
          tx,
          params.tenantId,
          plan.id,
          params.billingCycle,
          amount,
          plan.currency,
        ));

      await tx.subscriptionPayment.create({
        data: {
          subscriptionId,
          amount,
          currency: plan.currency,
          status: PaymentStatus.PENDING,
          paymentProvider: PaymentProvider.BANK_TRANSFER,
          paymentMethod: BANK_TRANSFER_METHOD,
          // The human reference the tenant writes on the transfer + the key
          // the superadmin confirms against + the pendingPlanChange anchor.
          externalReference: reference,
        },
      });

      // Upgrade of an existing subscription: keep their current plan ACTIVE
      // until the money is confirmed; the target rides a pendingPlanChange
      // (keyed by the havale reference, reusing the merchantOid column).
      if (isUpgrade) {
        await tx.pendingPlanChange.create({
          data: {
            subscriptionId: existingSub!.id,
            targetPlanId: plan.id,
            billingCycle: params.billingCycle,
            merchantOid: reference,
            expiresAt: addHours(new Date(), HAVALE_PENDING_TTL_HOURS),
          },
        });
      }
    });

    return {
      provider: "BANK_TRANSFER",
      reference,
      amount: new Prisma.Decimal(amount).toNumber(),
      currency: plan.currency,
      planName: plan.displayName,
      bankDetails: {
        bankName: settings.bankName,
        accountHolder: settings.accountHolder,
        iban: settings.iban,
        instructions: settings.instructions,
      },
    };
  }

  // ---- superadmin: list / confirm / reject ---------------------------------

  async listPending() {
    return this.prisma.subscriptionPayment.findMany({
      where: {
        paymentProvider: PaymentProvider.BANK_TRANSFER,
        status: PaymentStatus.PENDING,
      },
      include: {
        subscription: { include: { plan: true, tenant: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Confirm a received bank transfer → activate the subscription. Mirrors
   * PaytrSettlementService.applySuccess's essential steps (atomic claim,
   * activate, invoice, SubscriptionActivated outbox event) for the
   * BANK_TRANSFER provider. Idempotent: the atomic PENDING→SUCCEEDED claim
   * means a double-confirm is a no-op.
   */
  async confirm(paymentId: string, actorEmail?: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: { subscription: { include: { plan: true, tenant: true } } },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    if (payment.paymentProvider !== PaymentProvider.BANK_TRANSFER) {
      throw new BadRequestException("Not a bank-transfer payment");
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        `Payment is already ${payment.status.toLowerCase()}`,
      );
    }

    const subscription = payment.subscription;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const upgrade = payment.externalReference
        ? await tx.pendingPlanChange.findUnique({
            where: { merchantOid: payment.externalReference },
            include: { targetPlan: true },
          })
        : null;

      const finalPlan = upgrade ? upgrade.targetPlan : subscription.plan;
      const finalPlanId = finalPlan.id;
      const billingCycle = upgrade
        ? upgrade.billingCycle
        : subscription.billingCycle;
      // Record what was actually CHARGED — the discounted amount frozen on the
      // payment at intent time (createIntent uses resolvePlanAmount). The havale
      // confirm can lag the request by up to 14 days, so re-deriving here would
      // overstate the record if the promo window closed in between. True parity
      // with the PayTR settlement rail (paytr-settlement: finalAmount =
      // payment.amount). billingCycle is still used for the period math below.
      const finalAmount = payment.amount as Prisma.Decimal;
      const finalCurrency = upgrade
        ? upgrade.targetPlan.currency
        : payment.currency;
      const periodEnd =
        billingCycle === BillingCycle.MONTHLY
          ? addMonths(now, 1)
          : addYears(now, 1);

      // Atomic claim — only the first confirm transitions PENDING→SUCCEEDED,
      // so a double-confirm can't double-activate or double-invoice.
      const claim = await tx.subscriptionPayment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: now,
          paymentMethod: BANK_TRANSFER_METHOD,
        },
      });
      if (claim.count === 0) {
        throw new BadRequestException("Payment was already finalized");
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          planId: finalPlanId,
          billingCycle,
          amount: finalAmount,
          currency: finalCurrency,
          paymentProvider: PaymentProvider.BANK_TRANSFER,
          isTrialPeriod: false,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      await tx.tenant.update({
        where: { id: subscription.tenantId },
        data: { currentPlanId: finalPlanId },
      });

      await this.billing.createInvoice(
        tx,
        subscription.id,
        payment.id,
        finalAmount,
        finalCurrency,
        now,
        periodEnd,
        `${finalPlan.displayName} planına abonelik (havale)`,
      );

      if (upgrade) {
        await tx.pendingPlanChange.delete({ where: { id: upgrade.id } });
      }

      // Load-bearing: the entitlement projector reprojects on this event, so
      // the tenant actually receives the plan's features after confirmation.
      await this.outbox.append(
        {
          type: EventTypes.SubscriptionActivated,
          tenantId: subscription.tenantId,
          payload: {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            planCode: finalPlan.name,
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: periodEnd.toISOString(),
          },
        },
        tx as any,
      );
    });

    this.logger.log(
      `Bank transfer ${payment.externalReference ?? payment.id} confirmed by ${actorEmail ?? "superadmin"} → subscription ${subscription.id} ACTIVE`,
    );
    return { confirmed: true, subscriptionId: subscription.id };
  }

  /** Reject a claimed transfer (money never arrived / wrong amount). */
  async reject(paymentId: string, reason?: string, actorEmail?: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: { subscription: true },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    if (payment.paymentProvider !== PaymentProvider.BANK_TRANSFER) {
      throw new BadRequestException("Not a bank-transfer payment");
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        `Payment is already ${payment.status.toLowerCase()}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPayment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.FAILED,
          failureMessage: reason ?? "Rejected by superadmin",
        },
      });
      // If the subscription never activated (still PENDING from this intent),
      // expire it so it doesn't linger. An already-ACTIVE subscription (an
      // upgrade attempt) is left untouched — the tenant keeps their old plan.
      if (payment.subscription.status === SubscriptionStatus.PENDING) {
        await tx.subscription.update({
          where: { id: payment.subscription.id },
          data: { status: SubscriptionStatus.EXPIRED, endedAt: new Date() },
        });
      }
      if (payment.externalReference) {
        await tx.pendingPlanChange.deleteMany({
          where: { merchantOid: payment.externalReference },
        });
      }
    });

    this.logger.log(
      `Bank transfer ${payment.externalReference ?? payment.id} rejected by ${actorEmail ?? "superadmin"}${reason ? ` (${reason})` : ""}`,
    );
    return { rejected: true };
  }

  // ---- helpers -------------------------------------------------------------

  private generateReference(): string {
    // Short, human-transcribable reference the tenant writes on the transfer.
    return `HVL-${randomBytes(4).toString("hex").toUpperCase()}`;
  }

  private async preCreatePendingSubscription(
    tx: Prisma.TransactionClient,
    tenantId: string,
    planId: string,
    billingCycle: string,
    amount: Prisma.Decimal | number | string,
    currency: string,
  ): Promise<string> {
    const now = new Date();
    const created = await tx.subscription.create({
      data: {
        tenantId,
        planId,
        status: SubscriptionStatus.PENDING,
        billingCycle,
        paymentProvider: PaymentProvider.BANK_TRANSFER,
        startDate: now,
        currentPeriodStart: now,
        // Placeholder; overwritten on confirmation. Keeps the partial-unique
        // (tenantId) where status IN (ACTIVE,TRIALING) index satisfiable.
        currentPeriodEnd: addHours(now, HAVALE_PENDING_TTL_HOURS),
        amount,
        currency,
      },
    });
    return created.id;
  }
}
