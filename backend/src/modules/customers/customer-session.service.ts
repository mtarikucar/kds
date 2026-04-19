import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerSessionService {
  constructor(private prisma: PrismaService) {}

  async createSession(
    tenantId: string,
    tableId?: string,
    metadata?: { userAgent?: string; ipAddress?: string },
  ) {
    const sessionId = randomBytes(32).toString('hex');
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

    return { sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  /**
   * Resolve a session token. Callers SHOULD supply `expectedTenantId` when a
   * tenant boundary is in scope (e.g. a staff controller acting on behalf of
   * a customer) so a guessed token from another tenant is rejected. For
   * pure-public flows the session's own tenantId is authoritative downstream.
   */
  async getSession(sessionId: string, expectedTenantId?: string) {
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
            loyaltyTier: true,
            totalOrders: true,
            totalSpent: true,
            phoneVerified: true,
            tenantId: true,
          },
        },
      },
    });

    if (!session) throw new UnauthorizedException('Invalid session');
    if (new Date() > session.expiresAt || !session.isActive) {
      throw new UnauthorizedException('Session expired');
    }
    if (expectedTenantId && session.tenantId !== expectedTenantId) {
      throw new UnauthorizedException('Invalid session');
    }
    if (session.customer && session.customer.tenantId !== session.tenantId) {
      // Defensive: customer linked to this session belongs to a different
      // tenant. Should never happen if linkCustomerToSession is tenant-scoped
      // (see below); treat as session invalid.
      throw new UnauthorizedException('Invalid session');
    }
    return session;
  }

  /**
   * Link a customer to a session, enforcing that the customer belongs to the
   * same tenant as the session. Updates orders referencing the session's
   * sessionId only when they also belong to the same tenant.
   */
  async linkCustomerToSession(sessionId: string, customerId: string, phone?: string) {
    const session = await this.getSession(sessionId);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer) throw new UnauthorizedException('Invalid customer for session');

    const updated = await this.prisma.customerSession.update({
      where: { sessionId },
      data: { customerId, phone },
      include: { customer: true },
    });

    await this.prisma.order.updateMany({
      where: { sessionId, tenantId: session.tenantId },
      data: { customerId },
    });

    return updated;
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

  async validateSession(sessionId: string): Promise<boolean> {
    try {
      await this.getSession(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  async requireSession(sessionId: string, expectedTenantId?: string) {
    const session = await this.getSession(sessionId, expectedTenantId);
    // Fire-and-forget; activity updates are best-effort.
    this.updateSessionActivity(sessionId).catch(() => {});
    return session;
  }

  async getActiveSessions(tenantId: string) {
    return this.prisma.customerSession.findMany({
      where: {
        tenantId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { lastActivity: 'desc' },
    });
  }

  async getSessionsByTable(tableId: string, tenantId: string) {
    return this.prisma.customerSession.findMany({
      where: {
        tableId,
        tenantId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSessionsByCustomer(customerId: string, tenantId: string) {
    return this.prisma.customerSession.findMany({
      where: { customerId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

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
                  lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
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
