import {
  Injectable,
  Inject,
  Logger,
  Optional,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MetricsService } from "../../common/metrics/metrics.service";
import { Prisma } from "@prisma/client";
import { addHours } from "date-fns";
import { PrismaService } from "../../prisma/prisma.service";
import { resolvePlanAmount } from "../subscriptions/plan-pricing.helper";
import { CLOCK, Clock, SystemClock } from "../../common/time/clock";
import {
  ID_GENERATOR,
  IdGenerator,
  SystemIdGenerator,
} from "../../common/ids/id-generator";
import {
  REFERRAL_DIRECTORY_PORT,
  ReferralDirectoryPort,
} from "../../core-contracts/referral/referral-directory.port";
import { PaytrAdapter } from "./adapters/paytr.adapter";
import { SubscriptionService } from "../subscriptions/services/subscription.service";
import { ConsentService } from "../legal/services/consent.service";
import { DemoGuardService } from "../demo/demo-guard.service";
import {
  BillingCycle,
  PaymentProvider,
  PaymentStatus,
  SubscriptionPlanType,
  SubscriptionStatus,
} from "../../common/constants/subscription.enum";
import { CreateIntentDto } from "./dto/create-intent.dto";

export interface CreateIntentResult {
  provider: "PAYTR" | "TRIAL";
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
    private readonly consents: ConsentService,
    // Marketing-owned port (bound globally by ProvisioningModule). Lets core
    // resolve a referral code without reading marketing_users directly.
    @Inject(REFERRAL_DIRECTORY_PORT)
    private readonly referralDirectory: ReferralDirectoryPort,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
    // Testability primitives. @Optional with a self-constructed default so the
    // existing positional constructions in the unit specs (which stop at the
    // referralDirectory / metrics arg) keep compiling AND keep their exact
    // runtime behaviour: SystemClock/SystemIdGenerator delegate straight to
    // Date.now() / crypto, so a bare-constructed service is byte-identical to
    // the pre-DI inline code. Production injects the global CommonModule
    // providers, which a unit test can override with a fixed clock + id to make
    // merchantOid generation deterministic.
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(ID_GENERATOR) idGenerator?: IdGenerator,
    // Demo-tenant real-money block. REQUIRED (no @Optional) — every
    // consuming module imports DemoGuardModule, so DI fails loud at boot if
    // a future module-wiring regression ever drops that import, instead of
    // silently no-op'ing a money guard. The `?` on the type + `?.` at the
    // call site below stay only as belt-and-suspenders (and to keep any
    // bare-`new`-constructed spec compiling).
    private readonly demoGuard?: DemoGuardService,
  ) {
    this.clock = clock ?? new SystemClock();
    this.idGenerator = idGenerator ?? new SystemIdGenerator();
  }

  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;

  private countIntent(result: string): void {
    this.metrics?.incCounter(
      "payment_intents_total",
      "Subscription payment intents by outcome (created|paytr_failed)",
      { result },
    );
  }

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
    userAgent?: string,
  ): Promise<CreateIntentResult> {
    // Demo-tenant real-money block — the shared "explore demo" tenant must
    // never reach PayTR. First statement, before any DB write or PayTR call.
    await this.demoGuard?.assertNotDemo(tenantId);

    const [tenant, callingUser] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            // Include TRIAL_ENDED (onboarding-trial redesign): when a locked
            // tenant picks a paid plan from the choose-plan screen, createIntent
            // must find their existing (TRIAL_ENDED) subscription so the payment
            // + PendingPlanChange reuse that row — settlement then flips the SAME
            // row to ACTIVE on the chosen plan and releases the lock (instead of
            // leaving a stale TRIAL_ENDED row beside a new ACTIVE one).
            where: {
              status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "TRIAL_ENDED"] },
            },
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
    if (!tenant) throw new NotFoundException("Tenant not found");
    if (!callingUser) throw new BadRequestException("Calling user not found");

    // Mirror the email-verified gate that SubscriptionService.createSubscription
    // enforces. Without this, PayTR could collect money for a tenant who
    // would then fail their first SubscriptionService call (renewals,
    // upgrades, anything that needs email confirmation).
    if (!callingUser.emailVerified) {
      throw new BadRequestException(
        "Email must be verified before subscribing. Please check your inbox for the verification code.",
      );
    }

    // PayTR's get-token endpoint rejects empty user_phone with
    // "Zorunlu alan degeri gecersiz veya gonderilmedi: user_phone".
    // Fail fast with a structured code so the frontend can route the
    // user to their profile page to fill it in, then back to checkout
    // (handled in CheckoutPage.tsx onError + ProfilePage.tsx returnTo).
    const trimmedPhone = (callingUser.phone ?? "").trim();
    if (!trimmedPhone) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Profile Phone Required",
        errorCode: "PROFILE_PHONE_REQUIRED",
        message:
          "Telefon numarası gereklidir. Lütfen profilinize bir telefon ekleyin ve ödeme adımına geri dönün.",
      });
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException("Plan not found or inactive");
    }
    // No payment intent for the FREE plan — every tenant has FREE
    // attached from registration and there's nothing to charge. The
    // PayTR adapter would 0-amount-reject anyway; failing fast here
    // gives the user a clearer error.
    if (plan.name === SubscriptionPlanType.FREE) {
      throw new BadRequestException(
        "Cannot create a payment intent for the FREE plan",
      );
    }

    // Currency safety gate — PayTR collects in TRY only. A plan priced
    // in USD/EUR would display as "$199" / "€199" on the storefront,
    // but the adapter (until this iter) hardcoded `currency=TL` on the
    // wire, so the customer would be charged 199 TL while seeing a USD
    // total. Fail at the earliest possible point: BEFORE reserving the
    // SubscriptionPayment row or pre-creating a PENDING Subscription.
    // The adapter still self-validates as defence-in-depth.
    if (plan.currency !== "TRY") {
      throw new BadRequestException({
        statusCode: 400,
        error: "Unsupported Currency",
        errorCode: "PAYTR_ONLY_SUPPORTS_TRY",
        message: `PayTR yalnızca TRY ile tahsilat yapar. Bu plan ${plan.currency} ile fiyatlandırılmış.`,
      });
    }

    // Same-plan-while-ACTIVE guard. `isUpgrade` below is derived from
    // `existingSub.planId !== plan.id` — when the tenant re-selects their
    // CURRENT plan while ACTIVE, isUpgrade is false but createIntent would
    // otherwise still walk the full paid path and reserve a full-price
    // PENDING SubscriptionPayment. On settlement that writes
    // `currentPeriodStart: now`, which RESETS (not extends) the billing
    // period — burning whatever paid days the tenant had left. Reject
    // before any DB write or PayTR call. PAST_DUE is exempt: that's the
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

    // Legal consent gate — three required documents (KVKK + Mesafeli
    // Satış + İade) must be checked at the checkout step. ConsentService
    // verifies the ids point to the current `isCurrent=true` rows of
    // those three kinds, then writes three Consent rows in one
    // transaction with ip + userAgent for KVKK audit. Trial activation
    // counts as "agreeing to the contract" too — gate fires before the
    // trial-eligible short-circuit below so even free trials require
    // explicit acceptance.
    if (!dto.acceptedDocumentIds || dto.acceptedDocumentIds.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Legal Consent Required",
        errorCode: "LEGAL_CONSENT_REQUIRED",
        message:
          "Devam etmek için KVKK, Mesafeli Satış ve İade politikalarını onaylamanız gerekiyor.",
      });
    }
    await this.consents.verifyAndRecord(dto.acceptedDocumentIds, {
      userId,
      ipAddress: userIp,
      userAgent,
    });

    // Honor any active promotional discount — the price the buyer was shown.
    const amount = resolvePlanAmount(plan, dto.billingCycle);

    // A 100%-off promo (or a 0-priced plan) yields a 0 amount, which PayTR's
    // get-token rejects opaquely. Fail fast with an actionable message — a
    // fully-discounted plan can't be self-purchased through the paid rail (it
    // would be a comp/trial activation, handled elsewhere).
    if (amount.lte(0)) {
      throw new BadRequestException(
        "This plan has no payable amount right now (fully discounted). Please contact support to activate it.",
      );
    }

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
    // closed.) `existingSub` is declared above (same-plan-active guard).
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
        provider: "TRIAL",
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

    // Resolve marketer referral attribution (if a code was supplied) and
    // snapshot it onto the payment row below. A bad/unknown code resolves to
    // null and NEVER blocks checkout — the snapshot just stays empty. The
    // resolved (not raw) code is stored so attribution survives the marketer
    // rotating their code later. The post-settlement SettlementCommissionConsumer
    // reads these snapshot columns to credit the SIGNUP referral commission.
    const referral = dto.referralCode
      ? await this.referralDirectory.resolveReferralCode(dto.referralCode)
      : null;

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
          // Referral attribution snapshot (null when no/unknown code). Settles
          // into a SIGNUP commission post-payment via the marketing consumer.
          referralCode: referral?.referralCode ?? null,
          referredByMarketingUserId: referral?.marketingUserId ?? null,
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
        currency: plan.currency,
        email: callingUser.email,
        userName:
          `${callingUser.firstName ?? ""} ${callingUser.lastName ?? ""}`.trim() ||
          callingUser.email,
        // PayTR rejects get-token with "Zorunlu alan degeri gecersiz veya
        // gonderilmedi: user_address" when this is empty. We don't capture
        // a tenant-level postal address yet, so fall back to the country
        // string — accepted by PayTR as a valid buyer address.
        userAddress: "Türkiye",
        // Empty phone was rejected above with PROFILE_PHONE_REQUIRED, so
        // by this point trimmedPhone is guaranteed non-empty.
        userPhone: trimmedPhone,
        userBasket: [
          [plan.displayName, new Prisma.Decimal(amount).toFixed(2), 1],
        ],
        userIp,
        okUrl:
          this.config.get<string>("PAYTR_OK_URL") ??
          "http://localhost:5173/subscription/success",
        failUrl:
          this.config.get<string>("PAYTR_FAIL_URL") ??
          "http://localhost:5173/subscription/fail",
      });
    } catch (err) {
      // PayTR rejected → mark the payment FAILED and re-throw so the
      // controller can surface a 502 to the client. The payment row is
      // intentionally left behind for audit.
      await this.prisma.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          failureMessage: (err as Error).message,
        },
      });
      this.countIntent("paytr_failed");
      throw err;
    }

    await this.prisma.subscriptionPayment.update({
      where: { id: paymentId },
      data: { paytrToken: token.token },
    });
    this.countIntent("created");

    return {
      provider: "PAYTR",
      paymentLink: token.paymentLink,
      merchantOid,
      amount: new Prisma.Decimal(amount).toNumber(),
      currency: "TRY",
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
    const tenantHex = tenantId.replace(/-/g, "").slice(0, 12);
    // Injected clock + id source (defaulting to the real platform clock /
    // crypto). nowMs() === Date.now() and randomHex(3) ===
    // randomBytes(3).toString("hex"), so production output is unchanged; a
    // fixed-clock + fixed-id test makes this byte-for-byte deterministic.
    const ts = this.clock.nowMs().toString(36);
    const rand = this.idGenerator.randomHex(3);
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
      },
    });
    return created.id;
  }
}
