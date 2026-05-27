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

  it('trusts Express-resolved req.ip (which already honours trust-proxy XFF)', () => {
    // With `app.set('trust proxy', 1)` Express resolves req.ip to the
    // left-most XFF hop (the real client) when traffic comes through
    // one LB. The guard MUST read that resolved value rather than
    // re-parsing the header itself — otherwise an attacker who can
    // inject their own X-Forwarded-For (e.g. via a misconfigured
    // bypass of the front proxy) sets a spoofed allowlisted IP and
    // walks through. The mock simulates Express having done its job
    // by passing the resolved 203.0.113.1 into req.ip directly.
    const guard = makeGuard('203.0.113.1');
    const ctx = makeContext({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' }, '203.0.113.1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects an attacker-spoofed X-Forwarded-For when req.ip says otherwise (iter-22)', () => {
    // The threat: an attacker hits the public webhook URL directly
    // (Cloudflare misconfig / direct origin IP exposure) and sets
    // X-Forwarded-For: <allowlisted PayTR IP>. With the old guard
    // ordering this passed. The new ordering reads req.ip (the actual
    // TCP peer) first and rejects.
    const guard = makeGuard('203.0.113.1');
    const ctx = makeContext(
      { 'x-forwarded-for': '203.0.113.1' }, // attacker-supplied
      '198.51.100.42',                       // actual TCP peer
    );
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('falls back to XFF only when Express did not resolve req.ip', () => {
    // Defensive fallback path — if trust-proxy is misconfigured and
    // req.ip is empty, parse XFF ourselves rather than returning '' and
    // failing every webhook. This branch should rarely run in prod.
    const guard = makeGuard('203.0.113.1');
    const req: any = {
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
      ip: undefined,
      socket: { remoteAddress: '10.0.0.1' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('treats an empty PAYTR_WEBHOOK_ALLOWED_IPS the same as missing', () => {
    const guard = makeGuard('');
    expect(guard.canActivate(makeContext({}, '198.51.100.42'))).toBe(true);
  });
});
