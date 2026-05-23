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

export async function heartbeat(
  token: DeviceToken,
  payload: { batteryPct?: number; queueDepth?: number; agentVersion?: string },
): Promise<void> {
  await withToken('/v1/devices/heartbeat', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function claimNextCommand(token: DeviceToken): Promise<DeviceCommand | null> {
  const res = await withToken('/v1/devices/next-command', token, { method: 'GET' });
  if (!res.ok) throw new Error(`next-command ${res.status}`);
  const body = (await res.json()) as DeviceCommand | null;
  return body && body.id ? body : null;
}

export async function ackCommand(
  token: DeviceToken,
  commandId: string,
  payload: { status: 'done' | 'failed'; result?: Record<string, unknown>; error?: string },
): Promise<void> {
  await withToken(`/v1/devices/commands/${commandId}/ack`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
