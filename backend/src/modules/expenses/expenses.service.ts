import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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

type UpdateExpenseInput = Partial<CreateExpenseInput>;

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
    await this.assertPeriodUnlocked(scope.tenantId, new Date(dto.expenseDate));
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

  /**
   * Partial update. Same compound-WHERE IDOR guard as remove(): the mutation
   * itself carries (tenantId, branchId) so a cross-tenant/cross-branch id can
   * never be claimed even if the pre-read regresses. Period-lock is enforced
   * on BOTH sides of a date move: the month the record currently sits in and
   * the month it is being moved into.
   */
  async update(scope: BranchScope, id: string, dto: UpdateExpenseInput) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, ...branchScope(scope) },
      select: { expenseDate: true },
    });
    if (!existing) throw new NotFoundException("Expense not found");

    await this.assertPeriodUnlocked(scope.tenantId, existing.expenseDate);
    if (dto.expenseDate !== undefined) {
      await this.assertPeriodUnlocked(
        scope.tenantId,
        new Date(dto.expenseDate),
      );
    }

    const data: Prisma.ExpenseUpdateManyMutationInput = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.taxAmount !== undefined) {
      data.taxAmount =
        dto.taxAmount != null ? new Prisma.Decimal(dto.taxAmount) : null;
    }
    if (dto.expenseDate !== undefined) {
      data.expenseDate = new Date(dto.expenseDate);
    }
    if (dto.supplierId !== undefined) data.supplierId = dto.supplierId ?? null;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;

    const claim = await this.prisma.expense.updateMany({
      where: { id, ...branchScope(scope) },
      data,
    });
    if (claim.count === 0) throw new NotFoundException("Expense not found");
    return this.prisma.expense.findUnique({ where: { id } });
  }

  async remove(scope: BranchScope, id: string) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, ...branchScope(scope) },
      select: { expenseDate: true },
    });
    if (!existing) throw new NotFoundException("Expense not found");
    await this.assertPeriodUnlocked(scope.tenantId, existing.expenseDate);

    const claim = await this.prisma.expense.deleteMany({
      where: { id, ...branchScope(scope) },
    });
    if (claim.count === 0) throw new NotFoundException("Expense not found");
    return { id };
  }

  // ── Accounting period locks ────────────────────────────────────────────
  // Tenant-wide (the accountant closes the month for the whole company).
  // While a (year, month) is locked, any expense create/update/delete whose
  // expenseDate falls in that month is rejected with 400 "Dönem kilitli".

  /** Lock a month. Idempotent: re-locking an already-locked month is a no-op. */
  async lockPeriod(scope: BranchScope, dto: { year: number; month: number }) {
    return this.prisma.expensePeriodLock.upsert({
      where: {
        tenantId_year_month: {
          tenantId: scope.tenantId,
          year: dto.year,
          month: dto.month,
        },
      },
      create: {
        tenantId: scope.tenantId,
        year: dto.year,
        month: dto.month,
        lockedByUserId: scope.userId,
      },
      update: {},
    });
  }

  /** Unlock a month. Compound WHERE keeps it tenant-scoped (IDOR guard). */
  async unlockPeriod(scope: BranchScope, year: number, month: number) {
    const claim = await this.prisma.expensePeriodLock.deleteMany({
      where: { tenantId: scope.tenantId, year, month },
    });
    if (claim.count === 0) throw new NotFoundException("Period lock not found");
    return { year, month };
  }

  /** List this tenant's locked months, newest first. */
  async listPeriodLocks(scope: BranchScope) {
    return this.prisma.expensePeriodLock.findMany({
      where: { tenantId: scope.tenantId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
  }

  /**
   * Reject the mutation when `date` falls inside a locked month. Uses the
   * UTC calendar month — expenseDate arrives as an ISO date string
   * ("2026-06-01" → UTC midnight), so UTC is the axis the row was bucketed
   * on when it was written.
   */
  private async assertPeriodUnlocked(tenantId: string, date: Date) {
    const lock = await this.prisma.expensePeriodLock.findUnique({
      where: {
        tenantId_year_month: {
          tenantId,
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
        },
      },
      select: { id: true },
    });
    if (lock) throw new BadRequestException("Dönem kilitli");
  }

  /** Set (upsert) a monthly budget for a category. */
  async setBudget(
    scope: BranchScope,
    dto: { category: string; year: number; month: number; amount: number },
  ) {
    return this.prisma.budget.upsert({
      where: {
        tenantId_branchId_category_year_month: {
          tenantId: scope.tenantId,
          branchId: scope.branchId,
          category: dto.category,
          year: dto.year,
          month: dto.month,
        },
      },
      create: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        category: dto.category,
        year: dto.year,
        month: dto.month,
        amount: new Prisma.Decimal(dto.amount),
      },
      update: { amount: new Prisma.Decimal(dto.amount) },
    });
  }

  /** Budget vs actual expenses for a month, per category, with variance. */
  async getBudgetVsActual(scope: BranchScope, year: number, month: number) {
    const budgets = await this.prisma.budget.findMany({
      where: { ...branchScope(scope), year, month },
    });
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    const actual = await this.summary(
      scope.tenantId,
      monthStart,
      monthEnd,
      scope.branchId,
    );

    const actualByCat = new Map(
      actual.byCategory.map((c) => [c.category, c.amount]),
    );
    const budgetByCat = new Map(
      budgets.map((b) => [b.category, Number(b.amount)]),
    );
    const categories = new Set([...budgetByCat.keys(), ...actualByCat.keys()]);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    let totalBudget = 0;
    let totalActual = 0;
    const rows = [...categories].map((category) => {
      const budget = budgetByCat.get(category) ?? 0;
      const actualAmt = actualByCat.get(category) ?? 0;
      totalBudget += budget;
      totalActual += actualAmt;
      return {
        category,
        budget: r2(budget),
        actual: r2(actualAmt),
        variance: r2(budget - actualAmt),
        overBudget: actualAmt > budget,
      };
    });
    rows.sort((a, b) => a.variance - b.variance); // most over-budget first

    return {
      year,
      month,
      totalBudget: r2(totalBudget),
      totalActual: r2(totalActual),
      totalVariance: r2(totalBudget - totalActual),
      byCategory: rows,
    };
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
