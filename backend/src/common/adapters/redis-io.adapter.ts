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
  private pubClient?: ReturnType<typeof createClient>;
  private subClient?: ReturnType<typeof createClient>;

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

    // Short-circuit reconnect so a dead Redis doesn't spam the logs
    // forever in dev (`docker-compose down`) or during a transient k8s
    // blip. Three fast retries, then connect() rejects and we fall back
    // to the in-memory adapter.
    const clientOpts = {
      url,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 3) return new Error('redis unreachable');
          return Math.min(retries * 200, 1000);
        },
      },
    };

    const pubClient = createClient(clientOpts);
    const subClient = pubClient.duplicate();

    let pubSawError = false;
    let subSawError = false;
    pubClient.on('error', (err) => {
      if (!pubSawError) {
        this.logger.error(`Redis pub client error: ${err.message}`);
        pubSawError = true;
      }
    });
    subClient.on('error', (err) => {
      if (!subSawError) {
        this.logger.error(`Redis sub client error: ${err.message}`);
        subSawError = true;
      }
    });

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.pubClient = pubClient;
      this.subClient = subClient;
      this.logger.log('Socket.IO Redis adapter connected');
    } catch (err: any) {
      this.logger.error(
        `Redis connection failed (${err.message}). Falling back to in-memory Socket.IO adapter — multi-replica broadcasts will be silently broken until Redis is reachable.`,
      );
      try { await pubClient.disconnect(); } catch {}
      try { await subClient.disconnect(); } catch {}
    }
  }

  async disconnectRedis(): Promise<void> {
    try { await this.pubClient?.quit(); } catch {}
    try { await this.subClient?.quit(); } catch {}
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
