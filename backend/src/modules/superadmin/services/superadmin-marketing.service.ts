import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  generateReferralCode,
  generateFallbackReferralCode,
} from "../../marketing/utils/referral-code";

const REFERRAL_CODE_MAX_ATTEMPTS = 5;

export interface SuperAdminMarketerFilter {
  search?: string;
  role?: "SALES_MANAGER" | "SALES_REP";
  status?: "ACTIVE" | "INACTIVE";
  page?: number;
  limit?: number;
}

export interface SuperAdminCommissionFilter {
  type?: "SIGNUP" | "RENEWAL" | "UPSELL";
  status?: "PENDING" | "APPROVED" | "PAID";
  marketingUserId?: string;
  tenantId?: string;
  period?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class SuperAdminMarketingService {
  private readonly logger = new Logger(SuperAdminMarketingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Step-F decoupling: the Commission→Tenant FK was dropped, so we can no longer
   * `include: { tenant }`. SuperAdmin is a core-admin tool and may read Tenant
   * directly, so we batch-load tenants by the soft `tenantId` reference and
   * attach them — preserving the `.tenant` shape callers/CSV expect.
   */
  private async attachTenants<T extends { tenantId: string | null }>(
    rows: T[],
  ): Promise<
    (T & { tenant: { id: string; name: string; subdomain: string } | null })[]
  > {
    const ids = [
      ...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x)),
    ];
    const tenants = ids.length
      ? await this.prisma.tenant.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, subdomain: true },
        })
      : [];
    const byId = new Map(tenants.map((t) => [t.id, t]));
    return rows.map((r) => ({
      ...r,
      tenant: r.tenantId ? (byId.get(r.tenantId) ?? null) : null,
    }));
  }

  // ---------- Marketers ----------

  // Platform-wide marketer list with lifetime aggregates. We do the
  // counts as a single groupBy per dimension instead of N+1 selects,
  // and merge in JS — the marketer-count is small (dozens, not
  // thousands) so this is cheap.
  async listMarketers(filter: SuperAdminMarketerFilter) {
    const { search, role, status, page = 1, limit = 20 } = filter;
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { referralCode: { equals: search.toUpperCase() } },
      ];
    }
    if (role) where.role = role;
    if (status) where.status = status;

    const [rows, total] = await Promise.all([
      this.prisma.marketingUser.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          phone: true,
          referralCode: true,
          referralCodeUpdatedAt: true,
          lastLogin: true,
          createdAt: true,
        },
      }),
      this.prisma.marketingUser.count({ where }),
    ]);

    if (rows.length === 0) {
      return {
        data: [],
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    const ids = rows.map((r) => r.id);

    const [leadCounts, wonCounts, commissionSums] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ["assignedToId"],
        where: { assignedToId: { in: ids } },
        _count: { id: true },
      }),
      this.prisma.lead.groupBy({
        by: ["assignedToId"],
        where: { assignedToId: { in: ids }, status: "WON" },
        _count: { id: true },
      }),
      this.prisma.commission.groupBy({
        by: ["marketingUserId"],
        where: { marketingUserId: { in: ids } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const leadMap = new Map(
      leadCounts.map((c) => [c.assignedToId, c._count.id]),
    );
    const wonMap = new Map(wonCounts.map((c) => [c.assignedToId, c._count.id]));
    const commissionMap = new Map(
      commissionSums.map((c) => [
        c.marketingUserId,
        { sum: c._sum.amount ?? 0, count: c._count },
      ]),
    );

    const data = rows.map((row) => ({
      ...row,
      totalLeads: leadMap.get(row.id) ?? 0,
      wonLeads: wonMap.get(row.id) ?? 0,
      lifetimeCommissionAmount: commissionMap.get(row.id)?.sum ?? 0,
      lifetimeCommissionCount: commissionMap.get(row.id)?.count ?? 0,
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getMarketer(id: string) {
    const marketer = await this.prisma.marketingUser.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        phone: true,
        avatar: true,
        referralCode: true,
        referralCodeUpdatedAt: true,
        lastLogin: true,
        createdAt: true,
        _count: {
          select: {
            leads: true,
            activities: true,
            commissions: true,
            tasks: true,
          },
        },
      },
    });
    if (!marketer) throw new NotFoundException("Marketer not found");

    const [recentLeads, recentCommissions, commissionAggregate] =
      await Promise.all([
        this.prisma.lead.findMany({
          where: { assignedToId: id },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            businessName: true,
            status: true,
            source: true,
            convertedAt: true,
            createdAt: true,
          },
        }),
        this.prisma.commission.findMany({
          where: { marketingUserId: id },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        this.prisma.commission.groupBy({
          by: ["status"],
          where: { marketingUserId: id },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

    return {
      ...marketer,
      recentLeads,
      recentCommissions: await this.attachTenants(recentCommissions),
      commissionTotals: commissionAggregate.reduce(
        (acc, row) => {
          acc[row.status] = {
            amount: row._sum.amount ?? 0,
            count: row._count,
          };
          return acc;
        },
        {} as Record<string, { amount: any; count: number }>,
      ),
    };
  }

  async updateMarketerStatus(id: string, status: "ACTIVE" | "INACTIVE") {
    const marketer = await this.prisma.marketingUser.findUnique({
      where: { id },
    });
    if (!marketer) throw new NotFoundException("Marketer not found");
    return this.prisma.marketingUser.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        status: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });
  }

  // Mirror of MarketingUsersService.regenerateReferralCode, but owned
  // by the platform so support can rotate a marketer's code without
  // going through the marketer's own session. Logs the actor for ops
  // visibility.
  async regenerateReferralCode(id: string, actorEmail: string) {
    const marketer = await this.prisma.marketingUser.findUnique({
      where: { id },
      select: { id: true, firstName: true, email: true, referralCode: true },
    });
    if (!marketer) throw new NotFoundException("Marketer not found");

    for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt++) {
      const candidate = generateReferralCode(marketer.firstName);
      try {
        const updated = await this.prisma.marketingUser.update({
          where: { id },
          data: {
            referralCode: candidate,
            referralCodeUpdatedAt: new Date(),
          },
          select: {
            id: true,
            referralCode: true,
            referralCodeUpdatedAt: true,
          },
        });
        this.logger.log(
          `SuperAdmin ${actorEmail} rotated referral code for marketer=${marketer.email}: ${marketer.referralCode ?? "∅"} → ${updated.referralCode}`,
        );
        return updated;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        throw err;
      }
    }

    const updated = await this.prisma.marketingUser.update({
      where: { id },
      data: {
        referralCode: generateFallbackReferralCode(),
        referralCodeUpdatedAt: new Date(),
      },
      select: { id: true, referralCode: true, referralCodeUpdatedAt: true },
    });
    this.logger.warn(
      `SuperAdmin ${actorEmail} rotated referral code for marketer=${marketer.email} via fallback to ${updated.referralCode}`,
    );
    return updated;
  }

  // ---------- Commissions ----------

  async listCommissions(filter: SuperAdminCommissionFilter) {
    const {
      type,
      status,
      marketingUserId,
      tenantId,
      period,
      page = 1,
      limit = 20,
    } = filter;
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (marketingUserId) where.marketingUserId = marketingUserId;
    if (tenantId) where.tenantId = tenantId;
    if (period) where.period = period;

    const [rows, total, summary] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          marketingUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              referralCode: true,
            },
          },
          lead: { select: { id: true, businessName: true, source: true } },
        },
      }),
      this.prisma.commission.count({ where }),
      this.prisma.commission.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      data: await this.attachTenants(rows),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      summary: {
        totalAmount: summary._sum.amount ?? 0,
        totalCount: summary._count,
      },
    };
  }

  // SuperAdmin bulk-approve. Mirrors the per-row semantics of
  // marketing-commissions.service.approve (PENDING + non-zero amount
  // required), but records actorType='SUPERADMIN' in the audit log so
  // a downstream reader can tell who fired the action even though the
  // actorId points at a different table.
  async bulkApproveCommissions(
    ids: string[],
    actorId: string,
    actorEmail: string,
  ) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException("No commission ids provided");
    }
    if (ids.length > 200) {
      throw new BadRequestException(
        "Cannot approve more than 200 commissions at once",
      );
    }

    const rows = await this.prisma.commission.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, amount: true, auditLog: true },
    });

    const approved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const now = new Date();

    for (const row of rows) {
      if (row.status !== "PENDING") {
        skipped.push({ id: row.id, reason: `status=${row.status}` });
        continue;
      }
      if (Number(row.amount) === 0) {
        skipped.push({ id: row.id, reason: "zero amount" });
        continue;
      }
      const existing = Array.isArray(row.auditLog) ? row.auditLog : [];
      const auditLog = [
        ...existing,
        {
          at: now.toISOString(),
          actorId,
          actorType: "SUPERADMIN",
          actorEmail,
          action: "approve",
          prevStatus: "PENDING",
          nextStatus: "APPROVED",
        },
      ];
      try {
        await this.prisma.commission.update({
          where: { id: row.id },
          data: {
            status: "APPROVED",
            approvedAt: now,
            // approvedById intentionally null — the column expects a
            // MarketingUser id and this actor is a SuperAdmin. The
            // auditLog entry carries the actorEmail for traceability.
            auditLog: auditLog as unknown as Prisma.InputJsonValue,
          },
        });
        approved.push(row.id);
      } catch (err) {
        this.logger.error(
          `Bulk approve failed for commission=${row.id}: ${(err as Error).message}`,
        );
        skipped.push({ id: row.id, reason: (err as Error).message });
      }
    }

    this.logger.log(
      `SuperAdmin ${actorEmail} bulk-approved ${approved.length} commissions (skipped ${skipped.length})`,
    );

    return {
      approvedCount: approved.length,
      skippedCount: skipped.length,
      approved,
      skipped,
    };
  }

  // Emits a flat CSV for the same filter the list endpoint accepts.
  // Streaming back as a single string keeps the controller simple;
  // commission volume per platform-week is bounded (low thousands at
  // most) so loading them all in memory is fine.
  async exportCommissionsCsv(
    filter: SuperAdminCommissionFilter,
  ): Promise<string> {
    const { type, status, marketingUserId, tenantId, period } = filter;
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (marketingUserId) where.marketingUserId = marketingUserId;
    if (tenantId) where.tenantId = tenantId;
    if (period) where.period = period;

    const rows = await this.prisma.commission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        marketingUser: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            referralCode: true,
          },
        },
        lead: { select: { businessName: true, source: true } },
      },
    });

    const header = [
      "createdAt",
      "period",
      "type",
      "status",
      "amount",
      "marketerEmail",
      "marketerName",
      "referralCode",
      "tenantName",
      "tenantSubdomain",
      "leadBusiness",
      "leadSource",
      "approvedAt",
      "paidAt",
    ].join(",");

    const body = (await this.attachTenants(rows))
      .map((r) => {
        const marketerName = r.marketingUser
          ? `${r.marketingUser.firstName} ${r.marketingUser.lastName}`
          : "";
        return [
          r.createdAt.toISOString(),
          r.period,
          r.type,
          r.status,
          String(r.amount),
          r.marketingUser?.email ?? "",
          marketerName,
          r.marketingUser?.referralCode ?? "",
          r.tenant?.name ?? "",
          r.tenant?.subdomain ?? "",
          r.lead?.businessName ?? "",
          r.lead?.source ?? "",
          r.approvedAt?.toISOString() ?? "",
          r.paidAt?.toISOString() ?? "",
        ]
          .map(csvEscape)
          .join(",");
      })
      .join("\n");

    return `${header}\n${body}\n`;
  }
}

// RFC-4180-ish escape: quote a field if it contains a comma, quote,
// CR, or LF; double any embedded quotes. Plain ascii strings pass
// through untouched so the CSV stays readable.
function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[,"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
