import { describe, expect, it } from 'vitest';
import { OrderStatus, OrderType, PaymentStatus, UserRole } from './index';
import { HARD_RESTRICTED_ROLES } from './roles';

/**
 * In-suite half of the contract-drift guard. The cross-repo comparison
 * (backend source ↔ frontend source) lives in scripts/check-contract-drift.mjs
 * and runs in CI; this test pins the same values inside the frontend suite
 * so an editor refactor that rewrites an enum fails the local test run too.
 * If a value legitimately changes, update both the backend constant and
 * this expectation in the same commit.
 */
describe('mirrored backend contracts', () => {
  it('UserRole matches backend common/constants/roles.enum.ts', () => {
    expect(Object.values(UserRole).sort()).toEqual(
      ['ADMIN', 'COURIER', 'KITCHEN', 'MANAGER', 'WAITER'],
    );
  });

  it('HARD_RESTRICTED_ROLES matches backend HARD_RESTRICTED_ROLES', () => {
    expect([...HARD_RESTRICTED_ROLES].sort()).toEqual([
      'COURIER',
      'KITCHEN',
      'WAITER',
    ]);
  });

  it('OrderStatus matches backend order-status.enum.ts', () => {
    expect(Object.values(OrderStatus).sort()).toEqual([
      'CANCELLED',
      'PAID',
      'PENDING',
      'PENDING_APPROVAL',
      'PREPARING',
      'READY',
      'SERVED',
    ]);
  });

  it('OrderType matches backend order-status.enum.ts (incl. COUNTER)', () => {
    expect(Object.values(OrderType).sort()).toEqual([
      'COUNTER',
      'DELIVERY',
      'DINE_IN',
      'TAKEAWAY',
    ]);
  });

  it('PaymentStatus matches backend order-status.enum.ts', () => {
    expect(Object.values(PaymentStatus).sort()).toEqual([
      'COMPLETED',
      'FAILED',
      'PENDING',
      'REFUNDED',
    ]);
  });
});
