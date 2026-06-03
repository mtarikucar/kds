import {
  Injectable,
  Inject,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateNotificationDto,
  NotificationType,
} from "./dto/create-notification.dto";
import { NotificationsGateway } from "./notifications.gateway";

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
  ) {}

  async create(data: {
    title: string;
    message: string;
    type: string;
    tenantId: string;
    branchId?: string;
    userId?: string;
    isGlobal?: boolean;
    priority?: string;
    data?: any;
  }) {
    // v3.0.0 — Notification is branch-scoped. If the caller did not
    // supply a branchId (system-wide / tenant-wide notifications),
    // fall back to the tenant's first active branch.
    const branchId =
      data.branchId ??
      (await this.resolveTenantFallbackBranchId(data.tenantId));
    return this.prisma.notification.create({
      data: { ...data, branchId },
    });
  }

  /**
   * v3.0.0 — Resolve the tenant's first active branch as the fallback
   * branchId for tenant-wide notifications that have no natural branch
   * context (e.g. email-verification, admin broadcasts on signup).
   *
   * Throws if the tenant has no active branch — this should be
   * impossible in v3 (tenant bootstrap guarantees one) but we surface
   * a clear error rather than letting Prisma reject with an FK violation.
   */
  private async resolveTenantFallbackBranchId(
    tenantId: string,
  ): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Tenant ${tenantId} has no active branch to scope notification to`,
      );
    }
    return branch.id;
  }

  async findAll(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { isGlobal: true }],
        // Include notifications that never expire (expiresAt is null) or haven't expired yet
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        ],
      },
      include: {
        readBy: { where: { userId } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markAsRead(notificationId: string, userId: string, tenantId: string) {
    // Authorization: the notification must belong to the caller's tenant AND
    // either be addressed to the caller or be a tenant-wide (isGlobal) one.
    // Previously the service blindly created a UserNotificationRead row for
    // any notificationId, letting a user in tenant A mark-as-read a
    // notification that belongs to tenant B (cross-tenant IDOR write).
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        tenantId,
        OR: [{ userId }, { isGlobal: true }],
      },
      select: { id: true },
    });
    if (!notification) {
      throw new NotFoundException("Notification not found");
    }
    return this.prisma.userNotificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    });
  }

  async markAllAsRead(tenantId: string, userId: string) {
    // Previously this issued an `upsert` per notification inside a single
    // $transaction — for a long-lived tenant with thousands of legacy
    // notifications that's thousands of round-trips holding one txn open
    // (and the txn lock duration scales linearly with notification count).
    // createMany + skipDuplicates collapses to one INSERT … ON CONFLICT DO
    // NOTHING. We still scope the source select to (tenantId, userId or
    // isGlobal) so we never mark cross-tenant rows as read.
    const notifications = await this.prisma.notification.findMany({
      where: { tenantId, OR: [{ userId }, { isGlobal: true }] },
      select: { id: true },
    });

    if (notifications.length === 0) return;

    await this.prisma.userNotificationRead.createMany({
      data: notifications.map((n) => ({ notificationId: n.id, userId })),
      skipDuplicates: true,
    });
  }

  /**
   * Create a notification and send it via WebSocket in real-time
   */
  async createAndSend(createNotificationDto: CreateNotificationDto) {
    // v3.0.0 — Notification.branchId is NOT NULL. Prefer the DTO-supplied
    // branchId; fall back to the tenant's first active branch for
    // system-wide notifications (email verification, etc.) where no
    // natural branch context exists at the call site.
    const branchId =
      createNotificationDto.branchId ??
      (await this.resolveTenantFallbackBranchId(
        createNotificationDto.tenantId,
      ));
    // Create notification in database
    const notification = await this.prisma.notification.create({
      data: {
        title: createNotificationDto.title,
        message: createNotificationDto.message,
        type: createNotificationDto.type,
        tenantId: createNotificationDto.tenantId,
        branchId,
        userId: createNotificationDto.userId,
        isGlobal: createNotificationDto.isGlobal || false,
        priority: createNotificationDto.priority || "NORMAL",
        data: createNotificationDto.data,
        expiresAt: createNotificationDto.expiresAt
          ? new Date(createNotificationDto.expiresAt)
          : undefined,
      },
    });

    // Send via WebSocket in real-time
    if (createNotificationDto.userId) {
      // Send to specific user
      this.notificationsGateway.sendNotificationToUser(
        createNotificationDto.userId,
        notification,
      );
    } else if (createNotificationDto.isGlobal) {
      // v3.0.0 — an isGlobal=true notification spans every branch
      // of the tenant by design (billing, marketing, system-wide).
      // Use the explicit cross-branch helper so the intent is
      // captured at the call site.
      this.notificationsGateway.broadcastToTenantAcrossBranches(
        createNotificationDto.tenantId,
        notification,
      );
    }

    return notification;
  }

  /**
   * Send notification to all ADMIN and MANAGER users in a tenant
   *
   * Previously this fanned out one `createAndSend` per admin which
   * produced N DB writes, N JSON serializations, N socket emits. With
   * 50 managers that's 50 roundtrips per reservation/customer event. We
   * now batch-insert via `createMany` (single DB write) then re-fetch
   * the rows to emit over websocket. Falls back gracefully if zero
   * admins are configured.
   */
  async notifyAdmins(
    tenantId: string,
    notificationData: {
      title: string;
      message: string;
      type: NotificationType;
      data?: any;
    },
    branchId?: string,
  ) {
    const admins = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: ["ADMIN", "MANAGER"] },
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (admins.length === 0) return [];

    // v3.0.0 — Notification.branchId is NOT NULL. notifyAdmins is a
    // tenant-wide admin fan-out (signup approval, reservation events
    // etc.); callers that have a natural branch context pass it in,
    // otherwise we default to the tenant's first active branch.
    const resolvedBranchId =
      branchId ?? (await this.resolveTenantFallbackBranchId(tenantId));

    // Generate ids client-side so the re-fetch can scope to exactly the
    // rows this call inserted. The previous re-fetch keyed on
    // (tenantId, userId IN admins, createdAt, title) — two concurrent
    // notifyAdmins calls within the same millisecond with the same
    // (tenantId, title) would pick up each other's rows, doubling the
    // WS broadcast per admin. (Notification.id is a uuid, schema-default
    // generated; we override it here so we know the value up-front.)
    const createdAt = new Date();
    const rows = admins.map((admin) => ({
      id: uuidv7(),
      title: notificationData.title,
      message: notificationData.message,
      type: notificationData.type,
      tenantId,
      branchId: resolvedBranchId,
      userId: admin.id,
      isGlobal: false,
      priority: "NORMAL",
      data: notificationData.data,
      createdAt,
    }));
    await this.prisma.notification.createMany({ data: rows });

    // Re-read so the gateway gets fully-hydrated rows with default columns.
    const notifications = await this.prisma.notification.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    for (const n of notifications) {
      this.notificationsGateway.sendNotificationToUser(n.userId!, n);
    }
    return notifications;
  }
}
