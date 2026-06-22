import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomBytes } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";

@Injectable()
export class CustomerSessionService {
  private readonly logger = new Logger(CustomerSessionService.name);

  /**
   * Iter-77 — listing cap on getActiveSessions. The endpoint returns
   * each session's linked customer.phone (PII), and an admin UI on a
   * busy tenant (event night, 500+ concurrent QR-menu sessions) would
   * otherwise pull every active session in one response. 200 covers
   * realistic dashboard use; longer listings need pagination.
   */
  private static readonly ACTIVE_SESSIONS_HARD_CAP = 200;

  /**
   * Iter-77 — retention window for deleted sessions. Sessions older
   * than this (by `lastActivity`) get hard-deleted by the cron sweep.
   * 30 days is comfortably past the 4-hour TTL + 24-hour idle
   * deactivation window the existing cleanup logic uses, but bounded
   * enough that the table doesn't grow unboundedly across the lifetime
   * of the tenant. Order.sessionId is a free-form string (not a
   * relation), so deleting old session rows can't cascade into order
   * loss — Order rows simply hold the historical session id forever.
   */
  private static readonly SESSION_DELETE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  async createSession(
    tenantId: string,
    tableId?: string,
    metadata?: { userAgent?: string; ipAddress?: string },
  ) {
    // Iter-79: createSession is @Public-reachable via
    // CustomerPublicController. Without existence checks an attacker
    // rotating IPs could pump sessions for non-existent or guessed
    // tenant UUIDs and table UUIDs — each row carries IP + userAgent
    // + 4h TTL + 30-day retention, so a single 20-req/min throttle
    // slot becomes ~840k garbage rows in a month. Verify the tenant
    // exists, and if tableId is given verify it actually belongs to
    // the claimed tenant (a spoofed tableId from a DIFFERENT tenant
    // would otherwise persist a logically inconsistent link).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new UnauthorizedException("Invalid tenant");
    }
    if (tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: tableId, tenantId },
        select: { id: true },
      });
      if (!table) {
        throw new UnauthorizedException("Invalid table for this tenant");
      }
    }

    const sessionId = randomBytes(32).toString("hex");
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
   * Mint a backing CustomerSession for a Partner Display ScreenSession. Same
   * 64-hex sessionId shape as createSession (so every customer-orders /
   * self-pay / qr-menu path treats it identically), but the TTL is
   * screen-controlled (the ScreenSession's refresh window) rather than the 4h
   * default, and existence checks still apply. Returns the same minimal shape.
   */
  async createForScreen(
    tenantId: string,
    tableId: string | undefined,
    ttlMs: number,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new UnauthorizedException("Invalid tenant");
    if (tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: tableId, tenantId },
        select: { id: true },
      });
      if (!table) throw new UnauthorizedException("Invalid table for this tenant");
    }

    const sessionId = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlMs);
    const session = await this.prisma.customerSession.create({
      data: { sessionId, tenantId, tableId, expiresAt, isActive: true },
    });
    return { sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  /**
   * Push a backing session's expiry forward (called when a screen token is
   * refreshed) so a long-lived screen's ordering identity never lapses
   * mid-shift. No-op if the session is already inactive/gone.
   */
  async extendSession(sessionId: string, expiresAt: Date): Promise<void> {
    await this.prisma.customerSession.updateMany({
      where: { sessionId, isActive: true },
      data: { expiresAt },
    });
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

    if (!session) throw new UnauthorizedException("Invalid session");
    if (new Date() > session.expiresAt || !session.isActive) {
      throw new UnauthorizedException("Session expired");
    }
    if (expectedTenantId && session.tenantId !== expectedTenantId) {
      throw new UnauthorizedException("Invalid session");
    }
    if (session.customer && session.customer.tenantId !== session.tenantId) {
      // Defensive: customer linked to this session belongs to a different
      // tenant. Should never happen if linkCustomerToSession is tenant-scoped
      // (see below); treat as session invalid.
      throw new UnauthorizedException("Invalid session");
    }
    return session;
  }

  /**
   * Link a customer to a session, enforcing that the customer belongs to the
   * same tenant as the session. Updates orders referencing the session's
   * sessionId only when they also belong to the same tenant.
   */
  async linkCustomerToSession(
    sessionId: string,
    customerId: string,
    phone?: string,
  ) {
    const session = await this.getSession(sessionId);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer)
      throw new UnauthorizedException("Invalid customer for session");

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
      orderBy: { lastActivity: "desc" },
      take: CustomerSessionService.ACTIVE_SESSIONS_HARD_CAP,
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
      orderBy: { createdAt: "desc" },
    });
  }

  async getSessionsByCustomer(customerId: string, tenantId: string) {
    return this.prisma.customerSession.findMany({
      where: { customerId, tenantId },
      orderBy: { createdAt: "desc" },
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

  /**
   * Iter-77 — hard-delete old inactive sessions. Pre-iter-77 the only
   * cleanup was `cleanupExpiredSessions` which flipped isActive=false
   * but kept the row, and even that method had NO scheduled caller. So
   * customer_sessions grew unboundedly across the lifetime of the tenant
   * — each QR-menu scan, each table-side checkout creates a row that
   * never gets reaped. For a popular restaurant doing 200 sessions/day
   * over 3 years that's ~200K rows of useless history, all carrying
   * IP + userAgent metadata.
   *
   * The retention window is 30 days past `lastActivity`, comfortably
   * past the 4h TTL and the 24h idle-deactivation rule above. Order
   * rows hold sessionId as a free-form string (no FK), so deleting
   * historical session rows doesn't cascade.
   */
  async deleteOldSessions(): Promise<number> {
    const cutoff = new Date(
      Date.now() - CustomerSessionService.SESSION_DELETE_AFTER_MS,
    );
    const result = await this.prisma.customerSession.deleteMany({
      where: {
        isActive: false,
        lastActivity: { lt: cutoff },
      },
    });
    return result.count;
  }

  /**
   * Scheduled sweep. Runs every hour, advisory-locked so multiple
   * replicas don't fan out the same updateMany/deleteMany pair (each
   * would issue a write storm against the same row set).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepSessions(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "customer-sessions.sweep",
      async () => {
        const deactivated = await this.cleanupExpiredSessions();
        const deleted = await this.deleteOldSessions();
        if (deactivated > 0 || deleted > 0) {
          this.logger.log(
            `customer-session sweep: deactivated=${deactivated} hard-deleted=${deleted}`,
          );
        }
      },
      this.logger,
    );
  }
}
