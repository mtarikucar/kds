import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { UserFilterDto, UserActivityFilterDto } from "../dto/user-filter.dto";
import { SuperAdminAuditService } from "./superadmin-audit.service";
import { AuditAction, EntityType } from "../dto/audit-filter.dto";
import { UserRole } from "../../../common/constants/roles.enum";

@Injectable()
export class SuperAdminUsersService {
  private readonly logger = new Logger(SuperAdminUsersService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: SuperAdminAuditService,
  ) {}

  async findAll(filters: UserFilterDto) {
    const { search, role, tenantId, status, page = 1, limit = 20 } = filters;

    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
      ];
    }

    if (role) {
      where.role = role;
    }

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
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
          lastLogin: true,
          createdAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
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
        emailVerified: true,
        authProvider: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            subdomain: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Get user's order statistics
    const [ordersCreated, ordersTotal] = await Promise.all([
      this.prisma.order.count({
        where: { userId: id },
      }),
      this.prisma.order.aggregate({
        where: { userId: id, status: "PAID" },
        _sum: { finalAmount: true },
      }),
    ]);

    return {
      ...user,
      stats: {
        ordersCreated,
        totalRevenue: Number(ordersTotal._sum.finalAmount) || 0,
      },
    };
  }

  async setEmailVerified(
    id: string,
    emailVerified: boolean,
    actorId: string,
    actorEmail: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        tenantId: true,
        tenant: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException("User not found");

    const updated = await this.prisma.user.update({
      where: { id },
      data: { emailVerified },
      select: { id: true, email: true, emailVerified: true },
    });

    // Auditability — a super-admin flipping a tenant user's emailVerified
    // flag bypasses the email-verify gate (and the payments-intent gate
    // that depends on it), so it is a privileged mutation that must leave
    // a trail. Best-effort: a failure to record the audit row must never
    // break the support action that already succeeded, mirroring the
    // notify/outbox swallow-and-log pattern used elsewhere.
    await this.auditService
      .log({
        action: AuditAction.UPDATE,
        entityType: EntityType.USER,
        entityId: id,
        actorId,
        actorEmail,
        previousData: { emailVerified: user.emailVerified },
        newData: { emailVerified, targetEmail: user.email },
        targetTenantId: user.tenantId ?? undefined,
        targetTenantName: user.tenant?.name ?? undefined,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to write audit log for setEmailVerified user=${id}`,
          err as any,
        );
      });

    return updated;
  }

  /**
   * Support tool for fixing a User.role value without touching Postgres
   * directly. Before this endpoint existed, the only way to correct a role
   * was raw DB / Prisma Studio — that is exactly how an invalid "OWNER"
   * role got planted in production (v3.2.x incident): it bypassed every
   * application write path's `@IsEnum(UserRole)` validation. The DTO here
   * makes an invalid role a 400, never a DB write.
   */
  async updateRole(
    id: string,
    newRole: UserRole,
    actorId: string,
    actorEmail: string,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        tenantId: true,
        tenant: { select: { name: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException("User not found");
    }

    // No-op: same role requested (also covers the case where an operator
    // re-submits after a prior successful fix). Skip the write, tokenVersion
    // bump, and audit rows entirely — nothing changed.
    if (newRole === existing.role) {
      return {
        id: existing.id,
        email: existing.email,
        role: existing.role,
        tenantId: existing.tenantId,
      };
    }

    // Last-admin protection — mirrors UsersService.update's role-change
    // guard (backend/src/modules/users/users.service.ts): a tenant must
    // never be left with zero ACTIVE ADMIN users, or every admin-only
    // action (including fixing roles) becomes unreachable for that tenant.
    if (
      existing.role === UserRole.ADMIN &&
      newRole !== UserRole.ADMIN &&
      existing.status === "ACTIVE"
    ) {
      const otherAdmins = await this.prisma.user.count({
        where: {
          tenantId: existing.tenantId,
          role: UserRole.ADMIN,
          status: "ACTIVE",
          NOT: { id: existing.id },
        },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          "Cannot demote the last active admin of this restaurant",
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: existing.id },
        data: {
          role: newRole,
          // Bump tokenVersion so any outstanding access/refresh token —
          // including one still carrying the OLD/invalid role — is
          // rejected by JwtStrategy's revocation check, forcing a clean
          // re-auth that picks up the corrected role fresh from the DB.
          // Mirrors the credential-rotation bump in UsersService.update
          // and the privilege-transition bump in
          // SuperAdminTenantsService.updateStatus.
          tokenVersion: { increment: 1 },
        },
        select: { id: true, email: true, role: true, tenantId: true },
      });

      await tx.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Tenant-facing audit trail — same event name/shape as
      // UsersService.update's role-change record (grep ROLE_CHANGED), now
      // also reachable from this cross-tenant support tool.
      await tx.userActivity.create({
        data: {
          userId: existing.id,
          tenantId: existing.tenantId,
          action: "ROLE_CHANGED",
          metadata: {
            by: actorId,
            from: existing.role,
            to: newRole,
          },
        },
      });

      return next;
    });

    // Superadmin-side audit log — best-effort, mirrors setEmailVerified: a
    // failure to record it must never break the support action that
    // already committed.
    await this.auditService
      .log({
        action: AuditAction.UPDATE,
        entityType: EntityType.USER,
        entityId: existing.id,
        actorId,
        actorEmail,
        previousData: { role: existing.role },
        newData: { role: newRole, targetEmail: existing.email },
        targetTenantId: existing.tenantId ?? undefined,
        targetTenantName: existing.tenant?.name ?? undefined,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to write audit log for updateRole user=${existing.id}`,
          err as any,
        );
      });

    return updated;
  }

  async getActivity(filters: UserActivityFilterDto) {
    const { userId, tenantId, action, page = 1, limit = 50 } = filters;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (action) {
      where.action = action;
    }

    const [activities, total] = await Promise.all([
      this.prisma.userActivity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.userActivity.count({ where }),
    ]);

    // Get user and tenant info for the activities
    const userIds = [...new Set(activities.map((a) => a.userId))];
    const tenantIds = [...new Set(activities.map((a) => a.tenantId))];

    const [users, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
      this.prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const tenantMap = new Map(tenants.map((t) => [t.id, t]));

    const enrichedActivities = activities.map((activity) => ({
      ...activity,
      user: userMap.get(activity.userId),
      tenant: tenantMap.get(activity.tenantId),
    }));

    return {
      data: enrichedActivities,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async logActivity(
    userId: string,
    tenantId: string,
    action: string,
    ip?: string,
    userAgent?: string,
    metadata?: any,
  ) {
    return this.prisma.userActivity.create({
      data: {
        userId,
        tenantId,
        action,
        ip,
        userAgent,
        metadata,
      },
    });
  }
}
