import { describe, it, expect, beforeEach } from 'vitest';
import {
  stashPendingCheckoutRef,
  clearPendingCheckoutRef,
  resolvePendingCheckoutRef,
} from './checkoutRef';

describe('checkoutRef', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('resolves the stashed real paymentRef over the raw query value', () => {
    stashPendingCheckoutRef('CK-real-ref');
    expect(resolvePendingCheckoutRef('pending')).toBe('CK-real-ref');
  });

  it('falls back to the query value when nothing was stashed', () => {
    expect(resolvePendingCheckoutRef('CK-direct')).toBe('CK-direct');
  });

  it('clear removes the stashed ref so a later resolve falls back again', () => {
    stashPendingCheckoutRef('CK-real-ref');
    clearPendingCheckoutRef();
    expect(resolvePendingCheckoutRef('pending')).toBe('pending');
  });
});
