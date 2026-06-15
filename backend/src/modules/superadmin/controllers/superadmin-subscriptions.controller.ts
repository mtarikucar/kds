import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { SuperAdminSubscriptionsService } from "../services/superadmin-subscriptions.service";
import { BankTransferService } from "../../payments/services/bank-transfer.service";
import {
  UpdateBankTransferSettingsDto,
  RejectBankTransferDto,
} from "../../payments/dto/bank-transfer.dto";
import {
  SubscriptionFilterDto,
  CreatePlanDto,
  UpdatePlanDto,
  ExtendSubscriptionDto,
  UpdateSubscriptionDto,
} from "../dto/subscription-filter.dto";
import { CancelSubscriptionDto } from "../dto/cancel-subscription.dto";
import { RefundSubscriptionPaymentDto } from "../dto/refund-subscription-payment.dto";
import { SuperAdminGuard } from "../guards/superadmin.guard";
import { SuperAdminRoute } from "../decorators/superadmin.decorator";
import { CurrentSuperAdmin } from "../decorators/current-superadmin.decorator";

@ApiTags("SuperAdmin Subscriptions")
@Controller("superadmin")
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminSubscriptionsController {
  constructor(
    private readonly subscriptionsService: SuperAdminSubscriptionsService,
    private readonly bankTransfer: BankTransferService,
  ) {}

  // Plans
  @Get("plans")
  @ApiOperation({ summary: "List all subscription plans" })
  async findAllPlans() {
    return this.subscriptionsService.findAllPlans();
  }

  @Post("plans")
  @ApiOperation({ summary: "Create a new subscription plan" })
  async createPlan(
    @Body() createDto: CreatePlanDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.createPlan(createDto, actorId, actorEmail);
  }

  @Patch("plans/:id")
  @ApiOperation({ summary: "Update a subscription plan" })
  async updatePlan(
    @Param("id") id: string,
    @Body() updateDto: UpdatePlanDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.updatePlan(
      id,
      updateDto,
      actorId,
      actorEmail,
    );
  }

  @Delete("plans/:id")
  @ApiOperation({ summary: "Delete a subscription plan" })
  async deletePlan(
    @Param("id") id: string,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.deletePlan(id, actorId, actorEmail);
  }

  // Subscriptions
  @Post("subscriptions/expire-trials")
  @ApiOperation({
    summary:
      "Manually run the trial-expiry sweep (same code path as the nightly cron). " +
      "Each subscription whose trialEnd has passed is moved to ACTIVE FREE. " +
      "Used by support to force a tenant off trial early, and by E2E tests.",
  })
  async expireTrials() {
    return this.subscriptionsService.triggerExpireTrials();
  }

  @Post("subscriptions/sweep-period-end")
  @ApiOperation({
    summary:
      "Manually run the period-end sweep (same code path as the 02:00 daily cron). " +
      "Each ACTIVE subscription with currentPeriodEnd in the past gets demoted to PAST_DUE " +
      "and the tenant admin receives a past-due email.",
  })
  async sweepPeriodEnd() {
    return this.subscriptionsService.triggerPeriodEndSweep();
  }

  @Post("subscriptions/send-expiry-reminders")
  @ApiOperation({
    summary:
      "Manually fire the 7d/3d/1d pre-expiry reminder cron. Used by support to " +
      "hand-trigger a notification window for a specific batch, and by E2E tests.",
  })
  async sendExpiryReminders() {
    return this.subscriptionsService.triggerExpiryReminders();
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List all subscriptions" })
  async findAllSubscriptions(@Query() filters: SubscriptionFilterDto) {
    return this.subscriptionsService.findAllSubscriptions(filters);
  }

  @Get("subscriptions/:id")
  @ApiOperation({ summary: "Get subscription details" })
  async findOneSubscription(@Param("id") id: string) {
    return this.subscriptionsService.findOneSubscription(id);
  }

  @Patch("subscriptions/:id")
  @ApiOperation({ summary: "Update subscription" })
  async updateSubscription(
    @Param("id") id: string,
    @Body() updateDto: UpdateSubscriptionDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.updateSubscription(
      id,
      updateDto,
      actorId,
      actorEmail,
    );
  }

  @Post("subscriptions/:id/extend")
  @ApiOperation({ summary: "Extend subscription period" })
  async extendSubscription(
    @Param("id") id: string,
    @Body() extendDto: ExtendSubscriptionDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.extendSubscription(
      id,
      extendDto,
      actorId,
      actorEmail,
    );
  }

  @Post("subscriptions/:id/cancel")
  @ApiOperation({ summary: "Cancel subscription (IMMEDIATE or AT_PERIOD_END)" })
  async cancelSubscription(
    @Param("id") id: string,
    @Body() dto: CancelSubscriptionDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.cancelSubscription(
      id,
      actorId,
      actorEmail,
      dto.mode,
      dto.reason,
    );
  }

  @Post("subscriptions/:id/refund")
  @ApiOperation({
    summary:
      "Issue a refund through PayTR for a specific SubscriptionPayment. " +
      "Marks the payment row REFUNDED and writes an audit entry. " +
      "Partial refunds are accepted but still terminalise the row.",
  })
  async refundPayment(
    @Param("id") subscriptionId: string,
    @Body() dto: RefundSubscriptionPaymentDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.subscriptionsService.refundPayment(
      subscriptionId,
      dto,
      actorId,
      actorEmail,
    );
  }

  // --- Bank transfer (havale) -------------------------------------------------

  @Get("bank-transfer/settings")
  @ApiOperation({ summary: "Get the platform bank-transfer settings" })
  async getBankTransferSettings() {
    return this.bankTransfer.getSettings();
  }

  @Patch("bank-transfer/settings")
  @ApiOperation({ summary: "Update the platform bank-transfer settings" })
  async updateBankTransferSettings(
    @Body() dto: UpdateBankTransferSettingsDto,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.bankTransfer.updateSettings(dto, actorEmail);
  }

  @Get("bank-transfer/pending")
  @ApiOperation({ summary: "List pending bank-transfer payments" })
  async listPendingBankTransfers() {
    return this.bankTransfer.listPending();
  }

  @Post("bank-transfer/:paymentId/confirm")
  @ApiOperation({
    summary: "Confirm a received bank transfer (activates the subscription)",
  })
  async confirmBankTransfer(
    @Param("paymentId") paymentId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.bankTransfer.confirm(paymentId, actorEmail);
  }

  @Post("bank-transfer/:paymentId/reject")
  @ApiOperation({ summary: "Reject a pending bank transfer" })
  async rejectBankTransfer(
    @Param("paymentId") paymentId: string,
    @Body() dto: RejectBankTransferDto,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.bankTransfer.reject(paymentId, dto.reason, actorEmail);
  }
}
