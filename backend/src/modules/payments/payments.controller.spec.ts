import { PaymentsController } from './payments.controller';

/**
 * Spec for the subscription-payment intent controller (route base
 * `payments`). createIntent resolves the audit IP via a fallback chain
 * (getClientIp → req.socket.remoteAddress → '0.0.0.0') and caps the
 * user-agent at 500 chars before forwarding tenantId/userId/dto to the
 * service. These branches are KVKK-audit load-bearing, so each is driven
 * with a real req shape.
 */
describe('PaymentsController (subscription intents)', () => {
  let payments: { createIntent: jest.Mock };
  let ctrl: PaymentsController;

  beforeEach(() => {
    payments = {
      createIntent: jest.fn().mockResolvedValue({ token: 'tok', ref: 'r1' }),
    };
    ctrl = new PaymentsController(payments as any);
  });

  const dto = { planId: 'plan-pro' } as any;

  function makeReq(overrides: any = {}) {
    return {
      user: { tenantId: 'tenant-1', id: 'user-7' },
      ip: '203.0.113.5',
      socket: { remoteAddress: '198.51.100.9' },
      headers: { 'user-agent': 'Mozilla/5.0 Test' },
      ...overrides,
    };
  }

  it('forwards tenantId, userId, dto, and the Express-resolved IP + UA', async () => {
    await ctrl.createIntent(dto, makeReq());
    expect(payments.createIntent).toHaveBeenCalledWith(
      'tenant-1',
      'user-7',
      dto,
      '203.0.113.5',
      'Mozilla/5.0 Test',
    );
  });

  it('falls back to socket.remoteAddress when req.ip and XFF are absent', async () => {
    const req = makeReq({ ip: undefined, headers: { 'user-agent': 'UA' } });
    await ctrl.createIntent(dto, req);
    const args = payments.createIntent.mock.calls[0];
    expect(args[3]).toBe('198.51.100.9');
  });

  it('falls back to 0.0.0.0 when neither req.ip, XFF, nor socket address exist', async () => {
    const req = makeReq({
      ip: undefined,
      socket: {},
      headers: {},
    });
    await ctrl.createIntent(dto, req);
    const args = payments.createIntent.mock.calls[0];
    expect(args[3]).toBe('0.0.0.0');
  });

  it('resolves the IP from the left-most X-Forwarded-For hop when req.ip is empty', async () => {
    const req = makeReq({
      ip: undefined,
      headers: { 'x-forwarded-for': '5.5.5.5, 10.0.0.1', 'user-agent': 'UA' },
    });
    await ctrl.createIntent(dto, req);
    const args = payments.createIntent.mock.calls[0];
    expect(args[3]).toBe('5.5.5.5');
  });

  it('truncates an over-long user-agent to 500 characters', async () => {
    const longUa = 'x'.repeat(900);
    const req = makeReq({ headers: { 'user-agent': longUa } });
    await ctrl.createIntent(dto, req);
    const args = payments.createIntent.mock.calls[0];
    expect(args[4]).toHaveLength(500);
  });

  it('passes undefined user-agent when the header is missing/non-string', async () => {
    const req = makeReq({ headers: {} });
    await ctrl.createIntent(dto, req);
    const args = payments.createIntent.mock.calls[0];
    expect(args[4]).toBeUndefined();
  });

  it('returns the service result to the caller', async () => {
    await expect(ctrl.createIntent(dto, makeReq())).resolves.toEqual({
      token: 'tok',
      ref: 'r1',
    });
  });
});
