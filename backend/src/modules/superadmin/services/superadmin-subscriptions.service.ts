import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { differenceInDays } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  SubscriptionFilterDto,
  CreatePlanDto,
  UpdatePlanDto,
  ExtendSubscriptionDto,
  UpdateSubscriptionDto,
} from "../dto/subscription-filter.dto";
import { RefundSubscriptionPaymentDto } from "../dto/refund-subscription-payment.dto";
import { SuperAdminAuditService } from "./superadmin-audit.service";
import { AuditAction, EntityType } from "../dto/audit-filter.dto";
import { SubscriptionService } from "../../subscriptions/services/subscription.service";
import { SubscriptionSchedulerService } from "../../subscriptions/services/subscription-scheduler.service";
import { PaytrAdapter } from "../../payments/adapters/paytr.adapter";
import { PaymentStatus } from "../../../common/constants/subscription.enum";
import { captureException } from "../../../sentry.config";

@Injectable()
export class SuperAdminSubscriptionsService {
  private readonly logger = new Logger(SuperAdminSubscriptionsService.name);

  /**
   * Non-terminal claim state used by refundPayment to atomically reserve a
   * payment before calling PayTR (deep-review H17). Lives as a local string
   * literal because SubscriptionPayment.status is a free-form String column
   * (not a Prisma enum), so no migration is needed; the shared PaymentStatus
   * TS enum only models the terminal states.
   */
  private static readonly REFUNDING_STATUS = "REFUNDING";

  constructor(
    private prisma: PrismaService,
    private auditService: SuperAdminAuditService,
    private subscriptionService: SubscriptionService,
    private scheduler: SubscriptionSchedulerService,
    private paytr: PaytrAdapter,
  ) {}

  /**
   * Manually fire the scheduled trial-expiry sweep. Same code path as
   * the nightly cron, just triggered on-demand from a superadmin
   * session or an E2E test that needs to verify the post-expiry state
   * (TRIALING BUSINESS → ACTIVE FREE) without waiting for midnight.
   */
  async triggerExpireTrials() {
    return this.subscriptionService.expireTrials();
  }

  /**
   * Manually fire the period-end → PAST_DUE sweep. Same code path as
   * the 02:00 daily cron — used by ops to confirm a tenant whose period
   * ended a few minutes ago is correctly demoted, and by E2E tests that
   * can't wait until 02:00.
   */
  async triggerPeriodEndSweep() {
    await this.scheduler.handleSubscriptionPeriodEnd();
    return { success: true };
  }

  /**
   * Manually fire the 7d/3d/1d pre-expiry reminder cron. Same code path
   * as the 10:00 daily cron.
   */
  async triggerExpiryReminders() {
    await this.scheduler.handleSubscriptionExpiryReminders();
    return { success: true };
  }

  // Plans
  async findAllPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: { monthlyPrice: "asc" },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });
  }

  async createPlan(
    createDto: CreatePlanDto,
    actorId: string,
    actorEmail: string,
  ) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: createDto.name,
        displayName: createDto.displayName,
        description: createDto.description,
        monthlyPrice: createDto.monthlyPrice,
        yearlyPrice: createDto.yearlyPrice,
        // Use nullish coalescing so an explicit `false` from the caller
        // isn't silently flipped to a default `true`/number.
        currency: createDto.currency ?? "TRY",
        trialDays: createDto.trialDays ?? 0,
        maxUsers: createDto.maxUsers ?? 1,
        maxTables: createDto.maxTables ?? 5,
        maxProducts: createDto.maxProducts ?? 50,
        maxCategories: createDto.maxCategories ?? 10,
        maxMonthlyOrders: createDto.maxMonthlyOrders ?? 100,
        advancedReports: createDto.advancedReports ?? false,
        multiLocation: createDto.multiLocation ?? false,
        customBranding: createDto.customBranding ?? false,
        apiAccess: createDto.apiAccess ?? false,
        prioritySupport: createDto.prioritySupport ?? false,
        inventoryTracking: createDto.inventoryTracking ?? false,
        kdsIntegration: createDto.kdsIntegration ?? true,
        reservationSystem: createDto.reservationSystem ?? false,
        personnelManagement: createDto.personnelManagement ?? false,
        deliveryIntegration: createDto.deliveryIntegration ?? false,
        isActive: createDto.isActive ?? true,
        // Discount block — previously omitted, so plan discounts created via
        // the superadmin form silently never persisted. Dates arrive as ISO
        // strings (the DTO coerces blank -> undefined); map to Date.
        discountPercentage: createDto.discountPercentage,
        discountLabel: createDto.discountLabel,
        discountStartDate: createDto.discountStartDate
          ? new Date(createDto.discountStartDate)
          : undefined,
        discountEndDate: createDto.discountEndDate
          ? new Date(createDto.discountEndDate)
          : undefined,
        isDiscountActive: createDto.isDiscountActive ?? false,
      },
    });

    await this.auditService.log({
      action: AuditAction.CREATE,
      entityType: EntityType.PLAN,
      entityId: plan.id,
      actorId,
      actorEmail,
      newData: plan,
    });

    return plan;
  }

  async updatePlan(
    id: string,
    updateDto: UpdatePlanDto,
    actorId: string,
    actorEmail: string,
  ) {
    const existingPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      throw new NotFoundException("Plan not found");
    }

    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: updateDto.name,
        displayName: updateDto.displayName,
        description: updateDto.description,
        monthlyPrice: updateDto.monthlyPrice,
        yearlyPrice: updateDto.yearlyPrice,
        currency: updateDto.currency,
        trialDays: updateDto.trialDays,
        maxUsers: updateDto.maxUsers,
        maxTables: updateDto.maxTables,
        maxProducts: updateDto.maxProducts,
        maxCategories: updateDto.maxCategories,
        maxMonthlyOrders: updateDto.maxMonthlyOrders,
        advancedReports: updateDto.advancedReports,
        multiLocation: updateDto.multiLocation,
        customBranding: updateDto.customBranding,
        apiAccess: updateDto.apiAccess,
        prioritySupport: updateDto.prioritySupport,
        inventoryTracking: updateDto.inventoryTracking,
        kdsIntegration: updateDto.kdsIntegration,
        reservationSystem: updateDto.reservationSystem,
        personnelManagement: updateDto.personnelManagement,
        deliveryIntegration: updateDto.deliveryIntegration,
        isActive: updateDto.isActive,
        // Discount block — previously omitted, so discount edits returned 200
        // but never saved. PATCH semantics: undefined leaves the column
        // untouched. Dates arrive as ISO strings (DTO coerces blank ->
        // undefined); map present ones to Date.
        discountPercentage: updateDto.discountPercentage,
        discountLabel: updateDto.discountLabel,
        discountStartDate: updateDto.discountStartDate
          ? new Date(updateDto.discountStartDate)
          : undefined,
        discountEndDate: updateDto.discountEndDate
          ? new Date(updateDto.discountEndDate)
          : undefined,
        isDiscountActive: updateDto.isDiscountActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.PLAN,
      entityId: plan.id,
      actorId,
      actorEmail,
      previousData: existingPlan,
      newData: plan,
    });

    return plan;
  }

  async deletePlan(id: string, actorId: string, actorEmail: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        _count: { select: { subscriptions: true } },
      },
    });

    if (!plan) {
      throw new NotFoundException("Plan not found");
    }

    if (plan._count.subscriptions > 0) {
      throw new BadRequestException(
        "Cannot delete plan with active subscriptions",
      );
    }

    await this.prisma.subscriptionPlan.delete({ where: { id } });

    await this.auditService.log({
      action: AuditAction.DELETE,
      entityType: EntityType.PLAN,
      entityId: id,
      actorId,
      actorEmail,
      previousData: plan,
    });

    return { message: "Plan deleted successfully" };
  }

  // Subscriptions
  async findAllSubscriptions(filters: SubscriptionFilterDto) {
    const { status, planId, tenantId, page = 1, limit = 20 } = filters;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (planId) {
      where.planId = planId;
    }

    if (tenantId) {
      where.tenantId = tenantId;
    }

    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          tenant: {
            select: { id: true, name: true, subdomain: true },
          },
          plan: {
            select: { id: true, name: true, displayName: true },
          },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      data: subscriptions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneSubscription(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        tenant: {
          select: { id: true, name: true, subdomain: true, status: true },
        },
        plan: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        invoices: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    return subscription;
  }

  async updateSubscription(
    id: string,
    updateDto: UpdateSubscriptionDto,
    actorId: string,
    actorEmail: string,
  ) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!existing) {
      throw new NotFoundException("Subscription not found");
    }

    const updateData: {
      planId?: string;
      status?: string;
      trialEnd?: Date;
      trialStart?: Date;
    } = {};

    if (updateDto.planId) {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: updateDto.planId },
      });
      if (!plan) {
        throw new NotFoundException("Plan not found");
      }
      // Downgrade guard: refuse a plan change that would push the tenant
      // above the new plan's limits. The regular tenant flow already has
      // this check in SubscriptionService.assertDowngradeAllowed; without
      // the same guard on the SA path, an ops mistake (FREE-ing a 200-
      // user tenant) silently leaves the tenant over-quota until the
      // next guard rejects a new write.
      const [userCount, tableCount, productCount, categoryCount] =
        await Promise.all([
          this.prisma.user.count({
            where: { tenantId: existing.tenantId, status: "ACTIVE" },
          }),
          this.prisma.table.count({ where: { tenantId: existing.tenantId } }),
          this.prisma.product.count({ where: { tenantId: existing.tenantId } }),
          this.prisma.category.count({
            where: { tenantId: existing.tenantId },
          }),
        ]);
      const violations: string[] = [];
      if (plan.maxUsers !== -1 && userCount > plan.maxUsers) {
        violations.push(`users ${userCount}/${plan.maxUsers}`);
      }
      if (plan.maxTables !== -1 && tableCount > plan.maxTables) {
        violations.push(`tables ${tableCount}/${plan.maxTables}`);
      }
      if (plan.maxProducts !== -1 && productCount > plan.maxProducts) {
        violations.push(`products ${productCount}/${plan.maxProducts}`);
      }
      if (plan.maxCategories !== -1 && categoryCount > plan.maxCategories) {
        violations.push(`categories ${categoryCount}/${plan.maxCategories}`);
      }
      if (violations.length > 0) {
        throw new BadRequestException(
          `Cannot change plan — current usage exceeds new plan limits: ${violations.join(", ")}`,
        );
      }
      updateData.planId = updateDto.planId;
    }

    if (updateDto.status) {
      updateData.status = updateDto.status;
    }

    if (updateDto.trialEnd) {
      updateData.trialEnd = new Date(updateDto.trialEnd);
    }
    if (updateDto.trialStart) {
      updateData.trialStart = new Date(updateDto.trialStart);
    }

    // Subscription plan change + tenant.currentPlanId must move
    // atomically, otherwise a failure between them leaves feature
    // gating out of sync with the subscription row.
    const subscription = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { id },
        data: updateData,
        include: {
          tenant: { select: { id: true, name: true } },
          plan: { select: { id: true, name: true, displayName: true } },
        },
      });
      if (updateData.planId) {
        await tx.tenant.update({
          where: { id: existing.tenantId },
          data: { currentPlanId: updateData.planId },
        });
        // Reproject entitlements in the SAME transaction. Without this a
        // superadmin plan change moved subscription.planId +
        // tenant.currentPlanId but left the engine's feature.*/limit.* grants
        // (and its cache) on the OLD plan, so the tenant kept stale feature
        // access until the nightly reconcile. Mirrors the tenant-side
        // activation + bank-transfer confirm paths.
        await this.subscriptionService.emitSubscriptionReprojection(
          {
            id: sub.id,
            tenantId: existing.tenantId,
            plan: sub.plan,
            currentPeriodStart: (sub as { currentPeriodStart?: Date | null })
              .currentPeriodStart,
            currentPeriodEnd: (sub as { currentPeriodEnd?: Date | null })
              .currentPeriodEnd,
          },
          tx,
        );
      }
      return sub;
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.SUBSCRIPTION,
      entityId: id,
      actorId,
      actorEmail,
      previousData: {
        planId: existing.planId,
        status: existing.status,
      },
      newData: updateDto,
      targetTenantId: existing.tenant.id,
      targetTenantName: existing.tenant.name,
    });

    return subscription;
  }

  async extendSubscription(
    id: string,
    extendDto: ExtendSubscriptionDto,
    actorId: string,
    actorEmail: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    // Defend against a negative or 10-year gift that bypasses DTO
    // validation drift — the DTO SHOULD cap this but the service
    // re-checks because this endpoint moves real billing dates.
    if (
      !Number.isFinite(extendDto.days) ||
      extendDto.days < 1 ||
      extendDto.days > 3650
    ) {
      throw new BadRequestException("days must be between 1 and 3650");
    }

    const newEndDate = new Date(subscription.currentPeriodEnd);
    newEndDate.setDate(newEndDate.getDate() + extendDto.days);

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        currentPeriodEnd: newEndDate,
      },
      include: {
        tenant: {
          select: { id: true, name: true },
        },
        plan: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    await this.auditService.log({
      action: AuditAction.EXTEND,
      entityType: EntityType.SUBSCRIPTION,
      entityId: id,
      actorId,
      actorEmail,
      previousData: {
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      newData: {
        currentPeriodEnd: newEndDate,
        daysExtended: extendDto.days,
        reason: extendDto.reason,
      },
      targetTenantId: subscription.tenant.id,
      targetTenantName: subscription.tenant.name,
    });

    return updated;
  }

  async cancelSubscription(
    id: string,
    actorId: string,
    actorEmail: string,
    mode: "IMMEDIATE" | "AT_PERIOD_END" = "AT_PERIOD_END",
    reason?: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    const now = new Date();
    // The two modes are mutually exclusive — the prior implementation
    // wrote status=CANCELLED AND cancelAtPeriodEnd=true, which left
    // downstream billing/feature-gating code unable to tell the admin's
    // intent.
    const data =
      mode === "IMMEDIATE"
        ? {
            status: "CANCELLED",
            cancelledAt: now,
            endedAt: now,
            cancelAtPeriodEnd: false,
            cancellationReason: reason,
          }
        : {
            cancelAtPeriodEnd: true,
            cancelledAt: now,
            cancellationReason: reason,
          };

    // Manual-renewal model: no PayTR token to revoke, no autoRenew flag
    // to flip. Single subscription update.
    const updated = await this.prisma.subscription.update({
      where: { id },
      data,
      include: {
        tenant: { select: { id: true, name: true } },
        plan: { select: { id: true, name: true, displayName: true } },
      },
    });

    await this.auditService.log({
      action: AuditAction.CANCEL,
      entityType: EntityType.SUBSCRIPTION,
      entityId: id,
      actorId,
      actorEmail,
      previousData: { status: subscription.status },
      newData: { status: "CANCELLED", reason },
      targetTenantId: subscription.tenant.id,
      targetTenantName: subscription.tenant.name,
    });

    return updated;
  }

  /**
   * Issue a refund through PayTR's `/odeme/api/iade` endpoint for a
   * specific SubscriptionPayment, then terminalise the local payment
   * row to `REFUNDED` and append an audit entry.
   *
   * Partial refunds are accepted (`amount < payment.amount`) and still
   * mark the row as REFUNDED — the schema doesn't currently model a
   * partial-refund state separately, so the exact refunded amount is
   * preserved in the audit log only.
   *
   * 14-day cayma penceresi (TR consumer law) is a soft check: support
   * can still issue a refund past day 14 (e.g. goodwill, dispute),
   * but a warning gets logged so the action is visible later.
   */
  async refundPayment(
    subscriptionId: string,
    dto: RefundSubscriptionPaymentDto,
    actorId: string,
    actorEmail: string,
  ) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: dto.paymentId },
      include: {
        subscription: {
          select: {
            id: true,
            tenantId: true,
            tenant: { select: { name: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException("Payment not found");
    }
    if (payment.subscriptionId !== subscriptionId) {
      throw new BadRequestException(
        "Payment does not belong to this subscription",
      );
    }
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException(
        `Only SUCCEEDED payments can be refunded (current: ${payment.status})`,
      );
    }
    if (!payment.paytrMerchantOid) {
      throw new BadRequestException(
        "Payment has no PayTR merchantOid — refund via PayTR not possible",
      );
    }

    const paymentAmount = new Prisma.Decimal(payment.amount as any);
    const refundAmount =
      dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : paymentAmount;
    if (refundAmount.gt(paymentAmount)) {
      throw new BadRequestException(
        `Refund amount (${refundAmount}) cannot exceed payment amount (${paymentAmount})`,
      );
    }

    // Soft 14-day cooling-off check — log but don't block. Support
    // sometimes refunds past day 14 (goodwill, dispute). The audit log
    // captures the decision either way.
    if (payment.paidAt) {
      const daysSincePaid = differenceInDays(new Date(), payment.paidAt);
      if (daysSincePaid > 14) {
        this.logger.warn(
          `Refund past 14-day window for payment=${payment.id} (paidAt=${payment.paidAt.toISOString()}, ${daysSincePaid}d ago)`,
        );
      }
    }

    // Atomically claim the payment BEFORE touching PayTR (deep-review H17).
    // The read-then-check above can be raced: two ops requests (double-click,
    // retry, two operators) could both read status=SUCCEEDED, both pass the
    // guard, and both call paytr.refund(). A full+full pair is caught by
    // PayTR's duplicate rejection, but two DIFFERENT partial amounts (or a
    // full + a partial) can BOTH succeed at PayTR — moving real money twice.
    // updateMany with status in the WHERE is a single conditional write, so
    // only one caller can flip SUCCEEDED→REFUNDING and proceed; the rest get
    // a 409. No FOR UPDATE / explicit transaction needed.
    const claim = await this.prisma.subscriptionPayment.updateMany({
      where: { id: payment.id, status: PaymentStatus.SUCCEEDED },
      data: { status: SuperAdminSubscriptionsService.REFUNDING_STATUS },
    });
    if (claim.count !== 1) {
      throw new ConflictException({
        errorCode: "REFUND_IN_PROGRESS_OR_DONE",
        message:
          "A refund for this payment is already in progress or completed.",
      });
    }

    let result: Awaited<ReturnType<PaytrAdapter["refund"]>>;
    try {
      result = await this.paytr.refund({
        merchantOid: payment.paytrMerchantOid,
        amount: refundAmount,
        referenceNo: payment.id,
      });
    } catch (err) {
      // PayTR call threw (network/timeout) — no confirmed money move. Release
      // the claim so the payment can be retried, then rethrow.
      await this.releaseRefundClaim(payment.id);
      throw err;
    }

    if (result.status !== "success") {
      // PayTR rejected — no money moved. Roll the claim back REFUNDING→SUCCEEDED
      // so the payment can be retried, then surface the rejection (H17).
      await this.releaseRefundClaim(payment.id);
      throw new BadRequestException(
        `PayTR refund rejected: ${result.reason ?? "unknown"}`,
      );
    }

    // PayTR has now moved real money. Any failure in the DB update or
    // audit log below means we owe an ops alert — PayTR's panel will
    // show REFUNDED, our SubscriptionPayment will still show SUCCEEDED,
    // and the next refund attempt would double-refund (PayTR will
    // reject with "already refunded", we won't know).
    const now = new Date();
    try {
      const updated = await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAt: now,
        },
      });

      await this.auditService.log({
        action: AuditAction.REFUND,
        entityType: EntityType.SUBSCRIPTION,
        entityId: subscriptionId,
        actorId,
        actorEmail,
        previousData: { status: "SUCCEEDED", amount: paymentAmount.toString() },
        newData: {
          status: "REFUNDED",
          refundedAmount: refundAmount.toString(),
          paymentId: payment.id,
          merchantOid: payment.paytrMerchantOid,
          reason: dto.reason,
        },
        targetTenantId: payment.subscription.tenantId,
        targetTenantName: payment.subscription.tenant.name,
      });

      return updated;
    } catch (err: any) {
      this.logger.error(
        `Refund succeeded on PayTR but DB update failed for payment=${payment.id} merchantOid=${payment.paytrMerchantOid}: ${err?.message ?? err}`,
      );
      captureException(err, {
        severity: "critical",
        context: "refund-success-db-update-failed",
        paymentId: payment.id,
        paytrMerchantOid: payment.paytrMerchantOid,
        refundAmount: refundAmount.toString(),
        actorId,
        actorEmail,
      });
      // Surface a coded error to ops so they know the difference between
      // "PayTR rejected" and "PayTR succeeded but we're inconsistent".
      throw new BadRequestException({
        statusCode: 400,
        error: "Refund Partially Applied",
        errorCode: "REFUND_APPLIED_DB_INCONSISTENT",
        message:
          "PayTR refund succeeded but local payment state could not be updated. " +
          "Ops has been alerted — do NOT retry the refund (PayTR will reject as duplicate).",
      });
    }
  }

  /**
   * Roll a refund claim back REFUNDING→SUCCEEDED when PayTR did NOT move money
   * (threw or rejected) so the payment becomes refundable again (deep-review
   * H17). Guarded on the REFUNDING state so it only ever touches the row this
   * request claimed. A failure to release is logged + reported but never
   * masks the original PayTR error — worst case the row is stuck in REFUNDING
   * and a human un-sticks it, which is strictly safer than an unclaimed
   * double-refund.
   */
  private async releaseRefundClaim(paymentId: string): Promise<void> {
    try {
      await this.prisma.subscriptionPayment.updateMany({
        where: {
          id: paymentId,
          status: SuperAdminSubscriptionsService.REFUNDING_STATUS,
        },
        data: { status: PaymentStatus.SUCCEEDED },
      });
    } catch (releaseErr: any) {
      this.logger.error(
        `Failed to release refund claim for payment=${paymentId}; row may be stuck in REFUNDING: ${releaseErr?.message ?? releaseErr}`,
      );
      captureException(releaseErr, {
        severity: "warning",
        context: "refund-claim-release-failed",
        paymentId,
      });
    }
  }
}
