import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:5173'],
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extract JWT token from auth or headers
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token provided`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      try {
        const payload = this.jwtService.verify(token);

        // Store user info in socket data
        client.data.userId = payload.userId;
        client.data.tenantId = payload.tenantId;
        client.data.role = payload.role;

        // Join user-specific and tenant-specific rooms
        client.join(`user:${payload.userId}`);
        client.join(`tenant:${payload.tenantId}`);

        this.logger.log(
          `Client ${client.id} connected (User: ${payload.userId}, Tenant: ${payload.tenantId})`
        );
      } catch (error) {
        this.logger.error(`JWT authentication failed for client ${client.id}: ${error.message}`);
        client.disconnect();
      }
    } catch (error) {
      this.logger.error(`Client ${client.id} authentication failed: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  /**
   * Send notification to a specific user
   */
  sendNotificationToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification', notification);
    this.logger.log(`Notification sent to user ${userId}: ${notification.title}`);
  }

  /**
   * Send notification to all users in a tenant
   */
  sendNotificationToTenant(tenantId: string, notification: any) {
    this.server.to(`tenant:${tenantId}`).emit('notification', notification);
    this.logger.log(`Notification sent to tenant ${tenantId}: ${notification.title}`);
  }
}
