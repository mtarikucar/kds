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
        const payload = this.jwtService.verify(token, { algorithms: ['HS256'] });

        // Reject non-main-app tokens. Marketing + superadmin realms sign
        // against the same secret; without this check they'd silently join
        // the tenant notification stream. Mirrors kds.gateway.ts:105-110.
        if (payload.type && payload.type !== 'user') {
          this.logger.warn(
            `Notifications JWT rejected for ${client.id}: unsupported token type '${payload.type}'`,
          );
          client.disconnect();
          return;
        }

        // Main-app JWTs carry the user id in `sub`, not `userId`. Reading
        // the wrong key turned `user:${...}` into the literal `user:undefined`
        // room, so sendNotificationToUser() silently no-op'd.
        const userId = payload.sub;
        if (!userId || !payload.tenantId) {
          this.logger.warn(
            `Notifications JWT rejected for ${client.id}: missing sub/tenantId`,
          );
          client.disconnect();
          return;
        }

        client.data.userId = userId;
        client.data.tenantId = payload.tenantId;
        client.data.role = payload.role;
        client.data.tokenExp = payload.exp;

        client.join(`user:${userId}`);
        client.join(`tenant:${payload.tenantId}`);

        // Auto-disconnect at token expiry so an idle long-lived socket
        // can't keep receiving emits after its JWT becomes invalid. Pure
        // server-push gateway (no @SubscribeMessage handlers) so the
        // expiry timer is the only enforcement point.
        if (payload.exp && typeof payload.exp === 'number') {
          const msToExpiry = payload.exp * 1000 - Date.now();
          if (msToExpiry > 0 && msToExpiry < 0x7fffffff) {
            setTimeout(() => {
              if (client.connected) {
                this.logger.log(`Client ${client.id} token expired; disconnecting.`);
                client.disconnect(true);
              }
            }, msToExpiry).unref?.();
          }
        }

        this.logger.log(
          `Client ${client.id} connected (User: ${userId}, Tenant: ${payload.tenantId})`,
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
