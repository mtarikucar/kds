import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { toCsv } from "../../common/utils/csv.util";

interface CloseInput {
  countedCash?: number;
  denominationBreakdown?: Record<string, number>;
  notes?: string;
}

/**
 * Cashier shift lifecycle + end-of-day cash reconciliation. A session opens with
 * a float, accumulates the shift's cash flows, and closes against a physical
 * count: expected = openingFloat + cash sales + cash-in − cash-out over the
 * shift window; over/short = counted − expected, attributed to the cashier. The
 * counted total is derived from the denomination breakdown when provided (the
 * physical count), not just a typed number — closing the audit's gap where the
 * reconciliation was a single figure keyed into the Z-report.
 */
@Injectable()
export class CashierSessionService {
  constructor(private prisma: PrismaService) {}

  async open(scope: BranchScope, userId: string, openingFloat: number) {
    const existing = await this.prisma.cashierSession.findFirst({
      where: { ...branchScope(scope), userId, status: "OPEN" },
    });
    if (existing) {
      throw new ConflictException(
        "This cashier already has an open session — close it before opening a new one",
      );
    }
    return this.prisma.cashierSession.create({
      data: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        userId,
        openingFloat: new Prisma.Decimal(openingFloat),
        status: "OPEN",
      },
    });
  }

  async getCurrent(scope: BranchScope, userId: string) {
    return this.prisma.cashierSession.findFirst({
      where: { ...branchScope(scope), userId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
  }

  async list(scope: BranchScope, opts?: { status?: string; limit?: number }) {
    return this.prisma.cashierSession.findMany({
      where: {
        ...branchScope(scope),
        ...(opts?.status ? { status: opts.status } : {}),
      },
      orderBy: { openedAt: "desc" },
      take: Math.min(opts?.limit ?? 50, 200),
    });
  }

  /**
   * Closed-session reconciliation export (Z-report history) as CSV for the
   * accountant — one row per session with opening float, cash sales, cash
   * in/out, expected, counted and over/short.
   */
  async listCsv(scope: BranchScope, opts?: { status?: string }) {
    const sessions = await this.prisma.cashierSession.findMany({
      where: {
        ...branchScope(scope),
        ...(opts?.status ? { status: opts.status } : {}),
      },
      orderBy: { openedAt: "desc" },
      take: 500,
    });
    const num = (v: Prisma.Decimal | number | null | undefined) =>
      v == null ? 0 : Number(v);
    const headers = [
      "session",
      "openedAt",
      "closedAt",
      "status",
      "openingFloat",
      "cashSales",
      "cashIn",
      "cashOut",
      "expected",
      "counted",
      "overShort",
    ];
    const rows = sessions.map((s) => [
      s.id,
      s.openedAt ? s.openedAt.toISOString() : "",
      s.closedAt ? s.closedAt.toISOString() : "",
      s.status,
      num(s.openingFloat),
      num(s.cashSales),
      num(s.cashIn),
      num(s.cashOut),
      num(s.expectedCash),
      num(s.countedCash),
      num(s.overShort),
    ]);
    return toCsv(headers, rows);
  }

  /**
   * Expected-cash + component totals for a session over [openedAt, asOf].
   * expected = openingFloat + cash sales + approved cash-in − approved cash-out.
   * Shared by close() (asOf = close time) and the mid-shift X-report.
   */
  private async computeTotals(
    scope: BranchScope,
    session: { openedAt: Date; openingFloat: Prisma.Decimal | number },
    asOf: Date,
  ) {
    const window = { gte: session.openedAt, lte: asOf };
    const [cashSalesAgg, drawerGroups] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          ...branchScope(scope),
          method: "CASH",
          status: "COMPLETED",
          createdAt: window,
        },
        _sum: { amount: true },
      }),
      this.prisma.cashDrawerMovement.groupBy({
        by: ["type"],
        where: {
          ...branchScope(scope),
          approvalStatus: "APPROVED",
          type: { in: ["CASH_IN", "CASH_OUT"] },
          createdAt: window,
        },
        _sum: { amount: true },
      }),
    ]);
    const drawerSum = (t: string) =>
      new Prisma.Decimal(
        drawerGroups.find((g) => g.type === t)?._sum.amount ?? 0,
      );
    const cashSales = new Prisma.Decimal(cashSalesAgg._sum.amount ?? 0);
    const cashIn = drawerSum("CASH_IN");
    const cashOut = drawerSum("CASH_OUT");
    const expected = new Prisma.Decimal(session.openingFloat)
      .add(cashSales)
      .add(cashIn)
      .sub(cashOut);
    return { cashSales, cashIn, cashOut, expected };
  }

  /**
   * X-report — a mid-shift read of the open session's running totals + expected
   * cash, WITHOUT closing the drawer (unlike the Z-report/close). The classic
   * "how much should be in the till right now" check managers run mid-shift.
   */
  async getXReport(scope: BranchScope, sessionId: string) {
    const session = await this.prisma.cashierSession.findFirst({
      where: { id: sessionId, ...branchScope(scope) },
    });
    if (!session) throw new NotFoundException("Cashier session not found");
    if (session.status !== "OPEN") {
      throw new BadRequestException("Session is not open");
    }
    const asOf = new Date();
    const { cashSales, cashIn, cashOut, expected } = await this.computeTotals(
      scope,
      session,
      asOf,
    );
    return {
      sessionId: session.id,
      status: "OPEN",
      openedAt: session.openedAt,
      asOf,
      openingFloat: Number(session.openingFloat),
      cashSales: Number(cashSales),
      cashIn: Number(cashIn),
      cashOut: Number(cashOut),
      expectedCash: Number(expected),
    };
  }

  async close(scope: BranchScope, sessionId: string, input: CloseInput) {
    const session = await this.prisma.cashierSession.findFirst({
      where: { id: sessionId, ...branchScope(scope) },
    });
    if (!session) throw new NotFoundException("Cashier session not found");
    if (session.status !== "OPEN") {
      throw new BadRequestException("Session is already closed");
    }

    const closedAt = new Date();
    const { cashSales, cashIn, cashOut, expected } = await this.computeTotals(
      scope,
      session,
      closedAt,
    );

    // Derive the counted total from the physical denomination count when given;
    // fall back to an explicitly typed figure.
    let counted: Prisma.Decimal;
    const denom = input.denominationBreakdown;
    if (denom && Object.keys(denom).length > 0) {
      counted = Object.entries(denom).reduce(
        (s, [face, count]) => s.add(new Prisma.Decimal(face).mul(count)),
        new Prisma.Decimal(0),
      );
    } else {
      counted = new Prisma.Decimal(input.countedCash ?? 0);
    }
    const overShort = counted.sub(expected);

    // Claim-first close so two concurrent closes can't both write a result.
    const claim = await this.prisma.cashierSession.updateMany({
      where: { id: sessionId, ...branchScope(scope), status: "OPEN" },
      data: {
        status: "CLOSED",
        closedAt,
        countedCash: counted,
        expectedCash: expected,
        overShort,
        cashSales,
        cashIn,
        cashOut,
        denominationBreakdown: denom ?? undefined,
        notes: input.notes ?? session.notes,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException("Session is already closed");
    }
    return this.prisma.cashierSession.findUnique({ where: { id: sessionId } });
  }
}
