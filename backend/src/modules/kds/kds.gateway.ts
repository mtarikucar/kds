import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

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

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Check for JWT token (staff authentication)
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      // Check for session ID (customer authentication)
      const sessionId = client.handshake.auth.sessionId || client.handshake.query.sessionId;

      // Try JWT authentication first (staff)
      if (token) {
        try {
          const payload = this.jwtService.verify(token);

          // Store user info in socket data
          client.data.userId = payload.userId;
          client.data.tenantId = payload.tenantId;
          client.data.role = payload.role;
          client.data.userType = 'staff';

          // Join tenant-specific rooms
          client.join(`kitchen-${payload.tenantId}`);
          client.join(`pos-${payload.tenantId}`);

          this.logger.log(
            `Staff client ${client.id} connected (User: ${payload.userId}, Tenant: ${payload.tenantId})`
          );
          return;
        } catch (error) {
          this.logger.error(`JWT authentication failed for client ${client.id}: ${error.message}`);
          // Continue to try session authentication
        }
      }

      // Try session authentication (customer)
      if (sessionId) {
        const session = await this.prisma.customerSession.findUnique({
          where: { sessionId },
          include: { customer: true },
        });

        if (!session) {
          this.logger.warn(`Client ${client.id} connection rejected: Invalid session`);
          client.disconnect();
          return;
        }

        // Check if session is expired
        if (new Date() > session.expiresAt || !session.isActive) {
          this.logger.warn(`Client ${client.id} connection rejected: Session expired`);
          client.disconnect();
          return;
        }

        // Store session info in socket data
        client.data.sessionId = session.sessionId;
        client.data.tenantId = session.tenantId;
        client.data.customerId = session.customerId;
        client.data.userType = 'customer';

        // Join customer-specific room
        client.join(`customer-session-${session.sessionId}`);

        // Update session activity
        await this.prisma.customerSession.update({
          where: { sessionId },
          data: { lastActivity: new Date() },
        });

        this.logger.log(
          `Customer client ${client.id} connected (Session: ${sessionId}, Customer: ${session.customerId || 'anonymous'})`
        );
        return;
      }

      // No valid authentication provided
      this.logger.warn(`Client ${client.id} connection rejected: No valid authentication`);
      client.disconnect();
    } catch (error) {
      this.logger.error(`Client ${client.id} authentication failed: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('join-kitchen')
  handleJoinKitchen(client: Socket) {
    const tenantId = client.data.tenantId;
    client.join(`kitchen-${tenantId}`);
    this.logger.log(`Client ${client.id} joined kitchen-${tenantId}`);
  }

  @SubscribeMessage('join-pos')
  handleJoinPos(client: Socket) {
    const tenantId = client.data.tenantId;
    client.join(`pos-${tenantId}`);
    this.logger.log(`Client ${client.id} joined pos-${tenantId}`);
  }

  emitNewOrder(tenantId: string, order: any) {
    // Send complete order object with all fields for Pure Socket.IO approach
    // This allows frontend to directly inject into React Query cache without API calls
    this.server.to(`kitchen-${tenantId}`).to(`pos-${tenantId}`).emit('order:new', {
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
    });

    this.logger.log(`New order ${order.orderNumber} emitted to kitchen-${tenantId} and pos-${tenantId}`);
  }

  emitOrderUpdated(tenantId: string, order: any) {
    // Send complete order object with all fields for Pure Socket.IO approach
    this.server.to(`kitchen-${tenantId}`).to(`pos-${tenantId}`).emit('order:updated', {
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
    });

    this.logger.log(`Order ${order.orderNumber} updated and emitted to kitchen-${tenantId}`);
  }

  emitOrderStatusChange(tenantId: string, orderId: string, status: string) {
    this.server.to(`kitchen-${tenantId}`).to(`pos-${tenantId}`).emit('order:status-changed', {
      orderId,
      status,
      timestamp: new Date(),
    });

    this.logger.log(`Order ${orderId} status changed to ${status}`);
  }

  emitOrderItemStatusChange(tenantId: string, orderItemId: string, status: string) {
    this.server.to(`kitchen-${tenantId}`).to(`pos-${tenantId}`).emit('order:item-status-changed', {
      orderItemId,
      status,
      timestamp: new Date(),
    });

    this.logger.log(`Order item ${orderItemId} status changed to ${status}`);
  }

  // ========================================
  // CUSTOMER-SPECIFIC EVENTS
  // ========================================

  emitToCustomerSession(sessionId: string, event: string, data: any) {
    this.server.to(`customer-session-${sessionId}`).emit(event, data);
    this.logger.log(`Event ${event} emitted to customer session ${sessionId}`);
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

  // Override emitNewOrder to also notify customer if sessionId is present
  emitNewOrderWithCustomer(tenantId: string, order: any, sessionId?: string) {
    // Emit to staff (kitchen and POS)
    this.emitNewOrder(tenantId, order);

    // Also emit to customer if sessionId provided
    if (sessionId) {
      this.emitCustomerOrderCreated(sessionId, order);
    }
  }

  // Override emitOrderStatusChange to also notify customer if order has sessionId
  emitOrderStatusChangeWithCustomer(tenantId: string, orderId: string, status: string, sessionId?: string) {
    // Emit to staff
    this.emitOrderStatusChange(tenantId, orderId, status);

    // Also emit to customer if sessionId provided
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

  emitTableTransfer(tenantId: string, data: {
    sourceTableId: string;
    targetTableId: string;
    sourceTableNumber: string;
    targetTableNumber: string;
    orders: any[];
    transferredCount: number;
  }) {
    this.server.to(`kitchen-${tenantId}`).to(`pos-${tenantId}`).emit('table:orders-transferred', {
      sourceTableId: data.sourceTableId,
      targetTableId: data.targetTableId,
      sourceTableNumber: data.sourceTableNumber,
      targetTableNumber: data.targetTableNumber,
      orders: data.orders,
      transferredCount: data.transferredCount,
      timestamp: new Date(),
    });

    this.logger.log(
      `Table transfer emitted: ${data.transferredCount} order(s) from table ${data.sourceTableNumber} to table ${data.targetTableNumber}`
    );
  }

  // ========================================
  // BILL REQUEST EVENTS
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

    this.logger.log(
      `New bill request emitted for table ${billRequest.table?.number || billRequest.tableId} to pos-${tenantId}`
    );
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

    this.logger.log(
      `Bill request ${billRequest.id} updated (status: ${billRequest.status}) and emitted to pos-${tenantId}`
    );
  }

  // ========================================
  // WAITER REQUEST EVENTS
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

    this.logger.log(
      `New waiter request emitted for table ${waiterRequest.table?.number || waiterRequest.tableId} to pos-${tenantId}`
    );
  }

  // ========================================
  // PERSONNEL MANAGEMENT EVENTS
  // ========================================

  emitAttendanceUpdate(tenantId: string, data: any) {
    this.server.to(`pos-${tenantId}`).emit('personnel:attendance-update', {
      ...data,
      timestamp: new Date(),
    });

    this.logger.log(
      `Personnel attendance update emitted to pos-${tenantId}`
    );
  }

  emitSwapRequestUpdate(tenantId: string, data: any) {
    this.server.to(`pos-${tenantId}`).emit('personnel:swap-request-update', {
      ...data,
      timestamp: new Date(),
    });

    this.logger.log(
      `Personnel swap request update emitted to pos-${tenantId}`
    );
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

    this.logger.log(
      `Waiter request ${waiterRequest.id} updated (status: ${waiterRequest.status}) and emitted to pos-${tenantId}`
    );
  }
}
