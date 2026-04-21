import { Injectable, Inject, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateNotificationDto, NotificationType } from './dto/create-notification.dto';
import { NotificationsGateway } from './notifications.gateway';

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
    userId?: string;
    isGlobal?: boolean;
    priority?: string;
    data?: any;
  }) {
    return this.prisma.notification.create({ data });
  }

  async findAll(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { isGlobal: true }],
        // Include notifications that never expire (expiresAt is null) or haven't expired yet
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        ],
      },
      include: {
        readBy: { where: { userId } },
      },
      orderBy: { createdAt: 'desc' },
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
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.userNotificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    });
  }

  async markAllAsRead(tenantId: string, userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { tenantId, OR: [{ userId }, { isGlobal: true }] },
      select: { id: true },
    });

    if (notifications.length === 0) return;

    await this.prisma.$transaction(
      notifications.map((n) =>
        this.prisma.userNotificationRead.upsert({
          where: { notificationId_userId: { notificationId: n.id, userId } },
          create: { notificationId: n.id, userId },
          update: {},
        }),
      ),
    );
  }

  /**
   * Create a notification and send it via WebSocket in real-time
   */
  async createAndSend(createNotificationDto: CreateNotificationDto) {
    // Create notification in database
    const notification = await this.prisma.notification.create({
      data: {
        title: createNotificationDto.title,
        message: createNotificationDto.message,
        type: createNotificationDto.type,
        tenantId: createNotificationDto.tenantId,
        userId: createNotificationDto.userId,
        isGlobal: createNotificationDto.isGlobal || false,
        priority: createNotificationDto.priority || 'NORMAL',
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
      // Send to all users in tenant
      this.notificationsGateway.sendNotificationToTenant(
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
  ) {
    const admins = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: ['ADMIN', 'MANAGER'] },
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (admins.length === 0) return [];

    const createdAt = new Date();
    await this.prisma.notification.createMany({
      data: admins.map((admin) => ({
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type,
        tenantId,
        userId: admin.id,
        isGlobal: false,
        priority: 'NORMAL',
        data: notificationData.data,
        createdAt,
      })),
    });

    // Re-read so we have ids + schema-computed columns to ship to the UI.
    const notifications = await this.prisma.notification.findMany({
      where: {
        tenantId,
        userId: { in: admins.map((a) => a.id) },
        createdAt,
        title: notificationData.title,
      },
    });
    for (const n of notifications) {
      this.notificationsGateway.sendNotificationToUser(n.userId!, n);
    }
    return notifications;
  }
}
