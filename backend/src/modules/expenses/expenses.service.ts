import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";

interface CreateExpenseInput {
  category: string;
  description: string;
  amount: number;
  taxAmount?: number;
  expenseDate: string;
  supplierId?: string;
  notes?: string;
}

const centsOf = (d: Prisma.Decimal | number | null | undefined) =>
  d == null ? 0 : new Prisma.Decimal(d as any).mul(100).round().toNumber();
const toCurrency = (cents: number) => Math.round(cents) / 100;

/**
 * Operating-expense (OpEx) ledger — the cost lines below gross profit that a
 * P&L needs (rent, salary, utilities, …). Kept deliberately simple: a flat
 * categorised ledger the accountant/owner records against, summarised by
 * category + period and consumed by the P&L report.
 */
@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async create(scope: BranchScope, userId: string, dto: CreateExpenseInput) {
    return this.prisma.expense.create({
      data: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        category: dto.category,
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        taxAmount:
          dto.taxAmount != null ? new Prisma.Decimal(dto.taxAmount) : null,
        expenseDate: new Date(dto.expenseDate),
        supplierId: dto.supplierId ?? null,
        notes: dto.notes ?? null,
        createdById: userId,
      },
    });
  }

  async list(
    scope: BranchScope,
    opts?: {
      category?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
    },
  ) {
    const where: any = { ...branchScope(scope) };
    if (opts?.category) where.category = opts.category;
    if (opts?.startDate || opts?.endDate) {
      where.expenseDate = {};
      if (opts.startDate) where.expenseDate.gte = new Date(opts.startDate);
      if (opts.endDate) where.expenseDate.lte = new Date(opts.endDate);
    }
    return this.prisma.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      take: Math.min(opts?.limit ?? 100, 500),
    });
  }

  async remove(scope: BranchScope, id: string) {
    const claim = await this.prisma.expense.deleteMany({
      where: { id, ...branchScope(scope) },
    });
    if (claim.count === 0) throw new NotFoundException("Expense not found");
    return { id };
  }

  /** Expense totals + per-category breakdown for a window (tenant or branch). */
  async summary(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const where: any = { tenantId };
    if (branchId) where.branchId = branchId;
    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = startDate;
      if (endDate) where.expenseDate.lte = endDate;
    }
    const groups = await this.prisma.expense.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true, taxAmount: true },
      _count: true,
    });

    let totalCents = 0;
    const byCategory = groups
      .map((g) => {
        const amt = centsOf(g._sum.amount);
        totalCents += amt;
        return {
          category: g.category,
          amount: toCurrency(amt),
          taxAmount: toCurrency(centsOf(g._sum.taxAmount)),
          count: g._count,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return { total: toCurrency(totalCents), byCategory };
  }
}
