import { BadRequestException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { BranchScope } from '../../../common/scoping/branch-scope';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Iter-87 regression for OrdersController.findAll query validation.
 *
 * Pre-fix the query params flowed straight to the service:
 *
 *   - `tableId` no validation. Non-UUID → Prisma P2023 → 500
 *     "Inconsistent column data" surfaced from the global filter
 *     instead of a 400 at the boundary.
 *   - `status` cast `split(',').map(trim) as OrderStatus[]` with NO
 *     enum allowlist. A typo'd value (`?status=ALL`) silently
 *     no-matched in Prisma → confusing empty list.
 *   - `startDate` / `endDate` no validity guard. A malformed ISO
 *     produced `Date(NaN)` → every `gte/lte` returned false → also
 *     a confusing empty list.
 *
 * The controller now rejects each bad shape at the boundary with a
 * clear 400. v3.0.0 — findAll forwards a BranchScope instead of the
 * bare tenantId so the service can filter by (tenantId, branchId).
 */
describe('OrdersController.findAll query validation (iter-87 + v3 scope)', () => {
  let ordersService: any;
  let orderTransferService: any;
  let paymentsService: any;
  let ctrl: OrdersController;

  beforeEach(() => {
    ordersService = { findAll: jest.fn().mockResolvedValue([]) };
    orderTransferService = {} as any;
    paymentsService = {} as any;
    ctrl = new OrdersController(
      ordersService,
      orderTransferService,
      paymentsService,
    );
  });

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  it('rejects an unknown status value with a clear message', () => {
    expect(() => ctrl.findAll(scope, undefined, 'WHATEVER', undefined, undefined, undefined, undefined))
      .toThrow(BadRequestException);
  });

  it('rejects when ONE of the comma-separated statuses is unknown', () => {
    expect(() =>
      ctrl.findAll(scope, undefined, `${OrderStatus.PENDING},BOGUS`, undefined, undefined, undefined, undefined),
    ).toThrow(/invalid: BOGUS/);
  });

  it('accepts multiple valid statuses and forwards scope to the service', async () => {
    await ctrl.findAll(
      scope,
      undefined,
      `${OrderStatus.PENDING},${OrderStatus.PREPARING}`,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(ordersService.findAll).toHaveBeenCalledWith(
      scope,
      undefined,
      [OrderStatus.PENDING, OrderStatus.PREPARING],
      undefined,
      undefined,
      100,
      0,
    );
  });

  it('rejects a malformed startDate (the Date-NaN empty-list guard)', () => {
    expect(() =>
      ctrl.findAll(scope, undefined, undefined, 'not-an-iso', undefined, undefined, undefined),
    ).toThrow(/startDate/);
  });

  it('rejects a malformed endDate', () => {
    expect(() =>
      ctrl.findAll(scope, undefined, undefined, undefined, 'also-not-iso', undefined, undefined),
    ).toThrow(/endDate/);
  });

  it('accepts valid ISO dates', async () => {
    await ctrl.findAll(
      scope,
      undefined,
      undefined,
      '2026-01-01T00:00:00Z',
      '2026-01-31T23:59:59Z',
      undefined,
      undefined,
    );
    expect(ordersService.findAll).toHaveBeenCalled();
  });

  it('passes a valid UUID tableId straight through and forwards scope', async () => {
    // ParseUUIDPipe is wired but Nest doesn't invoke pipes in plain
    // unit tests — the boundary check is exercised by e2e. Here we
    // verify the happy-path forward.
    await ctrl.findAll(
      scope,
      '550e8400-e29b-41d4-a716-446655440000',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(ordersService.findAll).toHaveBeenCalledWith(
      scope,
      '550e8400-e29b-41d4-a716-446655440000',
      undefined,
      undefined,
      undefined,
      100,
      0,
    );
  });
});
