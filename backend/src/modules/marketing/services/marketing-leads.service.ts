import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { addDays, addMonths, addYears } from 'date-fns';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../../../common/services/email.service';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { LeadFilterDto } from '../dto/lead-filter.dto';
import { ConvertLeadDto } from '../dto/convert-lead.dto';
import {
  isSubdomainQuarantined,
  randomSubdomainSuffix,
} from '../../../common/helpers/subdomain.helper';

/**
 * Allowed lead status transitions. Terminal states (WON, LOST) are
 * captured by returning an empty array — no further move is permitted
 * once the lead is closed, otherwise a rep could flip a converted WON
 * lead back to NEW and leave the tenant/commission dangling.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ['CONTACTED', 'NOT_REACHABLE', 'LOST'],
  CONTACTED: ['MEETING_DONE', 'DEMO_SCHEDULED', 'NOT_REACHABLE', 'WAITING', 'LOST'],
  NOT_REACHABLE: ['CONTACTED', 'LOST'],
  MEETING_DONE: ['DEMO_SCHEDULED', 'OFFER_SENT', 'WAITING', 'LOST'],
  DEMO_SCHEDULED: ['MEETING_DONE', 'OFFER_SENT', 'WAITING', 'LOST'],
  OFFER_SENT: ['WAITING', 'WON', 'LOST'],
  WAITING: ['OFFER_SENT', 'WON', 'LOST'],
  WON: [],
  LOST: [],
};

/**
 * Fallback signup-commission rate used when a tenant converts on a
 * plan whose `commissionRate` couldn't be read (cold seed without
 * the new column, or a no-plan conversion). Per-plan overrides on
 * SubscriptionPlan.commissionRate take precedence.
 */
const DEFAULT_SIGNUP_COMMISSION_RATE = 0.1;

@Injectable()
export class MarketingLeadsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 15 ? parsed : 12;
  }

  /**
   * Pick a free subdomain for a converted tenant. Mirrors
   * AuthService.allocateSubdomain: prefer the slug derived from the
   * restaurant name; on collision or quarantine, tack on a 6-hex suffix.
   * Uniqueness is also enforced by the DB unique index — the try/catch
   * on the transaction handles the rare simultaneous-convert race.
   */
  private async allocateSubdomain(base: string): Promise<string> {
    const baseClean = base || 'restaurant';
    const preferredTaken =
      (await isSubdomainQuarantined(this.prisma, baseClean)) ||
      (await this.prisma.tenant.findUnique({ where: { subdomain: baseClean } }));
    if (!preferredTaken) return baseClean;
    for (let i = 0; i < 5; i += 1) {
      const candidate = `${baseClean}-${randomSubdomainSuffix()}`;
      const taken =
        (await isSubdomainQuarantined(this.prisma, candidate)) ||
        (await this.prisma.tenant.findUnique({ where: { subdomain: candidate } }));
      if (!taken) return candidate;
    }
    throw new ConflictException('Could not allocate a free subdomain');
  }

  async create(dto: CreateLeadDto, userId: string) {
    // Idempotency: refuse to create a second OPEN lead for the same
    // email. Two reps logging the same prospect was the actual
    // user-pain (no unique constraint at the DB level because the
    // schema needs to allow a customer to come back later as a
    // separate opportunity, but blocking duplicates while the first
    // is still in pipeline is the right tradeoff).
    if (dto.email) {
      const existing = await this.prisma.lead.findFirst({
        where: {
          email: dto.email,
          status: { notIn: ['WON', 'LOST'] },
        },
        select: { id: true, businessName: true, assignedTo: { select: { firstName: true, lastName: true } } },
      });
      if (existing) {
        const owner = existing.assignedTo
          ? `${existing.assignedTo.firstName} ${existing.assignedTo.lastName}`
          : 'unassigned';
        throw new ConflictException(
          `A lead with this email already exists (${existing.businessName}, owned by ${owner})`,
        );
      }
    }

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

    const where: Prisma.LeadWhereInput = {};

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

    const allowedSortFields = [
      'createdAt',
      'updatedAt',
      'businessName',
      'contactPerson',
      'city',
      'status',
      'source',
      'priority',
      'nextFollowUp',
    ];
    const orderBy: Prisma.LeadOrderByWithRelationInput = {};
    if (filter.sortBy && allowedSortFields.includes(filter.sortBy)) {
      (orderBy as any)[filter.sortBy] = filter.sortOrder || 'desc';
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

    // Build update explicitly — the DTO now omits assignedToId and
    // status, but being explicit keeps us safe from future DTO drift.
    const data: Prisma.LeadUpdateInput = {
      ...(dto.businessName !== undefined && { businessName: dto.businessName }),
      ...(dto.contactPerson !== undefined && { contactPerson: dto.contactPerson }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.whatsapp !== undefined && { whatsapp: dto.whatsapp }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.region !== undefined && { region: dto.region }),
      ...(dto.businessType !== undefined && { businessType: dto.businessType }),
      ...(dto.tableCount !== undefined && { tableCount: dto.tableCount }),
      ...(dto.branchCount !== undefined && { branchCount: dto.branchCount }),
      ...(dto.currentSystem !== undefined && { currentSystem: dto.currentSystem }),
      ...(dto.source !== undefined && { source: dto.source }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.nextFollowUp !== undefined && {
        nextFollowUp: dto.nextFollowUp ? new Date(dto.nextFollowUp) : null,
      }),
    };

    return this.prisma.lead.update({
      where: { id },
      data,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    lostReason: string | undefined,
    userId: string,
    userRole: string,
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');

    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only update your own leads');
    }

    // Terminal states cannot be re-opened from this endpoint. WON in
    // particular is owned by `convert()` (which sets convertedTenantId);
    // flipping it back here would leave a dangling tenant.
    const allowed = ALLOWED_TRANSITIONS[lead.status] ?? [];
    if (status !== lead.status && !allowed.includes(status)) {
      throw new BadRequestException(
        `Invalid transition from ${lead.status} to ${status}`,
      );
    }
    if (status === 'WON') {
      throw new BadRequestException(
        'Use /convert to move a lead to WON (creates tenant and commission)',
      );
    }
    if (lead.convertedTenantId) {
      throw new BadRequestException(
        'Cannot change status of an already-converted lead',
      );
    }

    // Compound WHERE on the original status closes the TOCTOU window
    // between the transition validation above and the write. Without
    // it two managers (or a manager + rep) racing both pass the
    // ALLOWED_TRANSITIONS check from the same lead.status snapshot
    // then last-writer-wins the status — silently skipping any state
    // that was supposed to be sequential.
    const claim = await this.prisma.lead.updateMany({
      where: { id, status: lead.status },
      data: {
        status,
        ...(status === 'LOST' && lostReason ? { lostReason } : {}),
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Lead status changed concurrently — refresh and retry.',
      );
    }
    const updatedLead = await this.prisma.lead.findUniqueOrThrow({ where: { id } });

    await this.prisma.leadActivity.create({
      data: {
        type: 'STATUS_CHANGE',
        title: `Status changed to ${status}`,
        description: lostReason ? `Reason: ${lostReason}` : undefined,
        leadId: id,
        createdById: userId,
      },
    });

    // LOST terminates the pipeline. WON goes through convert() which
    // has its own task-cleanup hook. Cancel any open tasks attached to
    // the lead so they don't clutter the calendar — the rep would
    // never act on them.
    if (status === 'LOST') {
      await this.prisma.marketingTask.updateMany({
        where: {
          leadId: id,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        data: { status: 'CANCELLED' },
      });
    }

    // Notify the lead's assignee of the change — but only when the
    // change came from someone else (the assignee fired it themselves,
    // they already know).
    if (updatedLead.assignedToId && updatedLead.assignedToId !== userId) {
      await this.prisma.marketingNotification.create({
        data: {
          userId: updatedLead.assignedToId,
          type: 'INACTIVE_LEAD',
          title: 'Lead status updated',
          message: `${updatedLead.businessName}: ${lead.status} → ${status}`,
          metadata: { leadId: id, from: lead.status, to: status },
        },
      });
    }

    return updatedLead;
  }

  async assign(id: string, assignedToId: string, actorId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');

    const rep = await this.prisma.marketingUser.findUnique({
      where: { id: assignedToId },
      select: { id: true, role: true, status: true, firstName: true, lastName: true },
    });
    if (!rep) throw new NotFoundException('Sales rep not found');
    if (rep.role !== 'SALES_REP') {
      throw new BadRequestException('Target must be a SALES_REP');
    }
    if (rep.status !== 'ACTIVE') {
      throw new BadRequestException('Target rep is not active');
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { assignedToId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.prisma.leadActivity.create({
      data: {
        type: 'STATUS_CHANGE',
        title: 'Lead assigned',
        description: `Assigned to ${rep.firstName} ${rep.lastName}`,
        leadId: id,
        createdById: actorId,
      },
    });

    // Notify the new owner — they need to know a lead just landed in
    // their queue. Skip if they happened to assign it to themselves.
    if (assignedToId !== actorId) {
      await this.prisma.marketingNotification.create({
        data: {
          userId: assignedToId,
          type: 'FOLLOW_UP_REMINDER',
          title: 'New lead assigned to you',
          message: `${updated.businessName} — ${updated.contactPerson}`,
          metadata: { leadId: id, assignedBy: actorId },
        },
      });
    }

    return updated;
  }

  /**
   * Convert a lead to a paying tenant. Creates tenant + admin user +
   * subscription in a single transaction, generates a random admin
   * password (never accepted from the DTO), emails a welcome note, and
   * records the rep's signup commission. Idempotent via lead.convertedTenantId.
   */
  async convert(id: string, dto: ConvertLeadDto, userId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.convertedTenantId) {
      throw new ConflictException('Lead already converted');
    }

    // Pre-flight email uniqueness check so we can fail with 409 instead
    // of leaking a raw Prisma P2002 from inside the transaction.
    const emailCollision = await this.prisma.user.findUnique({
      where: { email: dto.adminEmail },
      select: { id: true },
    });
    if (emailCollision) {
      throw new ConflictException('Admin email is already in use');
    }

    let plan: Awaited<ReturnType<typeof this.prisma.subscriptionPlan.findUnique>> | null = null;
    let offer: Awaited<ReturnType<typeof this.prisma.leadOffer.findUnique>> | null = null;
    if (dto.offerId) {
      offer = await this.prisma.leadOffer.findUnique({ where: { id: dto.offerId } });
      if (!offer || offer.leadId !== id) {
        throw new BadRequestException('Offer not found for this lead');
      }
    }
    const planId = offer?.planId ?? dto.planId ?? null;
    if (planId) {
      plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan || !plan.isActive) {
        throw new BadRequestException('Plan not found or inactive');
      }
    }

    // Generate a random admin password the rep never sees; the new
    // owner receives it via email and is expected to change it on
    // first login (they can also use /auth/forgot-password).
    const rawPassword = randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(rawPassword, this.bcryptCost());

    const now = new Date();
    const trialDays = offer?.trialDays ?? plan?.trialDays ?? 0;
    const canTrial = !!plan && trialDays > 0 && plan.name !== 'FREE';
    const trialStart = canTrial ? now : null;
    const trialEnd = canTrial ? addDays(now, trialDays) : null;
    const billingCycle = 'MONTHLY';
    const currentPeriodEnd = canTrial
      ? (trialEnd as Date)
      : plan
        ? addMonths(now, 1)
        : addYears(now, 10);
    const subscriptionAmount = plan
      ? offer?.customPrice ?? plan.monthlyPrice
      : null;

    // Allocate a subdomain up-front (not inside the tx). The auth/QR-menu
    // flows require a non-null subdomain; marketing-converted tenants
    // previously got a NULL and broke their own QR-menu URL generation.
    const baseSubdomain = dto.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const subdomain = await this.allocateSubdomain(baseSubdomain);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          subdomain,
          ...(plan ? { currentPlanId: plan.id } : {}),
          ...(canTrial && plan
            ? {
                trialUsed: true,
                trialStartedAt: trialStart,
                trialEndsAt: trialEnd,
                // Per-plan trial registry stays consistent with the
                // PaymentsService/SubscriptionService flows.
                usedTrialPlanIds: [plan.id],
              }
            : {}),
        },
      });

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

      if (plan && subscriptionAmount != null) {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: canTrial ? 'TRIALING' : 'ACTIVE',
            billingCycle,
            paymentProvider: 'PAYTR',
            startDate: now,
            currentPeriodStart: now,
            currentPeriodEnd,
            isTrialPeriod: canTrial,
            trialStart,
            trialEnd,
            amount: subscriptionAmount,
            currency: plan.currency,
            cancelAtPeriodEnd: false,
          },
        });
      }

      if (offer) {
        await tx.leadOffer.update({
          where: { id: offer.id },
          data: { status: 'ACCEPTED' },
        });
      }

      // CRITICAL: compound WHERE on `convertedTenantId: null` to make
      // conversion idempotent under concurrent calls. Two managers
      // hitting Convert at the same millisecond both passed the
      // `lead.convertedTenantId` check at line 445 (READ COMMITTED
      // can't see the other's uncommitted write), both reached this
      // tx, and both proceeded to create a tenant + admin + commission
      // — producing TWO orphan tenants and a DOUBLE commission row
      // for ONE lead. The claim below makes the second tx's
      // updateMany return count=0, and the surrounding catch will
      // roll the whole second transaction back (its tenant + user +
      // commission rows go away with it).
      const claim = await tx.lead.updateMany({
        where: { id, convertedTenantId: null },
        data: {
          status: 'WON',
          convertedTenantId: tenant.id,
          convertedAt: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new ConflictException('Lead was converted concurrently');
      }
      const updatedLead = await tx.lead.findUniqueOrThrow({ where: { id } });

      // Cancel any open tasks attached to this lead — the rep no
      // longer needs reminders for a closed deal.
      await tx.marketingTask.updateMany({
        where: {
          leadId: id,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        data: { status: 'CANCELLED' },
      });

      if (lead.assignedToId) {
        // Signup commission: percentage of the plan's monthly price when
        // a plan was attached to the conversion; 0 when no plan was
        // specified (FREE flows). Managers can tweak this later via the
        // commissions service.
        const commissionAmount = plan
          ? new Prisma.Decimal(plan.monthlyPrice)
              .mul(
                // Per-plan override; defaults to the historical 10%
                // when the column is absent (transitional rollout).
                plan.commissionRate ?? DEFAULT_SIGNUP_COMMISSION_RATE,
              )
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          : new Prisma.Decimal(0);
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        await tx.commission.create({
          data: {
            amount: commissionAmount,
            type: 'SIGNUP',
            status: 'PENDING',
            period,
            tenantId: tenant.id,
            leadId: id,
            marketingUserId: lead.assignedToId,
          },
        });
      }

      await tx.leadActivity.create({
        data: {
          type: 'STATUS_CHANGE',
          title: 'Lead converted to customer',
          description: `Tenant "${dto.tenantName}" created`,
          leadId: id,
          createdById: userId,
        },
      });

      return { lead: updatedLead, tenantId: tenant.id };
    })
    .catch((err) => {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Subdomain or admin email raced with another request between
        // our allocator call and the transactional create. Surface a
        // clear 409 instead of a generic 500.
        throw new ConflictException(
          'Could not create tenant — a tenant with that subdomain or an admin with that email was created concurrently. Please retry.',
        );
      }
      throw err;
    });

    // Send the welcome email outside the transaction. Failure here
    // shouldn't roll back the conversion — the owner can still recover
    // via /auth/forgot-password. Template-driven so the Turkish copy
    // sits in a .hbs file rather than inline service code (was a
    // blocker for i18n + translator review).
    try {
      const appUrl = process.env.APP_URL ?? 'https://hummytummy.com';
      await this.emailService.sendEmail({
        to: dto.adminEmail,
        subject: 'HummyTummy hesabınız hazır',
        template: 'marketing-tenant-welcome',
        context: {
          adminFirstName: dto.adminFirstName,
          adminEmail: dto.adminEmail,
          tenantName: dto.tenantName,
          rawPassword,
          appUrl,
          loginUrl: `${appUrl}/login`,
        },
      });
    } catch (err) {
      // Log only; do not fail the response.
      // eslint-disable-next-line no-console
      console.error('Failed to send welcome email after lead conversion:', err);
    }

    return result;
  }

  async delete(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');

    await this.prisma.lead.update({
      where: { id },
      data: { status: 'LOST', lostReason: 'archived_by_manager' },
    });
    return { message: 'Lead archived successfully' };
  }
}
