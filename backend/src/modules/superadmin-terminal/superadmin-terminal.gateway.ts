import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SuperAdminTerminalService } from './superadmin-terminal.service';
import { SshConnectDto } from './dto';

interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  type: 'superadmin';
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:5173'],
    credentials: true,
  },
  namespace: '/superadmin-terminal',
})
export class SuperAdminTerminalGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SuperAdminTerminalGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly terminalService: SuperAdminTerminalService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth.token;
      if (!token) {
        this.emitError(client, 'No authentication token provided');
        client.disconnect();
        return;
      }

      const payload =
        await this.jwtService.verifyAsync<SuperAdminJwtPayload>(token, {
          secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
        });

      if (payload.type !== 'superadmin') {
        this.emitError(client, 'Invalid token type');
        client.disconnect();
        return;
      }

      const superAdmin = await this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, status: true },
      });

      if (!superAdmin || superAdmin.status !== 'ACTIVE') {
        this.emitError(client, 'SuperAdmin not found or inactive');
        client.disconnect();
        return;
      }

      client.data.superAdminId = superAdmin.id;
      client.data.superAdminEmail = superAdmin.email;

      this.logger.log(
        `SuperAdmin terminal connected: ${superAdmin.email} (socket: ${client.id})`,
      );
    } catch (error) {
      this.logger.error(
        `Terminal auth failed for socket ${client.id}: ${error.message}`,
      );
      this.emitError(client, 'Authentication failed');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Terminal socket disconnected: ${client.id}`);
    this.terminalService.disconnect(client.id);
  }

  @SubscribeMessage('terminal:connect')
  async handleTerminalConnect(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SshConnectDto,
  ): Promise<void> {
    const superAdminId = client.data.superAdminId;
    if (!superAdminId) {
      this.emitError(client, 'Not authenticated');
      return;
    }

    this.logger.log(
      `SSH connect request from ${client.data.superAdminEmail}: ${dto.username}@${dto.host}:${dto.port ?? 22}`,
    );

    try {
      await this.terminalService.connect(
        client.id,
        superAdminId,
        dto,
        (data: string) => {
          client.emit('terminal:data', data);
        },
        (reason?: string) => {
          client.emit('terminal:disconnected', { reason });
        },
      );

      client.emit('terminal:connected', {
        message: `Connected to ${dto.host}:${dto.port ?? 22}`,
      });
    } catch (error) {
      this.logger.error(
        `SSH connect failed for ${client.id}: ${error.message}`,
      );
      this.emitError(client, error.message);
    }
  }

  @SubscribeMessage('terminal:data')
  handleTerminalData(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: string,
  ): void {
    this.terminalService.write(client.id, data);
  }

  @SubscribeMessage('terminal:resize')
  handleTerminalResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cols: number; rows: number },
  ): void {
    if (payload.cols > 0 && payload.rows > 0) {
      this.terminalService.resize(client.id, payload.cols, payload.rows);
    }
  }

  @SubscribeMessage('terminal:disconnect')
  handleTerminalDisconnect(@ConnectedSocket() client: Socket): void {
    this.terminalService.disconnect(client.id);
    client.emit('terminal:disconnected', { reason: 'User disconnected' });
  }

  private emitError(client: Socket, message: string): void {
    client.emit('terminal:error', { message });
  }
}
