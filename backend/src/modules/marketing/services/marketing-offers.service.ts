import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';

@Injectable()
export class MarketingOffersService {
  constructor(private prisma: PrismaService) {}

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

  async findAll(userId: string, userRole: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (userRole === 'SALES_REP') {
      where.createdById = userId;
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
    const offer = await this.prisma.leadOffer.findUnique({
      where: { id },
      include: { lead: { select: { status: true, convertedTenantId: true } } },
    });

    if (!offer) throw new NotFoundException('Offer not found');

    if (userRole === 'SALES_REP' && offer.createdById !== userId) {
      throw new ForbiddenException('You can only send your own offers');
    }
    if (offer.status !== 'DRAFT') {
      throw new BadRequestException('Only draft offers can be sent');
    }
    if (offer.lead.convertedTenantId || ['WON', 'LOST'].includes(offer.lead.status)) {
      throw new BadRequestException('Lead is already closed');
    }

    const [updatedOffer] = await this.prisma.$transaction([
      this.prisma.leadOffer.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date() },
      }),
      // Only advance the lead forward; don't clobber a later status.
      ...(['OFFER_SENT', 'WAITING', 'WON', 'LOST'].includes(offer.lead.status)
        ? []
        : [
            this.prisma.lead.update({
              where: { id: offer.leadId },
              data: { status: 'OFFER_SENT' },
            }),
          ]),
    ]);

    return updatedOffer;
  }

  async delete(id: string) {
    const offer = await this.prisma.leadOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');

    await this.prisma.leadOffer.delete({ where: { id } });
    return { message: 'Offer deleted successfully' };
  }
}
