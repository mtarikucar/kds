import { io, Socket } from 'socket.io-client';
import { loginAsApi } from './api';
import type { DemoRole } from '../fixtures/demo-users';

const KDS_BASE = process.env.SOCKET_BASE || 'http://localhost:50080';

/**
 * Connect a staff socket to the KDS namespace as `role`. Returns the
 * connected socket and a `waitFor(event)` helper that resolves on
 * the next emission (with optional payload filter).
 *
 * Always pair with `socket.disconnect()` in a finally block — leaked
 * sockets keep the dev server's connection table growing.
 */
export async function connectKdsAs(role: DemoRole): Promise<KdsClient> {
  const { accessToken, api } = await loginAsApi(role);
  // We only needed the token; release the request context.
  await api.dispose();

  const socket = io(`${KDS_BASE}/kds`, {
    transports: ['websocket'],
    auth: { token: accessToken },
    forceNew: true,
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('KDS socket connect timeout')), 8_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return new KdsClient(socket);
}

export class KdsClient {
  constructor(private readonly socket: Socket) {}

  /**
   * Resolve on the next emission of `event`. Optional `predicate`
   * filters payloads — useful when many events arrive and the spec
   * cares about a specific order.
   */
  waitFor<T = unknown>(
    event: string,
    predicate?: (payload: T) => boolean,
    timeoutMs = 10_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`socket waitFor("${event}") timeout`)),
        timeoutMs,
      );
      const handler = (payload: T) => {
        if (predicate && !predicate(payload)) return;
        clearTimeout(timer);
        this.socket.off(event, handler);
        resolve(payload);
      };
      this.socket.on(event, handler);
    });
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
