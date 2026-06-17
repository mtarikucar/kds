import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pairDevice,
  heartbeat,
  claimNextCommand,
  ackCommand,
  DeviceAuthError,
  type DeviceCommand,
  type PairOut,
} from './mesh';
import type { DeviceToken } from '../store/deviceToken';

const token: DeviceToken = {
  deviceId: 'dev-1',
  tenantId: 'ten-1',
  branchId: null,
  token: 'secret-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  apiUrl: 'https://api.example.com/api',
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pairDevice', () => {
  it('POSTs the pair code + capabilities and returns the parsed token', async () => {
    const out: PairOut = {
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      branchId: null,
      token: 'new-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(out));

    const result = await pairDevice('https://api.example.com/api', 'A4F9K2');

    expect(result).toEqual(out);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/devices/pair');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      pairCode: 'A4F9K2',
      capabilities: ['display_kitchen'],
    });
  });

  it('throws with status + truncated body text on a non-ok response', async () => {
    const longBody = 'x'.repeat(500);
    fetchMock.mockResolvedValueOnce(jsonResponse(longBody, { ok: false, status: 403 }));

    await expect(pairDevice('https://api.example.com/api', 'BADCDE')).rejects.toThrow(
      `Pair failed: 403 ${'x'.repeat(200)}`,
    );
  });
});

describe('claimNextCommand', () => {
  it('sets the Device Authorization header and hits next-command', async () => {
    const command: DeviceCommand = {
      id: 'cmd-1',
      kind: 'show_order',
      payload: { orderId: 'o1' },
      priority: 0,
      attempts: 0,
      idempotencyKey: 'idem-1',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(command));

    const result = await claimNextCommand(token);

    expect(result).toEqual(command);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/devices/next-command');
    expect(init.method).toBe('GET');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Device secret-token');
  });

  it('returns null when the server responds with a body that has no id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null));
    expect(await claimNextCommand(token)).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ kind: 'noop' }));
    expect(await claimNextCommand(token)).toBeNull();
  });

  it('throws on a non-ok next-command response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 503 }));
    await expect(claimNextCommand(token)).rejects.toThrow('next-command 503');
  });

  // deep-review NH8: 401/403 must be a distinct, recoverable auth error.
  it('throws DeviceAuthError on a 401 next-command response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 401 }));
    await expect(claimNextCommand(token)).rejects.toBeInstanceOf(DeviceAuthError);
  });
});

describe('heartbeat', () => {
  it('POSTs the heartbeat payload with the device token header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await heartbeat(token, { queueDepth: 3, batteryPct: 88 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/devices/heartbeat');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Authorization')).toBe('Device secret-token');
    expect(JSON.parse(init.body as string)).toEqual({ queueDepth: 3, batteryPct: 88 });
  });
});

describe('ackCommand', () => {
  it('POSTs to the per-command ack route with the status payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await ackCommand(token, 'cmd-42', { status: 'done', result: { printed: true } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/devices/commands/cmd-42/ack');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Authorization')).toBe('Device secret-token');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'done', result: { printed: true } });
  });

  // deep-review NM3: a failed ack must throw, not be treated as success, so the
  // poll loop retries it instead of abandoning the command to redelivery.
  it('throws on a 500 ack response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 500 }));
    await expect(ackCommand(token, 'cmd-42', { status: 'done' })).rejects.toThrow('ack 500');
  });

  // deep-review NH8/NM3: 401 on ack is the typed auth error so the loop re-pairs.
  it('throws DeviceAuthError on a 401 ack response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 401 }));
    await expect(ackCommand(token, 'cmd-42', { status: 'done' })).rejects.toBeInstanceOf(
      DeviceAuthError,
    );
  });
});

describe('heartbeat auth', () => {
  // deep-review NH8: heartbeat previously ignored res.ok entirely.
  it('throws DeviceAuthError on a 403 heartbeat response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 403 }));
    await expect(heartbeat(token, { queueDepth: 1 })).rejects.toBeInstanceOf(DeviceAuthError);
  });

  it('does not throw on a non-auth non-ok heartbeat response (best-effort)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('', { ok: false, status: 500 }));
    await expect(heartbeat(token, { queueDepth: 1 })).resolves.toBeUndefined();
  });
});
