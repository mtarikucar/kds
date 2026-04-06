import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { LeadFilterDto } from '../dto/lead-filter.dto';
import { ConvertLeadDto } from '../dto/convert-lead.dto';
import { MarketingNotificationsService } from './marketing-notifications.service';
import * as bcrypt from 'bcryptjs';

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  NEW: ['CONTACTED', 'NOT_REACHABLE', 'LOST'],
  CONTACTED: ['MEETING_DONE', 'DEMO_SCHEDULED', 'NOT_REACHABLE', 'WAITING', 'LOST'],
  NOT_REACHABLE: ['CONTACTED', 'LOST'],
  MEETING_DONE: ['DEMO_SCHEDULED', 'OFFER_SENT', 'WAITING', 'LOST'],
  DEMO_SCHEDULED: ['MEETING_DONE', 'OFFER_SENT', 'WAITING', 'LOST'],
  OFFER_SENT: ['WAITING', 'WON', 'LOST'],
  WAITING: ['CONTACTED', 'OFFER_SENT', 'WON', 'LOST'],
  LOST: ['NEW'],
  WON: [],
};

@Injectable()
export class MarketingLeadsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: MarketingNotificationsService,
  ) {}

  async create(dto: CreateLeadDto, userId: string) {
    return this.prisma.lead.create({
      data: {
        ...dto,
        nextFollowUp: dto.nextFollowUp ? new Date(dto.nextFollowUp) : undefined,
        assignedToId: dto.assignedToId || userId,
      },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async findAll(filter: LeadFilterDto, userId: string, userRole: string) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    // SALES_REP can only see their own leads
    if (userRole === 'SALES_REP') {
      where.assignedToId = userId;
    } else if (filter.assignedToId) {
      where.assignedToId = filter.assignedToId;
    }

    if (filter.search) {
      where.OR = [
        { businessName: { contains: filter.search, mode: 'insensitive' } },
        { contactPerson: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
        { phone: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    if (filter.status) where.status = filter.status;
    if (filter.city) where.city = { contains: filter.city, mode: 'insensitive' };
    if (filter.region) where.region = { contains: filter.region, mode: 'insensitive' };
    if (filter.source) where.source = filter.source;
    if (filter.businessType) where.businessType = filter.businessType;
    if (filter.priority) where.priority = filter.priority;

    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) where.createdAt.gte = new Date(filter.dateFrom);
      if (filter.dateTo) where.createdAt.lte = new Date(filter.dateTo);
    }

    const allowedSortFields = ['createdAt', 'updatedAt', 'businessName', 'contactPerson', 'city', 'status', 'source', 'priority', 'nextFollowUp'];
    const orderBy: any = {};
    if (filter.sortBy && allowedSortFields.includes(filter.sortBy)) {
      orderBy[filter.sortBy] = filter.sortOrder || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
          _count: {
            select: { activities: true, offers: true, tasks: true },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data: leads,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string, userRole: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            createdBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        offers: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            createdBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        tasks: {
          orderBy: { dueDate: 'asc' },
          take: 50,
          where: { status: { not: 'CANCELLED' } },
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        _count: {
          select: { activities: true, offers: true, tasks: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only view your own leads');
    }

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, userId: string, userRole: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only update your own leads');
    }

    const data: any = { ...dto };
    if (dto.nextFollowUp) data.nextFollowUp = new Date(dto.nextFollowUp);

    return this.prisma.lead.update({
      where: { id },
      data,
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async updateStatus(id: string, status: string, lostReason: string | undefined, userId: string, userRole: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only update your own leads');
    }

    const allowed = VALID_STATUS_TRANSITIONS[lead.status];
    if (allowed && !allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from ${lead.status} to ${status}`,
      );
    }

    const updatedLead = await this.prisma.lead.update({
      where: { id },
      data: {
        status,
        ...(status === 'LOST' && lostReason ? { lostReason } : {}),
      },
    });

    // Log status change as activity
    await this.prisma.leadActivity.create({
      data: {
        type: 'STATUS_CHANGE',
        title: `Status changed to ${status}`,
        description: lostReason ? `Reason: ${lostReason}` : undefined,
        leadId: id,
        createdById: userId,
      },
    });

    return updatedLead;
  }

  async assign(id: string, assignedToId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');

    const rep = await this.prisma.marketingUser.findUnique({ where: { id: assignedToId } });
    if (!rep) throw new NotFoundException('Sales rep not found');

    return this.prisma.lead.update({
      where: { id },
      data: { assignedToId },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async convert(id: string, dto: ConvertLeadDto, userId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });

    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.convertedTenantId) throw new ForbiddenException('Lead already converted');

    // Resolve subscription plan
    let plan: any;
    if (dto.planId) {
      plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Subscription plan not found');
    } else {
      plan = await this.prisma.subscriptionPlan.findUnique({ where: { name: 'FREE' } });
      if (!plan) throw new NotFoundException('FREE subscription plan not found');
    }

    // Validate offer if provided
    let linkedOffer: any = null;
    if (dto.offerId) {
      linkedOffer = await this.prisma.leadOffer.findFirst({
        where: { id: dto.offerId, leadId: id },
      });
      if (!linkedOffer) throw new NotFoundException('Offer not found for this lead');
      if (!['DRAFT', 'SENT'].includes(linkedOffer.status)) {
        throw new BadRequestException(`Offer status is ${linkedOffer.status}, cannot accept`);
      }
      if (linkedOffer.validUntil && new Date(linkedOffer.validUntil) < new Date()) {
        throw new BadRequestException('Offer has expired');
      }
    }

    // Generate subdomain
    const baseSubdomain = dto.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    let finalSubdomain = baseSubdomain;
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { subdomain: baseSubdomain },
    });
    if (existingTenant) {
      finalSubdomain = `${baseSubdomain}-${Math.random().toString(36).substring(2, 8)}`;
    }

    const hashedPassword = await bcrypt.hash(dto.adminPassword, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      // Create tenant with plan and subdomain
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          subdomain: finalSubdomain,
          currentPlanId: plan.id,
          paymentRegion: 'TURKEY',
        },
      });

      // Create subscription (mirrors auth.service.ts registration)
      const now = new Date();
      const isFreePlan = plan.name === 'FREE';
      const hasTrial = linkedOffer?.trialDays && linkedOffer.trialDays > 0;

      const currentPeriodEnd = new Date(now);
      if (isFreePlan) {
        currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 10);
      } else if (hasTrial) {
        currentPeriodEnd.setDate(currentPeriodEnd.getDate() + linkedOffer.trialDays);
      } else {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      const amount = linkedOffer?.customPrice
        ? Number(linkedOffer.customPrice)
        : isFreePlan
          ? 0
          : Number(plan.monthlyPrice || 0);

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          paymentProvider: 'EMAIL',
          startDate: now,
          currentPeriodStart: now,
          currentPeriodEnd,
          isTrialPeriod: hasTrial ? true : false,
          ...(hasTrial ? { trialStart: now, trialEnd: currentPeriodEnd } : {}),
          amount,
          currency: plan.currency || 'TRY',
          autoRenew: true,
          cancelAtPeriodEnd: false,
        },
      });

      // Create admin user for the tenant
      await tx.user.create({
        data: {
          email: dto.adminEmail,
          password: hashedPassword,
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerified: true,
          tenantId: tenant.id,
        },
      });

      // Update lead as converted
      const updatedLead = await tx.lead.update({
        where: { id },
        data: {
          status: 'WON',
          convertedTenantId: tenant.id,
          convertedAt: new Date(),
        },
      });

      // Mark the linked offer as accepted
      if (linkedOffer) {
        await tx.leadOffer.update({
          where: { id: dto.offerId },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
      }

      // Create commission for the rep
      if (lead.assignedToId) {
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        await tx.commission.create({
          data: {
            amount: dto.commissionAmount ?? 0,
            type: 'SIGNUP',
            status: 'PENDING',
            period,
            tenantId: tenant.id,
            leadId: id,
            marketingUserId: lead.assignedToId,
          },
        });
      }

      // Log activity
      await tx.leadActivity.create({
        data: {
          type: 'STATUS_CHANGE',
          title: 'Lead converted to customer',
          description: `Tenant "${dto.tenantName}" created with plan "${plan.name}"`,
          leadId: id,
          createdById: userId,
        },
      });

      return { lead: updatedLead, tenantId: tenant.id };
    });

    if (lead.assignedToId) {
      this.notificationsService.create({
        userId: lead.assignedToId,
        type: 'LEAD_CONVERTED',
        title: 'Lead converted',
        message: `"${dto.tenantName}" has been converted to a customer`,
        metadata: { leadId: id, tenantId: result.tenantId },
      }).catch(() => {});  // fire-and-forget, don't fail the main flow
    }

    return result;
  }

  async delete(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');

    await this.prisma.lead.delete({ where: { id } });
    return { message: 'Lead deleted successfully' };
  }
}
