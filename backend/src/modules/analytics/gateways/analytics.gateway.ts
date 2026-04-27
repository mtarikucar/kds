import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';

const corsOrigin = () => {
  if (process.env.CORS_ORIGIN) return process.env.CORS_ORIGIN.split(',');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGIN must be configured for the analytics gateway in production',
    );
  }
  return ['http://localhost:5173'];
};
import {
  EdgeDeviceRegisterDto,
  EdgeOccupancyDataDto,
  EdgeHeartbeatDto,
  EdgeHealthStatusDto,
  EdgeDeviceConfigDto,
  EdgeDeviceCommandDto,
  CameraCalibrationDto,
  PersonState,
} from '../dto/edge-device';
import { decryptString } from '../../../common/helpers/encryption.helper';

interface EdgeDeviceConnection {
  socketId: string;
  deviceId: string;
  cameraId: string;
  tenantId: string;
  connectedAt: Date;
  lastHeartbeat: Date;
}

@Injectable()
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@WebSocketGateway({
  cors: {
    origin: corsOrigin(),
    credentials: true,
  },
  namespace: '/analytics-edge',
})
export class AnalyticsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AnalyticsGateway.name);

  // Track connected edge devices keyed by `${tenantId}:${deviceId}` so
  // two tenants with the same device id don't evict each other.
  private connectedDevices: Map<string, EdgeDeviceConnection> = new Map();

  private deviceKey(tenantId: string, deviceId: string) {
    return `${tenantId}:${deviceId}`;
  }

  /**
   * Legacy deviceId-only lookup used by sendConfigToDevice /
   * sendCommandToDevice. Scans the map; unlike a keyed get() it will
   * also return a device owned by the expected tenant if the caller
   * provided one.
   */
  private findDevice(deviceId: string, tenantId?: string) {
    for (const d of this.connectedDevices.values()) {
      if (d.deviceId !== deviceId) continue;
      if (tenantId && d.tenantId !== tenantId) continue;
      return d;
    }
    return undefined;
  }

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Check for JWT token or API key
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Edge device ${client.id} connection rejected: No authentication`);
        client.disconnect();
        return;
      }

      try {
        const payload = this.jwtService.verify(token);

        // Store connection info
        client.data.tenantId = payload.tenantId;
        client.data.authenticated = true;

        // Join tenant-specific room
        client.join(`analytics-${payload.tenantId}`);

        this.logger.log(`Edge device ${client.id} connected (Tenant: ${payload.tenantId})`);
      } catch (error) {
        this.logger.error(`Edge device ${client.id} authentication failed: ${error.message}`);
        client.disconnect();
      }
    } catch (error) {
      this.logger.error(`Edge device ${client.id} connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const deviceId = client.data.deviceId;
    const tenantId = client.data.tenantId;
    if (deviceId && tenantId) {
      this.connectedDevices.delete(this.deviceKey(tenantId, deviceId));

      this.updateDeviceStatus(deviceId, 'OFFLINE', tenantId).catch((err) => {
        this.logger.error(`Failed to update device status: ${err.message}`);
      });
    }

    this.logger.log(`Edge device ${client.id} disconnected`);
  }

  // ========================================
  // EDGE DEVICE REGISTRATION
  // ========================================

  @SubscribeMessage('edge:register')
  async handleEdgeRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EdgeDeviceRegisterDto,
  ) {
    try {
      const tenantId = client.data.tenantId;

      if (!tenantId || tenantId !== payload.tenantId) {
        this.logger.warn(`Edge device registration rejected: Tenant mismatch`);
        return { success: false, error: 'Tenant mismatch' };
      }

      // Store device info in socket
      client.data.deviceId = payload.deviceId;
      client.data.cameraId = payload.cameraId;

      this.connectedDevices.set(
        this.deviceKey(payload.tenantId, payload.deviceId),
        {
          socketId: client.id,
          deviceId: payload.deviceId,
          cameraId: payload.cameraId,
          tenantId: payload.tenantId,
          connectedAt: new Date(),
          lastHeartbeat: new Date(),
        },
      );

      // Update or create edge device in database
      await this.prisma.edgeDevice.upsert({
        where: {
          tenantId_deviceId: {
            tenantId: payload.tenantId,
            deviceId: payload.deviceId,
          },
        },
        create: {
          deviceId: payload.deviceId,
          name: `Edge Device ${payload.deviceId}`,
          tenantId: payload.tenantId,
          status: 'ONLINE',
          lastSeenAt: new Date(),
          lastHeartbeat: new Date(),
          firmwareVersion: payload.firmwareVersion,
          hardwareType: payload.hardwareType,
          capabilities: payload.capabilities || {},
        },
        update: {
          status: 'ONLINE',
          lastSeenAt: new Date(),
          lastHeartbeat: new Date(),
          firmwareVersion: payload.firmwareVersion,
          hardwareType: payload.hardwareType,
          capabilities: payload.capabilities || {},
        },
      });

      // Update camera status if linked
      if (payload.cameraId) {
        await this.prisma.camera.updateMany({
          where: {
            id: payload.cameraId,
            tenantId: payload.tenantId,
          },
          data: {
            status: 'ONLINE',
            lastSeenAt: new Date(),
          },
        });
      }

      // Send current configuration to device
      const config = await this.getDeviceConfig(payload.cameraId, tenantId);
      client.emit('edge:config', { data: config });

      this.logger.log(
        `Edge device ${payload.deviceId} registered (Camera: ${payload.cameraId}, Tenant: ${tenantId})`,
      );

      return { success: true };
    } catch (error) {
      this.logger.error(`Edge device registration failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // OCCUPANCY DATA HANDLING
  // ========================================

  @SubscribeMessage('edge:occupancy')
  async handleOccupancyData(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EdgeOccupancyDataDto,
  ) {
    try {
      const tenantId = client.data.tenantId;

      if (!tenantId || tenantId !== payload.tenantId) {
        return { success: false, error: 'Tenant mismatch' };
      }

      const timestamp = new Date(payload.timestamp);

      // Store occupancy records
      if (payload.detections.length > 0) {
        await this.prisma.occupancyRecord.createMany({
          data: payload.detections.map((detection) => ({
            tenantId,
            cameraId: payload.cameraId,
            trackingId: detection.trackingId,
            positionX: detection.positionX,
            positionZ: detection.positionZ,
            state: detection.state,
            confidence: detection.confidence,
            timestamp,
          })),
          skipDuplicates: true,
        });

        // Update traffic flow aggregation (async, don't wait)
        this.updateTrafficFlow(tenantId, payload.detections, timestamp).catch((err) => {
          this.logger.error(`Traffic flow update failed: ${err.message}`);
        });

        // Broadcast to dashboard clients
        this.broadcastOccupancyUpdate(tenantId, payload);
      }

      return { success: true, processed: payload.detections.length };
    } catch (error) {
      this.logger.error(`Occupancy data processing failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // HEARTBEAT HANDLING
  // ========================================

  @SubscribeMessage('edge:heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EdgeHeartbeatDto,
  ) {
    try {
      const deviceId = client.data.deviceId || payload.deviceId;

      if (!deviceId) {
        return { success: false, error: 'Device not registered' };
      }

      const device = this.connectedDevices.get(
        this.deviceKey(client.data.tenantId, deviceId),
      );
      if (device) {
        device.lastHeartbeat = new Date();
      }

      // Tenant-scoped write: EdgeDevice.deviceId is only unique per
      // tenant, so filtering on deviceId alone lets a compromised
      // device in tenant A overwrite tenant B's device of the same id.
      await this.prisma.edgeDevice.updateMany({
        where: { deviceId, tenantId: client.data.tenantId },
        data: {
          lastHeartbeat: new Date(),
          lastSeenAt: new Date(),
          status: 'ONLINE',
        },
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Heartbeat processing failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // HEALTH STATUS HANDLING
  // ========================================

  @SubscribeMessage('edge:health')
  async handleHealthStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EdgeHealthStatusDto,
  ) {
    try {
      const deviceId = client.data.deviceId || payload.deviceId;

      if (!deviceId) {
        return { success: false, error: 'Device not registered' };
      }

      await this.prisma.edgeDevice.updateMany({
        where: { deviceId, tenantId: client.data.tenantId },
        data: {
          lastSeenAt: new Date(),
          cpuUsage: payload.cpuUsage,
          memoryUsage: payload.memoryUsage,
          gpuUsage: payload.gpuUsage,
          temperature: payload.temperature,
          uptime: payload.uptime,
          framesProcessed: payload.framesProcessed
            ? BigInt(payload.framesProcessed)
            : undefined,
          detectionsTotal: payload.detectionsTotal
            ? BigInt(payload.detectionsTotal)
            : undefined,
        },
      });

      this.logger.debug(`Health status received from ${deviceId}`, payload);

      return { success: true };
    } catch (error) {
      this.logger.error(`Health status processing failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // CONFIGURATION & COMMANDS
  // ========================================

  async sendConfigToDevice(
    deviceId: string,
    config: EdgeDeviceConfigDto,
    tenantId?: string,
  ) {
    const device = this.findDevice(deviceId, tenantId);
    if (!device) {
      this.logger.warn(`Cannot send config - device ${deviceId} not connected`);
      return false;
    }

    this.server.to(device.socketId).emit('edge:config', { data: config });
    this.logger.log(`Config sent to device ${deviceId}`);
    return true;
  }

  async sendCommandToDevice(
    deviceId: string,
    command: EdgeDeviceCommandDto,
    tenantId?: string,
  ) {
    const device = this.findDevice(deviceId, tenantId);
    if (!device) {
      this.logger.warn(`Cannot send command - device ${deviceId} not connected`);
      return false;
    }

    this.server.to(device.socketId).emit('edge:command', { data: command });
    this.logger.log(`Command ${command.command} sent to device ${deviceId}`);
    return true;
  }

  async sendCalibrationToDevice(
    deviceId: string,
    calibration: CameraCalibrationDto,
    tenantId?: string,
  ) {
    const device = this.findDevice(deviceId, tenantId);
    if (!device) {
      this.logger.warn(`Cannot send calibration - device ${deviceId} not connected`);
      return false;
    }

    this.server.to(device.socketId).emit('edge:calibration', { data: calibration });
    this.logger.log(`Calibration data sent to device ${deviceId}`);
    return true;
  }

  // ========================================
  // DASHBOARD BROADCASTS
  // ========================================

  broadcastOccupancyUpdate(tenantId: string, data: EdgeOccupancyDataDto) {
    this.server.to(`analytics-${tenantId}`).emit('analytics:occupancy-update', {
      cameraId: data.cameraId,
      timestamp: data.timestamp,
      personCount: data.detections.length,
      detections: data.detections.map((d) => ({
        trackingId: d.trackingId,
        gridX: d.gridX,
        gridZ: d.gridZ,
        state: d.state,
      })),
    });
  }

  broadcastHeatmapUpdate(tenantId: string, heatmapData: number[][]) {
    this.server.to(`analytics-${tenantId}`).emit('analytics:heatmap-update', {
      timestamp: new Date().toISOString(),
      grid: heatmapData,
    });
  }

  broadcastInsight(tenantId: string, insight: unknown) {
    this.server.to(`analytics-${tenantId}`).emit('analytics:new-insight', insight);
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  private async updateDeviceStatus(
    deviceId: string,
    status: string,
    tenantId?: string,
  ) {
    await this.prisma.edgeDevice.updateMany({
      where: tenantId ? { deviceId, tenantId } : { deviceId },
      data: {
        status,
        lastSeenAt: new Date(),
      },
    });
  }

  private async getDeviceConfig(
    cameraId: string,
    tenantId: string,
  ): Promise<EdgeDeviceConfigDto | null> {
    const camera = await this.prisma.camera.findFirst({
      where: { id: cameraId, tenantId },
    });

    if (!camera) return null;

    return {
      cameraId: camera.id,
      // The streamUrl is AES-GCM-encrypted at rest (see camera.service.ts:53).
      // The edge device receives it over a TLS-protected, JWT-authenticated
      // WebSocket and uses it directly as an RTSP URL, so it must be
      // decrypted here. The admin-facing API path already does this in
      // camera.service.ts; forgetting it here previously broke camera
      // analytics end-to-end.
      cameraUrl: camera.streamUrl ? decryptString(camera.streamUrl) : '',
      calibration: camera.calibrationData as EdgeDeviceConfigDto['calibration'],
    };
  }

  private async updateTrafficFlow(
    tenantId: string,
    detections: EdgeOccupancyDataDto['detections'],
    timestamp: Date,
  ) {
    // Round to hour for aggregation
    const hourBucket = new Date(timestamp);
    hourBucket.setMinutes(0, 0, 0);

    // Group detections by grid cell
    const cellCounts = new Map<string, number>();
    for (const detection of detections) {
      const key = `${detection.gridX}-${detection.gridZ}`;
      cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
    }

    // Update traffic flow records
    for (const [key, count] of cellCounts) {
      const [cellX, cellZ] = key.split('-').map(Number);

      await this.prisma.trafficFlowRecord.upsert({
        where: {
          tenantId_hourBucket_cellX_cellZ: {
            tenantId,
            hourBucket,
            cellX,
            cellZ,
          },
        },
        create: {
          tenantId,
          hourBucket,
          cellX,
          cellZ,
          personCount: count,
          entrances: count,
        },
        update: {
          personCount: { increment: count },
          entrances: { increment: count },
        },
      });
    }
  }

  // ========================================
  // DEVICE MANAGEMENT
  // ========================================

  getConnectedDevices(): EdgeDeviceConnection[] {
    return Array.from(this.connectedDevices.values());
  }

  isDeviceConnected(deviceId: string, tenantId?: string): boolean {
    return !!this.findDevice(deviceId, tenantId);
  }

  getDeviceConnection(
    deviceId: string,
    tenantId?: string,
  ): EdgeDeviceConnection | undefined {
    return this.findDevice(deviceId, tenantId);
  }
}
