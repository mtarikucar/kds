import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateActivityDto } from '../dto/create-activity.dto';

@Injectable()
export class MarketingActivitiesService {
  constructor(private prisma: PrismaService) {}

  async create(leadId: string, dto: CreateActivityDto, userId: string, userRole: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only add activities to your own leads');
    }

    return this.prisma.leadActivity.create({
      data: {
        ...dto,
        leadId,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async findByLead(leadId: string, userId: string, userRole: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (userRole === 'SALES_REP' && lead.assignedToId !== userId) {
      throw new ForbiddenException('You can only view activities for your own leads');
    }

    return this.prisma.leadActivity.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async delete(id: string) {
    const activity = await this.prisma.leadActivity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');

    await this.prisma.leadActivity.delete({ where: { id } });
    return { message: 'Activity deleted successfully' };
  }
}
