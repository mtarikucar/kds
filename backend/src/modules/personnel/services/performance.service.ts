import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PerformanceQueryDto } from '../dto/performance-query.dto';

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  async getEnhancedMetrics(tenantId: string, query: PerformanceQueryDto) {
    const now = new Date();
    const startDate = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = query.endDate ? new Date(query.endDate) : now;

    const where: any = {
      tenantId,
      createdAt: { gte: startDate, lte: endDate },
      status: { in: ['READY', 'SERVED', 'PAID'] },
    };
    if (query.userId) where.userId = query.userId;

    // Get orders grouped by user
    const orders = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        userId: true,
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        finalAmount: true,
        createdAt: true,
        updatedAt: true,
        status: true,
      },
    });

    // Get attendance data for the same period
    const attendances = await this.prisma.attendance.findMany({
      where: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        status: 'CLOCKED_OUT',
        ...(query.userId ? { userId: query.userId } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    // Build attendance hours map and user info map
    const hoursMap = new Map<string, number>();
    const attendanceUserMap = new Map<string, { id: string; firstName: string; lastName: string; role: string }>();
    for (const a of attendances) {
      const current = hoursMap.get(a.userId) || 0;
      hoursMap.set(a.userId, current + a.totalWorkedMinutes / 60);
      if (!attendanceUserMap.has(a.userId)) {
        attendanceUserMap.set(a.userId, a.user);
      }
    }

    // Group orders by user
    const userOrders = new Map<string, any[]>();
    for (const order of orders) {
      if (!order.userId) continue;
      if (!userOrders.has(order.userId)) {
        userOrders.set(order.userId, []);
      }
      userOrders.get(order.userId)!.push(order);
    }

    // Calculate metrics per user
    const metrics = [];
    const allUsers = new Set([...userOrders.keys(), ...hoursMap.keys()]);

    for (const userId of allUsers) {
      const userOrdersList = userOrders.get(userId) || [];
      const totalOrders = userOrdersList.length;
      const totalSales = userOrdersList.reduce(
        (sum, o) => sum + Number(o.finalAmount || 0),
        0,
      );
      const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

      // Average prep time (diff between updatedAt and createdAt in minutes)
      let avgPrepTime = 0;
      if (totalOrders > 0) {
        const totalPrepTime = userOrdersList.reduce((sum, o) => {
          const diff = new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime();
          return sum + diff / 60000;
        }, 0);
        avgPrepTime = totalPrepTime / totalOrders;
      }

      const totalHours = hoursMap.get(userId) || 0;
      const ordersPerHour = totalHours > 0 ? totalOrders / totalHours : 0;

      // Performance score: 40% speed + 30% volume + 30% revenue
      // Normalized against reasonable targets
      const speedScore = Math.min(100, avgPrepTime > 0 ? (15 / avgPrepTime) * 100 : 0);
      const volumeScore = Math.min(100, ordersPerHour * 10);
      const revenueScore = Math.min(100, (totalSales / Math.max(1, totalOrders)) / 2);

      const performanceScore = Math.round(
        speedScore * 0.4 + volumeScore * 0.3 + revenueScore * 0.3,
      );

      const user = userOrdersList[0]?.user || attendanceUserMap.get(userId) || { id: userId, firstName: 'Unknown', lastName: '', role: '' };

      metrics.push({
        user,
        totalOrders,
        totalSales: Math.round(totalSales * 100) / 100,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        avgPrepTime: Math.round(avgPrepTime * 10) / 10,
        totalHours: Math.round(totalHours * 10) / 10,
        ordersPerHour: Math.round(ordersPerHour * 10) / 10,
        performanceScore,
      });
    }

    return metrics.sort((a, b) => b.performanceScore - a.performanceScore);
  }

  async getTrends(tenantId: string, query: PerformanceQueryDto) {
    const now = new Date();
    const months = 6;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Build all month ranges
    const monthRanges = Array.from({ length: months }, (_, idx) => {
      const i = months - 1 - idx;
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      return { monthStart, monthEnd };
    });

    // Run all queries in parallel
    const results = await Promise.all(
      monthRanges.map(async ({ monthStart, monthEnd }) => {
        const orderWhere: any = {
          tenantId,
          createdAt: { gte: monthStart, lte: monthEnd },
          status: { in: ['READY', 'SERVED', 'PAID'] },
        };
        if (query.userId) orderWhere.userId = query.userId;

        const attendanceWhere: any = {
          tenantId,
          date: { gte: monthStart, lte: monthEnd },
          status: 'CLOCKED_OUT',
        };
        if (query.userId) attendanceWhere.userId = query.userId;

        const [orderCount, orderAgg, attendanceAgg] = await Promise.all([
          this.prisma.order.count({ where: orderWhere }),
          this.prisma.order.aggregate({
            where: orderWhere,
            _sum: { finalAmount: true },
            _avg: { finalAmount: true },
          }),
          this.prisma.attendance.aggregate({
            where: attendanceWhere,
            _sum: { totalWorkedMinutes: true },
          }),
        ]);

        const totalHours = (attendanceAgg._sum.totalWorkedMinutes || 0) / 60;

        return {
          month: monthStart.toISOString().substring(0, 7),
          label: `${monthNames[monthStart.getMonth()]} ${monthStart.getFullYear()}`,
          totalOrders: orderCount,
          totalSales: Number(orderAgg._sum.finalAmount || 0),
          avgOrderValue: Number(orderAgg._avg.finalAmount || 0),
          totalHours: Math.round(totalHours * 10) / 10,
          ordersPerHour: totalHours > 0 ? Math.round((orderCount / totalHours) * 10) / 10 : 0,
        };
      }),
    );

    return results;
  }
}
