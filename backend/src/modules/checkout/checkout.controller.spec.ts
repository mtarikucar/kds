import { CheckoutController } from './checkout.controller';

/**
 * Thin-controller spec for CheckoutController. The interesting forwarding
 * logic: `quote`/`start` cast+pass the cart, `intent` folds the top-level
 * branchId INTO the cart (so it round-trips through CheckoutIntent.cartJson)
 * and threads buyer/buyerIp/returnUrl, and `confirm` forwards
 * tenantId/cart/paymentRef. A regression in the branchId-fold (which makes
 * HardwareOrder.branchId recoverable on confirm) fails here.
 */
describe('CheckoutController', () => {
  let quoteSvc: { quote: jest.Mock };
  let checkoutSvc: { confirmAndProvision: jest.Mock };
  let intentSvc: { createIntent: jest.Mock };
  let ctrl: CheckoutController;

  beforeEach(() => {
    quoteSvc = { quote: jest.fn().mockReturnValue({ total: 100 }) };
    checkoutSvc = {
      confirmAndProvision: jest.fn().mockResolvedValue({ ok: true }),
    };
    intentSvc = {
      createIntent: jest.fn().mockResolvedValue({ token: 'tok' }),
    };
    ctrl = new CheckoutController(
      quoteSvc as any,
      checkoutSvc as any,
      intentSvc as any,
    );
  });

  it('quote prices the cart via QuoteService (no DB write)', () => {
    const cart = { items: [] } as any;
    const result = ctrl.quote(cart);
    expect(quoteSvc.quote).toHaveBeenCalledWith(cart);
    expect(result).toEqual({ total: 100 });
  });

  it('start re-prices the cart (no provisioning) via QuoteService', async () => {
    const cart = { items: [] } as any;
    await ctrl.start({ user: { tenantId: 't1' } }, cart);
    expect(quoteSvc.quote).toHaveBeenCalledWith(cart);
  });

  it('intent folds the top-level branchId into the cart and threads buyer/ip/returnUrl', () => {
    const req = { user: { tenantId: 't1' } };
    const body = {
      cart: { items: [{ kind: 'plan' }] },
      branchId: 'br-9',
      buyer: { email: 'a@b.c' },
      returnUrl: 'https://x/return',
    } as any;
    ctrl.intent(req, '203.0.113.7', body);
    expect(intentSvc.createIntent).toHaveBeenCalledWith({
      tenantId: 't1',
      cart: { items: [{ kind: 'plan' }], branchId: 'br-9' },
      buyer: { email: 'a@b.c' },
      buyerIp: '203.0.113.7',
      returnUrl: 'https://x/return',
    });
  });

  it('confirm forwards tenantId, cart and paymentRef', () => {
    const req = { user: { tenantId: 't1' } };
    const body = { cart: { items: [] }, paymentRef: 'CK-123' } as any;
    ctrl.confirm(req, body);
    expect(checkoutSvc.confirmAndProvision).toHaveBeenCalledWith(
      't1',
      { items: [] },
      'CK-123',
    );
  });
});
