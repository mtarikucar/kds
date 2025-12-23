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

  /**
   * Get customer analytics report
   */
  async getCustomerAnalytics(tenantId: string, startDate?: Date, endDate?: Date) {
    const dateRange = this.getDateRange(startDate, endDate);

    // Get customer tier distribution
    const tierDistribution = await this.prisma.customer.groupBy({
      by: ['loyaltyTier'],
      where: { tenantId },
      _count: true,
    });

    // Get new customers in date range
    const newCustomersCount = await this.prisma.customer.count({
      where: {
        tenantId,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    });

    // Get returning customers (orders in date range from customers created before date range)
    const returningCustomersOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        customer: {
          createdAt: {
            lt: dateRange.start,
          },
        },
      },
      distinct: ['customerId'],
      select: {
        customerId: true,
      },
    });

    // Get total customers
    const totalCustomers = await this.prisma.customer.count({
      where: { tenantId },
    });

    // Top customers by spending
    const topCustomers = await this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { totalSpent: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        totalOrders: true,
        totalSpent: true,
        loyaltyTier: true,
        loyaltyPoints: true,
        lastVisit: true,
      },
    });

    // Average lifetime value
    const avgLTV = await this.prisma.customer.aggregate({
      where: { tenantId },
      _avg: { totalSpent: true },
    });

    // Total loyalty points issued
    const totalLoyaltyPoints = await this.prisma.customer.aggregate({
      where: { tenantId },
      _sum: { loyaltyPoints: true },
    });

    return {
      tierDistribution: tierDistribution.map((t) => ({
        tier: t.loyaltyTier,
        count: t._count,
      })),
      totalCustomers,
      newCustomers: newCustomersCount,
      returningCustomers: returningCustomersOrders.length,
      topCustomers: topCustomers.map((c) => ({
        ...c,
        totalSpent: Number(c.totalSpent),
      })),
      averageLifetimeValue: Number(avgLTV._avg.totalSpent || 0),
      totalLoyaltyPoints: totalLoyaltyPoints._sum.loyaltyPoints || 0,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  /**
   * Get inventory report
   */
  async getInventoryReport(tenantId: string) {
    // Get all tracked products
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        stockTracked: true,
      },
      include: {
        category: {
          select: { name: true },
        },
      },
      orderBy: { currentStock: 'asc' },
    });

    // Low stock threshold
    const LOW_STOCK_THRESHOLD = 10;

    // Get low stock items
    const lowStockItems = products.filter((p) => p.currentStock > 0 && p.currentStock < LOW_STOCK_THRESHOLD);

    // Get out of stock items
    const outOfStockItems = products.filter((p) => p.currentStock <= 0);

    // Calculate total stock value
    const totalStockValue = products.reduce(
      (sum, p) => sum + p.currentStock * Number(p.price),
      0,
    );

    // Get recent stock movements
    const recentMovements = await this.prisma.stockMovement.findMany({
      where: { tenantId },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      totalTrackedProducts: products.length,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      totalStockValue,
      lowStockItems: lowStockItems.map((p) => ({
        productId: p.id,
        productName: p.name,
        categoryName: p.category?.name,
        currentStock: p.currentStock,
        price: Number(p.price),
      })),
      outOfStockItems: outOfStockItems.map((p) => ({
        productId: p.id,
        productName: p.name,
        categoryName: p.category?.name,
      })),
      stockLevels: products.map((p) => ({
        productId: p.id,
        productName: p.name,
        categoryName: p.category?.name,
        currentStock: p.currentStock,
        price: Number(p.price),
        stockValue: p.currentStock * Number(p.price),
        isLowStock: p.currentStock > 0 && p.currentStock < LOW_STOCK_THRESHOLD,
        isOutOfStock: p.currentStock <= 0,
      })),
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        productName: m.product.name,
        performedBy: `${m.user.firstName} ${m.user.lastName}`,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Get staff performance report
   */
  async getStaffPerformance(tenantId: string, startDate?: Date, endDate?: Date) {
    const dateRange = this.getDateRange(startDate, endDate);

    // Get orders grouped by staff
    const staffOrders = await this.prisma.order.groupBy({
      by: ['userId'],
      where: {
        tenantId,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        userId: { not: null },
      },
      _sum: { finalAmount: true },
      _count: true,
    });

    // Fetch user details
    const userIds = staffOrders.map((s) => s.userId).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    const usersMap = new Map(users.map((u) => [u.id, u]));

    // Calculate staff performance metrics
    const staffPerformance = staffOrders
      .map((s) => {
        const user = usersMap.get(s.userId as string);
        const totalSales = Number(s._sum.finalAmount || 0);
        return {
          userId: s.userId,
          staffName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
          role: user?.role || 'Unknown',
          totalOrders: s._count,
          totalSales,
          averageOrderValue: s._count > 0 ? totalSales / s._count : 0,
        };
      })
      .sort((a, b) => b.totalSales - a.totalSales);

    // Calculate totals
    const totalOrders = staffPerformance.reduce((sum, s) => sum + s.totalOrders, 0);
    const totalSales = staffPerformance.reduce((sum, s) => sum + s.totalSales, 0);

    return {
      staffPerformance,
      summary: {
        totalStaff: staffPerformance.length,
        totalOrders,
        totalSales,
        averageOrdersPerStaff: staffPerformance.length > 0 ? totalOrders / staffPerformance.length : 0,
        averageSalesPerStaff: staffPerformance.length > 0 ? totalSales / staffPerformance.length : 0,
      },
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }
}
