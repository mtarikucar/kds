import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class CustomerSessionService {
  constructor(private prisma: PrismaService) {}

  // ========================================
  // SESSION MANAGEMENT
  // ========================================

  async createSession(tenantId: string, tableId?: string, metadata?: { userAgent?: string; ipAddress?: string }) {
    // Generate cryptographically secure session ID
    const sessionId = randomBytes(32).toString('hex');

    // Sessions expire after 4 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 4);

    const session = await this.prisma.customerSession.create({
      data: {
        sessionId,
        tenantId,
        tableId,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt,
        isActive: true,
      },
    });

    return {
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    };
  }

  async getSession(sessionId: string) {
    const session = await this.prisma.customerSession.findUnique({
      where: { sessionId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            loyaltyPoints: true,
            totalOrders: true,
            totalSpent: true,
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    // Check if session is expired
    if (new Date() > session.expiresAt || !session.isActive) {
      throw new UnauthorizedException('Session expired');
    }

    return session;
  }

  async linkCustomerToSession(sessionId: string, customerId: string, phone?: string) {
    const session = await this.getSession(sessionId);

    // Update session with customer information
    const updatedSession = await this.prisma.customerSession.update({
      where: { sessionId },
      data: {
        customerId,
        phone,
      },
      include: {
        customer: true,
      },
    });

    // Update existing orders with this sessionId to link to customer
    await this.prisma.order.updateMany({
      where: { sessionId },
      data: { customerId },
    });

    return updatedSession;
  }

  async updateSessionActivity(sessionId: string) {
    return this.prisma.customerSession.update({
      where: { sessionId },
      data: { lastActivity: new Date() },
    });
  }

  async deactivateSession(sessionId: string) {
    return this.prisma.customerSession.update({
      where: { sessionId },
      data: { isActive: false },
    });
  }

  // ========================================
  // SESSION VALIDATION
  // ========================================

  async validateSession(sessionId: string): Promise<boolean> {
    try {
      await this.getSession(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  async requireSession(sessionId: string) {
    const session = await this.getSession(sessionId);
    await this.updateSessionActivity(sessionId);
    return session;
  }

  // ========================================
  // SESSION QUERIES
  // ========================================

  async getActiveSessions(tenantId: string) {
    return this.prisma.customerSession.findMany({
      where: {
        tenantId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
      orderBy: { lastActivity: 'desc' },
    });
  }

  async getSessionsByTable(tableId: string) {
    return this.prisma.customerSession.findMany({
      where: {
        tableId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSessionsByCustomer(customerId: string) {
    return this.prisma.customerSession.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  // ========================================
  // CLEANUP
  // ========================================

  async cleanupExpiredSessions() {
    const result = await this.prisma.customerSession.updateMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            AND: [
              { isActive: true },
              {
                lastActivity: {
                  lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours inactive
                },
              },
            ],
          },
        ],
      },
      data: { isActive: false },
    });

    return result.count;
  }
}
