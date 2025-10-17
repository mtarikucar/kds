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

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/kds',
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(KdsGateway.name);

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token provided`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token);

      // Store user info in socket data
      client.data.userId = payload.userId;
      client.data.tenantId = payload.tenantId;
      client.data.role = payload.role;

      // Join tenant-specific rooms
      client.join(`kitchen-${payload.tenantId}`);
      client.join(`pos-${payload.tenantId}`);

      this.logger.log(
        `Client ${client.id} connected (User: ${payload.userId}, Tenant: ${payload.tenantId})`
      );
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
    this.server.to(`kitchen-${tenantId}`).emit('order:new', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      items: order.orderItems,
      table: order.table,
      type: order.type,
      customerName: order.customerName,
      notes: order.notes,
      createdAt: order.createdAt,
    });

    this.logger.log(`New order ${order.orderNumber} emitted to kitchen-${tenantId}`);
  }

  emitOrderUpdated(tenantId: string, order: any) {
    this.server.to(`kitchen-${tenantId}`).to(`pos-${tenantId}`).emit('order:updated', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      items: order.orderItems,
      table: order.table,
      type: order.type,
      customerName: order.customerName,
      notes: order.notes,
      totalAmount: order.totalAmount,
      discount: order.discount,
      finalAmount: order.finalAmount,
      updatedAt: new Date(),
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
}
