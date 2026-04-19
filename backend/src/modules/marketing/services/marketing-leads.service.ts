import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { LeadFilterDto } from '../dto/lead-filter.dto';
import { ConvertLeadDto } from '../dto/convert-lead.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class MarketingLeadsService {
  constructor(private prisma: PrismaService) {}

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

    const hashedPassword = await bcrypt.hash(dto.adminPassword, 10);

    // Transaction: create tenant, admin user, update lead, create commission
    const result = await this.prisma.$transaction(async (tx) => {
      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          ...(dto.planId ? { currentPlanId: dto.planId } : {}),
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

      // Create commission for the rep
      if (lead.assignedToId) {
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        await tx.commission.create({
          data: {
            amount: 0, // Will be calculated based on business rules
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
          description: `Tenant "${dto.tenantName}" created`,
          leadId: id,
          createdById: userId,
        },
      });

      return { lead: updatedLead, tenantId: tenant.id };
    });

    return result;
  }

  async delete(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');

    await this.prisma.lead.update({
      where: { id },
      data: { status: 'LOST', lostReason: 'Deleted by manager' },
    });
    return { message: 'Lead archived successfully' };
  }
}
