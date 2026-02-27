import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateShiftTemplateDto } from '../dto/create-shift-template.dto';
import { UpdateShiftTemplateDto } from '../dto/update-shift-template.dto';

@Injectable()
export class ShiftTemplatesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateShiftTemplateDto) {
    return this.prisma.shiftTemplate.create({
      data: {
        ...dto,
        tenantId,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.shiftTemplate.findMany({
      where: { tenantId },
      orderBy: { startTime: 'asc' },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateShiftTemplateDto) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!template) {
      throw new NotFoundException('Shift template not found');
    }

    return this.prisma.shiftTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, tenantId: string) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!template) {
      throw new NotFoundException('Shift template not found');
    }

    // Check for existing future assignments to prevent cascade deletion
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureAssignments = await this.prisma.shiftAssignment.count({
      where: { shiftTemplateId: id, date: { gte: today } },
    });

    if (futureAssignments > 0) {
      throw new BadRequestException(
        `Cannot delete template with ${futureAssignments} future assignment(s). Remove assignments first or deactivate the template.`,
      );
    }

    return this.prisma.shiftTemplate.delete({ where: { id } });
  }
}
