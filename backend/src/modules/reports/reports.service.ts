import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus } from '../../common/constants/order-status.enum';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private getDateRange(startDate?: Date, endDate?: Date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    return {
      start: startDate || today,
      end: endDate || endOfDay,
    };
  }

  async getSalesSummary(tenantId: string, startDate?: Date, endDate?: Date) {
    const dateRange = this.getDateRange(startDate, endDate);

    // Get aggregated order data
    const orderStats = await this.prisma.order.aggregate({
      where: {
        tenantId,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      _sum: {
        finalAmount: true,
      },
      _count: true,
    });

    const totalSales = Number(orderStats._sum.finalAmount || 0);
    const orderCount = orderStats._count;
    const averageOrderValue = orderCount > 0 ? totalSales / orderCount : 0;

    // Get payment method breakdown
    const paymentBreakdown = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        order: {
          tenantId,
          status: OrderStatus.PAID,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const paymentMethodBreakdown = paymentBreakdown.map((pm) => ({
      method: pm.method,
      totalAmount: Number(pm._sum.amount || 0),
      count: pm._count,
    }));

    return {
      totalSales,
      orderCount,
      averageOrderValue,
      paymentMethodBreakdown,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  async getTopProducts(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 10,
  ) {
    const dateRange = this.getDateRange(startDate, endDate);

    // Get top selling products
    const topProducts = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          tenantId,
          status: OrderStatus.PAID,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      },
      _sum: {
        quantity: true,
        subtotal: true,
      },
      orderBy: {
        _sum: {
          subtotal: 'desc',
        },
      },
      take: limit,
    });

    // Fetch product details
    const productIds = topProducts.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    // Map products with sales data
    const productsMap = new Map(products.map((p) => [p.id, p]));
    const result = topProducts.map((item) => {
      const product = productsMap.get(item.productId);
      return {
        productId: item.productId,
        productName: product?.name || 'Unknown Product',
        quantitySold: item._sum.quantity || 0,
        revenue: Number(item._sum.subtotal || 0),
        categoryName: product?.category.name,
      };
    });

    return {
      products: result,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  async getPaymentMethodBreakdown(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const dateRange = this.getDateRange(startDate, endDate);

    const paymentBreakdown = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        order: {
          tenantId,
          status: OrderStatus.PAID,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const breakdown = paymentBreakdown.map((pm) => ({
      method: pm.method,
      totalAmount: Number(pm._sum.amount || 0),
      count: pm._count,
    }));

    return {
      breakdown,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  async getOrdersByHour(tenantId: string, date?: Date) {
    const targetDate = date || new Date();
    targetDate.setHours(0, 0, 0, 0);

    const endDate = new Date(targetDate);
    endDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status: OrderStatus.PAID,
        createdAt: {
          gte: targetDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        finalAmount: true,
      },
    });

    // Group by hour
    const hourlyData = new Array(24).fill(0).map(() => ({
      orderCount: 0,
      totalSales: 0,
    }));

    orders.forEach((order) => {
      const hour = order.createdAt.getHours();
      hourlyData[hour].orderCount++;
      hourlyData[hour].totalSales += Number(order.finalAmount);
    });

    return {
      date: targetDate,
      hourlyData: hourlyData.map((data, hour) => ({
        hour,
        orderCount: data.orderCount,
        totalSales: data.totalSales,
      })),
    };
  }
}
