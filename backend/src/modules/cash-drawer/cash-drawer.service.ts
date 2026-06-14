import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { MetricsService } from "../../common/metrics/metrics.service";
import { CreateCashDrawerMovementDto } from "./dto/create-cash-drawer-movement.dto";
import { RejectCashDrawerMovementDto } from "./dto/reject-cash-drawer-movement.dto";
import { UserRole } from "../../common/constants/roles.enum";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";

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

  constructor(
    private readonly prisma: PrismaService,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private static readonly AUTO_APPROVED_TYPES = new Set([
    "OPENING",
    "CLOSING",
    "CASH_IN",
  ]);

  private static readonly REVIEW_TYPES = new Set(["CASH_OUT", "ADJUSTMENT"]);

  async create(
    tenantId: string,
    branchId: string,
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

    const movement = await this.prisma.cashDrawerMovement.create({
      data: {
        tenantId,
        branchId,
        userId,
        type: dto.type,
        amount: new Prisma.Decimal(dto.amount),
        reason: dto.reason,
        notes: dto.notes,
        denominationBreakdown: dto.denominationBreakdown as any,
        zReportId: dto.zReportId,
        approvalStatus: requiresReview ? "DRAFT" : "APPROVED",
        approvedById: requiresReview ? null : userId,
        approvedAt: requiresReview ? null : new Date(),
      },
    });

    // Track 2 — record the committed movement for Prometheus. After the
    // write, optional + ?.-guarded so it can never break the business write.
    // `op` collapses the developer-controlled movement types into a bounded
    // operational label (OPENING→open, CLOSING→close, the cash/adjustment
    // types → movement), so cardinality stays low.
    this.metrics?.incCounter(
      "cash_drawer_ops_total",
      "Cash drawer operations by op (open|close|movement|approve)",
      { op: CashDrawerService.opLabel(dto.type) },
    );

    return movement;
  }

  /** Collapse a movement type into the bounded ops-counter label. */
  private static opLabel(type: string): "open" | "close" | "movement" {
    if (type === "OPENING") return "open";
    if (type === "CLOSING") return "close";
    return "movement";
  }

  async listPending(scope: BranchScope) {
    return this.prisma.cashDrawerMovement.findMany({
      where: { ...branchScope(scope), approvalStatus: "DRAFT" },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async approve(
    scope: BranchScope,
    movementId: string,
    approver: { id: string; role: string },
  ) {
    this.assertCanReview(approver.role);
    // updateMany with compound WHERE: tenant+branch IDOR + status=DRAFT
    // gate so a second-approver race doesn't double-flip the row.
    const claim = await this.prisma.cashDrawerMovement.updateMany({
      where: { id: movementId, ...branchScope(scope), approvalStatus: "DRAFT" },
      data: {
        approvalStatus: "APPROVED",
        approvedById: approver.id,
        approvedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Movement is no longer DRAFT — refresh and retry.",
      );
    }
    // Track 2 — record the committed approval (after the claim won the race).
    this.metrics?.incCounter(
      "cash_drawer_ops_total",
      "Cash drawer operations by op (open|close|movement|approve)",
      { op: "approve" },
    );
    const approved = await this.prisma.cashDrawerMovement.findFirstOrThrow({
      where: { id: movementId, ...branchScope(scope) },
    });
    // Auditability — approving a CASH_OUT / ADJUSTMENT releases money from
    // the till, so it is a privileged money mutation that must leave a
    // forensic "who approved what" trail in user_activities (the codebase's
    // tenant-scoped audit log). The compound-WHERE claim above guarantees
    // the row was DRAFT before the flip, so before=DRAFT is exact.
    await this.writeAudit(scope, approver.id, "CASH_DRAWER_APPROVED", {
      movementId,
      type: approved.type,
      amount: approved.amount.toString(),
      from: "DRAFT",
      to: "APPROVED",
    });
    return approved;
  }

  async reject(
    scope: BranchScope,
    movementId: string,
    approver: { id: string; role: string },
    dto: RejectCashDrawerMovementDto,
  ) {
    this.assertCanReview(approver.role);
    const claim = await this.prisma.cashDrawerMovement.updateMany({
      where: { id: movementId, ...branchScope(scope), approvalStatus: "DRAFT" },
      data: {
        approvalStatus: "REJECTED",
        approvedById: approver.id,
        approvedAt: new Date(),
        rejectionReason: dto.reason,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Movement is no longer DRAFT — refresh and retry.",
      );
    }
    const rejected = await this.prisma.cashDrawerMovement.findFirstOrThrow({
      where: { id: movementId, ...branchScope(scope) },
    });
    // Auditability — rejecting a pending CASH_OUT / ADJUSTMENT is also a
    // privileged decision (a manager refusing money to leave the till);
    // record it with the reason so the trail is symmetric with approve.
    await this.writeAudit(scope, approver.id, "CASH_DRAWER_REJECTED", {
      movementId,
      type: rejected.type,
      amount: rejected.amount.toString(),
      from: "DRAFT",
      to: "REJECTED",
      reason: dto.reason,
    });
    return rejected;
  }

  /**
   * Best-effort tenant-scoped audit write. Money/approval decisions on the
   * till land in user_activities — the same append-only log the auth, users
   * and tenants modules use for privileged mutations — so support can answer
   * "who approved/rejected this movement and when". Swallow-and-log: a
   * failure to record the audit row must never roll back the approval/
   * rejection that already committed, matching the metrics/notify pattern.
   */
  private async writeAudit(
    scope: BranchScope,
    actorUserId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.userActivity.create({
        data: {
          userId: actorUserId,
          tenantId: scope.tenantId,
          action,
          metadata: { ...metadata, branchId: scope.branchId } as any,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write cash-drawer audit (${action})`,
        err as any,
      );
    }
  }

  async findOne(scope: BranchScope, movementId: string) {
    const movement = await this.prisma.cashDrawerMovement.findFirst({
      where: { id: movementId, ...branchScope(scope) },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!movement)
      throw new NotFoundException("Cash drawer movement not found");
    return movement;
  }

  private assertCanReview(role: string): void {
    if (role !== UserRole.ADMIN && role !== UserRole.MANAGER) {
      throw new ForbiddenException(
        "Only ADMIN or MANAGER can approve / reject cash drawer movements.",
      );
    }
  }
}
