import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { PaytrIpAllowlistGuard } from './paytr-ip-allowlist.guard';

function makeContext(headers: Record<string, string>, ip = '203.0.113.1'): ExecutionContext {
  const req = { headers, ip, socket: { remoteAddress: ip } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any as ExecutionContext;
}

function makeGuard(allowed: string | undefined): PaytrIpAllowlistGuard {
  const config = {
    get: (key: string) => (key === 'PAYTR_WEBHOOK_ALLOWED_IPS' ? allowed : undefined),
  } as ConfigService;
  return new PaytrIpAllowlistGuard(config);
}

describe('PaytrIpAllowlistGuard', () => {
  it('passes everything when the allowlist env var is unset (dev)', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(makeContext({}, '198.51.100.42'))).toBe(true);
  });

  it('passes IPs that are in the comma-separated allowlist', () => {
    const guard = makeGuard('203.0.113.1, 198.51.100.5');
    expect(guard.canActivate(makeContext({}, '203.0.113.1'))).toBe(true);
    expect(guard.canActivate(makeContext({}, '198.51.100.5'))).toBe(true);
  });

  it('rejects IPs not in the allowlist', () => {
    const guard = makeGuard('203.0.113.1');
    expect(guard.canActivate(makeContext({}, '198.51.100.42'))).toBe(false);
  });

  it('prefers X-Forwarded-For first hop over req.ip (behind LB)', () => {
    const guard = makeGuard('203.0.113.1');
    const ctx = makeContext({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' }, '10.0.0.1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('treats an empty PAYTR_WEBHOOK_ALLOWED_IPS the same as missing', () => {
    const guard = makeGuard('');
    expect(guard.canActivate(makeContext({}, '198.51.100.42'))).toBe(true);
  });
});
