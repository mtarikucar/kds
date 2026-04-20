import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    // Target must actually belong to the caller's tenant — otherwise
    // the 404 on assignment below quietly leaks that the user exists.
    const target = await this.prisma.user.findFirst({
      where: { id: dto.targetId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!target) {
      throw new BadRequestException('Target user not found');
    }

    // Validate requester assignment belongs to requester
    const requesterAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { id: dto.requesterAssignmentId, userId: requesterId, tenantId },
    });
    if (!requesterAssignment) {
      throw new NotFoundException('Requester shift assignment not found');
    }
    if (requesterAssignment.status === 'SWAPPED') {
      throw new BadRequestException('Requester assignment has already been swapped');
    }

    // Validate target assignment belongs to target
    const targetAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { id: dto.targetAssignmentId, userId: dto.targetId, tenantId },
    });
    if (!targetAssignment) {
      throw new NotFoundException('Target shift assignment not found');
    }
    if (targetAssignment.status === 'SWAPPED') {
      throw new BadRequestException('Target assignment has already been swapped');
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

  /**
   * Target employee accepts a pending swap. Moves status to
   * TARGET_ACCEPTED so a manager can then approve it. Rejection is a
   * terminal transition (TARGET_REJECTED) that dead-ends the swap.
   */
  async respondAsTarget(
    id: string,
    tenantId: string,
    userId: string,
    accept: boolean,
  ) {
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: { id, tenantId, status: SwapRequestStatus.PENDING },
    });
    if (!request) {
      throw new NotFoundException('Swap request not found or already processed');
    }
    if (request.targetId !== userId) {
      throw new ForbiddenException('Only the target employee can respond to this swap');
    }
    const status = accept
      ? SwapRequestStatus.TARGET_ACCEPTED
      : SwapRequestStatus.TARGET_REJECTED;

    const updated = await this.prisma.shiftSwapRequest.update({
      where: { id },
      data: {
        status,
        targetApproved: accept,
        targetRespondedAt: new Date(),
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        target: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.kdsGateway.emitSwapRequestUpdate(tenantId, updated);
    return updated;
  }

  async approve(id: string, tenantId: string, approvedById: string) {
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: { id, tenantId, status: SwapRequestStatus.TARGET_ACCEPTED },
      include: {
        requesterAssignment: true,
        requester: { select: { id: true, firstName: true, lastName: true } },
        target: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(
        'Swap request not found, awaiting target consent, or already processed',
      );
    }

    // Manager cannot approve a swap that targets or involves themselves.
    if (approvedById === request.requesterId || approvedById === request.targetId) {
      throw new ForbiddenException('Cannot self-approve a swap');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [targetAssignment, reqAssignment] = await Promise.all([
        tx.shiftAssignment.findFirst({
          where: { id: request.targetAssignmentId, tenantId },
        }),
        tx.shiftAssignment.findFirst({
          where: { id: request.requesterAssignmentId, tenantId },
        }),
      ]);

      if (!targetAssignment) {
        throw new NotFoundException('Target assignment no longer exists');
      }
      if (!reqAssignment) {
        throw new NotFoundException('Requester assignment no longer exists');
      }
      const isSameDate = reqAssignment.date.getTime() === targetAssignment.date.getTime();

      // For different-date swaps, validate no double-booking (inside transaction for consistency)
      if (!isSameDate) {
        const [reqUserOnTargetDate, targetUserOnReqDate] = await Promise.all([
          tx.shiftAssignment.findFirst({
            where: { userId: request.requesterId, date: targetAssignment.date, tenantId },
          }),
          tx.shiftAssignment.findFirst({
            where: { userId: request.targetId, date: reqAssignment.date, tenantId },
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

      // Update swap request status (before touching assignments to avoid cascade issues)
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.kdsGateway.emitSwapRequestUpdate(tenantId, result);
    return result;
  }

  async reject(id: string, tenantId: string, approvedById: string) {
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: {
        id,
        tenantId,
        status: {
          in: [SwapRequestStatus.PENDING, SwapRequestStatus.TARGET_ACCEPTED],
        },
      },
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
