import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { addHours } from 'date-fns';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaytrAdapter } from './adapters/paytr.adapter';
import { SubscriptionService } from '../subscriptions/services/subscription.service';
import {
  BillingCycle,
  PaymentProvider,
  PaymentStatus,
  SubscriptionPlanType,
  SubscriptionStatus,
} from '../../common/constants/subscription.enum';
import { CreateIntentDto } from './dto/create-intent.dto';

export interface CreateIntentResult {
  provider: 'PAYTR' | 'TRIAL';
  paymentLink?: string;
  merchantOid?: string;
  amount: number;
  currency: string;
  // Set when the tenant was trial-eligible and we activated a trial
  // without charging. Frontend skips PayTR and lands on the dashboard.
  trialActivated?: boolean;
}

const INTENT_TTL_HOURS = 1;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paytr: PaytrAdapter,
    private readonly config: ConfigService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * Reserve a SubscriptionPayment row, mint a PayTR iFrame token, and
   * persist a PendingPlanChange (for upgrades) or pre-create a PENDING
   * subscription (for first-time subscribes).
   *
   * Two short-circuits before we talk to PayTR:
   *   1. Trial-eligible tenants → activate trial via SubscriptionService.
   *   2. (no short-circuit) → reserve rows and call PayTR.
   *
   * Idempotency lives on the generated merchantOid — random bytes plus
   * timestamp give us collision-free OIDs even on rapid double-taps.
   */
  async createIntent(
    tenantId: string,
    userId: string,
    dto: CreateIntentDto,
    userIp: string,
  ): Promise<CreateIntentResult> {
    const [tenant, callingUser] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
            // Plan included so trial-eligibility can distinguish a real
            // paid subscription from the auto-created FREE sub that
            // every tenant gets on registration.
            include: { plan: true },
            take: 1,
          },
        },
      }),
      // The user driving the checkout owns the receipt details, not
      // some arbitrary ADMIN. Phone isn't in the JWT so we fetch.
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          emailVerified: true,
        },
      }),
    ]);
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!callingUser) throw new BadRequestException('Calling user not found');

    // Mirror the email-verified gate that SubscriptionService.createSubscription
    // enforces. Without this, PayTR could collect money for a tenant who
    // would then fail their first SubscriptionService call (renewals,
    // upgrades, anything that needs email confirmation).
    if (!callingUser.emailVerified) {
      throw new BadRequestException(
        'Email must be verified before subscribing. Please check your inbox for the verification code.',
      );
    }

    // PayTR's get-token endpoint rejects empty user_phone with
    // "Zorunlu alan degeri gecersiz veya gonderilmedi: user_phone".
    // Fail fast with a structured code so the frontend can route the
    // user to their profile page to fill it in, then back to checkout
    // (handled in CheckoutPage.tsx onError + ProfilePage.tsx returnTo).
    const trimmedPhone = (callingUser.phone ?? '').trim();
    if (!trimmedPhone) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Profile Phone Required',
        code: 'PROFILE_PHONE_REQUIRED',
        message:
          'Telefon numarası gereklidir. Lütfen profilinize bir telefon ekleyin ve ödeme adımına geri dönün.',
      });
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plan not found or inactive');
    }
    // No payment intent for the FREE plan — every tenant has FREE
    // attached from registration and there's nothing to charge. The
    // PayTR adapter would 0-amount-reject anyway; failing fast here
    // gives the user a clearer error.
    if (plan.name === SubscriptionPlanType.FREE) {
      throw new BadRequestException(
        'Cannot create a payment intent for the FREE plan',
      );
    }

    const amount =
      dto.billingCycle === BillingCycle.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice;

    // (1) Trial-eligible? Activate trial; no PayTR charge during trial.
    //
    // Trial is a LIFETIME-PER-TENANT benefit. Registration auto-starts
    // a 14-day BUSINESS trial (see AuthService.register), so by the time
    // a tenant reaches `/payments/create-intent` they've almost always
    // already burned their trial. The `tenant.trialUsed` boolean is the
    // canonical gate — once true, no further trials, regardless of which
    // paid plan they pick. (We still write `usedTrialPlanIds` for audit,
    // but reading it as the gate would let an old tenant who trialed
    // BASIC also trial PRO/BUSINESS for free, which is the bug we just
    // closed.)
    const existingSub = tenant.subscriptions[0];
    const isOnFreeOrNone =
      !existingSub || existingSub.plan.name === SubscriptionPlanType.FREE;
    const hasUsedAnyTrial = tenant.trialUsed === true;
    const trialEligible =
      isOnFreeOrNone &&
      !hasUsedAnyTrial &&
      plan.trialDays > 0 &&
      plan.name !== SubscriptionPlanType.FREE;
    if (trialEligible) {
      await this.subscriptions.startTrialFromIntent({
        tenantId,
        callingUserId: userId,
        planId: plan.id,
        billingCycle: dto.billingCycle as BillingCycle,
      });
      // Return the *plan* price (what they'll be charged after trial
      // ends), not 0 — the frontend uses this to render
      // "Free for 14 days, then 1299 TRY/month" for PRO etc.
      return {
        provider: 'TRIAL',
        amount: new Prisma.Decimal(amount).toNumber(),
        currency: plan.currency,
        trialActivated: true,
      };
    }

    // (2) Real PayTR flow. merchant_oid must be strictly alphanumeric
    //     per PayTR's documented format; dashes from UUIDs would be
    //     rejected at get-token time.
    const merchantOid = this.generateMerchantOid(tenantId);
    const isUpgrade = !!existingSub && existingSub.planId !== plan.id;

    const { paymentId } = await this.prisma.$transaction(async (tx) => {
      const subscriptionId =
        existingSub?.id ??
        (await this.preCreatePendingSubscription(
          tx,
          tenantId,
          plan.id,
          dto.billingCycle,
          amount,
          plan.currency,
        ));

      // Reserve the payment row — its unique paytrMerchantOid is the
      // idempotency key the webhook will match on.
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId,
          amount,
          currency: plan.currency,
          status: PaymentStatus.PENDING,
          paymentProvider: PaymentProvider.PAYTR,
          paytrMerchantOid: merchantOid,
        },
      });

      // Record the upgrade target so the webhook knows what to switch to.
      if (isUpgrade) {
        await tx.pendingPlanChange.create({
          data: {
            subscriptionId: existingSub!.id,
            targetPlanId: plan.id,
            billingCycle: dto.billingCycle,
            merchantOid,
            expiresAt: addHours(new Date(), INTENT_TTL_HOURS),
          },
        });
      }

      return { paymentId: payment.id };
    });

    // Network call outside the transaction.
    let token;
    try {
      token = await this.paytr.getIframeToken({
        merchantOid,
        amount,
        email: callingUser.email,
        userName:
          `${callingUser.firstName ?? ''} ${callingUser.lastName ?? ''}`.trim() ||
          callingUser.email,
        // PayTR rejects get-token with "Zorunlu alan degeri gecersiz veya
        // gonderilmedi: user_address" when this is empty. We don't capture
        // a tenant-level postal address yet, so fall back to the country
        // string — accepted by PayTR as a valid buyer address.
        userAddress: 'Türkiye',
        // Empty phone was rejected above with PROFILE_PHONE_REQUIRED, so
        // by this point trimmedPhone is guaranteed non-empty.
        userPhone: trimmedPhone,
        userBasket: [[plan.displayName, new Prisma.Decimal(amount).toFixed(2), 1]],
        userIp,
        okUrl: this.config.get<string>('PAYTR_OK_URL') ?? 'http://localhost:5173/subscription/success',
        failUrl: this.config.get<string>('PAYTR_FAIL_URL') ?? 'http://localhost:5173/subscription/fail',
      });
    } catch (err) {
      // PayTR rejected → mark the payment FAILED and re-throw so the
      // controller can surface a 502 to the client. The payment row is
      // intentionally left behind for audit.
      await this.prisma.subscriptionPayment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, failureMessage: (err as Error).message },
      });
      throw err;
    }

    await this.prisma.subscriptionPayment.update({
      where: { id: paymentId },
      data: { paytrToken: token.token },
    });

    return {
      provider: 'PAYTR',
      paymentLink: token.paymentLink,
      merchantOid,
      amount: new Prisma.Decimal(amount).toNumber(),
      currency: 'TRY',
    };
  }

  /**
   * Strictly-alphanumeric merchant_oid. PayTR's docs say the value must
   * match `^[A-Za-z0-9]+$`; UUIDs (with dashes) would be rejected. The
   * tenant prefix is mostly for log-friendliness; the random suffix is
   * the actual uniqueness guarantee (24 bits of entropy on top of the
   * millisecond timestamp — effectively zero collision probability).
   */
  private generateMerchantOid(tenantId: string): string {
    const tenantHex = tenantId.replace(/-/g, '').slice(0, 12);
    const ts = Date.now().toString(36);
    const rand = randomBytes(3).toString('hex');
    return `SUB${tenantHex}${ts}${rand}`;
  }

  /**
   * Pre-create a Subscription in PENDING status so PendingPlanChange has a
   * non-null FK target on first-time subscribe. The webhook flips it to
   * ACTIVE; the orphan sweeper (subscription-scheduler) drops it after
   * the TTL elapses.
   */
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
        paymentProvider: PaymentProvider.PAYTR,
        startDate: now,
        currentPeriodStart: now,
        // Will be overwritten on activation; placeholder = +1h so the
        // partial-unique index on (tenantId) where status IN (ACTIVE,
        // TRIALING) still allows this PENDING row.
        currentPeriodEnd: addHours(now, INTENT_TTL_HOURS),
        amount,
        currency,
        autoRenew: true,
      },
    });
    return created.id;
  }
}
