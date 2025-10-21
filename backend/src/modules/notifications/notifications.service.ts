import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

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
        expiresAt: { gt: new Date() },
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
}
