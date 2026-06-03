import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DomainEventBus,
  DomainEvent,
} from '../../outbox/domain-event-bus.service';
import {
  MarketingEventTypes,
  MarketingLeadConvertedPayload,
} from '../events/marketing-event-types';
import { InstallationJobService } from './installation-job.service';

/**
 * Phase 3: auto-create an installation job when a lead converts to a customer.
 * Reacts to marketing.lead.converted.v1 (emitted by both convert() and the
 * orphan-reconciliation sweep). Snapshots the site/contact from the
 * marketing-owned Lead so the job never reads core tables. Idempotent — one
 * non-cancelled job per tenant (enforced in createForConversion).
 */
@Injectable()
export class InstallationConsumer implements OnModuleInit {
  private readonly logger = new Logger(InstallationConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
    private readonly jobs: InstallationJobService,
  ) {}

  onModuleInit(): void {
    this.bus.on(MarketingEventTypes.LeadConverted, (event) =>
      this.handle(event as DomainEvent<MarketingLeadConvertedPayload>),
    );
  }

  private async handle(event: DomainEvent<MarketingLeadConvertedPayload>): Promise<void> {
    const p = event.payload;
    try {
      let contact: {
        contactName?: string | null;
        contactPhone?: string | null;
        siteAddress?: string | null;
        siteCity?: string | null;
      } = {};
      if (p.leadId) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: p.leadId },
          select: { contactPerson: true, phone: true, address: true, city: true },
        });
        if (lead) {
          contact = {
            contactName: lead.contactPerson,
            contactPhone: lead.phone,
            siteAddress: lead.address,
            siteCity: lead.city,
          };
        }
      }
      const job = await this.jobs.createForConversion({
        tenantId: p.tenantId,
        leadId: p.leadId,
        ...contact,
      });
      this.logger.log(
        `Installation job ready for tenant=${p.tenantId} (job=${job.id})`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to auto-create installation job for tenant=${p.tenantId}: ${err?.message ?? err}`,
      );
    }
  }
}
