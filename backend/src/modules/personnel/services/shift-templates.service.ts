import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  BranchScope,
  branchScope,
} from "../../../common/scoping/branch-scope";
import { CreateShiftTemplateDto } from "../dto/create-shift-template.dto";
import { UpdateShiftTemplateDto } from "../dto/update-shift-template.dto";

@Injectable()
export class ShiftTemplatesService {
  constructor(private prisma: PrismaService) {}

  private assertDistinctTimes(startTime: string, endTime: string) {
    if (startTime === endTime) {
      throw new BadRequestException(
        "startTime and endTime must differ (zero-length shift)",
      );
    }
  }

  async create(scope: BranchScope, dto: CreateShiftTemplateDto) {
    this.assertDistinctTimes(dto.startTime, dto.endTime);
    return this.prisma.shiftTemplate.create({
      data: {
        ...dto,
        ...branchScope(scope),
      },
    });
  }

  async findAll(scope: BranchScope) {
    return this.prisma.shiftTemplate.findMany({
      where: { ...branchScope(scope) },
      orderBy: { startTime: "asc" },
    });
  }

  async update(scope: BranchScope, id: string, dto: UpdateShiftTemplateDto) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id, ...branchScope(scope) },
    });

    if (!template) {
      throw new NotFoundException("Shift template not found");
    }

    // Compound WHERE IDOR guard (B41-B45 pattern).
    const claim = await this.prisma.shiftTemplate.updateMany({
      where: { id, ...branchScope(scope) },
      data: dto,
    });
    if (claim.count === 0) {
      throw new NotFoundException("Shift template not found");
    }
    // Defence-in-depth — keep the read branch-scoped too. Same pattern
    // as iter-33's categories + payments fixes.
    return this.prisma.shiftTemplate.findFirstOrThrow({
      where: { id, ...branchScope(scope) },
    });
  }

  async remove(scope: BranchScope, id: string) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id, ...branchScope(scope) },
    });

    if (!template) {
      throw new NotFoundException("Shift template not found");
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

    // Compound WHERE delete (B41-B45 pattern).
    return this.prisma.shiftTemplate.delete({
      where: { id, ...branchScope(scope) },
    });
  }
}
