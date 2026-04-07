import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';
import { OfferFilterDto } from '../dto/offer-filter.dto';
import { MarketingNotificationsService } from './marketing-notifications.service';

@Injectable()
export class MarketingOffersService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: MarketingNotificationsService,
  ) {}

  async create(dto: CreateOfferDto, userId: string, userRole: string) {
    // Validate lead exists
    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // SALES_REP can only create offers for their own leads
    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only create offers for your own leads');
    }

    return this.prisma.leadOffer.create({
      data: {
        planId: dto.planId,
        customPrice: dto.customPrice,
        discount: dto.discount,
        trialDays: dto.trialDays,
        notes: dto.notes,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        leadId: dto.leadId,
        createdById: userId,
      },
      include: {
        lead: { select: { id: true, businessName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findAll(userId: string, userRole: string, filter: OfferFilterDto) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (userRole === 'SALES_REP') {
      where.createdById = userId;
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.leadId) {
      where.leadId = filter.leadId;
    }

    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) {
        where.createdAt.gte = new Date(filter.dateFrom);
      }
      if (filter.dateTo) {
        where.createdAt.lte = new Date(filter.dateTo);
      }
    }

    const [offers, total] = await Promise.all([
      this.prisma.leadOffer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          lead: { select: { id: true, businessName: true, contactPerson: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.leadOffer.count({ where }),
    ]);

    return {
      data: offers,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, userId: string, userRole: string) {
    const offer = await this.prisma.leadOffer.findUnique({
      where: { id },
      include: {
        lead: {
          select: { id: true, businessName: true, contactPerson: true, email: true, phone: true },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!offer) throw new NotFoundException('Offer not found');

    if (userRole === 'SALES_REP' && offer.createdById !== userId) {
      throw new ForbiddenException('You can only view your own offers');
    }

    return offer;
  }

  async update(id: string, dto: UpdateOfferDto, userId: string, userRole: string) {
    const offer = await this.prisma.leadOffer.findUnique({ where: { id } });

    if (!offer) throw new NotFoundException('Offer not found');

    if (userRole === 'SALES_REP' && offer.createdById !== userId) {
      throw new ForbiddenException('You can only update your own offers');
    }

    const data: any = { ...dto };
    if (dto.validUntil) data.validUntil = new Date(dto.validUntil);

    return this.prisma.leadOffer.update({
      where: { id },
      data,
      include: {
        lead: { select: { id: true, businessName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async markSent(id: string, userId: string, userRole: string) {
    const offer = await this.prisma.leadOffer.findUnique({ where: { id } });

    if (!offer) throw new NotFoundException('Offer not found');

    if (userRole === 'SALES_REP' && offer.createdById !== userId) {
      throw new ForbiddenException('You can only send your own offers');
    }

    const closedStatuses = ['WON', 'LOST'];

    const updatedOffer = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leadOffer.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date() },
      });

      const lead = await tx.lead.findUnique({ where: { id: offer.leadId } });
      if (lead && !closedStatuses.includes(lead.status)) {
        await tx.lead.update({
          where: { id: offer.leadId },
          data: { status: 'OFFER_SENT' },
        });
      }

      return updated;
    });

    // Notify the assigned rep that the offer was sent
    const lead = await this.prisma.lead.findUnique({ where: { id: updatedOffer.leadId }, select: { assignedToId: true, businessName: true } });
    if (lead?.assignedToId) {
      this.notificationsService.create({
        userId: lead.assignedToId,
        type: 'OFFER_SENT',
        title: 'Offer sent',
        message: `Offer sent to "${lead.businessName}"`,
        metadata: { offerId: id, leadId: updatedOffer.leadId },
      }).catch(() => {});
    }

    return updatedOffer;
  }

  async accept(id: string, userId: string, userRole: string) {
    const offer = await this.prisma.leadOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');

    if (userRole === 'SALES_REP' && offer.createdById !== userId) {
      throw new ForbiddenException('You can only manage your own offers');
    }

    if (offer.status !== 'SENT') {
      throw new BadRequestException('Only sent offers can be accepted');
    }

    if (offer.validUntil && new Date(offer.validUntil) < new Date()) {
      throw new BadRequestException('Offer has expired');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leadOffer.update({
        where: { id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });

      const lead = await tx.lead.findUnique({ where: { id: offer.leadId } });
      if (lead && !['WON', 'LOST'].includes(lead.status)) {
        await tx.lead.update({
          where: { id: offer.leadId },
          data: { status: 'WON' },
        });
      }

      return updated;
    });
  }

  async reject(id: string, userId: string, userRole: string) {
    const offer = await this.prisma.leadOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');

    if (userRole === 'SALES_REP' && offer.createdById !== userId) {
      throw new ForbiddenException('You can only manage your own offers');
    }

    if (offer.status !== 'SENT') {
      throw new BadRequestException('Only sent offers can be rejected');
    }

    return this.prisma.leadOffer.update({
      where: { id },
      data: { status: 'REJECTED', respondedAt: new Date() },
    });
  }

  async delete(id: string) {
    const offer = await this.prisma.leadOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');

    await this.prisma.leadOffer.delete({ where: { id } });
    return { message: 'Offer deleted successfully' };
  }
}
