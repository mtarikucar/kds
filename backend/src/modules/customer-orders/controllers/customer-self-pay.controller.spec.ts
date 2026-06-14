import { CustomerSelfPayController } from './customer-self-pay.controller';

/**
 * Spec for the @Public CustomerSelfPayController. Beyond forwarding, createIntent
 * carries real boundary logic:
 *  - the client IP is taken from req (via getClientIp / trust-proxy), NOT from
 *    client-set headers; falls back to remoteAddress then '0.0.0.0'
 *  - returnOrigin = Origin header, else the origin parsed from Referer, else
 *    undefined
 */
describe('CustomerSelfPayController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: CustomerSelfPayController;

  beforeEach(() => {
    svc = {
      getPayableItemsForSession: jest.fn().mockResolvedValue([]),
      createPayIntent: jest.fn().mockResolvedValue({ paymentLink: 'x' }),
      getPayStatus: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    };
    ctrl = new CustomerSelfPayController(svc as any);
  });

  it('getPayableItems forwards the sessionId', () => {
    ctrl.getPayableItems('sess-1');
    expect(svc.getPayableItemsForSession).toHaveBeenCalledWith('sess-1');
  });

  it('createIntent forwards sessionId, dto, resolved ip and Origin', () => {
    const dto = { items: [] } as any;
    const req = { ip: '1.2.3.4', headers: {} };
    ctrl.createIntent('sess-1', dto, req, 'https://acme.menu.app');
    expect(svc.createPayIntent).toHaveBeenCalledWith(
      'sess-1',
      dto,
      '1.2.3.4',
      'https://acme.menu.app',
    );
  });

  it('derives returnOrigin from Referer when Origin is absent', () => {
    const dto = { items: [] } as any;
    const req = { ip: '1.2.3.4', headers: {} };
    ctrl.createIntent('sess-1', dto, req, undefined, 'https://acme.menu.app/table/7');
    expect(svc.createPayIntent).toHaveBeenCalledWith(
      'sess-1',
      dto,
      '1.2.3.4',
      'https://acme.menu.app',
    );
  });

  it('passes undefined returnOrigin when neither Origin nor Referer is present', () => {
    const dto = { items: [] } as any;
    const req = { ip: '1.2.3.4', headers: {} };
    ctrl.createIntent('sess-1', dto, req);
    expect(svc.createPayIntent).toHaveBeenCalledWith('sess-1', dto, '1.2.3.4', undefined);
  });

  it('falls back to remoteAddress, then 0.0.0.0, when req has no resolvable ip', () => {
    const dto = { items: [] } as any;
    const reqWithRemote = { headers: {}, connection: { remoteAddress: '9.9.9.9' } };
    ctrl.createIntent('sess-1', dto, reqWithRemote);
    expect(svc.createPayIntent).toHaveBeenCalledWith('sess-1', dto, '9.9.9.9', undefined);

    svc.createPayIntent.mockClear();
    const reqNoIp = { headers: {} };
    ctrl.createIntent('sess-1', dto, reqNoIp);
    expect(svc.createPayIntent).toHaveBeenCalledWith('sess-1', dto, '0.0.0.0', undefined);
  });

  it('getStatus forwards sessionId + merchantOid', () => {
    ctrl.getStatus('sess-1', 'oid-123');
    expect(svc.getPayStatus).toHaveBeenCalledWith('sess-1', 'oid-123');
  });
});
