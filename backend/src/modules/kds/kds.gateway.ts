import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Single realtime bus for kitchen, POS, personnel and customer events.
 *
 * Room layout (per tenantId):
 * - kitchen-${tenantId}   — KITCHEN, ADMIN, MANAGER
 * - pos-${tenantId}       — WAITER, COURIER, ADMIN, MANAGER
 * - personnel-${tenantId} — ADMIN, MANAGER (attendance / swap requests)
 * - customer-session-${sessionId} — one customer per room
 *
 * Staff sockets must present a `type: 'user'` main-app JWT (HS256). Marketing
 * and superadmin tokens are deliberately rejected by the type check, matching
 * JwtStrategy's policy. Customer sockets present a session id bound to a live
 * CustomerSession row. The two auth flows are mutually exclusive — a staff
 * socket never joins customer rooms and vice versa.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:5173'],
    credentials: true,
  },
  namespace: '/kds',
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(KdsGateway.name);

  // In-memory last-activity cache to debounce writes to CustomerSession on
  // reconnect storms. Keyed by sessionId → epoch millis. A single-replica
  // optimization; acceptable to reset on restart.
  private readonly customerActivityLastWrite = new Map<string, number>();
  private static readonly ACTIVITY_DEBOUNCE_MS = 60_000;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];
      const sessionId =
        client.handshake.auth.sessionId || client.handshake.query.sessionId;

      if (token) {
        const authed = await this.tryStaffAuth(client, token);
        if (authed) return;
        // fall through — staff auth failed, customer session may still be valid
      }

      if (sessionId) {
        const authed = await this.tryCustomerAuth(client, String(sessionId));
        if (authed) return;
      }

      this.logger.warn(`Client ${client.id} rejected: no valid authentication`);
      client.disconnect();
    } catch (error: any) {
      this.logger.warn(`Client ${client.id} authentication error: ${error.message}`);
      client.disconnect();
    }
  }

  private async tryStaffAuth(client: Socket, token: string): Promise<boolean> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, { algorithms: ['HS256'] });
    } catch (err: any) {
      this.logger.warn(`Staff JWT verify failed for ${client.id}: ${err.message}`);
      return false;
    }

    // Reject non-main-app tokens. Marketing + superadmin realms sign tokens
    // with type='marketing' / 'superadmin' against the shared secret; without
    // this check they would silently authenticate into the tenant realtime
    // stream. JwtStrategy applies the same policy for HTTP (jwt.strategy.ts).
    if (payload.type && payload.type !== 'user') {
      this.logger.warn(
        `Staff JWT rejected for ${client.id}: unsupported token type '${payload.type}'`,
      );
      return false;
    }

    const tenantId = payload.tenantId;
    const role = payload.role as UserRole | undefined;
    if (!tenantId || !role) {
      this.logger.warn(`Staff JWT rejected for ${client.id}: missing tenantId/role`);
      return false;
    }

    client.data.userId = payload.sub;
    client.data.tenantId = tenantId;
    client.data.role = role;
    client.data.userType = 'staff';

    // Role-based room membership — sockets receive only the events relevant
    // to their role instead of every kitchen + POS event regardless of job.
    const isKitchenRole = role === UserRole.KITCHEN;
    const isPosRole = role === UserRole.WAITER || role === UserRole.COURIER;
    const isManagerRole = role === UserRole.ADMIN || role === UserRole.MANAGER;

    if (isKitchenRole || isManagerRole) {
      client.join(`kitchen-${tenantId}`);
    }
    if (isPosRole || isManagerRole) {
      client.join(`pos-${tenantId}`);
    }
    if (isManagerRole) {
      client.join(`personnel-${tenantId}`);
    }

    this.logger.log(
      `Staff ${client.id} connected (user=${payload.sub}, role=${role}, tenant=${tenantId})`,
    );
    return true;
  }

  private async tryCustomerAuth(client: Socket, sessionId: string): Promise<boolean> {
    const session = await this.prisma.customerSession.findUnique({
      where: { sessionId },
      select: {
        sessionId: true,
        tenantId: true,
        customerId: true,
        isActive: true,
        expiresAt: true,
      },
    });

    if (!session) {
      this.logger.warn(`Customer session rejected for ${client.id}: not found`);
      return false;
    }
    if (!session.isActive || new Date() > session.expiresAt) {
      this.logger.warn(`Customer session rejected for ${client.id}: expired/inactive`);
      return false;
    }

    client.data.sessionId = session.sessionId;
    client.data.tenantId = session.tenantId;
    client.data.customerId = session.customerId;
    client.data.userType = 'customer';

    client.join(`customer-session-${session.sessionId}`);

    // Debounce lastActivity writes: a flaky mobile network reconnecting every
    // few seconds would otherwise hammer the DB. At most one write per minute
    // per session (in-process; acceptable staleness for presence tracking).
    const now = Date.now();
    const lastWrite = this.customerActivityLastWrite.get(session.sessionId) ?? 0;
    if (now - lastWrite > KdsGateway.ACTIVITY_DEBOUNCE_MS) {
      this.customerActivityLastWrite.set(session.sessionId, now);
      this.prisma.customerSession
        .update({
          where: { sessionId: session.sessionId },
          data: { lastActivity: new Date() },
        })
        .catch((err) =>
          this.logger.warn(
            `customerSession.lastActivity update failed (${session.sessionId}): ${err.message}`,
          ),
        );
    }

    this.logger.log(
      `Customer ${client.id} connected (session=${session.sessionId}, customer=${session.customerId ?? 'anonymous'})`,
    );
    return true;
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  // NOTE: `join-kitchen` / `join-pos` inbound handlers were removed. Room
  // membership is fully determined at connect time based on the JWT role so
  // that a customer-session socket cannot elevate into staff rooms by emitting
  // a bare message.

  // ========================================
  // ORDER EVENTS
  // ========================================

  private toOrderEvent(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      table: order.table,
      userId: order.userId,
      user: order.user,
      sessionId: order.sessionId,
      customerPhone: order.customerPhone,
      type: order.type,
      customerName: order.customerName,
      status: order.status,
      requiresApproval: order.requiresApproval,
      totalAmount: order.totalAmount,
      discount: order.discount,
      finalAmount: order.finalAmount,
      notes: order.notes,
      orderItems: order.orderItems,
      payments: order.payments || [],
      approvedAt: order.approvedAt,
      approvedById: order.approvedById,
      approvedBy: order.approvedBy,
      source: order.source || null,
      externalOrderId: order.externalOrderId || null,
      tenantId: order.tenantId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  emitNewOrder(tenantId: string, order: any) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('order:new', this.toOrderEvent(order));
    this.logger.debug(`order:new ${order.orderNumber} → kitchen/pos-${tenantId}`);
  }

  emitOrderUpdated(tenantId: string, order: any) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('order:updated', this.toOrderEvent(order));
    this.logger.debug(`order:updated ${order.orderNumber} → kitchen/pos-${tenantId}`);
  }

  emitOrderStatusChange(tenantId: string, orderId: string, status: string) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('order:status-changed', { orderId, status, timestamp: new Date() });
    this.logger.debug(`order:status-changed ${orderId} → ${status}`);
  }

  emitOrderItemStatusChange(tenantId: string, orderItemId: string, status: string) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('order:item-status-changed', { orderItemId, status, timestamp: new Date() });
    this.logger.debug(`order:item-status-changed ${orderItemId} → ${status}`);
  }

  emitTableMerge(tenantId: string, payload: { groupId: string; tableNumbers: any[] }) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('table:merged', payload);
    this.logger.debug(`table:merged group=${payload.groupId} → kitchen/pos-${tenantId}`);
  }

  emitTableUnmerge(tenantId: string, payload: { tableNumber: any; groupId: string }) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('table:unmerged', payload);
    this.logger.debug(`table:unmerged table=${payload.tableNumber} → kitchen/pos-${tenantId}`);
  }

  // ========================================
  // CUSTOMER-SPECIFIC EVENTS
  // ========================================

  emitToCustomerSession(sessionId: string, event: string, data: any) {
    this.server.to(`customer-session-${sessionId}`).emit(event, data);
    this.logger.debug(`${event} → customer-session-${sessionId}`);
  }

  emitCustomerOrderCreated(sessionId: string, order: any) {
    this.emitToCustomerSession(sessionId, 'customer:order-created', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      finalAmount: order.finalAmount,
      requiresApproval: order.requiresApproval,
      items: order.orderItems,
      createdAt: order.createdAt,
    });
  }

  emitCustomerOrderApproved(sessionId: string, order: any) {
    this.emitToCustomerSession(sessionId, 'customer:order-approved', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      approvedAt: order.approvedAt,
    });
  }

  emitCustomerOrderStatusUpdate(sessionId: string, order: any) {
    this.emitToCustomerSession(sessionId, 'customer:order-status-updated', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      timestamp: new Date(),
    });
  }

  emitLoyaltyPointsEarned(sessionId: string, customerId: string, points: number, newBalance: number) {
    this.emitToCustomerSession(sessionId, 'customer:loyalty-earned', {
      customerId,
      pointsEarned: points,
      newBalance,
      timestamp: new Date(),
    });
  }

  emitNewOrderWithCustomer(tenantId: string, order: any, sessionId?: string) {
    this.emitNewOrder(tenantId, order);
    if (sessionId) this.emitCustomerOrderCreated(sessionId, order);
  }

  emitOrderStatusChangeWithCustomer(
    tenantId: string,
    orderId: string,
    status: string,
    sessionId?: string,
  ) {
    this.emitOrderStatusChange(tenantId, orderId, status);
    if (sessionId) {
      this.emitToCustomerSession(sessionId, 'customer:order-status-updated', {
        orderId,
        status,
        timestamp: new Date(),
      });
    }
  }

  // ========================================
  // TABLE TRANSFER EVENTS
  // ========================================

  emitTableTransfer(
    tenantId: string,
    data: {
      sourceTableId: string;
      targetTableId: string;
      sourceTableNumber: string;
      targetTableNumber: string;
      orders: any[];
      transferredCount: number;
    },
  ) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('table:orders-transferred', { ...data, timestamp: new Date() });
    this.logger.debug(
      `table:orders-transferred ${data.transferredCount} order(s) ${data.sourceTableNumber}->${data.targetTableNumber}`,
    );
  }

  // ========================================
  // BILL REQUEST EVENTS (POS only)
  // ========================================

  emitBillRequest(tenantId: string, billRequest: any) {
    this.server.to(`pos-${tenantId}`).emit('bill-request:new', {
      id: billRequest.id,
      tableId: billRequest.tableId,
      table: billRequest.table,
      sessionId: billRequest.sessionId,
      status: billRequest.status,
      createdAt: billRequest.createdAt,
      timestamp: new Date(),
    });
  }

  emitBillRequestUpdated(tenantId: string, billRequest: any) {
    this.server.to(`pos-${tenantId}`).emit('bill-request:updated', {
      id: billRequest.id,
      tableId: billRequest.tableId,
      table: billRequest.table,
      sessionId: billRequest.sessionId,
      status: billRequest.status,
      acknowledgedById: billRequest.acknowledgedById,
      acknowledgedBy: billRequest.acknowledgedBy,
      acknowledgedAt: billRequest.acknowledgedAt,
      completedAt: billRequest.completedAt,
      createdAt: billRequest.createdAt,
      timestamp: new Date(),
    });
  }

  // ========================================
  // WAITER REQUEST EVENTS (POS only)
  // ========================================

  emitWaiterRequest(tenantId: string, waiterRequest: any) {
    this.server.to(`pos-${tenantId}`).emit('waiter-request:new', {
      id: waiterRequest.id,
      tableId: waiterRequest.tableId,
      table: waiterRequest.table,
      sessionId: waiterRequest.sessionId,
      message: waiterRequest.message,
      status: waiterRequest.status,
      createdAt: waiterRequest.createdAt,
      timestamp: new Date(),
    });
  }

  emitWaiterRequestUpdated(tenantId: string, waiterRequest: any) {
    this.server.to(`pos-${tenantId}`).emit('waiter-request:updated', {
      id: waiterRequest.id,
      tableId: waiterRequest.tableId,
      table: waiterRequest.table,
      sessionId: waiterRequest.sessionId,
      message: waiterRequest.message,
      status: waiterRequest.status,
      acknowledgedById: waiterRequest.acknowledgedById,
      acknowledgedBy: waiterRequest.acknowledgedBy,
      acknowledgedAt: waiterRequest.acknowledgedAt,
      completedAt: waiterRequest.completedAt,
      createdAt: waiterRequest.createdAt,
      timestamp: new Date(),
    });
  }

  // ========================================
  // PERSONNEL MANAGEMENT EVENTS (ADMIN/MANAGER only)
  // ========================================

  emitAttendanceUpdate(tenantId: string, data: any) {
    this.server
      .to(`personnel-${tenantId}`)
      .emit('personnel:attendance-update', { ...data, timestamp: new Date() });
  }

  emitSwapRequestUpdate(tenantId: string, data: any) {
    this.server
      .to(`personnel-${tenantId}`)
      .emit('personnel:swap-request-update', { ...data, timestamp: new Date() });
  }

  // ========================================
  // STOCK ALERT EVENTS
  // ========================================

  emitLowStockAlert(tenantId: string, items: string[]) {
    this.server
      .to(`kitchen-${tenantId}`)
      .to(`pos-${tenantId}`)
      .emit('stock:low-stock-alert', { items, timestamp: new Date() });
    this.logger.debug(`stock:low-stock-alert ${items.length} items → kitchen/pos-${tenantId}`);
  }
}
