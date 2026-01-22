import { Injectable, Inject, forwardRef } from '@nestjs/common';
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

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.userNotificationRead.create({
      data: { notificationId, userId },
    });
  }

  async markAllAsRead(tenantId: string, userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { tenantId, OR: [{ userId }, { isGlobal: true }] },
      select: { id: true },
    });

    await Promise.all(
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
    // Find all ADMIN and MANAGER users in the tenant
    const admins = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: ['ADMIN', 'MANAGER'] },
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    // Create and send notification to each admin
    const notifications = await Promise.all(
      admins.map((admin) =>
        this.createAndSend({
          title: notificationData.title,
          message: notificationData.message,
          type: notificationData.type,
          tenantId,
          userId: admin.id,
          data: notificationData.data,
        }),
      ),
    );

    return notifications;
  }
}
