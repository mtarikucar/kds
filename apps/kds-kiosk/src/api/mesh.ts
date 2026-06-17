/**
 * Device Mesh client. All calls authenticate via `Authorization: Device <token>`.
 *
 * Routes:
 *   POST /v1/devices/pair            (Public)
 *   POST /v1/devices/heartbeat       (Device token)
 *   GET  /v1/devices/next-command    (Device token)
 *   POST /v1/devices/commands/:id/ack (Device token)
 */
import type { DeviceToken } from '../store/deviceToken';

/**
 * Thrown when the cloud rejects the device token (401/403) — distinct from a
 * generic transient/network error so callers can branch to a re-pair flow
 * instead of folding it into exponential backoff. deep-review NH8.
 */
export class DeviceAuthError extends Error {
  constructor(message = 'device token rejected') {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

export interface PairOut {
  deviceId: string;
  tenantId: string;
  branchId: string | null;
  token: string;
  expiresAt: string;
}

export interface DeviceCommand {
  id: string;
  kind: string;
  payload: Record<string, any>;
  priority: number;
  attempts: number;
  idempotencyKey: string;
}

async function withToken(url: string, token: DeviceToken, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Device ${token.token}`);
  headers.set('Content-Type', 'application/json');
  return fetch(`${token.apiUrl}${url}`, { ...init, headers });
}

export async function pairDevice(apiUrl: string, pairCode: string): Promise<PairOut> {
  const res = await fetch(`${apiUrl}/v1/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairCode, capabilities: ['display_kitchen'] }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Pair failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Throw a typed auth error on 401/403 so callers can route to re-pair, before
 * any generic status handling. deep-review NH8 / NM3.
 */
function assertAuthed(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new DeviceAuthError(`device token rejected (${res.status})`);
  }
}

export async function heartbeat(
  token: DeviceToken,
  payload: { batteryPct?: number; queueDepth?: number; agentVersion?: string },
): Promise<void> {
  const res = await withToken('/v1/devices/heartbeat', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  // heartbeat is best-effort, but a 401/403 must still surface so the kiosk
  // can re-pair rather than silently pumping rejected heartbeats. deep-review NH8.
  assertAuthed(res);
}

export async function claimNextCommand(token: DeviceToken): Promise<DeviceCommand | null> {
  const res = await withToken('/v1/devices/next-command', token, { method: 'GET' });
  assertAuthed(res);
  if (!res.ok) throw new Error(`next-command ${res.status}`);
  const body = (await res.json()) as DeviceCommand | null;
  return body && body.id ? body : null;
}

export async function ackCommand(
  token: DeviceToken,
  commandId: string,
  payload: { status: 'done' | 'failed'; result?: Record<string, unknown>; error?: string },
): Promise<void> {
  const res = await withToken(`/v1/devices/commands/${commandId}/ack`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  // deep-review NM3: a failed ack was previously treated as success, so the
  // server redelivered the command while the client moved on. Surface non-2xx
  // (401/403 as DeviceAuthError, else a thrown error) so the poll loop retries
  // the ack once connectivity/token recovers.
  assertAuthed(res);
  if (!res.ok) throw new Error(`ack ${res.status}`);
}
