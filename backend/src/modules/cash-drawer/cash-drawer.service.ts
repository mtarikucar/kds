import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCashDrawerMovementDto } from './dto/create-cash-drawer-movement.dto';
import { RejectCashDrawerMovementDto } from './dto/reject-cash-drawer-movement.dto';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * v2.8.99 — cash drawer movement service.
 *
 * Movement types and auto-approval rules:
 *
 *   OPENING      auto-APPROVED  // opens a shift; the staff identity itself is the trail
 *   CLOSING      auto-APPROVED  // closes a shift; usually generates the Z-Report
 *   CASH_IN      auto-APPROVED  // money coming in is hard to forge — the sale or
 *                                  cash-deposit envelope is the source
 *   CASH_OUT     DRAFT          // money leaving the till outside of a sale needs
 *                                  manager sign-off (petty cash, return-from-shift)
 *   ADJUSTMENT   DRAFT          // anything explicit-set; the largest fraud vector
 *
 * Only APPROVED rows participate in Z-Report cash reconciliation
 * (enforced in z-reports.service v2.8.99).
 *
 * Approval is restricted to ADMIN and MANAGER. The creator role is
 * intentionally allowed to be WAITER for OPENING/CLOSING/CASH_IN; the
 * approval gate only fires on CASH_OUT and ADJUSTMENT.
 */
@Injectable()
export class CashDrawerService {
  private readonly logger = new Logger(CashDrawerService.name);

  constructor(private readonly prisma: PrismaService) {}

  private static readonly AUTO_APPROVED_TYPES = new Set([
    'OPENING',
    'CLOSING',
    'CASH_IN',
  ]);

  private static readonly REVIEW_TYPES = new Set(['CASH_OUT', 'ADJUSTMENT']);

  async create(
    tenantId: string,
    userId: string,
    dto: CreateCashDrawerMovementDto,
  ) {
    if (
      !CashDrawerService.AUTO_APPROVED_TYPES.has(dto.type) &&
      !CashDrawerService.REVIEW_TYPES.has(dto.type)
    ) {
      throw new BadRequestException(`Unknown cash drawer type: ${dto.type}`);
    }

    const requiresReview = CashDrawerService.REVIEW_TYPES.has(dto.type);

    return this.prisma.cashDrawerMovement.create({
      data: {
        tenantId,
        userId,
        type: dto.type,
        amount: new Prisma.Decimal(dto.amount),
        reason: dto.reason,
        notes: dto.notes,
        denominationBreakdown: dto.denominationBreakdown as any,
        zReportId: dto.zReportId,
        approvalStatus: requiresReview ? 'DRAFT' : 'APPROVED',
        approvedById: requiresReview ? null : userId,
        approvedAt: requiresReview ? null : new Date(),
      },
    });
  }

  async listPending(tenantId: string) {
    return this.prisma.cashDrawerMovement.findMany({
      where: { tenantId, approvalStatus: 'DRAFT' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(
    tenantId: string,
    movementId: string,
    approver: { id: string; role: string },
  ) {
    this.assertCanReview(approver.role);
    // updateMany with compound WHERE: tenantId IDOR + status=DRAFT gate
    // so a second-approver race doesn't double-flip the row.
    const claim = await this.prisma.cashDrawerMovement.updateMany({
      where: { id: movementId, tenantId, approvalStatus: 'DRAFT' },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: approver.id,
        approvedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Movement is no longer DRAFT — refresh and retry.',
      );
    }
    return this.prisma.cashDrawerMovement.findFirstOrThrow({
      where: { id: movementId, tenantId },
    });
  }

  async reject(
    tenantId: string,
    movementId: string,
    approver: { id: string; role: string },
    dto: RejectCashDrawerMovementDto,
  ) {
    this.assertCanReview(approver.role);
    const claim = await this.prisma.cashDrawerMovement.updateMany({
      where: { id: movementId, tenantId, approvalStatus: 'DRAFT' },
      data: {
        approvalStatus: 'REJECTED',
        approvedById: approver.id,
        approvedAt: new Date(),
        rejectionReason: dto.reason,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Movement is no longer DRAFT — refresh and retry.',
      );
    }
    return this.prisma.cashDrawerMovement.findFirstOrThrow({
      where: { id: movementId, tenantId },
    });
  }

  async findOne(tenantId: string, movementId: string) {
    const movement = await this.prisma.cashDrawerMovement.findFirst({
      where: { id: movementId, tenantId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!movement) throw new NotFoundException('Cash drawer movement not found');
    return movement;
  }

  private assertCanReview(role: string): void {
    if (role !== UserRole.ADMIN && role !== UserRole.MANAGER) {
      throw new ForbiddenException(
        'Only ADMIN or MANAGER can approve / reject cash drawer movements.',
      );
    }
  }
}
