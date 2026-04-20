import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

/**
 * Socket.IO IoAdapter backed by Redis pub/sub. Without this, a
 * `server.to('kitchen-<tenantId>').emit(...)` only reaches sockets
 * connected to the replica that executed the emit. Under any horizontal
 * scale-out (2+ pods behind a load balancer) every realtime event drops
 * silently for half the clients.
 *
 * The adapter is opt-in via REDIS_URL (or REDIS_HOST/REDIS_PORT). If
 * neither is set we fall back to the in-memory adapter — single-node
 * dev runs keep working unchanged.
 *
 * Wired in main.ts via `app.useWebSocketAdapter(new RedisIoAdapter(app))`.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL ??
      (process.env.REDIS_HOST && process.env.REDIS_PORT
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
        : undefined);

    if (!url) {
      this.logger.warn(
        'REDIS_URL not set — Socket.IO will use the in-memory adapter. ' +
          'Multi-replica deployments will LOSE realtime events across replicas.',
      );
      return;
    }

    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) =>
      this.logger.error(`Redis pub client error: ${err.message}`),
    );
    subClient.on('error', (err) =>
      this.logger.error(`Redis sub client error: ${err.message}`),
    );

    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
