import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { CreateSwapRequestDto } from '../dto/create-swap-request.dto';
import { SwapRequestStatus } from '../constants/personnel.enum';

@Injectable()
export class ShiftSwapService {
  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
  ) {}

  async createRequest(tenantId: string, requesterId: string, dto: CreateSwapRequestDto) {
    if (requesterId === dto.targetId) {
      throw new BadRequestException('Cannot swap shifts with yourself');
    }

    if (dto.requesterAssignmentId === dto.targetAssignmentId) {
      throw new BadRequestException('Cannot swap the same assignment');
    }

    // Validate requester assignment belongs to requester
    const requesterAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { id: dto.requesterAssignmentId, userId: requesterId, tenantId },
    });
    if (!requesterAssignment) {
      throw new NotFoundException('Requester shift assignment not found');
    }

    // Validate target assignment belongs to target
    const targetAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { id: dto.targetAssignmentId, userId: dto.targetId, tenantId },
    });
    if (!targetAssignment) {
      throw new NotFoundException('Target shift assignment not found');
    }

    const result = await this.prisma.shiftSwapRequest.create({
      data: {
        requesterId,
        targetId: dto.targetId,
        requesterAssignmentId: dto.requesterAssignmentId,
        targetAssignmentId: dto.targetAssignmentId,
        reason: dto.reason,
        tenantId,
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        target: { select: { id: true, firstName: true, lastName: true } },
        requesterAssignment: { include: { shiftTemplate: true } },
      },
    });

    this.kdsGateway.emitSwapRequestUpdate(tenantId, result);
    return result;
  }

  async approve(id: string, tenantId: string, approvedById: string) {
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: { id, tenantId, status: SwapRequestStatus.PENDING },
      include: {
        requesterAssignment: true,
        requester: { select: { id: true, firstName: true, lastName: true } },
        target: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Swap request not found or already processed');
    }

    const targetAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { id: request.targetAssignmentId, tenantId },
    });

    if (!targetAssignment) {
      throw new NotFoundException('Target assignment no longer exists');
    }

    const reqAssignment = request.requesterAssignment;
    const isSameDate = reqAssignment.date.getTime() === targetAssignment.date.getTime();

    // For different-date swaps, validate no double-booking
    if (!isSameDate) {
      const [reqUserOnTargetDate, targetUserOnReqDate] = await Promise.all([
        this.prisma.shiftAssignment.findUnique({
          where: { userId_date: { userId: request.requesterId, date: targetAssignment.date } },
        }),
        this.prisma.shiftAssignment.findUnique({
          where: { userId_date: { userId: request.targetId, date: reqAssignment.date } },
        }),
      ]);

      // Allow the existing swap assignments themselves, but block other conflicts
      if (reqUserOnTargetDate && reqUserOnTargetDate.id !== request.targetAssignmentId) {
        throw new BadRequestException('Requester already has a shift on the target date');
      }
      if (targetUserOnReqDate && targetUserOnReqDate.id !== request.requesterAssignmentId) {
        throw new BadRequestException('Target already has a shift on the requester date');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // First update swap request status (before touching assignments to avoid cascade issues)
      const updatedRequest = await tx.shiftSwapRequest.update({
        where: { id },
        data: {
          status: SwapRequestStatus.APPROVED,
          approvedById,
        },
        include: {
          requester: { select: { id: true, firstName: true, lastName: true } },
          target: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (isSameDate) {
        // Same-date swap: swap shiftTemplateId to avoid @@unique([userId, date]) violation
        await tx.shiftAssignment.update({
          where: { id: request.requesterAssignmentId },
          data: {
            shiftTemplateId: targetAssignment.shiftTemplateId,
            status: 'SWAPPED',
          },
        });

        await tx.shiftAssignment.update({
          where: { id: request.targetAssignmentId },
          data: {
            shiftTemplateId: reqAssignment.shiftTemplateId,
            status: 'SWAPPED',
          },
        });
      } else {
        // Different-date swap: swap userId on each assignment
        await tx.shiftAssignment.update({
          where: { id: request.requesterAssignmentId },
          data: {
            userId: request.targetId,
            status: 'SWAPPED',
          },
        });

        await tx.shiftAssignment.update({
          where: { id: request.targetAssignmentId },
          data: {
            userId: request.requesterId,
            status: 'SWAPPED',
          },
        });
      }

      return updatedRequest;
    });

    this.kdsGateway.emitSwapRequestUpdate(tenantId, result);
    return result;
  }

  async reject(id: string, tenantId: string, approvedById: string) {
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: { id, tenantId, status: SwapRequestStatus.PENDING },
    });

    if (!request) {
      throw new NotFoundException('Swap request not found or already processed');
    }

    const result = await this.prisma.shiftSwapRequest.update({
      where: { id },
      data: {
        status: SwapRequestStatus.REJECTED,
        approvedById,
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        target: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    this.kdsGateway.emitSwapRequestUpdate(tenantId, result);
    return result;
  }

  async findAll(tenantId: string) {
    return this.prisma.shiftSwapRequest.findMany({
      where: { tenantId },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        target: { select: { id: true, firstName: true, lastName: true } },
        requesterAssignment: { include: { shiftTemplate: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
