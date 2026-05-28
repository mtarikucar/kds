import { KdsController } from './kds.controller';
import { OrderItemStatus } from './dto/update-order-item-status.dto';

/**
 * Iter-91 regression for the kds order-item endpoint's route/body
 * desync. Pre-fix the DTO carried `orderItemId` and the service used
 * `updateDto.orderItemId` — so a client could POST
 *
 *   PATCH /kds/order-items/A/status   { orderItemId: 'B', status: READY }
 *
 * and silently mutate item B while the URL said A. Same-tenant only
 * (`order: { tenantId }` scopes the lookup), but misleading for audit
 * logs and a footgun for any path-based authorization layer that ever
 * tries to authorize per-resource by URL.
 *
 * The fix makes the URL `:id` the sole source of truth and drops
 * `orderItemId` from the DTO. This spec locks the controller-side
 * contract: the URL param flows to the service, not anything from the
 * body.
 */
describe('KdsController.updateOrderItemStatus (iter-91)', () => {
  let kdsService: { updateOrderItemStatus: jest.Mock };
  let ctrl: KdsController;
  const req = { tenantId: 't-1' } as any;

  beforeEach(() => {
    kdsService = { updateOrderItemStatus: jest.fn().mockResolvedValue({}) };
    ctrl = new KdsController(kdsService as any);
  });

  it('forwards the URL :id (not anything from the body) to the service', async () => {
    await ctrl.updateOrderItemStatus(
      'item-from-url',
      { status: OrderItemStatus.READY } as any,
      req,
    );
    expect(kdsService.updateOrderItemStatus).toHaveBeenCalledWith(
      'item-from-url',
      OrderItemStatus.READY,
      't-1',
    );
  });

  it('ignores a body-level orderItemId even if the client sneaks one in', async () => {
    // ValidationPipe with whitelist:true should strip unknown fields, but
    // even if it doesn't (or someone disables the pipe in tests), the
    // controller must not forward anything from the body to identify the
    // item — only the URL.
    await ctrl.updateOrderItemStatus(
      'item-from-url',
      // Cast through any so we can simulate a client posting the legacy
      // body shape.
      ({ status: OrderItemStatus.PREPARING, orderItemId: 'item-from-body' }) as any,
      req,
    );
    const [calledItemId] = kdsService.updateOrderItemStatus.mock.calls[0];
    expect(calledItemId).toBe('item-from-url');
    expect(calledItemId).not.toBe('item-from-body');
  });

  it('forwards the tenant from req — not from the body', async () => {
    await ctrl.updateOrderItemStatus(
      'item-1',
      ({ status: OrderItemStatus.READY, tenantId: 'wrong-tenant' }) as any,
      req,
    );
    const [, , tenant] = kdsService.updateOrderItemStatus.mock.calls[0];
    expect(tenant).toBe('t-1');
  });
});
