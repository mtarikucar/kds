import { io, Socket } from 'socket.io-client';
import { loginAsApi } from './api';
import type { DemoRole } from '../fixtures/demo-users';

const KDS_BASE = process.env.SOCKET_BASE || 'http://localhost:50080';

/**
 * Decode the access-token JWT payload (unverified) and return the user's
 * primaryBranchId — the value the KDS gateway handshake expects in
 * `auth.branchId`. Throws if the demo staff user is not branch-assigned.
 */
function branchIdFromToken(accessToken: string): string {
  const part = accessToken.split('.')[1] ?? '';
  const payload = JSON.parse(
    Buffer.from(part, 'base64url').toString('utf8') || '{}',
  );
  const branchId: string = payload.primaryBranchId ?? payload.activeBranchId ?? '';
  if (!branchId) {
    throw new Error(
      'connectKdsAs: token carries no primaryBranchId — the demo staff user must be branch-assigned for the KDS handshake',
    );
  }
  return branchId;
}

/**
 * Connect a staff socket to the KDS namespace as `role`. Returns the
 * connected socket and a `waitFor(event)` helper that resolves on
 * the next emission (with optional payload filter).
 *
 * `baseUrl` overrides the origin the socket dials (default
 * `SOCKET_BASE` env / `http://localhost:50080`). This lets a spec
 * connect a client to a SPECIFIC replica — e.g. the multi-replica
 * broadcast e2e dials replica B explicitly so it can prove an action
 * on replica A fans out across Redis. The auth token is identical
 * regardless of which replica answers, so any node accepts it.
 *
 * Always pair with `socket.disconnect()` in a finally block — leaked
 * sockets keep the dev server's connection table growing.
 */
export async function connectKdsAs(
  role: DemoRole,
  baseUrl: string = KDS_BASE,
): Promise<KdsClient> {
  const { accessToken, api } = await loginAsApi(role);
  // We only needed the token; release the request context.
  await api.dispose();

  // The KDS gateway handshake (kds.gateway.ts) reads `auth.branchId` from the
  // client payload (NOT the JWT) and validates it with the same predicate
  // BranchGuard uses for HTTP — a staff socket with an empty/unauthorized
  // branchId is disconnected. Mirror the prod SPA (frontend/src/lib/socket.ts),
  // which sends auth:{token, branchId}: source the user's primaryBranchId from
  // the access token so canAccessBranchStatic accepts it.
  const branchId = branchIdFromToken(accessToken);

  const socket = io(`${baseUrl}/kds`, {
    transports: ['websocket'],
    auth: { token: accessToken, branchId },
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
