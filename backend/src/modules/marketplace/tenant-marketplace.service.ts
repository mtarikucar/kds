import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EventTypes } from '../outbox/event-types';
import { AddOnCatalogService } from './addon-catalog.service';

/**
 * Tenant-facing operations: purchase, cancel, list-mine.
 *
 * Purchase is **provisioning-only** here — it creates the TenantAddOn row,
 * emits AddOnPurchased on the outbox, and trusts the entitlement projector
 * to fold in the new grants. The *payment* side of the transaction is
 * separate (Phase 5 cart flow); for MVP we accept that admins can create
 * comp add-ons via this endpoint and treat paid purchases as the same call
 * after PaymentCompleted.
 *
 * Dependency check rule: every entry in `deps` must currently apply to the
 * tenant. Plan deps (`plan:PRO`) match Tenant.currentPlan.name. Add-on deps
 * match the codes of currently-active TenantAddOn rows for the tenant.
 */
@Injectable()
export class TenantMarketplaceService {
  private readonly logger = new Logger(TenantMarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AddOnCatalogService,
    private readonly outbox: OutboxService,
  ) {}

  async purchase(tenantId: string, input: { addOnCode: string; quantity?: number; branchId?: string; paymentRef?: string }) {
    const addOn = await this.catalog.findByCodeOrThrow(input.addOnCode);
    if (addOn.status === 'archived') {
      throw new BadRequestException('This add-on is no longer available for purchase');
    }
    if (addOn.status === 'draft') {
      throw new BadRequestException('This add-on is not yet published');
    }

    // Verify deps are satisfied for this specific tenant. Catalog-level
    // resolveDeps only confirms the dep references exist; this is the
    // tenant-specific apply-time check.
    if (addOn.deps.length > 0) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { currentPlan: { select: { name: true } } },
      });
      if (!tenant) throw new NotFoundException('Tenant not found');

      const planName = tenant.currentPlan?.name ?? null;
      const activeAddOns = await this.prisma.tenantAddOn.findMany({
        where: { tenantId, status: 'active' },
        include: { addOn: { select: { code: true } } },
      });
      const haveAddOnCodes = new Set(activeAddOns.map((ta) => ta.addOn.code));

      const missing: string[] = [];
      for (const dep of addOn.deps) {
        if (dep.startsWith('plan:')) {
          if (`plan:${planName ?? ''}` !== dep) missing.push(dep);
        } else if (!haveAddOnCodes.has(dep)) {
          missing.push(dep);
        }
      }
      if (missing.length > 0) {
        throw new BadRequestException(
          `Add-on requires: ${missing.join(', ')}. Upgrade your plan or purchase the required add-ons first.`,
        );
      }
    }

    const qty = input.quantity ?? 1;
    const now = new Date();

    // Idempotency: if this paymentRef has already been provisioned, return
    // the existing row instead of double-granting. Without this, a webhook
    // replay or a buyer double-clicking "Purchase" would mint two
    // TenantAddOns and the projector would stack two entitlement grants
    // — effectively doubling the limit increment for free.
    if (input.paymentRef) {
      const existing = await this.prisma.tenantAddOn.findFirst({
        where: { tenantId, paymentRef: input.paymentRef },
      });
      if (existing) return existing;
    }

    // Block duplicate ACTIVE purchases of the same add-on for the same
    // (tenant, branch) tuple. The marketplace UI only allows one active
    // copy at a time per scope; bypassing via direct API call would
    // double the entitlement grant and confuse cancellation.
    const dup = await this.prisma.tenantAddOn.findFirst({
      where: {
        tenantId,
        addOnId: addOn.id,
        branchId: input.branchId ?? null,
        status: 'active',
      },
    });
    if (dup) {
      throw new BadRequestException(
        `Add-on "${addOn.code}" is already active for this ${input.branchId ? 'branch' : 'tenant'}. Cancel the existing subscription or change quantity instead.`,
      );
    }

    // Recurring add-ons project a 30-day window so the cancellation flow has
    // a meaningful `currentPeriodEnd`. Real billing cycles are aligned to
    // the parent Subscription cycle once Phase 5 checkout wires them up.
    const currentPeriodEnd = addOn.billing === 'oneTime' ? null : new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    const row = await this.prisma.tenantAddOn.create({
      data: {
        tenantId,
        addOnId: addOn.id,
        branchId: input.branchId,
        quantity: qty,
        status: 'active',
        activatedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd,
        paymentRef: input.paymentRef ?? null,
      },
    });

    await this.outbox
      .append({
        type: EventTypes.AddOnPurchased,
        tenantId,
        payload: {
          tenantId,
          addOnId: row.id,
          addOnCode: addOn.code,
          branchId: input.branchId ?? null,
          quantity: qty,
        },
      })
      .catch((e) => this.logger.warn(`AddOnPurchased emit failed: ${(e as Error).message}`));

    return row;
  }

  async cancel(tenantId: string, tenantAddOnId: string, immediate = false) {
    const row = await this.prisma.tenantAddOn.findUnique({ where: { id: tenantAddOnId } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Add-on not found for this tenant');
    if (row.status !== 'active') throw new BadRequestException(`Cannot cancel — status is ${row.status}`);

    const now = new Date();
    const updated = await this.prisma.tenantAddOn.update({
      where: { id: tenantAddOnId },
      data: immediate
        ? { status: 'cancelled', cancelledAt: now, endedAt: now, cancelAtPeriodEnd: false }
        : { cancelAtPeriodEnd: true, cancelledAt: now },
    });

    // Immediate cancellation revokes entitlements right away. At-period-end
    // cancellation leaves the row active until the nightly sweep / billing
    // cycle close transitions it.
    if (immediate) {
      await this.outbox
        .append({
          type: EventTypes.AddOnCancelled,
          tenantId,
          payload: {
            tenantId,
            addOnId: row.id,
            addOnCode: '<lookup>', // intentionally elided — projector reads canonical state
          },
        })
        .catch(() => undefined);
    }
    return updated;
  }

  async listMine(tenantId: string) {
    return this.prisma.tenantAddOn.findMany({
      where: { tenantId },
      include: { addOn: true },
      orderBy: { activatedAt: 'desc' },
    });
  }
}
